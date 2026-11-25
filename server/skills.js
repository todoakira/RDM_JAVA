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
// X = 근력 공격(T+0x18) + 장비 공격 합(T+0x2c). T+0x30·0x34·0x38 은 장비 효과(server/equip.js)의 x·s·k (p.atkExtra, p.skSpi, p.skDmg).
//   기본(0x44f02b): T+0x34 + 마력 소모량
//   21·32·61 (0x44ddbd): ⌊(X + 마력 소모량 + T+0x30 + T+0x34) ÷ 2⌋
//   26 (0x44dc4e): X + ⌊X/5⌋ + T+0x30
//   27 (0x44dc74): X + ⌊X/2⌋ + T+0x30, 그리고 준 피해의 ⌊3/10⌋ 만큼 체력 회복
//   29·44 (0x44dce2, 0x44dd55): 2X + T+0x30
//   30 (0x44dcfb): 2X + ⌊X/2⌋ + T+0x30
//   36·37 (0x44dd1a): Y = X + 10 × 기본 민첩성(USERDB+0x98 = 사용자 +0x4368, 장비를 뺀 값) 일 때 2Y + ⌊Y/2⌋ + T+0x30
//   39 (0x44dd31): 3Y + T+0x30
//   50 (0x44dd92): 28 × ⌊X/10⌋ + T+0x30
//   66 (0x44de0b): 2X + ⌊2X/4⌋ + T+0x30, 살아 있으면 몬스터 효과 13: 지속 동안 몬스터의 공격 사거리가 1 (CMopServer::DoSkillEffect 0x4798c2, FindNextAction 0x47cfdb)
//   68 (0x44de9d): 3X + ⌊X/8⌋ + T+0x30, 준 피해의 ⌊3/10⌋ 만큼 체력·마력·기력 회복
//   69 (0x44df2e, rm3944 NewSingleAttack 0x1000318d): 3X + ⌊X/2⌋ + T+0x30
//   76 (0x44df73): 마력 소모량 + 2 × T+0x34, 준 피해의 ⌊1/2⌋ 만큼 체력 회복
// 88 이상 (rm3944 NewCheckForSingleAttack2 0x10003054 가 0x44dde1 에서 갈라 보낸다):
//   306, 316, 373, 377: 기본(마력 소모량)으로 떨어진다 (0x44e782 → 0x44f02b, 0x44f023 → 0x44f02b)
//   331 (0x44e78e): ⌊(X + 10 × 기본 민첩성) ÷ 2⌋ × 7 + T+0x30
//   334 (0x44efb6): 4X + T+0x30. 맞은 몬스터가 살아 있으면 몬스터 효과 14 를 3초 (CMopServer::DoSkillEffect 0x479630 case 0xe)
//   365 (rm3944 0x100030df → 69번 식 자리): 7X + T+0x30
//   88, 89, 383 은 활·화살 식(무기 정보의 필요 레벨 구간마다 다른 식, 0x44dfc6·0x44e7e1·0x44f063), 385 는 rm3944 0x1000311a 의 식 (아래 bowValue)
const HALF = new Set([21, 32, 61]);
const FORMULA = {
  26: X => X + Math.floor(X / 5), 27: X => X + Math.floor(X / 2), 29: X => 2 * X, 44: X => 2 * X, 30: X => 2 * X + Math.floor(X / 2),
  36: (X, Y) => 2 * Y + Math.floor(Y / 2), 37: (X, Y) => 2 * Y + Math.floor(Y / 2), 39: (X, Y) => 3 * Y,
  331: (X, Y) => Math.floor(Y / 2) * 7, 334: X => 4 * X, 365: X => 7 * X,
  50: X => 28 * Math.floor(X / 10), 66: X => 2 * X + Math.floor(2 * X / 4), 68: X => 3 * X + Math.floor(X / 8), 69: X => 3 * X + Math.floor(X / 2),
};
// 준 피해(몬스터 체력이 실제로 준 만큼)에 따른 회복: [체력, 마력, 기력] 비율 분자/분모
const DRAIN = { 27: { hp: [3, 10] }, 68: { hp: [3, 10], mp: [3, 10], sp: [3, 10] }, 76: { hp: [1, 2] } };
// 활 기술 (88 0x44dfc6, 89 0x44e7e1, 383 0x44f063, 돌진 382 0x45308c): 나눗수 D (88·89 1000, 383 950, 382 900)
//   B(v) = ⌊3 × (⌊v / D⌋ + 1) × 무기 공격 / 2⌋. 기본 = B(기본 민첩성) + T+0x30
//   든 무기의 아이템 정보(CrItemInfo::Get, 무기 번호가 양수면 분류 1, 음수면 6)가 있으면 싸움 민첩성 S 로:
//     등급(+0x54) 1·3 → ⌊7B(S)/20⌋ + 5000 / 필요 레벨(+0x30) 450~499 → ⌊3B(S)/4⌋ + 1000 / 500~549 → ⌊3B(S)/5⌋ + 2000
//     550~599 → ⌊3(⌊S/D⌋+1)·무기 공격/4⌋ + 3000 / 600 이상 → ⌊7B(S)/20⌋ + 4000 / 450 미만 → 기본
//   385 (rm3944 0x1000311a): ⌊7 × ⌊3 × (⌊S'/1000⌋ + 10) × 무기 공격 / 2⌋ / 20⌋ + 5000, S' = 장비 민첩성 + (+0x4230) + 기본 민첩성
const BOW_DIV = { 88: 1000, 89: 1000, 383: 950, 382: 900 };
function bowValue(id, p, fightDex, wInfo) {
  const w = p.wAtk || 0;
  if (id === 385) { const S = (p.eqDex || 0) + (p.fxPow17 || 0) + (p.bDex || 0); return Math.floor(7 * Math.floor(3 * (Math.floor(S / 1000) + 10) * w / 2) / 20) + 5000; }
  const D = BOW_DIV[id], B = v => Math.floor(3 * (Math.floor(v / D) + 1) * w / 2);
  if (!wInfo) return B(p.bDex || 0);
  const S = fightDex, L = wInfo.req;
  if (wInfo.grade === 1 || wInfo.grade === 3) return Math.floor(7 * B(S) / 20) + 5000;
  if (L >= 450 && L < 500) return Math.floor(3 * B(S) / 4) + 1000;
  if (L >= 500 && L < 550) return Math.floor(3 * B(S) / 5) + 2000;
  if (L >= 550 && L < 600) return Math.floor(3 * (Math.floor(S / D) + 1) * w / 4) + 3000;
  if (L >= 600) return Math.floor(7 * B(S) / 20) + 4000;
  return B(p.bDex || 0);
}
const formulaKnown = id => true;
function attackValue(id, p, cost) {
  const X = p.strAtk + p.wAtk, T30 = p.atkExtra || 0, T34 = p.skSpi || 0;
  if (HALF.has(id)) return Math.floor((X + cost + T30 + T34) / 2);
  if (FORMULA[id]) return FORMULA[id](X, X + 10 * (p.bDex || 0)) + T30;   // USERDB+0x98 = 장비를 뺀 민첩성 (사용자 +0x4368)
  if (id === 76) return cost + 2 * T34;
  return cost + T34;
}
// 피해 = ⌊공격 값 × 위력 ÷ 100⌋ + T+0x38 (DoSkillAttackMop 0x45f935~0x45f972). 천만이 넘으면 ⌊공격 값 ÷ 100⌋ × 위력
const damage = (atk, power, plus = 0) => (atk > 10000000 ? Math.floor(atk / 100) * power : Math.floor(atk * power / 100)) + plus;

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
//   n=27 (0x447d8c): 효과 19 (+0x1c |= 8) — 숨기. 이미 숨어 있으면 풀린다. 지속 ⌊정신력 ÷ 5⌋ + p 초. 공격하면 풀린다 (ProcessUserAttack 0x43a8e8).
//                    원작에서 숨기를 따지는 곳은 주인공끼리의 공격(DoAttack)뿐이라, 몬스터와의 싸움에는 영향이 없다.
//   n=28 (0x447e11): 효과 20 (+0x1c |= 0x10) — 공포. 4칸 안의, 정신력이 (2 × 주인공 정신력) 이하인 몬스터가 달아난다
//   n=29 (0x447e62): 효과 21 (+0x1c |= 0x20) — 유인. 8칸 안의 몬스터가 다가온다
//   (공포·유인: CMopServer::FindNextAction 0x47d06e~0x47d31b, DoNextAction 0x47c13f. 몬스터 그림 종류 0x62 는 걸리지 않는다)
//   n=6  (0x447a65): 효과 3 (+0x1a |= 8) — Hasten. 서버에서는 예약된 공격의 지연을 반으로 줄이는 데만 쓴다 (IsNormalAttackSpeed 0x4400c0, ProcessCSAttack 0x45fe3a).
//                    이동 속도는 클라이언트가 바꾸는데 그 값은 아직 찾지 못해, 지금은 효과 표시만 된다
//   n=13 (0x447c9a): 효과 10 (+0x1b |= 4) — Faster Reload. 총이 아니면 풀린다 (InitializeEquipmentEffect 0x437b40). 실제 장전 속도 변화는 클라이언트 쪽이며 아직 찾지 못했다
//   n=14 (0x447ceb): 효과 11 (+0x1b |= 8) — Eye of the Hawk. 무기 사거리 + 2 (Main.dll 0x1001125b), 총이 아니면 풀린다 (0x437bd9)
//   그 밖의 자기 효과 (UseSkillAlone 의 표 0x448490/0x448518, rm3944 NewUseSkillAlone 0x100012eb~0x100016c8). 효과 번호 e 는
//   사용자 효과 비트 (+0x4024 의 e 번째 비트, 몸 표시 CIS +0x1a 의 e 번째 비트)와 같다. 60 이상은 rm3944 가 따로 들고 있는 표
//   ([0x100083d0], 사용자마다 0x60 바이트: +4.. 에 켜짐, CIS +0x10/+0x11 비트로 옮김 NewLoadSkillsToCIS 0x100029cc)에 있다.
//   25→17 Eidolon, 30→22 Concentration, 31→23 Mind Shield, 32→26 Invisibility, 33→24 Red Halo, 45→33 Mind Barrier,
//   46→32 Psychic Boost, 47→30 Evasion, 49→31 Scarecrow, 50→34 Snipe, 51→35 Hide, 55→44 Holy Shield, 56→45 Damned Armor,
//   58→48 Berserker, 59→49 MadSpin, 60→50 Dysperse, 61→51 Chain Reaction, 63→52 Purity of Heart, 66→46 Rabbit's Foot,
//   75→60 Master, 79→63 WindWalker, 80→64 Heaven's Advent, 81→67 Camouflage, 82→68 Fire Shield, 83→69 Focused Spirit,
//   85→71 Desperation, 86→72 Diamond Skin, 88→73 Bull's Eye, 89→74 Quick Reload, 90→75 Godly Shield, 92→77 Destruction
//   지속 시간의 나눗수: 대개 20, n=31·32·63 은 10 (shr 3), n=55·56 은 40 (shr 5), n=27 은 5
const SELF_EFFECT = { 3: 1, 4: 0, 5: 2, 6: 3, 9: 6, 10: 7, 11: 8, 12: 9, 13: 10, 14: 11, 27: 19, 28: 20, 29: 21,
  25: 17, 30: 22, 31: 23, 32: 26, 33: 24, 45: 33, 46: 32, 47: 30, 49: 31, 50: 34, 51: 35, 55: 44, 56: 45, 58: 48, 59: 49,
  60: 50, 61: 51, 63: 52, 66: 46, 75: 60, 79: 63, 80: 64, 81: 67, 82: 68, 83: 69, 85: 71, 86: 72, 88: 73, 89: 74, 90: 75, 92: 77 };
// 바뀌면 능력치를 다시 셈하는 효과: 48 Berserker, 69 Focused Spirit, 73 Bull's Eye, 75 Godly Shield, 30 Evasion (방어)
const RECALC_FX = new Set([30, 48, 69, 73, 75]);
// 몬스터 한 마리에게 거는 약화 (UseSkillAttackSingleMop 0x44d720 의 분기 0x44f864~0x450700). 효과 종류 n → 몬스터 효과 e
//   hit: 'spi' 면 정신력 합 대 몬스터 정신력, 'dex' 면 싸움 민첩성 대 몬스터 민첩성으로 명중 판정 (GetAttackSuccessful)
//   지속(초) = ⌊정신력 합 ÷ div⌋ + p (div 가 0 이면 p 만). dmg 가 참이면 먼저 피해를 주고 몬스터가 살아 있을 때 건다 (n=37)
//   몬스터 그림이 0x5a 면 (+0x2d8) 확률 clamp(⌊min(몬스터 정신력, 7000) × 3 ÷ 350⌋ + 20, 20, 80)% 로 시전자에게 되돌아온다 (self = 시전자에게 걸리는 효과, 지속 ⌊정신력/20⌋ + p)
const MOB_DEBUFF = {
  7: { e: 4, hit: 'spi', div: 20, self: 4 }, 15: { e: 12, hit: 'spi', div: 20, self: 12 }, 16: { e: 5, hit: 'spi', div: 20, self: 5 },
  17: { e: 13, hit: 'spi', div: 20, self: 13 }, 21: { e: 15, hit: 'spi', div: 20, self: 0 }, 22: { e: 16, hit: 'spi', div: 40, self: 16 },
  37: { e: 16, hit: 'dex', div: 10, self: 16, dmg: true }, 38: { e: 55, hit: 'spi', div: 20, self: 55 }, 54: { e: 43, hit: 'spi', div: 50, self: 43 },
  26: { e: 18, hit: 'spi', div: 20, self: 18 }, 57: { e: 47, hit: 'dex', div: 40, self: 47 }, 65: { e: 54, hit: 'dex', div: 20, self: 54 }, 74: { e: 58, hit: 'spi', div: 0, self: 58 },
};
// 사람에게 거는 약화 (UseSkillAttackSingleUser 0x448940 의 분기표 0x44d5f0). 효과 종류 n → 사람 효과 e.
//   지속 = ⌊시전자 정신력(기본+장비) ÷ div⌋ + p 초 (div 0 이면 p). 맵 0x84~0x88·0xb4~0xbc 에서는 5초 (no5 는 예외)
//   명중 hit: 'spi' 는 양쪽 정신력, 'dex' 는 양쪽 fightDex. dmg 는 먼저 피해를 주고 살아 있으면 건다
const USER_DEBUFF = {
  7: { e: 4, hit: 'spi', div: 20 }, 15: { e: 12, hit: 'spi', div: 20 }, 16: { e: 5, hit: 'spi', div: 20 }, 17: { e: 13, hit: 'spi', div: 20 },
  21: { e: 15, hit: 'spi', div: 20 }, 22: { e: 16, hit: 'spi', div: 40 }, 26: { e: 18, hit: 'spi', div: 20 },
  37: { e: 16, hit: 'dex', div: 10, dmg: true }, 38: { e: 55, hit: 'dex', div: 20 }, 54: { e: 43, hit: 'spi', div: 20, no5: true },
  57: { e: 47, hit: 'dex', div: 40 }, 65: { e: 54, hit: 'dex', div: 20 }, 74: { e: 58, hit: 'spi', div: 0 },
};
// 사람 효과를 막는 것 (CMapServerClient::DoSkillEffect 0x42b2d0 의 분기 0x42ca74): 대상 효과 23·52·76·77 이면 막힘,
//   43 을 뺀 나머지는 효과 42 도 막고, 5·12·16·18·55·58 은 효과 7 도 막는다. 4·5·12~16·18·27·43·47·54·55·58 은 장비 +0x435c (분류 6 의 17 번, InitializeEquipmentEffect 0x436d2c) 도 막는다
const USER_BLOCK7 = new Set([5, 12, 16, 18, 55, 58]);
// 범위 기술이 사람에게 거는 약화 (UseSkillAttackRange 의 사람 분기 0x45a9c6~0x45b5e8). 모두 정신력 명중
const AREA_USER_DEBUFF = {
  15: { e: 12, div: 20 }, 17: { e: 13, div: 10 }, 22: { e: 16, div: 20 }, 38: { e: 55, div: 20 }, 54: { e: 43, div: 20, no5: true },
};
// 범위 약화 (UseSkillAttackRange 의 몬스터 분기표 0x45e348/0x45e368): 반경 안 몬스터마다 되돌림 → 정신력 명중 → 효과. 피해는 없다.
//   n=24 Dispel 은 명중하면 몬스터의 좋은·나쁜 효과를 모두 지운다 (CMopServer::OnGoodSkillExpired·OnBadSkillExpired, 0x45db5b)
const AREA_DEBUFF = {
  15: { e: 12, hit: 'spi', div: 20, self: 12 }, 17: { e: 13, hit: 'spi', div: 10, self: 13 }, 22: { e: 16, hit: 'spi', div: 20, self: 16 },
  24: { e: 0, hit: 'spi', div: 20, self: 0, dispel: true }, 38: { e: 55, hit: 'spi', div: 20, self: 55 }, 54: { e: 43, hit: 'spi', div: 20, self: 43 },
};
// 돌진 기술 (UseSkillMovingAttack 0x451410, 효과 종류 36): 시전자와 도착점 사이 줄 위의 몬스터를 모두 친다.
//   명중은 싸움 민첩성 대 몬스터 민첩성. X = 근력 공격 + 무기 공격, 끝에 + T+0x30
//   25 Slash, 45 Dash: 찍은 대상이면 ⌊3X/2⌋, 가는 길의 다른 몬스터는 X (_stricmp 0x452fc7)
//   323 Cross Blade: 3⌊X/4⌋ + 2 × 마력 소모량, 342 Ghost Spear: 2⌊X/4⌋ + 2 × 마력 소모량 (rm3944 NewMovingAttacks 0x10002fd6)
//   362 Lunar Blade: ⌊X/2⌋ + 3X (0x453824). 382 Piercing Arrow 는 활 식 (bowValue)
const MOVING = {
  382: () => 0,   // 활 식 (bowValue)
  25: (X, c, isTarget) => isTarget ? Math.floor(3 * X / 2) : X, 45: (X, c, isTarget) => isTarget ? Math.floor(3 * X / 2) : X,
  323: (X, c) => 3 * Math.floor(X / 4) + 2 * c, 342: (X, c) => 2 * Math.floor(X / 4) + 2 * c, 362: X => Math.floor(X / 2) + 3 * X,
};
// 이동 기술 (UseSkillMove 0x447460 와 rm3944 NewMapFix6 0x10003882). 맵 번호 = 서버의 +0x32c4
//   20 Dimensional Gate: 이 맵들에서만 (아니면 0x6c). 열 곳도 이 맵들이어야 함 (아니면 0x6d)
//   23 Recall: 이 맵들에서는 못 씀 (0x72), 불려 올 사람이 이 맵들에 있으면 0x71
//   48 Teleport: 이 맵들에서는 못 씀 (0xc3)
const R = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const GATE_MAPS = new Set([0, 1, 2, 3, 0x15, 0x1d, 0x24, 0x25, 0x26, 0x27, 0x47, 0x4f, 0x57, 0x5d, 0x5e, 0x5f, 0x60, ...R(0x89, 0x8d), 0x12c, 0x131]);
const RECALL_NO = new Set([0x29, 0x2a, 0x44, 0x48, 0x4c, 0x4d, 0x4e, ...R(0x53, 0x56), ...R(0xb1, 0xb3), ...R(0x30, 0x43), ...R(0x6e, 0x83), ...R(0x58, 0x5c)]);
const TELE_NO = new Set([0x29, 0x2a, 0x4e, 0x44, 0xb3, ...R(0x30, 0x43), ...R(0x6e, 0x83), ...R(0x58, 0x5c)]);
// 몬스터 쪽 막음 (CMopServer::InitializeMopInstance 0x4793b0~0x4793d9, DoSkillEffect 0x479630):
//   +0x2cc: 배치 종류 5 (강화형) 또는 그림 0x50·0x54·0x57·0x61·0x62 → 약화가 걸리지 않음. 몬스터에게 효과 23 이 있어도 걸리지 않음
//   +0x2d0: 그림 0x52·0x5d → 지속이 늘 5초.  +0x2d8: 그림 0x5a → 되돌림
const mobImmune = m => m.pattern === 5 || [0x50, 0x54, 0x57, 0x61, 0x62].includes(m.info.img);
const mobShort = m => m.info.img === 0x52 || m.info.img === 0x5d;
const mobReflect = m => m.info.img === 0x5a;
const DUR_DIV = { 27: 5, 31: 10, 32: 10, 63: 10, 55: 40, 56: 40 };
// 효과 8 의 값: 100 − min(50, 25 + ⌊기본 정신력 ÷ 100⌋). 기본 정신력은 USERDB+0x94 (= 사용자 +0x4364, 장비를 뺀 값)
const guardValue = p => 100 - Math.min(50, 25 + Math.floor((p.bSpi || 0) / 100));
const duration = (p, s) => Math.floor(p.spi / (DUR_DIV[s.n] || 20)) + s.p;
// 무기 묶음 (원작 곳곳에 같은 번호 목록이 박혀 있다. 예: CMopServer::GetAttack 0x47acff~0x47ad93, InitializeEquipmentEffect 0x4379c6~)
//   GUN: 분류 1 의 52~63, 137, 138, 240, 241, 190~194 / 분류 6 의 84, 114, 134, 154, 174, 194
//   HEAVY: 분류 1 의 68~72, 145, 146 (중화기). 효과 2·22 는 GUN 과 HEAVY 모두, 효과 10·11·34·50 은 GUN 만
//   CRIT15: 치명타 기본값이 10 이 아니라 15 인 무기 (DoAttackMop 0x46f5f8~): 분류 1 의 33~51, 125~135, 230, 231, 180~184 / 분류 6 의 83, 113, 133, 153, 173, 193 과 GUN, HEAVY
//   SPIN: 효과 49 MadSpin 이 유지되는 무기 (0x437932): 분류 1 의 81~95, 140~143, 220, 221, 170~174 / 분류 6 의 82, 112, 132, 152, 172, 192
const inR = (i, a, b) => i >= a && i <= b;
function isGunOnly(e) {
  if (!e) return false; const k = e.k, i = e.i;
  if (k === 1) return inR(i, 52, 63) || i === 137 || i === 138 || i === 240 || i === 241 || inR(i, 190, 194);
  return k === 6 && [84, 114, 134, 154, 174, 194].includes(i);
}
const isHeavy = e => !!e && e.k === 1 && (inR(e.i, 68, 72) || e.i === 145 || e.i === 146);
const isGun = e => isGunOnly(e) || isHeavy(e);
function isCrit15(e) {
  if (!e) return false; const k = e.k, i = e.i;
  if (isGun(e)) return true;
  if (k === 1) return inR(i, 33, 51) || inR(i, 125, 135) || i === 230 || i === 231 || inR(i, 180, 184);
  return k === 6 && [83, 113, 133, 153, 173, 193].includes(i);
}
function isSpin(e) {
  if (!e) return false; const k = e.k, i = e.i;
  if (k === 1) return inR(i, 81, 95) || inR(i, 140, 143) || i === 220 || i === 221 || inR(i, 170, 174);
  return k === 6 && [82, 112, 132, 152, 172, 192].includes(i);
}
// 몬스터에게 거는 약화(n=7, 81번): 명중하면(정신력 대 몬스터 정신력, GetAttackSuccessful) 몬스터 효과 4 (+0x1a |= 0x10),
// 지속 ⌊정신력/20⌋ + p 초 (UseSkillAttackSingleMop 0x44f98b, CMopServer::DoSkillEffect 0x479771).
// 이 표시가 붙은 몬스터를 공격하면 명중률 +25 (GetAttackSuccessful 0x45fc3a, 최대 100)

// ---------- 범위 기술과 특수 기술 ----------
// 사거리(l)가 10000 이상이면 범위 기술 (UseSkill 0x45ea0b). 효과 종류가 1, 8, 11, 25, 34, 53, 62, 64 면 범위 효과(UseSkillRangeEffect), 나머지는 범위 공격(UseSkillAttackRange 0x454600).
// 범위 공격: R = l − 10000. 대상을 찍었으면 대상이 R 안에 있어야 하고(아니면 실패), 중심을 대상 자리로 옮기고 반경을 ⌊2R/3⌋ 로 줄인다(374번만 ⌊R/4⌋).
// 대상이 없으면 시전자 자리를 중심으로 반경 R. 반경 안(거리 계산은 grid.dist)이면서 중심에서 막힘이 없는 몬스터 모두가 대상 (CMopManager::FirstInDistanceEntry, 0x45b92c NoObstacle).
const RANGE_EFFECT_TYPES = new Set([1, 8, 11, 25, 34, 53, 62, 64, 76, 77, 84, 91]);   // 76·77·84·91 은 rm3944 NewUseSkillRangeEffect
function areaOf(sid, s, hasTarget) {
  const R = s.l - 10000;
  if (!hasTarget) return { R, rad: R };
  return { R, rad: sid === 374 ? Math.floor(R / 4) : Math.trunc(2 * R / 3) };
}
// 범위 공격에서 몬스터에게 쓰는 식 (몬스터 쪽 분기 0x45b996, 효과 종류 0 과 78): 일반 기술은 정신력 명중 판정 후 공격 값 = 마력 소모량 (0x45d057).
// 아래 기술은 민첩성 명중 판정(싸움 민첩성 대 GetDexterity) 뒤 고유한 식. X = 근력 공격 + 무기 공격, 끝에 + T+0x30
//   46 (0x45bb3b, rm3944 NewAreaAttacks 0x10002dec): X + ⌊X/5⌋
//   49 (0x45cfff): 18 × ⌊X/10⌋
//   67 (0x45d3d0): 3X. 명중 판정 민첩성은 장비 + 4 × 기본 + 효과 몫 (0x45d3b0)
//   351 (0x45d23d): 3X + ⌊X/4⌋
//   325 / 336 (rm3944 NewCheckForAreaAttack 0x10002d95 가 46 갈래로 보냄): 2X + ⌊X/2⌋ / 5X − ⌊X/2⌋
//   384: ⌊7 × ⌊3 × (⌊S/1000⌋ + 1) × 무기 공격 / 2⌋ / 20⌋ + 5000, S = 장비 민첩성 + 효과 17 값(+0x4230) + 기본 민첩성
//   42 (0x45bcd4~0x45ce7e): 치명타 판정이 있는 일반 공격처럼. 값 = X + ⌊T+0x30 / 3⌋, 치명타 확률 10 ± ⌊⌊50|a−d|/(a+d)⌋/3⌋ (0~100), 치명타면 두 배
const AREA_FORMULA = {
  46: X => X + Math.floor(X / 5), 49: X => 18 * Math.floor(X / 10), 67: X => 3 * X, 351: X => 3 * X + Math.floor(X / 4),
  325: X => 2 * X + Math.floor(X / 2), 336: X => 5 * X - Math.floor(X / 2),
  384: (X, p) => { const S = (p.eqDex || 0) + (p.fxPow17 || 0) + (p.bDex || 0); return Math.floor(7 * Math.floor(3 * (Math.floor(S / 1000) + 1) * (p.wAtk || 0) / 2) / 20) + 5000; },
};
const areaFormulaKnown = id => true;
// 특수 기술(a=1): 위험 점수(DP)가 가득 차야 쓸 수 있고(UseSkill 0x45e55e, 최대 DP 와 비교) 쓰면 DP 는 0 (0x44d840, 0x454927).
// 명중 판정 없이 반드시 맞고, 공격 값 = ⌊레벨² ÷ 6⌋ + 50 (UseSkillAttackSingleMop 0x44f81c, UseSkillAttackRange 0x45d409)
const specialAttack = level => Math.floor(level * level / 6) + 50;

module.exports = { AREA_USER_DEBUFF, USER_DEBUFF, USER_BLOCK7, BOW_DIV, bowValue, AREA_FORMULA, GATE_MAPS, RECALL_NO, TELE_NO, MOVING, AREA_DEBUFF, MOB_DEBUFF, mobImmune, mobShort, mobReflect, RECALC_FX, guardValue, DRAIN, RANGE_EFFECT_TYPES, areaOf, areaFormulaKnown, specialAttack, SELF_EFFECT, duration, isGun, isGunOnly, isHeavy, isCrit15, isSpin, get, list, usable, spiritReq, SPECIAL, mpCost, hitStat, attackValue, damage, USE_MS, formulaKnown };
