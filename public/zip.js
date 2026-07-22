// Minimal, dependency-free ZIP writer (STORE method — no compression, which
// is ideal for already-compressed audio like MP3/OGG). Produces a standard
// ZIP Blob that opens in every OS archiver. Exposes window.BlvckZip.
(() => {
  'use strict';

  // CRC-32 (IEEE 802.3), used by the ZIP format for per-entry checksums.
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  // DOS date/time encoding for the archive timestamp.
  function dosDateTime(date) {
    const time =
      (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2));
    const day =
      (((date.getFullYear() - 1980) & 0x7f) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time: time & 0xffff, day: day & 0xffff };
  }

  const encoder = new TextEncoder();

  /**
   * Build a ZIP Blob from [{ name: string, data: Uint8Array }].
   * @returns {Blob}
   */
  function create(files) {
    const now = dosDateTime(new Date());
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = encoder.encode(file.name);
      const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
      const crc = crc32(data);

      // Local file header (30 bytes + name).
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); // signature
      local.setUint16(4, 20, true); // version needed
      local.setUint16(6, 0x0800, true); // flags: UTF-8 filename
      local.setUint16(8, 0, true); // method: STORE
      local.setUint16(10, now.time, true);
      local.setUint16(12, now.day, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true); // compressed size
      local.setUint32(22, data.length, true); // uncompressed size
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true); // extra length

      chunks.push(new Uint8Array(local.buffer), nameBytes, data);

      // Central directory header (46 bytes + name).
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); // signature
      cd.setUint16(4, 20, true); // version made by
      cd.setUint16(6, 20, true); // version needed
      cd.setUint16(8, 0x0800, true); // flags: UTF-8
      cd.setUint16(10, 0, true); // method: STORE
      cd.setUint16(12, now.time, true);
      cd.setUint16(14, now.day, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, nameBytes.length, true);
      cd.setUint16(30, 0, true); // extra length
      cd.setUint16(32, 0, true); // comment length
      cd.setUint16(34, 0, true); // disk number
      cd.setUint16(36, 0, true); // internal attrs
      cd.setUint32(38, 0, true); // external attrs
      cd.setUint32(42, offset, true); // local header offset
      central.push(new Uint8Array(cd.buffer), nameBytes);

      offset += 30 + nameBytes.length + data.length;
    }

    const centralStart = offset;
    let centralSize = 0;
    for (const c of central) centralSize += c.length;

    // End of central directory record (22 bytes).
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, centralStart, true);
    end.setUint16(20, 0, true);

    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], {
      type: 'application/zip'
    });
  }

  window.BlvckZip = { create };
})();
