'use strict';
// 게임 세계: 맵마다 World 하나. 이동·전투·맵 이동 판정은 전부 여기(서버)에서 한다.
// 좌표는 원작 서버와 같다: 칸(가로 48 × 세로 24 픽셀)마다 서는 자리가 둘 있다 (grid.js).
const fs = require('fs');
const path = require('path');
const F = require('./formulas');     // 원작 서버 실행 파일에서 옮긴 계산식
const { spriteOf } = require('./sprites');   // 원작 클라이언트에서 옮긴 모습 번호 표

// 박자는 원작 클라이언트(Main.dll)에서 옮겼다. 화면 한 장이 50ms 이고(주 반복문 0x10007330), 한 걸음은 장마다 정해진 픽셀만큼 움직인다(0x100390d0):
//   걷기: 대각선 장당 (4, 2)픽셀 → 6장, 가로·세로 장당 6·3픽셀 → 8장. 달리기는 그 두 배 속도.
const FRAME_MS = 50;
const CFG = {
  stepFrames: { walk: [6, 8], run: [3, 4] },   // [대각선, 가로·세로] 한 걸음에 드는 장 수
  maxPath: 4000,          // 길찾기 탐색 한도(칸)
  maxName: 14,
  maxChat: 120,
  viewX: 26, viewY: 36,   // 이 거리(칸) 안의 일만 알려 준다
  startLevel: Math.max(1, Math.min(F.MAX_LEVEL, Number(process.env.START_LEVEL) || 1)),   // 시험용: START_LEVEL=100 npm start
};
const STATS = ['str', 'spi', 'dex', 'pow'];
const STAT_NAMES = ['근력', '정신력', '민첩성', '기골'];
const EQUIP_SLOTS = 14, RING_SLOTS = [9, 10, 11], TYPE_RING = 300;   // 착용 칸 14개: 0~8 부위별, 반지는 9·10·11번 (CheckEquipment 0x434576)
const SLOT_NAMES = ['모자', '목걸이', '상의', '하의', '신발', '방패', '장갑', '무기', '벨트', '반지', '반지', '반지', '', ''];
// NPC 이벤트 종류 (EventInfo.rse 머리말). 31~37, 82~86 이 상점이고 둘째 값이 상점 번호다 (ProcessEvent 0x41f7af~0x420b9b)
const SHOP_KINDS = [31, 32, 33, 34, 35, 36, 37, 82, 83, 84, 85, 86];
const EVENT_NAMES = { 2: '게시판', 4: '메일', 11: '자유군 공용 컴퓨터', 12: '자유군 아지트 선택', 13: '자유군 금고', 14: '자유군 게시판', 15: '자유군 아지트 컴퓨터', 27: '고고학자 퀘스트', 28: '지리학자 퀘스트', 29: '카삼 퀘스트', 39: '신전', 43: '교도관', 44: '회상 퀘스트', 45: '배틀존 이동' };
const TALK_DIST = 25, BANK_SLOTS = 20;
const NEW_CHAR = { money: 300, hp: 50, mp: 50, sp: 0, items: [[4, 1, 5], [5, 93, 1], [5, 94, 1], [5, 95, 1]],
  skills: [[1, 91], [11, 101], [21, 111], [31, 121], [41, 131], [51, 141], [71, 161], [61, 151], [81, 171]],   // 직업 번호 → [기술, 특수 기술]
  start: { map: 22, x: 8, y: 14 }, startBeginner: { map: 68, x: 6, y: 45 } };
const EV_WARP = 1, EV_SAFE = 5;      // 이벤트 종류 (EventNNNNN.rse)
const GROUND_ITEM_MS = 600000;       // 바닥 아이템이 사라지는 시간: 10분 (CItemServer::RemoveOldItems 0x408b48)
const PERCENT_HEAL = 1900000000;     // 회복 수치가 이 값 이상이면 초과분만큼의 % 회복 (CMapServerClient::UseItem 0x432f8d)

const crypto = require('crypto');
const G = require('./grid');
const SK = require('./skills');
const { Events } = require('./events');
const STORY = require('./story');
const { Groups } = require('./group');
const { Trades } = require('./trade');   // 이벤트 대본 (NPC 대사, 초보 안내, 퀘스트)   // 기술 (svMapServer.exe UseSkill*, rm3944.dll)         // 원작의 위치·방향·거리 계산
const { Mail } = require('./mail');
const { Army } = require('./army');      // 군단 (Process*Army*)      // 우편 (ProcessGetMailList 등)
const MOB_TICK = 250;                // 몬스터 처리 주기 (CMopServer::InitializeMopTimer 0x477000)
const T200 = Math.ceil(200 / MOB_TICK), T400 = Math.ceil(400 / MOB_TICK);   // 몬스터 구조체의 두 대기 단위 (0x10c, 0x108)
const EV_NO_ATTACK = 18, EV_MOB_OK = [0, 19, 22], EV_LURE = 22;
// 모습 번호로 갈리는 원작의 예외들
const IMG_STILL = [66, 67, 68];      // 제자리에서 움직이지 않는 종류 (DoNextAction 0x47c401)
const IMG_JUMP_DIR = [72, 76], IMG_JUMP_TO = [72, 76, 78, 98];   // 막힌 곳을 건너뛰는 종류 (CMopServer::MoveDir 0x47d880 / 0x47d8e0)
const IMG_WARPER = 78;               // 돌아다니다 순간이동하는 종류 (DoNextAction 0x47c4bc)
const ROOT = path.join(__dirname, '..');
function readJson(...p) { const f = path.join(ROOT, ...p); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; }
const rnd = n => Math.floor(Math.random() * 32768) % n;   // C 의 rand() % n
const pos = e => ({ x: e.x, y: e.y, z: e.z });
// 한 걸음에 걸리는 시간: 대각선(1·3·7·9)과 가로·세로(2·4·6·8)가 다르다
const stepMs = (dir, run) => CFG.stepFrames[run ? 'run' : 'walk'][dir % 2 ? 0 : 1] * FRAME_MS;

class World {
  constructor(game, mapId) {
    const m = readJson('assets', 'maps', mapId + '.json');
    const sv = readJson('data', 'maps', mapId + '.json') || { spawns: [], events: {}, npcs: [], ev: '' };
    this.game = game; this.mapId = mapId; this.name = m.name;
    this.script = new Events(this);
    this.w = m.w; this.h = m.h; this.spawn = m.spawn;
    // 이동 가능 여부: 서버 맵이 있으면 그것을(칸마다 자리 0·1 두 비트), 없으면 클라이언트 맵의 값을 쓴다
    const fallback = sv.walkUser ? '' : m.col.replace(/1/g, '3');
    this.walkU = sv.walkUser || fallback; this.walkM = sv.walkMop || fallback;
    this.ev = sv.ev ? Buffer.from(sv.ev, 'base64') : null; this.events = sv.events;
    let safe = '';
    for (let i = 0; i < this.w * this.h; i++) { const e = this.ev && this.events[this.ev[i]]; safe += e && e[0] === EV_SAFE ? '1' : '0'; }
    this.safeStr = safe;
    this.players = new Map(); this.mobs = new Map(); this.npcs = []; this.occ = new Map(); this.timers = []; this.ground = new Map();
    this.mobTickAt = Date.now() + MOB_TICK;
    for (const n of sv.npcs) {
      if (!(spriteOf(n.img) in game.chrIndex)) continue;
      const t = this.findFirstEmptyPlace(n.rect, q => this.canUser(q) && !this.occ.has(this.key(q))); if (!t) continue;
      const npc = { id: game.nextId++, npc: 1, name: n.name, chr: spriteOf(n.img), x: t.x, y: t.y, z: t.z, dir: 2, event: n.event };
      this.npcs.push(npc); this.occ.set(this.key(t), npc.id);
    }
    let skipped = 0, seq = 0;
    for (const s of sv.spawns) {
      const info = game.mopInfo[s.kind];
      // 몬스터 이름표 "+이름_n": n 은 이 맵에서 불러온 순서 (CMopServer::LoadMop 0x4772f3, "+%s_%u"). 대본의 KillMonster 가 이것으로 고른다
      const sids = []; for (let i = 0; i < s.count; i++) sids.push(`+${s.name}_${seq++}`);
      if (!info || !(spriteOf(info.img) in game.chrIndex)) { skipped += s.count; continue; }   // 그림이 없는 몬스터는 내보내지 않는다
      for (const sid of sids) this.spawnMob(s, sid);
    }
    if (skipped) console.log(`  맵 ${mapId}: 그림이 없는 몬스터 ${skipped}마리 제외`);
  }
  key(p) { return (p.y * this.w + p.x) * 2 + p.z; }
  bit(str, p) { return (str.charCodeAt(p.y * this.w + p.x) - 48) >> p.z & 1; }
  // 주인공이 설 수 있는 자리 (CrsMap::GetCanExistUser 0x486300)
  canUser(p) { return p.x > 0 && p.x < this.w && p.y > 0 && p.y < this.h && this.bit(this.walkU, p) === 1; }
  // 몬스터가 설 수 있는 자리: 이동 가능 비트가 있고, 이벤트 칸이면 종류 0·19·22만 (CMopServer::GetCanExist 0x4782f0, CrsMap::GetCanExistMop 0x486290)
  canMop(p) {
    if (!(p.x > 0 && p.x + 1 < this.w && p.y > 0 && p.y + 1 < this.h) || this.bit(this.walkM, p) !== 1) return false;
    const id = this.ev ? this.ev[p.y * this.w + p.x] : 0, e = id > 0 ? this.events[id] : null;
    return !e || EV_MOB_OK.includes(e[0]);
  }
  free(p, self) { const o = this.occ.get(this.key(p)); return o === undefined || o === self; }
  take(e) { if (this.free(e)) this.occ.set(this.key(e), e.id); }
  release(e) { if (this.occ.get(this.key(e)) === e.id) this.occ.delete(this.key(e)); }
  safe(x, y) { return this.safeStr.charCodeAt(y * this.w + x) === 49; }
  eventAt(x, y) { return this.ev && x >= 0 && y >= 0 && x < this.w && y < this.h ? this.events[this.ev[y * this.w + x]] : null; }
  after(ms, fn) { this.timers.push({ at: Date.now() + ms, fn }); }

  // 영역 안에서 무작위로 열 번(자리 1) 찾아 보고, 없으면 처음부터 훑는다 (CNPCServer::FindFirstEmptyPlace 0x483230, FindEmptyPlace 0x4831b0)
  findFirstEmptyPlace(r, ok) {
    const [l, t, rr, b] = r; if (rr < l || b < t) return null;
    for (let i = 0; i < 10; i++) { const q = { x: l + rnd(rr - l + 1), y: t + rnd(b - t + 1), z: 1 }; if (ok(q)) return q; }
    for (let x = l; x <= rr; x++) for (let y = t; y <= b; y++) for (const z of [1, 0]) { const q = { x, y, z }; if (ok(q)) return q; }
    return null;
  }
  // 가까운 설 수 있는 자리: 바깥으로 한 겹씩 넓혀 가며, 같은 칸의 다른 자리도 본다 (CrsMap::GetUserCanExistPIS 0x486360)
  nearUser(p, r = 6, needFree = false) {
    const ok = q => q.x >= 0 && q.y >= 0 && this.canUser(q) && (!needFree || !this.occ.has(this.key(q)));
    for (let d = 0; d <= r; d++) for (let y = p.y - d; y <= p.y + d; y++) for (let x = p.x - d; x <= p.x + d; x++) {
      const a = { x, y, z: p.z }; if (ok(a)) return a;
      const b = { x, y, z: p.z ? 0 : 1 }; if (ok(b)) return b;
    }
    return null;
  }

  // 길찾기 (A*, 여덟 방향). 원작에서는 클라이언트가 길을 찾고 서버는 한 걸음씩 검사한다. 여기서는 서버가 길도 찾는다.
  findPath(s, t, limit = CFG.maxPath) {
    const start = this.key(s), goal = this.key(t);
    if (start === goal) return [];
    const [tx, ty] = G.px(t);
    // 걸음 값은 걸리는 장 수(대각선 6, 가로·세로 8). 남은 거리 어림은 그보다 크지 않게 잡는다
    const hfn = q => { const [x, y] = G.px(q); return 4 * Math.max(Math.abs(x - tx) / 24, Math.abs(y - ty) / 12); };
    const g = new Map([[start, 0]]), from = new Map(), node = new Map([[start, pos(s)]]), open = [[0, start]], done = new Set();
    let seen = 0;
    while (open.length && seen++ < limit) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const k = open.splice(bi, 1)[0][1];
      if (k === goal) { const out = []; let c = goal; while (c !== start) { out.push(node.get(c)); c = from.get(c); } return out.reverse(); }
      if (done.has(k)) continue; done.add(k);
      const cur = node.get(k);
      for (const d of G.DIRS) {
        const n = G.next(cur, d), nk = this.key(n);
        if (nk === k || !this.canUser(n) || (nk !== goal && this.occ.has(nk))) continue;
        const ng = g.get(k) + (d % 2 ? 6 : 8);
        if (ng < (g.get(nk) ?? Infinity)) { g.set(nk, ng); from.set(nk, k); node.set(nk, n); open.push([ng + hfn(n), nk]); }
      }
    }
    return null;
  }

  // ---------- 주인공 ----------
  // 맵에 들어온다 (접속, 맵 이동, 부활 공통)
  enter(p, x, y) {
    const want = x === undefined ? { x: this.spawn[0], y: this.spawn[1], z: 1 } : { x, y, z: 1 };
    const t = this.nearUser(want, 10, true) || this.nearUser(want, 10) || this.nearUser({ x: this.spawn[0], y: this.spawn[1], z: 1 }, 40) || want;
    p.world = this; p.shop = null; p.bankNpc = 0; p.exchAt = null; p.x = t.x; p.y = t.y; p.z = t.z; p.path = []; p.target = 0; p.cast = null; p.nextAt = 0;
    this.players.set(p.id, p); this.take(p);
    p.send({ t: 'welcome', id: p.id, map: this.mapId, safe: this.safeStr,
      players: [...this.players.values()].map(pubP), mobs: [...this.mobs.values()].map(pubM), npcs: this.npcs, ground: [...this.ground.values()] });
    this.game.sendStat(p); this.game.sendInv(p);
    this.broadcast({ t: 'add', p: pubP(p) }, p.id);
    this.game.groups.moved(p);
  }
  leave(p) { if (p.trade) this.game.trades.cancel(p); this.release(p); p.evAt = {}; if (this.players.delete(p.id)) this.broadcast({ t: 'del', id: p.id }); }

  moveTo(p, x, y, z, run) {
    if (p.dead || !Number.isInteger(x) || !Number.isInteger(y)) return;
    const t = this.nearUser({ x, y, z: z ? 1 : 0 }); if (!t) return;
    const pa = this.findPath(p, t); if (!pa) return;
    p.path = pa; p.run = !!run; p.target = 0; p.cast = null; p.pick = 0; p.talk = 0;
  }
  attackCmd(p, id, run) {
    const m = this.mobs.get(id);
    if (p.dead || !m) return;
    p.target = id; p.run = !!run; p.repathAt = 0; p.pick = 0; p.talk = 0; p.cast = null;
  }
  // 기술 쓰기: 지금은 몬스터 한 마리를 노리는 공격 기술(효과 종류 0)만 된다.
  // 사거리 밖이면 걸어가서 쓴다. 원작은 이 걸음을 클라이언트가 하고 서버는 사거리만 확인한다 (UseSkill 0x45ed73)
  // 쓸 수 있는 기술인지: 일반 기술은 목록에 있어야 하고, 특수 기술은 직업의 특수 기술이면서 DP 가 가득 차야 한다
  skillReady(p, sid, s) {
    // 효과 58 이면 기술을 쓸 수 없고, 효과 43 이면 특수 기술만 (ProcessUseSkill 0x43c44c~0x43c476)
    if (this.fxOn(p, 58) || (this.fxOn(p, 43) && s.a === 0)) return false;
    if (s.a === 1) { if (sid !== SK.SPECIAL[p.chr]) return false; if (p.dp < p.maxDp) { p.send({ t: 'note', text: 'DP가 가득 차야 쓸 수 있습니다.' }); return false; } return true; }
    return SK.list(p).includes(sid);
  }
  skillCmd(p, sid, id, run) {
    const m = id ? this.mobs.get(id) : null, s = SK.get(sid);
    if (p.dead || !s || !this.skillReady(p, sid, s)) return;
    const area = s.l >= 10000;
    const ok = area ? (s.n === 0 && (s.a === 1 || SK.areaFormulaKnown(sid))) || (s.a === 0 && s.n in SK.AREA_DEBUFF)
      : s.l > 0 && (s.a === 1 ? s.n === 0 : (s.n === 0 && SK.formulaKnown(sid)) || s.n in SK.MOB_DEBUFF);
    const u = id ? this.players.get(id) : null;
    if (!area && s.a === 0 && (s.n === 1 || s.n === 44) && (u || s.n === 1)) {   // 주인공에게 쓰는 회복·부활 (UseSkillUserCure 0x448700)
      const now = Date.now(); if (now < (p.skillAt || 0)) return;
      const t = u || p;
      if (t !== p && G.dist(p, t) > s.l) { p.send({ t: 'note', text: '너무 멉니다.' }); return; }
      p.skillAt = now + SK.USE_MS; this.cureUser(p, t, s, sid, now); return;
    }
    if (area && s.a === 0 && SK.RANGE_EFFECT_TYPES.has(s.n)) {   // 범위 효과 (UseSkillRangeEffect 0x453b00): 대상은 주인공이거나 없음
      const now = Date.now(); if (now < (p.skillAt || 0)) return;
      p.skillAt = now + SK.USE_MS; this.castRangeEffect(p, id ? this.players.get(id) : null, s, sid, now); return;
    }
    if (!ok) { p.send({ t: 'note', text: '아직 구현하지 않은 기술입니다.' }); return; }
    if (!m) {                                                   // 대상 없이 쓰는 범위 기술은 내 자리가 중심
      if (!area) return;
      const now = Date.now(); if (now < (p.skillAt || 0)) return;
      p.skillAt = now + SK.USE_MS; this.castArea(p, null, s, sid, now); return;
    }
    p.cast = { sid, id }; p.target = 0; p.run = !!run; p.repathAt = 0; p.pick = 0; p.talk = 0;
  }
  // 자기에게 쓰는 기술 (사거리 0)
  selfSkillCmd(p, sid) {
    const s = SK.get(sid), now = Date.now();
    if (s && s.l >= 10000) { this.skillCmd(p, sid, 0); return; }   // 범위 기술을 대상 없이
    if (p.dead || !s || !SK.list(p).includes(sid)) return;
    if (s.a !== 0 || s.l !== 0 || !(s.n === 1 || s.n in SK.SELF_EFFECT)) { p.send({ t: 'note', text: '아직 구현하지 않은 기술입니다.' }); return; }
    if (now < (p.skillAt || 0)) return;
    const cost = SK.mpCost(s, p.maxMp);
    if (p.mp < cost) { p.send({ t: 'note', text: '마력이 부족합니다.' }); return; }
    p.skillAt = now + SK.USE_MS;
    if (s.n === 1) {
      if (sid === 24) { p.mp -= cost; p.hp = p.maxHp; }
      else { const use = Math.min(Math.floor((p.maxHp - Math.min(p.hp, p.maxHp)) / 2), p.mp); p.mp -= use; p.hp = Math.min(p.maxHp, p.hp + use * 2); }
    } else {
      p.mp -= cost;
      const e = SK.SELF_EFFECT[s.n];
      if (e === 7) for (const bad of [5, 12, 14, 16, 18]) if (p.fx) delete p.fx[bad];   // 나쁜 효과 지우기 (0x447b74~0x447bb0)
      if (e === 8) p.guard = SK.guardValue(p);
      if (e === 19 && this.fxOn(p, 19, now)) { this.fxOff(p, 19); this.near(p, { t: 'cast', id: p.id, sk: sid }); this.game.sendStat(p); return; }   // 숨기 풀기 (0x447dae)
      (p.fx ||= {})[e] = now + SK.duration(p, s) * 1000; (p.fxSk ||= {})[SK.SELF_EFFECT[s.n]] = sid;
      if (e === 17) { p.fxPow17 = p.spi; p.sp = Math.min(F.SP_MAX, p.sp + 2000); }   // Eidolon: 값 = 정신력 합 (+0x4230), 기력 + 2000 (rm3944 NewEidolonFix 0x10002d6e)
      if (e === 31) p.scarecrow = 0;                                                   // Scarecrow: 막은 횟수 (+0x4238) 를 0 으로 (0x42c1a4)
      if (SK.RECALC_FX.has(e)) this.game.recalc(p, false);
      this.sendFx(p);
    }
    this.near(p, { t: 'cast', id: p.id, sk: sid });
    this.game.sendStat(p);
  }
  fxOn(o, e, now = Date.now()) { return !!(o.fx && o.fx[e] > now); }
  fxOff(p, e) { if (p.fx && p.fx[e]) { delete p.fx[e]; if (SK.RECALC_FX.has(e)) { this.game.recalc(p, false); this.game.sendStat(p); } this.sendFx(p); } }
  sendFx(p) { const now = Date.now(); p.send({ t: 'fx', fx: Object.entries(p.fx || {}).filter(([, t]) => t > now).map(([e, t]) => [Number(e), Math.ceil((t - now) / 1000), (p.fxSk || {})[e] || 0]) }); }
  // ---------- 싸움에 쓰이는 효과 ----------
  // 효과가 더해진 민첩성: 기본 + 장비 + (효과 17·42: min(효과 값, 기본)) + (효과 22·42 이고 총: ⌊기본 × 15 ÷ 100⌋) + (효과 30: ⌊기본 ÷ 5⌋)
  // (DoAttackMop 0x46f51a~, CMopServer::Attack 0x47eed2~, UseSkillAttackRange 0x45b9cf~). 몬스터는 그냥 민첩성
  fightDex(o, now) {
    if (o.mob) return o.dex;
    const b = o.bDex || 0, on = e => this.fxOn(o, e, now);
    let v = b + (o.eqDex || 0);
    if (on(17) || on(42)) v += Math.min(o.fxPow17 || 0, b);
    if ((on(22) || on(42)) && SK.isGun(o.equip && o.equip[7])) v += Math.floor(b * 15 / 100);
    if (on(30)) v += Math.floor(b / 5);
    return v;
  }
  // 몬스터가 받는 피해 (CMopServer::GetAttack 0x47acb0 과 rm3944 NewAttackBuffsFix·NewFshieldEffect).
  //   공격자 효과 0·42·46 마다, 2(총·중화기)·25·68·77·32 마다 + ⌊피해/5⌋. 몬스터 효과 8 (효과 54 가 없을 때) 반으로, 몬스터 효과 33 이면 × 4/5. 최소 1
  //   일반 공격(normal)이면 GetSkillAttack(0x42ebf0)이 한 번 더: 효과 0·42·46 중 하나라도 + /5, 2(총·중화기) + /5, 25 + /5, 그리고 몬스터 효과 8 이면 또 반 (DoAttackMop 0x46f99b)
  mobDamage(a, dmg, now, d, normal) {
    const on = e => this.fxOn(a, e, now), up = () => { dmg += Math.floor(dmg / 5); };
    const gun = SK.isGun(a.equip && a.equip[7]), mfx = e => d && this.fxOn(d, e, now);
    for (const e of [0, 42, 46]) if (on(e)) up();
    if (on(2) && gun) up();
    if (on(25)) up();
    if (on(68)) up(); if (on(77)) up();
    if (on(32)) up();
    if (!mfx(54) && mfx(8)) dmg = Math.floor(dmg / 2);
    if (mfx(33)) dmg = Math.floor(dmg * 4 / 5);
    dmg = Math.max(1, dmg);
    if (normal) {
      if (on(0) || on(42) || on(46)) up();
      if (on(2) && gun) up();
      if (on(25)) up();
      if (!mfx(54) && mfx(8)) dmg = Math.floor(dmg / 2);
      dmg = Math.max(1, dmg);
    }
    return dmg;
  }
  // 주인공이 받는 피해 (CMapServerClient::GetAttack 0x4101f0, rm3944 NewEggEffect·NewWarcryEffect)
  //   공격 몬스터의 효과 0·25·32 마다 + /5 → 방어(효과 30 이면 + 3 × ⌊방어/10⌋ 한 번 더, 효과 54 면 7 × ⌊방어/10⌋)를 빼고 최소 1
  //   → 효과 54 가 없으면: 효과 64 면 × 25/100, 아니면 효과 8·42 면 × 값/100 → 효과 68 − /5, 70 − 30%, 71 − 40%, 72 − 40% → 효과 33 이면 × 4/5. 최소 1
  userDamage(a, d, dmg, now) {
    const on = e => this.fxOn(d, e, now), pct = (v, n) => v < 10000000 ? Math.floor(v * n / 100) : Math.floor(v / 100) * n;
    if (a && a.mob) for (const e of [0, 25, 32]) if (this.fxOn(a, e, now)) dmg += Math.floor(dmg / 5);
    let armor = d.armor || 0;
    if (on(30)) armor += Math.floor(armor / 10) * 3;
    if (on(54)) armor = Math.floor(armor / 10) * 7;
    dmg = dmg > armor ? dmg - armor : 1;
    if (!on(54)) {
      if (on(64)) dmg = pct(dmg, 25);
      else if (on(8) || on(42)) dmg = pct(dmg, d.guard || 100);
      if (on(68)) dmg -= Math.floor(dmg / 5);
      if (on(70)) dmg -= Math.floor(dmg / 100) * 30;
      if (on(71)) dmg -= Math.floor(dmg / 100) * 40;
      if (on(72)) dmg -= Math.floor(dmg / 100) * 40;
      if (on(33)) dmg = dmg < 10000000 ? Math.floor(dmg * 4 / 5) : Math.floor(dmg / 5) * 4;
    }
    return Math.max(1, dmg);
  }
  // 명중률 (GetAttackSuccessful 0x45fab0 뒤): 몬스터 효과 4 면 +25 (0x45fc3a, 최대 100), 그다음 rm3944 NewMasterEffect (0x100024d9):
  //   공격자 효과 60·76 마다 +50 (최대 100), 공격자 효과 26 이면 최대 90, 방어자 효과 44 면 ⌊/4⌋ × 3, 67 이면 ⌊/4⌋ × 2
  hitChance(a, d, base, now) {
    let h = Math.min(100, base + (this.fxOn(d, 4, now) || this.fxOn(d, 43, now) ? 25 : 0));   // 방어자 효과 4·43 이면 +25 (0x45fc44~0x45fc61)
    if (this.fxOn(a, 60, now)) h = Math.min(100, h + 50);
    if (this.fxOn(a, 76, now)) h = Math.min(100, h + 50);
    if (this.fxOn(a, 26, now)) h = Math.min(90, h);
    if (this.fxOn(d, 44, now)) h = Math.floor(h / 4) * 3;
    if (this.fxOn(d, 67, now)) h = Math.floor(h / 4) * 2;
    return h;
  }
  // 기술 한 번 (UseSkill 0x45e3xx → UseSkillAttackSingleMop 0x44d6xx → DoSkillAttackMop 0x45f890)
  // 기술 값 치르기: 특수 기술은 DP 를 0 으로, 일반 기술은 마력을 줄인다 (0x44d825~0x44d846)
  payForSkill(p, s) {
    if (s.a === 1) { if (p.dp < p.maxDp) return -1; p.dp = 0; this.game.sendStat(p); return 0; }
    const cost = SK.mpCost(s, p.maxMp);
    if (p.mp < cost) { p.send({ t: 'note', text: '마력이 부족합니다.' }); return -1; }
    p.mp -= cost; this.game.sendStat(p); return cost;
  }
  // 범위 공격 (UseSkillAttackRange 0x454600)
  castArea(p, target, s, sid, now) {
    const { rad } = SK.areaOf(sid, s, !!target);
    const center = target ? { x: target.x, y: target.y, z: target.z } : { x: p.x, y: p.y, z: p.z };
    const cost = this.payForSkill(p, s); if (cost < 0) return;
    this.fxOff(p, 1); this.fxOff(p, 19);                                            // 위장이 풀린다 (0x454956)
    if (target) { const d = G.direction(p, target); if (d !== 5) p.dir = d; }
    this.near(p, { t: 'cast', id: p.id, sk: sid, x: center.x, y: center.y, z: center.z, r: rad });
    const adb = s.a === 0 ? SK.AREA_DEBUFF[s.n] : null;
    for (const m of [...this.mobs.values()]) {
      if (m.hp <= 0 || G.dist(center, m) > rad || !this.noObstacle(center, m)) continue;
      if (adb) { this.debuffOne(p, m, s, sid, adb, now); continue; }
      let dmg;
      if (s.a === 1) dmg = SK.damage(SK.specialAttack(p.level), s.o);            // 특수: 반드시 맞음 (0x45d409)
      else {
        if (F.rand100() > this.hitChance(p, m, F.hitPct(p.spi, this.mobSpi(m, now)), now)) { this.near(p, { t: 'atk', id: p.id, tid: m.id, dir: p.dir, k: 2, sk: sid, miss: 1, hp: m.hp, area: 1 }); continue; }
        dmg = SK.damage(cost, s.o);                                               // 일반: 공격 값 = 마력 소모량 (0x45d094)
      }
      this.applyDamage(p, m, this.mobDamage(p, Math.max(1, dmg), now, m), now, { k: 2, sk: sid, area: 1 });
    }
  }
  // 몬스터 효과 54 면 GetDexterity·GetSpirit 이 0.7배 (CMopServer 0x47ae20, 0x47ae60, 상수 0x48ffc0)
  mobDex(m, now) { return this.fxOn(m, 54, now) ? Math.trunc(m.dex * 0.7) : m.dex; }
  mobSpi(m, now) { return this.fxOn(m, 54, now) ? Math.trunc(m.spi * 0.7) : m.spi; }
  // 몬스터 약화 기술 (skills.js 의 MOB_DEBUFF)
  castDebuff(p, m, s, sid, db, cost, now) { this.debuffOne(p, m, s, sid, db, now, cost); }
  debuffOne(p, m, s, sid, db, now, cost = 0) {
    const msp = this.mobSpi(m, now);
    if (SK.mobReflect(m)) {
      const r = Math.max(20, Math.min(80, Math.floor(Math.min(msp, 7000) * 3 / 350) + 20));
      if (F.rand100() < r) {                                    // 되돌아온다
        if (db.self) { (p.fx ||= {})[db.self] = now + (Math.floor(p.spi / 20) + s.p) * 1000; this.sendFx(p); }
        this.near(p, { t: 'cast', id: p.id, sk: sid, tid: p.id });
        return;
      }
    }
    const miss = () => this.near(p, { t: 'atk', id: p.id, tid: m.id, dir: p.dir, k: 2, sk: sid, miss: 1, hp: m.hp });
    if (db.hit === 'dex') { if (F.rand100() > this.hitChance(p, m, F.hitPct(this.fightDex(p, now), this.mobDex(m, now)), now)) return miss(); }
    else if (F.rand100() > this.hitChance(p, m, F.hitPct(p.spi, msp), now)) return miss();
    if (db.dmg) {                                               // n=37: 공격 값 = 마력 소모량 (+ USERDB+0x34) 로 피해를 주고 살아 있으면 건다 (0x450060)
      this.applyDamage(p, m, this.mobDamage(p, Math.max(1, SK.damage(cost, s.o)), now, m), now, { k: 2, sk: sid });
      if (m.hp <= 0) return;
    } else this.near(p, { t: 'cast', id: p.id, sk: sid, tid: m.id });
    if (db.dispel) { m.fx = {}; m.voodoo = ''; return; }
    this.mobEffect(m, db.e, (db.div ? Math.floor(p.spi / db.div) : 0) + s.p, p, now);
  }
  // 몬스터에게 효과 걸기 (CMopServer::DoSkillEffect 0x479630). 막히면 false
  mobEffect(m, e, sec, caster, now) {
    if (e !== 8 && e !== 23 && e !== 25 && e !== 26) {
      if (SK.mobImmune(m) || this.fxOn(m, 23, now)) return false;
      if (SK.mobShort(m)) sec = 5;
    }
    (m.fx ||= {})[e] = now + sec * 1000;
    if (e === 15) m.voodoo = caster ? caster.name : '';           // Voodoo: 시전자 이름 (+0x15b, CVoodooManager_Add)
    return true;
  }
  // 범위 효과 (UseSkillRangeEffect 0x453b00, rm3944 NewUseSkillRangeEffect 0x10001740)
  //   반경 R = l − 10000. 주인공을 찍었으면 그가 R 안에 있어야 하고(아니면 메시지 0x120), 중심을 그 자리로 옮기고 반경 ⌊2R/3⌋ (374번은 ⌊R/4⌋)
  //   반경 안, 막힘 없고, 살아 있는 주인공 가운데 시전자가 그룹에 있으면 같은 그룹만 (+0x21b0). rm3944 효과(76·77·84)는 그룹이 없으면 자기만
  castRangeEffect(p, target, s, sid, now) {
    const ev = this.eventAt(p.x, p.y); if (ev && ev[0] === 0x16) { p.send({ t: 'sys', code: 0x7e, args: [] }); return; }
    let rad = s.l - 10000, center = { x: p.x, y: p.y, z: p.z };
    if (target && target !== p) {
      if (G.dist(p, target) > rad) { p.send({ t: 'sys', code: 0x120, args: [] }); return; }
      center = { x: target.x, y: target.y, z: target.z }; rad = sid === 374 ? Math.floor(rad / 4) : Math.trunc(rad * 2 / 3);
    }
    if (s.n === 53) {                                           // Starlight: 효과 56 이 걸린 동안은 다시 못 씀 (+0x852 & 0x100, 메시지 0x11e)
      if (this.fxOn(p, 56, now)) { p.send({ t: 'sys', code: 0x11e, args: [] }); return; }
      (p.fx ||= {})[56] = now + (Math.floor(p.spi / 50) + s.p) * 1000;
    }
    const cost = this.payForSkill(p, s); if (cost < 0) return;
    this.near(p, { t: 'cast', id: p.id, sk: sid, x: center.x, y: center.y, z: center.z, r: rad });
    const dur = Math.floor(p.spi / 20) + s.p, guard = 100 - Math.min(50, 25 + Math.floor(p.bSpi / 100));
    const RM = { 76: 61, 77: 62, 84: 70, 91: 76 };
    for (const u of [...this.players.values()]) {
      if (u.dead || G.dist(center, u) > rad || !this.noObstacle(center, u)) continue;
      const e2 = this.eventAt(u.x, u.y); if (e2 && e2[0] === 0x16) continue;
      if (p.group && u.group !== p.group) continue;
      if (s.n in RM && !p.group && s.n !== 91 && u !== p) continue;
      const fx = (e, sec) => { (u.fx ||= {})[e] = now + sec * 1000; (u.fxSk ||= {})[e] = sid; };
      switch (s.n) {
        case 1: {                                               // 체력 + ⌊위력 × 마력 소모량 ÷ 100⌋, 정신력 1000 이상이면 보호막 (IncreaseHPShield 0x4391c0)
          u.hp = Math.min(u.maxHp, u.hp + Math.floor(s.o * cost / 100));
          if (p.spi >= 1000) { const cap = Math.floor(u.maxHp / 100) * 50; if ((u.shield || 0) < cap) u.shield = Math.min(cap, (u.shield || 0) + Math.floor(u.maxHp / 100) * Math.min(50, Math.floor(p.spi / 1000))); }
          break;
        }
        case 8: this.cureBad(u); break;                         // 나쁜 효과 지우기 (OnBadSkillExpired 0x42e6f0)
        case 11: fx(8, dur); u.guard = guard; break;            // 효과 8, 값은 시전자 기준
        case 25: fx(17, dur); u.fxPow17 = p.bSpi; u.sp = 2000; u.dp = u.maxDp; break;   // 효과 17 (값 = 시전자 기본 정신력), 기력 2000, DP 가득
        case 34: fx(25, dur); break;
        case 53: fx(42, Math.floor(p.spi / 50) + s.p); u.guard = guard; u.fxPow17 = p.bSpi; this.cureBad(u); u.sp = 2000; u.dp = u.maxDp; break;
        case 62: if (u !== p) { u.hp = u.maxHp; u.mp = u.maxMp; } break;   // Hope: 시전자 말고 모두 체력·마력 가득
        case 64: this.fxOff(u, 3); fx(53, dur); break;          // Zephyrus: 효과 3 을 풀고 효과 53
        default: if (s.n in RM) fx(RM[s.n], dur);
      }
      this.sendFx(u); this.game.sendStat(u); this.near(u, { t: 'hp', id: u.id, hp: u.hp });
    }
  }
  // 회복(n=1)·부활(n=44) (UseSkillUserCure 0x448700). 이벤트 0x16 자리에서는 회복 못 함 (메시지 0x7e)
  //   회복: 쓰는 양 = min(⌊(대상 최대 체력 − 체력) / 2⌋, 시전자 마력). 시전자 마력 − 쓰는 양, 대상 체력 + 2 × 쓰는 양.
  //         대상이 다른 사람이고 시전자 최대 마력 ≥ 1000 이면 보호막 + ⌊대상 최대 체력/100⌋ × min(50, ⌊정신력/1000⌋), 한도 50%
  //   부활: 시전자가 지금 체력의 절반을 잃고, 대상이 죽어 있으면 받을지 묻는다 (SendAskRevivalPacket 0x43a6a0, 0x109/0x11)
  cureUser(p, u, s, sid, now) {
    if (s.n === 1) {
      const e = this.eventAt(p.x, p.y); if (e && e[0] === 0x16) { p.send({ t: 'sys', code: 0x7e, args: [] }); return; }
      if (u.dead) return;
      const use = Math.min(Math.floor((u.maxHp - Math.min(u.hp, u.maxHp)) / 2), p.mp);
      p.mp -= use; u.hp = Math.min(u.maxHp, u.hp + 2 * use);
      if (u !== p && p.maxMp >= 1000) { const cap = Math.floor(u.maxHp / 100) * 50; if ((u.shield || 0) < cap) u.shield = Math.min(cap, (u.shield || 0) + Math.floor(u.maxHp / 100) * Math.min(50, Math.floor(p.spi / 1000))); }
      this.game.sendStat(p); if (u !== p) this.game.sendStat(u);
      this.near(u, { t: 'hp', id: u.id, hp: u.hp });
    } else {
      const half = Math.floor(p.hp / 2);
      if (half) { p.hp -= half; this.game.sendStat(p); this.near(p, { t: 'hp', id: p.id, hp: p.hp }); }
      if (u.dead) { u.revive = { from: p.name, hp: half }; u.send({ t: 'askrevive', name: p.name }); }
    }
    this.near(p, { t: 'cast', id: p.id, sk: sid, tid: u.id });
  }
  // 부활 대답 (ProcessResponseRevival 0x43d620): 받으면 그 자리에서 살아나 체력 + 받은 양, 거절하면 시전자에게 메시지 0x186
  reviveAnswer(p, yes) {
    const r = p.revive; if (!r) return; p.revive = null;
    if (!yes) { for (const w of this.game.worlds.values()) for (const q of w.players.values()) if (q.name === r.from) q.send({ t: 'sys', code: 0x186, args: [p.name] }); return; }
    if (!p.dead) return;
    p.dead = false; p.hp = Math.min(p.maxHp, Math.max(1, r.hp));
    const x = p.x, y = p.y; this.leave(p); this.enter(p, x, y);
    this.game.sendStat(p);
  }
  // 나쁜 효과 지우기: 5·12·14·16·18 (UseSkillAlone 0x447b74 과 같은 묶음)
  cureBad(u) { if (u.fx) for (const e of [5, 12, 14, 16, 18]) delete u.fx[e]; }
  castSkill(p, m, s, sid, now) {
    const cost = this.payForSkill(p, s); if (cost < 0) return;   // 마력은 명중 판정 전에 줄어든다 (DecreaseMP 0x44d835)
    if (s.a === 1) {                                             // 특수 기술: 반드시 맞음 (0x44f81c)
      this.fxOff(p, 1); this.fxOff(p, 19);
      const d = G.direction(p, m); if (d !== 5) p.dir = d;
      this.applyDamage(p, m, this.mobDamage(p, Math.max(1, SK.damage(SK.specialAttack(p.level), s.o)), now, m), now, { k: 2, sk: sid });
      return;
    }
    this.fxOff(p, 1); this.fxOff(p, 19); this.fxOff(p, 35);                         // 공격 기술을 쓰면 위장·19·35 가 풀린다 (0x44d873~0x44d8a6)
    const d = G.direction(p, m); if (d !== 5) p.dir = d;
    const db = SK.MOB_DEBUFF[s.n];
    if (db) { this.castDebuff(p, m, s, sid, db, cost, now); return; }
    const dex = SK.hitStat(sid) === 'dex';
    if (F.rand100() > this.hitChance(p, m, F.hitPct(dex ? this.fightDex(p, now) : p.spi, dex ? this.mobDex(m, now) : this.mobSpi(m, now)), now)) {
      this.near(p, { t: 'atk', id: p.id, tid: m.id, dir: p.dir, k: 2, sk: sid, miss: 1, hp: m.hp }); return;
    }
    const dmg = this.mobDamage(p, Math.max(1, SK.damage(SK.attackValue(sid, p, cost), s.o)), now, m);   // 몬스터 쪽 GetAttack(0x47acb0)은 걸린 효과의 배수만 곱하고 최소 1
    const before = m.hp;
    this.applyDamage(p, m, dmg, now, { k: 2, sk: sid });
    if (sid === 66 && m.hp > 0) this.mobEffect(m, 13, SK.duration(p, s), p, now);   // 몬스터 효과 13 (0x44de8c)
    if (sid === 334 && m.hp > 0) this.mobEffect(m, 14, 3, p, now);   // 몬스터 효과 14, 3초 (0x44f014). 서버의 몬스터 행동에는 쓰이지 않는다
    const dr = SK.DRAIN[sid], dealt = before - Math.max(0, m.hp);
    if (dr && dealt > 0 && !p.dead) {                            // 흡수: 몬스터 체력이 줄어든 만큼의 비율 (0x44dcb3, 0x44deee, 0x44dfa8)
      if (dr.hp) p.hp = Math.min(p.maxHp, p.hp + Math.floor(dealt * dr.hp[0] / dr.hp[1]));
      if (dr.mp) p.mp = Math.min(p.maxMp, p.mp + Math.floor(dealt * dr.mp[0] / dr.mp[1]));
      if (dr.sp) p.sp = Math.min(F.SP_MAX, p.sp + Math.floor(dealt * dr.sp[0] / dr.sp[1]));
      this.game.sendStat(p);
    }
  }
  // 이야기 퀘스트가 걸린 NPC (CMapServerClient::ProcessEvent 0x41ee70 의 종류 27·28·29·41·44). 처리했으면 true
  storyNpc(p, n, kind, e) {
    const R = STORY.ready, ev = this.script;
    if (kind === 27 && R.gogo(p)) { ev.named(p, 'GoGoQuest', n); return true; }              // 고고학자: 차례가 아니면 상점 (0x420d0b)
    if (kind === 28 && R.sahara(p)) { ev.named(p, 'SaharaMiniMapQuest', n); return true; }   // 지리학자
    if (kind === 29) {                                                                         // 카삼 (0x4216b0)
      const say = c => p.send({ t: 'chat', id: n.id, name: n.name, text: this.script.line(c), npc: 1 });
      if (R.kasam1(p)) ev.named(p, 'KasamQuest1', n);
      else if (R.esper(p) || (!R.kasam2(p) && !R.kasam3(p) && R.captain(p))) say(0x296);     // "일을 마치고 오게"
      else if (R.kasam2(p)) ev.named(p, 'KasamQuest2', n);
      else if (R.kasam3(p)) ev.named(p, 'KasamQuest3', n);
      else if (R.kasam4(p)) ev.named(p, 'KasamQuest4', n);
      else if (R.recollect(p)) ev.named(p, 'KasamRecollectQuest', n);
      else if (R.spaceship(p)) ev.named(p, p.chr === 3 ? 'DestinoKasamSpaceShip' : 'KasamSpaceShip', n);
      else say(0x297);                                                                         // 레벨 1000 보너스 퀘스트는 아직 없다
      return true;
    }
    if (kind === 41 && e) {                                                                    // 이벤트 번호를 직접 가리킨다 (0x421e60)
      if (e[1] >= 0x45 && e[1] <= 0x48 && [0x5d, 0x5e, 0x5f, 0x60].includes(this.mapId) && this.mobs.size) this.game.story.msg(p, 0xcf);
      else ev.startAt(p, e[1], n);
      return true;
    }
    if (kind === 44) {                                                                         // 회상 퀘스트: 직업마다 다른 이벤트 (0x421f9e)
      if ((p.story || 0) & 0x2000) this.game.story.msg(p, 200);
      else if ((p.story || 0) & 0x1000) { const c = ['Philar', 'Azlar', 'Sadad', 'Destino', 'Park', 'Canon', 'Han', 'Lunarena', 'Lavita'][p.chr]; ev.named(p, (c || '') + 'RecollectQuest', n); }
      return true;
    }
    return false;
  }
  // 맵 79 → 83 이동 지점: 카삼 4 를 마쳐야 하고, 회상 이야기를 듣고, 카삼 회상까지 마쳐야 지나간다 (0x41f2f0)
  storyGate(p, to) {
    if (this.mapId !== 79 || to !== 83) return true;
    const s = p.story || 0;
    if (!(s & 0x400)) { this.game.story.msg(p, 0x75); return false; }
    if (!(s & 0x800)) { this.script.named(p, 'SayKasamRecollect'); return false; }
    if (!(s & 0x1000)) { this.game.story.msg(p, 0xb0); return false; }
    return true;
  }
  // NPC에게 말 걸기: 옆까지 걸어가면 그 NPC에 연결된 이벤트가 실행된다
  talkCmd(p, id, run) {
    const n = this.npcs.find(q => q.id === id); if (p.dead || !n) return;
    // 서버는 NPC와의 거리가 25 미만이면 이벤트를 받아 준다 (CExtraServer::IsExistExtraEvent 0x406815). 그보다 멀면 걸어간다
    if (G.dist(p, n) >= TALK_DIST) { const pa = this.findPath(p, n, 1500); if (!pa) return; pa.pop(); p.path = pa; }
    p.run = !!run; p.target = 0; p.cast = null; p.pick = 0; p.talk = id;
  }
  tryTalk(p) {
    const n = this.npcs.find(q => q.id === p.talk);
    if (!n) { p.talk = 0; return; }
    if (G.dist(p, n) >= TALK_DIST) { if (!p.path.length) p.talk = 0; return; }
    p.talk = 0; p.path = [];
    // NPC의 이벤트 번호는 맵의 이벤트가 아니라 공용 표(EventInfo.rse)를 가리킨다 (CMapServerClient::ProcessEvent 0x41ee70)
    const e = this.game.gEvents[n.event], kind = e ? e[0] : 0;
    if (this.storyNpc(p, n, kind, e)) return;
    if ((SHOP_KINDS.includes(kind) || kind === 27 || kind === 28) && this.game.shops[e[1]]) { this.game.openShop(p, e[1], n); return; }
    if (kind === 8 || kind === 81) { this.game.cure(p, n); return; }
    if (kind === 6 || kind === 80) { this.game.openBank(p, n); return; }
    if (kind === 20) { this.game.openExchange(p, e[1] || 0, n); return; }
    const what = EVENT_NAMES[kind];
    p.send({ t: 'chat', id: 0, name: n.name, text: what ? `(${what}: 아직 구현되지 않았습니다)` : '...' });
  }

  // ---------- 바닥 아이템 ----------
  dropItem(at, it) {
    const info = this.game.itemInfo(it[0], it[1]); if (!info) return;
    const g = { id: this.game.nextId++, k: it[0], i: it[1], n: it[2], x: at.x, y: at.y, z: at.z, name: info.name, icon: info.icon };
    this.ground.set(g.id, g); this.broadcast({ t: 'gadd', g });
    this.after(GROUND_ITEM_MS, () => { if (this.ground.delete(g.id)) this.broadcast({ t: 'gdel', id: g.id }); });
  }
  // 줍기: 아이템이 놓인 자리까지 걸어가서 줍는다
  pickupCmd(p, id, run) {
    const g = this.ground.get(id); if (p.dead || !g) return;
    if (this.fxOn(p, 9)) { p.path = []; p.target = 0; p.cast = null; p.pick = id; p.talk = 0; return; }   // 효과 9: 걸어가지 않고 줍는다
    const pa = this.findPath(p, g, 1500); if (!pa) return;
    p.path = pa; p.run = !!run; p.target = 0; p.cast = null; p.pick = id; p.talk = 0;
  }
  tryPickup(p) {
    const g = this.ground.get(p.pick);
    if (!g) { p.pick = 0; return; }
    if (!G.same(g, p) && !this.fxOn(p, 9)) return;              // 효과 9: 떨어진 곳의 아이템도 줍는다 (ProcessGetItem 0x42edda)
    p.pick = 0; p.path = [];
    const took = this.game.giveItem(p, g.k, g.i, g.n);
    if (took >= g.n) { this.ground.delete(g.id); this.broadcast({ t: 'gdel', id: g.id }); } else g.n -= took;
  }
  // 대화 (CMapServerClient::ProcessChat 0x441070)
  //  보통: 5초에 세 번까지 (최근 세 번의 시각, ProcessNormalChat 0x441150). 주변에
  //  외치기: 10초에 세 번까지, 레벨 5 부터 (아니면 0/2/0x17), 같은 맵 모두에게 (ProcessLoudChat 0x441280, CMapServerServer::ProcessLoudChat 0x473820)
  //  귓속말: 이름이 없으면 0/2/0x11, 감옥(맵 78)에서는 0/2/0xac (ProcessWhisperChat 0x4413f0, ProcessWhisperFailed 0x474030)
  rateOk(p, key, ms) { const q = (p[key] ||= [0, 0, 0]); const now = Date.now(); if (q[0] && now > q[0] && now - q[0] < ms) return false; q.shift(); q.push(now); return true; }
  chat(p, text) {
    text = String(text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, CFG.maxChat);
    if (!text || !this.rateOk(p, 'chatAt', 5000)) return;
    this.near(p, { t: 'chat', id: p.id, name: p.name, text });
  }
  shout(p, text) {
    text = String(text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, CFG.maxChat);
    if (!text || !this.rateOk(p, 'shoutAt', 10000)) return;
    if (p.level < 5) { this.game.story.msg(p, 0x17, 5); return; }
    this.broadcast({ t: 'chat', id: p.id, name: p.name, text, kind: 'shout' });
  }
  whisper(p, to, text) {
    text = String(text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, CFG.maxChat); to = String(to || '').trim();
    if (!text || !to || to === p.name) return;
    if (this.mapId === 78) { this.game.story.msg(p, 0xac); return; }
    const q = this.game.findOnline(to);
    if (!q) { this.game.story.msg(p, 0x11, to); return; }
    if (q.world.mapId === 78) { this.game.story.msg(p, 0xab, q.name); return; }   // 받는 사람이 감옥에 있으면 0/2/171
    const m = { t: 'chat', id: p.id, name: p.name, to: q.name, text, kind: 'whisper' };
    p.send(m); q.send(m);
  }

  // ---------- 몬스터 ----------
  // 배치표의 영역 좌표를 그대로 써서 자리를 고른다 (CMopServer::LoadMop 0x4773ac)
  spawnMob(s, sid) {
    const info = this.game.mopInfo[s.kind];
    const t = this.findFirstEmptyPlace(s.rect, q => this.canMop(q)); if (!t) return null;
    const st = F.mobStats(info, s.pattern);
    const m = { id: this.game.nextId++, mob: 1, sid, s, info, pattern: s.pattern, home: t, name: s.name, chr: spriteOf(info.img), x: t.x, y: t.y, z: t.z, dir: G.DIRS[rnd(8)],
      str: st.str, spi: st.spi, dex: st.dex, pow: st.pow, atk: st.atk, minPct: st.minPct, maxHp: st.maxHp, hp: st.maxHp, exp: st.exp,
      // 사거리는 두 공격 범위 중 큰 값 (CMopInfo::LoadMopInfo 0x475f63)
      maxRange: Math.max(info.range, info.range2 || 0),
      // 배치표의 아이템 칸 다섯 중 하나를 무작위로 지닌다. 빈 칸이면 아무것도 없다 (InitializeMopInstance 0x4795a3)
      item: s.drops[rnd(5)] || null,
      cnt: 0, delay: 0, targetName: '', warpState: 0, warpCnt: 0 };
    this.mobs.set(m.id, m); if (!info.noOccupy) this.take(m);
    return m;
  }

  // 지정한 대상이 공격할 수 있는 방향에 있는지 (CMopServer::GetCanAttackDir 0x47d560)
  canAttackDir(m, u) {
    const { dir1, dir2 } = m.info; if (!dir1 || !dir2) return true;
    const d = G.direction(m, u); let on = false;
    for (const c of G.CLOCKWISE) { if (c === dir1) on = true; if (on) { if (c === d) return true; if (c === dir2) return false; } }
    return true;
  }
  // 주인공 쪽에서 몬스터 쪽으로 한 걸음씩 가 보아 막힌 곳이 없는지 (CrsMap::NoObstacle 0x486030)
  noObstacle(from, to) {
    let a = pos(from);
    for (let i = 0; i < 64; i++) {
      if (G.dist(a, to) <= 1) return true;
      a = G.next(a, G.direction(a, to));
      if (!this.canUser(a)) return false;
    }
    return false;
  }
  // 몬스터가 그 주인공을 알아볼 수 있는지 (CMopServer::GetCanRecognize 0x47d630)
  canRecognize(m, u) {
    if (!this.noObstacle(u, m) || !this.canAttackDir(m, u)) return false;
    const e = this.eventAt(u.x, u.y); if (e && (e[0] === EV_SAFE || e[0] === EV_NO_ATTACK)) return false;
    if (u.dead) return false;
    if (u.name.includes('운영자')) return false;
    // 명성 값이 양수인 몬스터는 명성이 양수인 주인공을, 음수인 몬스터는 음수인 주인공을 건드리지 않는다
    const f = m.info.fame || 0; if ((f > 0 && u.fame > 0) || (f < 0 && u.fame < 0)) return false;
    if (m.info.img === 87) return false;
    if (this.fxOn(m, 47)) return false;                         // 몬스터 효과 47: 아무도 알아보지 못함 (0x47d7c0)
    // 위장(효과 1): 몬스터 정신력이 2 × 주인공 정신력 이하면 알아보지 못한다. 원작 값은 DB 정신력(+0x4364)과 효과 값(+0x432c, 이 기술은 0)
    // 효과 26 Invisibility (그림 0x9b 몬스터 제외, rm3944 NewCanRecognize 0x10003677)·35 Hide·19 숨기면 알아보지 못한다 (0x47d70a~0x47d743). 그림 0x62·0x61 몬스터는 이 셋을 건너뛴다
    const img = m.info.img;
    if (img !== 0x62 && img !== 0x61) {
      if (img !== 0x9b && this.fxOn(u, 26)) return false;
      if (this.fxOn(u, 35) || this.fxOn(u, 19)) return false;
    }
    if (this.fxOn(u, 1) && m.spi <= 2 * (u.bSpi ?? u.base.spi)) return false;
    return true;
  }
  // 몬스터 주변의 관리 영역: 가로 ±10칸, 세로 ±13칸 (CMapServerServer::SetManagementRect 0x468220)
  inMgmt(m, u) {
    const xo = this.w <= 21 || (u.x >= Math.max(0, m.x - 10) && u.x <= Math.min(m.x + 10, this.w - 1));
    const yo = this.h <= 27 || (u.y >= Math.max(0, m.y - 13) && u.y <= Math.min(m.y + 13, this.h - 1));
    return xo && yo;
  }
  // 다음에 할 일을 고른다. 돌려주는 값: 0 없음, 1 배회, 2 쫓기, 3·5·6 공격, 4 유인된 쫓기 (CMopServer::FindNextAction 0x47cc60)
  // 원작에는 기술에 걸린 상태(혼란·은신·도발 등)에 따른 갈래가 더 있다. 기술이 아직 없어서 그 갈래는 옮기지 않았다.
  findNextAction(m) {
    // 몬스터에게 걸린 효과 (FindNextAction 0x47cd9e~0x47ce8b): 13·43 이면 사거리 1. 5·16·18·43 이면 공격 못 함.
    // 거기에 12·13 이면 쫓지 못하고, 12 면 돌아다니지도 못함
    const on = e => this.fxOn(m, e);
    const info = m.info, R = on(13) || on(43) ? 1 : m.maxRange, canMove = info.speed > 0;
    const canAtk = !on(5) && !on(16) && !on(18) && !on(43), canChase = canAtk && !on(12) && !on(13), canWander = canAtk && !on(12) && canMove;
    if (m.targetName) {       // 기억해 둔 대상이 있으면 먼저 본다
      let u = null; for (const q of this.players.values()) if (q.name === m.targetName) { u = q; break; }
      if (u && this.inMgmt(m, u)) {
        const rec = this.canRecognize(m, u);
        if (G.dist(m, u) <= R && rec && canAtk) return [3, u];
        if (rec && canMove && canChase) return [2, u];
      }
      m.targetName = '';
    }
    let best = 0, bu = null;
    for (const u of this.players.values()) {
      if (!this.inMgmt(m, u)) continue;
      if (m.pattern === 3 && !u.activated) continue;   // 패턴 3은 대본의 ActivateUser 로 표시된 주인공만 노린다 (0x47cfaa, +0x4340)
      if (info.img === IMG_WARPER) return [1, u];
      const d = G.dist(m, u), rec = this.canRecognize(m, u);
      const e = this.eventAt(u.x, u.y), lure = !!e && e[0] === EV_LURE;
      if (lure && d <= Math.min(R, 10) && rec && canAtk) return [6, u];
      if (best < 5 && d <= 1 && rec && canAtk) { best = 5; bu = u; continue; }
      // 주인공 효과: 유인(21)이면 8칸 안에서 다가오고, 공포(20)면 4칸 안에서 (몬스터 정신력 ≤ 2 × 주인공 정신력일 때) 달아난다
      const free13 = canChase && canWander, notImmune = info.img !== 0x62;
      if (best < 4 && notImmune && this.fxOn(u, 21) && d <= 8 && free13 && rec && canMove) { best = 4; bu = u; m.fear = false; continue; }
      if (best < 4 && notImmune && this.fxOn(u, 20) && m.spi <= 2 * u.base.spi && d <= 4 && free13 && rec && canMove) { best = 4; bu = u; m.fear = true; continue; }
      if (best < 4 && lure && d <= 10 && rec && canMove && free13) { best = 4; bu = u; m.fear = false; continue; }
      if (best < 3 && d <= R && rec && canAtk) { best = 3; bu = u; }
      else if (best < 2 && d <= info.sight && rec && canChase && canWander) { best = 2; bu = u; }
      else if (best < 1 && canWander) { best = 1; bu = u; }
    }
    return [best, bu];
  }
  // 한 걸음 (CNPCServer::MoveDir 0x482b50). to 가 있으면 일부 종류는 그 자리로 곧장 옮겨 간다
  npcMove(m, dir, to, jump) {
    const img = m.info.img; let n;
    if (to && jump && (img === 76 || img === 78 || img === 98)) n = img === 98 && !(G.dist(m, to) >= 8 && rnd(3) === 0) ? G.next(m, dir) : pos(to);
    else n = G.next(m, dir);
    if (!m.info.noOccupy) {
      const ok = q => this.canMop(q) && this.free(q) && !G.same(q, m);
      if (!ok(n)) {
        if (!jump) return false;
        let found = false;
        for (let c = 0; !found; c++) {       // 건너뛰는 종류: 같은 방향으로 열 걸음까지 더 나아가며 빈 자리를 찾는다
          if (n.x <= 0 || n.x >= this.w || n.y <= 0 || n.y >= this.h || c >= 10) return false;
          n = G.next(n, dir);
          if (ok(n)) found = true; else { n.z = n.z ? 0 : 1; if (ok(n)) found = true; }
        }
      }
    }
    if (n.x < 0 || n.x >= this.w || n.y < 0 || n.y >= this.h) return false;
    const near = G.dist(m, n) <= 1, dur = stepMs(dir, false);
    this.release(m); m.x = n.x; m.y = n.y; m.z = n.z; m.dir = dir; if (!m.info.noOccupy) this.take(m);
    this.near(m, near ? { t: 'step', id: m.id, x: n.x, y: n.y, z: n.z, dir, dur, run: 0, last: 1 } : { t: 'pos', id: m.id, x: n.x, y: n.y, z: n.z, dir });
    return true;
  }
  // 정한 방향으로 한 걸음 (CMopServer::MoveDir 0x47d880)
  moveDir(m, dir, delay) { m.delay = delay; this.npcMove(m, dir, null, IMG_JUMP_DIR.includes(m.info.img)); }
  // 목표 쪽으로 한 걸음. 막혔으면 시계 방향으로 돌려 가며 일곱 번 더 해 본다 (CMopServer::MoveDir 0x47d8e0, CNPCServer::MoveDir 0x482f40)
  moveToward(m, to, delay) {
    m.delay = delay;
    let dir = G.direction(m, to); if (dir === 5) dir = G.randomDir();
    const jump = IMG_JUMP_TO.includes(m.info.img);
    if (this.npcMove(m, dir, to, jump)) return;
    for (let i = 0; i < 7; i++) { dir = G.ROTATE[dir]; if (this.npcMove(m, dir, to, jump)) return; }
  }
  // 대상에게서 멀어지는 방향으로 한 걸음
  flee(m, u, delay) { let dir = G.direction(u, m); if (dir === 5) dir = G.randomDir(); this.moveDir(m, dir, delay); }
  // 열다섯에 둘은 목표 쪽으로, 여덟은 아무 방향으로 한 걸음, 다섯은 1초 쉰다 (DoNextAction 0x47c243, 0x47c413)
  roam(m, to, towardDelay) {
    const r = rnd(15);
    const t400 = T400 * (this.fxOn(m, 55) ? 2 : 1);              // 몬스터 효과 55: 대기 단위 두 배 (DoSkillEffect 0x47a0f0)
    if (r === 0 || r === 5) { this.moveToward(m, to, towardDelay); m.delay = t400; }
    else if (r <= 9) this.moveDir(m, r, t400);
    else m.delay = Math.floor(1000 / MOB_TICK);
  }
  // 공격. 두 공격 중 하나를 반반으로 고르고, 닿는 쪽으로 친다. 다음 행동까지는 그 공격의 간격만큼 기다린다 (CMopServer::DoAttack 0x47dd70)
  // 기술을 가진 몬스터는 원작에서 기술을 섞어 쓴다. 기술이 아직 없어서 일반 공격만 한다.
  mobAttack(m, u, now) {
    const info = m.info, d = G.dist(m, u), r1 = info.range, r2 = info.range2 || 0;
    if (d > r1 && d > r2) return false;
    if (d > 1 && this.fxOn(m, 13, now)) return false;           // 효과 13: 공격 사거리 1 (FindNextAction 0x47cffd)
    const second = rnd(20) > 9 ? d <= r2 : d > r1;
    m.delay = Math.ceil((second ? info.interval2 : info.interval) / MOB_TICK);
    const dir = G.direction(m, u); if (dir !== 5) m.dir = dir;
    this.hit(m, u, now, second ? 1 : 0);
    return true;
  }
  // 몬스터 한 마리의 행동 (CMopServer::DoNextAction 0x47be90)
  mobAct(m, now) {
    const info = m.info, [act, u] = this.findNextAction(m), t200 = T200 * (this.fxOn(m, 55) ? 2 : 1), step = info.speed * t200, canMove = info.speed > 0;
    // 패턴 2: 처음 본 대상을 기억해 두고 계속 그 대상을 쫓는다 (원작은 이때 외치는 말도 내보낸다)
    if (m.pattern === 2 && act >= 2 && !m.targetName && u) m.targetName = u.name;
    if (info.img === IMG_WARPER) {      // 3초 돌아다니고 근처로 순간이동하기를 세 번, 그다음 3초 멈춘다 (멈춘 뒤의 범위 기술은 아직 없다)
      if (act !== 1) return;
      const spent = MOB_TICK * T200 * info.speed * m.warpCnt;
      if (m.warpState < 0 || m.warpState > 3) m.warpState = 0;
      else if (m.warpState <= 2) {
        if (spent < 3000) { this.moveDir(m, G.randomDir(), step); m.warpCnt++; }
        else {
          const r = [m.x > 12 ? m.x - 12 : 0, m.x > 12 ? m.y - 12 : 0, m.x + 12, m.y + 12];   // 0x47d950
          const t = this.findFirstEmptyPlace(r, q => this.canMop(q)); if (t) this.moveToward(m, t, step);
          m.warpState++; m.warpCnt = 0;
        }
      } else if (spent < 3000) m.warpCnt++;
      else { m.warpCnt = 0; m.warpState = 0; m.delay = Math.ceil((info.skillMs || 0) / MOB_TICK); }
      return;
    }
    switch (act) {
      case 6: if (this.mobAttack(m, u, now) || !canMove) return;
        if (m.pattern === 1) this.flee(m, u, step); else this.moveToward(m, u, step); return;
      case 3: case 5: if (this.mobAttack(m, u, now) || !canMove) return;
        if (m.pattern === 1) this.flee(m, u, step); else if (m.pattern === 6) this.roam(m, u, step); else this.moveToward(m, u, step); return;
      case 4: if (m.fear && this.fxOn(u, 20)) this.flee(m, u, step); else this.moveToward(m, u, step); return;   // 공포면 달아난다 (DoNextAction 0x47c13f)
      case 2: if (m.pattern === 1) this.flee(m, u, step); else if (m.pattern === 6) this.roam(m, u, step); else this.moveToward(m, u, step); return;
      case 1: if (!IMG_STILL.includes(info.img)) this.roam(m, m.home, T400 * (this.fxOn(m, 55) ? 2 : 1)); return;
    }
  }

  // ---------- 전투 ----------
  // 공격 총알 그림 번호. 주인공은 무기의 +0x57 (Main.dll 0x1002adfc 에서 공격 꾸러미에 싣는다),
  // 몬스터는 공격 1·2 마다 MopInfo 의 총알 번호 (bullet, bullet2). 0 이면 총알 없음
  attackBul(a, kind) {
    if (a.mob) return (kind ? a.info.bullet2 : a.info.bullet) || 0;
    const w = a.equip && a.equip[7], r = w && this.game.itemBul[w.k] && this.game.itemBul[w.k][w.i];
    return (r && r.bul) || 0;
  }
  hit(a, d, now, kind = 0) {
    const bul = this.attackBul(a, kind);
    // 치명타면 반드시 맞고 피해 2배, 아니면 명중 판정. 민첩성은 효과를 더한 값 (fightDex)
    //   주인공 공격 (DoAttackMop 0x46f4f0): 기본 10, CRIT15 무기면 15. 효과 34 Snipe 이고 총이면 + 50 (몬스터 그림 98 이면 + 10)
    //   몬스터 공격 (CMopServer::Attack 0x47eea0): 기본 10, 몬스터 그림 0x35·0x3b·0x3c 면 25
    //   방어하는 주인공이 효과 44 Holy Shield 면 민첩성 + ⌊민첩성/5⌋ (0x47f1f4~0x47f45a, 명중 판정에만)
    const aDex = this.fightDex(a, now), dDex = d.mob ? this.mobDex(d, now) : this.fightDex(d, now);   // 맞는 몬스터는 GetDexterity (효과 54 면 0.7배)
    let cp;
    if (a.mob) cp = F.critPct(aDex, dDex, [0x35, 0x3b, 0x3c].includes(a.info.img) ? 25 : 10);
    else {
      const w = a.equip && a.equip[7];
      cp = F.critPct(aDex, dDex, SK.isCrit15(w) ? 15 : 10, true);
      if (this.fxOn(a, 34, now) && SK.isGunOnly(w)) cp += d.mob && d.info.img === 98 ? 10 : 50;
      cp = Math.max(0, Math.min(100, cp));
    }
    const crit = F.rand100() < cp;
    const defDex = !d.mob && this.fxOn(d, 44, now) ? dDex + Math.floor(dDex / 5) : dDex;
    if (!a.mob) { this.fxOff(a, 1); this.fxOff(a, 19); this.fxOff(a, 35); }            // 공격하면 효과 1 위장·19·35 Hide 가 풀린다 (ProcessUserAttack 0x43a931, 0x43a958)
    if (!crit && F.rand100() > this.hitChance(a, d, F.hitPct(aDex, defDex), now)) { this.near(a, { t: 'atk', id: a.id, tid: d.id, dir: a.dir, k: kind, miss: 1, hp: d.hp, bul }); return; }
    let dmg = Math.max(1, F.rollDamage(a.atk, a.minPct) * (crit ? 2 : 1));
    if (!d.mob) dmg = this.userDamage(a, d, dmg, now);
    if (a.mob && !d.mob && this.fxOn(d, 6, now)) {             // 효과 6: 체력 대신 마력 (CMopServer::Attack 0x47f58f)
      d.mp = Math.max(0, d.mp - (2 * dmg + Math.floor(dmg / 4))); d.hitAt = now;
      this.near(a, { t: 'atk', id: a.id, tid: d.id, dir: a.dir, dmg, hp: d.hp, k: kind, crit: crit ? 1 : 0, bul });
      if (!d.mp) this.fxOff(d, 6);
      this.game.sendStat(d); return;
    }
    if (d.mob && !a.mob) dmg = this.mobDamage(a, dmg, now, d, true);
    // 효과 45 Damned Armor: 몬스터에게 맞으면 그 피해의 절반을 몬스터에게 돌려준다 (그림 98 몬스터 제외, CMopServer::Attack 0x47f555~)
    const reflect = a.mob && !d.mob && this.fxOn(d, 45, now) && a.info.img !== 98 ? Math.floor(dmg / 2) : 0;
    this.applyDamage(a, d, dmg, now, { k: kind, crit: crit ? 1 : 0, bul });
    if (reflect && a.hp > 0 && this.mobs.has(a.id)) this.applyDamage(d, a, reflect, now, { k: 4, reflect: 1 });
  }
  applyDamage(a, d, dmg, now, extra) {
    if (!d.mob && dmg > 0 && this.fxOn(d, 31, now)) {           // 효과 31 Scarecrow: 처음 세 번은 피해 0, 세 번째에 풀린다 (CMapServerClient::DecreaseHP 0x43922e)
      if ((d.scarecrow || 0) < 3) { dmg = 0; d.scarecrow = (d.scarecrow || 0) + 1; }
      if (d.scarecrow > 2) this.fxOff(d, 31);
    }
    if (!d.mob && d.shield && dmg > 0) {                         // 보호막 (+0x439c) 이 먼저 깎인다 (DecreaseHP 0x43925e)
      if (d.shield < dmg) { dmg -= d.shield; d.shield = 0; } else { d.shield -= dmg; dmg = 0; }
    }
    const before = d.hp;
    d.hp = Math.max(0, d.hp - dmg); d.hitAt = now;
    if (!d.mob && d.hp < before) {
      this.fxOff(d, 35);                                         // 효과 35 Hide: 체력이 줄면 풀린다 (0x439349)
      // Voodoo (몬스터 효과 15): 시전자가 잃은 체력만큼 그 몬스터도 잃는다. 단 최대 체력의 1/10 아래로는 내려가지 않고, 이미 그 아래면 그대로 (ProcessVoodoo 0x4601f0)
      const loss = before - d.hp;
      for (const v of this.mobs.values()) if (v.voodoo === d.name && this.fxOn(v, 15, now)) {
        const floor = Math.floor(v.maxHp / 10);
        if (v.hp > floor) { v.hp = Math.max(floor, Math.min(v.hp, v.maxHp) - loss); this.near(v, { t: 'hp', id: v.id, hp: v.hp }); }
      }
    }
    if (!d.mob) { d.dp = Math.min(d.maxDp, (d.dp || 0) + dmg); this.game.sendStat(d); }   // 맞은 만큼 DP 가 찬다 (CMapServerClient::DecreaseHP 0x43935f)
    if (d.mob && !a.mob) { const dd = G.direction(d, a); if (dd !== 5) d.dir = dd; }   // 맞은 몬스터는 공격자를 본다 (DoSkillAttackMop 0x45f8d3)
    this.near(a, { t: 'atk', id: a.id, tid: d.id, dir: a.dir, dmg, hp: d.hp, ...extra });
    if (d.hp > 0) return;
    this.broadcast({ t: 'die', id: d.id });
    if (d.mob) {
      this.release(d); this.mobs.delete(d.id);
      if (d.item) this.dropItem(d, d.item);
      this.after(d.s.regen * 1000, () => { const n = this.spawnMob(d.s, d.sid); if (n) this.broadcast({ t: 'madd', m: pubM(n) }); });
      if (!a.mob) { if (!this.game.groups.shareExp(a, d, d.exp)) this.game.gainExp(a, d.exp); this.script.killed(a, d.sid, d); }
    } else {
      if (d.trade) this.game.trades.cancel(d);
      d.dead = true; d.target = 0; d.cast = null; d.path = []; d.pick = 0; d.talk = 0;
      this.game.deathPenalty(d);
    }
  }

  // 50ms마다 호출
  tick(now) {
    for (let i = this.timers.length - 1; i >= 0; i--) if (now >= this.timers[i].at) { const t = this.timers.splice(i, 1)[0]; t.fn(); }
    if (!this.players.size) { this.mobTickAt = now + MOB_TICK; return; }
    this.script.tickAmbient(now);
    for (const p of [...this.players.values()]) {
      if (p.dead) continue;
      this.script.tickPlayer(p, now); if (p.world !== this) continue;
      // 자연 회복: 10초마다. 기력이 덜 찼으면 기력만, 가득 찼으면 체력, 그다음 마력
      if (now >= p.regenAt) {
        p.regenAt = now + F.REGEN_MS;
        if (p.sp < F.SP_MAX) { p.sp = Math.min(F.SP_MAX, p.sp + F.spRegen(p.pow, p.steps)); p.steps = 0; this.game.sendStat(p); }
        else if (p.hp < p.maxHp) { p.hp = Math.min(p.maxHp, p.hp + F.hpRegen(p.maxHp, p.chr)); this.near(p, { t: 'hp', id: p.id, hp: p.hp }); this.game.sendStat(p); }
        else if (p.mp < p.maxMp) { const e = this.eventAt(p.x, p.y); p.mp = Math.min(p.maxMp, p.mp + F.mpRegen(p.maxMp, !!e && e[0] === F.EV_MP_REST)); this.game.sendStat(p); }
      }
      if (p.target) {
        const m = this.mobs.get(p.target);
        if (!m) p.target = 0;
        else if (G.dist(p, m) <= p.range + (this.fxOn(p, 11, now) && SK.isGun(p.equip[7]) ? 2 : 0)) {   // 효과 11: 총을 들었을 때 사거리 + 2
          p.path = [];
          if (now >= p.atkAt && now >= p.nextAt) { const d = G.direction(p, m); if (d !== 5) p.dir = d; p.atkAt = now + this.game.attackMs(p); this.hit(p, m, now); }
        } else if (now >= p.repathAt) {
          p.repathAt = now + 400;
          const pa = this.findPath(p, m, 1500);
          if (pa) { pa.pop(); p.path = pa; } else p.target = 0;
        }
      }
      if (p.fx) { let ch = false, rc = false; for (const e in p.fx) if (p.fx[e] <= now) { delete p.fx[e]; ch = true; if (SK.RECALC_FX.has(+e)) rc = true; } if (rc) { this.game.recalc(p, false); this.game.sendStat(p); } if (ch) this.sendFx(p); }   // 효과 시간 끝 (OnSkillEffectExpired)
      if (p.cast) {
        const m = this.mobs.get(p.cast.id), s = SK.get(p.cast.sid);
        if (!m || !s) p.cast = null;
        else if (s.l >= 10000 ? G.dist(p, m) <= s.l - 10000 : G.dist(p, m) <= s.l && this.noObstacle(p, m)) {
          p.path = [];
          if (now >= (p.skillAt || 0) && now >= p.nextAt) {
            const sid = p.cast.sid; p.cast = null; p.skillAt = now + SK.USE_MS;
            if (s.l >= 10000) this.castArea(p, m, s, sid, now); else this.castSkill(p, m, s, sid, now);
          }
        } else if (now >= p.repathAt) {
          p.repathAt = now + 400;
          const pa = this.findPath(p, m, 1500);
          if (pa) { pa.pop(); p.path = pa; } else p.cast = null;
        }
      }
      if (p.pick && now >= p.nextAt) this.tryPickup(p);
      if (p.talk && now >= p.nextAt) { this.tryTalk(p); if (p.world !== this) continue; }
      if (!p.path.length || now < p.nextAt) continue;
      const n = p.path.shift();
      // 갈 수 없거나 누가 서 있는 자리면 멈춘다 (한 자리에는 하나만: CrsMap::Move 0x486480)
      if (!this.canUser(n) || !this.free(n, p.id)) { p.path = []; continue; }
      // 달리면 걸음마다 기력이 들고 회복 시계가 처음부터 다시 돈다. 걸으면 걸음 수만 센다 (ProcessUserMoving 0x43da90~0x43dc35)
      let running = p.run && p.sp > 0;
      if (running && this.fxOn(p, 62, now)) { p.steps = 0; }      // 효과 62 Unlimited Stamina: 달려도 기력이 줄지 않는다 (rm3944 NewStaminaEffect 0x100025c4)
      else if (running) { const c = F.runCost(p.dex); p.sp = p.sp > c ? p.sp - c : 0; p.regenAt = now + F.REGEN_MS; p.steps = 0; if (++p.spSent % 4 === 0 || !p.sp) this.game.sendStat(p); }
      else p.steps++;
      this.fxOff(p, 34);                                          // 효과 34 Snipe: 움직이면 풀린다 (ProcessUserMoving 0x43da7a)
      const dir = G.direction(p, n), dur = stepMs(dir, running);
      this.release(p); if (dir !== 5) p.dir = dir; p.x = n.x; p.y = n.y; p.z = n.z; p.nextAt = now + dur; this.take(p);
      this.near(p, { t: 'step', id: p.id, x: n.x, y: n.y, z: n.z, dir: p.dir, dur, run: running ? 1 : 0, last: p.path.length ? 0 : 1 });
      this.script.moved(p); if (p.world !== this) continue;
      // 맵 이동 지점을 밟으면 다른 맵으로 넘어간다
      const e = this.eventAt(n.x, n.y);
      if (e && e[0] === EV_WARP) {
        if (!this.storyGate(p, e[1])) { p.path = []; continue; }
        const w = this.game.world(e[1]);
        if (w) { this.leave(p); w.enter(p, e[2], e[3]); console.log(`[이동] ${p.name}: ${this.name} → ${w.name}`); }
      }
    }
    // 몬스터: 250ms마다 한 번씩 세고, 센 수가 대기 값에 이르면 행동한다 (CMopServer::ProcessDoSomethingMop 0x47aff7)
    if (now - this.mobTickAt > 4 * MOB_TICK) this.mobTickAt = now;
    while (now >= this.mobTickAt) {
      this.mobTickAt += MOB_TICK;
      for (const m of [...this.mobs.values()]) if (this.mobs.has(m.id) && ++m.cnt >= m.delay) { this.mobAct(m, now); m.cnt = 0; }
    }
  }
  broadcast(msg, exceptId) { for (const p of this.players.values()) if (p.id !== exceptId) p.send(msg); }
  // 근처에 있는 접속자에게만 보낸다
  near(e, msg) { for (const p of this.players.values()) if (Math.abs(p.x - e.x) <= CFG.viewX && Math.abs(p.y - e.y) <= CFG.viewY) p.send(msg); }
}
const pubP = p => ({ id: p.id, name: p.name, chr: p.chr, x: p.x, y: p.y, z: p.z, dir: p.dir, hp: p.hp, maxHp: p.maxHp, level: p.level, dead: p.dead ? 1 : 0 });
const pubM = m => ({ id: m.id, mob: 1, name: m.name, chr: m.chr, x: m.x, y: m.y, z: m.z, dir: m.dir, hp: m.hp, maxHp: m.maxHp });

// 전체 게임: 맵은 누군가 처음 들어올 때 만든다
class Game {
  constructor() {
    this.mopInfo = readJson('data', 'mops.json') || {};
    this.story = new STORY.Story(this); this.groups = new Groups(this); this.trades = new Trades(this); this.mail = new Mail(this); this.army = new Army(this);
    this.gEvents = readJson('data', 'events.json') || {}; this.shops = readJson('data', 'shops.json') || {};
    this.items = readJson('data', 'items.json') || {};
    // 클라이언트 아이템 정보에만 있는 무기 총알 번호(+0x57) (tools/client_items.py)
    this.itemBul = readJson('data', 'client_items.json') || {};
    this.chrIndex = readJson('assets', 'chr', 'index.json') || {};
    this.mapIndex = new Map((readJson('assets', 'maps', 'index.json') || []).map(m => [m.id, m]));
    this.worlds = new Map(); this.nextId = 1;
  }
  world(id) {
    if (!this.mapIndex.has(id)) return null;
    if (!this.worlds.has(id)) {
      const w = new World(this, id); this.worlds.set(id, w);
      console.log(`[맵 준비] ${id} "${w.name}" ${w.w}x${w.h}, 몬스터 ${w.mobs.size}마리, NPC ${w.npcs.length}명`);
    }
    return this.worlds.get(id);
  }
  // 시작·부활 지점: 맵 21 (100,100)
  startPoint() {
    const w = this.world(F.RESPAWN.map) || this.world([...this.mapIndex.keys()][0]);
    return w.mapId === F.RESPAWN.map ? { world: w, x: F.RESPAWN.x, y: F.RESPAWN.y } : { world: w, x: w.spawn[0], y: w.spawn[1] };
  }
  // 죽었을 때: 경험치 절반, 레벨 16부터는 칸마다 확률로 아이템·장비·돈을 떨어뜨린다
  deathPenalty(p) {
    p.exp = F.expAfterDeath(p.exp);
    const pct = F.deathDropPct(p.level), w = p.world, roll = () => Math.floor(Math.random() * 100) < pct;
    if (pct > 0) {
      for (let s = p.inv.length - 1; s >= 0; s--) { const e = p.inv[s]; if (e.k !== 6 && roll()) { p.inv.splice(s, 1); w.dropItem(p, [e.k, e.i, e.n]); } }
      p.equip.forEach((e, s) => { if (e && e.k !== 6 && roll()) { p.equip[s] = null; w.dropItem(p, [e.k, e.i, 1]); } });
      (p.quick || []).forEach((e, s) => { if (e && e.k !== 6 && roll()) { p.quick[s] = null; w.dropItem(p, [e.k, e.i, e.n]); } });   // DropAllQuickItem 0x433490
      if (p.money > 0 && roll()) { w.dropItem(p, [5, 0, p.money]); p.money = 0; }
      this.recalc(p, false);
    }
    this.sendInv(p); this.sendStat(p);
  }
  // 다시 시작: 죽은 뒤 접속자가 요청하면 체력·마력·기력을 가득 채워 부활 지점으로 보낸다 (ProcessRestart 0x43b7c0, ResetUserData 0x43bf96)
  restart(p) {
    if (!p.dead) return;
    p.dead = false; p.hp = p.maxHp; p.mp = p.maxMp; p.sp = F.SP_MAX; p.dir = 2;
    const t = this.startPoint(); p.world.leave(p); t.world.enter(p, t.x, t.y);
  }
  weightOf(p) {
    let w = 0; const add = (e, n) => { const f = e && this.itemInfo(e.k, e.i); if (f && f.weight) w += f.weight * n; };
    for (const e of p.inv) add(e, e.n); for (const e of p.equip) add(e, 1); for (const e of p.quick || []) add(e, e && e.n);
    return w;
  }
  recalc(p, heal) {
    // 장비 합산: 공격, 방어, 능력치 네 가지 (InitializeEquipmentEffect 0x436a04~0x437825)
    let wAtk = 0, armor = 0, range = 1; const add = [0, 0, 0, 0];
    p.equip.forEach((e, slot) => {
      const f = e && this.itemInfo(e.k, e.i); if (!f) return;
      wAtk += Math.max(0, f.atk || 0); armor += Math.max(0, f.def || 0); (f.v || []).forEach((v, q) => { add[q] += v; });
      if (slot === 7 && f.range) range = f.range;
    });
    // 장비를 뺀 능력치 (사용자 +0x4360~0x436c, InitializeEquipmentEffect 0x437825~0x43783f). 여기에 효과가 더해진다:
    //   효과 69 Focused Spirit: 정신력 + ⌊(레벨 − 10) ÷ 18⌋ × 23 + 10 − 레벨 (rm3944 NewFocusEffect 0x10002b5c)
    //   효과 75 Godly Shield: 기골 + 5000 (NewGshieldEffect 0x10002d36)
    const now = Date.now(), on = e => !!(p.fx && p.fx[e] > now);
    p.bStr = p.base.str; p.bDex = p.base.dex; p.bSpi = p.base.spi; p.bPow = p.base.pow;
    if (on(69)) p.bSpi = Math.max(0, p.bSpi + Math.floor((p.level - 10) / 18) * 23 + 10 - p.level);
    if (on(75)) p.bPow += 5000;
    const eq = {}; STATS.forEach((k, q) => { eq[k] = add[q]; });
    p.str = p.bStr + eq.str; p.dex = p.bDex + eq.dex; p.spi = p.bSpi + eq.spi; p.pow = p.bPow + eq.pow;
    p.eqDex = eq.dex; p.eqSpi = eq.spi;
    // 효과 48 Berserker: 체력 최대·방어·회복에는 기본 기골의 절반 (InitializeHPMax 0x4346d3), 근력 공격은 두 배 (InitializeAttack 0x4349ce)
    const hpPow = (on(48) ? Math.floor(p.bPow / 2) : p.bPow) + eq.pow;
    p.maxHp = F.hpMax(hpPow); p.maxMp = F.mpMax(p.spi); p.strAtk = F.attack(p.str) * (on(48) ? 2 : 1); p.wAtk = wAtk; p.atk = p.strAtk + wAtk;
    p.minPct = F.minPct(p.str, p.dex);
    if (on(73)) p.minPct = Math.max(p.minPct, 100);   // 효과 73 Bull's Eye: 최소 피해 비율 100 (NewBullseyeEffect 0x100025fd)
    // 방어(장비 방어 합, +0x430c): 효과 30 Evasion 이면 + ⌊3 × 방어 ÷ 10⌋ (0x437779)
    if (on(30)) armor += Math.floor(armor * 3 / 10);
    p.armor = armor; p.range = range;
    // 무기가 맞지 않으면 풀리는 효과 (InitializeEquipmentEffect 0x437932~0x437c73). 풀리면 메시지 0xa5
    if (p.fx) {
      const w = p.equip[7], drop = [];
      if (!SK.isSpin(w)) drop.push(49);
      if (!SK.isGun(w)) drop.push(2, 22);
      if (!SK.isGunOnly(w)) drop.push(10, 11, 34, 50);
      let ch = false; for (const e of drop) if (p.fx[e]) { delete p.fx[e]; ch = true; }
      if (ch && p.world) { p.world.sendFx(p); p.send({ t: 'sys', code: 0xa5, args: [] }); }
    }
    p.maxDp = F.dpMax(hpPow); p.dp = Math.min(p.dp || 0, p.maxDp);
    p.hp = heal ? p.maxHp : Math.min(p.hp, p.maxHp); p.mp = heal ? p.maxMp : Math.min(p.mp || 0, p.maxMp);
  }
  sendStat(p) { if (p.fx && p.fx[72] > Date.now()) p.sp = 0;   // 효과 72 Diamond Skin: 기력은 늘 0 (rm3944 NewDskinEffect 0x10002cfc, SendSPInfo 0x439f13)
    if (p.group) this.groups.hpChanged(p); p.send({ t: 'stat', hp: p.hp, maxHp: p.maxHp, mp: p.mp, maxMp: p.maxMp, sp: p.sp, dp: p.dp, maxDp: p.maxDp, weight: this.weightOf(p), weightMax: F.weightMax(p.str), level: p.level, exp: p.exp, need: F.expTable[p.level], bonus: p.bonus, str: p.str, spi: p.spi, dex: p.dex, pow: p.pow, atk: p.atk, minPct: p.minPct, armor: p.armor, range: p.range, fame: p.fame, name: p.name, chr: p.chr, skills: SK.list(p), special: SK.SPECIAL[p.chr] }); }
  // ---------- 저장 ----------
  // 원작은 DB 서버에 저장한다. 여기서는 이름마다 파일 하나(save/이름.json)에 저장한다.
  saveFile(name) { return path.join(ROOT, 'save', encodeURIComponent(name) + '.json'); }
  save(p) {
    const d = { auth: p.auth, skills: p.skills, chr: p.chr, level: p.level, exp: p.exp, bonus: p.bonus, base: p.base, inv: p.inv, equip: p.equip, quick: p.quick || null, money: p.money, bank: p.bank, fame: p.fame,
      hp: p.hp, mp: p.mp, sp: p.sp, dp: p.dp, dead: p.dead, map: p.world.mapId, x: p.x, y: p.y, story: p.story || 0, qitems: p.qitems || null, mails: p.mails || [] };
    try { fs.mkdirSync(path.join(ROOT, 'save'), { recursive: true }); fs.writeFileSync(this.saveFile(p.name), JSON.stringify(d)); } catch (e) { console.log('저장 실패', p.name, e.message); }
  }
  // 비밀번호: 처음 들어온 이름이면 그 비밀번호로 캐릭터를 만들고, 있던 이름이면 맞는지 확인한다.
  // 원작은 로그인 서버와 DB로 계정을 관리한다. 여기서는 저장 파일에 소금값과 scrypt 해시만 둔다.
  auth(name, pw) {
    pw = String(pw || ''); if (pw.length < 4 || pw.length > 64) return { error: '비밀번호는 4자 이상이어야 합니다.' };
    let d = null; try { if (fs.existsSync(this.saveFile(name))) d = JSON.parse(fs.readFileSync(this.saveFile(name), 'utf8')); } catch (e) { return { error: '저장 파일을 읽을 수 없습니다.' }; }
    if (d && d.auth) {
      const h = crypto.scryptSync(pw, Buffer.from(d.auth.salt, 'hex'), 32);
      if (!crypto.timingSafeEqual(h, Buffer.from(d.auth.hash, 'hex'))) return { error: '비밀번호가 맞지 않습니다.' };
      return { auth: d.auth };
    }
    const salt = crypto.randomBytes(16);
    return { auth: { salt: salt.toString('hex'), hash: crypto.scryptSync(pw, salt, 32).toString('hex') }, created: !d };
  }
  isOnline(name) { for (const w of this.worlds.values()) for (const q of w.players.values()) if (q.name === name) return true; return false; }
  // 새 캐릭터의 처음 상태. 원작 로그인 서버가 DB에 넣는 값 그대로다 (svIP.exe CIPClient::ProcessNewCharacterID 0x404a10, 4.5판도 같음):
  //   레벨 1, 네 능력치 10, 보너스 2, 체력 50, 마력 50, 기력 0, 돈 300, 붕어빵 5개와 주택가 1·2·3 지도, 직업별 기술 둘.
  //   시작 위치는 접속할 때 고른다: 초보존(맵 68의 6, 45) 또는 주택가2 병원(맵 22의 8, 14) (CIPClient::ProcessPacket 0x4016b6)
  join(name, send, auth, chr = 1, beginner = false) {
    const p = { id: this.nextId++, name, auth, chr, dir: 2, path: [], run: false, nextAt: 0, atkAt: 0, repathAt: 0, hitAt: 0, regenAt: 0, target: 0, pick: 0, talk: 0, sp: F.SP_MAX, steps: 0, spSent: 0, dead: false, exp: 0, inv: [], money: 0, send,
      level: CFG.startLevel, bonus: F.bonusTotal(CFG.startLevel), hp: 0, fame: 0, equip: new Array(EQUIP_SLOTS).fill(null), bank: { money: 0, items: [] },
      base: { str: F.BASE_STAT, spi: F.BASE_STAT, dex: F.BASE_STAT, pow: F.BASE_STAT } };
    let d = null; try { if (fs.existsSync(this.saveFile(name))) d = JSON.parse(fs.readFileSync(this.saveFile(name), 'utf8')); } catch (e) { console.log('저장 파일 읽기 실패', name, e.message); }
    if (d) {
      for (const k of ['chr', 'level', 'exp', 'bonus', 'base', 'inv', 'money', 'fame']) if (d[k] !== undefined) p[k] = d[k];
      if (Array.isArray(d.equip)) p.equip = d.equip.concat(new Array(EQUIP_SLOTS).fill(null)).slice(0, EQUIP_SLOTS);
      if (d.bank) p.bank = d.bank;
      p.quick = Array.isArray(d.quick) ? d.quick : null;
      p.story = d.story >>> 0 || 0; p.qitems = Array.isArray(d.qitems) ? d.qitems : null; p.mails = Array.isArray(d.mails) ? d.mails : [];
    }
    if (!d) { p.money = NEW_CHAR.money; p.inv = NEW_CHAR.items.map(([k, i, n]) => ({ k, i, n })); p.skills = NEW_CHAR.skills[chr]; }
    else if (d.skills) p.skills = d.skills;
    this.recalc(p, true);
    if (!d) { p.hp = NEW_CHAR.hp; p.mp = NEW_CHAR.mp; p.sp = NEW_CHAR.sp; const s0 = beginner ? NEW_CHAR.startBeginner : NEW_CHAR.start; const w0 = this.world(s0.map); if (w0) { w0.enter(p, s0.x, s0.y); return p; } }
    if (d && !d.dead) { p.hp = Math.max(1, Math.min(p.maxHp, d.hp ?? p.maxHp)); p.mp = Math.min(p.maxMp, d.mp ?? p.maxMp); p.sp = Math.min(F.SP_MAX, d.sp ?? F.SP_MAX); }
    if (d) p.dp = Math.min(p.maxDp, d.dp || 0);
    const w = d && !d.dead && this.world(d.map);
    if (w) w.enter(p, d.x, d.y); else { const t = this.startPoint(); t.world.enter(p, t.x, t.y); }
    return p;
  }
  // ---------- 의사 ----------
  // 체력·마력을 가득, 기력을 2000으로 채운다. 값은 받지 않는다 (CMapServerClient::ProcessCure 0x41b810)
  cure(p, npc) {
    if (p.dead) return;
    p.hp = p.maxHp; p.mp = p.maxMp; p.sp = F.SP_MAX;
    this.sendStat(p); p.world.near(p, { t: 'hp', id: p.id, hp: p.hp, maxHp: p.maxHp });
    p.send({ t: 'chat', id: 0, name: npc.name, text: '치료해 드렸습니다.' });
  }
  // ---------- 거래소 ----------
  // 물건을 값(개당)을 매겨 맡겨 두면 다른 사람이 사 간다. 한 사람이 다섯 건까지 올릴 수 있고, 목록은 한 쪽에 스물네 건이다.
  // 수수료는 없다. 판 돈은 거래소에 쌓였다가 찾아갈 때 받는다. 올린 물건을 거둘 때는 전부를 한꺼번에 거두며, 그 무게를 들 수 있어야 한다.
  // (ProcessExchangeSellItem 0x40f320, ProcessExchangeBuyItem 0x40f6a0, ProcessExchangeRepay 0x40fb20, ProcessExchangeCancel 0x40fd30)
  exchData(id) {
    if (!this.exch) { try { this.exch = JSON.parse(fs.readFileSync(path.join(ROOT, 'save', 'exchange.json'), 'utf8')); } catch (e) { this.exch = {}; } }
    return this.exch[id] ||= { seq: 1, list: [], owed: {} };
  }
  exchSave() { try { fs.mkdirSync(path.join(ROOT, 'save'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'save', 'exchange.json'), JSON.stringify(this.exch)); } catch (e) { console.log('거래소 저장 실패', e.message); } }
  openExchange(p, id, npc) { p.exchAt = { id, npc: npc.id, name: npc.name }; this.sendExch(p); }
  exchOk(p) {
    if (!p.exchAt || p.dead) return null;
    const n = p.world.npcs.find(q => q.id === p.exchAt.npc);
    if (!n || G.dist(p, n) >= 25) { p.exchAt = null; p.send({ t: 'exchclose' }); return null; }
    return this.exchData(p.exchAt.id);
  }
  sendExch(p) {
    const d = this.exchData(p.exchAt.id), owed = (d.owed[p.name] || []).reduce((a, r) => Math.min(F.MONEY_MAX, a + r.n * r.price), 0);
    const items = d.list.map(e => { const f = this.itemInfo(e.k, e.i); return { id: e.id, k: e.k, i: e.i, n: e.n, price: e.price, seller: e.seller, memo: e.memo, name: f ? f.name : '?', desc: f ? f.desc || '' : '', icon: f ? f.icon : 0, weight: f ? f.weight || 0 : 0 }; });
    p.send({ t: 'exch', name: p.exchAt.name, items, owed, mine: d.list.filter(e => e.seller === p.name).length });
  }
  exchTell(p, text) { p.send({ t: 'chat', id: 0, name: '거래소', text }); }
  exchSell(p, slot, n, price, memo) {
    const d = this.exchOk(p), it = p.inv[slot]; n = Math.floor(Number(n)); price = Math.floor(Number(price));
    if (!d || !it || !(n >= 1) || n > it.n) return;
    if (!(price >= 1) || price > Math.floor(F.MONEY_MAX / n)) { this.exchTell(p, '값이 올바르지 않습니다.'); return; }
    if (d.list.filter(e => e.seller === p.name).length >= 5) { this.exchTell(p, '다섯 건까지만 올릴 수 있습니다.'); return; }
    it.n -= n; if (it.n <= 0) p.inv.splice(slot, 1);
    d.list.push({ id: d.seq++, seller: p.name, k: it.k, i: it.i, n, price, memo: String(memo || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 16) });
    this.exchSave(); this.save(p); this.sendInv(p); this.sendStat(p); this.sendExch(p);
  }
  exchBuy(p, id, n) {
    const d = this.exchOk(p); n = Math.floor(Number(n)); if (!d || !(n >= 1)) return;
    const e = d.list.find(q => q.id === id); if (!e) { this.exchTell(p, '이미 팔린 물건입니다.'); this.sendExch(p); return; }
    if (e.seller.toLowerCase() === p.name.toLowerCase()) { this.exchTell(p, '자기가 올린 물건은 살 수 없습니다.'); return; }
    n = Math.min(n, e.n);
    if (n > Math.floor(p.money / e.price)) { this.exchTell(p, '돈이 모자랍니다.'); return; }
    const took = this.giveItem(p, e.k, e.i, n); if (!took) return;
    p.money -= e.price * took; e.n -= took; if (e.n <= 0) d.list.splice(d.list.indexOf(e), 1);
    (d.owed[e.seller] ||= []).push({ k: e.k, i: e.i, n: took, price: e.price });
    this.exchSave(); this.save(p); this.sendInv(p); this.sendExch(p);
  }
  // 판 돈 찾기: 한 번에 다섯 건까지
  exchRepay(p) {
    const d = this.exchOk(p); if (!d) return;
    const recs = d.owed[p.name] || []; if (!recs.length) { this.exchTell(p, '찾을 돈이 없습니다.'); return; }
    let sum = 0; for (const r of recs.splice(0, 5)) sum = Math.min(F.MONEY_MAX, sum + r.n * r.price);
    if (!recs.length) delete d.owed[p.name];
    p.money = Math.min(F.MONEY_MAX, p.money + sum);
    this.exchTell(p, `판 돈 ${sum.toLocaleString()}을(를) 받았습니다.`);
    this.exchSave(); this.save(p); this.sendInv(p); this.sendExch(p);
  }
  // 올린 물건 거두기: 전부 한꺼번에
  exchCancel(p) {
    const d = this.exchOk(p); if (!d) return;
    const mine = d.list.filter(e => e.seller === p.name); if (!mine.length) return;
    const w = mine.reduce((a, e) => { const f = this.itemInfo(e.k, e.i); return a + (f ? (f.weight || 0) * e.n : 0); }, 0);
    if (w > F.weightMax(p.str) - this.weightOf(p)) { this.exchTell(p, '무거워서 거둘 수 없습니다.'); return; }
    for (const e of mine) { const took = this.giveItem(p, e.k, e.i, e.n); e.n -= took; }
    d.list = d.list.filter(e => e.n > 0);
    this.exchSave(); this.save(p); this.sendInv(p); this.sendExch(p);
  }
  // ---------- 은행 ----------
  // 돈은 40억까지, 물건은 스무 칸. 같은 물건은 한 칸에 쌓인다. 수수료는 없다
  // (ProcessAddBankMoney 0x41dc10, ProcessGetBankMoney 0x41e3d0, ProcessAddBankItem 0x41ddc0, ProcessGetBankItem 0x41e590)
  openBank(p, npc) { p.bankNpc = npc.id; this.sendBank(p, npc.name); }
  sendBank(p, name) {
    const view = e => { const f = this.itemInfo(e.k, e.i); return { k: e.k, i: e.i, n: e.n || 1, name: f ? f.name : '?', desc: f ? f.desc || '' : '', icon: f ? f.icon : 0 }; };
    p.send({ t: 'bank', name, money: p.bank.money, items: p.bank.items.map(view) });
  }
  bankOk(p) {
    if (!p.bankNpc || p.dead) return false;
    const n = p.world.npcs.find(q => q.id === p.bankNpc);
    if (!n || G.dist(p, n) >= 25) { p.bankNpc = 0; p.send({ t: 'bankclose' }); return false; }
    return true;
  }
  bankMoney(p, n, put) {
    n = Math.floor(Number(n)); if (!this.bankOk(p) || !(n >= 1)) return;
    if (put) { n = Math.min(n, F.MONEY_MAX - p.bank.money); if (n < 1 || n > p.money) return; p.money -= n; p.bank.money += n; }
    else { if (n > p.bank.money) return; n = Math.min(n, F.MONEY_MAX - p.money); if (n < 1) return; p.bank.money -= n; p.money += n; }
    this.sendInv(p); this.sendBank(p); this.save(p);
  }
  bankPut(p, slot, n) {
    const it = p.inv[slot]; n = Math.floor(Number(n)); if (!this.bankOk(p) || !it || !(n >= 1)) return;
    n = Math.min(n, it.n);
    let b = p.bank.items.find(q => q.k === it.k && q.i === it.i);
    if (!b) { if (p.bank.items.length >= BANK_SLOTS) { p.send({ t: 'chat', id: 0, name: '안내', text: '은행에 빈 칸이 없습니다.' }); return; } b = { k: it.k, i: it.i, n: 0 }; p.bank.items.push(b); }
    b.n += n; it.n -= n; if (it.n <= 0) p.inv.splice(slot, 1);
    this.sendInv(p); this.sendStat(p); this.sendBank(p); this.save(p);
  }
  bankGet(p, slot, n) {
    const b = p.bank.items[slot]; n = Math.floor(Number(n)); if (!this.bankOk(p) || !b || !(n >= 1)) return;
    const took = this.giveItem(p, b.k, b.i, Math.min(n, b.n)); if (!took) return;
    b.n -= took; if (b.n <= 0) p.bank.items.splice(slot, 1);
    this.sendBank(p); this.save(p);
  }
  // 공격 간격: 공격 동작(동작 번호 2) 한 번이 끝나는 시간. 동작표 한 칸이 화면 한 장(50ms)이다 (Main.dll 0x10039480, Staff.dll CtPump::Get)
  attackMs(p) {
    this.atkLen ||= {};
    if (!(p.chr in this.atkLen)) { const j = readJson('assets', 'chr', p.chr + '.json'); this.atkLen[p.chr] = (j && j.anims[2]) || {}; }
    const seq = this.atkLen[p.chr][p.dir] || this.atkLen[p.chr][2];
    return (seq ? seq.length : 16) * FRAME_MS;
  }
  // 능력치 점수 1점 사용: 직업별 증가량만큼 오른다
  useBonus(p, stat) {
    const i = STATS.indexOf(stat); if (i < 0 || p.bonus < 1 || p.dead) return;
    p.bonus--; p.base[stat] += F.classGain[p.chr][i];
    this.recalc(p, false); this.sendStat(p); p.world.near(p, { t: 'hp', id: p.id, hp: p.hp, maxHp: p.maxHp });
  }
  // 한 마리로 얻는 경험치는 필요 경험치의 1/10까지. 레벨이 오르면 경험치는 0부터 다시 시작한다
  // 경험치 얻기 (DoExperimentUp 0x438e70): 한 번에 필요 경험치의 1/10 까지, 남은 만큼까지. 실제로 얻은 양을 돌려준다
  gainExp(p, exp) {
    if (p.level >= F.MAX_LEVEL) return 0;
    const need = F.expTable[p.level];
    let gain = Math.min(exp, Math.max(1, Math.floor(need / F.EXP_CAP_DIV)));
    if (p.exp < need) gain = Math.min(gain, need - p.exp);
    p.exp += gain; p.send({ t: 'exp', gain });
    if (p.exp >= need) {
      p.level++; p.exp = 0; p.bonus += F.bonusForLevelUp(p.level); this.recalc(p, true);
      p.world.broadcast({ t: 'lvl', id: p.id, level: p.level, hp: p.hp, maxHp: p.maxHp });
      this.story.checkAndStart(p);
    }
    this.sendStat(p);
    return gain;
  }
  // ---------- 상점 ----------
  // 상점 가격 = 아이템 가격 × 상점의 가격 비율(%) (CShopManager::Load 0x487190). 군단 세금은 군단이 없어 0
  shopPrice(entry) {
    const f = this.itemInfo(entry[0], entry[1]), base = f ? f.price || 0 : 0, pct = entry[3];
    return pct === 100 ? base : base >= 20000000 ? Math.floor(base / 100) * pct : Math.floor(base * pct / 100);
  }
  // 되팔 때는 상점 가격의 절반, 35번 상점만 1/4 (ProcessUserSellItem 0x42a8e3~0x42a9e2)
  sellDiv(shopId) { return shopId === 35 ? 4 : 2; }
  openShop(p, shopId, npc) {
    p.shop = { id: shopId, npc: npc.id };
    const items = this.shops[shopId].map((e, idx) => { const f = this.itemInfo(e[0], e[1]); return f ? { idx, k: e[0], i: e[1], n: e[2] > 4000000000 ? -1 : e[2], price: this.shopPrice(e), sells: e[4] & 1, buys: e[4] & 2 ? 1 : 0, name: f.name, desc: f.desc || '', icon: f.icon, weight: f.weight || 0 } : null; }).filter(Boolean);
    p.send({ t: 'shop', id: shopId, name: npc.name, div: this.sellDiv(shopId), items });
  }
  shopOf(p) {
    if (!p.shop || p.dead) return null;
    const n = p.world.npcs.find(q => q.id === p.shop.npc);
    if (!n || G.dist(p, n) >= TALK_DIST) { p.shop = null; p.send({ t: 'shopclose' }); return null; }
    return this.shops[p.shop.id];
  }
  // 사기: 값 × 수량만큼 돈이 있어야 하고, 무게와 칸이 허락하는 만큼만 산다 (ProcessUserBuyItem 0x4294f0)
  buy(p, idx, n) {
    const shop = this.shopOf(p), e = shop && shop[idx]; n = Math.floor(Number(n));
    if (!e || !(e[4] & 1) || !(n >= 1) || n > 1000000) return;
    const f = this.itemInfo(e[0], e[1]), price = this.shopPrice(e); if (!f) return;
    if (e[2] <= 4000000000) n = Math.min(n, e[2]);
    if (n < 1) return;
    if (price * n > p.money) { p.send({ t: 'chat', id: 0, name: '안내', text: '돈이 모자랍니다.' }); return; }
    const took = this.giveItem(p, e[0], e[1], n); if (!took) return;
    p.money -= price * took; if (e[2] <= 4000000000) e[2] -= took;
    this.sendInv(p);
    p.world.script.bought(p, e[0], e[1], took);
  }
  // 팔기: 그 상점이 사 주는 목록에 있는 아이템만 판다 (ProcessUserSellItem 0x42a540)
  sell(p, slot, n) {
    const shop = this.shopOf(p), it = p.inv[slot]; n = Math.floor(Number(n));
    if (!shop || !it || !(n >= 1)) return;
    const e = shop.find(q => q[0] === it.k && q[1] === it.i && (q[4] & 2));
    if (!e) { p.send({ t: 'chat', id: 0, name: '안내', text: '이 상점에서는 사 주지 않는 물건입니다.' }); return; }
    n = Math.min(n, it.n);
    const gain = Math.floor(this.shopPrice(e) / this.sellDiv(p.shop.id)) * n;
    if (p.money + gain > F.MONEY_MAX) { p.send({ t: 'chat', id: 0, name: '안내', text: '돈을 더 가질 수 없습니다.' }); return; }
    it.n -= n; if (it.n <= 0) p.inv.splice(slot, 1);
    p.money += gain; this.sendInv(p); this.sendStat(p);
  }
  // ---------- 아이템 ----------
  // 분류 5의 0번은 돈이다. 원작에 화폐 단위 이름은 없고 그냥 '돈'이다 (DB 칸 Money). 시그너스에서 쓰는 돈은 따로 있다 (DB 칸 SigMoney, 아직 없음)
  itemInfo(k, i) { return k === 5 && i === 0 ? { name: '돈', icon: 0, money: true } : (this.items[k] && this.items[k][i]) || null; }
  sendInv(p) {
    const view = e => { const f = this.itemInfo(e.k, e.i); return { k: e.k, i: e.i, n: e.n || 1, name: f.name, desc: f.desc || '', icon: f.icon, hp: f.hp || 0, mp: f.mp || 0, atk: f.atk || 0, def: f.def || 0, v: f.v || [], req: f.req || 0, reqStat: f.reqStat || [], cls: f.cls || 0, weight: f.weight || 0, wear: f.type !== undefined && f.type !== 14 ? 1 : 0 }; };
    p.send({ t: 'inv', money: p.money, items: p.inv.map(view), quick: (p.quick || []).map(e => e ? view(e) : null), equip: p.equip.map((e, s) => e ? { ...view(e), slot: SLOT_NAMES[s] } : null) });
  }
  // 넣을 수 있는 만큼만 넣고 넣은 개수를 돌려준다. 같은 아이템은 종류에 상관없이 한 칸에 겹쳐 쌓인다 (GetAvailableItemIndex 0x431b4b)
  giveItem(p, k, i, n) {
    const f = this.itemInfo(k, i); if (!f) return 0;
    let take = n;
    if (f.money) { take = Math.min(n, F.MONEY_MAX - p.money); p.money += take; }
    else {
      if (f.weight > 0) take = Math.min(take, Math.floor((F.weightMax(p.str) - this.weightOf(p)) / f.weight));
      const st = p.inv.find(e => e.k === k && e.i === i);
      if (!st && p.inv.length >= F.INV_SLOTS) take = 0;
      if (take <= 0) { p.send({ t: 'chat', id: 0, name: '안내', text: `${f.name}: ${!st && p.inv.length >= F.INV_SLOTS ? '소지품 칸이 가득 찼습니다.' : '너무 무거워 들 수 없습니다.'}` }); return 0; }
      if (st) st.n += take; else p.inv.push({ k, i, n: take });
    }
    if (take > 0) { p.send({ t: 'got', name: f.name, n: take }); this.sendInv(p); this.sendStat(p); }
    return take;
  }
  // 아이템 사용: 회복 수치만큼 체력을 채운다. 19억 이상이면 초과분만큼의 % 회복
  // 빠른 창: 아이템 여덟 칸 (CMapServerClient+0x3fa0, 칸 종류 3). 소지품의 아이템을 오른쪽 클릭하면 들어가고 CTRL+1~8 로 쓴다 (원작 도움말 1/1/119~123).
  // 옮기기는 같은 아이템이면 겹치고, 아니면 빈 칸으로 (MoveItem 0x42f6f0, GetAvailableItemIndex)
  quickPut(p, slot) {
    const e = p.inv[slot]; if (!e || p.dead) return;
    const q = p.quick ||= Array(8).fill(null);
    let k = q.findIndex(x => x && x.k === e.k && x.i === e.i); if (k < 0) k = q.findIndex(x => !x); if (k < 0) return;
    if (q[k]) q[k].n += e.n; else q[k] = { k: e.k, i: e.i, n: e.n };
    p.inv.splice(slot, 1); this.sendInv(p);
  }
  quickGet(p, k) {
    const q = p.quick || [], e = q[k]; if (!e || p.dead) return;
    const st = p.inv.find(x => x.k === e.k && x.i === e.i);
    if (!st && p.inv.length >= F.INV_SLOTS) return;
    if (st) st.n += e.n; else p.inv.push({ k: e.k, i: e.i, n: e.n });
    q[k] = null; this.sendInv(p);
  }
  quickUse(p, k) {
    const q = p.quick || [], e = q[k]; if (!e || p.dead) return;
    p.inv.push(e); q[k] = null;                       // 소지품 쓰기와 같은 처리를 하고, 남은 것은 제자리로
    const at = p.inv.length - 1; this.useItem(p, at);
    const left = p.inv[at] === e ? p.inv.splice(at, 1)[0] : null;
    if (left && left.n > 0) q[k] = left;
    this.sendInv(p);
  }
  useItem(p, slot) {
    const e = p.inv[slot]; if (!e || p.dead) return;
    const f = this.itemInfo(e.k, e.i);
    if (f && (e.k === 1 || e.k === 2 || e.k === 3 || e.k === 6) && f.type !== 14) { this.equipItem(p, slot, f); return; }
    if (!f || !(f.hp > 0 || f.mp > 0)) { p.send({ t: 'chat', id: 0, name: '안내', text: `${f ? f.name : '이 아이템'}: 사용 효과는 아직 구현되지 않았습니다.` }); return; }
    const amount = (v, max) => v >= PERCENT_HEAL ? Math.floor(max * (v - PERCENT_HEAL) / 100) : v;
    if (f.hp > 0) p.hp = Math.min(p.maxHp, p.hp + amount(f.hp, p.maxHp));
    if (f.mp > 0) p.mp = Math.min(p.maxMp, p.mp + amount(f.mp, p.maxMp));
    if (--e.n <= 0) p.inv.splice(slot, 1);
    this.sendInv(p); this.sendStat(p); p.world.near(p, { t: 'hp', id: p.id, hp: p.hp });
  }
  // 착용: 부위 번호가 곧 칸 번호이고, 반지는 9~13번 칸 중 빈 곳에 낀다
  // 착용 조건: 레벨, 순수 능력치 네 가지, 명성, 직업 (CheckEquipment 0x43439b~0x434528)
  equipItem(p, invSlot, f) {
    const no = t => p.send({ t: 'chat', id: 0, name: '안내', text: `${f.name}: ${t}` });
    if (p.level < (f.req || 0)) return no(`레벨 ${f.req} 이상이어야 합니다.`);
    for (let q = 0; q < 4; q++) if ((f.reqStat || [])[q] > p.base[STATS[q]]) return no(`${STAT_NAMES[q]} ${f.reqStat[q]} 이상이어야 합니다.`);
    if (f.fame && f.fame > p.fame) return no(`명성 ${f.fame} 이상이어야 합니다.`);
    if (f.cls && !(f.cls & (1 << p.chr))) return no('이 직업은 착용할 수 없습니다.');
    let slot = f.type;
    if (f.type === TYPE_RING) slot = RING_SLOTS.find(s => !p.equip[s]) ?? RING_SLOTS[0];
    if (!(slot >= 0 && slot < EQUIP_SLOTS)) return;
    const e = p.inv[invSlot], old = p.equip[slot];
    if (--e.n <= 0) p.inv.splice(invSlot, 1);
    p.equip[slot] = { k: e.k, i: e.i };
    if (old) { const st = p.inv.find(x => x.k === old.k && x.i === old.i); if (st) st.n++; else p.inv.push({ k: old.k, i: old.i, n: 1 }); }
    this.recalc(p, false); this.sendInv(p); this.sendStat(p); p.world.near(p, { t: 'hp', id: p.id, hp: p.hp, maxHp: p.maxHp });
  }
  unequip(p, slot) {
    const e = p.equip[slot]; if (!e || p.dead) return;
    if (!p.inv.find(x => x.k === e.k && x.i === e.i) && p.inv.length >= F.INV_SLOTS) return;
    p.equip[slot] = null; { const st = p.inv.find(x => x.k === e.k && x.i === e.i); if (st) st.n++; else p.inv.push({ k: e.k, i: e.i, n: 1 }); }
    this.recalc(p, false); this.sendInv(p); this.sendStat(p); p.world.near(p, { t: 'hp', id: p.id, hp: p.hp, maxHp: p.maxHp });
  }
  // 시험용: /맵 번호 로 바로 이동
  // 시험용: /아이템 분류 번호 [수량]
  cheatItem(p, k, i, n) { if (!this.itemInfo(k, i) || !this.items[k] || !this.items[k][i]) return false; this.giveItem(p, k, i, n || 1); return true; }
  gotoMap(p, id, x, y) { const w = this.world(id); if (!w || p.dead) return false; p.world.leave(p); if (x && y) w.enter(p, x, y); else w.enter(p); return true; }
  cheatLevel(p, lv) { lv = Math.max(1, Math.min(F.MAX_LEVEL, lv | 0)); p.bonus += F.bonusTotal(lv) - F.bonusTotal(p.level); p.level = lv; p.exp = 0; this.recalc(p, true); this.sendStat(p); this.story.checkAndStart(p); }
  tick(now) { for (const w of this.worlds.values()) w.tick(now); this.groups.tick(now); this.army.tick(now); }
  exists(name) { return !!this.findOnline(name) || fs.existsSync(this.saveFile(name)); }
  findOnline(name) { for (const w of this.worlds.values()) for (const p of w.players.values()) if (p.name === name) return p; return null; }
  get online() { let n = 0; for (const w of this.worlds.values()) n += w.players.size; return n; }
}

module.exports = { Game, CFG };
