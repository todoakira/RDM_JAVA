'use strict';
// 보조 퀘스트 (원작 서버 svMapServer.exe). 자세한 근거는 docs/subquest_notes.md
//  - 시작: 은행·병원·교환소·고고학자·상점류 NPC 를 누르면, 그 NPC 가 5분 동안 보조 퀘스트를 걸지 않았고
//    rand()%100 == 99 이며 진행 중인 보조 퀘스트·이야기 퀘스트 창이 없고 SelectRandomNPC 가 되면
//    그 NPC 의 이름·그림·맵을 기억하고 "<X>SubQuest" 대본을 돌린다 (ProcessEvent 0x41ee70)
//  - 대본(이벤트 24~38)이 BeginRandEvent 36 37 38 로 셋 중 하나를 고르고, 특수 대사 번호로 목표를 정하고, BeginSubQuest1·2·3 로 시작한다
//  - 1: 노란 이름 몬스터 잡기, 2: 몬스터가 가져간 물건 찾기, 3: 물건 전하기. 30분 안에 마치고 맡긴 NPC 에게 돌아가면 보상
const fs = require('fs');
const path = require('path');
const read = (...p) => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8')); } catch { return null; } };
const INI = read('data', 'subquest.json') || { MonsterMap: {}, SubQuest3MapLink: {}, NPC: {} };   // Bin/Config/SubQuest.ini
const MSG = read('assets', 'messages.json') || {};
const F = require('./formulas');

const TIME_MS = 1800000;                 // BeginSubQuest*: +0x41f8 = 1,800,000
const NPC_COOLDOWN_MS = 300000;          // 같은 NPC 이벤트는 5분에 한 번 (이벤트 칸 [4] 에 시각)
const LANG = 1;                          // rmServer.ini Lang=1 → GetRandomIIS 의 돈은 1/100 (0x485390~)

// NPC 이벤트 종류 → 대본 조건 이름 (ProcessEvent 의 DoProperEvent 문자열)
const KINDS = { 6: 'BankSubQuest', 8: 'DoctorSubQuest', 20: 'ExchangeSubQuest', 27: 'GogoSubQuest', 31: 'VendorSubQuest',
  32: 'OldWomanSubQuest', 33: 'SmallStoreOwnerSubQuest', 34: 'RunAwayGirlSubQuest', 35: 'ScientistSubQuest', 36: 'WatchmanSubQuest', 37: 'GeographerSubQuest' };

// CrItemInfo::GetRandomIIS 0x484eb0 의 표 (분류 1·2·4 에서 고르는 번호)
const RII = {
  1: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 24, 33, 34, 35, 36, 37, 38, 39, 40, 41, 52, 53, 54, 73, 81, 82, 83, 84, 13, 14, 15, 16, 17, 18, 42, 55, 64, 65, 66, 67, 74, 85, 86, 87, 88, 56, 57, 58, 43, 44, 45, 19, 20, 21, 59, 60, 61, 46, 47, 48, 49, 50, 89, 90, 91, 75, 76, 77, 78, 79, 80, 104, 105, 106],
  2: [1, 2, 3, 4, 12, 17, 18, 24, 25, 26, 27, 37, 38, 39, 51, 52, 61, 62, 73, 74, 83, 84, 85, 86, 5, 13, 40, 41, 28, 53, 63, 87, 88, 95],
  4: [1, 2, 3, 4, 5, 6, 7, 8, 21, 22, 23, 24, 25, 26, 27, 28, 34, 35, 36],
};
// SelectRandomMonster 0x428880: 몬스터 그림 번호와 그 기준 레벨
const MON_IMG = [0x38, 0x32, 0x39, 0x33, 0x34, 0x35, 0x36, 0x3a, 0x37, 0x3b, 0x3c, 0x40, 0x3d, 0x3e, 0x41, 0x3f, 0x44, 0x46, 0x48, 0x47];
const MON_LV = [1, 10, 20, 40, 80, 120, 160, 200, 250, 300, 320, 360, 400, 440, 480, 520, 540, 560, 580, 600];
// SelectQuestMap 0x428240: 레벨 51~300 에서 SubQuest3MapLink 를 쓰는 맵
const MID_MAPS = [3, 6, 0xc, 0x23, 7, 0xd, 0xf, 0x10, 0x12, 0x25, 0x11, 0x27, 0x28, 8, 0xe, 0x13, 0x14, 0x26, 0x46];
// 클라이언트 Main.dll 0x10032d20: 그림 번호 → Message 0/5 의 이름 번호 (없는 것은 빈 이름)
const IMG_NAME = [0, 1, 2, 3, 4, 5, 6, 7, 8, 0x41, 9, 0xa, 0xb, 0xc, 0xd, 0xe, 0xf, 0x10, 0x11, 0x12, 0x13, 0x14, 0x22, 0x23, 0x24, 0x25, 0x26, 0x3c, 0x3d, 0x3e, 0x3f, 0x14, 0xc, 0x47, 0x46,
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x21, 0x27, 0x28, 0x29, -1, -1,
  0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b, 0x40, -1, -1, -1, 0x42, 0x44, 0x43, 0x45, 0x48, 0x49, 0x49, 0x4a, 0x4b, -1, -1, -1, -1, -1];

const msg = (g, c) => String((MSG[0] && MSG[0][g] && MSG[0][g][c]) || '').replace(/\\n/g, '\n');
const imgName = img => { const k = IMG_NAME[img]; return k === undefined || k < 0 ? '' : msg(5, k); };
const mapName = m => msg(6, m);
const fmt = (t, args) => { let k = 0; return t.replace(/%(\d*)[usd]/g, () => String(args[k] !== undefined ? args[k++] : '')); };
const rnd = n => Math.floor(Math.random() * n);
const pick = list => (list && list.length ? list[rnd(list.length)] : -1);

// GetRandomIIS(-1, …): GetTickCount()&3 로 분류 1·2·돈·4 중 하나
function randomIIS(now = Date.now()) {
  const kind = [1, 2, 100, 4][now & 3];
  if (kind === 100) {
    let n = Math.min(1000000, Math.max(100000, (now % 10 + 1) * 100000));
    if (LANG === 1) n = Math.floor(n / 100);
    return { k: 5, i: 0, n };
  }
  const t = RII[kind]; return { k: kind, i: t[now % t.length], n: 1 };
}
// SelectRandomMap 0x4283c0: SubQuest3MapLink[지금 맵]
const randomLinkedMap = m => pick(INI.SubQuest3MapLink[m]);
// SelectQuestMap 0x428240: 레벨과 지금 맵으로 목표 맵
function questMap(p) {
  const L = p.level, m = p.world.mapId;
  if (L <= 50) return randomLinkedMap(m);
  if (L <= 100) return (m === 2 || m === 0) ? randomLinkedMap(m) : 0;
  if (L <= 300) return MID_MAPS.includes(m) ? randomLinkedMap(m) : 0x26;
  return (m === 0x47 || m === 0x4b) ? 0x49 : 0x4b;
}
// SelectRandomNPC 0x4281c0: 목표 맵과 그 맵의 NPC 그림 ([NPC])
function randomNpc(p) {
  const map = questMap(p); if (map < 0) return null;
  const img = pick(INI.NPC[map]); if (img < 0) return null;
  return { map, img };
}
// SelectRandomMonster 0x428880. 원작 그대로: 위쪽 경계가 두 번째 칸에서 0 으로 정해져 버려서
// 레벨 51~650 에서는 아래 경계(> 0)가 위쪽보다 커져 실패한다. 레벨 1~51 은 첫 몬스터, 651 이상은 마지막 몬스터
function randomMonster(L) {
  if (L + 50 < 1) return MON_IMG[0];
  if (L > 650) return MON_IMG[19];
  let lo = -1, hi = -1;
  for (let i = 0; i < 20; i++) {
    if (lo === -1) { if (MON_LV[i] + 50 >= L) lo = i; }
    else if (hi !== -1) break;
    if (hi === -1 && MON_LV[i] < L + 50) hi = i - 1;
  }
  if (lo === -1) return MON_IMG[19];
  if (hi === -1) hi = 19;
  if (lo > hi) return -1;
  return MON_IMG[lo === hi ? lo : rnd(hi - lo) + lo];
}
// SelectQuestMonster 0x428800: 몬스터와 그 몬스터가 사는 맵 ([MonsterMap])
function questMonster(p) {
  const mon = randomMonster(p.level); if (mon < 0) return null;
  const map = pick(INI.MonsterMap[mon]); if (map < 0) return null;
  return { map, mon };
}
// 보상 (GetSubQuestGiftExperience 0x40fe60, GetSubQuestGiftFame 0x40fec0, GetSubQuestGiftItem 0x40fee0)
function gift(p, now = Date.now()) {
  const L = p.level;
  let exp = Math.floor((F.expTable[Math.min(L, 1000)] || 0) / (now % 101 + 100));
  if (L > 899) exp = exp >>> 3;
  const fame = now % 1000 === 0 ? 10 : 0;
  const it = randomIIS(now);
  it.n = it.k === 5 && it.i === 0 ? L * (now % 991 + 10) : 1;
  return { exp, fame, item: it };
}

class SubQuest {
  constructor(game) { this.game = game; }
  sq(p) { return p.subq ||= { state: 0, done: 0, giver: null, tmap: -1, timg: -1, item: null, left: 0, gift: null, resume: 0 }; }
  itemName(it) { const f = it && this.game.itemInfo(it.k, it.i); return f ? f.name : ''; }

  // NPC 를 눌렀을 때 맨 먼저: 맡긴 NPC 에게 돌아왔는지, 전할 NPC 인지 (ProcessEvent 0x41ee70 앞부분). 그 뒤에도 NPC 의 원래 일은 이어진다
  onNpc(p, n) {
    const s = this.sq(p); if (!s.state || !s.giver) return;
    const w = p.world, g = s.giver, atGiver = w.mapId === g.map && n.img === g.img && n.name === g.name;
    const say = c => p.send({ t: 'chat', id: n.id, name: n.name, text: msg(7, c), npc: 1 });
    if (!s.done) {
      if (atGiver) { say([0, 0xa5, 0xa6, 0xa7][s.state]); this.game.story.sendInfo(p, true); return; }
      if (s.state === 3 && w.mapId === s.tmap && n.img === s.timg) {
        if (this.game.story.removeQItem(p, s.item.k, s.item.i, s.item.n)) { s.done = 1; say(0xf3); }
        else { this.clear(p); this.game.story.sendInfo(p, false); }
      }
      return;
    }
    if (!atGiver) return;
    const state = s.state, item = s.item;
    s.state = 0;
    this.giveGift(p);
    if (state === 1) { say(0xa9); this.game.story.sendInfo(p, true); say(0xaa); }
    else if (state === 2) { say(0xab); if (item) this.game.story.removeQItem(p, item.k, item.i, item.n); say(0xac); }
    else { say(0xad); this.game.story.sendInfo(p, true); }
    this.clear(p);
  }
  // ProcessSubQuestGift 0x422090: 경험치(필요 경험치 전부까지, 나눔 1), 명성, 아이템(못 들면 발밑에)
  giveGift(p) {
    const s = this.sq(p), G = s.gift || { exp: 0, fame: 0, item: null }, st = this.game.story;
    if (G.exp) { this.game.gainExp(p, G.exp, 1); st.msg(p, 0x7d, G.exp); }
    if (G.fame) { const got = st.increaseAbsFame(p, G.fame); if (got) st.msg(p, 0x7c, got); }
    const it = G.item;
    if (it && it.k && it.n) {
      const took = this.game.giveItem(p, it.k, it.i, it.n);
      if (took < it.n) p.world.dropItem(p, [it.k, it.i, it.n - took]);
      st.msg(p, 0x7f, this.itemName(it), it.n);
    }
    s.gift = null;
  }
  clear(p) { const s = this.sq(p); Object.assign(s, { state: 0, done: 0, giver: null, tmap: -1, timg: -1, item: null, left: 0, gift: null }); }

  // 보조 퀘스트를 걸 수 있으면 걸고 true (ProcessEvent 의 종류별 분기)
  tryStart(p, n, kind, now = Date.now()) {
    const name = KINDS[kind]; if (!name || !n.name) return false;
    const s = this.sq(p);
    if (n.subqAt && now >= n.subqAt && now - n.subqAt < NPC_COOLDOWN_MS) return false;
    if (rnd(100) !== 99) return false;
    if (s.state || p.pkPen > 0 || this.game.storyWindowOpen(p) || !randomNpc(p)) return false;   // PK 벌칙(+0x4158) 중이면 안 건다
    s.giver = { name: n.name, img: n.img, map: p.world.mapId };
    s.resume = n.id;
    n.subqAt = now;
    p.world.script.named(p, name, n);
    return true;
  }

  // ---------- 대본 행동 ----------
  // 특수 대사 (DoEventServerAction 의 ChatOneByCode 0x4264xx). 돌려주는 값: 보낼 글, null 이면 말하지 않음, { end } 이면 대본을 끝냄
  chatText(p, code) {
    const s = this.sq(p), t = msg(7, code);
    switch (code) {
      case 0x88: { const q = questMonster(p); if (!q) return null; s.tmap = q.map; s.timg = q.mon; return fmt(t, [imgName(q.mon), mapName(q.map)]); }
      case 0x8c: if (s.tmap === -1 || s.timg === -1) return null; return fmt(t, [mapName(s.tmap), imgName(s.timg)]);
      case 0x8d: case 0x91: case 0x96: {
        const G = s.gift = gift(p);
        let str = '';
        if (G.exp) str += fmt(msg(7, 0x117), [G.exp]);
        if (G.fame) str += fmt(msg(7, 0x118), [G.fame]);
        if (G.item.n) { const nm = this.itemName(G.item); if (nm) str += `${nm} : ${G.item.n} `; }
        return fmt(t, [str]);
      }
      case 0x8f: {
        const it = randomIIS(), q = questMonster(p);
        if (!q || !it.k) return null;
        s.item = it; s.tmap = q.map; s.timg = q.mon;
        return fmt(t, [mapName(q.map), this.itemName(it), imgName(q.mon)]);
      }
      case 0x95: {
        const it = randomIIS(), q = randomNpc(p);
        if (!q) return { end: 1 };
        if (!it.k) return null;
        s.item = it; s.tmap = q.map; s.timg = q.img;
        return fmt(t, [this.itemName(it), mapName(q.map), imgName(q.img)]);
      }
    }
    return t;
  }
  isSpecial(code) { return [0x88, 0x8c, 0x8d, 0x8f, 0x91, 0x95, 0x96].includes(code); }
  // BeginSubQuest1·2·3
  begin(p, k) {
    const s = this.sq(p), g = s.giver;
    if (s.state || !g || g.img === undefined || g.map < 0 || s.timg < 0 || s.tmap < 0) return;
    if (k >= 2 && !(s.item && s.item.k)) return;
    if (k === 3 && !this.game.story.addQItem(p, s.item.k, s.item.i, s.item.n)) return;
    s.state = k; s.done = 0; s.left = TIME_MS; s.min = Math.floor(TIME_MS / 60000);
    this.game.story.sendInfo(p, true);
  }
  // StopSubQuestAndResume: 맡긴 NPC 기억을 지우고 그 NPC 의 원래 일을 한다 (이름 없이 다시 부르므로 보조 퀘스트는 다시 걸리지 않는다)
  stopAndResume(p) {
    const s = this.sq(p); if (!s.giver || !s.resume) return;
    const id = s.resume; s.giver = null; s.resume = 0;
    const n = p.world.npcs.find(q => q.id === id);
    if (n) p.world.npcAction(p, n);
  }

  // 노란 이름(패턴 4) 몬스터를 잡았을 때 (CMopServer::Dead 0x47872a). 원작은 맡긴 NPC 의 맵(+0x41e0)과 비교한다
  onKill(p, m) {
    const s = this.sq(p);
    if (m.pattern !== 4 || s.done || !(s.state === 1 || s.state === 2)) return;
    if (!m.info || m.info.img !== s.timg || !s.giver || p.world.mapId !== s.giver.map) return;
    if (s.state === 2 && !(s.item && s.item.k)) return;
    s.done = 1;
    if (s.state === 1) this.game.story.sendInfo(p, true);
    else this.game.story.addQItem(p, s.item.k, s.item.i, s.item.n);
  }
  // 남은 시간 (OnTimer): 분이 바뀌면 창을 다시 보내고, 끝나면 퀘스트 아이템을 거두고 0/2/0xcb
  tick(p, dt) {
    const s = p.subq; if (!s || !s.state) return;
    s.left -= dt;
    if (s.left <= 0) {
      const it = s.state >= 2 ? s.item : null;
      this.clear(p);
      if (it) this.game.story.removeQItem(p, it.k, it.i, it.n);
      this.game.story.msg(p, 0xcb); this.game.story.sendInfo(p, true);
      return;
    }
    const min = Math.floor(s.left / 60000);
    if (min !== s.min) { s.min = min; this.game.story.sendInfo(p, false); }
  }
  // 퀘스트 창 (SendQuestInfo 0x4254e0 앞부분, SendSetQuestInfoWindow 0x425320). 클라이언트가 채우던 %s 를 여기서 채운다
  lines(p) {
    const s = p.subq; if (!s || !s.state || !s.giver || s.tmap < 0 || s.timg < 0) return null;
    const g = s.giver, it = this.itemName(s.item), min = `${Math.floor(s.left / 60000)} ${msg(7, 0xf4)}`;
    if (s.state === 1) return { title: msg(7, 0xf6), text: fmt(msg(7, 0xf7), [mapName(s.tmap), imgName(s.timg), mapName(g.map), imgName(g.img)]), time: min };
    if (!s.item || !s.item.k) return null;
    if (s.state === 2) return { title: msg(7, 0xf8), text: fmt(msg(7, 0xf9), [mapName(s.tmap), imgName(s.timg), it, mapName(g.map), imgName(g.img)]), time: min };
    return { title: msg(7, 0xfa), text: fmt(msg(7, 0xfb), [it, mapName(s.tmap), imgName(s.timg), mapName(g.map), imgName(g.img)]), time: min };
  }
}
module.exports = { SubQuest, KINDS, randomIIS, questMap, randomNpc, randomMonster, questMonster, gift, imgName, mapName };
