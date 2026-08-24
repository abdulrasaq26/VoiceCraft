// Measurement-grade frames.
//
// Every geometric claim this project makes about a rendered video has been read
// out of a browser <video> element, and the browser has now produced two
// different kinds of lie:
//
//   - Seeking with currentTime returned a BLANK frame. Twice at the tail of a
//     clip, once mid-clip, on files that read correctly a moment either side.
//     Two seeks to different times also came back byte-identical, so a test
//     believing it had sampled 0.5s and 2.5s had sampled one frame twice.
//   - The frame it does hand over is presentation state: whatever the element
//     happened to have decoded, at whatever size the canvas asked for.
//
// So acceptance measurement stops asking the browser. This decodes the file
// with ffmpeg, which is already on this machine for HyperFrames, and returns
// the frame that is genuinely on screen at a given instant — at the file's own
// resolution, with the timestamp it actually landed on, so a test can assert on
// what it got rather than on what it asked for.
//
// THE GUARANTEES, stated so a test can rely on them:
//
//   1. The frame returned for time t is the one A VIEWER IS LOOKING AT at t:
//      the last frame whose presentation timestamp is <= t. A frame stays on
//      screen until the next arrives, so "the first frame at or after t" — the
//      first thing this module did — is the NEXT frame, not the current one.
//      Measured on a clip with sparse early frames: asked for 0.5s it returned
//      the frame at 1.456s, a whole band of colour later, while the browser
//      correctly showed the frame from before 0.5s.
//   2. Its real timestamp is reported. If a file has no frame at or after t,
//      that is an error, never a blank image.
//   3. Frames come back at the stream's own width and height unless a scale is
//      asked for, and the scale used is reported.
//   4. A frame that decodes to nothing is a failure with a reason, not a black
//      rectangle that a pixel test will happily measure.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

const WORK_DIR = path.join(process.cwd(), '.frame-jobs');
const BIN_DIR = path.join(WORK_DIR, '_bin');
const EXTRACT_TIMEOUT_MS = 120000;
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
const MAX_TIMES = 64;

let staged = null;

function stageBinaries() {
  if (staged) return staged;
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const exe = process.platform === 'win32' ? '.exe' : '';
  for (const [name, resolve] of [
    ['ffmpeg' + exe, () => require('ffmpeg-static')],
    ['ffprobe' + exe, () => require('ffprobe-static').path]
  ]) {
    const dest = path.join(BIN_DIR, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) continue;
    let src;
    try { src = resolve(); } catch (err) {
      throw new Error(`${name} is not installed (${err.message}). `
        + 'Run: npm install ffmpeg-static ffprobe-static');
    }
    if (!src || !fs.existsSync(src)) throw new Error(`${name} resolved to a missing path: ${src}`);
    fs.copyFileSync(src, dest);
    if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
  }
  staged = BIN_DIR;
  return staged;
}

const binary = (name) =>
  path.join(stageBinaries(), name + (process.platform === 'win32' ? '.exe' : ''));

function run(cmd, args, { timeoutMs = EXTRACT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let out = '', err = '';
    const bell = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) {} }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(bell); resolve({ code: -1, out, err: e.message }); });
    child.on('close', (code) => { clearTimeout(bell); resolve({ code, out, err }); });
  });
}

/** What the file actually is, from the container rather than from a guess. */
export async function probe(file) {
  const r = await run(binary('ffprobe'), [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,nb_frames,duration,codec_name',
    '-show_entries', 'format=duration',
    '-of', 'json', file
  ], { timeoutMs: 30000 });
  if (r.code !== 0) throw new Error('ffprobe could not read the file: ' + r.err.trim().slice(0, 300));
  let j;
  try { j = JSON.parse(r.out); } catch (e) { throw new Error('ffprobe returned something that is not JSON'); }
  const s = (j.streams && j.streams[0]) || {};
  const [num, den] = String(s.r_frame_rate || '0/1').split('/').map(Number);
  const duration = Number(s.duration) || Number(j.format && j.format.duration) || 0;
  return {
    width: Number(s.width) || 0,
    height: Number(s.height) || 0,
    fps: den ? num / den : 0,
    frames: Number(s.nb_frames) || 0,
    codec: s.codec_name || '',
    duration
  };
}

/**
 * The frames on screen at these instants.
 *
 * One ffmpeg run per instant, deliberately. A single run with a select filter
 * over several times is faster and gives back a pile of images with no reliable
 * way to say which is which — and being sure which frame you measured is the
 * entire point of this module.
 */
export async function extractFrames(file, times, { scale = null } = {}) {
  const meta = await probe(file);
  if (!meta.width || !meta.height) throw new Error('the file has no readable video stream');

  const wanted = [...new Set(times.map(Number).filter((t) => Number.isFinite(t) && t >= 0))]
    .sort((a, b) => a - b)
    .slice(0, MAX_TIMES);
  if (!wanted.length) throw new Error('no usable timestamps were asked for');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-frames-'));
  const out = [];
  try {
    for (const t of wanted) {
      // Past the end is a mistake in the caller, and "the last frame" is a
      // plausible-looking answer that hides it. Refusing keeps the guarantee
      // that a frame handed back was genuinely on screen at the instant asked
      // for. One frame interval of slack, because a file of 5.967s legitimately
      // has something on screen at 6.0s.
      const slack = meta.fps > 0 ? (1 / meta.fps) : 0.05;
      if (meta.duration > 0 && t > meta.duration + slack) {
        out.push({ at: t, ok: false,
                   why: `there is no frame at ${t}s in a file of ${meta.duration}s` });
        continue;
      }
      const png = path.join(dir, `f${String(Math.round(t * 1000)).padStart(8, '0')}.png`);

      // WHICH FRAME, SAID BY THE FILTER GRAPH ITSELF.
      //
      // Three spellings were tried and two of them lied about where they
      // landed. Output-seek (-i then -ss) runs showinfo BEFORE the discard, so
      // it prints every frame from zero and the first line reported 0.0 for all
      // eight instants asked for; reading the last line instead reported 2.93s
      // for a frame asked at 2.5s, because -frames:v 1 stops the writer while
      // the filter has already been handed more.
      //
      // select decides, so showinfo only ever sees frames that passed it. Every
      // frame at or before t is written to the same file with -update, so the
      // file left behind is the LAST of them — the frame still on screen at t —
      // and showinfo's last line is its timestamp.
      //
      // The input seek is a fast skip to shortly before the target; select
      // still decides on absolute source time, which -copyts keeps intact. The
      // comma inside lte() is escaped because ffmpeg's own filter parser reads
      // an unescaped comma as the end of a filter.
      const shoot = async (lead, expr) => {
        const args = ['-v', 'info', '-nostdin', '-copyts', '-accurate_seek',
                      '-ss', String(Math.max(0, lead)), '-i', file];
        const filters = [`select='${expr}'`];
        if (scale && Number(scale) > 0 && Number(scale) !== 1) {
          filters.push(`scale=iw*${Number(scale)}:ih*${Number(scale)}`);
        }
        filters.push('showinfo');
        args.push('-vf', filters.join(','), '-fps_mode', 'passthrough',
                  '-f', 'image2', '-update', '1', '-y', png);
        const r = await run(binary('ffmpeg'), args);
        const wrote = fs.existsSync(png) && fs.statSync(png).size > 0;
        return { r, wrote };
      };

      // A two-second run-up is enough for any real frame rate and saves
      // decoding the whole file for every instant. If it finds nothing — a
      // sparse or very slow stream — the file is decoded from the start before
      // concluding there is nothing there.
      let { r, wrote } = await shoot(t - 2, `lte(t\\,${t})`);
      let stamps = [...String(r.err).matchAll(/pts_time:([0-9.]+)/g)].map((m) => Number(m[1]));
      if (!wrote || !stamps.length) {
        ({ r, wrote } = await shoot(0, `lte(t\\,${t})`));
        stamps = [...String(r.err).matchAll(/pts_time:([0-9.]+)/g)].map((m) => Number(m[1]));
      }

      // Nothing at or before t at all: t is before the first frame exists. The
      // honest answer is the first frame there is, said plainly rather than
      // pretending it was on screen.
      let before = false;
      if (!wrote || !stamps.length) {
        ({ r, wrote } = await shoot(0, `gte(t\\,${t})`));
        stamps = [...String(r.err).matchAll(/pts_time:([0-9.]+)/g)].map((m) => Number(m[1]));
        before = wrote && stamps.length > 0;
      }

      const exists = wrote;
      if (r.code !== 0 || !exists) {
        out.push({ at: t, ok: false,
                   why: r.code !== 0
                     ? 'ffmpeg failed: ' + lastLines(r.err)
                     : `there is no frame at or after ${t}s in a file of ${meta.duration}s` });
        continue;
      }

      // The last one written is the one left in the file.
      const actual = stamps.length ? stamps[stamps.length - 1] : null;
      const sizeM = /\bs:(\d+)x(\d+)/.exec(r.err);

      out.push({
        at: t,
        ok: true,
        actualAt: actual,
        // True when t falls before any frame exists, so what came back is the
        // first frame rather than one that was on screen.
        beforeFirstFrame: before,
        width: sizeM ? Number(sizeM[1]) : Math.round(meta.width * (scale || 1)),
        height: sizeM ? Number(sizeM[2]) : Math.round(meta.height * (scale || 1)),
        scale: scale || 1,
        png: fs.readFileSync(png)
      });
    }
    return { meta, frames: out };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* a temp dir */ }
  }
}

const lastLines = (s, n = 3) =>
  String(s || '').trim().split(/\r?\n/).slice(-n).join(' | ').slice(0, 400);

/** Can this machine do it at all? */
export function extractReadiness() {
  const state = { ready: false, reasons: [] };
  try {
    stageBinaries();
    state.ready = true;
  } catch (err) {
    state.reasons.push(err.message);
  }
  return state;
}

export const LIMITS = { MAX_VIDEO_BYTES, MAX_TIMES, EXTRACT_TIMEOUT_MS };
