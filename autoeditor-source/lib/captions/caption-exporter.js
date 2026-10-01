/**
 * Caption file export (SRT / WebVTT) for use outside the burned-in video —
 * YouTube, other editors, or re-importing later.
 */

function stamp(sec, sep) {
  sec = Math.max(0, sec);
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(r, 3)}`;
}

export function toSRT(captions) {
  return captions
    .filter((c) => c.text && c.end > c.start)
    .map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text}\n`)
    .join('\n');
}

export function toVTT(captions) {
  return 'WEBVTT\n\n' + captions
    .filter((c) => c.text && c.end > c.start)
    .map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text}\n`)
    .join('\n');
}

export function downloadCaptions(captions, format, baseName = 'captions') {
  const text = format === 'vtt' ? toVTT(captions) : toSRT(captions);
  const blob = new Blob([text], { type: format === 'vtt' ? 'text/vtt' : 'application/x-subrip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${String(baseName).replace(/[^\w.-]+/g, '_') || 'captions'}.${format === 'vtt' ? 'vtt' : 'srt'}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
