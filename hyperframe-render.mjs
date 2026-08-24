// Rendering a HyperFrame composition to video, on the server.
//
// This is the one place in AETHER that runs a subprocess, and everything it
// renders is code a model wrote. So the isolation is the design, not a wrapper
// around it:
//
//   * every job gets its own directory under .hyperframe-jobs and can see
//     nothing else on disk
//   * the child gets a MINIMAL env - PATH, and the handful of vars Node and
//     Chrome cannot start without. Not process.env. No API keys, no endpoints,
//     no tokens; the composition has no business knowing this machine has them
//   * a wall-clock kill, because a composition with a while(true) in it would
//     otherwise hold a Chrome process open until the server restarts
//   * telemetry off. The renderer phones home by default about usage; a
//     documentary pipeline should not do that on the operator's behalf
//
// FFmpeg is NOT expected on the system PATH. hyperframes needs both `ffmpeg`
// and `ffprobe` discoverable there and ignores FFMPEG_PATH, so the static
// binaries are staged into one directory and that directory is prepended to
// PATH for the child only. Nothing about the host is changed.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const JOBS_DIR = path.join(__dirname, '.hyperframe-jobs');
const BIN_DIR  = path.join(JOBS_DIR, '_bin');

// Generous enough for a long scene on a slow machine, short enough that a
// runaway composition does not become a permanent Chrome process. Measured:
// a 4s composition renders in about 19-25s single-worker.
const RENDER_TIMEOUT_MS = 10 * 60 * 1000;

// A composition is HTML we are about to execute. Anything past this is not a
// scene, it is a mistake or an attack.
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_ASSET_BYTES  = 64 * 1024 * 1024;

let staged = null;

/**
 * Put ffmpeg and ffprobe side by side in one directory.
 *
 * Both are required and must be found on PATH. ffmpeg-static ships only
 * ffmpeg, which is why the first attempt at this failed with "FFprobe not
 * found" even though ffmpeg was present.
 */
function stageBinaries() {
  if (staged) return staged;
  fs.mkdirSync(BIN_DIR, { recursive: true });

  const exe = process.platform === 'win32' ? '.exe' : '';
  const want = [
    ['ffmpeg' + exe,  () => require('ffmpeg-static')],
    ['ffprobe' + exe, () => require('ffprobe-static').path]
  ];

  for (const [name, resolve] of want) {
    const dest = path.join(BIN_DIR, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) continue;
    let src;
    try { src = resolve(); } catch (err) {
      throw new Error(`${name} is not installed (${err.message}). `
        + 'Run: npm install ffmpeg-static ffprobe-static');
    }
    if (!src || !fs.existsSync(src)) throw new Error(`${name} resolved to a path that does not exist: ${src}`);
    fs.copyFileSync(src, dest);
    if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
  }
  staged = BIN_DIR;
  return staged;
}

/** Where the hyperframes CLI actually lives, without shelling through npx. */
function cliEntry() {
  const pkg = require.resolve('hyperframes/package.json');
  const dir = path.dirname(pkg);
  const bin = JSON.parse(fs.readFileSync(pkg, 'utf8')).bin;
  const rel = typeof bin === 'string' ? bin : bin.hyperframes;
  const entry = path.join(dir, rel);
  if (!fs.existsSync(entry)) throw new Error('the hyperframes CLI entry was not found at ' + entry);
  return entry;
}

/**
 * What the child is allowed to know about this machine.
 *
 * Deliberately not process.env. AETHER's own process carries NIM keys, the
 * Fish endpoint and stock library credentials, and none of that is any of a
 * composition's business.
 */
function childEnv(binDir) {
  const keep = {};
  // Windows will not start a process without these.
  for (const k of ['SystemRoot', 'windir', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT',
                   'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'HOME', 'USERPROFILE']) {
    if (process.env[k]) keep[k] = process.env[k];
  }
  return Object.assign(keep, {
    PATH: binDir + path.delimiter + (process.env.PATH || ''),
    // The renderer checks a remote skills registry on some paths; a render
    // should not depend on GitHub being reachable.
    HYPERFRAMES_SKIP_SKILLS: '1',
    HYPERFRAMES_TELEMETRY: '0',
    DO_NOT_TRACK: '1',
    CI: '1'
  });
}

const rmrf = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ } };

/**
 * Render one composition and return the encoded video.
 *
 * @param {object}  job
 * @param {string}  job.source     the composition's index.html
 * @param {number}  job.seconds    scene length; AETHER's clock, never the model's
 * @param {string} [job.format]    mp4 | webm | mov | png-sequence
 * @param {Array}  [job.assets]    [{ name, base64 }] written into assets/
 * @param {Array}  [job.vendor]    [{ name, text }] written into vendor/
 * @param {boolean}[job.keep]      keep the job directory for diagnosis
 * @returns {Promise<{buffer:Buffer, mime:string, ms:number, log:string, jobId:string}>}
 */
export async function renderComposition(job = {}) {
  const source = String(job.source || '');
  if (!source.trim()) throw new Error('there is no composition to render');
  if (Buffer.byteLength(source) > MAX_SOURCE_BYTES) {
    throw new Error(`the composition is larger than ${MAX_SOURCE_BYTES} bytes`);
  }
  const seconds = Number(job.seconds);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error('a composition needs a duration, and it comes from the scene window');
  }
  const format = ['mp4', 'webm', 'mov', 'png-sequence'].includes(job.format) ? job.format : 'mp4';

  const binDir = stageBinaries();
  const entry = cliEntry();

  const jobId = 'hf-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const dir = path.join(JOBS_DIR, jobId);
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'vendor'), { recursive: true });

  try {
    fs.writeFileSync(path.join(dir, 'index.html'), source, 'utf8');
    // A project marker, so the CLI treats this directory as a project rather
    // than guessing.
    fs.writeFileSync(path.join(dir, 'meta.json'),
      JSON.stringify({ id: jobId, name: jobId, createdAt: new Date().toISOString() }, null, 2));
    fs.writeFileSync(path.join(dir, 'hyperframes.json'), JSON.stringify({
      paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
      media: { autoProxy: false }
    }, null, 2));

    // Assets and vendored libraries. Names are flattened deliberately: a
    // manifest entry called "../../server.js" must land as a file called
    // server.js inside this job and nowhere else.
    let assetBytes = 0;
    for (const a of (job.assets || [])) {
      const name = path.basename(String(a.name || '')).replace(/[^\w.\-]/g, '_');
      if (!name) continue;
      const buf = Buffer.from(String(a.base64 || ''), 'base64');
      assetBytes += buf.length;
      if (assetBytes > MAX_ASSET_BYTES) throw new Error('the asset manifest is too large to render');
      fs.writeFileSync(path.join(dir, 'assets', name), buf);
    }
    for (const v of (job.vendor || [])) {
      const name = path.basename(String(v.name || '')).replace(/[^\w.\-]/g, '_');
      if (!name) continue;
      fs.writeFileSync(path.join(dir, 'vendor', name), String(v.text || ''), 'utf8');
    }

    const outName = format === 'png-sequence' ? 'frames'
                  : 'scene.' + (format === 'mov' ? 'mov' : format === 'webm' ? 'webm' : 'mp4');
    const outPath = path.join(dir, 'renders', outName);

    const args = [entry, 'render', '.',
                  '--output', outPath,
                  '--format', format,
                  // Fail rather than quietly ship a scene with missing media.
                  '--no-best-effort'];

    const started = Date.now();
    const log = await run(process.execPath, args, dir, childEnv(binDir));
    const ms = Date.now() - started;

    if (format === 'png-sequence') {
      const frames = fs.existsSync(outPath) ? fs.readdirSync(outPath) : [];
      if (!frames.length) throw new Error('the renderer produced no frames\n' + tail(log));
      return { buffer: null, frames: frames.length, dir: outPath, mime: 'image/png', ms, log, jobId };
    }

    if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
      throw new Error('the renderer reported no error but produced no file\n' + tail(log));
    }
    const buffer = fs.readFileSync(outPath);
    const mime = format === 'webm' ? 'video/webm' : format === 'mov' ? 'video/quicktime' : 'video/mp4';
    return { buffer, mime, ms, log, jobId };
  } finally {
    if (!job.keep) rmrf(dir);
  }
}

const tail = (s, n = 1200) => String(s || '').slice(-n);

function run(cmd, args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd, env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    let out = '';
    const take = (buf) => {
      out += buf.toString();
      // A runaway composition can print without bound; keep the last of it.
      if (out.length > 400000) out = out.slice(-200000);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (e) { /* already gone */ }
      reject(new Error(`the render did not finish within ${RENDER_TIMEOUT_MS / 1000}s\n` + tail(out)));
    }, RENDER_TIMEOUT_MS);

    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`the renderer exited ${code}\n` + tail(out)));
    });
  });
}

/** Is rendering possible on this machine at all? Cheap enough to ask on boot. */
export function renderReadiness() {
  const state = { ready: false, node: process.version, reasons: [] };
  try { cliEntry(); } catch (err) { state.reasons.push(err.message); }
  try { stageBinaries(); } catch (err) { state.reasons.push(err.message); }
  const major = Number(String(process.version).replace(/^v/, '').split('.')[0]);
  if (major < 22) state.reasons.push(`hyperframes needs node >= 22; this is ${process.version}`);
  state.ready = state.reasons.length === 0;
  return state;
}

export const JOBS_ROOT = JOBS_DIR;
