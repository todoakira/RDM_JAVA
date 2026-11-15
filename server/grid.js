'use strict';
// 원작의 위치 체계. 위치는 (x, y, z) 세 값이다.
//   z = 0 : 칸의 왼쪽 위 모서리   → 픽셀 (48x,      24y)
//   z = 1 : 칸의 한가운데         → 픽셀 (48x + 24, 24y + 12)
// 그래서 가로·세로로 한 걸음은 48·24 픽셀, 대각선 한 걸음은 (24, 12) 픽셀이고 대각선으로 걸을 때마다 z가 바뀐다.
// 방향은 숫자 키패드 배치(1 왼쪽아래, 2 아래, 3 오른쪽아래, 4 왼쪽, 6 오른쪽, 7 왼쪽위, 8 위, 9 오른쪽위).

// 픽셀 위치 (Staff2.dll STAFFGetDirection(PIS) 0x10006a80)
const px = p => [p.x * 48 + (p.z ? 24 : 0), p.y * 24 + (p.z ? 12 : 0)];

// a에서 b를 보는 방향. 같은 자리면 5 (Staff2.dll STAFFGetDirection(POINT) 0x100069a0)
function direction(a, b) {
  const [ax, ay] = px(a), [bx, by] = px(b);
  const dx = bx - ax, dy = by - ay, adx = Math.abs(dx), ady = Math.abs(dy);
  if (dy === 0) return dx > 0 ? 6 : dx < 0 ? 4 : 5;
  if (dx === 0) return dy > 0 ? 2 : 8;
  if (2 * ady < adx) return dx > 0 ? 6 : 4;
  if (dx > 0) return dy > 0 ? (2 * adx >= ady ? 3 : 2) : (2 * adx >= ady ? 9 : 8);
  return dy > 0 ? (2 * adx < ady ? 2 : 1) : (2 * adx < ady ? 8 : 7);
}

// 그 방향으로 한 걸음 옮긴 위치 (CNPCServer::GetNextPIS 0x483080, Staff2.dll STAFFGetNextPIS 0x10006b20)
function next(p, dir) {
  let { x, y, z } = p; const dec = v => (v > 0 ? v - 1 : 0);
  switch (dir) {
    case 1: if (z) { y++; z = 0; } else { x = dec(x); z = 1; } break;
    case 2: y++; break;
    case 3: if (z) { x++; y++; z = 0; } else z = 1; break;
    case 4: x = dec(x); break;
    case 6: x++; break;
    case 7: if (z) z = 0; else { x = dec(x); y = dec(y); z = 1; } break;
    case 8: y = dec(y); break;
    case 9: if (z) { x++; z = 0; } else { y = dec(y); z = 1; } break;
  }
  return { x, y, z };
}

// 두 위치 사이의 거리. 원작 서버가 사거리·시야·인접 판정에 모두 이 식을 쓴다 (CrsMap::NoObstacle 0x486059 등)
function dist(a, b) {
  const d = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  if (a.z === b.z) return d;
  if (!a.z && b.x > a.x && b.y > a.y) return d + 1;
  if (!b.z && a.x > b.x && a.y > b.y) return d + 1;
  return d;
}

// 막혔을 때 시계 방향으로 한 칸씩 돌려 보는 순서 (CNPCServer::MoveDir 0x482fb5 의 표)
const ROTATE = { 1: 4, 2: 1, 3: 2, 4: 7, 6: 3, 7: 8, 8: 9, 9: 6 };
// 무작위 방향 (CNPCServer::GetRandomDir 0x483180)
function randomDir() { const r = Math.floor(Math.random() * 32768) & 7; return r === 0 ? 8 : r === 5 ? 9 : r; }
// 공격 가능 방향 판정에 쓰는 시계 방향 순서 (CMopServer::GetCanAttackDir 0x47d560)
const CLOCKWISE = [8, 9, 6, 3, 2, 1, 4, 7, 8, 9, 6, 3, 2, 1, 4];
const same = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;
const DIRS = [1, 2, 3, 4, 6, 7, 8, 9];

module.exports = { px, direction, next, dist, ROTATE, randomDir, CLOCKWISE, same, DIRS };
