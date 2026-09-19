// clipTranscoder.js
// Detects H.265/HEVC video clips and transcodes them to H.264 in-browser
// using FFmpeg.wasm (loaded lazily — only when H.265 clips are present).
// The original File objects are never modified; we return new File objects.
import { createFile } from "mp4box";

const HEVC_CODECS = ["hvc1", "hev1", "dvh1", "dvhe", "mhm1", "mhm2"];

// Read the codec string from an MP4 file using mp4box.
async function getVideoCodec(file) {
  return new Promise((resolve) => {
    let mp4;
    try { mp4 = createFile(); } catch (_) { resolve(null); return; }
    mp4.onError = () => resolve(null);
    mp4.onReady = (info) => {
      const vt = info.videoTracks && info.videoTracks[0];
      resolve(vt ? vt.codec : null);
    };
    file.arrayBuffer().then((ab) => {
      ab.fileStart = 0;
      mp4.appendBuffer(ab);
      mp4.flush();
    }).catch(() => resolve(null));
  });
}

// Returns true if this file needs to be transcoded to H.264.
export async function needsTranscode(file) {
  const codec = await getVideoCodec(file);
  if (!codec) return false;
  const base = codec.split(".")[0].toLowerCase();
  return HEVC_CODECS.includes(base);
}

let _ffmpegInstance = null;

// Lazily load FFmpeg.wasm. Only called when at least one clip needs transcoding.
async function getFFmpeg() {
  if (_ffmpegInstance) return _ffmpegInstance;
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { fetchFile, toBlobURL } = await import("@ffmpeg/util");
  const ff = new FFmpeg();
  const base = "/ffmpeg";
  await ff.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
  });
  _ffmpegInstance = { ff, fetchFile };
  return _ffmpegInstance;
}

// Transcode a single File from H.265 to H.264 MP4.
// onProgress(ratio) is called with 0-1 as FFmpeg reports progress.
export async function transcodeClip(file, onProgress) {
  const { ff, fetchFile } = await getFFmpeg();
  const inName = "input_" + Date.now() + ".mp4";
  const outName = "output_" + Date.now() + ".mp4";

  const progressHandler = ({ progress }) => {
    if (onProgress) onProgress(Math.min(1, Math.max(0, progress)));
  };
  ff.on("progress", progressHandler);

  await ff.writeFile(inName, await fetchFile(file));

  await ff.exec([
    "-i", inName,
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "23",
    "-c:a", "copy",
    "-movflags", "+faststart",
    outName,
  ]);

  const data = await ff.readFile(outName);

  // Clean up virtual FS
  try { await ff.deleteFile(inName); } catch (_) {}
  try { await ff.deleteFile(outName); } catch (_) {}
  ff.off("progress", progressHandler);

  const blob = new Blob([data.buffer], { type: "video/mp4" });
  return new File([blob], file.name.replace(/\.[^.]+$/, "_h264.mp4"), { type: "video/mp4" });
}

// Check all videosByName entries and transcode any H.265 clips.
// onClipProgress(clipName, ratio) gives per-clip progress.
// onStatus(msg) emits human-readable status strings.
// Returns a new videosByName map with converted files swapped in.
export async function transcodeH265Clips(videosByName, onClipProgress, onStatus) {
  const entries = Object.entries(videosByName);
  const result = { ...videosByName };

  const needsWork = [];
  for (const [name, file] of entries) {
    if (await needsTranscode(file)) needsWork.push([name, file]);
  }

  if (needsWork.length === 0) return result;

  if (onStatus) onStatus(`Converting ${needsWork.length} H.265 clip${needsWork.length > 1 ? "s" : ""} to H.264 for fast render...`);

  for (let i = 0; i < needsWork.length; i++) {
    const [name, file] = needsWork[i];
    if (onStatus) onStatus(`Converting clip ${i + 1} of ${needsWork.length}: ${file.name}`);
    result[name] = await transcodeClip(file, (ratio) => {
      if (onClipProgress) onClipProgress(name, ratio);
    });
  }

  if (onStatus) onStatus("Conversion complete - starting render...");
  return result;
}
