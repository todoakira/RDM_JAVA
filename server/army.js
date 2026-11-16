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
    this.db.seq ||= 0; this.db.armies ||= {}; this.db.members ||= {}; this.db.sanction ||= {}; this.db.subs ||= {}; this.db.alliance ||= {};
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
  remove(id) { this.leaveAlliance(id); delete this.db.armies[id]; for (const n of this.members(id)) delete this.db.members[n]; for (const l of Object.keys(this.db.subs)) if (this.db.subs[l].army === id) delete this.db.subs[l]; }

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
    const m = this.db.members[p.name], lt = this.db.subs[p.name] ? p.name : m && m.sub, sub = lt && this.db.subs[lt];
    p.send({ t: 'army', w: 'info', name: a.name, commander: a.commander, notice: a.notice, mark: a.mark, camp: a.camp, me: a.commander === p.name ? 'cmd' : 'reg',
      lt: sub ? lt : '', unit: sub ? sub.name : '', unitNotice: sub ? sub.notice : '',
      allies: this.allyMembers(id).filter(k => k !== id).map(k => this.db.armies[k] && this.db.armies[k].name).filter(Boolean) });
  }
  // 멤버 (ProcessClickArmyMemberInfo 0x4171a0): 군단장, 병사
  memberList(p) {
    const id = this.idOf(p.name, true), a = this.db.armies[id]; if (!a) { this.msg(p, 0x101); return; }
    const lts = this.subsOf(id);
    p.send({ t: 'army', w: 'members', commander: a.commander, lts, members: this.members(id).filter(n => !lts.includes(n)) });
  }
  // 관리 로그인 (ProcessArmyManagementLogin 0x4137b0): 군단장 비밀번호. 맞으면 관리 창
  login(p, password) {
    const id = this.idOf(p.name, true), a = this.db.armies[id];
    if (!a) { this.msg(p, 0xdb); return; }
    const side = this.side(p.world); if (side && a.camp !== side) { this.msg(p, 0xee); return; }
    // CArmy::ProcessArmyPassword: 군단장은 군단 비밀번호, 부관은 부대 비밀번호. 1 = 군단장, 2 = 부관
    const sub = this.db.subs[p.name];
    const kind = a.commander === p.name && a.password === String(password || '') ? 1 : sub && sub.army === id && sub.password === String(password || '') ? 2 : 0;
    if (!kind) { this.msg(p, 0x1f); return; }
    p.armyLogin = id; p.send({ t: 'army', w: 'manage', kind });
  }
  // 공지 (ProcessRewriteNotice 0x413900, ProcessFinishRewriteNotice 0x413a90)
  notice(p, text, kind) {
    const id = this.idOf(p.name, true), a = this.db.armies[id];
    if (!a) { this.msg(p, 0xdb); return; }
    let o = a;
    if (kind === 2) { o = this.db.subs[p.name]; if (!o || o.army !== id) { this.msg(p, 0xdf, p.name); return; } }   // 부대 공지: 부관만
    else if (a.commander !== p.name) { this.msg(p, 0x1e); return; }
    if (text === undefined) { p.send({ t: 'army', w: 'notice', text: o.notice, kind: kind === 2 ? 2 : 1 }); return; }
    o.notice = String(text).slice(0, 62); this.save(); p.send({ t: 'army', w: 'noticed' });
  }
  // 병사 모집 (ProcessArmyEmployment 0x4197f0): 군단장. 한도 = 군단장 레벨/10 + 100. 해고는 RMS_ARMY_REMOVEARMYMEMBER Kind 1
  hire(p, who, fire) {
    who = String(who || '').trim(); const id = this.idOf(p.name, true), a = this.db.armies[id];
    if (!a) { this.msg(p, 0xdb); return; }
    if (!this.permitted(p.name, id, 1)) { this.msg(p, 0xf1); return; }
    if (fire) {
      const m = this.db.members[who]; if (!m || m.army !== id) return;
      delete this.db.members[who]; this.addSanction(who); this.save();
      this.mail(who, 'Dismiss New Soldier', `${a.commander} Commander(Lieutenant)${a.name} You have been dismissed.\nFor more information, contact the appropriate\nArmy Commander or Lieutenant.`);
      this.msg(p, 0x10c, who); const q = this.game.findOnline(who); if (q) this.sendBadge(q); return;
    }
    if (this.idOf(who)) { this.msg(p, 0xd8); return; }
    if (this.count(id) >= Math.floor(this.levelOf(a.commander) / 10) + 100) { this.msg(p, 0x26); return; }
    if (this.sanctioned(who)) { this.msg(p, 0x164, who); return; }
    const q = this.game.findOnline(who); if (!q) return;
    (q.armyAsk ||= {})[p.name] = 'reg';
    q.send({ t: 'army', w: 'askjoin', army: a.name, commander: p.name });
    q.armyHireBy = id;
  }
  // 대답 (ProcessAnswerJoinArmy 0x419b80)
  hireAnswer(p, commander, yes) {
    commander = String(commander || ''); if (!p.armyAsk || p.armyAsk[commander] !== 'reg') return; delete p.armyAsk[commander];
    if (!yes) { const c = this.game.findOnline(commander); if (c) this.msg(c, 0xd9, p.name); return; }
    if (this.idOf(p.name)) { this.msg(p, 0xd7); return; }
    const id = this.idOf(commander, true), a = this.db.armies[id]; if (!a || !this.permitted(commander, id, 1)) return;
    if (this.count(id) >= Math.floor(this.levelOf(a.commander) / 10) + 100) { this.msg(p, 0x26); return; }
    this.db.members[p.name] = { army: id, joined: Date.now() }; this.save();
    this.msg(p, 0x44, a.name); this.sendBadge(p);
  }
  // 탈퇴 (ProcessWithdrawalFromArmy 0x419320): 군단장은 못 한다 (0x10b). 7일 재가입 제한
  withdraw(p) {
    const id = this.idOf(p.name, true), a = this.db.armies[id];
    if (!a) { this.msg(p, 0xdb); return; }
    if (a.commander === p.name) { this.msg(p, 0x10b); return; }
    if (this.db.subs[p.name]) this.removeSub(p.name, 0);       // RMS_ARMY_REMOVEARMYMEMBER: 부관이면 부대부터 없앤다
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

  // ---- 군단장 관리·부관·부대 (3단계)
  subsOf(id) { return Object.keys(this.db.subs).filter(l => this.db.subs[l].army === id); }
  // CheckArmyPermission 0x4120f0: 군단장이거나, 권한 비트가 있는 부관 (1 모집, 2 용병, 4 아이템, 8 돈, 16 구매, 32 홀)
  permitted(name, id, bit) { const a = this.db.armies[id]; if (a && a.commander === name) return true; const s = this.db.subs[name]; return !!(s && s.army === id && (s.perm & bit)); }
  cmdArmy(p) { const id = this.idOf(p.name, true), a = this.db.armies[id]; if (!a) { this.msg(p, 0xdb); return [0, null]; } if (a.commander !== p.name) { this.msg(p, 0x1e); return [0, null]; } return [id, a]; }
  // 군단장 비밀번호 바꾸기 (ProcessChangeCommanderPassword 0x416330 → 0x757)
  cmdPassword(p, pw) {
    pw = String(pw || '').slice(0, 10); if (!pw) return;
    const [, a] = this.cmdArmy(p); if (!a) return;
    a.password = pw; this.save(); p.send({ t: 'army', w: 'pwchanged' });
  }
  // 군단장 넘기기 (ProcessChangeArmyCommander 0x416450): 같은 군단 병사에게 0/0/0x15c 질문
  transfer(p, who) {
    who = String(who || '').trim(); if (!who) return;
    if (who === p.name) { this.msg(p, 0x29); return; }
    const [id, a] = this.cmdArmy(p); if (!a) return;
    if (this.idOf(who, true) !== id) { this.msg(p, 0xdb); return; }
    const q = this.game.findOnline(who); if (!q) { this.msg(p, 0xf7, who); return; }
    (q.armyAsk ||= {})[p.name] = 'cmd'; q.send({ t: 'army', w: 'askcmd', army: a.name, commander: p.name });
  }
  // 대답 (ProcessResultAskChangeCommander 0x4165e0): 받으면 새 군단장 자격·한도를 보고 RMS_ARMY_CHANGEARMYCOMMANDER (모두에게 우편)
  transferAnswer(p, commander, yes, password) {
    commander = String(commander || ''); if (!p.armyAsk || p.armyAsk[commander] !== 'cmd') return; delete p.armyAsk[commander];
    const id = this.idOf(p.name, true), a = this.db.armies[id]; if (!a || a.commander !== commander) return;
    const c = this.game.findOnline(commander);
    if (!yes) { if (c) this.msg(c, 0x56, p.name); return; }
    if (!this.license(p)) return;
    if (this.count(id) > Math.floor(p.level / 10) + 100) { this.msg(p, 0xff); return; }
    password = String(password || '').slice(0, 10); if (!password) return;
    const from = a.commander, joined = a.created;
    if (this.db.subs[p.name]) this.removeSub(p.name, 1);
    delete this.db.members[p.name];
    a.commander = p.name; a.password = password;
    this.db.members[from] = { army: id, joined, sub: this.db.subs[from] ? from : '' };
    const text = `${a.name} Army Commander ${from}\nhas entrusted his position to ${p.name}.\nFor more information, contact the appropriate\nArmy Commander.`;
    for (const n of [...this.members(id), p.name]) this.mail(n, 'Commander Change', text);
    this.save(); if (c) this.msg(c, 0x41, p.name); this.msg(p, 0x41, p.name);
  }
  // 부관 임명·해임 (ProcessAppointSubCommander 0x413ce0): 부대는 다섯까지 (0xf2). 임명은 상대에게 0/0/0x195 질문, 대답에 부대 이름·비밀번호
  appoint(p, who, on) {
    who = String(who || '').trim(); const [id, a] = this.cmdArmy(p); if (!a) return;
    if (this.idOf(who, true) !== id || who === p.name) { this.msg(p, 0xdb); return; }
    if (!on) {
      if (!this.db.subs[who]) { this.msg(p, 0xdf, who); return; }
      this.removeSub(who, 1); this.save(); this.msg(p, 0xf4, who); return;
    }
    if (this.db.subs[who]) { this.msg(p, 0xde, who); return; }
    if (this.subsOf(id).length >= 5) { this.msg(p, 0xf2); return; }
    const q = this.game.findOnline(who); if (!q) { this.msg(p, 0xf7, who); return; }
    (q.armyAsk ||= {})[p.name] = 'lt'; q.send({ t: 'army', w: 'asklt', army: a.name, commander: p.name });
  }
  // 대답 (ProcessSubArmyCreateInfo 0x413f40, RMS_ARMY_CREATESUBARMY: 부관이 이미 있으면 실패)
  appointAnswer(p, commander, yes, unit, password) {
    commander = String(commander || ''); if (!p.armyAsk || p.armyAsk[commander] !== 'lt') return; delete p.armyAsk[commander];
    const id = this.idOf(commander, true), a = this.db.armies[id], c = this.game.findOnline(commander);
    if (!a || a.commander !== commander || this.idOf(p.name, true) !== id) return;
    if (!yes) { if (c) this.msg(c, 0xd9, p.name); return; }
    unit = String(unit || '').trim().slice(0, 10); password = String(password || '').slice(0, 10);
    if (!unit || !password || this.db.subs[p.name]) return;
    if (this.subsOf(id).length >= 5) { if (c) this.msg(c, 0xf2); return; }
    if (this.subsOf(id).some(l => this.db.subs[l].name === unit)) { this.msg(p, 0xf6); return; }
    this.db.subs[p.name] = { army: id, name: unit, password, perm: 0, notice: '' };
    this.db.members[p.name].sub = p.name; this.save();
    if (c) this.msg(c, 0xf3, p.name); p.send({ t: 'army', w: 'ltdone' });
  }
  // 부관 바꾸기 (ProcessChangeSubCommander 0x414140): 부관 A 의 부대를 병사 B 에게. B 에게 0/0/0x196 질문, 대답에 비밀번호
  changeLt(p, from, to) {
    from = String(from || '').trim(); to = String(to || '').trim(); const [id, a] = this.cmdArmy(p); if (!a) return;
    if (this.idOf(from, true) !== id || this.idOf(to, true) !== id) { this.msg(p, 0xdb); return; }
    if (!this.db.subs[from]) { this.msg(p, 0xdf, from); return; }
    if (this.db.subs[to] || to === a.commander) { this.msg(p, 0xde, to); return; }
    const q = this.game.findOnline(to); if (!q) { this.msg(p, 0xf7, to); return; }
    (q.armyAsk ||= {})[p.name] = 'ltchange:' + from; q.send({ t: 'army', w: 'askltchange', unit: this.db.subs[from].name, from, commander: p.name });
  }
  // 대답 (ProcessSubArmyChangeInfo 0x414390, RMS_ARMY_CHANGESUBARMYCOMMANDER: 부대원에게 우편)
  changeLtAnswer(p, commander, yes, password) {
    commander = String(commander || ''); const k = p.armyAsk && p.armyAsk[commander]; if (!k || !k.startsWith('ltchange:')) return; delete p.armyAsk[commander];
    const from = k.slice(9), s = this.db.subs[from], id = this.idOf(p.name, true), a = this.db.armies[id], c = this.game.findOnline(commander);
    if (!s || s.army !== id || !a || a.commander !== commander) return;
    if (!yes) { if (c) this.msg(c, 0xd9, p.name); return; }
    password = String(password || '').slice(0, 10); if (!password || this.db.subs[p.name]) return;
    const text = `${a.commander} Commander ${a.name} Army's\nLieutenant ${from}${p.name}\nhas been changed to For more information contact\nthe appropriate Army Commander.`;
    for (const n of this.unitMembers(from)) this.mail(n, 'Unit Lieutenant Change', text);
    this.db.subs[p.name] = Object.assign(s, { password }); delete this.db.subs[from];
    for (const n of this.unitMembers(from)) this.db.members[n].sub = p.name;
    this.db.members[p.name].sub = p.name; if (this.db.members[from]) this.db.members[from].sub = '';
    this.save(); if (c) this.msg(c, 0xf5, from, p.name); this.msg(p, 0xf5, from, p.name);
  }
  unitMembers(lt) { return Object.keys(this.db.members).filter(n => n !== lt && this.db.members[n].sub === lt); }
  // 부대 없애기 (RMS_ARMY_REMOVESUBARMY): Kind 1 = 부관 해임, 0 = 부관이 부대 해산. 부대원에게 우편, 모두 일반 병사로
  removeSub(lt, kind) {
    const s = this.db.subs[lt], a = s && this.db.armies[s.army]; if (!s) return;
    const text = kind === 1
      ? `${a.commander}Commander ${a.name} from the\nArmy Lieutenant ${lt} has been\ndemoted.  All Unit members have become Free Agent\nsoldiers. For more information contact the\nappropriate Commander.`
      : `${a.commander} Commander ${a.name} Army Lieutenant${lt} has ordered to disband the unit.\nAll the members of this unit will become Regular\nSoldiers.  For more information, contact the\nappropriate Commander.`;
    for (const n of this.unitMembers(lt)) { this.mail(n, 'Disband Army Unit', text); this.db.members[n].sub = ''; }
    if (this.db.members[lt]) this.db.members[lt].sub = '';
    delete this.db.subs[lt];
  }
  // 권한 (ProcessRequestSubCommanderPermission 0x4146a0, ProcessChangeSubCommanderPermission 0x4147e0)
  getPerm(p, lt) {
    const [id, a] = this.cmdArmy(p); if (!a) return; lt = String(lt || '').trim();
    const s = this.db.subs[lt]; if (!s || s.army !== id) { this.msg(p, 0xdf, lt); return; }
    p.send({ t: 'army', w: 'perm', lt, perm: s.perm });
  }
  setPerm(p, lt, perm) {
    const [id, a] = this.cmdArmy(p); if (!a) return; lt = String(lt || '').trim();
    const s = this.db.subs[lt]; if (!s || s.army !== id) { this.msg(p, 0xdf, lt); return; }
    s.perm = (perm | 0) & 63; this.save(); p.send({ t: 'army', w: 'permdone' });
  }
  // 부관 비밀번호 (ProcessChangeSubCommanderPassword 0x414a30)
  ltPassword(p, pw) {
    pw = String(pw || '').slice(0, 10); const s = this.db.subs[p.name];
    if (!s || s.army !== this.idOf(p.name, true)) { this.msg(p, 0xdf, p.name); return; }
    if (!pw) return; s.password = pw; this.save(); p.send({ t: 'army', w: 'pwchanged' });
  }
  // 부대원 모집·내보내기 (ProcessSubArmyEmployment 0x419d80): 부관만. 같은 군단의 병사에게 0/0/0x159 질문
  unitHire(p, who, fire) {
    who = String(who || '').trim(); const id = this.idOf(p.name, true), s = this.db.subs[p.name];
    if (!id) { this.msg(p, 0xdb); return; }
    if (!s || s.army !== id) { this.msg(p, 0xdf, p.name); return; }
    if (this.idOf(who, true) !== id) { this.msg(p, 0xdb); return; }
    const m = this.db.members[who];
    if (fire) { if (m && m.sub === p.name) { m.sub = ''; this.save(); this.msg(p, 0x10e, who); } return; }   // RMS_ARMY_REMOVESUBARMYMEMBER Kind 1
    if (!m || this.db.subs[who] || m.sub) { this.msg(p, 0xd8); return; }
    const q = this.game.findOnline(who); if (!q) { this.msg(p, 0xf7, who); return; }
    (q.armyAsk ||= {})[p.name] = 'unit'; q.send({ t: 'army', w: 'askunit', unit: s.name, army: this.db.armies[id].name });
    q.armyAskUnitLt = p.name;
  }
  // 대답 (ProcessAnswerJoinSubArmy 0x419f10, RMS_ARMY_ADDSUBARMYMEMBER)
  unitAnswer(p, yes) {
    const lt = p.armyAskUnitLt; if (!lt || !p.armyAsk || p.armyAsk[lt] !== 'unit') return; delete p.armyAsk[lt];
    const s = this.db.subs[lt], m = this.db.members[p.name], c = this.game.findOnline(lt);
    if (!yes) { if (c) this.msg(c, 0xd9, p.name); return; }
    if (!s || !m || m.army !== s.army || this.db.subs[p.name] || m.sub) return;
    m.sub = lt; this.save(); this.msg(p, 0x10f, p.name); if (c) this.msg(c, 0x10f, p.name);
  }
  // 부대 탈퇴 (ProcessWithdrawalFromArmy 종류 2): 부관이면 부대 해산 (0x111), 부대원이면 나가기 (0x110, RMS_ARMY_REMOVESUBARMYMEMBER Kind 0 우편)
  unitQuit(p) {
    const m = this.db.members[p.name]; if (!m) { this.msg(p, 0xdb); return; }
    if (this.db.subs[p.name]) { this.removeSub(p.name, 0); this.save(); this.msg(p, 0x111); return; }
    if (!m.sub) return;
    const s = this.db.subs[m.sub], a = this.db.armies[m.army];
    if (s && a) this.mail(p.name, 'Army Lieutenant demotion', `${a.name} belongs to Army${m.sub} Lieutenant${s.name} has been dismissed from the Unit.\nFor more information, contact the appropriate\nArmy Lieutenant`);
    m.sub = ''; this.save(); this.msg(p, 0x110);
  }
  // 부대원 목록 (ProcessRequestSubArmyMemberInfo 0x417490 → 0x795)
  unitList(p, lt) {
    const id = this.idOf(p.name, true); lt = String(lt || ''); const s = this.db.subs[lt];
    if (!id || !s || s.army !== id) { this.msg(p, 0xdb); return; }
    p.send({ t: 'army', w: 'unit', lt, members: this.unitMembers(lt) });
  }

  // ---- 동맹 (4단계, ProcessClickRequestArmyAlliance 0x414b60 ~ ProcessBreakArmyAlliance 0x415430, RMS_ARMY_DOARMYALLIANCE·BREAKARMYALLIANCE)
  //   동맹 하나는 주인 군단(bHost) 하나와 군단 넷까지. 주인이 아닌 군단은 다른 군단을 끌어들일 수 없다 (0xe4)
  allyOf(id) { return this.db.alliance[id]; }
  allyMembers(id) { const a = this.db.alliance[id]; return a ? Object.keys(this.db.alliance).map(Number).filter(k => this.db.alliance[k].aid === a.aid) : []; }
  allyCount(id) { return this.allyMembers(id).length; }                       // GetAllianceCount
  allyAvailable(id) { const a = this.db.alliance[id]; return !a || a.host; }  // IsAllianceAvailable
  allyHost(id) { return this.allyMembers(id).find(k => this.db.alliance[k].host) || 0; }
  armyIdByName(name) { return this.byName(String(name || ''))[0]; }
  allyClick(p) {
    const [id] = this.cmdArmy(p); if (!id) return;
    if (!this.allyAvailable(id)) { this.msg(p, 0xe4, this.db.armies[this.allyHost(id)].name); return; }
    if (this.allyCount(id) > 4) { this.msg(p, 0xe5); return; }
    p.send({ t: 'army', w: 'allyask' });
  }
  // 동맹 신청: 같은 진영, 상대가 동맹이 없어야 (0x4b), 내 동맹은 다섯 미만 (0xe5). 상대 군단장에게 금액과 함께 0/0/0x15b 질문
  allyRequest(p, name, amount) {
    const tid = this.armyIdByName(name), t = this.db.armies[tid]; amount = Math.max(0, Math.min(4000000000, Math.floor(Number(amount)) || 0));
    const id = this.idOf(p.name, true); if (!id) { this.msg(p, 0xdb); return; }
    if (!t || t.state < 1) { this.msg(p, 0x3a, String(name || '')); return; }
    if (tid === id) return;
    const a = this.db.armies[id];
    if (a.camp !== t.camp) { this.msg(p, 0xee); return; }
    if (a.commander !== p.name) { this.msg(p, 0x1e); return; }
    if (!this.allyAvailable(id)) { this.msg(p, 0xe4, this.db.armies[this.allyHost(id)].name); return; }
    if (this.allyCount(tid) > 0) { this.msg(p, 0x4b, t.name); return; }
    if (this.allyCount(id) >= 5) { this.msg(p, 0xe5); return; }
    const q = this.game.findOnline(t.commander); if (!q) { this.msg(p, 0xf7, t.commander); return; }
    (q.armyAsk ||= {})[p.name] = 'ally'; q.armyAllyAmount = amount;
    q.send({ t: 'army', w: 'askally', commander: p.name, army: a.name, amount });
  }
  // 대답 (ProcessAnswerArmyAlliance 0x415050, SendResultAskAlliance 0x465450): 받으면 동맹을 맺고, 신청한 쪽이 돈이 있으면 그 금액을 넘긴다 (0x102), 없으면 0x43
  allyAnswer(p, commander, yes) {
    commander = String(commander || ''); if (!p.armyAsk || p.armyAsk[commander] !== 'ally') return; delete p.armyAsk[commander];
    const amount = p.armyAllyAmount || 0, c = this.game.findOnline(commander);
    const id = this.idOf(commander, true), tid = this.idOf(p.name, true), a = this.db.armies[id], t = this.db.armies[tid];
    if (!a || !t) { this.msg(p, 0xdb); return; }
    if (!c) { this.msg(p, 0xf7, commander); return; }
    if (!yes) { this.msg(c, 0x48, t.name, p.name); return; }
    if (a.camp !== t.camp) { this.msg(p, 0xee); return; }
    if (t.commander !== p.name) { this.msg(p, 0x1e); return; }
    if (!this.allyAvailable(id) || this.allyCount(tid) > 0 || this.allyCount(id) >= 5) return;
    const h = this.db.alliance[id];
    if (h) this.db.alliance[tid] = { aid: h.aid, host: false };
    else { const aid = (this.db.allySeq = (this.db.allySeq || 0) + 1); this.db.alliance[id] = { aid, host: true }; this.db.alliance[tid] = { aid, host: false }; }
    this.save();
    if (c.money >= amount) {
      c.money -= amount; p.money = Math.min(4000000000, p.money + amount); this.game.sendInv(c); this.game.sendInv(p);
      for (const w of this.game.worlds.values()) for (const q of w.players.values()) this.msg(q, 0x102, t.name, a.commander);   // BroadcastDoArmyAlliance
    } else this.msg(p, 0x43, a.name, amount);
  }
  allyBreakClick(p) {
    const [id] = this.cmdArmy(p); if (!id) return;
    if (this.allyCount(id) < 1) { this.msg(p, 0xf8); return; }
    p.send({ t: 'army', w: 'allybreak' });
  }
  // 동맹 깨기: 주인이면 그 군단을, 주인이 아니면 주인과의 동맹을 끊는다. 둘 다 주인이 아니면 0xfa. 동맹 군단장 모두에게 우편
  allyBreak(p, name) {
    const id = this.idOf(p.name, true), tid = this.armyIdByName(name);
    if (!id) { this.msg(p, 0xdb); return; }
    if (!tid) { this.msg(p, 0x3a, String(name || '')); return; }
    if (this.db.armies[id].commander !== p.name) { this.msg(p, 0x1e); return; }
    if (this.allyCount(id) < 1) { this.msg(p, 0xf8); return; }
    const same = this.allyOf(id) && this.allyOf(tid) && this.allyOf(id).aid === this.allyOf(tid).aid;
    if (!same) { this.msg(p, 0xf9, this.db.armies[tid].name); return; }
    let host, other;
    if (this.allyOf(id).host) { host = id; other = tid; } else if (this.allyOf(tid).host) { host = tid; other = id; }
    else { this.msg(p, 0xfa, this.db.armies[this.allyHost(id)].name); return; }
    this.breakAlly(host, other); this.save(); p.send({ t: 'army', w: 'allybroken' });
  }
  breakAlly(host, other) {
    const H = this.db.armies[host], O = this.db.armies[other];
    const text = `${H ? H.name : ''} Army/${O ? O.name : ''} Army\nAlliance has been dissolved.  Please contact\nthe commander for more information.`;
    for (const k of this.allyMembers(host)) if (this.db.armies[k]) this.mail(this.db.armies[k].commander, 'Army Alliance Dissolution', text);
    delete this.db.alliance[other];
    if (this.allyCount(host) === 1) delete this.db.alliance[host];
  }
  // 군단이 없어질 때: 주인이면 동맹 전체, 아니면 자기만 빠진다
  leaveAlliance(id) {
    const a = this.db.alliance[id]; if (!a) return;
    if (a.host) for (const k of this.allyMembers(id)) delete this.db.alliance[k];
    else { const h = this.allyHost(id); delete this.db.alliance[id]; if (h && this.allyCount(h) === 1) delete this.db.alliance[h]; }
  }

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
