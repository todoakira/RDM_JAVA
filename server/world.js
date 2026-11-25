'use strict';
// 게임 세계: 맵마다 World 하나. 이동·전투·맵 이동 판정은 전부 여기(서버)에서 한다.
// 좌표는 원작 서버와 같다: 칸(가로 48 × 세로 24 픽셀)마다 서는 자리가 둘 있다 (grid.js).
const fs = require('fs');
const path = require('path');
const INOC = require('./inoc');     // 이노큘레이터·아이템가드 (시간제 아이템 효과)
const F = require('./formulas');     // 원작 서버 실행 파일에서 옮긴 계산식
const { spriteOf } = require('./sprites');   // 원작 클라이언트에서 옮긴 모습 번호 표

// 박자는 원작 클라이언트(Main.dll)에서 옮겼다. 화면 한 장이 50ms 이고(주 반복문 0x10007330), 한 걸음은 장마다 정해진 픽셀만큼 움직인다(0x100390d0):
//   걷기: 대각선 장당 (4, 2)픽셀 → 6장, 가로·세로 장당 6·3픽셀 → 8장. 달리기는 그 두 배 속도.
const FRAME_MS = 50;
const CFG = {
  // 대화: 원작 입력칸(iw-ct-ba +0x8dc)은 길이 한도가 없다 (_DIRECT_EDIT_DESC+0x7c = -1, Main.dll 0x10076298).
  //  서버로 가는 패킷 본문은 0x2000 바이트까지다 (Nw200 0x10002f8f). 한글은 2바이트로 센다.
  maxChatBytes: 0x2000,
  startLevel: Math.max(1, Math.min(F.MAX_LEVEL, Number(process.env.START_LEVEL) || 1)),   // 시험용: START_LEVEL=100 npm start
};
const cutBytes = (t, n) => { let b = 0, i = 0; for (; i < t.length; i++) { b += t.charCodeAt(i) < 0x80 ? 1 : 2; if (b > n) break; } return t.slice(0, i); };
// CrItemInfo::GetRandomIIS 0x484eb0: 분류마다 고정된 표에서 GetTickCount() 로 하나. 돈(분류 5 의 0번)은 ((t % 10) + 1) × 100000, 서버 설정 Lang = 1 이면 ÷100
const RAND_ITEMS = {
  1: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 24, 33, 34, 35, 36, 37, 38, 39, 40, 41, 52, 53, 54, 73, 81, 82, 83, 84, 13, 14, 15, 16, 17, 18, 42, 55, 64, 65, 66, 67, 74, 85, 86, 87, 88,
    56, 57, 58, 43, 44, 45, 19, 20, 21, 59, 60, 61, 46, 47, 48, 49, 50, 89, 90, 91, 75, 76, 77, 78, 79, 80, 104, 105, 106],
  2: [1, 2, 3, 4, 12, 17, 18, 24, 25, 26, 27, 37, 38, 39, 51, 52, 61, 62, 73, 74, 83, 84, 85, 86, 5, 13, 40, 41, 28, 53, 63, 87, 88, 95],
  4: [1, 2, 3, 4, 5, 6, 7, 8, 21, 22, 23, 24, 25, 26, 27, 28, 34, 35, 36],
};
function randomItem(cls, t, lang) {
  if (cls === -1) cls = [1, 2, 100, 4][t & 3];
  if (cls === 100) { const v = Math.max(100000, Math.min(1000000, (t % 10 + 1) * 100000)); return [5, 0, lang === 1 ? Math.floor(v / 100) : v]; }
  const L = RAND_ITEMS[cls]; if (!L) return null;
  return [cls, L[t % L.length], 1];
}
const STATS = ['str', 'spi', 'dex', 'pow'];
const EQUIP_SLOTS = 14, RING_SLOTS = [9, 10, 11], TYPE_RING = 300;   // 착용 칸 14개: 0~8 부위별, 반지는 9·10·11번 (CheckEquipment 0x434576)
const SLOT_NAMES = ['모자', '목걸이', '상의', '하의', '신발', '방패', '장갑', '무기', '벨트', '반지', '반지', '반지', '', ''];
// NPC 이벤트 종류 (EventInfo.rse 머리말). 31~37, 82~86 이 상점이고 둘째 값이 상점 번호다 (ProcessEvent 0x41f7af~0x420b9b)
const SHOP_KINDS = [31, 32, 33, 34, 35, 36, 37, 82, 83, 84, 85, 86];
// NPC 와 말하려면 거리 < 25 (ProcessTalkToNPC 0x406815). 은행은 20 칸 (ProcessAddBankItem 0x41ddc0)
const TALK_DIST = 25, BANK_SLOTS = 20;
const NEW_CHAR = { money: 300, hp: 50, mp: 50, sp: 0, items: [[4, 1, 5], [5, 93, 1], [5, 94, 1], [5, 95, 1]],
  skills: [[1, 91], [11, 101], [21, 111], [31, 121], [41, 131], [51, 141], [71, 161], [61, 151], [81, 171]],   // 직업 번호 → [기술, 특수 기술]
  // 첫 자리: 보통 22 (8,14), 초보 안내를 고르면 68 (6,45) (svIP.exe 0x401725 / 0x4016c9, 패킷 0x3ea)
  start: { map: 22, x: 8, y: 14 }, startBeginner: { map: 68, x: 6, y: 45 } };
const EV_WARP = 1, EV_SAFE = 5;      // 이벤트 종류 (EventNNNNN.rse)
const GROUND_ITEM_MS = 600000;       // 바닥 아이템이 사라지는 시간: 10분 (CItemServer::RemoveOldItems 0x408b48)
const PERCENT_HEAL = 1900000000;     // 회복 수치가 이 값 이상이면 초과분만큼의 % 회복 (CMapServerClient::UseItem 0x432f8d)

const crypto = require('crypto');
const G = require('./grid');
const SK = require('./skills');
const { Events } = require('./events');
const EQUIP = require('./equip');
const SUBQ = require('./subquest');
const SHIP = require('./spaceship');
const { hospitalMap, DEFAULT_POS } = SHIP;
const PKM = require('./pk');
const BOARD = require('./board');
const ACC = require('./account');
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
// 걸음 시간 (원작 클라이언트 Main.dll 0x10030be0·0x10030d60·0x10031574):
//  - 한 걸음: 대각선 (24, 12) 픽셀, 가로 (48, 0), 세로 (0, 24). 장(50ms)마다 속도만큼 옮기고 남은 거리가 속도 이하면 붙는다 → 장 수 = 축마다 ⌈거리 / 속도⌉ 의 큰 쪽.
//  - s: 걷기 1, 달리기 2 (0x1003244c, 0x10032492).
//  - 장마다 픽셀 (대각선 / 곧은 방향, 0x10030d60): 보통 (4s,2s) / (6s,3s), 빠름 (8s,4s) / (12s,6s),
//    중간 (6s,3s) / (8s,4s), 느림 (2s,s) / (3s, ⌊3s/2⌋).
//  - 고르는 차례: 중간이고 느림이 아니면 중간 → 빠름이 아니고 느림이면 느림 → 빠름이고 느림이 아니면 빠름 → 그 밖 보통.
//  - 상태 (0x10031ce0~0x10031d99, rm3944cl NewWalkerEffect 0x100021ae):
//    빠름 (+0x20) = 효과 3 · 효과 36 (이노큘레이터 스피드, +0x4028 & 0x10) · 효과 63 WindWalker (rm3944 비트 +0x10 & 0x10, 서버 NewSendUseSkill 0x100023df).
//    중간 (+0x38) = WindWalker 가 아니고 효과 53 (정보 +0x20 & 0x20).
//    느림 (+0x24) = 효과 14 (+0x1b & 0x40) · 효과 55 (+0x20 & 0x80) · 효과 43 (+0x1f & 8).
const VEL = { normal: [[4, 2], [6, 3]], fast: [[8, 4], [12, 6]], mid: [[6, 3], [8, 4]], slow: [[2, 1], [3, 1.5]] };
function stepFrames(mode, dir, run) {
  const s = run ? 2 : 1, diag = dir % 2 === 1, [vx0, vy0] = VEL[mode][diag ? 0 : 1];
  const vx = vx0 * s, vy = mode === 'slow' && !diag ? Math.floor(3 * s / 2) : vy0 * s;
  const [dx, dy] = diag ? [24, 12] : (dir === 4 || dir === 6) ? [48, 0] : [0, 24];
  return Math.max(dx ? Math.ceil(dx / vx) : 0, dy ? Math.ceil(dy / vy) : 0);
}
function moveMode(p, now = Date.now()) {
  const on = e => !!(p.fx && p.fx[e] > now);
  const fast = on(3) || INOC.on(p, 0) || on(63), mid = !on(63) && on(53), slow = on(14) || on(43) || on(55);
  return mid && !slow ? 'mid' : !fast && slow ? 'slow' : fast && !slow ? 'fast' : 'normal';
}
const stepMsOf = (p, dir, run) => stepFrames(moveMode(p), dir, run) * FRAME_MS;

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
    this.walkC = m.walkC || this.walkU;                 // 원작 클라이언트 길찾기가 보는 이동 가능 표 (tools/add_walkc.js)
    this.ev = sv.ev ? Buffer.from(sv.ev, 'base64') : null; this.events = sv.events;
    let safe = '';
    for (let i = 0; i < this.w * this.h; i++) { const e = this.ev && this.events[this.ev[i]]; safe += e && e[0] === EV_SAFE ? '1' : '0'; }
    this.safeStr = safe;
    this.players = new Map(); this.mobs = new Map(); this.npcs = []; this.occ = new Map(); this.timers = []; this.gates = new Map(); this.gateSeq = 0; this.ground = new Map();
    this.mobTickAt = Date.now() + MOB_TICK;
    for (const n of sv.npcs) {
      if (!(spriteOf(n.img) in game.chrIndex)) continue;
      const t = this.findFirstEmptyPlace(n.rect, q => this.canUser(q) && !this.occ.has(this.key(q))); if (!t) continue;
      const npc = { id: game.nextId++, npc: 1, name: n.name, img: n.img, chr: spriteOf(n.img), x: t.x, y: t.y, z: t.z, dir: 2, event: n.event };
      this.npcs.push(npc); this.occ.set(this.key(t), npc.id);
    }
    let skipped = 0, seq = 0;
    // 몬스터 짝 (CMopServer::LoadMop 0x477616~0x4776d5): 불러온 순서대로 모습 81 을 모으고, 모습 82 는 다섯 마리씩 그 81 을 우두머리(+0x2e0)로 삼는다.
    //   다시 날 때도 같은 몬스터 구조체를 쓰므로 이름표(sid)로 잇는다
    this.leaderOf = {}; const q81 = []; let n82 = 0;
    for (const s of sv.spawns) {
      const info = game.mopInfo[s.kind]; if (!info) continue;
      for (let i = 0; i < s.count; i++) {
        const sid = `+${s.name}_${seq + i}`;
        if (info.img === 81) q81.push(sid);
        else if (info.img === 82 && Math.floor(n82 / 5) < q81.length) { this.leaderOf[sid] = q81[Math.floor(n82 / 5)]; n82++; }
      }
      seq += s.count;
    }
    seq = 0;
    // 몬스터 다시 나기 (CMopServer +0xd8 의 +0x3c): 우주선 맵 88~92 는 꺼진 채 시작한다 (CMopServer::CMopServer 0x476bf1)
    this.regenOn = !(mapId >= 88 && mapId <= 92); this.pendingSpawn = [];
    for (const s of sv.spawns) {
      const info = game.mopInfo[s.kind];
      // 몬스터 이름표 "+이름_n": n 은 이 맵에서 불러온 순서 (CMopServer::LoadMop 0x4772f3, "+%s_%u"). 대본의 KillMonster 가 이것으로 고른다
      const sids = []; for (let i = 0; i < s.count; i++) sids.push(`+${s.name}_${seq++}`);
      if (!info || !(spriteOf(info.img) in game.chrIndex)) { skipped += s.count; continue; }   // 그림이 없는 몬스터는 내보내지 않는다
      for (const sid of sids) { if (this.regenOn) this.spawnMob(s, sid); else this.pendingSpawn.push([s, sid]); }
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

  // 클라이언트 길찾기가 보는 이동 가능 여부 (Main.dll 0x10036a80: 0 < x < 맵 너비, 0 < y < 맵 높이, 칸의 자리 비트)
  canClient(x, y, z) { return x > 0 && y > 0 && x < this.w && y < this.h && ((this.walkC.charCodeAt(y * this.w + x) - 48) >> z & 1) === 1; }
  // 원작 클라이언트의 길찾기를 그대로 옮겼다. 한 걸음 갈 때마다 다시 찾고, 첫 걸음의 방향만 돌려준다 (0 = 못 감).
  //  FUN_100372c0 / 0x10037180 (찾기), 0x10036e50 (이웃 펼치기), 0x10036d20 (이웃 넣기), 0x10036c80 (닫힌 목록 고치기)
  //  - 걸음 값은 한 걸음에 1, 어림값은 반칸 단위 거리의 제곱: (2(x−x1) − [z1=1] + [z=1])² + (2(y−y1) − [z1=1] + [z=1])²
  //  - 열린 목록은 f 오름차순. 같은 f 면 새 것이 앞에 선다. 열린 목록에 있던 것이 나아져도 자리는 그대로 둔다
  //  - 펼친 횟수가 |dx|×맵 너비 + |dy|×맵 높이 + 3 에 이르면 그때 펼친 칸을 향해 간다
  nextDir(s, t) {
    const W = this.w, x1 = t.x, y1 = t.y, z1 = t.z ? 1 : 0;
    const heur = (x, y, z) => { const a = 2 * (x - x1) - (z1 === 1) + (z === 1), b = 2 * (y - y1) - (z1 === 1) + (z === 1); return a * a + b * b; };
    const key = (x, y, z) => (y * W + x) * 2 + z;
    const open = [], openK = new Map(), closedK = new Map();
    const insert = n => { let i = 0; while (i < open.length && open[i].f < n.f) i++; open.splice(i, 0, n); openK.set(n.k, n); };
    const st = { x: s.x, y: s.y, z: s.z ? 1 : 0, g: 0, parent: null, kids: new Array(8).fill(null) };
    st.h = heur(st.x, st.y, st.z); st.f = st.h; st.k = key(st.x, st.y, st.z); insert(st);
    const fix = n => {                                   // 0x10036c80: 나아진 칸의 아래로 값을 고쳐 내려간다 (쌓는 순서: 나중에 넣은 것 먼저)
      const stack = [];
      const walk = q => { for (const c of q.kids) if (c && c.g > q.g + 1) { c.g = q.g + 1; c.f = c.h + c.g; c.parent = q; stack.push(c); } };
      walk(n); while (stack.length) walk(stack.pop());
    };
    const add = (p, x, y, z, slot) => {
      if (!this.canClient(x, y, z)) return;
      const g = p.g + 1, k = key(x, y, z);
      let n = openK.get(k);
      if (n) { p.kids[slot] = n; if (g < n.g) { n.g = g; n.parent = p; n.f = n.h + g; } return; }
      n = closedK.get(k);
      if (n) { p.kids[slot] = n; if (g < n.g) { n.g = g; n.f = n.h + g; n.parent = p; fix(n); } return; }
      n = { x, y, z, g, parent: p, kids: new Array(8).fill(null), k }; n.h = heur(x, y, z); n.f = n.h + g; insert(n); p.kids[slot] = n;
    };
    const expand = p => {
      const { x, y } = p;
      if (p.z === 0) {
        add(p, x - 1, y, 1, 0); add(p, x, y + 1, 0, 1); add(p, x, y, 1, 2); add(p, x - 1, y, 0, 3);
        add(p, x + 1, y, 0, 4); add(p, x - 1, y - 1, 1, 5); add(p, x, y - 1, 0, 6); add(p, x, y - 1, 1, 7);
      } else {
        add(p, x, y + 1, 0, 0); add(p, x, y + 1, 1, 1); add(p, x + 1, y + 1, 0, 2); add(p, x - 1, y, 1, 3);
        add(p, x + 1, y, 1, 4); add(p, x, y, 0, 5); add(p, x, y - 1, 1, 6); add(p, x + 1, y, 0, 7);
      }
    };
    const limit = Math.abs(x1 - st.x) * W + Math.abs(y1 - st.y) * this.h + 3;
    let r = null;
    for (let n = 0; ;) {
      r = open[0]; if (!r) return 0;
      if (r.x === x1 && r.y === y1 && r.z === z1) break;
      open.shift(); openK.delete(r.k); closedK.set(r.k, r);
      expand(r);
      if (++n >= limit) break;
    }
    while (r.g > 1) r = r.parent;
    const par = r.parent; if (!par) return 0;
    const i = par.kids.findIndex(c => c && c.x === r.x && c.y === r.y && c.z === r.z);
    if (i < 0) return 0;
    return i > 3 ? i + 2 : i + 1;
  }
  // 가려는 칸을 클라이언트가 못 가면 위·아래·왼쪽·오른쪽 칸 중 처음 되는 곳으로 바꾼다. 다 안 되면 0 (FUN_10005780)
  clientGoal(t) {
    const z = t.z ? 1 : 0;
    for (const [dx, dy] of [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]]) if (this.canClient(t.x + dx, t.y + dy, z)) return { x: t.x + dx, y: t.y + dy, z };
    return null;
  }

  // ---------- 주인공 ----------
  // 맵에 들어온다 (접속, 맵 이동, 부활 공통)
  enter(p, x, y) {
    const want = x === undefined ? { x: this.spawn[0], y: this.spawn[1], z: 1 } : { x, y, z: 1 };
    const t = this.nearUser(want, 10, true) || this.nearUser(want, 10) || this.nearUser({ x: this.spawn[0], y: this.spawn[1], z: 1 }, 40) || want;
    p.enteredAt = Date.now();                                  // 맵에 들어온 뒤 시간 (+0x4348, OnTimer 가 늘린다)
    p.world = this; p.shop = null; p.bankNpc = 0; p.exchAt = null; p.x = t.x; p.y = t.y; p.z = t.z; p.goal = null; p.target = 0; p.cast = null; p.nextAt = 0;
    this.players.set(p.id, p); this.take(p);
    p.send({ t: 'welcome', id: p.id, map: this.mapId, safe: this.safeStr,
      players: [...this.players.values()].map(pubP), mobs: [...this.mobs.values()].map(pubM), npcs: this.npcs, ground: [...this.ground.values()] });
    this.game.sendStat(p); this.game.sendInv(p);
    if (Array.isArray(p.inoc) && p.inoc.some(v => v > 0)) p.send({ t: 'inoc', s: INOC.states(p) });   // 이노큘레이터 상태 (패킷 0xf9)
    this.broadcast({ t: 'add', p: pubP(p) }, p.id);
    this.game.groups.moved(p);
    const K = this.game.pk; K.enterNotice(p, this); K.legalNotice(p); if (p.pkState || p.pkPen > 0) K.send(p);   // PK 안내 (0x162 등), 남은 정당방위 (0xce)
  }
  leave(p) { if (p.trade) this.game.trades.cancel(p); this.release(p); p.evAt = {}; if (this.players.delete(p.id)) this.broadcast({ t: 'del', id: p.id }); }

  moveTo(p, x, y, z, run) {
    if (p.dead || !Number.isInteger(x) || !Number.isInteger(y) || this.fxOn(p, 39)) return;   // 효과 39 (PK 벌칙): 움직일 수 없다 (ProcessUserMoving 0x43da05)
    const t = this.clientGoal({ x, y, z: z ? 1 : 0 }); if (!t) return;
    p.goal = t; p.run = !!run; p.target = 0; p.cast = null; p.pick = 0; p.talk = 0;
  }
  attackCmd(p, id, run) {
    // 사람도 노릴 수 있다 (PK, server/pk.js). 효과 39 면 공격할 수 없다 (ProcessUserAttack 0x43a7a2)
    const m = this.mobs.get(id) || (id !== p.id ? this.players.get(id) : null);
    if (p.dead || !m || this.fxOn(p, 39)) return;
    p.target = id; p.run = !!run; p.pick = 0; p.talk = 0; p.cast = null;
  }
  // 기술 쓰기: 지금은 몬스터 한 마리를 노리는 공격 기술(효과 종류 0)만 된다.
  // 사거리 밖이면 걸어가서 쓴다. 원작은 이 걸음을 클라이언트가 하고 서버는 사거리만 확인한다 (UseSkill 0x45ed73)
  // 쓸 수 있는 기술인지: 일반 기술은 목록에 있어야 하고, 특수 기술은 직업의 특수 기술이면서 DP 가 가득 차야 한다
  skillReady(p, sid, s) {
    // 효과 58 이면 기술을 쓸 수 없고, 효과 43 이면 특수 기술만 (ProcessUseSkill 0x43c44c~0x43c476)
    if (this.fxOn(p, 58) || (this.fxOn(p, 43) && s.a === 0)) return false;
    if (s.a === 1) { if (sid !== SK.SPECIAL[p.chr]) return false; if (p.dp < p.maxDp) return false; return true; }   // DP 가 모자라면 알림 없이 끝난다 (UseSkill 0x45e4f6 → 0x45f52c)
    return SK.list(p).includes(sid);
  }
  skillCmd(p, sid, id, run) {
    const m = id ? this.mobs.get(id) : null, s = SK.get(sid);
    if (p.dead || !s || this.fxOn(p, 39) || !this.skillReady(p, sid, s)) return;   // 효과 39: 기술도 못 쓴다 (ProcessUseSkill 0x43c357)
    const area = s.l >= 10000;
    // 원작은 분기표에 없는 종류도 받는다 (한 대상: 0x451120 / 0x44c3be, 범위: 효과 없이 방향만). 그래서 사거리만 있으면 쓸 수 있다
    const ok = area || s.l > 0;
    const u = id ? this.players.get(id) : null;
    if (!area && u && u !== p && s.l > 0 && s.n !== 1 && s.n !== 44) {   // 사람에게 공격 기술 (PK). 종류 1·44 는 회복·부활 (UseSkill 0x45ed4f)
      p.cast = { sid, id, user: 1 }; p.target = 0; p.run = !!run; p.pick = 0; p.talk = 0; return;
    }
    if (!area && (s.n === 1 || s.n === 44) && m) return;        // 몬스터에게 회복·부활: 군단 홀 몬스터(0x56)만 받고 나머지는 아무 일 없음 (UseSkill 0x45ed63)
    if (!area && (s.n === 1 || s.n === 44)) {   // 주인공에게 쓰는 회복·부활 (UseSkillUserCure 0x448700)
      const now = Date.now(); if (now < (p.skillAt || 0)) return;
      const t = u || p;
      if (t !== p && (G.dist(p, t) > s.l || !this.noObstacle(p, t))) return;   // 사거리 밖이거나 막히면 알림 없이 끝난다 (UseSkill 0x45ecf0~0x45ed3d)
      p.skillAt = now + SK.USE_MS; this.cureUser(p, t, s, sid, now); return;
    }
    if (area && SK.RANGE_EFFECT_TYPES.has(s.n)) {   // 범위 효과 (UseSkillRangeEffect 0x453b00): 대상은 주인공이거나 없음
      const now = Date.now(); if (now < (p.skillAt || 0)) return;
      p.skillAt = now + SK.USE_MS; this.castRangeEffect(p, id ? this.players.get(id) : null, s, sid, now); return;
    }
    if (!ok) return;
    if (!m) {                                                   // 대상 없이 쓰는 범위 기술은 내 자리가 중심
      if (!area) return;
      const now = Date.now(); if (now < (p.skillAt || 0)) return;
      p.skillAt = now + SK.USE_MS; this.castArea(p, null, s, sid, now); return;
    }
    p.cast = { sid, id }; p.target = 0; p.run = !!run; p.pick = 0; p.talk = 0;
  }
  // 자기에게 쓰는 기술 (사거리 0)
  // ---------- 이동 기술 ----------
  // 쓰면 서버는 맵만 보고 입력 창을 열게 한다 (UseSkillMove 0x447460: 0xff Gate, 0x101 Recall, 0x107 Teleport). 창 글은 0/0/185, 186, 197
  moveSkillAsk(p, s) {
    const id = this.mapId;
    if (s.n === 20 && !SK.GATE_MAPS.has(id)) return p.send({ t: 'sys', code: 0x6c, args: [] });
    if (s.n === 23 && SK.RECALL_NO.has(id)) return p.send({ t: 'sys', code: 0x72, args: [] });
    if (s.n === 48 && SK.TELE_NO.has(id)) return p.send({ t: 'sys', code: 0xc3, args: [] });
    p.send({ t: 'mvask', kind: s.n });
  }
  skillOf(p, n) { for (const id of SK.list(p)) { const s = SK.get(id); if (s && s.a === 0 && s.n === n) return [id, s]; } return [0, null]; }
  // 입력 창의 대답 (ProcessUseGateSkill 0x43c860, ProcessUseRecallSkill 0x43ceb0, ProcessTeleportationTo 0x43d150)
  moveSkillAnswer(p, n, text) {
    if (p.dead) return;
    const [sid, s] = this.skillOf(p, n); if (!s) return;
    const now = Date.now(); text = String(text || '').trim();
    if (n === 20) {                                             // Gate: "맵 x y". 같은 맵이면 20 칸 이상 떨어져야 (0x6f), 한 사람 하나 (0x70)
      const [mn, xs, ys] = text.split(/\s+/), x = parseInt(xs, 10), y = parseInt(ys, 10);
      let to = /^\d+$/.test(mn || '') ? +mn : -1;
      if (to < 0) for (const [mid, w] of this.game.worlds) if (w.map && w.map.name === mn) to = mid;
      const tw = to >= 0 && this.game.world(to);
      if (!tw || !SK.GATE_MAPS.has(to) || !(x > 0 && y > 0) || !tw.canUser({ x, y, z: 1 })) return p.send({ t: 'sys', code: 0x6d, args: [] });
      if (to === this.mapId && G.dist(p, { x, y, z: 1 }) < 20) return p.send({ t: 'sys', code: 0x6f, args: [] });
      if ([...this.gates.values()].some(g => g.owner === p.name)) return p.send({ t: 'sys', code: 0x70, args: [] });
      const at = this.gatePosition(p); if (!at) return;
      if (this.payForSkill(p, s) < 0) return;
      // 문은 이동 이벤트(종류 1)로 그 칸에 생기고, 기술 정보 p 밀리초 뒤에 사라진다 (AddGate 0x468470, OnTimer 0x43e8e6 → RemoveGate)
      const gid = 'g' + (++this.gateSeq);
      this.gates.set(gid, { id: gid, owner: p.name, x: at.x, y: at.y, z: 1, to, tx: x, ty: y, until: now + s.p });
      this.near(p, { t: 'cast', id: p.id, sk: sid, x: at.x, y: at.y, z: 1 });
      this.near(p, { t: 'gate', id: gid, x: at.x, y: at.y, on: 1 });
      return;
    }
    const u = this.game.findOnline(text); if (!u || u === p) return;
    if (n === 23) {                                             // Recall: 불려 올 사람에게 묻는다 (0x103 → 0/0/187)
      if (SK.RECALL_NO.has(u.world.mapId)) return p.send({ t: 'sys', code: 0x71, args: [u.name] });
      if (this.payForSkill(p, s) < 0) return;
      u.recall = { from: p.name, map: this.mapId, x: p.x, y: p.y };
      u.send({ t: 'askrecall', name: p.name });
      this.near(p, { t: 'cast', id: p.id, sk: sid, tid: p.id });
    } else if (n === 48) {                                      // Teleport: 그 사람 자리로 (0x276 → SendChangeMapPacket)
      if (SK.TELE_NO.has(u.world.mapId)) return p.send({ t: 'sys', code: 0xc3, args: [] });
      if (this.payForSkill(p, s) < 0) return;
      this.game.gotoMap(p, u.world.mapId, u.x, u.y);
    }
  }
  // Recall 대답 (ProcessResponseRecall 0x43d580): 받으면 맵에 들어온 지 5초가 지났을 때만 옮긴다. 거절하면 시전자에게 0x6e
  recallAnswer(p, yes) {
    const r = p.recall; if (!r) return; p.recall = null;
    if (!yes) { const c = this.game.findOnline(r.from); if (c) c.send({ t: 'sys', code: 0x6e, args: [p.name] }); return; }
    if (Date.now() - (p.enteredAt || 0) >= 5000) this.game.gotoMap(p, r.map, r.x, r.y);
  }
  // 문 자리 (SelectGatePosition 0x43ccb0): 시전자 둘레 3×3 칸(z=1)에서 설 수 있고 이동 이벤트(종류 1)가 아닌 칸
  gatePosition(p) {
    let at = null;
    for (let y = p.y - 1; y <= p.y + 1; y++) for (let x = p.x + 1; x >= p.x - 1; x--) {
      if (x === p.x && y === p.y) continue;
      const c = { x, y, z: 1 }; if (!this.canUser(c)) continue;
      const e = this.eventAt(x, y); if (e && e[0] === 1) continue;
      if ([...this.gates.values()].some(g => g.x === x && g.y === y)) continue;
      at = c;
    }
    return at;
  }
  // Warp (효과 종류 35): 고른 자리로 바로 (ProcessUseSkill 0x43c47c → ProcessUseWarpSkill 0x43d2f0). 맵에 들어온 지 5초가 지나야
  warpCmd(p, sid, x, y, z) {
    const s = SK.get(sid); if (p.dead || !s || s.n !== 35 || !SK.list(p).includes(sid)) return;
    if (Date.now() - (p.enteredAt || 0) < 5000) return;
    const to = { x: x | 0, y: y | 0, z: z ? 1 : 0 };
    if (!this.canUser(to) || !this.free(to, p.id)) return;
    if (this.payForSkill(p, s) < 0) return;
    this.near(p, { t: 'cast', id: p.id, sk: sid, tid: p.id });
    this.release(p); p.dir = G.direction(p, to) === 5 ? 2 : G.direction(p, to); p.x = to.x; p.y = to.y; p.z = to.z; p.goal = null; this.take(p);
    this.near(p, { t: 'pos', id: p.id, x: p.x, y: p.y, z: p.z, dir: p.dir });
  }
  selfSkillCmd(p, sid) {
    const s = SK.get(sid), now = Date.now();
    if (s && s.l >= 10000) { this.skillCmd(p, sid, 0); return; }   // 범위 기술을 대상 없이
    if (p.dead || !s || !SK.list(p).includes(sid)) return;
    if (s.l === 0 && [20, 23, 48].includes(s.n)) { this.moveSkillAsk(p, s); return; }
    if (s.l !== 0) return;
    const ev = this.eventAt(p.x, p.y); if (ev && ev[0] === 0x16) { p.send({ t: 'sys', code: 0x7e, args: [] }); return; }   // 이벤트 0x16 자리에서는 자기 기술을 못 쓴다 (UseSkill 0x45e9a6)
    if (!(s.n === 1 || s.n in SK.SELF_EFFECT)) return;           // UseSkillAlone 분기표에 없는 종류는 아무 일 없음 (0x44814f)
    if (now < (p.skillAt || 0)) return;
    const cost = SK.mpCost(s, p.maxMp);
    if (p.mp < cost) return;                                     // 마력이 모자라면 알림 없이 끝난다 (CMapServerClient::DecreaseMP 0x43973d)
    p.skillAt = now + SK.USE_MS;
    this.informUseSkill(p);                                      // UseSkillAlone 뒤 InformUseSkill (UseSkill 0x45f521)
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
      if (e === 1) p.fx1Val = 0;                                  // 기술로 건 효과 1 은 값 0 (UseSkillAlone 0x4479a0)
      if (e === 17) { p.fxPow17 = p.spi; p.sp = Math.min(F.SP_MAX, p.sp + 2000); }   // Eidolon: 값 = 정신력 합 (+0x4230), 기력 + 2000 (rm3944 NewEidolonFix 0x10002d6e)
      if (e === 31) p.scarecrow = 0;                                                   // Scarecrow: 막은 횟수 (+0x4238) 를 0 으로 (0x42c1a4)
      if (SK.RECALC_FX.has(e)) this.game.recalc(p, false);
      this.sendFx(p);
    }
    this.near(p, { t: 'cast', id: p.id, sk: sid });
    this.game.sendStat(p);
  }
  fxOn(o, e, now = Date.now()) { return !!(o.fx && o.fx[e] > now); }
  fxOff(p, e) { if (p.mob) { if (p.fx) delete p.fx[e]; return; } if (p.fx && p.fx[e]) { delete p.fx[e]; if (SK.RECALC_FX.has(e)) { this.game.recalc(p, false); this.game.sendStat(p); } this.sendFx(p); } }
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
  //   사람이 때리면 (GetAttack 0x40ffd0: 일반 공격 DoAttackUser 0x4701b1, 기술 DoSkillAttackUser 0x45f634) 공격자 쪽이 다르다:
  //   rm3944 NewAttackBuffsFix 0x10003c32 로 효과 0·42·46 마다, 효과 2 이고 총·중화기, 25, 32 마다 + /5, 그리고 NewFshieldEffect 로 68·77 마다 + /5
  userDamage(a, d, dmg, now) {
    const on = e => this.fxOn(d, e, now), pct = (v, n) => v < 10000000 ? Math.floor(v * n / 100) : Math.floor(v / 100) * n;
    if (a && a.mob) for (const e of [0, 25, 32]) if (this.fxOn(a, e, now)) dmg += Math.floor(dmg / 5);
    if (a && !a.mob) {
      const ao = e => this.fxOn(a, e, now), up = () => { dmg += Math.floor(dmg / 5); };
      for (const e of [0, 42, 46]) if (ao(e)) up();
      if (ao(2) && SK.isGun(a.equip && a.equip[7])) up();
      if (ao(25)) up(); if (ao(32)) up();
      if (ao(68)) up(); if (ao(77)) up();
    }
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
    if (s.a === 1) { if (p.dp < p.maxDp) return -1; p.dp = 0; this.game.sendStat(p); this.informUseSkill(p); return 0; }
    const cost = SK.mpCost(s, p.maxMp);
    if (p.mp < cost) return -1;                                  // 알림 없음 (DecreaseMP 0x43973d)
    p.mp -= cost; this.game.sendStat(p); this.informUseSkill(p); return cost;
  }
  // 기술을 쓰면 (CMopServer::InformUseSkill 0x47d9e0): 고치기 횟수가 남고 표시가 없는 산 모습 93 몬스터가
  //   시야(+1 대각) 안이고 막힘이 없으면 표시(+0x2d4)를 세운다
  informUseSkill(p) {
    for (const o of this.mobs.values()) {
      if (o.info.img !== 93 || !(o.healCnt > 0) || o.recall || o.hp <= 0) continue;
      if (G.dist(o, p) <= (o.info.sight || 0) && this.noObstacle(o, p)) o.recall = true;
    }
  }
  // 범위 공격 (UseSkillAttackRange 0x454600)
  castArea(p, target, s, sid, now) {
    const { rad } = SK.areaOf(sid, s, !!target);
    const center = target ? { x: target.x, y: target.y, z: target.z } : { x: p.x, y: p.y, z: p.z };
    const cost = this.payForSkill(p, s); if (cost < 0) return;
    this.fxOff(p, 1); this.fxOff(p, 19);                                            // 위장이 풀린다 (0x454956)
    if (target) { const d = G.direction(p, target); if (d !== 5) p.dir = d; }
    this.near(p, { t: 'cast', id: p.id, sk: sid, x: center.x, y: center.y, z: center.z, r: rad });
    const adb = SK.AREA_DEBUFF[s.n] || null, known = s.n === 0 || s.n === 78 || adb;   // 그 밖의 종류는 대상마다 방향만 정하고 효과 없음 (0x45a9d4)
    for (const m of [...this.mobs.values()]) {
      if (m.hp <= 0 || G.dist(center, m) > rad || !this.noObstacle(center, m)) continue;
      if (!known) continue;
      if (adb) { this.debuffOne(p, m, s, sid, adb, now); continue; }
      let dmg;
      if (s.a === 1) dmg = SK.damage(SK.specialAttack(p.level), s.o, p.skDmg || 0);            // 특수: 반드시 맞음 (0x45d409)
      else if (sid in SK.AREA_FORMULA || sid === 42) {                           // 고유 식 (skills.js AREA_FORMULA)
        const fd = this.fightDex(p, now), aDex = sid === 67 ? fd + 3 * (p.bDex || 0) : fd, mDex = this.mobDex(m, now);
        if (F.rand100() > this.hitChance(p, m, F.hitPct(aDex, mDex), now)) { this.near(p, { t: 'atk', id: p.id, tid: m.id, dir: p.dir, k: 2, sk: sid, miss: 1, hp: m.hp, area: 1 }); continue; }
        if (sid === 42) {
          const v = p.atk + Math.floor((p.atkExtra || 0) / 3), cp = F.critPct(fd, mDex, 10);
          dmg = SK.damage(F.rand100() < cp ? 2 * v : v, s.o, p.skDmg || 0);
        } else dmg = SK.damage(SK.AREA_FORMULA[sid](p.atk, p) + (p.atkExtra || 0), s.o, p.skDmg || 0);
      }
      else {
        if (F.rand100() > this.hitChance(p, m, F.hitPct(p.spi, this.mobSpi(m, now)), now)) { this.near(p, { t: 'atk', id: p.id, tid: m.id, dir: p.dir, k: 2, sk: sid, miss: 1, hp: m.hp, area: 1 }); continue; }
        dmg = SK.damage(cost + (p.skSpi || 0), s.o, p.skDmg || 0);                               // 일반: 공격 값 = 마력 소모량 + T+0x34 (0x45d094)
      }
      this.applyDamage(p, m, this.mobDamage(p, Math.max(1, dmg), now, m), now, { k: 2, sk: sid, area: 1 });
    }
    this.areaUsers(p, center, rad, s, sid, cost, now);
  }
  // 범위 기술이 사람을 치는 쪽 (UseSkillAttackRange 의 사람 고리 0x454a00~0x45b7b9).
  //   반경 안, 막힘 없고, 살아 있는 다른 사람마다: skillGate(같은 그룹 빼기) → 정당방위 → 효과 24 되돌림 → 종류별 처리
  //   특수 기술: 반드시 맞고 ⌊레벨²/6⌋ + 50. 고유 식 기술: 민첩성 명중, 식 값 + T+0x30. 그 밖: 정신력 명중, 마력 소모량 + T+0x34
  //   약화 (AREA_USER_DEBUFF): 정신력 명중 뒤 효과. 되돌려지거나 효과 24 인 대상에게 빗나가면 시전자에게 (0x459ae5~0x45a852)
  areaUsers(p, center, rad, s, sid, cost, now) {
    const PK = this.game.pk, adb = SK.AREA_USER_DEBUFF[s.n] || null, known = s.a === 1 || s.n === 0 || s.n === 78 || adb;
    for (const u of [...this.players.values()]) {
      if (u === p || u.dead || G.dist(center, u) > rad || !this.noObstacle(center, u)) continue;
      if (!PK.skillGate(p, u, true)) continue;
      PK.skillSide(p, u);
      if (!known) continue;                                      // 분기표에 없는 종류: 정당방위만 남고 효과 없음 (switchD_00454e31_caseD_1)
      let reflect = false;
      if (this.fxOn(u, 24, now) && !(u.pkPen > 0)) { const r = Math.max(20, Math.min(80, Math.floor(Math.min(u.spi || 0, 7000) * 3 / 350) + 20)); reflect = F.rand100() < r; }
      const v44 = x => this.fxOn(u, 44, now) ? x + Math.floor(x / 5) : x;
      const miss = () => this.near(p, { t: 'atk', id: p.id, tid: u.id, dir: p.dir, k: 2, sk: sid, miss: 1, hp: u.hp, area: 1 });
      let av, t = u;
      if (s.a === 1) { av = SK.specialAttack(p.level); if (reflect) t = p; }
      else {
        const dexHit = !adb && (sid in SK.AREA_FORMULA || sid === 42);
        const ok = F.rand100() <= this.hitChance(p, u, F.hitPct(dexHit ? this.fightDex(p, now) : p.spi, v44(dexHit ? this.fightDex(u, now) : (u.spi || 0))), now);
        if (!ok && !this.fxOn(u, 24, now)) { miss(); continue; }
        if (!ok || reflect) t = p;
        if (adb) {
          this.near(p, { t: 'cast', id: p.id, sk: sid, tid: t.id });
          const m = this.mapId, short = (m >= 0x84 && m <= 0x88) || (m >= 0xb4 && m <= 0xbc);
          this.userEffect(t, adb.e, short && !adb.no5 ? 5 : Math.floor(p.spi / adb.div) + s.p, now, p);
          continue;
        }
        if (sid === 42) { const v = p.atk + Math.floor((p.atkExtra || 0) / 3); av = F.rand100() < F.critPct(this.fightDex(p, now), this.fightDex(u, now), 10) ? 2 * v : v; }
        else if (dexHit) av = SK.AREA_FORMULA[sid](p.atk, p) + (p.atkExtra || 0);
        else av = cost + (p.skSpi || 0);
      }
      const raw = (av > 1000000 ? Math.floor(av / 100) * s.o : Math.floor(av * s.o / 100)) + (p.skDmg || 0);
      const dmg = this.userDamage(p, t, Math.max(1, raw), now);
      if (this.fxOn(t, 6, now)) {
        t.mp = Math.max(0, t.mp - (2 * dmg + Math.floor(dmg / 4)));
        this.near(p, { t: 'atk', id: p.id, tid: t.id, dir: p.dir, k: 2, sk: sid, dmg, hp: t.hp, area: 1 });
        if (!t.mp) this.fxOff(t, 6);
        this.game.sendStat(t); continue;
      }
      this.applyDamage(p, t, dmg, now, { k: 2, sk: sid, area: 1 });
    }
  }
  // 돌진 (UseSkillMovingAttack 0x451410): 대상 쪽으로 한 칸씩 (STAFFGetNextPIS) 가서 대상 너머 한 칸을 도착점으로 삼는다 (거리 ≤ l, 설 수 있고 빈 칸).
  //   출발점과 도착점 사이 칸의 몬스터를 친 뒤 시전자를 도착점으로 옮긴다. 도착점을 정하는 쪽은 원작에서 클라이언트라 여기서는 이렇게 고른다
  castMoving(p, m, s, sid, cost, now) {
    const dir = G.direction(p, m), cells = [];
    let cur = { x: p.x, y: p.y, z: p.z }, dest = null;
    for (let i = 0; i < 40; i++) {
      const n = G.next(cur, dir); if (G.dist(p, n) > s.l) break;
      if (G.same(n, m)) { cells.push(n); const b = G.next(n, dir); if (G.dist(p, b) <= s.l && this.canUser(b) && this.free(b, p.id)) dest = b; else dest = cur; break; }
      cells.push(n); cur = n;
    }
    if (!dest) return;
    const hit = [...this.mobs.values()].filter(o => o.hp > 0 && cells.some(c => G.same(c, o)) && !G.same(o, dest));
    if (sid === 25 || sid === 45) {                             // 시전자가 옮겨지는 것은 Slash·Dash 뿐 (UseSkill 0x45f19b → ProcessUseWarpSkill)
      this.release(p); p.x = dest.x; p.y = dest.y; p.z = dest.z; p.dir = dir; this.take(p);
      this.near(p, { t: 'pos', id: p.id, x: p.x, y: p.y, z: p.z, dir });
    } else p.dir = dir;
    const X = p.atk, f = SK.MOVING[sid];
    for (const o of hit) {
      if (F.rand100() > this.hitChance(p, o, F.hitPct(this.fightDex(p, now), this.mobDex(o, now)), now)) { this.near(p, { t: 'atk', id: p.id, tid: o.id, dir, k: 2, sk: sid, miss: 1, hp: o.hp }); continue; }
      const v = (sid === 382 ? SK.bowValue(382, p, this.fightDex(p, now), this.weaponInfo(p)) : f(X, cost, o === m)) + (p.atkExtra || 0);
      this.applyDamage(p, o, this.mobDamage(p, Math.max(1, SK.damage(v, s.o, p.skDmg || 0)), now, o), now, { k: 2, sk: sid });
    }
    if (!hit.length) this.near(p, { t: 'cast', id: p.id, sk: sid, tid: m.id });
  }
  // 돌진 기술로 사람을 찍었을 때 (UseSkillMovingAttack 0x451410 의 사람 분기 0x45187f~0x452a35).
  //   조건·정당방위는 한 대상 공격과 같고, 찍은 사람만 친다 (가는 길의 다른 사람을 치는지는 확인하지 못함).
  //   명중은 양쪽 fightDex (대상 효과 44 면 + /5), 효과 24 되돌림·빗나감 되돌림, 값은 몬스터 판과 같은 식 + T+0x30 → DoSkillAttackUser
  castMovingUser(p, d, s, sid, now) {
    const PK = this.game.pk;
    if (!PK.skillGate(p, d)) return;
    const cost = this.payForSkill(p, s); if (cost < 0) return;
    PK.skillSide(p, d);
    this.fxOff(p, 1); this.fxOff(p, 19); this.fxOff(p, 35);
    const dir = G.direction(p, d);
    let cur = { x: p.x, y: p.y, z: p.z }, dest = null;
    for (let i = 0; i < 40; i++) {
      const n = G.next(cur, dir); if (G.dist(p, n) > s.l) break;
      if (G.same(n, d)) { const b = G.next(n, dir); dest = G.dist(p, b) <= s.l && this.canUser(b) && this.free(b, p.id) ? b : cur; break; }
      cur = n;
    }
    if (!dest) return;
    if (sid === 25 || sid === 45) { this.release(p); p.x = dest.x; p.y = dest.y; p.z = dest.z; p.dir = dir; this.take(p); this.near(p, { t: 'pos', id: p.id, x: p.x, y: p.y, z: p.z, dir }); }
    else p.dir = dir;
    let reflect = false;
    if (this.fxOn(d, 24, now) && !(d.pkPen > 0)) { const r = Math.max(20, Math.min(80, Math.floor(Math.min(d.spi || 0, 7000) * 3 / 350) + 20)); reflect = F.rand100() < r; }
    const dd = this.fightDex(d, now), ok = F.rand100() <= this.hitChance(p, d, F.hitPct(this.fightDex(p, now), this.fxOn(d, 44, now) ? dd + Math.floor(dd / 5) : dd), now);
    if (!ok && !this.fxOn(d, 24, now)) { this.near(p, { t: 'atk', id: p.id, tid: d.id, dir, k: 2, sk: sid, miss: 1, hp: d.hp }); return; }
    const t = !ok || reflect ? p : d;
    const av = (sid === 382 ? SK.bowValue(382, p, this.fightDex(p, now), this.weaponInfo(p)) : SK.MOVING[sid](p.atk, cost, true)) + (p.atkExtra || 0);
    const raw = (av > 1000000 ? Math.floor(av / 100) * s.o : Math.floor(av * s.o / 100)) + (p.skDmg || 0);
    const dmg = this.userDamage(p, t, Math.max(1, raw), now);
    if (this.fxOn(t, 6, now)) { t.mp = Math.max(0, t.mp - (2 * dmg + Math.floor(dmg / 4))); this.near(p, { t: 'atk', id: p.id, tid: t.id, dir, k: 2, sk: sid, dmg, hp: t.hp }); if (!t.mp) this.fxOff(t, 6); this.game.sendStat(t); return; }
    this.applyDamage(p, t, dmg, now, { k: 2, sk: sid });
  }
  // 든 무기의 아이템 정보 (CrItemInfo::Get: 분류 1 또는 6)
  weaponInfo(p) { const e = p.equip && p.equip[7]; return e ? this.game.itemInfo(e.k, e.i) : null; }
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
      this.applyDamage(p, m, this.mobDamage(p, Math.max(1, SK.damage(cost + (p.skSpi || 0), s.o, p.skDmg || 0)), now, m), now, { k: 2, sk: sid });
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
  // 모습 78 몬스터가 한 대상 기술을 맞으면 곧바로 둘째 기술을 범위로 쓴다 (UseSkillAttackSingleMop 0x451120 끝, CMopServer::UseSkillRange 0x4813c0).
  //   다음 행동까지는 그 기술의 i 값(ms)을 몬스터 박자로 나눈 만큼 (올림)
  mobCounter(p, m, now) {
    if (m.hp <= 0 || m.info.img !== 78 || !m.info.skill2) return;
    const s2 = SK.get(m.info.skill2); if (!s2) return;
    this.mobSkillArea(m, p, s2, m.info.skill2, now);
    m.delay = Math.ceil((s2.i || 0) / MOB_TICK);
  }
  // 종류 54 (한 대상): 시전자에게 효과 57 이 있으면 메시지 0x11e 로 끝나고, 없으면 효과 57 을 ⌊정신력 ÷ 50⌋ + p 초 건다 (0x44d7c5 · 0x448a7c, +0x852 & 0x200)
  lock57(p, s, now) {
    if (s.n !== 54) return true;
    if (this.fxOn(p, 57, now)) { p.send({ t: 'sys', code: 0x11e, args: [] }); return false; }
    (p.fx ||= {})[57] = now + (Math.floor((p.spi || 0) / 50) + s.p) * 1000; this.sendFx(p); return true;
  }
  castSkill(p, m, s, sid, now) {
    if (!this.lock57(p, s, now)) return;
    const cost = this.payForSkill(p, s); if (cost < 0) return;   // 마력은 명중 판정 전에 줄어든다 (DecreaseMP 0x44d835)
    if (s.a === 1) {                                             // 특수 기술: 반드시 맞음 (0x44f81c)
      this.fxOff(p, 1); this.fxOff(p, 19);
      const d = G.direction(p, m); if (d !== 5) p.dir = d;
      this.applyDamage(p, m, this.mobDamage(p, Math.max(1, SK.damage(SK.specialAttack(p.level), s.o, p.skDmg || 0)), now, m), now, { k: 2, sk: sid });
      return;
    }
    const d = G.direction(p, m); if (d !== 5) p.dir = d;
    if (s.n === 36) { this.castMoving(p, m, s, sid, cost, now); return; }
    if (s.n === 0) { this.fxOff(p, 1); this.fxOff(p, 19); this.fxOff(p, 35); }       // 종류 0 이면 위장·19·35 가 풀린다 (분기 0 의 0x44d873~0x44d8a6)
    const db = SK.MOB_DEBUFF[s.n];
    if (db) { this.castDebuff(p, m, s, sid, db, cost, now); this.mobCounter(p, m, now); return; }
    if (s.n !== 0) {                                             // 분기표에 없는 종류 (0x451120): 마력만 쓰고 효과 없이 기술 모습만 보인다
      this.near(p, { t: 'cast', id: p.id, sk: sid, tid: m.id }); this.mobCounter(p, m, now); return;
    }
    const dex = SK.hitStat(sid) === 'dex';
    if (F.rand100() > this.hitChance(p, m, F.hitPct(dex ? this.fightDex(p, now) : p.spi, dex ? this.mobDex(m, now) : this.mobSpi(m, now)), now)) {
      this.near(p, { t: 'atk', id: p.id, tid: m.id, dir: p.dir, k: 2, sk: sid, miss: 1, hp: m.hp }); return;
    }
    const av = sid in SK.BOW_DIV || sid === 385 ? SK.bowValue(sid, p, this.fightDex(p, now), this.weaponInfo(p)) : SK.attackValue(sid, p, cost);
    const dmg = this.mobDamage(p, Math.max(1, SK.damage(av + (sid in SK.BOW_DIV || sid === 385 ? (p.atkExtra || 0) : 0), s.o, p.skDmg || 0)), now, m);   // 몬스터 쪽 GetAttack(0x47acb0)은 걸린 효과의 배수만 곱하고 최소 1
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
    this.mobCounter(p, m, now);
  }
  // 사람에게 쓰는 한 대상 공격 기술 (UseSkillAttackSingleUser 0x448940, 효과 종류 0 만). 몬스터 판(castSkill)과 다른 점:
  //   - 대상이 효과 24 면: 되돌림 확률 ⌊min(정신력,7000) × 3 ÷ 350⌋ + 20 (20~80, 0x4489cc~0x448aa0). 되돌려지거나 빗나가면 시전자가 대신 맞는다 (0x449740~0x449797, 특수 기술 0x44b464)
  //   - 명중: 민첩성 기술은 양쪽 fightDex, 정신력 기술은 양쪽 기본+장비 정신력. 대상 효과 44 면 대상 값 + /5 (0x448cc5~0x449718)
  //   - 피해: 공격 값이 100만 이하면 × 위력 ÷ 100, 넘으면 ÷ 100 × 위력, + T+0x38 → 사람 쪽 GetAttack (DoSkillAttackUser 0x45f5d0)
  //   - 맞는 사람이 효과 6 이면 체력 대신 마력이 2v + v/4 줄고, 마력이 다 떨어지면 효과 6 이 풀린다 (0x45f63d~0x45f671)
  castSkillUser(p, d, s, sid, now) {
    const PK = this.game.pk;
    if (!PK.skillGate(p, d)) return;
    if (!this.lock57(p, s, now)) return;
    const cost = this.payForSkill(p, s); if (cost < 0) return;
    PK.skillSide(p, d);
    const dir = G.direction(p, d); if (dir !== 5) p.dir = dir;
    if (s.n !== 0) {                                             // 분기표에 없는 종류 (0x44c3be): 대상이 효과 45 이고 PK 벌칙 시간이 없으면 대상 마력이 0
      if (this.fxOn(d, 45, now) && !(d.pkPen > 0)) { d.mp = 0; this.game.sendStat(d); }
      this.near(p, { t: 'cast', id: p.id, sk: sid, tid: d.id }); return;
    }
    this.fxOff(p, 1); this.fxOff(p, 19); this.fxOff(p, 35);
    let reflect = false;
    if (this.fxOn(d, 24, now)) { const r = Math.max(20, Math.min(80, Math.floor(Math.min(d.spi || 0, 7000) * 3 / 350) + 20)); reflect = F.rand100() < r; }
    let av;
    if (s.a === 1) av = SK.specialAttack(p.level);
    else {
      const dex = SK.hitStat(sid) === 'dex';
      const v44 = x => this.fxOn(d, 44, now) ? x + Math.floor(x / 5) : x;
      const hitOk = F.rand100() <= this.hitChance(p, d, F.hitPct(dex ? this.fightDex(p, now) : p.spi, v44(dex ? this.fightDex(d, now) : (d.spi || 0))), now);
      if (!hitOk && !this.fxOn(d, 24, now)) { this.near(p, { t: 'atk', id: p.id, tid: d.id, dir: p.dir, k: 2, sk: sid, miss: 1, hp: d.hp }); return; }
      if (!hitOk) reflect = true;
      av = sid in SK.BOW_DIV || sid === 385 ? SK.bowValue(sid, p, this.fightDex(p, now), this.weaponInfo(p)) + (p.atkExtra || 0) : SK.attackValue(sid, p, cost);
    }
    const t = reflect ? p : d;
    const raw = (av > 1000000 ? Math.floor(av / 100) * s.o : Math.floor(av * s.o / 100)) + (p.skDmg || 0);
    const dmg = this.userDamage(p, t, Math.max(1, raw), now);
    if (this.fxOn(t, 6, now)) {
      t.mp = Math.max(0, t.mp - (2 * dmg + Math.floor(dmg / 4)));
      this.near(p, { t: 'atk', id: p.id, tid: t.id, dir: p.dir, k: 2, sk: sid, dmg, hp: t.hp });
      if (!t.mp) this.fxOff(t, 6);
      this.game.sendStat(t); return;
    }
    this.applyDamage(p, t, dmg, now, { k: 2, sk: sid });
  }
  // 사람에게 효과 걸기 (CMapServerClient::DoSkillEffect 0x42b2d0). 막히면 false
  userEffect(t, e, sec, now, caster) {
    const on = x => this.fxOn(t, x, now);
    if (on(23) || on(52) || on(76) || on(77)) return false;
    if (e !== 43 && on(42)) return false;
    if (INOC.on(t, 6)) return false;                                   // 이노큘레이터 6 (매직쉴드) 이면 약화가 안 걸린다 (DoSkillEffect 0x42b442 등 14 곳)
    if (SK.USER_BLOCK7.has(e) && on(7)) return false;
    (t.fx ||= {})[e] = now + sec * 1000;
    if (e === 15 && caster) t.voodoo = caster.name;
    if (SK.RECALC_FX.has(e)) { this.game.recalc(t, false); this.game.sendStat(t); }
    this.sendFx(t); return true;
  }
  // 사람에게 거는 약화 기술 (UseSkillAttackSingleUser 의 효과 종류 7·15·16·17·21·22·26·37·38·54·57·65·74, 0x44b50b~)
  castDebuffUser(p, d, s, sid, db, now) {
    const PK = this.game.pk;
    if (!PK.skillGate(p, d)) return;
    if (!this.lock57(p, s, now)) return;
    const cost = this.payForSkill(p, s); if (cost < 0) return;
    PK.skillSide(p, d);
    const dir = G.direction(p, d); if (dir !== 5) p.dir = dir;
    let reflect = false;
    if (this.fxOn(d, 24, now)) { const r = Math.max(20, Math.min(80, Math.floor(Math.min(d.spi || 0, 7000) * 3 / 350) + 20)); reflect = F.rand100() < r; }
    const v44 = x => this.fxOn(d, 44, now) ? x + Math.floor(x / 5) : x;
    const dex = db.hit === 'dex';
    const hitOk = F.rand100() <= this.hitChance(p, d, F.hitPct(dex ? this.fightDex(p, now) : p.spi, v44(dex ? this.fightDex(d, now) : (d.spi || 0))), now);
    if (!hitOk && !this.fxOn(d, 24, now)) { this.near(p, { t: 'atk', id: p.id, tid: d.id, dir: p.dir, k: 2, sk: sid, miss: 1, hp: d.hp }); return; }
    const t = reflect || !hitOk ? p : d;
    if (db.dmg) {                                               // n=37: 공격 값 = 마력 소모량 + T+0x34 로 먼저 친다 (0x44c2xx DoSkillAttackUser)
      const av = cost + (p.skSpi || 0);
      const raw = (av > 1000000 ? Math.floor(av / 100) * s.o : Math.floor(av * s.o / 100)) + (p.skDmg || 0);
      this.applyDamage(p, t, this.userDamage(p, t, Math.max(1, raw), now), now, { k: 2, sk: sid });
      if (t.dead || t.hp <= 0) return;
    } else this.near(p, { t: 'cast', id: p.id, sk: sid, tid: t.id });
    const m = this.mapId, short = (m >= 0x84 && m <= 0x88) || (m >= 0xb4 && m <= 0xbc);
    const sec = short && !db.no5 ? 5 : (db.div ? Math.floor(p.spi / db.div) : 0) + s.p;
    this.userEffect(t, db.e, sec, now, p);
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
      else if (p.sbonus > 0) ev.named(p, 'Level1000Quest', n);                                  // 단약 점수가 있으면 전설의 단약 만들기 (0x421064)
      else say(0x297);
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
  // 이동 이벤트 (종류 1, NPC 의 39 도 같다. ProcessEvent 0x41f239). 막히면 false
  //  맵에 들어온 지 5초가 안 되면 0x8f (+0x4348). 목적지가 여럿이면 GetTickCount() % 개수 로 하나 (0x41f2a0)
  warp(p, e, now) {
    if (now - (p.enteredAt || 0) < 5000) { this.game.story.msg(p, 0x8f); return false; }
    const k = Math.floor((e.length - 1) / 4); if (k < 1) return false;
    const j = now % k, to = e[1 + j * 4], pos = [e[2 + j * 4], e[3 + j * 4]];
    if (!this.storyGate(p, to)) return false;
    const g = this.game.ship.gate(p, to, pos);
    if (g === false) return false;
    if (g === 'done') return true;
    const w = this.game.world(to);
    if (w) { this.leave(p); w.enter(p, pos[0], pos[1]); console.log(`[이동] ${p.name}: ${this.name} → ${w.name}`); }
    return true;
  }
  // 맵 79 → 83 이동 지점: 카삼 4 를 마쳐야 하고, 회상 이야기를 듣고, 카삼 회상까지 마쳐야 지나간다 (0x41f2f0)
  storyGate(p, to) {
    if (this.mapId !== 79 || to !== 83) return true;
    const s = p.story || 0;
    if (!(s & 0x400)) { this.game.story.msg(p, 0x75); return false; }
    if (!(s & 0x800)) { if (p.pkPen > 0) this.game.pk.sendPenalty(p); else this.script.named(p, 'SayKasamRecollect'); return false; }   // PK 벌칙 중이면 남은 시간 (0x41f2f0~)
    if (!(s & 0x1000)) { this.game.story.msg(p, 0xb0); return false; }
    return true;
  }
  // NPC에게 말 걸기: 원작 클라이언트는 NPC 를 누르면 걸어가지 않고 바로 이벤트 패킷 0x118 을 보낸다 (Main.dll 0x100113ec~0x10011422).
  // 서버는 NPC와의 거리가 25 미만일 때만 받아 준다 (CExtraServer::IsExistExtraEvent 0x406815). 그보다 멀면 아무 일도 없다
  talkCmd(p, id, run) {
    const n = this.npcs.find(q => q.id === id); if (p.dead || !n) return;
    if (G.dist(p, n) >= TALK_DIST) return;
    p.target = 0; p.cast = null; p.pick = 0; p.goal = null; p.talk = id;
  }
  tryTalk(p) {
    const n = this.npcs.find(q => q.id === p.talk);
    if (!n) { p.talk = 0; return; }
    if (G.dist(p, n) >= TALK_DIST) { if (!p.goal) p.talk = 0; return; }
    p.talk = 0; p.goal = null;
    // NPC의 이벤트 번호는 맵의 이벤트가 아니라 공용 표(EventInfo.rse)를 가리킨다 (CMapServerClient::ProcessEvent 0x41ee70)
    const e = this.game.gEvents[n.event], kind = e ? e[0] : 0;
    this.game.subq.onNpc(p, n);                                         // 보조 퀘스트: 맡긴 NPC 에게 돌아왔는지, 전할 NPC 인지 (그 뒤에도 원래 일은 한다)
    if (this.storyNpc(p, n, kind, e)) return;
    if (this.game.subq.tryStart(p, n, kind)) return;                    // 보조 퀘스트를 걸면 원래 일은 StopSubQuestAndResume 때 한다
    this.npcAction(p, n);
  }
  // NPC 의 원래 일 (상점·병원·은행·교환소)
  npcAction(p, n) {
    const e = this.game.gEvents[n.event], kind = e ? e[0] : 0;
    if ((SHOP_KINDS.includes(kind) || kind === 27 || kind === 28) && this.game.shops[e[1]]) { this.game.openShop(p, e[1], n); return; }
    if (kind === 8 || kind === 81) { this.game.cure(p, n); return; }
    if (kind === 6 || kind === 80) { this.game.openBank(p, n); return; }
    if (kind === 20) { this.game.openExchange(p, e[1] || 0, n); return; }
    if (kind === 43) { this.game.pk.jailor(p); return; }
    if (kind === 1 || kind === 39) { this.warp(p, e, Date.now()); return; }   // 이동 NPC (ProcessEvent 0x41f239)
    if (kind === 2) { this.game.board.open(p, e[1]); return; }        // 게시판 (ProcessEvent case 2)                // 교도관
    // 그 밖의 종류는 원작도 아무 일 없다 (ProcessEvent 의 기본 갈래 0x421f4b). 4 메일·11~16 군단·45 배틀존은 아직 옮기지 않았다 (docs/unsourced.md)
  }

  // 이벤트 23~26: 누르면 정해 둔 자리 (x, y, 0) 에 아이템 하나가 생긴다. 이벤트마다 '분' 값 × 60000ms 에 한 번 (ProcessEvent 0x420e44~0x42107f, ReadEvent 0x405020)
  //   23: 돈, 24: 분류 4, 25: rand() 짝수면 분류 1 · 홀수면 분류 2, 26: GetTickCount() & 3 → 1·2·돈·4 (CrItemInfo::GetRandomIIS 0x484eb0)
  itemEvent(p, no, e, now) {
    const st = this.game.evTick ||= {}, cool = (e[3] || 0) * 60000;
    if (st[no] !== undefined && now >= st[no] && now - st[no] < cool) return;
    st[no] = now;
    const cls = e[0] === 23 ? 100 : e[0] === 24 ? 4 : e[0] === 25 ? (Math.floor(Math.random() * 0x8000) % 2 === 0 ? 1 : 2) : -1;
    const it = randomItem(cls, now, this.game.lang); if (!it) return;
    this.dropItem({ x: e[1], y: e[2], z: 0 }, it);
  }
  // ---------- 바닥 아이템 ----------
  dropItem(at, it) {
    const info = this.game.itemInfo(it[0], it[1]); if (!info) return;
    const g = { id: this.game.nextId++, k: it[0], i: it[1], n: it[2], x: at.x, y: at.y, z: at.z, name: info.name, icon: info.icon };
    this.ground.set(g.id, g); this.broadcast({ t: 'gadd', g });
    this.after(GROUND_ITEM_MS, () => { if (this.ground.delete(g.id)) this.broadcast({ t: 'gdel', id: g.id }); });
  }
  // 버리기 (ProcessDropItem 0x42f210, CMapServerClient::DropItem 0x433760)
  //  - 거래 중이면 0/2/0xa0, 성장 창이 열려 있으면 0x182 (성장 창은 아직 없음).
  //  - 이벤트 18 칸(공격 금지 칸) 위에서는 버릴 수 없다 (아무 말 없이 무시).
  //  - what: 'money' | 'tau' | 소지품 칸 번호. 돈은 가진 것보다 많이 달라면 가진 만큼.
  //  - 클라이언트가 고른 칸(화면에서 놓은 자리)에 떨어뜨린다. 거리는 보지 않고, 사람이 설 수 있는 칸이어야 한다 (AddItem 0x462380 GetUserCanExistPIS).
  //  - 분류 6 아이템은 땅에 놓지 않는다 (AddItem 이 분류 6 을 받지 않는다).
  dropCmd(p, what, n, at) {
    n = Math.floor(Number(n)); if (p.dead || !(n > 0)) return;
    if (p.trade) return p.send({ t: 'sys', code: 0xa0, args: [] });
    const e = this.eventAt(p.x, p.y); if (e && e[0] === EV_NO_ATTACK) return;
    const pos = at && Number.isInteger(at.x) && Number.isInteger(at.y) ? { x: at.x, y: at.y, z: at.z ? 1 : 0 } : { x: p.x, y: p.y, z: p.z };
    if (!this.canUser(pos)) return;
    if (what !== 'money' && what !== 'tau') { const s = p.inv[what | 0]; if (!s || s.k === 6) return; }
    let it;
    if (what === 'money') { const v = Math.min(n, p.money); if (!v) return; p.money -= v; it = [5, 0, v]; }
    else if (what === 'tau') { const v = Math.min(n, p.tau || 0); if (!v) return; p.tau -= v; it = [5, 2, v]; }
    else {
      const slot = what | 0, s = p.inv[slot]; if (!s) return;
      const v = Math.min(n, s.n || 1); s.n = (s.n || 1) - v; if (s.n <= 0) p.inv.splice(slot, 1);
      it = [s.k, s.i, v];
    }
    this.dropItem(pos, it); this.game.sendInv(p); this.game.sendStat(p); this.game.save(p);
  }
  // 건네기 (ProcessGiveItem 0x42f450, CMapServerServer::GiveItemTo 0x462a90)
  //  - 받는 사람은 같은 맵에 있어야 한다. 거리는 보지 않는다 (원작 서버도 보지 않는다).
  //  - 받는 사람이 거래 중이면 0xa0, 성장 창이 열려 있으면 0x182.
  //  - 둘 중 한 사람만 이벤트 10 칸 위에 있으면 0x18 "아이템을 줄 수 없습니다."
  //  - 돈: 받는 쪽이 40억이 넘으면 0x05. Tau: 0x16f. 같은 아이템이 이미 40억 개면 0x04.
  //  - 다 못 받으면 (무게·칸) 0x02. 원작은 받은 만큼만 옮긴다.
  giveCmd(p, name, what, n) {
    n = Math.floor(Number(n)); if (p.dead || !(n > 0)) return;
    name = String(name || ''); if (!name || name.length > 16) return;
    if (p.trade) return p.send({ t: 'sys', code: 0xa0, args: [] });
    const q = [...this.players.values()].find(u => u.name === name);
    if (!q || q === p || q.dead) return;
    const say = c => p.send({ t: 'sys', code: c, args: [] });
    if (q.trade) return say(0xa0);
    const ev10 = u => { const e = this.eventAt(u.x, u.y); return !!(e && e[0] === 10); };
    if (ev10(p) !== ev10(q)) return say(0x18);
    let k, i, v, slot = -1;
    if (what === 'money') { k = 5; i = 0; v = Math.min(n, p.money); if (q.money >= F.MONEY_MAX) return say(5); }
    else if (what === 'tau') { k = 5; i = 2; v = Math.min(n, p.tau || 0); if ((q.tau || 0) >= F.MONEY_MAX) return say(0x16f); }
    else {
      slot = what | 0; const s = p.inv[slot]; if (!s) return;
      k = s.k; i = s.i; v = Math.min(n, s.n || 1);
      const st = q.inv.find(e => e.k === k && e.i === i); if (st && st.n >= F.MONEY_MAX) return say(4);
    }
    if (!(v > 0)) return;
    const got = this.game.giveItem(q, k, i, v);
    if (got < v) say(2);
    if (!got) return;
    if (k === 5 && i === 0) p.money -= got;
    else if (k === 5 && i === 2) p.tau -= got;
    else { const s = p.inv[slot]; s.n = (s.n || 1) - got; if (s.n <= 0) p.inv.splice(slot, 1); }
    this.game.sendInv(p); this.game.sendStat(p); this.game.save(p); this.game.save(q);
  }
  // 줍기: 아이템이 놓인 자리까지 걸어가서 줍는다
  pickupCmd(p, id, run) {
    const g = this.ground.get(id); if (p.dead || !g) return;
    if (this.fxOn(p, 9)) { p.goal = null; p.target = 0; p.cast = null; p.pick = id; p.talk = 0; return; }   // 효과 9: 걸어가지 않고 줍는다
    const t = this.clientGoal(g); if (!t) return;
    p.goal = t; p.run = !!run; p.target = 0; p.cast = null; p.pick = id; p.talk = 0;
  }
  tryPickup(p) {
    const g = this.ground.get(p.pick);
    if (!g) { p.pick = 0; return; }
    if (!G.same(g, p) && !this.fxOn(p, 9)) return;              // 효과 9: 떨어진 곳의 아이템도 줍는다 (ProcessGetItem 0x42edda)
    p.pick = 0; p.goal = null;
    const took = this.game.giveItem(p, g.k, g.i, g.n);
    if (took >= g.n) { this.ground.delete(g.id); this.broadcast({ t: 'gdel', id: g.id }); } else g.n -= took;
  }
  // 대화 (CMapServerClient::ProcessChat 0x441070)
  //  보통: 5초에 세 번까지 (최근 세 번의 시각, ProcessNormalChat 0x441150). 주변에
  //  외치기: 10초에 세 번까지, 레벨 5 부터 (아니면 0/2/0x17), 같은 맵 모두에게 (ProcessLoudChat 0x441280, CMapServerServer::ProcessLoudChat 0x473820)
  //  귓속말: 이름이 없으면 0/2/0x11, 감옥(맵 78)에서는 0/2/0xac (ProcessWhisperChat 0x4413f0, ProcessWhisperFailed 0x474030)
  rateOk(p, key, ms) { const q = (p[key] ||= [0, 0, 0]); const now = Date.now(); if (q[0] && now > q[0] && now - q[0] < ms) return false; q.shift(); q.push(now); return true; }
  chat(p, text) {
    text = String(text || '').replace(/[\u0000-\u001f]/g, ' ').trim(); text = cutBytes(text, CFG.maxChatBytes);
    if (!text || !this.rateOk(p, 'chatAt', 5000)) return;
    this.near(p, { t: 'chat', id: p.id, name: p.name, text });
  }
  shout(p, text) {
    text = String(text || '').replace(/[\u0000-\u001f]/g, ' ').trim(); text = cutBytes(text, CFG.maxChatBytes);
    if (!text || !this.rateOk(p, 'shoutAt', 10000)) return;
    if (p.level < 5) { this.game.story.msg(p, 0x17, 5); return; }
    this.broadcast({ t: 'chat', id: p.id, name: p.name, text, kind: 'shout' });
  }
  whisper(p, to, text) {
    text = String(text || '').replace(/[\u0000-\u001f]/g, ' ').trim(); text = cutBytes(text, CFG.maxChatBytes); to = String(to || '').trim();
    if (!text || !to || to === p.name) return;
    if (this.mapId === 78) { this.game.story.msg(p, 0xac); return; }
    const q = this.game.findOnline(to);
    if (!q) { this.game.story.msg(p, 0x11, to); return; }
    if (q.world.mapId === 78) { this.game.story.msg(p, 0xab, q.name); return; }   // 받는 사람이 감옥에 있으면 0/2/171
    const m = { t: 'chat', id: p.id, name: p.name, to: q.name, text, kind: 'whisper' };
    p.send(m); q.send(m);
  }

  // ---------- 몬스터 ----------
  // 죽은 몬스터는 배치표의 시간 뒤에 다시 난다. 다시 나기가 꺼져 있으면 켜질 때까지 기다린다
  respawnLater(d) {
    (this.deadMobs ||= new Map()).set(d.sid, d);
    this.after(d.s.regen * 1000, () => {
      if (this.deadMobs.get(d.sid) !== d) return;                // 불러오기로 이미 되살아났다
      // 다시 나기 조건 (CMopAddServer::DoWork 0x474f70): 모습 87 은 다시 나지 않는다. 모습 78 은 12월 20~26일에만 (tm_mon = 11, 19 < tm_mday < 27)
      const img = d.info.img, t = new Date();
      if (img === 87) return;
      if (img === 78 && !(t.getMonth() === 11 && t.getDate() > 19 && t.getDate() < 27)) { this.respawnLater(d); return; }
      this.deadMobs.delete(d.sid);
      if (!this.regenOn) { this.pendingSpawn.push([d.s, d.sid]); return; }
      const n = this.spawnMob(d.s, d.sid); if (n) this.broadcast({ t: 'madd', m: pubM(n) });
    });
  }
  // SetMopRegen 0x47ab40
  setRegen(on) {
    this.regenOn = !!on; if (!on) return;
    const list = this.pendingSpawn; this.pendingSpawn = [];
    for (const [s, sid] of list) { const n = this.spawnMob(s, sid); if (n) this.broadcast({ t: 'madd', m: pubM(n) }); }
  }
  // ClearAllMop 0x476f60: 모두 없앤다 (경험치·아이템 없이)
  clearMobs() {
    for (const m of [...this.mobs.values()]) { this.release(m); this.mobs.delete(m.id); this.broadcast({ t: 'die', id: m.id }); this.respawnLater(m); }
  }
  // 배치표의 영역 좌표를 그대로 써서 자리를 고른다 (CMopServer::LoadMop 0x4773ac)
  spawnMob(s, sid) {
    const info = this.game.mopInfo[s.kind];
    const t = this.findFirstEmptyPlace(s.rect, q => this.canMop(q)); if (!t) return null;
    const st = F.mobStats(info, s.pattern);
    const m = { id: this.game.nextId++, mob: 1, sid, leaderSid: this.leaderOf && this.leaderOf[sid], s, info, pattern: s.pattern, home: t, name: s.name, chr: spriteOf(info.img), x: t.x, y: t.y, z: t.z, dir: G.DIRS[rnd(8)],
      str: st.str, spi: st.spi, dex: st.dex, pow: st.pow, atk: st.atk, minPct: st.minPct, maxHp: st.maxHp, hp: st.maxHp, exp: st.exp,
      // 사거리는 두 공격 범위 중 큰 값 (CMopInfo::LoadMopInfo 0x475f63)
      maxRange: Math.max(info.range, info.range2 || 0),
      // 배치표의 아이템 칸 다섯 중 하나를 무작위로 지닌다. 빈 칸이면 아무것도 없다 (InitializeMopInstance 0x4795a3)
      item: s.drops[rnd(5)] || null,
      cnt: 0, delay: 0, targetName: '', warpState: 0, warpCnt: 0,
      // 스스로 고치는 횟수 (+0x118, InitializeMopInstance 0x479519~0x479551): 첫 기술이 종류 1 이면 1, 모습 93 이면 1, 모습 98 이면 10
      healAt: Date.now(), healCnt: info.img === 98 ? 10 : info.img === 93 ? 1 : (info.skill && SK.get(info.skill) && SK.get(info.skill).n === 1 ? 1 : 0) };
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
    if (this.fxOn(u, 1) && m.spi <= (u.fx1Val || 0) + 2 * (u.bSpi ?? u.base.spi)) return false;   // 효과 1 의 값 (+0x432c) + 기본 정신력 × 2 (0x47d752)
    return true;
  }
  // 몬스터 주변의 관리 영역: 가로 ±10칸, 세로 ±13칸 (CMapServerServer::SetManagementRect 0x468220)
  inMgmt(m, u) {
    const xo = this.w <= 21 || (u.x >= Math.max(0, m.x - 10) && u.x <= Math.min(m.x + 10, this.w - 1));
    const yo = this.h <= 27 || (u.y >= Math.max(0, m.y - 13) && u.y <= Math.min(m.y + 13, this.h - 1));
    return xo && yo;
  }
  // 다음에 할 일을 고른다. 돌려주는 값: 0 없음, 1 배회, 2 쫓기, 3·5·6 공격, 4 유인된 쫓기 (CMopServer::FindNextAction 0x47cc60)
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
    // 몬스터 걸음 시간: 서버는 움직임 종류 1 (걷기) 을 보낸다 (CNPCServer::SendRectMovementInfo 0x483040, local_2 = 1).
    // 클라이언트는 사람과 같은 셈으로 그린다: 종류 = 동작 + 1 (사람이 보내는 패킷 0xca +7 = 달리기 ? 2 : 1, 0x10005be0), 동작 0 은 s = 1 (0x10032824 표).
    // 그래서 몬스터도 효과에 따른 걷기 장 수다 (moveMode)
    const near = G.dist(m, n) <= 1, dur = stepFrames(moveMode(m), dir, false) * FRAME_MS;
    this.release(m); m.x = n.x; m.y = n.y; m.z = n.z; m.dir = dir; if (!m.info.noOccupy) this.take(m);
    this.nearMove(m, near ? { t: 'step', id: m.id, x: n.x, y: n.y, z: n.z, dir, dur, run: 0, last: 1 } : { t: 'pos', id: m.id, x: n.x, y: n.y, z: n.z, dir });
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
  // 공격 (CMopServer::DoAttack 0x47dd70). r = 0~19 무작위로 갈래를 고른다:
  //   1 = 첫 공격 우선, 2 = 둘째 공격 우선, 4 = 둘째 기술, s1 = 첫 기술, 5 = 모습 84 의 동료 고치기.
  //   기술이 없거나 모습 79·80 이거나 몬스터 효과 58 이면 r>9 ? 2 : 1. 기술 둘 다 있으면 모습(61·84·93·98·그 밖)마다 표가 다르다 (0x47de3a~0x47dfe0).
  //   둘째 기술만: r<8 → 1, r<12 → 4, 그 밖 2. 첫 기술만: r<9 → 1, r>10 → 2, r 9·10 이면 첫 기술 종류로 (1·11 → 1, 68 → 체력 65% 넘으면 1, 39 → 대상 장비가 있으면) (0x47e5d6~)
  //   다음 행동까지 기다리는 시간은 쓴 쪽의 간격 (일반 = 간격1·2, 첫 기술 = 기술간격1, 둘째 기술 = 기술간격2)
  mobAttack(m, u, now) {
    const info = m.info, d = G.dist(m, u), r1 = info.range, r2 = info.range2 || 0;
    if (d > 1 && this.fxOn(m, 13, now)) return false;           // 효과 13: 공격 사거리 1 (FindNextAction 0x47cffd)
    const s1 = info.skill ? SK.get(info.skill) : null, s2 = info.skill2 ? SK.get(info.skill2) : null;
    const f58 = this.fxOn(m, 58, now), img = info.img, r = rnd(20);
    const wait = ms => { m.delay = Math.ceil((ms || 0) / MOB_TICK); };
    const normal = second => { wait(second ? info.interval2 : info.interval); const dir = G.direction(m, u); if (dir !== 5) m.dir = dir; this.hit(m, u, now, second ? 1 : 0); return true; };
    const reach = s => { let l = s.l; const area = l >= 10000; if (area) l -= 10000; return { l, area }; };
    const useSk = (s, sid, ms) => { const { area } = reach(s); if (area) this.mobSkillArea(m, u, s, sid, now); else this.mobSkill(m, u, s, sid, now); wait(ms); return true; };
    // 둘째 기술 (0x47eb22): 사거리 밖이면 하지 않는다
    const use2 = () => { if (!s2) return false; const { l } = reach(s2); if (d > l) return false; useSk(s2, info.skill2, info.skillMs2); m.lastSkillAt = now; return true; };
    // 일반 공격이 안 닿을 때의 둘째 기술 (0x47e8ec 와 그 앞): 모습 74 면 안 쓰고, 첫 기술이 없으면 네 번에 한 번은 쉰다
    const fallback2 = areaAware => {
      if (img === 74 || !s2) return false;
      if (!s1 && rnd(4) === 0) return false;
      if (!areaAware) { if (d > s2.l) return false; this.mobSkill(m, u, s2, info.skill2, now); wait(info.skillMs2); return true; }
      return use2();
    };
    const use1 = () => {                                        // 첫 기술 (0x47e7d7)
      const { l } = reach(s1);
      if (d > l && l !== 0) return fallback2(true);
      if ((s1.n === 42 && this.fxOn(u, 27, now)) || (s1.n === 38 && (this.fxOn(u, 14, now) || this.fxOn(u, 43, now)))) return fallback2(true);
      return useSk(s1, info.skill, info.skillMs);
    };
    let mode;
    if ((!info.skill && !info.skill2) || img === 79 || img === 80 || f58) mode = r > 9 ? 2 : 1;
    else if (info.skill2) {
      const k1 = () => (s1 && (s1.n === 1 || s1.n === 11)) ? 1 : 's1';
      if (!info.skill) mode = r < 8 ? 1 : r < 12 ? 4 : 2;
      else if (img === 61) mode = r < 3 ? 1 : r < 6 ? 2 : r <= 8 ? k1() : 4;
      else if (img === 84) return this.mobCureAlly(m, s2, info.skillMs2, now);
      else if (img === 93) mode = r < 3 ? 1 : r <= 5 ? 2 : 4;
      else if (img === 98) mode = r < 3 ? 1 : r <= 4 ? 2 : r <= 14 ? 's1' : 4;
      else if (r < 7) mode = 1;
      else if (r < 10) mode = k1();
      else if (r < 13) mode = img === 74 && m.lastSkillAt && now - m.lastSkillAt < 20000 ? 1 : 4;
      else mode = 2;
    } else {
      if (r < 9) mode = 1;
      else if (r > 10 || !s1) mode = 2;
      else if (s1.n === 1 || s1.n === 11) mode = 1;
      else if (s1.n === 68) mode = Math.floor(m.hp * 100 / m.maxHp) > 65 ? 1 : 's1';
      else if (s1.n === 39) mode = u.equip && Object.values(u.equip).some(Boolean) ? 's1' : 1;
      else mode = 's1';
    }
    if (mode === 4) return use2();
    if (mode === 's1') return use1();
    // 1·2: 둘 다 안 닿으면 몬스터 효과 58 이면 끝, 아니면 다섯에 넷은 쉰다 (GetTickCount % 5)
    if (d > r1 && d > r2) { if (f58 || rnd(5) !== 0) return false; }
    if (mode === 1) {
      if (d <= r1) return normal(false);
      if (d > r2) return fallback2(false);
      return normal(true);
    }
    if (d <= r2) return normal(true);
    if (d <= r1) return normal(false);
    return fallback2(true);
  }
  // 모습 84 (0x47ecb6): 둘째 기술 사거리 안의 다른 몬스터 가운데 다쳤거나 혼란 상태인 것을 찾아 나쁜 효과를 풀고 체력을 채운다. 없으면 아무것도 안 한다
  mobCureAlly(m, s2, ms, now) {
    const l = s2.l >= 10000 ? s2.l - 10000 : s2.l;
    for (const o of this.mobs.values()) {
      if (o === m || o.hp <= 0 || G.dist(m, o) > l) continue;
      if (o.hp === o.maxHp && !this.mobDisorder(o, now)) continue;
      this.mobBadOff(o);
      o.hp = o.maxHp;
      const dir = G.direction(m, o); if (dir !== 5) m.dir = dir;
      this.near(m, { t: 'cast', id: m.id, sk: m.info.skill2, tid: o.id }); this.near(m, { t: 'hp', id: o.id, hp: o.hp });
      m.delay = Math.ceil((ms || 0) / MOB_TICK); return true;
    }
    return false;
  }
  // 몬스터가 사람 한 명에게 쓰는 기술 (CMopServer::UseSkill 0x480790)
  //   사거리가 있으면 명중 판정: 기술 18·207 은 몬스터 민첩성 대 사람 기본 민첩성, 그 밖은 정신력 대 기본 정신력.
  //   사람이 효과 24 면 빗나가도 되돌려지고, 맞아도 ⌊min(정신력,7000)×3/350⌋+20 (20~80)% 로 되돌려진다 (0x48087f~0x4809e4)
  //   효과 종류: 2 → 사람 효과 5 (몬스터 정신력/30 초), 17 → 13 (/150), 38 → 14 (/30), 42 → 27 (/30), 68 → 58 (p 초)
  //   18·19·67 → 피해: 18 은 몬스터 공격력, 19 는 t=⌊⌊정신력/15⌋×정신력/10⌋+50 에서 ⌊t/40⌋+⌊t/5⌋, 67 은 0. 위력 % 를 곱해 사람 쪽 GetAttack
  //   41 → 몬스터가 효과 26 (정신력/30, 모습 74 는 10초) 을 얻고 다섯 걸음 달아난다. 되돌려지면 몬스터에게 걸린다
  //   67 은 피해 뒤 빠른 창에서, 39 는 장비에서 훔친다 (mobSteal). 빗나가면 사람 효과 45 의 반격 (몬스터 효과 55)
  mobSkill(m, u, s, sid, now) {
    const dir = G.direction(m, u); if (dir !== 5) m.dir = dir;
    let hit = true, refl = false;
    if (s.l > 0) {
      const dex = sid === 18 || sid === 207;
      hit = F.rand100() <= this.hitChance(m, u, F.hitPct(dex ? m.dex : m.spi, dex ? (u.bDex || 0) : (u.bSpi || 0)), now);
      if (this.fxOn(u, 24, now)) {
        if (!hit) { hit = true; refl = true; }
        else { const c = Math.max(20, Math.min(80, Math.floor(Math.min(u.spi || 0, 7000) * 3 / 350) + 20)); if (F.rand100() < c) refl = true; }
      }
    }
    if (!hit) {
      // 빗나갔을 때 사람이 효과 45 면 몬스터에게 효과 55 를 DB 정신력(+0x3f60) ÷ 20 초 (0x4808d6)
      if (this.fxOn(u, 45, now)) this.mobEffect(m, 55, Math.floor((u.base.spi || 0) / 20), u, now);
      this.near(m, { t: 'atk', id: m.id, tid: u.id, dir: m.dir, k: 2, sk: sid, miss: 1, hp: u.hp }); return;
    }
    const spi = m.spi;
    switch (s.n) {
      case 2:
        if (refl) this.mobEffect(m, 5, Math.floor(spi / 30), null, now);
        else if (this.userEffect(u, 5, Math.floor(spi / 30), now) && sid === 203 && !m.recall) { m.recall = true; this.recallSkill(m, { x: u.x, y: u.y, z: u.z }); }   // 기술 203 이 걸리면 그 사람 자리로 부하를 부른다 (0x480a3b~0x480a74)
        break;
      case 17: refl ? this.mobEffect(m, 13, Math.floor(spi / 150), null, now) : this.userEffect(u, 13, Math.floor(spi / 150), now); break;
      case 38: refl ? this.mobEffect(m, 14, Math.floor(spi / 30), null, now) : this.userEffect(u, 14, Math.floor(spi / 30), now); break;
      case 42: if (!refl) this.userEffect(u, 27, Math.floor(spi / 30), now); break;
      case 68: refl ? this.mobEffect(m, 58, s.p, null, now) : this.userEffect(u, 58, s.p, now); break;
      case 41: {
        this.mobEffect(m, 26, m.info.img === 74 ? 10 : Math.floor(spi / 30), null, now);
        for (let i = 0; i < 5; i++) { let dd = rnd(8); dd = dd === 0 ? 8 : dd === 5 ? 9 : dd; this.npcMove(m, dd, null, false); }
        break;
      }
      case 18: case 19: case 67: {
        let v = 0;
        if (s.n === 18) v = m.atk;
        else if (s.n === 19) { const t = Math.floor(Math.floor(spi / 15) * spi / 10) + 50; v = Math.floor(t / 40) + Math.floor(t / 5); }
        if (refl) { this.applyDamage(u, m, this.mobDamage(u, Math.max(1, SK.damage(v, s.o, 0)), now, m), now, { k: 2, sk: sid }); break; }
        const dmg = this.userDamage(m, u, Math.floor(s.o * v / 100), now);
        if (this.fxOn(u, 6, now)) { u.mp = Math.max(0, u.mp - (2 * dmg + Math.floor(dmg / 4))); if (!u.mp) this.fxOff(u, 6); this.near(m, { t: 'atk', id: m.id, tid: u.id, dir: m.dir, k: 2, sk: sid, dmg, hp: u.hp }); this.game.sendStat(u); break; }
        this.applyDamage(m, u, dmg, now, { k: 2, sk: sid });
        if (s.n === 67 && !u.dead) this.mobSteal(m, u, 'quick');
        return;
      }
      case 39: if (!refl) this.mobSteal(m, u, 'equip'); break;
    }
    this.near(m, { t: 'cast', id: m.id, sk: sid, tid: refl ? m.id : u.id });
  }
  // 몬스터의 특수 행동 (CMopServer::DoSpecialAction 0x47c650). DoNextAction 이 FindNextAction 바로 뒤에 부르고, 1 이면 그 차례는 끝이다.
  //   몬스터가 효과 5·16·18·43 이 아니고 첫 기술이 있어야 한다. 모습마다:
  //   59: 체력이 절반 이하이고 고치기 횟수가 남았으면 DoCure (0x47db30): 최대 체력의 위력 % 만큼 채운다. 범위 기술이면 반경 안 다른 몬스터도
  //   70: 효과 8 이 없고 체력 절반 이하면 스스로 효과 8 (정신력/30 초), 기술간격1 만큼 쉰다
  //   79: 대상이 있으면 (act>1) 아직 안 훔쳤고 체력 51% 미만이며 첫 기술 사거리 안이면 DoItemStealSkill, 체력 26% 미만이면 DoUseItem
  //   80: 자폭 (DoExplosionAttack 0x47a460): 대상이 없으면 단계를 0 으로. 체력 51% 미만이면 단계 −1~−3, 아니면(단계 100 이 아니면) 1~4.
  //       첫 기술 반경(l−10000) 안이면 |단계|(+3) × 65000 을 공격 값으로 범위 기술을 쓴다. 단계가 0 이상일 때 맞기 전 체력이 50% 넘으면 단계 100 (DecreaseHP 0x478416)
  //   84: 맞기 전 체력이 가득이었으면 불러오기 (recallSkill). 93: 고치기 횟수가 있고 불러오기 표시가 서 있으면 범위 효과 (mobRangeEffect)
  mobSpecial(m, u, act, now) {
    const info = m.info, img = info.img;
    if (!info.skill || this.fxOn(m, 5, now) || this.fxOn(m, 16, now) || this.fxOn(m, 18, now) || this.fxOn(m, 43, now)) return false;
    const s1 = SK.get(info.skill); if (!s1) return false;
    const pct = () => m.hp < 20000001 ? Math.floor(m.hp * 100 / m.maxHp) : Math.floor(m.hp / Math.floor(m.maxHp / 100));
    const inReach = l => u && G.dist(m, u) + (m.z !== u.z ? 1 : 0) <= l;
    if (img === 59) {
      if (m.hp > Math.floor(m.maxHp / 2) || !(m.healCnt > 0)) return false;
      m.healCnt--;
      const heal = o => { o.hp = Math.min(o.maxHp, o.hp + Math.floor(s1.o * o.maxHp / 100)); this.near(o, { t: 'hp', id: o.id, hp: o.hp }); };
      heal(m);
      if (s1.l > 10000) for (const o of this.mobs.values()) if (o !== m && o.hp > 0 && G.dist(m, o) <= s1.l - 10000) heal(o);
      this.near(m, { t: 'cast', id: m.id, sk: info.skill, tid: m.id });
      return true;
    }
    if (img === 70) {
      if (this.fxOn(m, 8, now) || m.hp > Math.floor(m.maxHp / 2)) return false;
      this.mobEffect(m, 8, Math.floor(m.spi / 30), null, now);
      m.delay = Math.ceil((info.skillMs || 0) / MOB_TICK); return true;
    }
    if (img === 79) {
      if (act <= 1) return false;
      if (!m.stole && pct() < 51 && inReach(s1.l)) return this.mobStealPotions(m, u);
      if (pct() < 26) return this.mobUsePotion(m);
      return false;
    }
    // 모습 93: 남은 횟수(+0x118)가 있고 불러오기 표시(+0x2d4)가 서 있으면 첫 기술로 범위 효과 (CMopServer::UseSkillRangeEffect 0x482180)
    if (img === 93 && m.healCnt > 0 && m.recall) { this.mobRangeEffect(m, s1, info.skill, now, info.skillMs); return true; }
    if (img === 84 && m.recall) {                               // 맞기 전 체력이 가득이었으면 불러오기 (DoSpecialAction 0x47cb60)
      if (this.recallSkill(m, null)) { this.near(m, { t: 'cast', id: m.id, sk: info.skill }); m.recall = false; return true; }
      return false;
    }
    if (img === 82) {                                           // 우두머리가 혼란 상태면 51% 로 나쁜 효과를 풀어 준다 (DoRestorationSkill 0x47a9d0)
      const L = m.leaderSid && [...this.mobs.values()].find(o => o.sid === m.leaderSid);
      if (!L || L.hp <= 0 || !this.mobDisorder(L, now) || rnd(100) >= 51) return false;
      this.mobBadOff(L);
      const dir = G.direction(m, L); m.dir = dir === 5 ? 2 : dir;
      this.near(m, { t: 'cast', id: m.id, sk: info.skill, tid: L.id }); this.near(L, { t: 'hp', id: L.id, hp: L.hp });
      return true;
    }
    if (img === 80) {
      if (act < 2) { if (m.boom) m.boom = 0; return false; }
      const R = s1.l - 10000;
      if (pct() < 51) { if (!inReach(R)) return false; m.boom = (m.boom || 0) >= 0 ? -1 : Math.max(-3, m.boom - 1); }
      else if ((m.boom || 0) !== 100) { if (!inReach(R)) return false; m.boom = (m.boom || 0) < 1 ? 1 : Math.min(4, m.boom + 1); }
      else return false;
      const lv = m.boom < 0 ? -m.boom + 3 : m.boom;
      const saved = m.atk; m.atk = lv * 65000; this.mobSkillArea(m, u, s1, info.skill, now); m.atk = saved;
      return true;
    }
    return false;
  }
  // 몬스터 범위 효과 (CMopServer::UseSkillRangeEffect 0x482180): 반경 l − 10000 안의 산 몬스터마다 (자기 포함).
  //   종류 69 면 한 번 고른 r = rand() % 3 에 따라 효과 8 / 25 / 23 을 몬스터 정신력 ÷ 50 초. 다음 행동까지 기술 간격, 고치기 횟수·불러오기 표시는 0
  mobRangeEffect(m, s, sid, now, ms) {
    if (s.l > 10000) {
      const R = s.l - 10000, r = rnd(3), e = [8, 25, 23][r];
      for (const o of [...this.mobs.values()]) {
        if (o.hp <= 0 || G.dist(m, o) > R) continue;
        if (s.n === 69) this.mobEffect(o, e, Math.floor(m.spi / 50), null, now);
      }
    }
    this.near(m, { t: 'cast', id: m.id, sk: sid, x: m.x, y: m.y, z: m.z, r: Math.max(0, s.l - 10000) });
    m.delay = Math.ceil((ms || 0) / MOB_TICK); m.healCnt = 0; m.recall = false;
    return true;
  }
  // 불러오기 (CMopServer::DoRecallSkill 0x47a560). 부른 자리(pos, 없으면 부른 몬스터 자리)에서 ±⌊시야/2⌋ 사각형(맵 안으로)을 잡고
  //   그 안의 무작위 한 칸(자리 1)을 한 번 본다 (GetNearbyPIS 0x47a4e0 → FindEmptyPlace 0x4831b0). 빈 칸이면 몬스터를 그리로 옮긴다
  //   모습 84: 모습 83·82 가운데 살아 있고 시야보다 멀리 있는 것을 50% 로, 각각 다섯까지
  //   모습 81: 이 81 을 우두머리로 둔 82 를. 다시 나기가 켜져 있으면 죽은 것도 그 자리에 되살린다
  recallSkill(m, pos) {
    const R = m.info.sight || 0, h = Math.floor(R / 2), c = pos || m, W = this.w, H = this.h;
    const rx = 2 * Math.floor(R / 2) + 1 < W ? [c.x > h ? c.x - h : 0, Math.min(c.x + h, W - 1)] : [0, W - 1];
    const ry = 2 * Math.floor(R / 2) + 1 < H ? [c.y > h ? c.y - h : 0, Math.min(c.y + h, H - 1)] : [0, H - 1];
    const spot = () => { const q = { x: rx[0] + rnd(rx[1] - rx[0] + 1), y: ry[0] + rnd(ry[1] - ry[0] + 1), z: 1 }; return this.canMop(q) && this.free(q) ? q : null; };
    const place = (o, q) => { this.release(o); o.x = q.x; o.y = q.y; o.z = q.z; if (!o.info.noOccupy) this.take(o); this.near(o, { t: 'pos', id: o.id, x: q.x, y: q.y, z: q.z, dir: o.dir }); };
    let moved = false, nS = 0, nR = 0;
    if (m.info.img === 84) {
      for (const o of [...this.mobs.values()]) {
        const im = o.info.img; if (o.hp <= 0 || !((im === 83 && nS < 5) || (im === 82 && nR < 5))) continue;
        if (G.dist(m, o) <= R || rnd(2) !== 0) continue;
        const q = spot(); if (!q) continue;
        place(o, q); moved = true; if (im === 83) nS++; else nR++;
        if (nS > 4 && nR > 4) return true;
      }
    } else if (m.info.img === 81) {
      for (const o of [...this.mobs.values()]) if (o.info.img === 82 && o.leaderSid === m.sid) { const q = spot(); if (q && this.regenOn) { place(o, q); moved = true; } }
      if (this.regenOn) for (const [sid, d] of [...(this.deadMobs || new Map())]) {
        if (d.info.img !== 82 || d.leaderSid !== m.sid) continue;
        const q = spot(); if (!q) continue;
        this.deadMobs.delete(sid); const n = this.spawnMob(d.s, sid); if (!n) continue;
        place(n, q); this.broadcast({ t: 'madd', m: pubM(n) }); moved = true;
      }
    }
    return moved;
  }
  // 나쁜 효과 풀기 (CMopServer::OnBadSkillExpired 0x47bca0): 5·4·13·12·15·16·18·14·55·27·54·47·43·58
  mobBadOff(o) { for (const e of [5, 4, 13, 12, 15, 16, 18, 14, 55, 27, 54, 47, 43, 58]) this.fxOff(o, e); }
  // 혼란 상태 (CMopServer::IsDisorderState 0x47ac40): 몬스터 효과 시간 칸 +0x188·18c·1a8·1ac·1b0·1b4·1b8·1c0·1e4 가운데 하나라도 남아 있으면.
  //   칸 = 0x188 + 4 × (효과 − 4) 이다 (CMopServer::DoSkillEffect 0x479630 의 분기: 4 → 0x188, 8 → 0x198, 14 → 0x1b0, 23 → 0x1d4, 27 → 0x1e4)
  //   그래서 효과 4·5·12·13·14·15·16·18·27
  mobDisorder(o, now) { return [4, 5, 12, 13, 14, 15, 16, 18, 27].some(e => this.fxOn(o, e, now)); }
  // 물약 훔치기 (DoItemStealSkill 0x47a2e0): 대상 빠른 창 8칸 가운데 분류 4 이고 10개 이상인 것마다 ⌊n/10⌋ 을 빼앗는다.
  //   번호 21 미만이거나 34·35 면 몬스터 소지품(같은 칸)에 넣는다. 하나라도 빼앗으면 그림 0x2f, 대상에게 글 0xa8, 다시는 안 훔친다
  mobStealPotions(m, u) {
    let any = false; m.items ||= [];
    (u.quick || []).forEach((e, i) => {
      if (i >= 8 || !e || e.k !== 4 || e.n <= 9) return;
      const take = Math.floor(e.n / 10); e.n -= take; any = true;
      if (e.i < 21 || e.i === 34 || e.i === 35) m.items[i] = { k: 4, i: e.i, n: take };
    });
    if (!any) return false;
    this.near(m, { t: 'cast', id: m.id, sk: m.info.skill, tid: u.id, fx: 0x2f });
    this.game.story.msg(u, 0xa8); this.game.sendInv(u); m.stole = true;
    return true;
  }
  // 물약 쓰기 (DoUseItem 0x47a230): 소지품 첫 물약으로 체력을 채운다 (값이 1899999026 이면 최대 체력의 절반). 다 쓰면 칸을 비운다
  mobUsePotion(m) {
    const list = m.items || [];
    for (let i = 0; i < 8; i++) {
      const e = list[i], it = e && e.n > 0 && this.game.itemInfo(e.k, e.i); if (!it) continue;
      const add = it.hp === 1899999026 ? Math.floor(m.maxHp / 2) : it.hp;
      m.hp = Math.min(m.maxHp, m.hp + add); if (--e.n === 0) list[i] = null;
      this.near(m, { t: 'hp', id: m.id, hp: m.hp }); return true;
    }
    return false;
  }
  // 몬스터의 훔치기 (UseSkill 0x480c2c~, 0x480e5c~): 종류 67 은 빠른 창(8칸, 가방 3)에서, 39 는 장비(14칸, 가방 2)에서 무작위 칸을 고른다.
  //   빈 칸이면 아래로, 그다음 위로 찾는다 (빠른 창은 분류 6 을 건너뛴다). 빠른 창은 절반(1 이하면 1)을, 장비는 통째로 몬스터 자리에 떨어뜨린다 (DropItem)
  mobSteal(m, u, bag) {
    const list = bag === 'quick' ? (u.quick || []) : u.equip, n = bag === 'quick' ? 8 : 14;
    const ok = e => e && e.n !== 0 && (bag !== 'quick' || e.k !== 6);
    const start = rnd(n); let slot = -1;
    if (ok(list[start])) slot = start;
    else if (bag === 'quick' && list[start] && list[start].k === 6) slot = -1;
    else { for (let i = start; i >= 0 && slot < 0; i--) if (ok(list[i])) slot = i; for (let i = start; i < n && slot < 0; i++) if (ok(list[i])) slot = i; }
    if (slot < 0) return;
    const e = list[slot];
    if (bag === 'quick') {
      const take = e.n >= 2 ? e.n >> 1 : 1;
      e.n -= take; if (e.n <= 0) list[slot] = null;
      this.dropItem(m, [e.k, e.i, take]);
    } else {
      list[slot] = null; this.dropItem(m, [e.k, e.i, 1]);
      this.game.recalc(u, false); this.game.sendStat(u); this.near(u, { t: 'hp', id: u.id, hp: u.hp, maxHp: u.maxHp });
    }
    this.game.sendInv(u);
  }
  // 몬스터의 범위 기술 (CMopServer::UseSkillRange 0x4813c0). 반경 = l − 10000. 중심은 몬스터 자리 (기술 212·213·216 만 대상 자리, 212 는 반경 − 1)
  //   반경 안 살아 있는 사람마다: 막힘이 없고 효과 19(숨기)가 아니어야 한다 (종류 73 은 막힘·숨기 무시, 0x4815ef~0x481618)
  //   명중: 종류 43 은 20%, 그 밖은 몬스터 정신력 대 사람 기본 정신력. 효과 24 되돌림은 한 명 판과 같고, 모습 78 은 늘 맞고 되돌림 없음, 모습 98 은 되돌림 없음
  //   값 = 몬스터 공격력, 피해 = 위력 % (값 500만 이상이면 ÷100 먼저) → 사람 쪽 GetAttack. 종류 43 은 사람 효과 16 도, 71 은 27, 73 은 효과 19·35·26 을 먼저 푼다
  //   되돌려지면 사람이 몬스터를 친다 (DoSkillAttackMop). 70 지속 피해(ProcessCSAttack), 72 마력 0, 모습 98 의 스스로 회복
  //   cont: 지속 피해 목록이 다시 부른 것 (param_8 = 1). 이때 중심은 처음 대상 자리이고 몬스터가 죽었어도 친다
  mobSkillArea(m, target, s, sid, now, cont) {
    let rad = s.l - 10000, center = cont ? { x: target.x, y: target.y, z: target.z } : { x: m.x, y: m.y, z: m.z };
    if (cont) { /* 중심 그대로 */ } else if (sid === 212) { rad = Math.max(1, s.l - 10001); center = { x: target.x, y: target.y, z: target.z }; }
    else if (sid === 213 || sid === 216) center = { x: target.x, y: target.y, z: target.z };
    if (!G.same(center, m)) { const dir = G.direction(m, center); if (dir !== 5) m.dir = dir; }
    this.near(m, { t: 'cast', id: m.id, sk: sid, x: center.x, y: center.y, z: center.z, r: rad });
    const img = m.info.img, k = s.n, v = m.atk;
    // 모습 98 이 종류 73 을 쓰면: 체력 % 가 50 미만이고 남은 횟수(+0x118)가 있으면 체력을 채운다 (0x48144c~0x4814a4)
    if (img === 98 && k === 73 && m.healCnt > 0) {
      const pct = m.hp > 20000000 ? Math.floor(m.hp / Math.floor(m.maxHp / 100)) : Math.floor(m.hp * 100 / m.maxHp);
      if (pct < 50) { m.hp = m.maxHp; m.healCnt--; this.near(m, { t: 'hp', id: m.id, hp: m.hp }); }
    }
    const DMG = new Set([0, 43, 45, 70, 71, 72, 73]);           // 피해를 주는 종류 (분기표 0x482118/0x482134)
    for (const u of [...this.players.values()]) {
      if (u.dead || G.dist(center, u) > rad) continue;
      if (k !== 73 && (!this.noObstacle(center, u) || this.fxOn(u, 19, now))) continue;
      let hit = k === 43 ? F.rand100() <= 20 : F.rand100() <= this.hitChance(m, u, F.hitPct(m.spi, u.bSpi || 0), now), refl = false;
      if (this.fxOn(u, 24, now)) {
        if (!hit) { hit = true; refl = true; }
        else { const c = Math.max(20, Math.min(80, Math.floor(Math.min(u.spi || 0, 7000) * 3 / 350) + 20)); if (F.rand100() < c) refl = true; }
      }
      if (img === 78) { hit = true; refl = false; } else if (img === 98) refl = false;
      if (!hit) { this.near(m, { t: 'atk', id: m.id, tid: u.id, dir: m.dir, k: 2, sk: sid, miss: 1, hp: u.hp, area: 1 }); continue; }
      // 피해가 아닌 종류 (0x481bc2~0x481e2e). 68 은 rm3944 NewMassAnih: 효과 58 을 15초
      if (k === 68) { this.userEffect(u, 58, 15, now); continue; }
      if (!DMG.has(k)) {
        const sp = m.spi;
        if (k === 2) { if (img === 78) this.userEffect(u, 59, 180, now); else if (refl) this.mobEffect(m, 5, s.p, null, now); else this.userEffect(u, 5, s.p, now); }
        else if (k === 17) { if (refl) this.mobEffect(m, 13, Math.floor(sp / 30), null, now); else this.userEffect(u, 13, Math.floor(sp / 150), now); }
        else if (k === 22) { if (refl && img !== 78) this.mobEffect(m, 16, s.p, null, now); else this.userEffect(u, 16, s.p, now); }
        else if (k === 26) this.userEffect(u, 18, Math.floor(sp / 30), now);
        else if (k === 40) { if (this.userEffect(u, 16, Math.floor(sp / 150), now)) { u.mp = 0; this.game.sendStat(u); } }
        continue;
      }
      if (refl) {
        if (k === 43) { this.mobEffect(m, 16, Math.floor(m.spi / 150), null, now); this.fxOff(m, 26); }
        this.applyDamage(u, m, this.mobDamage(u, Math.max(1, SK.damage(v, s.o, 0)), now, m), now, { k: 2, sk: sid, area: 1 });
        if (m.hp <= 0) return; continue;
      }
      if (k === 43) this.userEffect(u, 16, Math.floor(m.spi / 150), now);
      // 71: 사람 효과 27 을 ⌊USERINFO +0x790 ÷ 100⌋ 초 (0x48197e). USERINFO(+0x37d8) +0x790 = 사용자 +0x3f68 = DB 기골
      else if (k === 71) this.userEffect(u, 27, Math.floor((u.base.pow || 0) / 100), now);
      else if (k === 72) { u.mp = 0; this.game.sendStat(u); }   // 72: DecreaseMP(지금 마력 USERDB +0x7a0) = 마력 0 (0x4819c1)
      else if (k === 70 && !cont) {                             // 70: 맞은 사람마다 지속 피해 목록에 하나씩 넣는다 (중심 자리, 횟수 2). 1초 넘게 지날 때마다 그 자리에 다시 범위 기술 (AddToCSAttackList 0x481917, ProcessCSAttack 0x482a40)
        (this.mobCS ||= []).push({ m, s, sid, at: now, n: 2, pos: { x: center.x, y: center.y, z: center.z } });
      }
      const raw = v < 5000000 ? Math.floor(s.o * v / 100) : Math.floor(v / 100) * s.o;
      const dmg = this.userDamage(m, u, raw, now);
      if (k === 73) { this.fxOff(u, 19); this.fxOff(u, 35); this.fxOff(u, 26); }
      if (this.fxOn(u, 6, now)) { u.mp = Math.max(0, u.mp - (2 * dmg + Math.floor(dmg / 4))); if (!u.mp) this.fxOff(u, 6); this.game.sendStat(u); continue; }
      this.applyDamage(m, u, dmg, now, { k: 2, sk: sid, area: 1 });
    }
  }
  // 몬스터 한 마리의 행동 (CMopServer::DoNextAction 0x47be90)
  mobAct(m, now) {
    const info = m.info, [act, u] = this.findNextAction(m), t200 = T200 * (this.fxOn(m, 55) ? 2 : 1), step = info.speed * t200, canMove = info.speed > 0;
    // 패턴 2: 처음 본 대상을 기억해 두고 계속 그 대상을 쫓는다 (원작은 이때 외치는 말도 내보낸다)
    if (m.pattern === 2 && act >= 2 && !m.targetName && u) m.targetName = u.name;
    // 모습 98: 남은 고치기 횟수가 5 보다 적고 지난번부터 60초가 넘었으면 5 로 (DoNextAction 0x47be90, +0x298)
    if (info.img === 98 && m.healCnt < 5 && now - (m.healAt || 0) > 60000) { m.healAt = now; m.healCnt = 5; }
    if (info.img === IMG_WARPER) {      // 3초 돌아다니고 근처로 순간이동하기를 세 번, 그다음 3초 멈춘 뒤 첫 기술을 범위로 쓴다
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
      else {
        if (info.skill && SK.get(info.skill) && u) this.mobSkillArea(m, u, SK.get(info.skill), info.skill, now);   // UseSkillRange (0x47c5a0)
        m.warpCnt = 0; m.warpState = 0; m.delay = Math.ceil((info.skillMs || 0) / MOB_TICK);
      }
      return;
    }
    if (this.mobSpecial(m, u, act, now)) return;
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
  // 꿰뚫기 (CMapServerServer::DoAttackThrough 0x46b170): 공격자 A 에서 노린 대상 T 로 곧게 뻗은 줄 위의 몬스터·사람을 모두 친다.
  //  - 사거리 R = 무기 사거리 (+0x4334). 효과 11 이고 정해진 총이면 +2 (0x46b36e). D(A,T) > R 이면 아무것도 안 한다.
  //  - T 를 가운데로 R 안의 것 E 를 훑는다 (FirstInDistanceEntry). A 와 E 사이 장애물이 없어야 하고 같은 그룹은 뺀다.
  //  - E 가 T 가 아니면 줄 위인지 본다 (0x46bb..): 한 걸음 = STAFFGetNextPIS (grid.next(cur, direction(cur, 목표))).
  //      D(A,E) < D(A,T): A 에서 T 쪽으로 걸어가며 E 에 닿으면 맞음. 닿기 전에 T 에 이르면 (D(cur,T) < 1) 빗나감.
  //      그 밖: A 에서 E 쪽으로 걸어가며 T 에 닿으면 맞음. D(A,cur) > R 이거나 cur 의 x 또는 y 가 E 와 같아지면 빗나감.
  //  - 명중 판정은 맞는 것마다 따로 한다 (GetAttackSuccessful 가 훑기 안에 있다).
  //  - 효과 34 이고 같은 총들이면 사거리는 25 다 (0x46b3e8, 효과 11 보다 뒤에 정해진다).
  //  - 노린 대상이 사람이면: 그 사람이 숨기(효과 19)이고, PK 벌칙(+0x4158)이 없거나 공격자에게 효과 3 이 없으면 하지 않는다.
  //    공격자 PK 모드가 꺼져 있고 대상이 보통 직업(0~9)이어도 하지 않는다 (인자 3 = +0x4028 비트 5). 이것은 pk.attack 이 막는다.
  throughAttack(p, t, now) {
    const gun = SK.isGunOnly(p.equip[7]);
    let R = p.range; if (gun && this.fxOn(p, 11, now)) R += 2; if (gun && this.fxOn(p, 34, now)) R = 25;
    const A = { x: p.x, y: p.y, z: p.z }, T = { x: t.x, y: t.y, z: t.z };
    if (G.dist(A, T) > R) return;
    if (!t.mob && this.fxOn(t, 19, now) && (!(t.pkPen > 0) || !this.fxOn(p, 3, now))) return;
    const same = (a, b) => a.x === b.x && a.y === b.y;
    const step = (c, to) => G.next(c, G.direction(c, to));
    const onLine = E => {
      if (same(E, T) && E.z === T.z) return true;
      let cur = { ...A };
      if (G.dist(A, E) < G.dist(A, T)) {
        for (let n = 0; n < 64; n++) { if (G.dist(cur, T) < 1) return false; cur = step(cur, T); if (same(cur, E)) return true; }
        return false;
      }
      for (let n = 0; n < 64; n++) { if (G.dist(A, cur) > R || cur.x === E.x || cur.y === E.y) return false; cur = step(cur, E); if (same(cur, T)) return true; }
      return false;
    };
    const near = e => G.dist(T, e) <= R && this.noObstacle(p, e) && onLine(e);
    const hits = [];
    for (const m of this.mobs.values()) if (m.hp > 0 && (m === t || near(m))) hits.push(m);
    for (const u of this.players.values()) if (u !== p && !u.dead && !(p.group && u.group === p.group) && (u === t || near(u))) hits.push(u);
    for (const d of hits) {
      if (d.mob) { if (!this.safe(p.x, p.y)) this.hit(p, d, now); continue; }   // 공격자가 안전 칸이면 몬스터는 치지 않는다 (iStack_94c)
      const r = this.game.pk.attack(p, d);
      if (r && r !== 'skip') this.hit(p, d, now);
    }
  }
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
    // 공격력 = 근력 공격 + 무기 공격 + ⌊T+0x30 / 3⌋ (DoAttackMop 0x46f8a3)
    let dmg = Math.max(1, F.rollDamage(a.atk + (a.mob ? 0 : Math.floor((a.atkExtra || 0) / 3)), a.minPct) * (crit ? 2 : 1));
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
    const pct = (v, n) => v < 10000000 ? Math.floor(v * n / 100) : Math.floor(v / 100) * n;
    // CMopServer::DecreaseHP 0x47836d~0x478434: 피해가 0 보다 크면 모습 87 은 피해 ÷4, 모습 98 은 ÷10. 모습 78 은 처음 다섯 번은 맞지 않는다 (+0x29c).
    //   모습 80 은 자폭 단계가 0 이상일 때 맞기 전 체력이 50% 넘으면 단계 100. 모습 84 는 맞기 전 체력이 가득이면 불러오기 표시(+0x2d4)
    if (d.mob && dmg > 0) {
      const img = d.info.img;
      if (img === 87) dmg = dmg >>> 2; else if (img === 98) dmg = Math.floor(dmg / 10);
      if (img === 78 && (d.ignored || 0) < 5) { d.ignored = (d.ignored || 0) + 1; return; }
      const hp0 = d.hp < 20000001 ? Math.floor(d.hp * 100 / d.maxHp) : Math.floor(d.hp / Math.floor(d.maxHp / 100));
      if (img === 80 && (d.boom || 0) >= 0 && hp0 > 50) d.boom = 100;
      else if (img === 84 && d.hp === d.maxHp) d.recall = true;
    }
    // 장비 묶음 덤 (server/equip.js): 몬스터에게 주는 피해 + mobDmgPct% (CMopServer::DecreaseHP 0x478446, 최대 2억),
    //   몬스터에게 받는 피해 − mobDefPct% (최대 80, 적어도 1 은 남김. CMapServerClient::DecreaseHP 0x4393d2)
    //   공격자에게 효과 68·69 (USERINFO +0x854 & 0x30) 가 있으면 그 값에 다시 ÷10 을 더한다 (0x47847e)
    if (d.mob && a && !a.mob && dmg > 0) {
      if (a.mobDmgPct > 0) dmg += pct(dmg, a.mobDmgPct);
      if (this.fxOn(a, 68, now) || this.fxOn(a, 69, now)) dmg += Math.floor(dmg / 10);
      dmg = Math.min(200000000, dmg);
    }
    //   이노큘레이터 1 (몬스터 방어) 이 켜져 있으면 +15 (최대 80, 0x4393d8)
    if (!d.mob && a && a.mob && dmg > 0) { let r = Math.min(80, d.mobDefPct || 0); if (INOC.on(d, 1)) r = Math.min(80, r + 15); if (r > 0) dmg -= Math.min(pct(dmg, r), Math.max(dmg, 1) - 1); }
    // 사람에게 맞을 때 (CMapServerClient::DecreaseHP 0x4394a0):
    //   줄임 % = 장비 대인 방어 (+0x4378, 최대 90). 레벨 1000 이 1000 미만에게 맞으면 +30, 이노큘레이터 7 이면 +15 (각각 최대 90).
    //   더함 = 공격자 +0x4370 % (장비 묶음 덤). 피해 += 더함, 그다음 줄임만큼 빼되 1 은 남긴다. 최대 2억.
    //   공격자에게 효과 68·69 (USERINFO +0x854 & 0x30) 가 있으면 더함에 원래 피해의 ÷10 을 보탠다 (0x439560)
    if (!d.mob && a && !a.mob && dmg > 0) {
      let r = Math.min(90, d.pvpPct || 0);
      if (d.level === 1000 && a.level < 1000) r = Math.min(90, r + 30);
      if (INOC.on(d, 7)) r = Math.min(90, r + 15);
      const cut = r > 0 ? pct(dmg, r) : 0, plus = (a.mobDmgPct > 0 ? pct(dmg, a.mobDmgPct) : 0) + (this.fxOn(a, 68, now) || this.fxOn(a, 69, now) ? Math.floor(dmg / 10) : 0);
      dmg += plus; if (cut) dmg -= Math.min(cut, Math.max(dmg, 1) - 1); dmg = Math.min(200000000, dmg);
    }
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
    this.broadcast({ t: 'die', id: d.id, by: !d.mob && a && !a.mob ? a.name : undefined });
    if (d.mob) {
      this.release(d); this.mobs.delete(d.id);
      if (d.item) this.dropItem(d, d.item);
      this.respawnLater(d);
      if (!a.mob) { if (!this.game.groups.shareExp(a, d, d.exp)) this.game.gainExp(a, d.exp); this.script.killed(a, d.sid, d); this.game.subq.onKill(a, d); }
    } else this.killPlayer(d, false, a);
  }
  // 사람이 죽음 (CMapServerClient::Dead)
  killPlayer(d, announce = true, killer = null) {
    if (announce) this.broadcast({ t: 'die', id: d.id });
    this.game.pk.killed(d, killer);                                    // 벌칙 (Dead 0x43b2ab)
    if (d.trade) this.game.trades.cancel(d);
    d.hp = 0; d.dead = true; d.target = 0; d.cast = null; d.goal = null; d.pick = 0; d.talk = 0;
    this.game.deathPenalty(d);
  }

  // 50ms마다 호출
  tick(now) {
    for (let i = this.timers.length - 1; i >= 0; i--) if (now >= this.timers[i].at) { const t = this.timers.splice(i, 1)[0]; t.fn(); }
    for (const g of [...this.gates.values()]) if (now >= g.until) { this.gates.delete(g.id); this.broadcast({ t: 'gate', id: g.id, on: 0 }); }
    this.game.ship.tick(this, now);                                     // 우주선 퀘스트 주기 (맵 87~92)
    if (this.mobCS && this.mobCS.length) for (let i = this.mobCS.length - 1; i >= 0; i--) {   // 몬스터 지속 피해 (CMopServer::ProcessCSAttack 0x482a40)
      const c = this.mobCS[i];
      if (c.n < 1) { this.mobCS.splice(i, 1); continue; }
      if (now - c.at > 1000) { c.n--; c.at = now; if (c.s.l > 9999) this.mobSkillArea(c.m, c.pos, c.s, c.sid, now, true); }
    }
    if (!this.players.size) { this.mobTickAt = now + MOB_TICK; return; }
    this.script.tickAmbient(now);
    for (const p of [...this.players.values()]) {
      const dt = now - (p.subqAt || now); p.subqAt = now;
      if (p.inoc) { const ch = INOC.tick(p, dt); if (ch.length) this.game.inocChanged(p, ch); }   // 이노큘레이터 남은 시간 (OnTimer 0x42e450)
      if (p.subq && p.subq.state) this.game.subq.tick(p, dt);
      this.game.pk.tick(p, now, dt);                                     // PK 모드 켜기, 정당방위, 벌칙 시간
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
        const m = this.mobs.get(p.target) || this.players.get(p.target);
        if (!m || (!m.mob && m.dead)) p.target = 0;
        else if (G.dist(p, m) <= p.range + (this.fxOn(p, 11, now) && SK.isGun(p.equip[7]) ? 2 : 0)) {   // 효과 11: 총을 들었을 때 사거리 + 2
          p.goal = null;
          if (now >= p.atkAt && now >= p.nextAt) {
            const d = G.direction(p, m); if (d !== 5) p.dir = d; p.atkAt = now + this.game.attackMs(p);
            if (this.fxOn(p, 50, now) && SK.isGunOnly(p.equip[7])) this.throughAttack(p, m, now);   // 효과 50 Dysperse + 총: 꿰뚫기 (ProcessUserAttack 0x43a8c8)
            else if (m.mob) this.hit(p, m, now);
            else {                                                            // 사람: PK 조건 (DoAttack 0x469dd0)
              const r = this.game.pk.attack(p, m);
              if (r === 'skip') p.target = 0;
              else if (r) this.hit(p, m, now);
              else this.near(p, { t: 'atk', id: p.id, tid: m.id, dir: p.dir, k: 0, miss: 1, hp: m.hp });
            }
          }
        } else p.goal = { x: m.x, y: m.y, z: m.z };                 // 클라이언트는 걸음마다 대상의 지금 자리로 다시 길을 찾는다
      }
      if (p.fx) { let ch = false, rc = false; for (const e in p.fx) if (p.fx[e] <= now) { delete p.fx[e]; ch = true; if (SK.RECALC_FX.has(+e)) rc = true; } if (rc) { this.game.recalc(p, false); this.game.sendStat(p); } if (ch) this.sendFx(p); }   // 효과 시간 끝 (OnSkillEffectExpired)
      if (p.cast) {
        const m = p.cast.user ? this.players.get(p.cast.id) : this.mobs.get(p.cast.id), s = SK.get(p.cast.sid);
        if (!m || !s || (p.cast.user && m.dead)) p.cast = null;
        else if (s.l >= 10000 ? G.dist(p, m) <= s.l - 10000 : G.dist(p, m) <= s.l && this.noObstacle(p, m)) {
          p.goal = null;
          if (now >= (p.skillAt || 0) && now >= p.nextAt) {
            const sid = p.cast.sid, toUser = !!p.cast.user; p.cast = null; p.skillAt = now + SK.USE_MS;
            if (toUser) { if (s.n === 36) this.castMovingUser(p, m, s, sid, now); else if (s.n in SK.USER_DEBUFF) this.castDebuffUser(p, m, s, sid, SK.USER_DEBUFF[s.n], now); else this.castSkillUser(p, m, s, sid, now); }
            else if (s.l >= 10000) this.castArea(p, m, s, sid, now); else this.castSkill(p, m, s, sid, now);
          }
        } else p.goal = { x: m.x, y: m.y, z: m.z };
      }
      if (p.pick && now >= p.nextAt) this.tryPickup(p);
      if (p.talk && now >= p.nextAt) { this.tryTalk(p); if (p.world !== this) continue; }
      if (!p.goal || now < p.nextAt) continue;
      if (G.same(p, p.goal)) { p.goal = null; continue; }
      const nd = this.nextDir(p, p.goal);
      if (!nd) { p.goal = null; continue; }
      const n = G.next(p, nd);
      // 갈 수 없거나 누가 서 있는 자리면 멈춘다 (한 자리에는 하나만: CrsMap::Move 0x486480)
      if (!this.canUser(n) || !this.free(n, p.id)) { p.goal = null; continue; }
      // 달리면 걸음마다 기력이 들고 회복 시계가 처음부터 다시 돈다. 걸으면 걸음 수만 센다 (ProcessUserMoving 0x43da90~0x43dc35)
      let running = p.run && p.sp > 0;
      if (running && (this.fxOn(p, 62, now) || INOC.on(p, 11))) { p.steps = 0; }      // 효과 62 Unlimited Stamina (rm3944 NewStaminaEffect 0x100025c4) 나 이노큘레이터 11 (원래 명령 test byte [+0x402e], 0xc0 at 0x43da99): 달려도 기력이 줄지 않는다
      else if (running) { const c = F.runCost(p.dex); p.sp = p.sp > c ? p.sp - c : 0; p.regenAt = now + F.REGEN_MS; p.steps = 0; if (++p.spSent % 4 === 0 || !p.sp) this.game.sendStat(p); }
      else p.steps++;
      this.fxOff(p, 34);                                          // 효과 34 Snipe: 움직이면 풀린다 (ProcessUserMoving 0x43da7a)
      const dir = G.direction(p, n), dur = stepMsOf(p, dir, running);
      this.release(p); if (dir !== 5) p.dir = dir; p.x = n.x; p.y = n.y; p.z = n.z; p.nextAt = now + dur; this.take(p);
      this.nearMove(p, { t: 'step', id: p.id, x: n.x, y: n.y, z: n.z, dir: p.dir, dur, run: running ? 1 : 0, last: G.same(n, p.goal) ? 1 : 0 });
      this.script.moved(p); if (p.world !== this) continue;
      // Dimensional Gate 가 연 문 (동적 이벤트 종류 1)
      const gt = [...this.gates.values()].find(g => g.x === n.x && g.y === n.y);
      if (gt) { this.game.gotoMap(p, gt.to, gt.tx, gt.ty); continue; }
      // 맵 이동 지점을 밟으면 다른 맵으로 넘어간다
      const e = this.eventAt(n.x, n.y);
      if (e && e[0] === EV_WARP && this.warp(p, e, now) === false) p.goal = null;
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
  // 알려 주는 범위 (CMapServerServer::SetManagementRect 0x468220): 가로 ±10, 세로 ±13 칸, 맵 끝에서 자른다.
  //  맵이 가로 22 칸, 세로 28 칸보다 작으면 그 방향은 맵 전체. 경계는 포함한다 (CrsMap 0x488537)
  viewRect(e) {
    const W = this.w, H = this.h, r = [0, 0, W - 1, H - 1];
    if (W >= 22) { r[0] = e.x < 11 ? 0 : e.x - 10; r[2] = Math.min(e.x + 10, W - 1); }
    if (H >= 28) { r[1] = e.y < 14 ? 0 : e.y - 13; r[3] = Math.min(e.y + 13, H - 1); }
    return r;
  }
  // 걸음은 그보다 두 칸 넓게 (SendRectMovementInfo 0x468020, 주인공 0x467fe9 · 몬스터 0x483074)
  moveRect(e) {
    const r = this.viewRect(e);
    r[0] = r[0] < 3 ? 0 : r[0] - 2; r[1] = r[1] < 3 ? 0 : r[1] - 2; r[2] += 2; r[3] += 2;
    if (e.x < 22) r[0] = 0; else if (e.x >= this.w - 22) r[2] = this.w - 1;
    if (e.y < 28) r[1] = 0; else if (e.y >= this.h - 28) r[3] = this.h - 1;
    return r;
  }
  sendRect(r, msg) { for (const p of this.players.values()) if (p.x >= r[0] && p.x <= r[2] && p.y >= r[1] && p.y <= r[3]) p.send(msg); }
  near(e, msg) { this.sendRect(this.viewRect(e), msg); }
  nearMove(e, msg) { this.sendRect(this.moveRect(e), msg); }
}
// 명성 단계 (UpdateCIS 0x463c3d, CIS +0x26): 명성 > 0 이면 ⌊(명성−1)/200⌋+1 (최대 5), < 0 이면 −(⌊(−명성−1)/200⌋+1) (최소 −5)
const fameTier = f => f > 0 ? Math.min(5, Math.trunc((f - 1) / 200) + 1) : f < 0 ? Math.max(-5, Math.trunc((f + 1) / 200) - 1) : 0;
const pubP = p => ({ id: p.id, name: p.name, chr: p.chr, x: p.x, y: p.y, z: p.z, dir: p.dir, hp: p.hp, maxHp: p.maxHp, level: p.level, dead: p.dead ? 1 : 0, ft: fameTier(p.fame || 0) });
const pubM = m => ({ id: m.id, mob: 1, name: m.name, chr: m.chr, x: m.x, y: m.y, z: m.z, dir: m.dir, hp: m.hp, maxHp: m.maxHp });

// 시그너스 맵 (93~108, 137~176): 상점·은행은 돈 대신 Tau(시그너스 돈, 아이템 5/2, DB 칸 SigMoney)를 쓰고 은행도 따로다
// (ProcessUserBuyItem 0x4294f0, ProcessUserSellItem 0x42a540, ProcessAddBankMoney 0x41dc10, SendBankInfo 0x41ec10: 맵 0x5d~0x6c, 0x89~0xb0)
const isSignus = m => (m >= 0x5d && m <= 0x6c) || (m >= 0x89 && m <= 0xb0);
const cur = p => isSignus(p.world.mapId) ? 'tau' : 'money';

// 전설의 단약 수와 한도 (원작 DB tblSpecialItem1 의 6/66 개수, tblSpecialItemLimit1 의 한도).
// 받은 원작 DB 의 한도 표는 비어 있다 (그대로면 한도 0 이라 만들 수 없음). 운영 결정으로 기본은 한도 없음.
// save/pills.json 의 limit 에 숫자를 넣으면 그 한도를 쓴다 (null 이나 없음 = 한도 없음)
class Pills {
  constructor() {
    this.file = path.join(ROOT, 'save', 'pills.json'); let d = {};
    try { d = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) {}
    this.limit = Number.isFinite(d.limit) ? d.limit : null; this.count = d.count | 0;
  }
  allowed() { return this.limit === null || this.limit > this.count; }
  save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify({ limit: this.limit, count: this.count })); } catch (e) {} }
  made() { this.count++; this.save(); }
  used() { if (this.count > 0) this.count--; this.save(); }
}

// 전체 게임: 맵은 누군가 처음 들어올 때 만든다
class Game {
  constructor() {
    this.mopInfo = readJson('data', 'mops.json') || {};
    this.story = new STORY.Story(this); this.subq = new SUBQ.SubQuest(this); this.ship = new SHIP.SpaceShip(this); this.pk = new PKM.PK(this); this.board = new BOARD.Board(this); this.accounts = new ACC.Accounts(this); this.pills = new Pills(); this.groups = new Groups(this); this.trades = new Trades(this); this.mail = new Mail(this); this.army = new Army(this);
    this.lang = 1;                                               // 서버 설정 rmServer.ini [Info] Lang=1 (+0x3664, 0x445e40)
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
    // 아이템가드 (이노큘레이터 12) 가 켜져 있으면 아이템·돈을 떨어뜨리지 않는다 (Dead 0x43b01b·0x43b124·0x43b244)
    const pct = INOC.on(p, 12) ? 0 : F.deathDropPct(p.level), w = p.world, roll = () => Math.floor(Math.random() * 100) < pct;
    if (pct > 0) {
      for (let s = p.inv.length - 1; s >= 0; s--) { const e = p.inv[s]; if (e.k !== 6 && roll()) { p.inv.splice(s, 1); w.dropItem(p, [e.k, e.i, e.n]); } }
      p.equip.forEach((e, s) => { if (e && e.k !== 6 && roll()) { p.equip[s] = null; w.dropItem(p, [e.k, e.i, 1]); } });
      (p.quick || []).forEach((e, s) => { if (e && e.k !== 6 && roll()) { p.quick[s] = null; w.dropItem(p, [e.k, e.i, e.n]); } });   // DropAllQuickItem 0x433490
      if (p.money > 0 && roll()) { w.dropItem(p, [5, 0, p.money]); p.money = 0; }
      if (p.tau > 0 && roll()) { w.dropItem(p, [5, 2, p.tau]); p.tau = 0; }   // DropSigMoney 0x433610
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
    // 장비 효과 (InitializeEquipmentEffect 0x4352d0, server/equip.js): 공격·방어·능력치, 고유 장비 식, 묶음 덤
    const isCmd = !!(this.army && this.army.db && Object.values(this.army.db.armies).some(a => a.commander === p.name && a.state > 0));   // CArmy::IsArmyCommander
    const eo = EQUIP.compute(p, (k, i) => this.itemInfo(k, i), { isCommander: isCmd, inoc: [INOC.on(p, 3), INOC.on(p, 10), INOC.on(p, 5), INOC.on(p, 4)] });
    let wAtk = eo.wAtk, armor = eo.def; const range = eo.range, add = eo.add;
    p.atkExtra = eo.x; p.skSpi = eo.s; p.skDmg = eo.k; p.mobDmgPct = eo.mobDmg; p.mobDefPct = eo.mobDef; p.pvpPct = eo.pvp; p.eqFlag36 = eo.flag36;
    // 장비를 뺀 능력치 (사용자 +0x4360~0x436c). 묶음 성장이 반영된 값에 효과가 더해진다:
    //   효과 69 Focused Spirit: 정신력 + ⌊(기본 정신력 − 10) ÷ 18⌋ × 23 + 10 − 기본 정신력 (rm3944 NewFocusEffect 0x10002b5c, +0x3f60 = DB 의 정신력)
    //   효과 75 Godly Shield: 기골 + 5000 (NewGshieldEffect 0x10002d36)
    const now = Date.now(), on = e => !!(p.fx && p.fx[e] > now);
    [p.bStr, p.bSpi, p.bDex, p.bPow] = eo.base;
    if (on(69)) p.bSpi = Math.max(0, p.bSpi + Math.floor((p.base.spi - 10) / 18) * 23 + 10 - p.base.spi);
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
  sendStat(p) { if (p.fx && p.fx[72] > Date.now()) p.sp = 0;
    const ft = fameTier(p.fame || 0); if (ft !== p.ftSent && p.world) { p.ftSent = ft; p.world.broadcast({ t: 'ftier', id: p.id, v: ft }); }   // 이름 색이 바뀜   // 효과 72 Diamond Skin: 기력은 늘 0 (rm3944 NewDskinEffect 0x10002cfc, SendSPInfo 0x439f13)
    if (p.group) this.groups.hpChanged(p); p.send({ t: 'stat', hp: p.hp, maxHp: p.maxHp, mp: p.mp, maxMp: p.maxMp, sp: p.sp, dp: p.dp, maxDp: p.maxDp, weight: this.weightOf(p), weightMax: F.weightMax(p.str), level: p.level, exp: p.exp, need: F.expTable[p.level], bonus: p.bonus + (p.bonus2 || 0) + (p.sbonus || 0), str: p.str, spi: p.spi, dex: p.dex, pow: p.pow, atk: p.atk, minPct: p.minPct, armor: p.armor, range: p.range, fame: p.fame, name: p.name, chr: p.chr, skills: SK.list(p), special: SK.SPECIAL[p.chr] }); }
  // ---------- 저장 ----------
  // 원작은 DB 서버에 저장한다. 여기서는 이름마다 파일 하나(save/이름.json)에 저장한다.
  saveFile(name) { return path.join(ROOT, 'save', encodeURIComponent(name) + '.json'); }
  save(p) {
    const d = { auth: p.auth, skills: p.skills, chr: p.chr, level: p.level, exp: p.exp, bonus: p.bonus, base: p.base, inv: p.inv, equip: p.equip, quick: p.quick || null, money: p.money, bank: p.bank, fame: p.fame,
      hp: p.hp, mp: p.mp, sp: p.sp, dp: p.dp, dead: p.dead, map: p.world.mapId, x: p.x, y: p.y, story: p.story || 0, qitems: p.qitems || null, mails: p.mails || [],
      bonus2: p.bonus2 || 0, sbonus: p.sbonus || 0, stotal: p.stotal || 0, tau: p.tau || 0, sigBank: p.sigBank || null, qsk: p.qsk || null, pkCount: p.pkCount || 0, pkPen: p.pkPen || 0, pkDecay: p.pkDecay || 0, legal: p.legal || null, inoc: Array.isArray(p.inoc) && p.inoc.some(v => v > 0) ? p.inoc : null, subq: p.subq && p.subq.state ? p.subq : null, hairColor: p.hairColor || 0, clothColor: p.clothColor || 0 };   // 원작 DB 칸 Bonus2·SBonus·STotalBonus·SubQuest*
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
    const p = { id: this.nextId++, name, auth, chr, dir: 2, goal: null, run: false, nextAt: 0, atkAt: 0, hitAt: 0, regenAt: 0, target: 0, pick: 0, talk: 0, sp: F.SP_MAX, steps: 0, spSent: 0, dead: false, exp: 0, inv: [], money: 0, send,
      level: CFG.startLevel, bonus: F.bonusTotal(CFG.startLevel), hp: 0, fame: 0, equip: new Array(EQUIP_SLOTS).fill(null), bank: { money: 0, items: [] },
      base: { str: F.BASE_STAT, spi: F.BASE_STAT, dex: F.BASE_STAT, pow: F.BASE_STAT } };
    let d = null; try { if (fs.existsSync(this.saveFile(name))) d = JSON.parse(fs.readFileSync(this.saveFile(name), 'utf8')); } catch (e) { console.log('저장 파일 읽기 실패', name, e.message); }
    if (d) {
      for (const k of ['chr', 'level', 'exp', 'bonus', 'base', 'inv', 'money', 'fame', 'bonus2', 'sbonus', 'stotal', 'tau', 'qsk', 'pkCount', 'pkPen', 'pkDecay', 'legal', 'inoc', 'hairColor', 'clothColor']) if (d[k] !== undefined && d[k] !== null) p[k] = d[k];
      if (d.sigBank) p.sigBank = d.sigBank;
      if (d.subq && d.subq.state) p.subq = d.subq;
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
    const items = d.list.map(e => { const f = this.itemInfo(e.k, e.i); return { id: e.id, k: e.k, i: e.i, n: e.n, price: e.price, seller: e.seller, buyer: e.buyer || '', name: f ? f.name : '?', desc: f ? f.desc || '' : '', icon: f ? f.icon : 0, weight: f ? f.weight || 0 : 0 }; });
    p.send({ t: 'exch', name: p.exchAt.name, items, owed, mine: d.list.filter(e => e.seller === p.name).length });
  }
  exchTell(p, text) { p.send({ t: 'chat', id: 0, name: '거래소', text }); }
  // 사는 사람 이름을 적으면 그 사람만 살 수 있다 (tblExchange 의 Buyer 칸, ProcessExchangeBuyItem 0x40f7bd: 비어 있지 않고 내 이름과 다르면 0x61)
  exchSell(p, slot, n, price, buyer) {
    const d = this.exchOk(p), it = p.inv[slot]; n = Math.floor(Number(n)); price = Math.floor(Number(price));
    if (!d || !it || !(n >= 1) || n > it.n) return;
    if (!(price >= 1) || price > Math.floor(F.MONEY_MAX / n)) { this.exchTell(p, '값이 올바르지 않습니다.'); return; }
    if (d.list.filter(e => e.seller === p.name).length >= 5) { this.exchTell(p, '다섯 건까지만 올릴 수 있습니다.'); return; }
    it.n -= n; if (it.n <= 0) p.inv.splice(slot, 1);
    d.list.push({ id: d.seq++, seller: p.name, k: it.k, i: it.i, n, price, buyer: String(buyer || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 16) });
    this.exchSave(); this.save(p); this.sendInv(p); this.sendStat(p); this.sendExch(p);
  }
  exchBuy(p, id, n) {
    const d = this.exchOk(p); n = Math.floor(Number(n)); if (!d || !(n >= 1)) return;
    const e = d.list.find(q => q.id === id); if (!e) { this.exchTell(p, '이미 팔린 물건입니다.'); this.sendExch(p); return; }
    if (e.seller.toLowerCase() === p.name.toLowerCase()) { this.exchTell(p, '자기가 올린 물건은 살 수 없습니다.'); return; }
    if (e.buyer && e.buyer.toLowerCase() !== p.name.toLowerCase()) { p.send({ t: 'sys', code: 0x61, args: [] }); return; }
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
  // 시그너스에서는 시그너스 은행 (DB 의 은행 칸 종류 1)
  bankOf(p) { return isSignus(p.world.mapId) ? (p.sigBank ||= { money: 0, items: [] }) : p.bank; }
  openBank(p, npc) { p.bankNpc = npc.id; this.sendBank(p, npc.name); }
  sendBank(p, name) {
    const view = e => { const f = this.itemInfo(e.k, e.i); return { k: e.k, i: e.i, n: e.n || 1, name: f ? f.name : '?', desc: f ? f.desc || '' : '', icon: f ? f.icon : 0 }; };
    const B = this.bankOf(p); p.send({ t: 'bank', name, money: B.money, tau: cur(p) === 'tau' ? 1 : 0, items: B.items.map(view) });
  }
  bankOk(p) {
    if (!p.bankNpc || p.dead) return false;
    const n = p.world.npcs.find(q => q.id === p.bankNpc);
    if (!n || G.dist(p, n) >= 25) { p.bankNpc = 0; p.send({ t: 'bankclose' }); return false; }
    return true;
  }
  bankMoney(p, n, put) {
    n = Math.floor(Number(n)); if (!this.bankOk(p) || !(n >= 1)) return;
    const B = this.bankOf(p), c = cur(p), have = p[c] || 0;
    if (put) { n = Math.min(n, F.MONEY_MAX - B.money); if (n < 1 || n > have) return; p[c] = have - n; B.money += n; }
    else { if (n > B.money) return; n = Math.min(n, F.MONEY_MAX - have); if (n < 1) return; B.money -= n; p[c] = have + n; }
    this.sendInv(p); this.sendBank(p); this.save(p);
  }
  bankPut(p, slot, n) {
    const it = p.inv[slot]; n = Math.floor(Number(n)); if (!this.bankOk(p) || !it || !(n >= 1)) return;
    n = Math.min(n, it.n);
    const B = this.bankOf(p);
    let b = B.items.find(q => q.k === it.k && q.i === it.i);
    if (!b) { if (B.items.length >= BANK_SLOTS) return; b = { k: it.k, i: it.i, n: 0 }; B.items.push(b); }   // 빈 칸이 없으면 아무 일 없음 (ProcessAddBankItem 0x41ddc0)
    b.n += n; it.n -= n; if (it.n <= 0) p.inv.splice(slot, 1);
    this.sendInv(p); this.sendStat(p); this.sendBank(p); this.save(p);
  }
  bankGet(p, slot, n) {
    const B = this.bankOf(p), b = B.items[slot]; n = Math.floor(Number(n)); if (!this.bankOk(p) || !b || !(n >= 1)) return;
    const took = this.giveItem(p, b.k, b.i, Math.min(n, b.n)); if (!took) return;
    b.n -= took; if (b.n <= 0) B.items.splice(slot, 1);
    this.sendBank(p); this.save(p);
  }
  // 공격 간격: 공격 동작(동작 번호 2) 한 번이 끝나는 시간. 동작표 한 칸이 화면 한 장(50ms)이다 (Main.dll 0x10039480, Staff.dll CtPump::Get)
  attackMs(p) {
    this.atkLen ||= {};
    if (!(p.chr in this.atkLen)) { const j = readJson('assets', 'chr', p.chr + '.json'); this.atkLen[p.chr] = (j && j.anims[2]) || {}; }
    const seq = this.atkLen[p.chr][p.dir] || this.atkLen[p.chr][2];
    return (seq ? seq.length : 16) * FRAME_MS;
  }
  // 특수 아이템 (ProcessUseItem 0x430f73~0x43106c)
  //  6/66 전설의 단약: Bonus2 +4, STotalBonus +4 (RMS_USEMYSTERYPILL)
  //  6/74 인공 단약: STotalBonus < 200 이면 Bonus2 +2, STotalBonus +2. 아이템은 어느 쪽이든 없어진다 (RMS_USEARTIFICIALMYSTERYPILL)
  //  6/67 극약: 능력치 초기화 (InitBonusPoint 0x428e10) 뒤 "+Poison+" 에게 죽는다 (Dead 0x43ac60)
  useSpecialItem(p, slot, e) {
    if (--e.n <= 0) p.inv.splice(slot, 1);
    if (e.i === 66) { p.bonus2 = (p.bonus2 || 0) + 4; p.stotal = (p.stotal || 0) + 4; this.pills.used(); }
    else if (e.i === 74) { if ((p.stotal || 0) < 200) { p.bonus2 = (p.bonus2 || 0) + 2; p.stotal = (p.stotal || 0) + 2; } }
    else if (e.i === 67) { this.initBonusPoint(p); this.sendInv(p); p.hp = 0; p.world.killPlayer(p); return; }
    this.sendInv(p); this.sendStat(p);
  }
  // InitBonusPoint 0x428e10: 순수 능력치를 모두 10 으로, 보통 점수 = 레벨/100 + 레벨×2, Bonus2 = STotalBonus − SBonus (RMS_INITBONUS2)
  initBonusPoint(p) {
    if (STATS.some(k => p.base[k] < 10)) return;
    for (const k of STATS) p.base[k] = 10;
    p.bonus = F.bonusTotal(p.level);
    p.bonus2 = (p.stotal || 0) >= (p.sbonus || 0) ? (p.stotal || 0) - (p.sbonus || 0) : 0;
    this.recalc(p, false); this.sendStat(p);
  }
  // TryMakeMysteryPill (대본 행동, DoEventServerAction): 단약 점수 1 을 써서 30% (RAND()%100 >= 70) 로 전설의 단약.
  //  서버 전체의 전설의 단약 수가 한도(tblSpecialItemLimit1)보다 적어야 한다. 넣을 칸이 없으면 아무 일도 없다
  tryMakeMysteryPill(p) {
    const st = p.inv.find(x => x.k === 6 && x.i === 66);
    if (!st && p.inv.length >= F.INV_SLOTS) return;
    let made = false;
    if ((p.sbonus || 0) >= 1 && (p.stotal || 0) >= 1) {
      p.sbonus--; p.stotal--;
      if (this.pills.allowed() && Math.floor(Math.random() * 100) >= 70) made = this.giveItem(p, 6, 66, 1) > 0;
      if (made) this.pills.made();
    }
    this.sendStat(p);
    p.world.script.named(p, made ? 'MakeMysteryPillSuccess' : 'MakeMysteryPillFail');
  }
  // 능력치 점수 1점 사용: 직업별 증가량만큼 오른다
  useBonus(p, stat) {
    // 보통 점수 → 레벨 1000 점수(Bonus2) → 단약 점수(SBonus) 순으로 쓴다 (ProcessUseBonus 0x438800). SendBonusInfo 는 셋의 합을 보낸다
    const i = STATS.indexOf(stat); if (i < 0 || p.dead) return;
    if (p.bonus > 0) p.bonus--; else if (p.bonus2 > 0) p.bonus2--; else if (p.sbonus > 0) p.sbonus--; else return;
    p.base[stat] += F.classGain[p.chr][i];
    this.recalc(p, false); this.sendStat(p); p.world.near(p, { t: 'hp', id: p.id, hp: p.hp, maxHp: p.maxHp });
  }
  // 한 마리로 얻는 경험치는 필요 경험치의 1/10까지. 레벨이 오르면 경험치는 0부터 다시 시작한다
  // 경험치 얻기 (DoExperimentUp 0x438e70): 한 번에 필요 경험치의 1/10 까지, 남은 만큼까지. 실제로 얻은 양을 돌려준다
  //  div: 한 번에 얻는 한계 = 필요 경험치 / div (몬스터 10, 보조 퀘스트 보상 1)
  gainExp(p, exp, div = F.EXP_CAP_DIV) {
    const need = F.expTable[Math.min(p.level, F.MAX_LEVEL)];
    let gain = Math.min(exp, Math.max(1, Math.floor(need / div)));
    if (p.exp < need) gain = Math.min(gain, need - p.exp);
    p.exp += gain; p.send({ t: 'exp', gain });
    if (p.exp >= need && p.level >= F.MAX_LEVEL) {
      // 레벨 1000: 경험치를 0 으로 하고 단약 점수 +2 (RMS_INCREASEBONUSQUESTCOUNT: SBonus·STotalBonus +2) (DoExperimentUp 0x4390xx)
      p.exp = 0; p.sbonus = (p.sbonus || 0) + 2; p.stotal = (p.stotal || 0) + 2;
      p.world.broadcast({ t: 'lvl', id: p.id, level: p.level, hp: p.hp, maxHp: p.maxHp });
    } else if (p.exp >= need) {
      p.level++; p.exp = 0; p.bonus += F.bonusForLevelUp(p.level); this.recalc(p, true);
      p.world.broadcast({ t: 'lvl', id: p.id, level: p.level, hp: p.hp, maxHp: p.maxHp });
      if (p.level === F.MAX_LEVEL) { this.story.mail(p, 'RMS_LEVEL1000MAIL'); }   // 레벨 1000 우편 "Legendary Medicine" + 0/2/0x74
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
    //  남은 무게가 한 개 무게보다 작으면 0xc, 모자라면 들 수 있는 만큼으로 줄인다 (0x4298dd~0x42990d)
    if (f.weight > 0) {
      const rem = F.weightMax(p.str) - this.weightOf(p);
      if (rem < f.weight) { this.story.msg(p, 0xc); return; }
      if (rem < f.weight * n) n = Math.floor(rem / f.weight);
    }
    const st = p.inv.find(x => x.k === e[0] && x.i === e[1]);
    if (!st && p.inv.length >= F.INV_SLOTS) return;              // 넣을 칸이 없으면 아무 일 없음 (0x42994f)
    const c = cur(p), have = p[c] || 0;
    if (Math.floor(have / price) < n) { this.story.msg(p, c === 'tau' ? 0x170 : 0xb); return; }   // 돈 ÷ 값 < 개수 (0x429972)
    if (st && st.n >= 4000000000) { this.story.msg(p, 0xd); return; }                              // 이미 40억 개 (0x429a17)
    const took = this.giveItem(p, e[0], e[1], n); if (!took) { this.story.msg(p, 0xc); return; }
    p[c] = (p[c] || 0) - price * took; if (e[2] <= 4000000000) e[2] -= took;
    this.sendInv(p);
    p.world.script.bought(p, e[0], e[1], took);
  }
  // 팔기: 그 상점이 사 주는 목록에 있는 아이템만 판다 (ProcessUserSellItem 0x42a540)
  sell(p, slot, n) {
    const shop = this.shopOf(p), it = p.inv[slot]; n = Math.floor(Number(n));
    if (!shop || !it || !(n >= 1)) return;
    const e = shop.find(q => q[0] === it.k && q[1] === it.i && (q[4] & 2));
    if (!e) return;                                              // 사 주지 않는 물건이면 아무 일 없음
    n = Math.min(n, it.n);
    const gain = Math.floor(this.shopPrice(e) / this.sellDiv(p.shop.id)) * n;
    const c = cur(p);
    if ((p[c] || 0) + gain > F.MONEY_MAX) { this.story.msg(p, c === 'tau' ? 0x171 : 0xe); return; }   // 40억을 넘으면 0xe (0x42aa05)
    it.n -= n; if (it.n <= 0) p.inv.splice(slot, 1);
    p[c] = (p[c] || 0) + gain; this.sendInv(p); this.sendStat(p);
  }
  // ---------- 아이템 ----------
  // 빠른 창 기술 칸 (ProcessRegisterSkill 0x42b240): 1 = 보통 기술 → +0x4020, 2 = 특수 기술 → +0x4022. SendSetUserSkill(3, 칸, 기술)
  registerSkill(p, kind, id) {
    const ok = kind === 1 ? SK.list(p).includes(id) && id !== SK.SPECIAL[p.chr] : kind === 2 ? id === SK.SPECIAL[p.chr] : false;
    if (!ok) return;
    (p.qsk ||= [0, 0])[kind - 1] = id; p.send({ t: 'qskill', slot: kind - 1, id });
  }
  // 접속할 때 (SendQuickSkillInfo 0x43a2f0). 더 쓸 수 없는 기술은 비운다 (InitializeQuickSkill 0x434ef0 의 요건 검사)
  sendQuickSkill(p) {
    const q = p.qsk ||= [0, 0], list = SK.list(p);
    if (q[0] && !list.includes(q[0])) q[0] = 0;
    if (q[1] && q[1] !== SK.SPECIAL[p.chr]) q[1] = 0;
    for (let k = 0; k < 2; k++) if (q[k]) p.send({ t: 'qskill', slot: k, id: q[k] });
  }
  storyWindowOpen(p) { return this.story.windowOpen(p); }
  // 분류 5의 0번은 돈이다. 원작에 화폐 단위 이름은 없고 그냥 '돈'이다 (DB 칸 Money). 시그너스에서 쓰는 돈은 따로 있다 (DB 칸 SigMoney, 아직 없음)
  itemInfo(k, i) { return k === 5 && i === 0 ? { name: '돈', icon: 0, money: true } : k === 5 && i === 2 ? { name: 'Tau', icon: 0, tau: true } : (this.items[k] && this.items[k][i]) || null; }
  sendInv(p) {
    const view = e => { const f = this.itemInfo(e.k, e.i); return { k: e.k, i: e.i, n: e.n || 1, name: f.name, desc: f.desc || '', icon: f.icon, hp: f.hp || 0, mp: f.mp || 0, atk: f.atk || 0, def: f.def || 0, v: f.v || [], req: f.req || 0, reqStat: f.reqStat || [], cls: f.cls || 0, weight: f.weight || 0, wear: f.type !== undefined && f.type !== 14 ? 1 : 0 }; };
    p.send({ t: 'inv', money: p.money, tau: p.tau || 0, items: p.inv.map(view), quick: (p.quick || []).map(e => e ? view(e) : null), equip: p.equip.map((e, s) => e ? { ...view(e), slot: SLOT_NAMES[s] } : null) });
  }
  // 넣을 수 있는 만큼만 넣고 넣은 개수를 돌려준다. 같은 아이템은 종류에 상관없이 한 칸에 겹쳐 쌓인다 (GetAvailableItemIndex 0x431b4b)
  giveItem(p, k, i, n) {
    const f = this.itemInfo(k, i); if (!f) return 0;
    let take = n;
    if (f.money) { take = Math.min(n, F.MONEY_MAX - p.money); p.money += take; }
    else if (f.tau) { take = Math.min(n, F.MONEY_MAX - (p.tau || 0)); p.tau = (p.tau || 0) + take; }   // AddItem 0x431d07: 5/2 는 Tau, 40억까지
    else {
      if (f.weight > 0) take = Math.min(take, Math.floor((F.weightMax(p.str) - this.weightOf(p)) / f.weight));
      const st = p.inv.find(e => e.k === k && e.i === i);
      if (!st && p.inv.length >= F.INV_SLOTS) take = 0;
      if (take <= 0) return 0;                                   // 못 넣으면 0 (AddItem). 알림은 부른 쪽이 정한다
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
    const f = this.itemInfo(e.k, e.i); if (!f) return;
    if (!this.itemReqOk(p, e, f)) return;
    if (f.type !== 14) { this.equipItem(p, slot, f); return; }     // 종류가 14 가 아니면 착용 (0x4302f0)
    if (e.k === 6 && (e.i === 66 || e.i === 74 || e.i === 67)) { this.useSpecialItem(p, slot, e); return; }
    if (INOC.itemOf(e.k, e.i)) { this.useInoc(p, slot, e, f); return; }
    // 쓰는 아이템 (종류 14). ProcessUseItem 0x430340~ 의 갈래 순서를 따른다
    const w = p.world, now = Date.now(), take = () => { if (--e.n <= 0) p.inv.splice(slot, 1); this.sendInv(p); };
    const { k, i } = e;
    if (k === 4 && i === 45) { take(); w.userEffect(p, 38, 300, now); this.story.msg(p, 0xa3); return; }     // 효과 38 300초 (0x430511, DoSkillEffect 0x42c2c0 이 0xa3)
    if (k === 5 && i > 30 && i < 61) { take(); p.clothColor = i - 31; w.near(p, { t: 'look', id: p.id, hair: p.hairColor || 0, cloth: p.clothColor }); return; }   // 옷 염색 +0x4155 (0x4303d0)
    if (k === 5 && i > 60 && i < 91) { take(); p.hairColor = i - 61; w.near(p, { t: 'look', id: p.id, hair: p.hairColor, cloth: p.clothColor || 0 }); return; }  // 머리 염색 +0x4154
    if (k === 5 && i === 91) { take(); p.hairColor = p.clothColor = 30; w.near(p, { t: 'look', id: p.id, hair: 30, cloth: 30 }); return; }   // 원색약: 둘 다 30
    if (k === 5 && i > 142 && i < 148) { take(); this.giveItem(p, 5, 0, (i - 142) * 1000000); return; }     // 돈 100만~500만 (0x430460)
    if (k === 4 && i === 37) { take(); w.userEffect(p, 1, 30, now); p.fx1Val = 1000; return; }               // 효과 1 30초, 값 1000 (0x430723)
    if (k === 4 && i === 38) { take(); for (const x of [5, 14, 12, 18]) w.fxOff(p, x); return; }             // 0x43076a
    if (k === 4 && i === 40) { take(); return; }                                                             // 0x4307e0
    if (k === 4 && i === 41) { take(); w.fxOff(p, 16); return; }                                             // 0x430800
    if (k === 6 && i === 41) {                                                                               // 귀환: 이 맵들에서만, 맵의 기본 자리로 (0x430e00)
      if (![0x48, 0x4c, 0x4d, 0x53, 0x54, 0x55, 0x56, 0xb1, 0xb2, 0xb3].includes(w.mapId)) { this.story.msg(p, 0x91); return; }
      const d = DEFAULT_POS[w.mapId]; take(); if (d) this.gotoMap(p, w.mapId, d[0], d[1]); return;
    }
    if (k === 6 && i === 45) { take(); this.gotoMap(p, hospitalMap(p, w.mapId), 8, 14); return; }           // 병원으로 (8,14,1) (0x430f00)
    if (k === 6 && i === 68) { take(); p.fame = p.fame > 0 ? Math.max(0, p.fame - 100) : Math.min(0, p.fame + 100); this.sendStat(p); return; }   // DecreaseAbsFame 100
    if (k === 6 && i === 195) { take(); this.story.msg(p, 0x183); return; }
    if (k === 4 || (k === 5 && i >= 22 && i <= 25)) { take(); this.applyItemEffect(p, f); return; }       // 일반 (CMapServerClient::UseItem 0x432f60)
  }
  // CMapServerClient::UseItem 0x432f60: 체력이 0 이 아니면 체력, 그다음 마력. 19억 이상은 초과분 %, 최대값까지
  applyItemEffect(p, f) {
    const pctOf = (v, max) => max < 10000001 ? Math.floor((v - PERCENT_HEAL) * max / 100) : (v - PERCENT_HEAL) * Math.floor(max / 100);
    if (f.hp && p.hp > 0) p.hp = f.hp < PERCENT_HEAL ? Math.min(p.maxHp, p.hp + f.hp) : p.hp + Math.min(pctOf(f.hp, p.maxHp), p.maxHp - p.hp);
    if (f.mp) p.mp = f.mp < PERCENT_HEAL ? Math.min(p.maxMp, p.mp + f.mp) : Math.min(p.maxMp, p.mp + Math.min(pctOf(f.mp, p.maxMp), p.maxMp - p.mp));
    this.sendStat(p); p.world.near(p, { t: 'hp', id: p.id, hp: p.hp });
  }
  // 이노큘레이터·아이템가드 쓰기 (UseItem 0x4308c3~, 0x42d5f0). 아이템을 하나 없애고 남은 시간을 더한다
  useInoc(p, slot, e, f) {
    const r = INOC.use(p, e.k, e.i);
    if (!r) { this.story.msg(p, 0x184); return; }
    if (--e.n <= 0) p.inv.splice(slot, 1);
    this.inocChanged(p, [INOC.itemOf(e.k, e.i)[0]]); this.sendInv(p);
  }
  // 상태가 바뀌면: 능력치에 닿는 종류(0·3·4·5·10)는 다시 셈하고, 상태를 보낸다 (패킷 0xf9, 0x43a0f0)
  inocChanged(p, types) {
    if (types.some(t => [0, 3, 4, 5, 10].includes(t))) { this.recalc(p, false); this.sendStat(p); }
    p.send({ t: 'inoc', s: INOC.states(p), ms: p.inoc });
  }
  // 착용: 부위 번호가 곧 칸 번호이고, 반지는 9~13번 칸 중 빈 곳에 낀다
  // 착용 조건: 레벨, 순수 능력치 네 가지, 명성, 직업 (CheckEquipment 0x43439b~0x434528)
  // 쓰기·착용 조건 (ProcessUseItem 0x42fd80, 0x430200~0x4302f0). 안 되면 메시지를 보내고 false
  //  레벨 < 필요 레벨 → 6. 성장 아이템(분류 6 의 100~194)은 성장 등급마다 필요 레벨 (700·800·850·900·920·930·940·960·980·1000) → 0x1ac(레벨)
  //  기본 근력·정신력·민첩성·기골 < 필요 → 0x13·0x14·0x15·0x16. 필요 명성이 0 이 아니고 명성이 작으면 → 7. 직업 9 가 아니고 직업 표에 없으면 → 8
  itemReqOk(p, e, f) {
    const msg = (c, ...a) => { this.story.msg(p, c, ...a); return false; };
    if (p.level < (f.req || 0)) return msg(6);
    if (e.k === 6 && e.i > 99 && e.i < 195) {
      const g = e.grade || 0, need = g < 10 ? 700 : g < 20 ? 800 : g < 30 ? 850 : g < 40 ? 900 : g < 50 ? 920 : g < 60 ? 930 : g < 70 ? 940 : g < 80 ? 960 : g < 90 ? 980 : 1000;
      if (p.level < need) return msg(0x1ac, need);
    }
    for (let q = 0; q < 4; q++) if ((f.reqStat || [])[q] > p.base[STATS[q]]) return msg(0x13 + q);
    if (f.fame && p.fame < f.fame) return msg(7);
    if (p.chr !== 9 && f.cls && !(f.cls & (1 << p.chr))) return msg(8);
    return true;
  }
  equipItem(p, invSlot, f) {
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
