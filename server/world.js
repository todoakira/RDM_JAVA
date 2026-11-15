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
  maxName: 12,
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
const EVENT_NAMES = { 2: '게시판', 4: '메일', 11: '자유군 공용 컴퓨터', 12: '자유군 아지트 선택', 13: '자유군 금고', 14: '자유군 게시판', 15: '자유군 아지트 컴퓨터', 20: '거래소', 27: '고고학자 퀘스트', 28: '지리학자 퀘스트', 29: '카삼 퀘스트', 39: '신전', 43: '교도관', 44: '회상 퀘스트', 45: '배틀존 이동' };
const TALK_DIST = 25, BANK_SLOTS = 20;
const EV_WARP = 1, EV_SAFE = 5;      // 이벤트 종류 (EventNNNNN.rse)
const GROUND_ITEM_MS = 600000;       // 바닥 아이템이 사라지는 시간: 10분 (CItemServer::RemoveOldItems 0x408b48)
const PERCENT_HEAL = 1900000000;     // 회복 수치가 이 값 이상이면 초과분만큼의 % 회복 (CMapServerClient::UseItem 0x432f8d)

const crypto = require('crypto');
const G = require('./grid');         // 원작의 위치·방향·거리 계산
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
    let skipped = 0;
    for (const s of sv.spawns) {
      const info = game.mopInfo[s.kind];
      if (!info || !(spriteOf(info.img) in game.chrIndex)) { skipped += s.count; continue; }   // 그림이 없는 몬스터는 내보내지 않는다
      for (let i = 0; i < s.count; i++) this.spawnMob(s);
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
    p.world = this; p.shop = null; p.bankNpc = 0; p.x = t.x; p.y = t.y; p.z = t.z; p.path = []; p.target = 0; p.nextAt = 0;
    this.players.set(p.id, p); this.take(p);
    p.send({ t: 'welcome', id: p.id, map: this.mapId, safe: this.safeStr,
      players: [...this.players.values()].map(pubP), mobs: [...this.mobs.values()].map(pubM), npcs: this.npcs, ground: [...this.ground.values()] });
    this.game.sendStat(p); this.game.sendInv(p);
    this.broadcast({ t: 'add', p: pubP(p) }, p.id);
  }
  leave(p) { this.release(p); if (this.players.delete(p.id)) this.broadcast({ t: 'del', id: p.id }); }

  moveTo(p, x, y, z, run) {
    if (p.dead || !Number.isInteger(x) || !Number.isInteger(y)) return;
    const t = this.nearUser({ x, y, z: z ? 1 : 0 }); if (!t) return;
    const pa = this.findPath(p, t); if (!pa) return;
    p.path = pa; p.run = !!run; p.target = 0; p.pick = 0; p.talk = 0;
  }
  attackCmd(p, id, run) {
    const m = this.mobs.get(id);
    if (p.dead || !m) return;
    p.target = id; p.run = !!run; p.repathAt = 0; p.pick = 0; p.talk = 0;
  }
  // NPC에게 말 걸기: 옆까지 걸어가면 그 NPC에 연결된 이벤트가 실행된다
  talkCmd(p, id, run) {
    const n = this.npcs.find(q => q.id === id); if (p.dead || !n) return;
    // 서버는 NPC와의 거리가 25 미만이면 이벤트를 받아 준다 (CExtraServer::IsExistExtraEvent 0x406815). 그보다 멀면 걸어간다
    if (G.dist(p, n) >= TALK_DIST) { const pa = this.findPath(p, n, 1500); if (!pa) return; pa.pop(); p.path = pa; }
    p.run = !!run; p.target = 0; p.pick = 0; p.talk = id;
  }
  tryTalk(p) {
    const n = this.npcs.find(q => q.id === p.talk);
    if (!n) { p.talk = 0; return; }
    if (G.dist(p, n) >= TALK_DIST) { if (!p.path.length) p.talk = 0; return; }
    p.talk = 0; p.path = [];
    // NPC의 이벤트 번호는 맵의 이벤트가 아니라 공용 표(EventInfo.rse)를 가리킨다 (CMapServerClient::ProcessEvent 0x41ee70)
    const e = this.game.gEvents[n.event], kind = e ? e[0] : 0;
    if (SHOP_KINDS.includes(kind) && this.game.shops[e[1]]) { this.game.openShop(p, e[1], n); return; }
    if (kind === 8 || kind === 81) { this.game.cure(p, n); return; }
    if (kind === 6 || kind === 80) { this.game.openBank(p, n); return; }
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
    const pa = this.findPath(p, g, 1500); if (!pa) return;
    p.path = pa; p.run = !!run; p.target = 0; p.pick = id; p.talk = 0;
  }
  tryPickup(p) {
    const g = this.ground.get(p.pick);
    if (!g) { p.pick = 0; return; }
    if (!G.same(g, p)) return;
    p.pick = 0;
    const took = this.game.giveItem(p, g.k, g.i, g.n);
    if (took >= g.n) { this.ground.delete(g.id); this.broadcast({ t: 'gdel', id: g.id }); } else g.n -= took;
  }
  chat(p, text) {
    text = String(text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, CFG.maxChat);
    if (text) this.broadcast({ t: 'chat', id: p.id, name: p.name, text });
  }

  // ---------- 몬스터 ----------
  // 배치표의 영역 좌표를 그대로 써서 자리를 고른다 (CMopServer::LoadMop 0x4773ac)
  spawnMob(s) {
    const info = this.game.mopInfo[s.kind];
    const t = this.findFirstEmptyPlace(s.rect, q => this.canMop(q)); if (!t) return null;
    const st = F.mobStats(info, s.pattern);
    const m = { id: this.game.nextId++, mob: 1, s, info, pattern: s.pattern, home: t, name: s.name, chr: spriteOf(info.img), x: t.x, y: t.y, z: t.z, dir: G.DIRS[rnd(8)],
      str: st.str, dex: st.dex, pow: st.pow, atk: st.atk, minPct: st.minPct, maxHp: st.maxHp, hp: st.maxHp, exp: st.exp,
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
    const info = m.info, R = m.maxRange, canMove = info.speed > 0;
    if (m.targetName) {       // 기억해 둔 대상이 있으면 먼저 본다
      let u = null; for (const q of this.players.values()) if (q.name === m.targetName) { u = q; break; }
      if (u && this.inMgmt(m, u)) {
        const rec = this.canRecognize(m, u);
        if (G.dist(m, u) <= R && rec) return [3, u];
        if (rec && canMove) return [2, u];
      }
      m.targetName = '';
    }
    let best = 0, bu = null;
    for (const u of this.players.values()) {
      if (!this.inMgmt(m, u)) continue;
      if (m.pattern === 3) continue;       // 패턴 3은 이벤트로 표시된 주인공만 노린다 (0x47cfaa). 그 이벤트는 아직 없다
      if (info.img === IMG_WARPER) return [1, u];
      const d = G.dist(m, u), rec = this.canRecognize(m, u);
      const e = this.eventAt(u.x, u.y), lure = !!e && e[0] === EV_LURE;
      if (lure && d <= Math.min(R, 10) && rec) return [6, u];
      if (best < 5 && d <= 1 && rec) { best = 5; bu = u; continue; }
      if (best < 4 && lure && d <= 10 && rec && canMove) { best = 4; bu = u; continue; }
      if (best < 3 && d <= R && rec) { best = 3; bu = u; }
      else if (best < 2 && d <= info.sight && rec && canMove) { best = 2; bu = u; }
      else if (best < 1 && canMove) { best = 1; bu = u; }
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
    if (r === 0 || r === 5) { this.moveToward(m, to, towardDelay); m.delay = T400; }
    else if (r <= 9) this.moveDir(m, r, T400);
    else m.delay = Math.floor(1000 / MOB_TICK);
  }
  // 공격. 두 공격 중 하나를 반반으로 고르고, 닿는 쪽으로 친다. 다음 행동까지는 그 공격의 간격만큼 기다린다 (CMopServer::DoAttack 0x47dd70)
  // 기술을 가진 몬스터는 원작에서 기술을 섞어 쓴다. 기술이 아직 없어서 일반 공격만 한다.
  mobAttack(m, u, now) {
    const info = m.info, d = G.dist(m, u), r1 = info.range, r2 = info.range2 || 0;
    if (d > r1 && d > r2) return false;
    const second = rnd(20) > 9 ? d <= r2 : d > r1;
    m.delay = Math.ceil((second ? info.interval2 : info.interval) / MOB_TICK);
    const dir = G.direction(m, u); if (dir !== 5) m.dir = dir;
    this.hit(m, u, now, second ? 1 : 0);
    return true;
  }
  // 몬스터 한 마리의 행동 (CMopServer::DoNextAction 0x47be90)
  mobAct(m, now) {
    const info = m.info, [act, u] = this.findNextAction(m), step = info.speed * T200, canMove = info.speed > 0;
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
      case 4: this.moveToward(m, u, step); return;
      case 2: if (m.pattern === 1) this.flee(m, u, step); else if (m.pattern === 6) this.roam(m, u, step); else this.moveToward(m, u, step); return;
      case 1: if (!IMG_STILL.includes(info.img)) this.roam(m, m.home, T400); return;
    }
  }

  // ---------- 전투 ----------
  hit(a, d, now, kind = 0) {
    // 치명타면 반드시 맞고 피해 2배, 아니면 명중 판정
    const crit = F.rand100() < F.critPct(a.dex, d.dex);
    const defDex = d.mob ? d.dex : Math.floor(d.dex * F.PLAYER_DEX_DEFENCE);
    if (!crit && F.rand100() > F.hitPct(a.dex, defDex)) { this.near(a, { t: 'atk', id: a.id, tid: d.id, dir: a.dir, k: kind, miss: 1, hp: d.hp }); return; }
    // 주인공이 맞을 때는 장비의 방어 합만큼 빼고, 최소 1 (CMapServerClient::GetAttack 0x4599b0)
    const dmg = Math.max(1, F.rollDamage(a.atk, a.minPct) * (crit ? 2 : 1) - (d.mob ? 0 : d.armor || 0));
    d.hp = Math.max(0, d.hp - dmg); d.hitAt = now;
    this.near(a, { t: 'atk', id: a.id, tid: d.id, dir: a.dir, k: kind, dmg, crit: crit ? 1 : 0, hp: d.hp });
    if (d.hp > 0) return;
    this.broadcast({ t: 'die', id: d.id });
    if (d.mob) {
      this.release(d); this.mobs.delete(d.id);
      if (d.item) this.dropItem(d, d.item);
      this.after(d.s.regen * 1000, () => { const n = this.spawnMob(d.s); if (n) this.broadcast({ t: 'madd', m: pubM(n) }); });
      if (!a.mob) this.game.gainExp(a, d.exp);
    } else {
      d.dead = true; d.target = 0; d.path = []; d.pick = 0; d.talk = 0;
      this.game.deathPenalty(d);
    }
  }

  // 50ms마다 호출
  tick(now) {
    for (let i = this.timers.length - 1; i >= 0; i--) if (now >= this.timers[i].at) { const t = this.timers.splice(i, 1)[0]; t.fn(); }
    if (!this.players.size) { this.mobTickAt = now + MOB_TICK; return; }
    for (const p of [...this.players.values()]) {
      if (p.dead) continue;
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
        else if (G.dist(p, m) <= p.range) {
          p.path = [];
          if (now >= p.atkAt && now >= p.nextAt) { const d = G.direction(p, m); if (d !== 5) p.dir = d; p.atkAt = now + this.game.attackMs(p); this.hit(p, m, now); }
        } else if (now >= p.repathAt) {
          p.repathAt = now + 400;
          const pa = this.findPath(p, m, 1500);
          if (pa) { pa.pop(); p.path = pa; } else p.target = 0;
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
      if (running) { const c = F.runCost(p.dex); p.sp = p.sp > c ? p.sp - c : 0; p.regenAt = now + F.REGEN_MS; p.steps = 0; if (++p.spSent % 4 === 0 || !p.sp) this.game.sendStat(p); }
      else p.steps++;
      const dir = G.direction(p, n), dur = stepMs(dir, running);
      this.release(p); if (dir !== 5) p.dir = dir; p.x = n.x; p.y = n.y; p.z = n.z; p.nextAt = now + dur; this.take(p);
      this.near(p, { t: 'step', id: p.id, x: n.x, y: n.y, z: n.z, dir: p.dir, dur, run: running ? 1 : 0, last: p.path.length ? 0 : 1 });
      // 맵 이동 지점을 밟으면 다른 맵으로 넘어간다
      const e = this.eventAt(n.x, n.y);
      if (e && e[0] === EV_WARP) {
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
    this.gEvents = readJson('data', 'events.json') || {}; this.shops = readJson('data', 'shops.json') || {};
    this.items = readJson('data', 'items.json') || {};
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
    for (const e of p.inv) add(e, e.n); for (const e of p.equip) add(e, 1);
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
    STATS.forEach((k, q) => { p[k] = p.base[k] + add[q]; });
    // 공격력 = 근력에서 나온 값 + 무기 공격 합 (DoAttackMop 0x46f8a3)
    p.maxHp = F.hpMax(p.pow); p.maxMp = F.mpMax(p.spi); p.atk = F.attack(p.str) + wAtk; p.minPct = F.minPct(p.str, p.dex);
    p.armor = armor; p.range = range;
    p.hp = heal ? p.maxHp : Math.min(p.hp, p.maxHp); p.mp = heal ? p.maxMp : Math.min(p.mp || 0, p.maxMp);
  }
  sendStat(p) { p.send({ t: 'stat', hp: p.hp, maxHp: p.maxHp, mp: p.mp, maxMp: p.maxMp, sp: p.sp, weight: this.weightOf(p), weightMax: F.weightMax(p.str), level: p.level, exp: p.exp, need: F.expTable[p.level], bonus: p.bonus, str: p.str, spi: p.spi, dex: p.dex, pow: p.pow, atk: p.atk, minPct: p.minPct, armor: p.armor, range: p.range, fame: p.fame, name: p.name, chr: p.chr }); }
  // ---------- 저장 ----------
  // 원작은 DB 서버에 저장한다. 여기서는 이름마다 파일 하나(save/이름.json)에 저장한다.
  saveFile(name) { return path.join(ROOT, 'save', encodeURIComponent(name) + '.json'); }
  save(p) {
    const d = { auth: p.auth, chr: p.chr, level: p.level, exp: p.exp, bonus: p.bonus, base: p.base, inv: p.inv, equip: p.equip, money: p.money, bank: p.bank, fame: p.fame,
      hp: p.hp, mp: p.mp, sp: p.sp, dead: p.dead, map: p.world.mapId, x: p.x, y: p.y };
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
  join(name, send, auth) {
    const p = { id: this.nextId++, name, auth, chr: 1, dir: 2, path: [], run: false, nextAt: 0, atkAt: 0, repathAt: 0, hitAt: 0, regenAt: 0, target: 0, pick: 0, talk: 0, sp: F.SP_MAX, steps: 0, spSent: 0, dead: false, exp: 0, inv: [], money: 0, send,
      level: CFG.startLevel, bonus: F.bonusTotal(CFG.startLevel), hp: 0, fame: 0, equip: new Array(EQUIP_SLOTS).fill(null), bank: { money: 0, items: [] },
      base: { str: F.BASE_STAT, spi: F.BASE_STAT, dex: F.BASE_STAT, pow: F.BASE_STAT } };
    let d = null; try { if (fs.existsSync(this.saveFile(name))) d = JSON.parse(fs.readFileSync(this.saveFile(name), 'utf8')); } catch (e) { console.log('저장 파일 읽기 실패', name, e.message); }
    if (d) {
      for (const k of ['chr', 'level', 'exp', 'bonus', 'base', 'inv', 'money', 'fame']) if (d[k] !== undefined) p[k] = d[k];
      if (Array.isArray(d.equip)) p.equip = d.equip.concat(new Array(EQUIP_SLOTS).fill(null)).slice(0, EQUIP_SLOTS);
      if (d.bank) p.bank = d.bank;
    }
    this.recalc(p, true);
    if (d && !d.dead) { p.hp = Math.max(1, Math.min(p.maxHp, d.hp ?? p.maxHp)); p.mp = Math.min(p.maxMp, d.mp ?? p.maxMp); p.sp = Math.min(F.SP_MAX, d.sp ?? F.SP_MAX); }
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
  gainExp(p, exp) {
    if (p.level >= F.MAX_LEVEL) return;
    const need = F.expTable[p.level], gain = Math.min(exp, Math.max(1, Math.floor(need / F.EXP_CAP_DIV)));
    p.exp += gain; p.send({ t: 'exp', gain });
    if (p.exp >= need) {
      p.level++; p.exp = 0; p.bonus += F.bonusForLevelUp(p.level); this.recalc(p, true);
      p.world.broadcast({ t: 'lvl', id: p.id, level: p.level, hp: p.hp, maxHp: p.maxHp });
    }
    this.sendStat(p);
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
  // 분류 5의 0번은 돈(시그)이다
  itemInfo(k, i) { return k === 5 && i === 0 ? { name: '시그', icon: 0, money: true } : (this.items[k] && this.items[k][i]) || null; }
  sendInv(p) {
    const view = e => { const f = this.itemInfo(e.k, e.i); return { k: e.k, i: e.i, n: e.n || 1, name: f.name, desc: f.desc || '', icon: f.icon, hp: f.hp || 0, mp: f.mp || 0, atk: f.atk || 0, def: f.def || 0, v: f.v || [], req: f.req || 0, reqStat: f.reqStat || [], cls: f.cls || 0, weight: f.weight || 0, wear: f.type !== undefined && f.type !== 14 ? 1 : 0 }; };
    p.send({ t: 'inv', money: p.money, items: p.inv.map(view), equip: p.equip.map((e, s) => e ? { ...view(e), slot: SLOT_NAMES[s] } : null) });
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
  gotoMap(p, id) { const w = this.world(id); if (!w || p.dead) return false; p.world.leave(p); w.enter(p); return true; }
  cheatLevel(p, lv) { lv = Math.max(1, Math.min(F.MAX_LEVEL, lv | 0)); p.bonus += F.bonusTotal(lv) - F.bonusTotal(p.level); p.level = lv; p.exp = 0; this.recalc(p, true); this.sendStat(p); }
  tick(now) { for (const w of this.worlds.values()) w.tick(now); }
  get online() { let n = 0; for (const w of this.worlds.values()) n += w.players.size; return n; }
}

module.exports = { Game, CFG };
