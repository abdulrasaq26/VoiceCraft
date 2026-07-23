// Minimal dependency-free PDF writer: one image per page with caption text,
// using the standard Helvetica font (no embedding) and JPEG images embedded
// via DCTDecode. Exposes window.BlvckPDF.create(pages) -> Blob.
// pages: [{ jpeg: Uint8Array, w, h, lines: [string] }]
(() => {
  'use strict';

  const PAGE_W = 595.28; // A4 points
  const PAGE_H = 841.89;
  const MARGIN = 40;
  const FONT_SIZE = 11;
  const LINE_H = 15;

  // Latin-1 encode a string to bytes (binary-safe, keeps byte offsets exact).
  function strBytes(s) {
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
    return b;
  }

  // Escape + downgrade to WinAnsi-safe text for a PDF string literal.
  function pdfText(s) {
    return String(s)
      .replace(/[^\x20-\x7e]/g, '') // drop non-ASCII to stay within the base font
      .replace(/([\\()])/g, '\\$1');
  }

  function create(pages) {
    const chunks = [];
    let length = 0;
    const push = (data) => {
      const bytes = data instanceof Uint8Array ? data : strBytes(data);
      chunks.push(bytes);
      length += bytes.length;
    };

    const offsets = [];
    const obj = (num, render) => {
      offsets[num] = length;
      push(`${num} 0 obj\n`);
      render();
      push('\nendobj\n');
    };

    push('%PDF-1.4\n%\xff\xff\xff\xff\n');

    // Object numbering: 1 catalog, 2 pages, 3 font, then 3 objects per page.
    const pageObjNums = pages.map((_, i) => 4 + i * 3);
    const totalObjs = 3 + pages.length * 3;

    obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => push(`<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`));
    obj(3, () => push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));

    pages.forEach((page, i) => {
      const pageNum = pageObjNums[i];
      const contentNum = pageNum + 1;
      const imageNum = pageNum + 2;

      // Fit the image into the top region, preserving aspect ratio.
      const maxW = PAGE_W - MARGIN * 2;
      const captionLines = page.lines || [];
      const captionH = captionLines.length * LINE_H + 10;
      const maxImgH = PAGE_H - MARGIN * 2 - captionH;
      let dw = maxW;
      let dh = page.h && page.w ? (page.h / page.w) * dw : maxImgH;
      if (dh > maxImgH) {
        dh = maxImgH;
        dw = page.w && page.h ? (page.w / page.h) * dh : maxW;
      }
      const ix = MARGIN + (maxW - dw) / 2;
      const iy = PAGE_H - MARGIN - dh;

      let content = `q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${ix.toFixed(2)} ${iy.toFixed(2)} cm /Im0 Do Q\n`;
      content += 'BT /F1 ' + FONT_SIZE + ' Tf\n';
      let ty = iy - 20;
      for (const line of captionLines) {
        content += `1 0 0 1 ${MARGIN} ${ty.toFixed(2)} Tm (${pdfText(line)}) Tj\n`;
        ty -= LINE_H;
      }
      content += 'ET';

      obj(pageNum, () =>
        push(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
            `/Resources << /Font << /F1 3 0 R >> /XObject << /Im0 ${imageNum} 0 R >> >> ` +
            `/Contents ${contentNum} 0 R >>`
        )
      );

      const contentBytes = strBytes(content);
      obj(contentNum, () => {
        push(`<< /Length ${contentBytes.length} >>\nstream\n`);
        push(contentBytes);
        push('\nendstream');
      });

      obj(imageNum, () => {
        push(
          `<< /Type /XObject /Subtype /Image /Width ${page.w} /Height ${page.h} ` +
            `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`
        );
        push(page.jpeg);
        push('\nendstream');
      });
    });

    const xrefStart = length;
    push(`xref\n0 ${totalObjs + 1}\n`);
    push('0000000000 65535 f \n');
    for (let n = 1; n <= totalObjs; n++) {
      push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
    }
    push(`trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

    return new Blob(chunks, { type: 'application/pdf' });
  }

  window.BlvckPDF = { create };
})();
