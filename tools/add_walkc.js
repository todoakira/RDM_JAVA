'use strict';
// 원작 클라이언트 길찾기용 이동 가능 표(walkC)를 맵 파일(.rmm)에서 뽑아 assets/maps/N.json 에 넣는다.
//  클라이언트는 칸 값의 둘째 dword(hi) 로 판정한다 (Main.dll 0x10036a80):
//   자리 0: hi 비트 17 이 서 있으면 막힘, 아니면 비트 19 가 있어야 갈 수 있다
//   자리 1: hi 비트 18 이 서 있으면 막힘, 아니면 비트 21 이 있어야 갈 수 있다
//   맵 68 은 (hi >> 3) & 0xff 가 0xff 인 칸을 못 간다 (+0x74 표, 맵 읽기 0x100361ab)
//  walkC 는 칸마다 숫자 하나: 1 = 자리 0 가능, 2 = 자리 1 가능, 3 = 둘 다
// 사용법: node tools/add_walkc.js <Redmoon 클라이언트 폴더>
const fs = require('fs'), path = require('path');
const { findFile, parseRmmRaw } = require('./formats');
const src = process.argv[2];
const mapDir = findFile(findFile(src, 'DATAs'), 'Map');
const OUT = path.join(__dirname, '..', 'assets', 'maps');
for (const f of fs.readdirSync(OUT)) {
  const no = parseInt(f); if (!(no >= 0) || !f.endsWith('.json')) continue;
  const rf = findFile(mapDir, `Map${String(no).padStart(5, '0')}.rmm`); if (!rf) continue;
  const raw = parseRmmRaw(fs.readFileSync(rf)), j = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
  if (raw.w !== j.w || raw.h !== j.h) { console.warn('크기 다름', no); continue; }
  j.walkC = walkC(raw, no);
  fs.writeFileSync(path.join(OUT, f), JSON.stringify(j));
}
function walkC(raw, no) {
  let s = '';
  for (let i = 0; i < raw.w * raw.h; i++) {
    const hi = raw.hi[i];
    if (no === 68 && ((hi >>> 3) & 0xff) === 0xff) { s += '0'; continue; }
    s += String((!(hi >>> 17 & 1) && (hi >>> 19 & 1) ? 1 : 0) | (!(hi >>> 18 & 1) && (hi >>> 21 & 1) ? 2 : 0));
  }
  return s;
}
module.exports = { walkC };
