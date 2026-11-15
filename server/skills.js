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
const SPECIAL = [91, 101, 111, 121, 131, 141, 161, 171, 151];

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

// 공격 값 (UseSkillAttackSingleMop 0x44dc24 이후의 분기표, rm3944 NewCheckForSingleAttack2 0x10003054).
//   기본(0x44f02b): 고유 장비 보너스(T+0x34) + 마력 소모량
//     → 1~20, 22~25, 28, 31, 33~35, 38, 40~43, 45~49, 62~65, 67, 70~75, 77~87
//   21·32·61(0x44ddbd): (T+0x34 + T+0x30 + 장비 공격 합 + 근력 공격 + 마력 소모량) ÷ 2
// 고유·세트 장비 보너스(T+0x30, T+0x34, T+0x38)는 아직 구현하지 않아 0이다.
// 나머지 번호(26, 27, 29, 30, 36, 37, 39, 44, 50, 66, 68, 69, 76, 88 이상)는 고유한 식이 있어 아직 옮기지 않았다.
const HALF = new Set([21, 32, 61]);
const OWN = new Set([26, 27, 29, 30, 36, 37, 39, 44, 50, 66, 68, 69, 76]);
const formulaKnown = id => id < 88 && !OWN.has(id);
function attackValue(id, p, cost) {
  if (HALF.has(id)) return Math.floor((p.strAtk + p.wAtk + cost) / 2);
  return cost;
}
// 피해 = ⌊공격 값 × 위력 ÷ 100⌋ + T+0x38 (DoSkillAttackMop 0x45f935~0x45f972). 천만이 넘으면 ⌊공격 값 ÷ 100⌋ × 위력
const damage = (atk, power) => atk > 10000000 ? Math.floor(atk / 100) * power : Math.floor(atk * power / 100);

const USE_MS = 500;   // 기술은 0.5초에 한 번 (ProcessUseSkill 의 0x1f4)

module.exports = { get, list, usable, spiritReq, SPECIAL, mpCost, hitStat, attackValue, damage, USE_MS, formulaKnown };
