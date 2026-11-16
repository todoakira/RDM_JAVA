'use strict';
// 군단(Army). 원작 서버 svMapServer.exe(3944판)의 Process*Army* 와 rmDB.dll CArmy, DB 프로시저 RMS_ARMY_* 를 옮겼다. 자세한 근거는 docs/army_notes.md.
// 지금 있는 것: 예비 군단(Free Agent Army) 목록·찾기·만들기·상세·핵심 멤버로 들기·해산, 군단 만들기(이름·비밀번호·문장, 핵심 멤버 초대·빼기, 마침·취소),
//   군단 정보, 병사 모집·대답·해고, 탈퇴, 해산, 공지, 군단 대화.
// 아직 없는 것: 부대(부관), 권한, 비밀번호 바꾸기, 군단장 넘기기, 동맹, 전쟁, 홀(아지트)·금고·본부·상점 세금, 용병.
const fs = require('fs');
const path = require('path');
const F = require('./formulas');

const ROOT = path.join(__dirname, '..');
const DAY = 24 * 3600 * 1000;
const MAX_RESERVE = 100, MAX_ARMY = 100, MAX_INIT = 50, MIN_FORM = 11;   // 0x64, 0x65, 0x32, 0xb
const STATE = { RESERVE: -1, FROM_RESERVE: -2, DIRECT: -3, ACTIVE: 1 };

class Army {
  constructor(game) {
    this.game = game;
    try { this.db = JSON.parse(fs.readFileSync(path.join(ROOT, 'save', 'army.json'), 'utf8')); } catch (e) { this.db = {}; }
    this.db.seq ||= 0; this.db.armies ||= {}; this.db.members ||= {}; this.db.sanction ||= {};
  }
  save() { try { fs.mkdirSync(path.join(ROOT, 'save'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'save', 'army.json'), JSON.stringify(this.db)); } catch (e) { console.log('군단 저장 실패', e.message); } }
  msg(p, code, ...a) { this.game.story.msg(p, code, ...a); }

  // 진영 (CMapServerServer::GetArmySide 0x464820)
  side(w) { const m = w.mapId; if (m > 0xb3 && m < 0xbd) return 0; return m === 47 ? 1 : m === 109 ? 2 : 0; }
  // 군단장 자격 (CheckCommanderLicense 0x411fe0)
  license(p) { if (p.level >= 400 && Math.abs(p.fame || 0) >= 400) return true; this.msg(p, 0x11a, 400, 400); return false; }
  canInit(p) { return !this.idOf(p.name) && p.level >= 300; }        // CanBeInitMember 0x412090
  // 그 사람이 속한 군단 번호 (CArmy::GetArmyID: 군단장이거나 병사). active 면 정식 군단만
  idOf(name, active) {
    for (const [id, a] of Object.entries(this.db.armies)) if (a.commander === name && (!active || a.state > 0)) return Number(id);
    const m = this.db.members[name]; if (m && this.db.armies[m.army] && (!active || this.db.armies[m.army].state > 0)) return m.army;
    return 0;
  }
  members(id) { return Object.keys(this.db.members).filter(n => this.db.members[n].army === id); }
  count(id) { return this.members(id).length + 1; }                   // GetArmyMemberCount: 병사 + 군단장
  sanctioned(name) { const t = this.db.sanction[name]; if (t && t > Date.now()) return true; delete this.db.sanction[name]; return false; }
  addSanction(name) { this.db.sanction[name] = Date.now() + 7 * DAY; }   // RMS_ARMY_ADDREJOINSANCTION
  levelOf(name) { const q = this.game.findOnline(name); if (q) return q.level; try { return JSON.parse(fs.readFileSync(this.game.saveFile(name), 'utf8')).level || 0; } catch (e) { return 0; } }
  byName(name) { for (const [id, a] of Object.entries(this.db.armies)) if (a.name === name) return [Number(id), a]; return [0, null]; }
  mail(to, title, text) { this.game.mail.deliver(to, 'ArmyAdmin', title, text); }
  online(id) { const out = []; for (const n of [this.db.armies[id] && this.db.armies[id].commander, ...this.members(id)]) { const q = n && this.game.findOnline(n); if (q) out.push(q); } return out; }

  // ---- 군단 컴퓨터 (이벤트 종류 11 → 패킷 0x709)
  openComputer(p) { if (this.side(p.world)) p.send({ t: 'army', w: 'computer' }); }

  // ---- 예비 군단 (Free Agent Army)
  reserves(side, like) {
    return Object.values(this.db.armies).filter(a => a.state === STATE.RESERVE && a.camp === side && (!like || a.name.includes(like)))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
  }
  // 목록 (ProcessClickReserveArmy 0x412140) · 찾기 (ProcessSearchReserveArmy 0x412530): 이름, 사람 수, 만든 날
  reserveList(p, like) {
    const side = this.side(p.world); if (!side) return;
    const list = this.reserves(side, like ? String(like).slice(0, 10) : '').map(a => { const id = this.idByObj(a); return { name: a.name, n: this.count(id), at: a.created }; });
    p.send({ t: 'army', w: 'reserves', list });
  }
  idByObj(a) { return Number(Object.keys(this.db.armies).find(k => this.db.armies[k] === a)); }
  // 예비 군단 만들기 시도 (ProcessTryToCreateReserveArmy 0x412250)
  reserveTry(p) {
    if (!this.license(p)) return;
    if (this.idOf(p.name)) { this.msg(p, 0x21, p.name); return; }
    if (this.sanctioned(p.name)) { this.msg(p, 0x164, p.name); return; }
    if (this.reserves(this.side(p.world)).length >= MAX_RESERVE) { this.msg(p, 0xd6); return; }
    p.send({ t: 'army', w: 'reservenew' });
  }
  // 예비 군단 만들기 (ProcessAttemptCreateReserveArmy 0x4123a0, RMS_ARMY_CREATERESERVEARMY: 이름이나 군단장이 겹치면 실패, 활동 7일)
  reserveCreate(p, name, notice) {
    const side = this.side(p.world); name = String(name || '').trim().slice(0, 10); notice = String(notice || '').slice(0, 84);
    if (!side || !name || !this.license(p)) return;
    if (this.idOf(p.name)) { this.msg(p, 0x21, p.name); return; }
    if (this.reserves(side).length >= MAX_RESERVE) { this.msg(p, 0xd6); return; }
    if (Object.values(this.db.armies).some(a => a.name === name || a.commander === p.name)) { this.msg(p, 0x28); return; }
    const id = ++this.db.seq, now = Date.now();
    this.db.armies[id] = { mark: 0, state: STATE.RESERVE, camp: side, name, commander: p.name, password: '', created: now, activity: now + 7 * DAY, notice };
    this.save(); p.send({ t: 'army', w: 'reservemade' }); this.reserveList(p);
  }
  // 예비 군단 상세 (ProcessClickReserveArmyList 0x412660): 군단장, 멤버, 공지. 내 것이면 2, 들 수 있으면 1
  reserveInfo(p, name) {
    const side = this.side(p.world); const [id, a] = this.byName(String(name || ''));
    if (!a || a.state !== STATE.RESERVE || a.camp !== side) { p.send({ t: 'army', w: 'reservegone' }); return; }
    const can = a.commander === p.name ? 2 : this.canInit(p) ? 1 : 0;
    p.send({ t: 'army', w: 'reserveinfo', name: a.name, commander: a.commander, members: this.members(id), notice: a.notice, can });
  }
  // 핵심 멤버로 들기 (ProcessJoinReserveArmyInitMember 0x413420, RMS_ARMY_ADDARMYINITMEMBER: 10명이 되면 군단장에게 우편)
  reserveJoin(p, commander) {
    commander = String(commander || ''); if (commander === p.name) return;
    if (this.sanctioned(p.name)) { this.msg(p, 0x164, p.name); return; }
    if (this.idOf(p.name)) { this.msg(p, 0xd7); return; }
    if (!this.canInit(p)) { this.msg(p, 0x25, p.name, 300); return; }
    const id = this.idOf(commander), a = this.db.armies[id]; if (!a || a.state >= 0) return;
    if (this.count(id) >= MAX_INIT) { this.msg(p, 0xf0); return; }
    this.db.members[p.name] = { army: id, joined: Date.now() };
    if (a.state === STATE.RESERVE && this.members(id).length === 10)
      this.mail(a.commander, 'Create Pending Army', 'All core members of your pending army have been\nassembled.  Please proceed to the Army Hall Lobby\nand register as an official army.');
    this.save(); p.send({ t: 'army', w: 'joined' });
  }
  // 예비 군단 해산 (ProcessBreakUpReserveArmy 0x413640): 군단장만
  reserveBreak(p, commander) {
    if (String(commander || '') !== p.name) { this.msg(p, 0x1e); return; }
    const id = this.idOf(p.name), a = this.db.armies[id]; if (!a || a.state !== STATE.RESERVE || a.commander !== p.name) return;
    this.remove(id); this.msg(p, 0x2b, a.name); this.save();
  }
  remove(id) { delete this.db.armies[id]; for (const n of this.members(id)) delete this.db.members[n]; }

  // ---- 군단 만들기
  // 시도 (ProcessTryToCreateArmy 0x4128b0, GetArmyCreateInfo): 예비 군단이 있으면 그 이름. 진영의 이미 쓰는 문장 목록
  armyTry(p) {
    const side = this.side(p.world); if (!side || !this.license(p)) return;
    if (this.idOf(p.name, true) || (this.db.members[p.name])) { this.msg(p, 0x21, p.name); return; }
    if (this.activeCount(side) >= MAX_ARMY) { this.msg(p, 0xd5); return; }
    if (this.sanctioned(p.name)) { this.msg(p, 0x164, p.name); return; }
    const rid = this.idOf(p.name), r = this.db.armies[rid];
    if (r && r.state === STATE.RESERVE && r.camp !== side) { this.msg(p, 0xee); return; }
    const used = Object.values(this.db.armies).filter(a => a.camp === side && a.mark).map(a => a.mark);
    p.send({ t: 'army', w: 'create', camp: side, name: r && r.state === STATE.RESERVE ? r.name : '', used });
  }
  activeCount(side) { return Object.values(this.db.armies).filter(a => a.camp === side && a.state > 0).length; }
  // 만들기 정보 (ProcessCreateArmyInfo 0x412a70): 예비 군단이면 RMS_ARMY_CREATEARMYFROMRSARMY, 아니면 RMS_ARMY_CREATEARMY (State -3)
  //   문장은 진영 1 이 1~100, 진영 2 가 101~200 (GetArmyCreateInfo)
  armyInfo(p, name, password, mark) {
    const side = this.side(p.world); if (!side) return;
    if (this.activeCount(side) >= MAX_ARMY) { this.msg(p, 0xd5); return; }
    mark = mark | 0; name = String(name || '').trim().slice(0, 10); password = String(password || '').slice(0, 20);
    if (!(side === 1 ? mark >= 1 && mark <= 100 : mark >= 101 && mark <= 200) || !password) return;
    if (Object.values(this.db.armies).some(a => a.mark === mark)) { this.msg(p, 0xef); return; }
    const rid = this.idOf(p.name); let r = this.db.armies[rid];
    if (r && r.commander === p.name && r.state === STATE.RESERVE) Object.assign(r, { state: STATE.FROM_RESERVE, camp: side, password, mark, notice: '' });
    else {
      if (!name || Object.values(this.db.armies).some(a => a.name === name || a.commander === p.name)) { this.msg(p, 0x28); return; }
      const id = ++this.db.seq, now = Date.now();
      r = this.db.armies[id] = { mark, state: STATE.DIRECT, camp: side, name, commander: p.name, password, created: now, activity: now + 30 * DAY, notice: '' };
    }
    p.armyCreating = 1; this.save();
    p.send({ t: 'army', w: 'core', name: r.name, members: this.members(this.idOf(p.name)) });
  }
  // 핵심 멤버 초대 (ProcessInviteInitMember 0x412c50 → 상대에게 0/0/0x157 질문)
  invite(p, who) {
    who = String(who || '').trim(); if (!who) return;
    if (who === p.name) { this.msg(p, 0x29); return; }
    const id = this.idOf(p.name), a = this.db.armies[id]; if (!a || a.commander !== p.name || a.state >= 0) return;
    const other = this.idOf(who);
    if (other) { this.msg(p, other === id ? 0x47 : 0x21, who); return; }
    if (this.sanctioned(who)) { this.msg(p, 0x164, who); return; }
    if (this.count(id) >= MAX_INIT) { this.msg(p, 0xf0); return; }
    const q = this.game.findOnline(who); if (!q) return;
    (q.armyAsk ||= {})[p.name] = 'core';
    q.send({ t: 'army', w: 'askcore', army: a.name, commander: p.name });
  }
  // 대답 (ProcessResponseInviteInitMember 0x412ef0): 싫으면 군단장에게 0xd9, 좋으면 넣고 군단장 창에 더한다
  inviteAnswer(p, commander, yes) {
    commander = String(commander || ''); if (!p.armyAsk || p.armyAsk[commander] !== 'core') return; delete p.armyAsk[commander];
    const c = this.game.findOnline(commander);
    if (!yes) { if (c) this.msg(c, 0xd9, p.name); return; }
    if (this.idOf(p.name)) { this.msg(p, 0xd7); return; }
    const id = this.idOf(commander), a = this.db.armies[id]; if (!a || a.commander !== commander || a.state >= 0) return;
    if (this.count(id) >= MAX_INIT) { this.msg(p, 0xf0); return; }
    this.db.members[p.name] = { army: id, joined: Date.now() }; this.save();
    if (c) c.send({ t: 'army', w: 'coreadd', name: p.name });
    this.msg(p, 0x46, a.name);
  }
  // 핵심 멤버 빼기 (ProcessRemoveInitMember 0x4130b0, RMS_ARMY_REMOVEARMYINITMEMBER)
  removeInit(p, who) {
    who = String(who || ''); if (who === p.name) return;
    const id = this.idOf(p.name), a = this.db.armies[id], m = this.db.members[who];
    if (!a || a.commander !== p.name || !m || m.army !== id) { this.msg(p, 0xdb); return; }
    delete this.db.members[who]; this.save(); p.send({ t: 'army', w: 'coredel', name: who });
  }
  // 마침 (ProcessAttemptCreateArmy 0x4131f0, RMS_ARMY_FINISHCREATEARMY: 활동 한 달)
  armyForm(p) {
    const side = this.side(p.world); if (!side) return;
    if (this.activeCount(side) > MAX_ARMY) { this.msg(p, 0xd5); return; }
    if (!this.license(p)) return;
    const id = this.idOf(p.name), a = this.db.armies[id]; if (!a || a.commander !== p.name || a.state >= -1) return;
    if (this.count(id) < MIN_FORM) { this.msg(p, 0x1d); return; }
    const now = Date.now(); Object.assign(a, { state: STATE.ACTIVE, created: now, activity: now + 30 * DAY });
    p.armyCreating = 0; this.save();
    for (const w of this.game.worlds.values()) for (const q of w.players.values()) this.msg(q, 0x2a, a.name);   // BroadcastCreateArmyToMapCenter
    p.send({ t: 'army', w: 'formed' });
    for (const q of this.online(id)) this.sendBadge(q);
  }
  // 취소 (ProcessCancelCreateArmy 0x413350, RMS_ARMY_CANCELCREATEARMY): 예비 군단에서 온 것은 예비 군단으로, 바로 만든 것은 지운다
  armyCancel(p) {
    if (!p.armyCreating) return; p.armyCreating = 0;
    const id = this.idOf(p.name), a = this.db.armies[id]; if (!a || a.commander !== p.name) return;
    if (a.state === STATE.FROM_RESERVE) { a.state = STATE.RESERVE; a.mark = 0; }
    else if (a.state === STATE.DIRECT) this.remove(id);
    this.save();
  }

  // ---- 정식 군단
  // 군단 정보 (ProcessArmyInfoWindow 0x418380): 이름, 군단장, 공지
  info(p) {
    const id = this.idOf(p.name, true), a = this.db.armies[id];
    if (!a) { p.send({ t: 'army', w: 'info', none: 1 }); return; }
    p.send({ t: 'army', w: 'info', name: a.name, commander: a.commander, notice: a.notice, mark: a.mark, camp: a.camp, me: a.commander === p.name ? 'cmd' : 'reg' });
  }
  // 멤버 (ProcessClickArmyMemberInfo 0x4171a0): 군단장, 병사
  memberList(p) {
    const id = this.idOf(p.name, true), a = this.db.armies[id]; if (!a) { this.msg(p, 0x101); return; }
    p.send({ t: 'army', w: 'members', commander: a.commander, members: this.members(id) });
  }
  // 관리 로그인 (ProcessArmyManagementLogin 0x4137b0): 군단장 비밀번호. 맞으면 관리 창
  login(p, password) {
    const id = this.idOf(p.name, true), a = this.db.armies[id];
    if (!a) { this.msg(p, 0xdb); return; }
    const side = this.side(p.world); if (side && a.camp !== side) { this.msg(p, 0xee); return; }
    if (a.commander !== p.name || a.password !== String(password || '')) { this.msg(p, 0x1f); return; }
    p.armyLogin = id; p.send({ t: 'army', w: 'manage', kind: 1 });
  }
  // 공지 (ProcessRewriteNotice 0x413900, ProcessFinishRewriteNotice 0x413a90)
  notice(p, text) {
    const id = this.idOf(p.name, true), a = this.db.armies[id];
    if (!a) { this.msg(p, 0xdb); return; }
    if (a.commander !== p.name) { this.msg(p, 0x1e); return; }
    if (text === undefined) { p.send({ t: 'army', w: 'notice', text: a.notice }); return; }
    a.notice = String(text).slice(0, 62); this.save(); p.send({ t: 'army', w: 'noticed' });
  }
  // 병사 모집 (ProcessArmyEmployment 0x4197f0): 군단장. 한도 = 군단장 레벨/10 + 100. 해고는 RMS_ARMY_REMOVEARMYMEMBER Kind 1
  hire(p, who, fire) {
    who = String(who || '').trim(); const id = this.idOf(p.name, true), a = this.db.armies[id];
    if (!a) { this.msg(p, 0xdb); return; }
    if (a.commander !== p.name) { this.msg(p, 0xf1); return; }
    if (fire) {
      const m = this.db.members[who]; if (!m || m.army !== id) return;
      delete this.db.members[who]; this.addSanction(who); this.save();
      this.mail(who, 'Dismiss New Soldier', `${a.commander} Commander(Lieutenant)${a.name} You have been dismissed.\nFor more information, contact the appropriate\nArmy Commander or Lieutenant.`);
      this.msg(p, 0x10c, who); const q = this.game.findOnline(who); if (q) this.sendBadge(q); return;
    }
    if (this.idOf(who)) { this.msg(p, 0xd8); return; }
    if (this.count(id) >= Math.floor(p.level / 10) + 100) { this.msg(p, 0x26); return; }
    if (this.sanctioned(who)) { this.msg(p, 0x164, who); return; }
    const q = this.game.findOnline(who); if (!q) return;
    (q.armyAsk ||= {})[p.name] = 'reg';
    q.send({ t: 'army', w: 'askjoin', army: a.name, commander: p.name });
  }
  // 대답 (ProcessAnswerJoinArmy 0x419b80)
  hireAnswer(p, commander, yes) {
    commander = String(commander || ''); if (!p.armyAsk || p.armyAsk[commander] !== 'reg') return; delete p.armyAsk[commander];
    if (!yes) { const c = this.game.findOnline(commander); if (c) this.msg(c, 0xd9, p.name); return; }
    if (this.idOf(p.name)) { this.msg(p, 0xd7); return; }
    const id = this.idOf(commander, true), a = this.db.armies[id]; if (!a || a.commander !== commander) return;
    if (this.count(id) >= Math.floor(this.levelOf(commander) / 10) + 100) { this.msg(p, 0x26); return; }
    this.db.members[p.name] = { army: id, joined: Date.now() }; this.save();
    this.msg(p, 0x44, a.name); this.sendBadge(p);
  }
  // 탈퇴 (ProcessWithdrawalFromArmy 0x419320): 군단장은 못 한다 (0x10b). 7일 재가입 제한
  withdraw(p) {
    const id = this.idOf(p.name, true), a = this.db.armies[id];
    if (!a) { this.msg(p, 0xdb); return; }
    if (a.commander === p.name) { this.msg(p, 0x10b); return; }
    delete this.db.members[p.name]; this.addSanction(p.name); this.save();
    this.msg(p, 0x10c, p.name); this.sendBadge(p);
  }
  // 해산 (ProcessBreakUpArmy 0x419190, RMS_ARMY_BREAKUPARMY Kind 1): 모두에게 우편, 모두 7일 재가입 제한
  breakUp(p) {
    const id = this.idOf(p.name, true), a = this.db.armies[id];
    if (!a) { this.msg(p, 0xdb); return; }
    if (a.commander !== p.name) { this.msg(p, 0x1e); return; }
    const text = `${a.name} Army Commander ${a.commander}\nhas ordered the disbandment of the army.\n${a.name} Army has been disbanded.`;
    const people = [...this.members(id), a.commander], on = this.online(id);
    for (const n of people) { this.mail(n, 'Army Disbandment', text); this.addSanction(n); }
    this.remove(id); this.save();
    for (const w of this.game.worlds.values()) for (const q of w.players.values()) this.msg(q, 0x2b, a.name);   // BroadcastBreakUpArmy
    for (const q of on) this.sendBadge(q);
  }
  // 군단 대화 (ProcessArmyChat 0x4417a0): 5초에 세 번, "이름 : 글", 대화 종류 5 를 같은 군단 모두에게
  chat(p, text) {
    text = String(text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120);
    const id = this.idOf(p.name, true); if (!text) return;
    if (!id) { this.msg(p, 0xdb); return; }
    if (!p.world.rateOk(p, 'armyChatAt', 5000)) return;
    for (const q of this.online(id)) q.send({ t: 'chat', id: p.id, name: p.name, text, kind: 'army' });
  }
  // 내 군단 이름 (머리 위·정보용)
  sendBadge(p) { const id = this.idOf(p.name, true), a = this.db.armies[id]; p.send({ t: 'army', w: 'badge', name: a ? a.name : '', mark: a ? a.mark : 0 }); }

  // 시간 지난 예비 군단 (RMS_ARMY_BREAKUPRESERVEARMY TimeOut=1): 모두에게 우편
  tick(now) {
    if (now < (this.nextTick || 0)) return; this.nextTick = now + 60000;
    let ch = false;
    for (const [k, a] of Object.entries(this.db.armies)) {
      if (a.state !== STATE.RESERVE || a.activity > now) continue;
      const text = 'Hello.  This is the army administrator.  \nWe regret to inform you that you have been\nunsuccessful in assembling the required core\nmemebers of your army in the given period of\ntime.  Please try again.';
      for (const n of [...this.members(Number(k)), a.commander]) this.mail(n, 'Pending Army Formation', text);
      this.remove(Number(k)); ch = true;
    }
    if (ch) this.save();
  }
}
module.exports = { Army, STATE };
