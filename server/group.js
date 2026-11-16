'use strict';
// 그룹(파티). 원작은 맵 서버들이 맵 센터와 DB 표 tblGroupInfo1 로 그룹을 나눠 가진다.
// 여기서는 서버 하나라 그룹 표를 메모리에 둔다. 규칙은 원작 그대로:
//  - 만들기 (ProcessCreateGroup 0x4400f0): 그룹이 없어야 하고, 첩자의 집(맵 74)에서는 못 만든다. 만든 사람이 그룹장 (RMS_GROUP_CREATENEWGROUP, bGroupMaster=1)
//    그 뒤 대본 조건 "CreateGroup" 을 진행한다
//  - 초대 (ProcessInviteGroup 0x440300, InviteGroup 0x460630): 그룹장만. 다섯 명까지 (CGroupManager::InviteMember 0x407330)
//    상대가 같은 맵에 있어야 하고(-3), 그룹이 없어야 하며(-4 → 메시지 0xa7), 레벨 차이가 맞아야 한다(-5)
//  - 레벨 조건 (IsValidGroupMemberLevel 0x460880): 가장 높은 레벨 H, 가장 낮은 레벨 L. 둘 다 9 이하면 됨.
//    아니면 T = H×2/3 (H−T 가 100 을 넘으면 T = H−100), L > T 여야 한다
//  - 들어오기 (ProcessJoinGroup 0x440520): 초대받은 사람이 수락하면. 들어온 뒤에도 레벨 조건이 안 맞으면 빠진다 (JoinGroup 0x460980)
//  - 나가기·내보내기 (LeaveGroup 0x460a10): 나간 사람이 그룹장이면 그룹이 해산된다 (DeleteGroupMember 가 bGroupMaster+1 을 돌려준다: 2 = 해산)
//    접속을 끊거나 첩자의 집(맵 74)으로 들어가면 그룹에서 나간다 (~CMapServerClient, SendChangeMapPacket 0x43f31f)
//  - 경험치 (GroupShareExperience 0x461d80): 몬스터 근처(관리 범위)에 있는 같은 맵 멤버 수 n 에 따라
//    1명 ×1, 2명 −1/10, 3명 ×1, 4명 +1/20, 5명 +1/10. 그 값을 멤버마다 따로 받는다 (각자 필요 경험치의 1/10 까지)
const LV_FREE = 9;
const MAX = 5;
const NO_GROUP_MAP = 74;

class Groups {
  constructor(game) { this.game = game; this.list = new Map(); this.next = 1; }
  of(p) { return p.group ? this.list.get(p.group) : null; }
  // 레벨 조건 (0x460880)
  levelOk(levels) {
    const H = Math.max(...levels), L = Math.min(...levels);
    if (H <= LV_FREE && L <= LV_FREE) return true;
    let T = Math.floor(H * 2 / 3); if (H - T > 100) T = H - 100;
    return L > T;
  }
  players(g) { return g.members.map(n => this.game.findOnline(n)).filter(Boolean); }

  create(p) {
    if (p.group || p.world.mapId === NO_GROUP_MAP || p.dead) return;
    const g = { id: this.next++, leader: p.name, members: [p.name], invited: new Set() };
    this.list.set(g.id, g); p.group = g.id;
    this.sendInfo(g);
    p.world.script.named(p, 'CreateGroup');
  }
  invite(p, name) {
    const g = this.of(p); name = String(name || '').trim();
    if (!g || g.leader !== p.name || !name || name.length > 16) return;
    if (g.members.length >= MAX || g.members.includes(name)) return;
    const t = [...p.world.players.values()].find(q => q.name === name);
    if (!t) { p.send({ t: 'note', text: `${name}: 같은 맵에 없습니다.` }); return; }            // -3: 원작은 알림 없이 끝난다. 이 줄만 이 게임의 안내
    if (t.group) { this.game.story.msg(p, 0xa7, name); return; }                               // -4
    if (!this.levelOk([...this.players(g).map(q => q.level), t.level])) return;                 // -5: 보통 서버는 알림 없음
    g.invited.add(name);
    t.send({ t: 'ginvite', leader: p.name });
  }
  join(p, leader, accept) {
    const g = [...this.list.values()].find(x => x.leader === leader);
    if (!g || !g.invited.has(p.name)) return;
    g.invited.delete(p.name);
    if (!accept || p.group || g.members.length >= MAX) return;
    g.members.push(p.name); p.group = g.id;
    if (!this.levelOk(this.players(g).map(q => q.level))) { g.members.pop(); p.group = 0; return; }
    this.sendInfo(g);
  }
  // 나가기. by 가 그룹장이고 name 이 다른 사람이면 내보내기
  leave(p, name) {
    const g = this.of(p); if (!g) return;
    const who = name && name !== p.name ? name : p.name;
    if (who !== p.name && g.leader !== p.name) return;
    if (!g.members.includes(who)) return;
    if (who === g.leader) { this.dissolve(g); return; }
    g.members = g.members.filter(n => n !== who);
    const q = this.game.findOnline(who); if (q) { q.group = 0; q.send({ t: 'group', members: [] }); }
    this.sendInfo(g);
  }
  dissolve(g) {
    for (const q of this.players(g)) { q.group = 0; q.send({ t: 'group', members: [] }); }
    this.list.delete(g.id);
  }
  // 멤버 목록과 체력 % (SendGroupMemberInfo 0x440680). 다른 맵에 있으면 맵 번호를 보인다
  sendInfo(g) {
    const ps = this.players(g);
    const members = g.members.map(n => {
      const q = ps.find(x => x.name === n);
      return { name: n, leader: n === g.leader ? 1 : 0, chr: q ? q.chr : 0, level: q ? q.level : 0, hp: q ? Math.min(100, Math.floor(q.hp * 100 / Math.max(1, q.maxHp))) : -1, map: q ? q.world.mapId : -1 };
    });
    for (const q of ps) q.send({ t: 'group', members, leader: g.leader });
  }
  hpChanged(p) { const g = this.of(p); if (!g) return; const pct = Math.min(100, Math.floor(p.hp * 100 / Math.max(1, p.maxHp))); if (pct === p.gHp) return; p.gHp = pct; const now = Date.now(); if (now - (g.hpAt || 0) < 500) { g.hpDirty = 1; return; } g.hpAt = now; g.hpDirty = 0; this.sendInfo(g); }
  tick(now) { for (const g of this.list.values()) if (g.hpDirty && now - (g.hpAt || 0) >= 500) { g.hpAt = now; g.hpDirty = 0; this.sendInfo(g); } }
  // 그룹 대화 (ProcessGroupChat 0x441590)
  chat(p, text) {
    const g = this.of(p); text = String(text || '').slice(0, 200); if (!g || !text) return;
    for (const q of this.players(g)) q.send({ t: 'chat', id: p.id, name: p.name, text, group: 1 });
  }
  // 몬스터를 잡았을 때 경험치 나누기 (CMopServer::Dead 0x478f3b → GroupShareExperience)
  shareExp(killer, mob, exp) {
    const g = this.of(killer); if (!g) return false;
    const w = killer.world;
    const near = this.players(g).filter(q => q.world === w && !q.dead && w.inMgmt(mob, q));
    if (!near.length) return true;
    const n = near.length;
    const x = n === 2 ? exp - Math.floor(exp / 10) : n === 4 ? exp + Math.floor(exp / 20) : n === 5 ? exp + Math.floor(exp / 10) : exp;
    for (const q of near) this.game.gainExp(q, x);
    return true;
  }
  // 접속 끊김·맵 이동
  offline(p) { if (p.group) this.leave(p); }
  moved(p) { if (!p.group) return; if (p.world.mapId === NO_GROUP_MAP) this.leave(p); else this.sendInfo(this.of(p)); }
}

module.exports = { Groups };
