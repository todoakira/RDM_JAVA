'use strict';
// 클라이언트 맵(.rmm) 머리의 클릭 영역을 assets/maps/<번호>.json 의 rects 에 넣는다.
// 영역은 [이벤트 번호, 왼쪽, 위, 오른쪽, 아래] (맵 픽셀). 번호 1 = 게시판(이벤트 종류 2), 2 = 우체통(종류 4) 등.
// 클라이언트는 이 영역을 누르면 서버에 그 이벤트 번호를 알린다 (서버 ProcessInformEvent 0x41ed70).
// 파일의 영역 개수 뒤쪽에는 빈 칸(번호 0)이나 쓰레기 값이 들어 있는 맵이 있어, 번호가 1 이상이고 맵 안에 있는 것만 쓴다.
// 사용: node tools/map_rects.js <클라이언트 datas 폴더>
const fs = require('fs'), path = require('path');
const { parseRmm } = require('./formats');
const src = process.argv[2]; if (!src) { console.log('사용: node tools/map_rects.js <datas 폴더>'); process.exit(1); }
const dir = path.join(__dirname, '..', 'assets', 'maps');
function rectsOf(r) {
  return r.rects.filter(q => q.id > 0 && q.x1 >= 0 && q.y1 >= 0 && q.x2 > q.x1 && q.y2 > q.y1 && q.x2 <= r.w * 48 && q.y2 <= r.h * 24).map(q => [q.id, q.x1, q.y1, q.x2, q.y2]);
}
let n = 0;
const mapDir = fs.readdirSync(src).find(d => d.toLowerCase() === 'map');
for (const f of fs.readdirSync(path.join(src, mapDir))) {
  const m = /^Map(\d+)\.rmm$/i.exec(f); if (!m) continue;
  const out = path.join(dir, Number(m[1]) + '.json'); if (!fs.existsSync(out)) continue;
  const rects = rectsOf(parseRmm(fs.readFileSync(path.join(src, mapDir, f))));
  const j = JSON.parse(fs.readFileSync(out, 'utf8'));
  if (JSON.stringify(j.rects || []) === JSON.stringify(rects)) continue;
  j.rects = rects; fs.writeFileSync(out, JSON.stringify(j)); n++;
}
console.log(`클릭 영역을 넣은 맵 ${n}개`);
module.exports = { rectsOf };
