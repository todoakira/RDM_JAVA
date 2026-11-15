'use strict';
// 원작 서버(3.944 svMapServer.exe)를 역분석해 옮긴 계산식.
// 각 함수 옆의 주소는 실행 파일 안에서 해당 계산이 있는 위치다.
const fl = Math.floor;
const rand100 = () => fl(Math.random() * 100);

// 최대 체력: 기골 기준. CMapServerClient::InitializeHPMax (0x4346c0), 몬스터는 CMopInfoFile::ReadMopInfo (0x476543)
const hpMax = pow => fl(pow / 15) * fl(pow / 10) + 50;
// 최대 마력: 정신력 기준. InitializeMPMax (0x434780)
const mpMax = spi => spi <= 20000 ? fl(spi / 15) * fl(spi / 10) + 50 : spi * 273 - 2792950;

// 공격력: 근력 기준. InitializeAttack (0x4348c0), 몬스터는 CMopInfo::LoadMopInfo (0x475e06)
function attack(str) {
  if (str < 1000) return 8 + fl(str * 0.28);
  if (str <= 10000) { const t = fl(str / 10); return fl(t * t * t / 3500) + 10; }
  if (str < 13000) { const a = fl(str / 10), b = fl(str / 100); return fl(b * a * a / 350) + 10; }
  return str * 145 - 1257276;
}
// 최소 피해 비율(%): 민첩성이 근력보다 높을수록 피해가 고르게 나온다. InitializeAttackMinPercentage (0x434a70)
function minPct(str, dex) {
  const t = str + dex; if (!t) return 75;
  return Math.min(100, dex >= str ? 75 + fl(75 * (dex - str) / t) : 75 - fl(75 * (str - dex) / t));
}
// 명중률(%). 원래 식(GetAttackSuccessful 0x45fab0: 50 ± 50·|a−d|/(a+d))은 3.944 서버에서
// rm3944.dll 의 NewAccuracyFix(0x1000374a)가 덮어써서 a ÷ d × 150 (FPU 반올림, 최대 100)이 된다. 일반 공격·기술·몬스터 공격 모두 이 함수를 쓴다.
// 성공 여부: rand() % 100 이 이 값 이하면 명중 (NewMasterEffect 0x100024d9 뒤의 비교 0x45fc7c)
const roundEven = v => { const f = Math.floor(v), r = v - f; return r > 0.5 || (r === 0.5 && f % 2) ? f + 1 : f; };
function hitPct(a, d) {
  if (!d) return 100;                                    // 0으로 나누면 FPU 정수 변환이 0x80000000 이 되어 부호 없는 비교에서 100으로 잘린다
  return Math.min(100, roundEven(a / d * 150));
}
// 치명타 확률(%): 피해 2배, 반드시 명중. DoAttackMop (0x46f649), CMopServer::Attack (0x47f02c)
function critPct(a, d) {
  const t = a + d; if (!t) return 10;
  const v = a > d ? 10 + fl(fl(50 * (a - d) / t) / 3) : 10 - fl(fl(50 * (d - a) / t) / 3);
  return Math.max(0, Math.min(100, v));
}
// 피해 굴림: 공격력의 (최소비율~100)% 중 무작위. DoAttackMop (0x46f8d1), CMopServer::Attack (0x47f50a)
const rollDamage = (atk, min) => fl(atk * (fl(Math.random() * (101 - min)) + min) / 100);

// 레벨별 필요 경험치 표. CMapServerServer 생성자 (0x4422f9)
const expTable = new Array(1001).fill(0);
expTable[1] = 20;
for (let L = 2; L <= 1000; L++) {
  const m = L % 100;
  const k = m >= 95 ? 2 * m - 187 : (L >= 100 && m <= 3) ? 9 - 2 * m : 1;
  expTable[L] = expTable[L - 1] + k * L * L;
}
for (let L = 900; L < 999; L++) expTable[L] *= 8;

// 능력치 1점을 올릴 때 직업별로 오르는 양 [근력, 정신력, 민첩성, 기골]. CMapServerClient 생성자 (0x40ad94)
const classGain = [
  [8, 20, 10, 10],   // 0 필라르
  [10, 18, 8, 12],   // 1 아즐라
  [15, 10, 10, 13],  // 2 사다드
  [14, 10, 14, 10],  // 3 데스티노
  [15, 8, 10, 15],   // 4 (RMA 클라이언트 표기: 박진희)
  [14, 10, 12, 12],  // 5 캐논
  [10, 15, 13, 10],  // 6 (RMA 클라이언트 표기: 한지화)
  [12, 12, 12, 12],  // 7 루나레나
  [8, 10, 20, 10],   // 8 라비타
];
const BASE_STAT = 10;                                   // 능력치 시작값. InitBonusPoint (0x428e14)
const bonusForLevelUp = lv => lv % 100 === 0 ? 3 : 2;   // 레벨업 때 받는 점수. DoLevelUp (0x437fdc)
const bonusTotal = lv => lv * 2 + fl(lv / 100);         // 해당 레벨까지의 총 점수. InitBonusPoint (0x428e5f)
const EXP_CAP_DIV = 10;                                 // 한 마리로 얻는 경험치는 필요 경험치의 1/10까지. CMopServer::Dead (0x478fe7)
const MAX_LEVEL = 1000;
const MOB_STEP_MS = 200;                                // 몬스터 대기 단위. 실제로는 처리 주기 250ms 로 올림되어 쓰인다 (world.js 의 MOB_TICK, InitializeMopInstance 0x479479)
const PLAYER_DEX_DEFENCE = 1.2;                         // 몬스터 공격을 피할 때 주인공 민첩성은 1.2배로 계산. CMopServer::Attack (0x47f448)

// 강화형 몬스터(배치표의 패턴 5): 정신력 1.5배, 민첩성 3배, 기골 4배, 경험치 2.5배, 공격력 2배. CMopServer::LoadMop (0x4774ca)
function mobStats(info, pattern) {
  let { str, spi, dex, con: pow, exp } = info, atk = attack(str);
  if (pattern === 5) { spi += fl(spi / 2); dex *= 3; pow *= 4; exp = fl(exp / 2) + exp * 2; atk *= 2; }
  return { str, spi, dex, pow, exp, atk, maxHp: hpMax(pow), minPct: minPct(str, dex) };
}

// ----- 소지품, 회복, 사망 -----
const INV_SLOTS = 100;                                  // 소지품 칸 수. GetAvailableItemIndex (0x431b97)
const MONEY_MAX = 4000000000;                           // 돈 한도. ProcessGetItem (0x42ee3a)
// 들 수 있는 무게: 3 × ⌊√(근력×10)⌋ − 10. InitializeRemainWeight (0x4350cc)
const weightMax = str => 3 * fl(Math.sqrt(str * 10)) - 10;
const REGEN_MS = 10000;                                 // 자연 회복 주기. CMapServerClient::OnTimer (0x43e3fc)
const SP_MAX = 2000;                                    // 기력 한도. OnTimer (0x43e4d4)
// 기력 회복량: 걸은 걸음 수가 40을 넘으면 0. OnTimer (0x43e427~0x43e4bb)
const spRegen = (pow, steps) => { if (steps > 40) return 0; const r = fl(Math.sqrt(pow) + 0.5); return r * 4 + 300 - fl((r + 75) * steps * 4 / 40); };
// 달릴 때 한 걸음마다 드는 기력: 2000 ÷ (8 × √민첩성). ProcessUserMoving (0x43dbe5)
const runCost = dex => fl(2000 / (Math.sqrt(Math.max(1, dex)) * 8) + 0.5);
// 기력이 가득 찼을 때 체력, 그다음 마력을 최대치의 1/10씩 회복. 필라르(직업 0)는 체력 2배. OnTimer (0x43e50d, 0x43e5db)
const hpRegen = (maxHp, cls) => fl(maxHp / 10) * (cls === 0 ? 2 : 1);
const mpRegen = (maxMp, onRestTile) => fl(maxMp / 10) * (onRestTile ? 2 : 1);
const EV_MP_REST = 21;                                  // 이 이벤트 칸 위에서는 마력 회복 2배. OnTimer (0x43e5c2)
// 몬스터에게 죽으면 경험치가 절반이 된다. CMapServerClient::Dead (0x43ae9a)
const expAfterDeath = exp => fl(exp * 5 / 10);
// 죽을 때 칸마다 아이템을 떨어뜨릴 확률(%): 레벨 15 이하는 0, 그 위는 레벨÷25 (500 이상은 20). GetItemDropPercentage (0x43b4e0), Dead (0x43aebc)
const deathDropPct = lv => lv <= 15 ? 0 : Math.min(100, lv < 500 ? fl(lv / 25) : 20);
const RESPAWN = { map: 21, x: 100, y: 100 };           // 부활 위치: 맵 21 (100,100). ResetUserData (0x43bf56)

module.exports = { INV_SLOTS, MONEY_MAX, weightMax, REGEN_MS, SP_MAX, spRegen, runCost, hpRegen, mpRegen, EV_MP_REST, expAfterDeath, deathDropPct, RESPAWN, hpMax, mpMax, attack, minPct, hitPct, critPct, rollDamage, rand100, expTable, classGain, BASE_STAT, bonusForLevelUp, bonusTotal, EXP_CAP_DIV, MAX_LEVEL, MOB_STEP_MS, PLAYER_DEX_DEFENCE, mobStats };
