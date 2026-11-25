'use strict';
// 우주선(시그너스행) 퀘스트. 근거는 docs/spaceship_notes.md
//  - 맵 87 발사장, 88 우주선, 89~92 탈출선, 93~96 시그너스 착륙 지점
//  - 30분 주기 (tm_min % 30): 0~4분 출발 안내, 5분 발사, 9분 침입자(몬스터 나타남), 14·19분 다음 무리,
//    24분 몬스터가 남아 있으면 우주선 파괴(병원으로), 없으면 시그너스 습격 대본, 25~28분 탈출 안내, 29분 착륙
//    (CMapServerServer::ProcessSpaceShipQuest 0x444840, 맵 87·88~92 에서 돈다)
//  - 탑승: 맵 87 → 88 이동 지점 (ProcessEvent 0x41f5df), 그룹 이동 (MoveGroupForSpaceShipQuest 0x461320)

const LAUNCH = 87, SHIP = 88;
const isShip = m => m >= 88 && m <= 92;
const LAND = { 89: 93, 90: 94, 91: 95, 92: 96 };
// GetDefaultPIS 0x4723a0 (맵 0~0xbc 분기표 0x472a38) + rm3944 NewMapFix 0x10003201 (맵 300~316). data/default_pos.json 은 [x, y, z]
const DEFAULT_POS = (() => { try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'default_pos.json'), 'utf8')); } catch { return {}; } })();

// GetHospitalMapNumber 0x43c0f0: 지금 맵 → 병원 맵. 'L' 은 레벨로
const HOSP = (() => {
  const t = {}, set = (v, ...ms) => ms.forEach(m => { t[m] = v; });
  set(9, 0, 1, 2, 4, 5, 9, 10, 74);
  set(12, 3, 6, 12, 17, 35, 36, 41, 42, 71, 72, 73, 75, 76, 77, 78, 87, 177, 178, 179);
  set(13, 7, 13, 15, 16, 18, 37);
  set(14, 8, 14, 19, 20, 38, 39, 40, 70);
  set(22, 21, 22, 23, 25, 27, 29, 30); for (let m = 43; m <= 69; m++) set(22, m); for (let m = 109; m <= 131; m++) set(22, m);
  set(81, 79, 80, 81, 82, 83, 84, 85, 86, 88, 89, 90, 91, 92);
  set(97, 93, 97, 98, 99); set(100, 94, 100, 101, 102); set(103, 95, 103, 104, 105); set(106, 96, 106, 107, 108);
  set(148, 137, 142, 143, 144, 145, 146, 147, 148); set(155, 138, 149, 150, 151, 152, 153, 154, 155);
  set(162, 139, 156, 157, 158, 159, 160, 161, 162); set(169, 140, 163, 164, 165, 166, 167, 168, 169);
  set(176, 141, 170, 171, 172, 173, 174, 175, 176);
  return t;
})();
function hospitalMap(p, map) {
  const v = HOSP[map];
  if (v !== undefined) return v;
  const L = p.level;                                   // 24, 26, 28, 31~34, 11, 132~136, 0xb4 이상 등
  return L < 35 ? 22 : L < 150 ? 9 : L < 200 ? 12 : L < 250 ? 13 : L < 600 ? 14 : 81;
}

class SpaceShip {
  constructor(game) { this.game = game; }
  bc(w, code, ...args) {
    for (const p of [...w.players.values()]) {
      // 0xc0 "탈출선 착륙" 을 받은 산 사람은 0x10000 (시그너스에 가 봄). 시험 서버 상금(SendTestQuestMoney)은 Lang 0 에서만 (0x4732ae)
      if (code === 0xc0 && !p.dead) { p.story = (p.story || 0) | 0x10000; this.game.story.sendInfo(p, false); }
      this.game.story.msg(p, code, ...args);
    }
  }
  wave(w, id) { w.broadcast({ t: 'wave', id }); }
  // 병원으로 (MoveAllUserToHospital 0x444490): 죽은 사람은 살려서
  toHospital(w) {
    for (const p of [...w.players.values()]) {
      if (p.dead) { p.dead = false; p.hp = p.maxHp; p.mp = p.maxMp; }
      const m = hospitalMap(p, w.mapId), pos = DEFAULT_POS[m];
      this.game.gotoMap(p, m, pos[0], pos[1]);
    }
  }
  // 모두 옮기기 (MoveAllUser 0x4443b0): 죽은 사람은 다시 시작 (ProcessRestart)
  moveAll(w, map) {
    const pos = DEFAULT_POS[map];
    for (const p of [...w.players.values()]) { if (p.dead) this.game.restart(p); else this.game.gotoMap(p, map, pos[0], pos[1]); }
  }

  tick(w, now) {
    const id = w.mapId; if (id !== LAUNCH && !isShip(id)) return;
    const d = new Date(now), min = d.getMinutes(), m = min % 30;
    if (w.shipMin === undefined) w.shipMin = min;        // 시각 칸(+0x3680)은 맵을 만들 때의 시각
    if (min === w.shipMin) {
      // 24분부터 우주선 안은 경보음 (0xc6/0xc7)
      if (m >= 24 && isShip(id) && now >= (w.waveAt || 0)) { w.waveAt = now + 1000; this.wave(w, now % 1000 < 500 ? 0xc6 : 0xc7); }
      return;
    }
    w.shipMin = min;
    if (m <= 4) this.bc(w, 0xb1, 5 - m); else if (m === 5) this.bc(w, 0xb2);
    if (!isShip(id) || m < 9) return;
    const regenWave = () => { w.setRegen(true); this.bc(w, 0xb4); this.wave(w, 0xb9); };
    if (m === 9) { regenWave(); return; }
    if (w.mobs.size) {                                   // AnyLiveMonster
      this.bc(w, 0xb4);
      if (m === 14) { w.setRegen(true); this.bc(w, 0xb5); }
      else if (m === 19) { w.setRegen(true); this.bc(w, now % 100 < 50 ? 0xb6 : 0xb7); }
      else if (m === 24) { this.bc(w, 0xb8); this.bc(w, 0xb9); this.toHospital(w); w.clearMobs(); }
      else this.wave(w, 0xb9);
      return;
    }
    if (m === 14 || m === 19) regenWave();
    else if (m === 24) for (const p of [...w.players.values()]) w.script.named(p, 'SpaceShipFallQuest');
    else if (m >= 25 && m <= 28) this.bc(w, 0xbe);
    else if (m === 29) {
      if (id === SHIP) { this.bc(w, 0xbf); this.toHospital(w); }
      else { this.bc(w, 0xc0); this.moveAll(w, LAND[id]); }
    }
  }

  // 이동 지점을 밟았을 때 (ProcessEvent 종류 1 의 맵별 조건). true 면 보통 이동, false 면 막음, 'done' 이면 여기서 옮김
  gate(p, to, pos) {
    const w = p.world, cur = w.mapId, m = new Date().getMinutes() % 30, s = p.story || 0, msg = c => this.game.story.msg(p, c);
    if (cur === 0x44 && to !== 0x44) msg(0x5c);
    if ([0x5d, 0x5e, 0x5f, 0x60].includes(cur) && to === LAUNCH && w.mobs.size) { msg(0xcf); return false; }
    if (cur === SHIP) {
      if (to >= 89 && to <= 92) { if (m > 23 && !w.mobs.size) return true; msg(0x75); return false; }
      if (to === LAUNCH) { if (m < 5) return true; msg(0xc5); return false; }
    }
    if (cur !== LAUNCH || to !== SHIP) return true;
    if (!(s & 0x8000)) { msg(0xb0); return false; }
    if (s & 0x10000) {
      if (m >= 5) { msg(0xb3); return false; }
      if (p.chr !== 3) return true;
      this.game.gotoMap(p, to, pos[0], pos[1]);
      if (p.group) this.moveGroup(p, w, to, pos);
      return 'done';
    }
    if (p.chr !== 3) { msg(0xc6); return false; }
    if (!p.group) { msg(0xc7); return false; }
    if (m > 4) { msg(0xb3); return false; }
    if (!this.moveGroup(p, w, to, pos)) msg(0xc9);
    return 'done';
  }
  // MoveGroupForSpaceShipQuest: 그룹에 데스티노가 아니고 0x8000 이 있는 산 사람이 있어야 하고,
  // 0x2000 이 있는 산 그룹원을 모두 옮긴다. (원작은 그 맵 서버에 접속한 사람만 찾는다: 여기서는 같은 맵)
  moveGroup(p, w, to, pos) {
    const g = this.game.groups.of(p); if (!g) return false;
    const mem = this.game.groups.players(g).filter(q => q.world === w || q === p);
    if (!mem.some(q => q.chr !== 3 && (q.story & 0x8000) && !q.dead)) return false;
    for (const q of mem) if ((q.story & 0x2000) && !q.dead && q.world.mapId !== to) this.game.gotoMap(q, to, pos[0], pos[1]);
    return true;
  }
}
module.exports = { SpaceShip, hospitalMap, DEFAULT_POS };
