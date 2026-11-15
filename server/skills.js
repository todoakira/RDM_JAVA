'use strict';
// 기술. 모든 값과 식은 3.944 서버(svMapServer.exe)와 그 패치 rm3944.dll 에서 읽은 것이다.
//
// skill00.rmi 한 칸 (data/skills.json 의 a~p) 과 서버 메모리 위치, 뜻:
//   a +0x00  0 기술, 1 특수 기술
//   c +0x20  직업 번호(문자열)            j +0x1c  직업 번호. 맞아야 쓸 수 있다 (CheckSkillRequirement 0x43c835)
//   h +0x14  명성 조건. 부호가 같고 |명성| ≥ |h| (0이면 명성 0인 사람만)  (CheckSkillRequirement 0x43c7c2)
//   i +0x18  필요 레벨 (CheckSkillRequirement 0x43c820)
//   k +0x10  마력 소모. 1,000,000,000 이상이면 (k − 10억)% × 최대 마력 (UseSkill 0x45e4e4)
//   l +0x28  사거리. 0 은 자기 자신, 10000 이상은 범위 기술 (UseSkill 0x45ed73)
//   n +0x30  효과 종류. 0 = 한 대상 공격 (UseSkillAttackSingleMop 0x44d84b 의 분기표)
//   o +0x34  위력(%) (DoSkillAttackMop 0x45f94f)
//   p +0x38  지속 시간 등 (효과 종류마다 다름)
//   d, e, f, g, m 은 아직 서버 쪽 쓰임새를 확인하지 못했다 (그림·소리 번호로 보이며 클라이언트에서 확인해야 한다)
const fs = require('fs');
const path = require('path');

const SKILLS = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'skills.json'), 'utf8')); } catch { return {}; } })();
const get = id => SKILLS[id] || null;

// 기술마다 필요한 정신력 (CMapServerServer::GetSkillSpirit 0x45fec0 의 분기표 + rm3944 NewGetSkillSpirit 0x100010ac 가 덮어쓰는 값).
// 표에 없는 기술은 0.
const SPIRIT = {
  4: 500, 5: 1000, 6: 1500, 7: 500, 8: 1000, 9: 1500, 10: 2000, 13: 500, 14: 750, 15: 750, 16: 1000, 17: 1500, 18: 1000, 19: 1500, 20: 2000,
  22: 80, 23: 230, 24: 380, 25: 530, 26: 380, 27: 530, 28: 750, 29: 750, 30: 900, 33: 100, 34: 200, 35: 100, 36: 200, 37: 300, 38: 400, 39: 300, 40: 400,
  42: 80, 43: 200, 44: 200, 45: 320, 46: 320, 47: 480, 48: 480, 52: 80, 53: 160, 54: 280, 55: 280, 56: 440, 57: 440, 58: 560,
  62: 90, 63: 180, 64: 250, 65: 440, 66: 250, 67: 440, 68: 630, 69: 630, 70: 810, 72: 110, 73: 230, 74: 450, 75: 680, 76: 450, 77: 680, 78: 900, 79: 1130, 80: 900,
  83: 230, 84: 250, 85: 450, 86: 250, 87: 450, 88: 650, 89: 650, 90: 850,
  301: 2500, 302: 2000, 303: 2500, 304: 3000, 305: 3000, 311: 2500, 312: 2000, 313: 2500, 314: 3000, 315: 3000, 321: 900, 331: 650, 332: 650, 361: 810, 371: 1130, 372: 1350, 373: 1350, 381: 850,
  // rm3944 NewGetSkillSpirit
  59: 560, 306: 3500, 307: 3500, 308: 4100, 309: 4100, 316: 4000, 317: 4000, 318: 5350, 319: 5350, 322: 1150, 323: 1150, 324: 1470, 325: 1470,
  333: 820, 334: 820, 335: 1040, 336: 1040, 49: 620, 50: 620, 341: 800, 342: 800, 60: 720, 351: 720, 352: 930, 353: 930,
  374: 1880, 375: 1880, 376: 2620, 377: 2620, 362: 1020, 363: 1020, 364: 1280, 365: 1280, 382: 1050, 383: 1050, 384: 1300, 385: 1300,
};
const spiritReq = id => SPIRIT[id] || 0;

// 명성 조건 (CheckSkillRequirement 0x43c7c2~0x43c816)
function fameOk(fame, h) {
  if (!fame) return !h;
  if (fame > 0 && h < 0) return false;
  if (fame < 0 && h > 0) return false;
  return Math.abs(fame) >= Math.abs(h);
}
// 쓸 수 있는 기술인지 (CheckSkillRequirement + InitializeSkill 의 정신력 비교. 정신력은 기본 + 장비, rm3944 NewSkillsSpiritFix 0x10003d2d)
function usable(p, id) {
  const s = get(id); if (!s) return false;
  if (p.chr !== 9) { if (!fameOk(p.fame || 0, s.h)) return false; if (p.level < s.i) return false; if (s.j !== p.chr) return false; }
  else if (p.level < s.i) return false;
  return p.spi >= spiritReq(id);
}
// 직업별 기술 목록의 첫 번호. 6번(0x47=71)과 7번(0x3d=61)만 순서가 바뀌어 있다 (InitializeSkill 0x434caa 의 표)
const firstOf = chr => chr === 6 ? 71 : chr === 7 ? 61 : chr * 10 + 1;
// 레벨·정신력·명성이 바뀔 때마다 다시 만드는 기술 목록 (CMapServerClient::InitializeSkill 0x434c80).
// 첫 번호부터 10개, 그리고 +300 부터 10개(필요 레벨이 0이 아닌 것만). 9번 직업은 정해진 목록을 쓴다.
const GM_LIST = [8, 0x12e, 0x139, 0x1e, 0x24, 0x173, 0x43, 0x59, 0x10, 0x14c, 0x50, 0x4b, 0x4f, 0x174, 0x12d, 0x53, 0x17d, 0x48, 0x55, 0x11];
function list(p) {
  if (p.chr === 9) return GM_LIST.slice();
  const out = [], b = firstOf(p.chr);
  for (let id = b; id < b + 10; id++) if (usable(p, id)) out.push(id);
  for (let id = b + 300; id < b + 310; id++) { const s = get(id); if (s && s.i && usable(p, id)) out.push(id); }
  return out;
}
// 직업별 특수 기술 (InitializeSpecialSkill 0x434f50)
const SPECIAL = [91, 101, 111, 121, 131, 141, 161, 151, 171, 151];   // 직업 번호 순서 (0x434fe8 의 표). 6번 → 161, 7번 → 151, 9번 → 151

// 마력 소모량 (UseSkill 0x45e4e4~0x45e532)
function mpCost(s, maxMp) {
  if (s.k < 1000000000) return s.k;
  const pct = s.k - 1000000000;
  if (pct >= 100) return maxMp;
  return maxMp > 10000000 ? Math.floor(maxMp / 100) * pct : Math.floor(maxMp * pct / 100);
}

// 명중 판정에 쓰는 값 (UseSkillAttackSingleMop 0x44d8c0 의 분기표와 rm3944 NewCheckForSingleAttack 0x1000300b, 0x44da6c).
//   'dex': 공격자 민첩성(기본+장비) 대 몬스터 민첩성  (0x44dab7, 0x44d918)
//   'spi': 공격자 정신력(기본+장비) 대 몬스터 정신력  (0x44da7f, 그 밖의 모든 번호)
const DEX_HIT = new Set([21, 26, 27, 29, 30, 32, 36, 37, 39, 44, 50, 61, 66, 68, 69, 88, 89, 331, 334, 365, 383, 385]);
const hitStat = id => DEX_HIT.has(id) ? 'dex' : 'spi';

// 공격 값 (UseSkillAttackSingleMop 0x44dc24 이후의 분기표 0x45139c, 0x4513e4, rm3944 NewCheckForSingleAttack2 0x10003054).
// X = 근력 공격(T+0x18) + 장비 공격 합(T+0x2c). 고유·세트 장비 보너스(T+0x30, T+0x34, T+0x38)는 아직 구현하지 않아 0.
//   기본(0x44f02b): T+0x34 + 마력 소모량
//   21·32·61 (0x44ddbd): ⌊(X + 마력 소모량 + T+0x30 + T+0x34) ÷ 2⌋
//   26 (0x44dc4e): X + ⌊X/5⌋ + T+0x30
//   27 (0x44dc74): X + ⌊X/2⌋ + T+0x30, 그리고 준 피해의 ⌊3/10⌋ 만큼 체력 회복
//   29·44 (0x44dce2, 0x44dd55): 2X + T+0x30
//   30 (0x44dcfb): 2X + ⌊X/2⌋ + T+0x30
//   36·37 (0x44dd1a): Y = X + 10 × 장비 민첩성(T+0x98) 일 때 2Y + ⌊Y/2⌋ + T+0x30
//   39 (0x44dd31): 3Y + T+0x30
//   50 (0x44dd92): 28 × ⌊X/10⌋ + T+0x30
//   66 (0x44de0b): 2X + ⌊2X/4⌋ + T+0x30, 살아 있으면 몬스터 효과 13: 지속 동안 몬스터의 공격 사거리가 1 (CMopServer::DoSkillEffect 0x4798c2, FindNextAction 0x47cfdb)
//   68 (0x44de9d): 3X + ⌊X/8⌋ + T+0x30, 준 피해의 ⌊3/10⌋ 만큼 체력·마력·기력 회복
//   69 (0x44df2e, rm3944 NewSingleAttack 0x1000318d): 3X + ⌊X/2⌋ + T+0x30
//   76 (0x44df73): 마력 소모량 + 2 × T+0x34, 준 피해의 ⌊1/2⌋ 만큼 체력 회복
// 88 이상은 아직 옮기지 않았다.
const HALF = new Set([21, 32, 61]);
const FORMULA = {
  26: X => X + Math.floor(X / 5), 27: X => X + Math.floor(X / 2), 29: X => 2 * X, 44: X => 2 * X, 30: X => 2 * X + Math.floor(X / 2),
  36: (X, Y) => 2 * Y + Math.floor(Y / 2), 37: (X, Y) => 2 * Y + Math.floor(Y / 2), 39: (X, Y) => 3 * Y,
  50: X => 28 * Math.floor(X / 10), 66: X => 2 * X + Math.floor(2 * X / 4), 68: X => 3 * X + Math.floor(X / 8), 69: X => 3 * X + Math.floor(X / 2),
};
// 준 피해(몬스터 체력이 실제로 준 만큼)에 따른 회복: [체력, 마력, 기력] 비율 분자/분모
const DRAIN = { 27: { hp: [3, 10] }, 68: { hp: [3, 10], mp: [3, 10], sp: [3, 10] }, 76: { hp: [1, 2] } };
const formulaKnown = id => id < 88;
function attackValue(id, p, cost) {
  const X = p.strAtk + p.wAtk;
  if (HALF.has(id)) return Math.floor((X + cost) / 2);
  if (FORMULA[id]) return FORMULA[id](X, X + 10 * (p.eqDex || 0));
  if (id === 76) return cost;
  return cost;
}
// 피해 = ⌊공격 값 × 위력 ÷ 100⌋ + T+0x38 (DoSkillAttackMop 0x45f935~0x45f972). 천만이 넘으면 ⌊공격 값 ÷ 100⌋ × 위력
const damage = (atk, power) => atk > 10000000 ? Math.floor(atk / 100) * power : Math.floor(atk * power / 100);

const USE_MS = 500;   // 기술은 0.5초에 한 번 (ProcessUseSkill 의 0x1f4)

// ---------- 지속 효과 ----------
// 자기에게 거는 기술 (UseSkillAlone 0x4478d0, 분기는 rm3944 NewUseSkillAlone 0x100012e8: 효과 종류 n − 1 로 표를 찾는다).
//   n=1 (0x4478f4): 모자란 체력의 절반과 지금 마력 중 작은 만큼 마력을 쓰고 그 두 배를 체력으로 채운다. 24번만은 마력 소모량을 쓰고 체력을 가득 채운다.
//   n=3 (0x44796e): 효과 1 (몸 표시 +0x1a |= 2) — 위장. 정신력이 (2 × 주인공 정신력) 이하인 몬스터가 알아보지 못한다 (CMopServer::GetCanRecognize 0x47d749)
//   n=4 (0x4479bf): 효과 0 (+0x1a |= 1) — 몬스터에게 주는 피해 + ⌊피해/5⌋ (rm3944 NewAttackBuffsFix 0x10003cb4)
//   n=5 (0x447a12): 효과 2 (+0x1a |= 4) — 총 종류 무기를 들었을 때 피해 + ⌊피해/5⌋ (CMopServer::GetAttack 0x47acf6)
// 지속 시간(초) = ⌊(기본+장비 정신력) ÷ 20⌋ + p. 효과 1은 공격하면 바로 풀린다 (ProcessUserAttack 0x43a931, UseSkillAttackSingleMop 0x44d873)
//   n=10 (0x447b36): 효과 7 (+0x1a |= 0x80) — 걸려 있던 나쁜 효과(5, 12, 14, 16, 18)를 지운다
//   n=11 (0x447bdb): 효과 8 (+0x1b |= 1) — 받는 피해 × v ÷ 100, v = 100 − min(50, 25 + ⌊장비 정신력 ÷ 100⌋)
//                    (CMapServerClient::GetAttack 0x4102a3: 방어 뺀 뒤 곱한다, 최소 1. 끝나면 v = 100, OnSkillEffectExpired 0x42cce6)
//   n=9  (0x447ae5): 효과 6 (+0x1a |= 0x40) — 몬스터에게 맞으면 체력 대신 마력이 2 × 피해 + ⌊피해/4⌋ 만큼 준다.
//                    이때는 체력이 줄지 않으므로 DP 도 차지 않는다. 마력이 0 이 되면 효과가 끝난다 (CMopServer::Attack 0x47f581~0x47f5bf)
//   n=12 (0x447c49): 효과 9 (+0x1b |= 2) — 내 자리가 아닌 곳의 아이템도 그 자리가 들어갈 수 있는 곳이면 줍는다 (ProcessGetItem 0x42edda, CrsMap::CheckEnter)
const SELF_EFFECT = { 3: 1, 4: 0, 5: 2, 9: 6, 10: 7, 11: 8, 12: 9 };
const guardValue = p => 100 - Math.min(50, 25 + Math.floor((p.eqSpi || 0) / 100));
const duration = (p, s) => Math.floor(p.spi / 20) + s.p;
// 효과 2가 붙는 무기 (분류, 번호) (CMopServer::GetAttack 0x47acff~0x47ad93)
function isGun(e) {
  if (!e) return false;
  const k = e.k, i = e.i;
  if (k === 1 && ((i >= 52 && i <= 63) || i === 137 || i === 138 || i === 240 || i === 241 || (i >= 190 && i <= 194) || (i >= 68 && i <= 72) || i === 145 || i === 146)) return true;
  return k === 6 && [84, 114, 134, 154, 174, 194].includes(i);
}
// 몬스터에게 거는 약화(n=7, 81번): 명중하면(정신력 대 몬스터 정신력, GetAttackSuccessful) 몬스터 효과 4 (+0x1a |= 0x10),
// 지속 ⌊정신력/20⌋ + p 초 (UseSkillAttackSingleMop 0x44f98b, CMopServer::DoSkillEffect 0x479771).
// 이 표시가 붙은 몬스터를 공격하면 명중률 +25 (GetAttackSuccessful 0x45fc3a, 최대 100)

// ---------- 범위 기술과 특수 기술 ----------
// 사거리(l)가 10000 이상이면 범위 기술 (UseSkill 0x45ea0b). 효과 종류가 1, 8, 11, 25, 34, 53, 62, 64 면 범위 효과(UseSkillRangeEffect), 나머지는 범위 공격(UseSkillAttackRange 0x454600).
// 범위 공격: R = l − 10000. 대상을 찍었으면 대상이 R 안에 있어야 하고(아니면 실패), 중심을 대상 자리로 옮기고 반경을 ⌊2R/3⌋ 로 줄인다(374번만 ⌊R/4⌋).
// 대상이 없으면 시전자 자리를 중심으로 반경 R. 반경 안(거리 계산은 grid.dist)이면서 중심에서 막힘이 없는 몬스터 모두가 대상 (CMopManager::FirstInDistanceEntry, 0x45b92c NoObstacle).
const RANGE_EFFECT_TYPES = new Set([1, 8, 11, 25, 34, 53, 62, 64]);
function areaOf(sid, s, hasTarget) {
  const R = s.l - 10000;
  if (!hasTarget) return { R, rad: R };
  return { R, rad: sid === 374 ? Math.floor(R / 4) : Math.trunc(2 * R / 3) };
}
// 범위 공격에서 몬스터에게 쓰는 식 (몬스터 쪽 분기 0x45b996): 효과 종류 0 의 일반 기술은 정신력 명중 판정 후 공격 값 = 마력 소모량 (0x45d057).
// 42, 46, 49, 67, 351 과 rm3944 가 따로 보내는 325, 336, 384 는 고유한 식이 있어 아직 옮기지 않았다.
const AREA_OWN = new Set([42, 46, 49, 67, 351, 325, 336, 384]);
const areaFormulaKnown = id => !AREA_OWN.has(id);
// 특수 기술(a=1): 위험 점수(DP)가 가득 차야 쓸 수 있고(UseSkill 0x45e55e, 최대 DP 와 비교) 쓰면 DP 는 0 (0x44d840, 0x454927).
// 명중 판정 없이 반드시 맞고, 공격 값 = ⌊레벨² ÷ 6⌋ + 50 (UseSkillAttackSingleMop 0x44f81c, UseSkillAttackRange 0x45d409)
const specialAttack = level => Math.floor(level * level / 6) + 50;

module.exports = { guardValue, DRAIN, RANGE_EFFECT_TYPES, areaOf, areaFormulaKnown, specialAttack, SELF_EFFECT, duration, isGun, get, list, usable, spiritReq, SPECIAL, mpCost, hitStat, attackValue, damage, USE_MS, formulaKnown };
