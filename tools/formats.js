'use strict';
// 레드문 클라이언트 파일 형식 해독기 (LST / RMD / RLE / RMM) 와 PNG 저장기
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const kr = new TextDecoder('euc-kr');

class Reader {
  constructor(buf, pos = 0) { this.b = buf; this.p = pos; }
  i32() { const v = this.b.readInt32LE(this.p); this.p += 4; return v; }
  u32() { const v = this.b.readUInt32LE(this.p); this.p += 4; return v; }
  i16() { const v = this.b.readInt16LE(this.p); this.p += 2; return v; }
  u8() { return this.b[this.p++]; }
  bytes() { const n = this.u8(); const v = this.b.subarray(this.p, this.p + n); this.p += n; return v; }
  str() { return this.bytes().toString('latin1'); }
  strKr() { return kr.decode(this.bytes()); }
  get left() { return this.b.length - this.p; }
}

// 대소문자가 섞인 파일명(Tle00014.rle / tle00000.rle)을 찾기 위한 색인
const dirCache = new Map();
function findFile(dir, name) {
  if (!dirCache.has(dir)) {
    const m = new Map();
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) m.set(f.toLowerCase(), f);
    dirCache.set(dir, m);
  }
  const f = dirCache.get(dir).get(name.toLowerCase());
  return f ? path.join(dir, f) : null;
}

// LST: 그림 id -> (RLE 파일 번호, 파일 안 순번)
function parseLst(buf) {
  const r = new Reader(buf);
  r.str(); const ver = r.str(); r.i32(); const n = r.i32();
  const out = new Map();
  for (let k = 0; k < n; k++) {
    const name = r.str(); const id = r.i32(); const file = r.i32(); const index = r.i32();
    if (ver !== '1.0') r.i32();
    out.set(id, { name, file, index });
  }
  return out;
}

// RMD: 스프라이트 정의. 항목(entry)마다 여러 겹(layer)의 그림과 배치 정보, 그리고 동작(애니메이션) 표
function parseRmd(buf) {
  const r = new Reader(buf);
  r.str(); r.i32(); r.i32(); r.i32();
  // 이름 뒤 두 값: 움직임 장 수, 한 장에 든 칸 수 (Main.dll 0x100363e0: 칸 번호 + 칸 수 × 움직임 표 값)
  const name = r.strKr(), frameCount = r.i32(), stride = r.i32(); r.bytes();
  const n = r.i32();
  const ents = [];
  for (let k = 0; k < n; k++) {
    const layers = [];
    const m = r.i32();
    for (let j = 0; j < m; j++) {
      const v = []; for (let q = 0; q < 11; q++) v.push(r.i32());
      const ids = []; for (let q = 0; q < v[10]; q++) ids.push(r.i32());
      layers.push({ sx1: v[0], sy1: v[1], sx2: v[2], sy2: v[3], ex: v[4], ey: v[5], dx: v[6], dy: v[7], z: v[8], rt: v[9], ids });
    }
    ents.push(layers);
  }
  const seqs = [];
  if (r.left >= 4) {
    const sn = r.i32();
    for (let k = 0; k < sn && r.left >= 4; k++) {
      const fn = r.i32(); const fr = [];
      for (let q = 0; q < fn; q++) fr.push(r.i16());
      seqs.push(fr);
    }
  }
  // 소리: 개수(u32) 뒤로 [소리 번호 u32, 재생할 장면 u8] (ExStage.dll 0x10007eca~0x10007f5f, SOUND_SET{버퍼, 장면}).
  // 칸 번호가 동작 번호다. 소리 번호는 RLEs/SND/snd<번호>.rms, 0 은 소리 없음
  const sounds = {};
  if (r.left >= 4) {
    const cnt = r.i32();
    for (let k = 0; k < cnt && r.left >= 5; k++) { const no = r.i32(), fr = r.u8(); if (no) sounds[k] = [no, fr]; }
  }
  return { name, ents, seqs, sounds, frameCount, stride };
}

// RLE: 16비트(RGB565) 줄길이 압축 그림 묶음
class RleFile {
  constructor(file) {
    this.b = fs.readFileSync(file);
    const r = new Reader(this.b, 14);
    r.i32(); this.count = r.i32(); this.offs = [];
    for (let k = 0; k < this.count; k++) this.offs.push(r.i32());
  }
  decode(k) {
    const o = this.offs[k];
    if (!o) return null;
    const b = this.b;
    const ox = b.readInt32LE(o + 4), oy = b.readInt32LE(o + 8), w = b.readInt32LE(o + 12), h = b.readInt32LE(o + 16);
    if (w <= 0 || h <= 0) return null;
    const rgba = Buffer.alloc(w * h * 4);
    let p = o + 36, x = 0, y = 0;
    const end = b.length;
    while (y < h && p < end) {
      const op = b[p++];
      if (op === 1) {
        const n = b.readInt32LE(p); p += 4;
        for (let q = 0; q < n; q++, x++, p += 2) {
          if (x < 0 || x >= w) continue;
          const c = b[p] | (b[p + 1] << 8); const t = (y * w + x) * 4;
          const R = c >> 11, G = (c >> 5) & 63, B = c & 31;
          rgba[t] = (R << 3) | (R >> 2); rgba[t + 1] = (G << 2) | (G >> 4); rgba[t + 2] = (B << 3) | (B >> 2); rgba[t + 3] = 255;
        }
      } else if (op === 2) { x += b.readInt32LE(p) >> 1; p += 4; }
      else if (op === 3) y++;
      else if (op === 0) break;
      else throw new Error('알 수 없는 RLE 명령 ' + op);
    }
    return { ox, oy, w, h, rgba };
  }
}

// RMM: 맵. 칸마다 8바이트(바닥 타일, 오브젝트 조각, 이동 가능 여부, 이벤트 번호)
function parseRmm(buf) {
  const r = new Reader(buf);
  r.str(); const w = r.i32(), h = r.i32(); const name = r.strKr(); const no = r.i32();
  const rn = r.i32(); const rects = [];
  for (let k = 0; k < rn; k++) rects.push({ id: r.i16(), x1: r.i32(), y1: r.i32(), x2: r.i32(), y2: r.i32() });
  const tiles = [];
  for (let k = 0; k < w * h; k++) {
    const lo = r.u32(), hi = r.u32();
    tiles.push({
      tleFile: lo >>> 23, tleIdx: (lo >>> 13) & 0x3ff,
      objFile: (lo >>> 2) & 0x7ff, objIdx: hi >>> 23,
      walk: (hi >>> 19) & 15,          // 왼쪽 반칸(비트0-1), 오른쪽 반칸(비트2-3). 0이면 막힘
      event: (hi & 0x7ffff) >>> 3,
    });
  }
  return { w, h, name, no, rects, tiles };
}

// ---- PNG 저장 ----
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { Reader, findFile, parseLst, parseRmd, RleFile, parseRmm, encodePng };
