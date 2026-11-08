// 最小限のEXIF書き込み（撮影日時・タイムゾーン・GPS）
// JPEGのSOI直後にAPP1(Exif)を挿入する。写真アプリはこの日時と位置を読み取る。
(function (global) {
  'use strict';

  const enc = new TextEncoder();
  const v = {
    ascii(s) { const b = enc.encode(s); const o = new Uint8Array(b.length + 1); o.set(b); return { type: 2, count: o.length, bytes: o }; },
    byte(...a) { return { type: 1, count: a.length, bytes: new Uint8Array(a) }; },
    undef(s) { const b = enc.encode(s); return { type: 7, count: b.length, bytes: b }; },
    short(...a) { const o = new Uint8Array(a.length * 2); const d = new DataView(o.buffer); a.forEach((x, i) => d.setUint16(i * 2, x)); return { type: 3, count: a.length, bytes: o }; },
    long(...a) { const o = new Uint8Array(a.length * 4); const d = new DataView(o.buffer); a.forEach((x, i) => d.setUint32(i * 4, x)); return { type: 4, count: a.length, bytes: o }; },
    rational(...pairs) { const o = new Uint8Array(pairs.length * 8); const d = new DataView(o.buffer); pairs.forEach(([n, den], i) => { d.setUint32(i * 8, n); d.setUint32(i * 8 + 4, den); }); return { type: 5, count: pairs.length, bytes: o }; },
  };

  function ifdSize(entries) {
    let s = 2 + 12 * entries.length + 4;
    for (const e of entries) { const l = e.v.bytes.length; if (l > 4) s += l + (l & 1); }
    return s;
  }

  function writeIFD(dv, u8, off, entries, next) {
    entries.sort((a, b) => a.tag - b.tag);
    dv.setUint16(off, entries.length);
    let p = off + 2;
    let data = off + 2 + 12 * entries.length + 4;
    for (const e of entries) {
      dv.setUint16(p, e.tag); dv.setUint16(p + 2, e.v.type); dv.setUint32(p + 4, e.v.count);
      const b = e.v.bytes;
      if (b.length <= 4) u8.set(b, p + 8);
      else { dv.setUint32(p + 8, data); u8.set(b, data); data += b.length + (b.length & 1); }
      p += 12;
    }
    dv.setUint32(p, next);
  }

  const pad = (n, l = 2) => String(n).padStart(l, '0');
  function exifDate(d) {
    return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  function tzOffset(d) {
    const m = -d.getTimezoneOffset(); const s = m >= 0 ? '+' : '-'; const a = Math.abs(m);
    return `${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
  }
  function dms(deg) {
    const a = Math.abs(deg); const d = Math.floor(a); const mf = (a - d) * 60; const m = Math.floor(mf);
    const s = Math.round((mf - m) * 60 * 10000);
    return [[d, 1], [m, 1], [s, 10000]];
  }

  // meta: { date: Date, width, height, gps?: {lat, lon, alt, acc, time}, software }
  function buildApp1(meta) {
    const d = meta.date;
    const ifd0 = [
      { tag: 0x0112, v: v.short(1) },               // Orientation
      { tag: 0x011A, v: v.rational([72, 1]) },      // XResolution
      { tag: 0x011B, v: v.rational([72, 1]) },      // YResolution
      { tag: 0x0128, v: v.short(2) },               // ResolutionUnit
      { tag: 0x0131, v: v.ascii(meta.software || 'SilentCam') },
      { tag: 0x0132, v: v.ascii(exifDate(d)) },     // DateTime
      { tag: 0x8769, v: v.long(0) },                // ExifIFD pointer
    ];
    const exif = [
      { tag: 0x9000, v: v.undef('0232') },          // ExifVersion
      { tag: 0x9003, v: v.ascii(exifDate(d)) },     // DateTimeOriginal
      { tag: 0x9004, v: v.ascii(exifDate(d)) },     // DateTimeDigitized
      { tag: 0x9010, v: v.ascii(tzOffset(d)) },     // OffsetTime
      { tag: 0x9011, v: v.ascii(tzOffset(d)) },     // OffsetTimeOriginal
      { tag: 0x9012, v: v.ascii(tzOffset(d)) },     // OffsetTimeDigitized
      { tag: 0x9291, v: v.ascii(pad(d.getMilliseconds(), 3)) }, // SubSecTimeOriginal
      { tag: 0xA002, v: v.long(meta.width) },       // PixelXDimension
      { tag: 0xA003, v: v.long(meta.height) },      // PixelYDimension
    ];
    let gps = null;
    if (meta.gps && isFinite(meta.gps.lat) && isFinite(meta.gps.lon)) {
      const g = meta.gps;
      const t = new Date(g.time || d.getTime());
      gps = [
        { tag: 0x0000, v: v.byte(2, 3, 0, 0) },                 // GPSVersionID
        { tag: 0x0001, v: v.ascii(g.lat >= 0 ? 'N' : 'S') },
        { tag: 0x0002, v: v.rational(...dms(g.lat)) },
        { tag: 0x0003, v: v.ascii(g.lon >= 0 ? 'E' : 'W') },
        { tag: 0x0004, v: v.rational(...dms(g.lon)) },
        { tag: 0x0007, v: v.rational([t.getUTCHours(), 1], [t.getUTCMinutes(), 1], [t.getUTCSeconds(), 1]) },
        { tag: 0x001D, v: v.ascii(`${t.getUTCFullYear()}:${pad(t.getUTCMonth() + 1)}:${pad(t.getUTCDate())}`) },
      ];
      if (g.alt != null && isFinite(g.alt)) {
        gps.push({ tag: 0x0005, v: v.byte(g.alt < 0 ? 1 : 0) });
        gps.push({ tag: 0x0006, v: v.rational([Math.round(Math.abs(g.alt) * 100), 100]) });
      }
      if (g.acc != null && isFinite(g.acc)) gps.push({ tag: 0x001F, v: v.rational([Math.round(g.acc * 100), 100]) });
      ifd0.push({ tag: 0x8825, v: v.long(0) });     // GPS IFD pointer
    }

    const ifd0Off = 8;
    const exifOff = ifd0Off + ifdSize(ifd0);
    const gpsOff = exifOff + ifdSize(exif);
    const total = gpsOff + (gps ? ifdSize(gps) : 0);
    ifd0.find(e => e.tag === 0x8769).v = v.long(exifOff);
    if (gps) ifd0.find(e => e.tag === 0x8825).v = v.long(gpsOff);

    const tiff = new Uint8Array(total);
    const dv = new DataView(tiff.buffer);
    tiff[0] = 0x4D; tiff[1] = 0x4D; dv.setUint16(2, 42); dv.setUint32(4, ifd0Off);
    writeIFD(dv, tiff, ifd0Off, ifd0, 0);
    writeIFD(dv, tiff, exifOff, exif, 0);
    if (gps) writeIFD(dv, tiff, gpsOff, gps, 0);

    const segLen = 2 + 6 + tiff.length;
    const app1 = new Uint8Array(2 + segLen);
    app1[0] = 0xFF; app1[1] = 0xE1; app1[2] = segLen >> 8; app1[3] = segLen & 0xFF;
    app1.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4); // "Exif\0\0"
    app1.set(tiff, 10);
    return app1;
  }

  // JPEG Blob にEXIFを付けて返す（既存のAPP0/APP1 Exifは除去、ICCプロファイル等は保持）
  async function addExif(jpegBlob, meta) {
    const src = new Uint8Array(await jpegBlob.arrayBuffer());
    if (src[0] !== 0xFF || src[1] !== 0xD8) return jpegBlob;
    const keep = [];
    let i = 2;
    while (i + 4 <= src.length && src[i] === 0xFF) {
      const marker = src[i + 1];
      if (marker === 0xDA || marker < 0xE0 || marker > 0xEF) break; // APPn以外に到達
      const len = (src[i + 2] << 8) | src[i + 3];
      const isExif = marker === 0xE1 && src[i + 4] === 0x45 && src[i + 5] === 0x78;
      if (marker !== 0xE0 && !isExif) keep.push(src.subarray(i, i + 2 + len));
      i += 2 + len;
    }
    const app1 = buildApp1(meta);
    const parts = [new Uint8Array([0xFF, 0xD8]), app1, ...keep, src.subarray(i)];
    return new Blob(parts, { type: 'image/jpeg' });
  }

  global.Exif = { addExif, buildApp1 };
})(window);
