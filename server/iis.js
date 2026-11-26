'use strict';
// 아이템 한 칸 (IIS, 16바이트): +0 분류, +2 번호, +4 개수, +8 (내구도 등), +9~+0xd 성장 바이트 다섯.
// 우리 쪽: { k, i, n, g? } — g 는 성장 바이트 [+9, +0xa, +0xb, +0xc, +0xd] (모두 0 이면 두지 않는다)
const gOf = e => (e && e.g && e.g.some(v => v)) ? e.g : null;
// 겹칠 수 있는가: 분류·번호·성장 바이트가 모두 같아야 한다 (GetAvailableItemIndex)
function sameIIS(a, b) {
  if (!a || !b || a.k !== b.k || a.i !== b.i) return false;
  const x = gOf(a), y = gOf(b); if (!x && !y) return true; if (!x || !y) return false;
  for (let q = 0; q < 5; q++) if ((x[q] | 0) !== (y[q] | 0)) return false;
  return true;
}
function iisOf(e, n) { const o = { k: e.k, i: e.i, n: n ?? e.n }; const g = gOf(e); if (g) o.g = g.slice(); return o; }
function iisX(e) { const g = gOf(e); return g ? { g: g.slice() } : undefined; }
// 성장 등급 = 다섯 바이트의 합 (GetCurrentGrowthGrade 0x40e1c0)
const growthGrade = e => (gOf(e) || []).reduce((s, v) => s + (v | 0), 0);
const isGrowth = e => e && e.k === 6 && e.i > 99 && e.i < 0xc3;
module.exports = { sameIIS, iisOf, iisX, growthGrade, isGrowth };
