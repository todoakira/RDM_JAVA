// 이노큘레이터·아이템가드: 시간제 아이템 효과 13 가지 (CMapServerClient +0x4120 남은 ms, 상태 2비트씩 +0x402c·+0x402e)
//  사용 (UseItem 0x4308c3~0x430d29):
//    분류 5 의 111~120 → 종류 0~9 를 300초, 121~130 → 종류 0~9 를 600초.
//    148·150 → 종류 10, 149·151 → 종류 11 (300·600초). 분류 6 의 196 아이템가드 → 종류 12 를 600초 (이미 켜져 있으면 못 씀, 0x430cc1).
//  더하기 (0x42d5f0): 남은 시간 += 초 × 1000 (4,000,000,000 넘으면 더하지 않음).
//  상태 (0x42d625): 남은 시간 < 30000 → 1, < 60000 → 2, 그 밖 → 3, 0 → 꺼짐. 클라이언트는 이 2비트를 패킷 0xf9 로 받는다 (0x43a0f0).
//  줄이기 (OnTimer 0x42e450): 흐른 ms 만큼 줄인다 (접속해 있을 때만).
const ITEMS = {};
for (let n = 0; n < 10; n++) { ITEMS['5/' + (111 + n)] = [n, 300]; ITEMS['5/' + (121 + n)] = [n, 600]; }
ITEMS['5/148'] = [10, 300]; ITEMS['5/150'] = [10, 600]; ITEMS['5/149'] = [11, 300]; ITEMS['5/151'] = [11, 600]; ITEMS['6/196'] = [12, 600];
const N = 13, CAP = 4000000000;
const NAMES = ['이동 속도', '몬스터 방어 15', '공격력', '근력', '기골', '민첩성', '저주 무시', '대인 방어 15', '울트라 비전', '독', '정신력', '무한 기력', '아이템가드'];
const grade = ms => !ms ? 0 : ms < 30000 ? 1 : ms < 60000 ? 2 : 3;
const arr = p => (Array.isArray(p.inoc) && p.inoc.length === N) ? p.inoc : (p.inoc = new Array(N).fill(0));
const on = (p, t) => !!(p && !p.mob && Array.isArray(p.inoc) && p.inoc[t] > 0);
function itemOf(k, i) { return ITEMS[k + '/' + i] || null; }
// 쓰기: 바뀌었으면 true
function use(p, k, i) {
  const it = itemOf(k, i); if (!it) return null;
  const [t, sec] = it, a = arr(p);
  if (t === 12 && a[12] > 0) return false;
  if (a[t] >= CAP) return false;
  a[t] = a[t] + sec * 1000; return true;
}
// 시간 흐르기: 상태가 바뀐 종류 목록
function tick(p, ms) {
  if (!Array.isArray(p.inoc)) return [];
  const ch = [];
  for (let t = 0; t < N; t++) { const v = p.inoc[t]; if (!(v > 0)) continue; const g0 = grade(v); p.inoc[t] = v > ms ? v - ms : 0; if (grade(p.inoc[t]) !== g0) ch.push(t); }
  return ch;
}
const states = p => Array.isArray(p.inoc) ? p.inoc.map(grade) : new Array(N).fill(0);
module.exports = { use, tick, on, states, grade, itemOf, NAMES, N };
