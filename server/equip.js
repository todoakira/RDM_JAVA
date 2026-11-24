'use strict';
// 장비 효과 (CMapServerClient::InitializeEquipmentEffect 0x4352d0). 장비가 바뀌거나 능력치가 바뀔 때마다 다시 센다.
//
// 칸마다(0~13) 아이템 정보(CrItemInfo::Get)를 읽어
//   무기 공격(+0x18) → +0x42fc, 방어(+0x1c) → +0x430c, 능력치 네 가지(+0x20~+0x2c) → +0x4310~+0x431c 로 더한다.
// 등급(+0x54)이 1·3 인 고유 장비는 공격·방어 등이 "기본 능력치 × 레벨 ÷ 수" 로 바뀐다 (아래 UNIQUE).
//   a: 무기 공격(+0x42fc 몫), x: 추가 공격(+0x4300 = T+0x30), s: 기술 공격 값에 더함(+0x4304 = T+0x34), k: 기술 피해에 더함(+0x4308 = T+0x38), d: 방어
// 분류 6 의 번호(200 미만)는 묶음(세트) 표시로도 쓰인다 (local_320).
// 결과의 세 비율:
//   mobDmg (+0x4370): 몬스터에게 주는 피해 + 그 %  (CMopServer::DecreaseHP 0x478446)
//   mobDef (+0x4374): 몬스터에게 받는 피해 − 그 % (CMapServerClient::DecreaseHP 0x4393d2, 최대 80)
//   pvp    (+0x4378): 주인공끼리 싸움에서 쓰는 값 (최대 90, DecreaseHP 0x4394b1)
// 서버 쪽 깃발 +0x368c (PK 서버 여부로 보임)는 0 으로 본다.

const F = (v, d) => Math.floor(v / d);

// 고유 장비 식. 인자 c = { S, P, D, W, L, C } (기본 근력·정신력·민첩성·기골, 레벨, 직업 +0x37fc)
// 돌려주는 값: { a?, x?, s?, k?, d?, u?(+0x4378 몫), g?('A'|'B' 성장 표) }. 원작 decompile 의 uVar12=a, local_394=x, local_39c=s, local_384=k, iVar8=d
const K1 = {   // 분류 1 (무기) — 모두 +0x4378 에 20
  200: c => ({ a: F(c.S * c.L, 30) }), 241: c => ({ a: F(c.S * c.L, 30) }),
  201: c => ({ a: F(c.S * c.L, 35) }), 240: c => ({ a: F(c.S * c.L, 35) }),
  210: c => ({ s: F(c.P * c.L, 18) }), 211: c => ({ s: F(c.P * c.L, 25) }),
  220: c => ({ a: F(c.S * c.L, 20) }), 221: c => ({ a: F(c.S * c.L, 25) }),
  230: c => ({ a: F(c.D * c.L, 40) }), 231: c => ({ a: F(c.D * c.L, 35) }),
};
const K3 = { 42: c => ({ s: F(c.P * c.L, 30) }), 43: c => ({ s: F(c.P * c.L, 25) }) };   // 분류 3 (반지 두 개)
// 분류 6. 'A' 표 갈래는 +0x4378 에 4 (또는 6·8 과 mobDef), 'B' 표 갈래는 끝에 20 (적힌 u 가 있으면 그 값)
const dA = (n, div, mul) => c => ({ d: F(c.W * c.L, div) * mul, u: n, g: 'A' });
const dA12 = (div, mul) => c => ({ d: F(F(c.W * c.L, div), 12) * mul, u: 4, g: 'A' });
const dS = (div, mul, mob, u) => c => ({ d: F(c.W * c.L, div) * mul, u, mobDef: mob, g: 'A' });
const K6 = {
  81: () => ({ s: 200000 }),
  100: dA(4, 0x1c20, 9), 101: dA(4, 0x7f8, 9), 102: dA(4, 0x20d0, 9), 103: dA(4, 0x5460, 9), 104: dA(4, 0xe10, 9), 105: dA(4, 0x3cf0, 9), 106: dA(4, 0x5460, 9),
  107: c => ({ s: F(c.P * c.L, 300) * 5, u: 5, g: 'B' }),
  108: c => ({ s: F(c.P * c.L, 350) * 4, u: 10, g: 'B' }),
  110: c => ({ a: c.C === 2 ? F(c.S * c.L, 40) : c.C === 7 ? F(c.S * c.L, 55) : F(c.S * c.L, 45), u: 20, g: 'B' }),
  111: c => ({ s: F(c.P * c.L, 65), u: 20, g: 'B' }),
  112: c => ({ a: F(c.S * c.L, 50), u: 20, g: 'B' }),
  113: c => ({ a: F(c.D * c.L, 80), u: 20, g: 'B' }),
  114: c => ({ a: F(c.S * c.L, 45), u: 20, g: 'B' }),
  120: c => ({ d: F(F(c.W * c.L, 600), 12) * 13, u: 4, g: 'A' }),
  121: dA(4, 0x7f8, 14), 122: dA12(700, 13), 123: dA(4, 0x5460, 17), 124: dA(4, 0xe10, 15), 125: dA(4, 0x3cf0, 17), 126: dA12(0x708, 20),
  127: c => ({ s: F(c.P * c.L, 450) * 5, k: F(c.P * c.L, 35), u: 5, g: 'B' }),
  128: c => ({ s: F(c.P * c.L, 450) * 4, k: F(c.P * c.L, 35), u: 10, g: 'B' }),
  130: c => c.C === 2 ? { a: F(c.S * c.L, 35), x: F(c.S * c.L, 20), u: 20, g: 'B' } : c.C === 7 ? { a: F(c.S * c.L, 50), x: F(c.S * c.L, 30), u: 20, g: 'B' } : { a: F(c.S * c.L, 40), x: F(c.S * c.L, 30), u: 20, g: 'B' },
  131: c => ({ s: F(c.P * c.L, 60), k: F(c.P * c.L, 35), u: 20, g: 'B' }),
  132: c => ({ a: F(c.S * c.L, 45), x: F(c.S * c.L, 20), u: 20, g: 'B' }),
  133: c => ({ a: F(c.D * c.L, 75), x: F(c.D * c.L, 20) * 2, u: 20, g: 'B' }),
  134: c => c.C === 5 ? { a: F(c.S * c.L, 40), x: F(c.S * c.L, 20), u: 20, g: 'B' } : { a: F(c.S * c.L, 40), x: F(c.S * c.L, 30), u: 20, g: 'B' },
  140: dA12(600, 19), 141: dA12(0xaa, 19), 142: dA12(700, 20), 143: dA(4, 0x5460, 30), 144: dA12(300, 20), 145: c => ({ d: F(c.W * c.L, 0x3cf0) * 25, u: 4, g: 'A' }), 146: dA(4, 0x5460, 40),
  147: c => ({ s: F(c.P * c.L, 400) * 5, k: F(c.P * c.L, 25), u: 5, g: 'B' }),
  148: c => ({ s: F(c.P * c.L, 400) * 4, k: F(c.P * c.L, 25), u: 10, g: 'B' }),
  150: c => c.C === 2 ? { a: F(c.S * c.L, 30), x: F(c.S * c.L, 10), u: 20, g: 'B' } : c.C === 7 ? { a: F(c.S * c.L, 45), x: F(c.S * c.L, 15), u: 20, g: 'B' }   /* 0x6c16c16d = ÷45 */ : { a: F(c.S * c.L, 35), x: F(c.S * c.L, 15), u: 20, g: 'B' },
  151: c => ({ s: F(c.P * c.L, 55), k: F(c.P * c.L, 25), u: 20, g: 'B' }),
  152: c => ({ a: F(c.S * c.L, 40), x: F(c.S * c.L, 9), u: 20, g: 'B' }),
  153: c => ({ a: F(c.D * c.L, 70), x: F(c.D * c.L, 15) * 2, u: 20, g: 'B' }),
  154: c => c.C === 5 ? { a: F(c.S * c.L, 35), x: F(c.S * c.L, 10), u: 20, g: 'B' } : { a: F(c.S * c.L, 35), x: F(c.S * c.L, 15), u: 20, g: 'B' },   // 0xd41d41d5 = ÷35
  160: dS(0x1c20, 19, 2, 6), 161: dS(0x7f8, 19, 2, 6), 162: dS(0x20d0, 20, 2, 6), 163: dS(0x5460, 30, 2, 6), 164: dS(0xe10, 20, 2, 6), 165: dS(0x3cf0, 25, 2, 6), 166: dS(0x5460, 40, 2, 6),
  167: c => ({ s: F(c.P * c.L, 350) * 5, k: F(c.P * c.L, 15), u: 5, g: 'B' }),
  168: c => ({ s: F(c.P * c.L, 350) * 4, k: F(c.P * c.L, 15), u: 10, g: 'B' }),
  170: c => c.C === 2 ? { a: F(c.S * c.L, 25), x: F(c.S * c.L, 5), u: 20, g: 'B' } : c.C === 7 ? { a: F(c.S * c.L, 40), x: F(c.S * c.L, 7), u: 20, g: 'B' } : { a: F(c.S * c.L, 30), x: F(c.S * c.L, 7), u: 20, g: 'B' },
  171: c => ({ s: F(c.P * c.L, 50), k: F(c.P * c.L, 12), u: 20, g: 'B' }),
  172: c => ({ a: F(c.S * c.L, 35), x: c.S * c.L >>> 2, u: 20, g: 'B' }),
  173: c => ({ a: F(c.D * c.L, 65), x: ((c.D * c.L) >>> 3) << 1, u: 20, g: 'B' }),
  174: c => c.C === 5 ? { a: F(c.S * c.L, 30), x: F(c.S * c.L, 3), u: 20, g: 'B' } : { a: F(c.S * c.L, 30), x: F(c.S * c.L, 7), u: 20, g: 'B' },
  180: dS(0x1c20, 19, 4, 8), 181: dS(0x7f8, 19, 4, 8), 182: dS(0x20d0, 20, 4, 8), 183: dS(0x5460, 30, 4, 8), 184: dS(0xe10, 20, 4, 8), 185: dS(0x3cf0, 25, 4, 8), 186: dS(0x5460, 40, 4, 8),
  187: c => ({ s: F(c.P * c.L, 300) * 5, k: F(c.P * c.L, 10), u: 5, g: 'B' }),
  188: c => ({ s: F(c.P * c.L, 300) * 4, k: F(c.P * c.L, 10), u: 10, g: 'B' }),
  190: c => c.C === 2 ? { a: F(c.S * c.L, 20), x: (c.S * c.L) >>> 1, u: 20, g: 'B' } : c.C === 7 ? { a: F(c.S * c.L, 35), x: F(c.S * c.L, 5) * 2, u: 20, g: 'B' } : { a: F(c.S * c.L, 25), x: F(c.S * c.L, 5) * 2, u: 20, g: 'B' },
  191: c => ({ s: F(c.P * c.L, 45), k: F(c.P * c.L, 6), u: 20, g: 'B' }),
  192: c => ({ a: F(c.S * c.L, 30), x: (c.S * c.L) >>> 1, u: 20, g: 'B' }),
  193: c => ({ a: F(c.D * c.L, 60), x: F(c.D * c.L, 5) * 2, u: 20, g: 'B' }),
  194: c => c.C === 5 ? { a: F(c.S * c.L, 25), x: F(c.S * c.L, 3) * 2, u: 20, g: 'B' } : { a: F(c.S * c.L, 25), x: F(c.S * c.L, 5) * 2, u: 20, g: 'B' },
};

// 분류 6 의 칸마다 붙는 덧셈 (같은 함수 0x436be3~0x437040, 고유 여부와 상관없이)
function k6Extra(i, c, o, isCommander) {
  const W10 = F(c.W, 10), L10 = F(c.L, 10);
  switch (i) {
    case 1: case 8: o.def += F(W10 * L10 * L10, 100); break;
    case 10: if (isCommander) { o.add[0] += 500; o.add[1] += 500; o.add[2] += 500; o.add[3] += 500; o.wAtk += 10000; o.def += F(W10 * L10 * L10, 100); } break;
    case 11: case 12: o.def += F(W10 * L10, 10); break;
    case 14: o.def += F(W10 * L10, 5); o.flag3f5 = true; break;
    case 17: o.flag435c = 1; o.def += F(W10 * L10, 5); break;
    case 18: o.flag4358 = 1; o.def += F(W10 * L10, 20); o.wAtk += (c.L * 3) >>> 1; break;
    case 23: o.flag36 = 1; o.def += F(W10 * L10, 10); o.add[2] += (c.L * 3) >>> 1; break;
    case 26: o.def += F(W10 * L10, 10); o.add[2] += (c.L * 3) >>> 1; break;
    case 28: o.def += F(L10 * W10, 10); o.add[3] += F(c.W * 2, 25); break;
    case 35: o.add[0] += F(c.L * 9, 10); o.grow[0]++; break;
    case 36: o.add[1] += F(c.L * 19, 10); o.grow[1]++; break;
    case 37: o.add[2] += F(c.L * 9, 10); o.grow[2]++; break;
    case 90: case 92: o.def += F(c.W * c.L, 500); break;
    case 91: case 93: case 95: case 98: case 96: o.def += Math.floor(c.W * c.L * c.L / 100000); break;
    case 94: o.def += F(c.L * c.W, 1000); o.add[3] += F(c.W * 2, 25); break;
    case 97: o.def += F(c.W * c.L, 1000); break;
  }
}

// 묶음(세트) 덤 (0x437040~0x4372f7). h[i] = 분류 6 의 i 번을 차고 있는가
function sets(h, o, srv) {
  // 17 과 90·91·92
  if (h[17] && h[90] && h[91] && h[92]) { o.pvp += 30; o.mobDef += 20; o.mobDmg = 30; }
  else if (h[17] && !h[90]) { if (h[91]) o.pvp += 10; if (h[92]) o.mobDmg += 5; }
  else { if (h[90]) o.mobDmg = 5; if (h[91]) o.pvp += 10; if (h[92]) o.mobDmg += 5; }
  // 93·94
  if (h[93] && h[94]) { o.pvp += 30; o.mobDef += 30; }
  else if (h[93]) { o.pvp += 15; o.mobDef += 10; }
  else if (h[94]) { o.pvp += 5; o.mobDef += 10; }
  // 95·96·97·98
  if (h[95] && h[96] && h[97] && h[98]) { o.mobDmg += 40; o.pvp += 40; o.mobDef += 30; }
  else {
    if (h[95]) { o.mobDmg += 10; o.pvp += 10; }
    if (h[96]) { o.mobDmg += 10; o.pvp += 10; }
    if (h[97]) { o.mobDmg += 10; o.pvp += 10; }
    if (h[98]) { o.pvp += 10; o.mobDef += 20; }
  }
  // 1 과 11·26·28
  if (h[1] && h[11] && h[26] && h[28]) o.mobDmg += srv.battle2 ? 40 : 50;
  else { for (const i of [1, 11, 26, 28]) if (h[i]) o.mobDmg += 5; }
  // 2 와 15·24
  if (h[2] && h[15] && h[24]) o.pvp += srv.pk ? 60 : srv.battle2 ? 50 : 40;
  else { for (const i of [2, 15, 24]) if (h[i]) o.pvp += srv.pk ? 15 : 10; }
  // 8·12
  if (h[8] && h[12]) o.mobDef += 50; else if (h[8] || h[12]) o.mobDef += 10;
  // 35·36·37: 능력치 성장 + 2 씩 (네 가지 모두)
  if (h[35] && h[36] && h[37]) o.grow = [2, 2, 2, 2];
}

// 직업별 능력치 한 점당 성장 표 (+0x43cc + 직업 × 0x10, 생성자 0x40ad94~0x40ae73): [근력, 정신력, 민첩성, 기골]
const GROWTH = [[8, 20, 10, 10], [10, 18, 8, 12], [15, 10, 10, 13], [14, 10, 14, 10], [15, 8, 10, 15], [14, 10, 12, 12], [10, 15, 13, 10], [12, 12, 12, 12], [8, 12, 12, 12]];

function compute(p, itemInfo, opts = {}) {
  const c = { S: p.base.str, P: p.base.spi, D: p.base.dex, W: p.base.pow, L: p.level, C: p.chr };
  const o = { wAtk: 0, def: 0, add: [0, 0, 0, 0], x: 0, s: 0, k: 0, pvp: 0, mobDef: 0, mobDmg: 0, grow: [0, 0, 0, 0], flag4358: 0, flag435c: 0, flag36: 0, flag3f5: false, range: 1 };
  const h = [];
  const eq = p.equip || [];
  for (let slot = 0; slot < 14; slot++) {
    const e = eq[slot]; const f = e && itemInfo(e.k, e.i); if (!f) continue;
    if (e.k === 6 && e.i < 200) h[e.i] = 1;
    if (e.k === 2) o.pvp += 4;
    else if (e.k === 3) o.pvp += f.type === 1 ? 10 : 4;
    if (slot === 7) { o.range = f.range || 1; const s5 = eq[5]; if (s5 && s5.k === e.k && s5.i === e.i) continue; }   // 5번 칸과 같은 물건이면 한 번만
    let a = f.atk || 0, d = f.def || 0, x = 0, s = 0, k = 0;
    if (f.grade === 1 || f.grade === 3) {
      const fn = e.k === 1 ? K1[e.i] : e.k === 3 ? K3[e.i] : e.k === 6 ? K6[e.i] : null;
      if (fn) {
        const r = fn(c);
        if ('a' in r) a = r.a; if ('d' in r) d = r.d;
        x = r.x || 0; s = r.s || 0; k = r.k || 0;
        if (e.k === 1) o.pvp += 20;
        else if (e.k === 6) { o.pvp += r.u || 0; o.mobDef += r.mobDef || 0; }
      }
    }
    const cap = v => Math.min(100000000, v);
    if (a > 0) o.wAtk += cap(a);
    if (x > 0) o.x += cap(x);
    if (d > 0) o.def += d;
    if (s > 0) o.s += cap(s);
    if (k > 0) o.k += cap(k);
    (f.v || []).forEach((v, q) => { o.add[q] += v; });
    if (e.k === 6) k6Extra(e.i, c, o, opts.isCommander);
  }
  sets(h, o, opts.srv || {});
  o.pvp = Math.min(90, o.pvp);
  // 기본 능력치: 묶음 성장이 있으면 ⌊(기본 − 10) ÷ 표⌋ × (표 + 덤) + 10 (0x4373b9~0x437660)
  const g = GROWTH[Math.max(0, Math.min(8, p.chr | 0))], base = [c.S, c.P, c.D, c.W];
  o.base = base.map((v, q) => (o.grow[q] && g[q] && v > 10) ? Math.floor((v - 10) / g[q]) * (g[q] + o.grow[q]) + 10 : v);
  // 이노큘레이터 3 근력·10 정신력·5 민첩성·4 기골: 그 능력치에 ⌊(DB 값 − 10) ÷ 표⌋ 를 더한다 (0x437618~0x43779e). opts.inoc = [근력, 정신력, 민첩성, 기골]
  if (opts.inoc) o.base = o.base.map((v, q) => (opts.inoc[q] && g[q] && base[q] > 10) ? v + Math.floor((base[q] - 10) / g[q]) : v);
  return o;
}

module.exports = { compute, GROWTH, K1, K3, K6 };
