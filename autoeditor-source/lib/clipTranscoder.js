// clipTranscoder.js
// Detects H.265/HEVC video clips and transcodes them to H.264 in-browser
// using FFmpeg.wasm (loaded lazily — only when H.265 clips are present).
// The original File objects are never modified; we return new File objects.
import { createFile, DataStream } from "mp4box";

// Returns true if this file needs to be transcoded to H.264.
// This tests if Chrome's hardware VideoDecoder supports the codec/profile.
// AI video generators (like Google Flow) often output H.265, or H.264 high profiles
// (like 10-bit or 4:4:4) that Chrome refuses to hardware decode.
export async function needsTranscode(file) {
  return new Promise((resolve) => {
    let mp4;
    try { mp4 = createFile(); } catch (_) { resolve(true); return; } // fallback to transcode if parse fails
    mp4.onError = () => resolve(true);
    mp4.onReady = async (info) => {
      const vt = info.videoTracks && info.videoTracks[0];
      if (!vt) { resolve(false); return; } // no video track, skip transcode

      const base = (vt.codec || "").split(".")[0].toLowerCase();
      const HEVC_CODECS = ["hvc1", "hev1", "dvh1", "dvhe", "mhm1", "mhm2"];
      if (HEVC_CODECS.includes(base)) { resolve(true); return; }

      // Test hardware decoder support
      const config = {
        codec: vt.codec,
        codedWidth: (vt.video && vt.video.width) || vt.track_width,
        codedHeight: (vt.video && vt.video.height) || vt.track_height,
      };

      const entry = mp4.moov?.traks[0]?.mdia?.minf?.stbl?.stsd?.entries[0];
      if (entry && entry.avcC) {
        try {
          const stream = entry.avcC.write(new DataStream(new ArrayBuffer(entry.avcC.size), 0, DataStream.BIG_ENDIAN));
          config.description = stream.buffer;
        } catch (_) {}
      }

      try {
        const sup = await VideoDecoder.isConfigSupported(config);
        // If supported, we don't need to transcode. If unsupported, we must transcode.
        resolve(!(sup && sup.supported));
      } catch (_) {
        resolve(true); // If in doubt, transcode to a clean baseline profile
      }
    };
    file.arrayBuffer().then((ab) => {
      ab.fileStart = 0;
      mp4.appendBuffer(ab);
      mp4.flush();
    }).catch(() => resolve(true));
  });
}

let _ffmpegInstance = null;

// Lazily load FFmpeg.wasm. Only called when at least one clip needs transcoding.
async function getFFmpeg() {
  if (_ffmpegInstance) return _ffmpegInstance;
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { fetchFile, toBlobURL } = await import("@ffmpeg/util");
  const ff = new FFmpeg();
  const base = (typeof window !== "undefined" ? window.location.pathname.split("/").slice(0, -1).join("/") : "") + "/ffmpeg";
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

