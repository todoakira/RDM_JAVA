'use strict';
// 군단(Army). 원작 서버 svMapServer.exe(3944판)의 Process*Army* 와 rmDB.dll CArmy, DB 프로시저 RMS_ARMY_* 를 옮겼다. 자세한 근거는 docs/army_notes.md.
// 지금 있는 것: 예비 군단(Free Agent Army) 목록·찾기·만들기·상세·핵심 멤버로 들기·해산, 군단 만들기(이름·비밀번호·문장, 핵심 멤버 초대·빼기, 마침·취소),
//   군단 정보, 병사 모집·대답·해고, 탈퇴, 해산, 공지, 군단 대화.
// 아직 없는 것: 부대(부관), 권한, 비밀번호 바꾸기, 군단장 넘기기, 동맹, 전쟁, 홀(아지트)·금고·본부·상점 세금, 용병.
const fs = require('fs');
const path = require('path');
const F = require('./formulas');
const { sameIIS, iisOf, iisX } = require('./iis');

const ROOT = path.join(__dirname, '..');
const DAY = 24 * 3600 * 1000;
const MAX_RESERVE = 100, MAX_ARMY = 100, MAX_INIT = 50, MIN_FORM = 11;   // 0x64, 0x65, 0x32, 0xb
const STATE = { RESERVE: -1, FROM_RESERVE: -2, DIRECT: -3, ACTIVE: 1 };

class Army {
  constructor(game) {
    this.game = game;
    try { this.db = JSON.parse(fs.readFileSync(path.join(ROOT, 'save', 'army.json'), 'utf8')); } catch (e) { this.db = {}; }
    this.db.seq ||= 0; this.db.armies ||= {}; this.db.members ||= {}; this.db.sanction ||= {}; this.db.subs ||= {}; this.db.alliance ||= {}; this.db.agits ||= {}; this.db.base ||= { owner: 0, tax: 0, gain: 0 }; this.db.agitLost ||= {};
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

  // ---- 아지트 (rmServer.ini [MapServer] AgitBase1=48 AgitBase2=110 AgitCount=20 ArmyBase=131, LoadAgitInfo 0x446420)
  //   아지트 1~20 은 맵 48~67 (진영 1), 21~40 은 맵 110~129 (진영 2). 군단 기지는 맵 131. 대전장(180~188)에서는 아지트가 아니다
  agitNo(mapId) {
    if (mapId >= 0xb4 && mapId <= 0xbc) return -1;
    const a = mapId - 48 + 1, b = mapId - 110 + 21;
    if (a > 0 && a <= 20) return a; if (b >= 21 && b <= 40) return b; return -1;
  }
  agitMap(n) { return n >= 1 && n <= 20 ? 48 - 1 + n : n >= 21 && n <= 40 ? 110 - 21 + n : -1; }
  isBase(w) { return w.mapId === 131; }
  defPos(map) { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'default_pos.json'), 'utf8'))[map]; } catch { return null; } }
  agitOwner(n) { const g = this.db.agits[n]; return g ? g.army : 0; }
  isAgitOwner(id, n) { return id > 0 && this.agitOwner(n) === id; }               // CArmy::IsAgitOwner ("ArmyID=%d AND AgitNumber=%d")
  isBaseOwner(id) { return id > 0 && this.db.base.owner === id; }
  agitCount(id) { return Object.values(this.db.agits).filter(g => g.army === id).length; }   // GetArmyAgitCount
  // 진영의 아지트가 상대 진영에게 11 개 넘게 빼앗겼는가 (IsAgitClosureState 0x1000eb60: 진영 1 은 21~40 이 아닌 1~20 중 진영 2 군단 것, 반대도 같다)
  closed(camp) {
    const lo = camp === 1 ? 0 : 20, other = camp === 1 ? 2 : 1;
    return Object.entries(this.db.agits).filter(([n, g]) => n > lo && n <= lo + 20 && this.db.armies[g.army] && this.db.armies[g.army].camp === other).length > 10;
  }
  // 아지트 빌리기 가능: 최근 하루 안에 '전쟁에 져서 아지트를 모두 잃음' 기록이 없을 것 (IsRentEmptyAgitAvailable 0x10022000)
  rentAvailable(id) { const t = this.db.agitLost[id]; return !(t && Date.now() - t < DAY); }
  // 세율 (GetArmyAgitTax: tblArmyBase.AgitTaxRate). 기지를 같은 진영이 가졌으면 반, 상대 진영이면 두 배 (ProcessClickEmptyAgit 0x418a30)
  rentCost(camp) {
    let tax = this.db.base.tax || 0;
    if (tax > 0) { const o = this.db.armies[this.db.base.owner]; if (o && o.camp) tax = o.camp === camp ? Math.floor(tax / 2) : tax * 2; }
    const lang1 = this.game.lang === 1 || this.game.lang === undefined;   // rmServer.ini Lang=1
    const dep = lang1 ? 50000000 : 500000000, rent = lang1 ? 10000000 : 100000000;
    return { deposit: dep + Math.floor(dep / 100) * tax, rent: rent + Math.floor(rent / 100) * tax, taxPart: Math.floor(dep / 100) * tax + Math.floor(rent / 100) * tax };
  }
  // 빈 아지트를 누름 → 비용 알림 0x789 (ProcessClickEmptyAgit) / 빌리기 (ProcessRentEmptyAgit 0x418ca0). 번호는 진영 안 번호 1~20
  agitCheck(p, local) {
    const camp = this.side(p.world), n = local - 20 + camp * 20; if (!camp) return null;
    const id = this.idOf(p.name, true), a = this.db.armies[id];
    if (!a) { this.msg(p, 0xdb); return null; }
    if (this.agitOwner(n)) return null;
    if (a.camp !== camp) { this.msg(p, 0xee); return null; }
    if (!this.permitted(p.name, id, 0x20)) { this.msg(p, 0x101); return null; }
    if (this.closed(camp)) { this.msg(p, 0x112); return null; }
    if (this.agitCount(id) > 0) { this.msg(p, 0x113); return null; }
    if (!this.rentAvailable(id)) { this.msg(p, 0x17f, 24); return null; }
    return { id, a, n, cost: this.rentCost(camp) };
  }
  agitClick(p, local) { const c = this.agitCheck(p, local); if (c) p.send({ t: 'army', w: 'agitrent', n: local, deposit: c.cost.deposit, rent: c.cost.rent }); }
  agitRent(p, local) {
    const c = this.agitCheck(p, local); if (!c) return;
    const total = c.cost.deposit + c.cost.rent;
    if (p.money < total) { this.msg(p, 0x30, c.cost.deposit, c.cost.rent); return; }
    p.money -= total; this.game.sendStat(p); this.game.sendInv(p);
    const now = Date.now(), exp = new Date(now); exp.setMonth(exp.getMonth() + 1);   // RMS_ARMY_RENTEMPTYAGIT: 만료 = 한 달 뒤
    this.db.agits[c.n] = { army: c.id, begin: now, exp: exp.getTime(), money: [0, 0, 0], items: {} };
    if (c.cost.taxPart) this.db.base.gain = (this.db.base.gain || 0) + c.cost.taxPart;   // AddArmyBaseGain
    this.save(); this.msg(p, 0x31, c.cost.deposit, c.cost.rent, local);
  }
  // NPC 종류 12~16 (ProcessEvent 0x420c10~0x420cc5)
  npc(p, kind) {
    const id = this.idOf(p.name, true), w = p.world;
    if (kind === 12) {                                                  // 아지트 고르기 (SendOpenSelectAgit 0x411dc0)
      const camp = this.side(w); if (!camp) return;
      const list = [];
      for (let k = 1; k <= 20; k++) { const n = k - 20 + camp * 20, g = this.db.agits[n], a = g && this.db.armies[g.army]; list.push(a ? { n: k, name: a.name, mark: a.mark, commander: a.commander } : { n: k }); }
      const bo = this.db.armies[this.db.base.owner];
      p.send({ t: 'army', w: 'selectagit', list, base: bo ? { name: bo.name, mark: bo.mark, commander: bo.commander } : null }); return;
    }
    if (kind >= 13 && kind <= 15) {
      if (!(id > 0)) { this.msg(p, 0x32); return; }
      const n = this.agitNo(w.mapId), own = this.isBase(w) ? this.isBaseOwner(id) : n > 0 && this.isAgitOwner(id, n);
      if (kind === 15) { if (!own) { this.msg(p, 0x32); return; } p.send({ t: 'army', w: 'agitcomputer' }); return; }   // 0x725: 관리 로그인
      if (kind === 13) { if (n < 0 && !this.isBase(w)) return; if (!own) { this.msg(p, 0x32); return; } this.safeOpen(p); return; }   // 금고 0x767
      if (kind === 14) { if (!own) { this.msg(p, 0x32); return; } this.game.board.open(p, this.isBase(w) ? 0x33 : n + 10); return; }   // 군단 게시판
    }
    if (kind === 16) {                                                  // 아지트로 가기 (+0x4348 ≥ 5000, SendOpenGoAgit 0x797)
      if (!(id > 0)) { this.msg(p, 0xdb); return; }
      p.send({ t: 'army', w: 'goagit' });
    }
  }
  safeOpen(p) { p.send({ t: 'army', w: 'safe' }); }                      // 0x767: 금고 메뉴 (ia-z28-ba)
  // 금고 자리: 아지트 번호, 기지는 100 (ProcessClickArmySafeMoney 0x417620)
  safeOf(p) {
    const id = this.idOf(p.name, true); if (!(id > 0)) return null;
    const w = p.world, n = this.agitNo(w.mapId), k = n >= 1 ? n : this.isBase(w) ? 100 : 0; if (!k) return null;
    const own = k === 100 ? this.isBaseOwner(id) : this.isAgitOwner(id, k);
    let g = k === 100 ? (this.db.base.safe ||= { money: [0, 0, 0], items: {} }) : this.db.agits[k];
    return { id, k, own, g };
  }
  safeBusy(p) { if (p.pshop) { this.msg(p, 0xa0); return true; } if (p.growing) { this.msg(p, 0x182); return true; } return false; }
  safeMoney(p) { const s = this.safeOf(p); if (!s) return; if (!s.own) { this.msg(p, 0xe0); return; } p.send({ t: 'army', w: 'safemoney', money: s.g.money }); }   // 0x769
  safeItems(p) { const s = this.safeOf(p); if (!s) return; if (!s.own) { this.msg(p, 0xe0); return; } this.sendSafeItems(p, s.g); }        // 0x76b + 0x771
  sendSafeItems(p, g) {
    const view = (i, e) => { const f = this.game.itemInfo(e.k, e.i); return { slot: +i, k: e.k, i: e.i, n: e.n, name: f ? f.name : '?', desc: f ? f.desc || '' : '', icon: f ? f.icon : 0 }; };
    p.send({ t: 'army', w: 'safeitems', items: Object.entries(g.items).map(([i, e]) => view(i, e)) });
  }
  // 넣기 (ProcessAddArmySafeMoney 0x417900): 칸 1~3, 칸마다 40억까지 (CArmy::AddAgitSafeMoney). 빼기는 권한 8 (ProcessGetArmySafeMoney 0x417b30)
  safeMoneyMove(p, slot, n, put) {
    slot |= 0; n = Math.floor(Number(n)); if (this.safeBusy(p) || slot < 1 || slot > 3 || !(n >= 1)) return;
    const s = this.safeOf(p); if (!s) return; if (!s.own) { this.msg(p, 0x1e); return; }
    const M = 4000000000, have = Math.min(p.money, M), m = s.g.money;
    if (put) { n = Math.min(n, have, M - m[slot - 1]); if (n < 1) return; m[slot - 1] += n; p.money = have - n; }
    else {
      if (!this.permitted(p.name, s.id, 8)) { this.msg(p, 0x101); return; }
      n = Math.min(n, M - have, m[slot - 1]); if (n < 1) return; m[slot - 1] -= n; p.money = have + n;
    }
    this.game.sendInv(p); this.game.save(p); this.save();
    p.send({ t: 'army', w: 'safemoneyset', slot, money: m[slot - 1] });   // 0x76d
  }
  // 물건 넣기 (ProcessAddArmySafeItem 0x417d80): 종류 6 은 0x92. 같은 물건이 있으면 그 칸에 더하고, 없으면 빈 칸 (100 칸, GetEmptySafeIndex)
  safeItemPut(p, slot, n) {
    n = Math.floor(Number(n)); if (this.safeBusy(p) || !(n >= 1)) return;
    const s = this.safeOf(p); if (!s) return; if (!s.own) { this.msg(p, 0x1e); return; }
    const it = p.inv[slot | 0]; if (!it) return;
    if (it.k === 6) { this.msg(p, 0x92); return; }
    n = Math.min(n, it.n);
    let idx = Object.keys(s.g.items).find(i => sameIIS(s.g.items[i], it));
    if (idx === undefined) { for (let i = 0; i < 100; i++) if (!s.g.items[i]) { idx = i; break; } if (idx === undefined) return; s.g.items[idx] = iisOf(it, 0); }
    const b = s.g.items[idx]; n = Math.min(n, 4000000000 - b.n); if (n < 1) return;
    b.n += n; it.n -= n; if (it.n <= 0) p.inv.splice(slot | 0, 1);
    this.game.sendInv(p); this.game.sendStat(p); this.game.save(p); this.save(); this.sendSafeItems(p, s.g);
  }
  // 물건 빼기 (ProcessGetArmySafeItem 0x418040): 권한 4. 들지 못한 만큼은 금고에 남는다
  safeItemGet(p, idx, n) {
    n = Math.floor(Number(n)); if (this.safeBusy(p) || !(n >= 1)) return;
    const s = this.safeOf(p); if (!s) return; if (!s.own) { this.msg(p, 0x1e); return; }
    if (!this.permitted(p.name, s.id, 4)) { this.msg(p, 0x101); return; }
    const b = s.g.items[idx | 0]; if (!b) return;
    const took = this.game.giveItem(p, b.k, b.i, Math.min(n, b.n), iisX(b)); if (!took) return;
    b.n -= took; if (b.n <= 0) delete s.g.items[idx | 0];
    this.game.save(p); this.save(); this.sendSafeItems(p, s.g);
  }
  // 임대료 내기 (ProcessPayAgitRentCost 0x416c60/0x416df0): 군단장이나 권한 0x20. 만료 5 일 안의 아지트마다
  //   임대료(+세)를 금고 돈 칸 1→3 순서로 빼고 만료를 한 달 늘린다. 금고 돈이 모자라면 0x107 (금액, 아지트)
  payRent(p) {
    const id = this.idOf(p.name, true); if (!(id > 0)) { this.msg(p, 0x101); return; }
    if (!this.permitted(p.name, id, 0x20)) { this.msg(p, 0x101); return; }
    const own = Object.keys(this.db.agits).filter(n => this.db.agits[n].army === id).map(Number);
    if (!own.length) { this.msg(p, 0x101); return; }
    const a = this.db.armies[id]; let paid = false;
    for (const n of own) {
      const g = this.db.agits[n]; if (!(g.exp <= Date.now() + 5 * DAY)) continue;
      const c = this.rentCost(a.camp), cost = c.rent, taxPart = cost - (this.game.lang === 1 || this.game.lang === undefined ? 10000000 : 100000000);
      if (g.money[0] + g.money[1] + g.money[2] < cost) { this.msg(p, 0x107, cost, n); continue; }
      let left = cost; for (let i = 0; i < 3 && left > 0; i++) { const t = Math.min(left, g.money[i]); g.money[i] -= t; left -= t; }
      const e = new Date(g.exp); e.setMonth(e.getMonth() + 1); g.exp = e.getTime();   // RMS_ARMY_EXTENDAGITEXPIRATION
      if (taxPart > 0) this.db.base.gain = (this.db.base.gain || 0) + taxPart;
      this.msg(p, 0x36); this.msg(p, 0x16d, n); paid = true;
    }
    this.save(); if (!paid) this.msg(p, 0xed);
  }
  // 아지트 돌려주기 (ProcessRestoreAgit 0x416fd0): 아지트 안에서, 전쟁 중이 아닐 것. 보증금 5천만 (Lang=1) 을 돌려받는다.
  //   RMS_ARMY_REMOVEAGIT Kind=2: 금고까지 지우고 군단 활동 기간을 지금부터 한 달로
  restoreAgit(p) {
    const id = this.idOf(p.name, true);
    if (!(id > 0) || !this.agitCount(id)) { this.msg(p, 0x101); return; }
    if (!this.permitted(p.name, id, 0x20)) { this.msg(p, 0x101); return; }
    const n = this.agitNo(p.world.mapId); if (n < 0) { this.msg(p, 0x127); return; }
    if (!this.isAgitOwner(id, n)) { this.msg(p, 0x101); return; }
    if (this.atWar && this.atWar(id)) { this.msg(p, 0x3e); return; }
    delete this.db.agits[n];
    const a = this.db.armies[id], e = new Date(); e.setMonth(e.getMonth() + 1); a.activity = e.getTime();
    const back = this.game.lang === 1 || this.game.lang === undefined ? 50000000 : 500000000;
    p.money = Math.min(4000000000, p.money + back); this.game.sendInv(p); this.game.save(p); this.save();
    this.msg(p, 0x37, back);
  }
  // 자유군 활동비 (ProcessPayArmyActivityCost 0x418fa0): 같은 진영 컴퓨터에서 군단장만. 활동 기간이 5 일 안에 끝날 때
  //   10만 (Lang=1, 아니면 100만) 을 내고 한 달 늘린다 (RMS_ARMY_EXTENDACTIVITYDURATION). 아니면 0x108, 돈이 모자라면 0x109
  payActivity(p) {
    const id = this.idOf(p.name, true); if (!(id > 0)) { this.msg(p, 0xdb); return; }
    const a = this.db.armies[id]; if (a.camp !== this.side(p.world)) { this.msg(p, 0xee); return; }
    if (a.commander !== p.name) { this.msg(p, 0x1e); return; }
    if (!(a.activity < Date.now() + 5 * DAY)) { this.msg(p, 0x108); return; }
    const cost = this.game.lang === 1 || this.game.lang === undefined ? 100000 : 1000000;
    if (p.money < cost) { this.msg(p, 0x109); return; }
    p.money -= cost; const e = new Date(a.activity); e.setMonth(e.getMonth() + 1); a.activity = e.getTime();
    this.game.sendInv(p); this.game.save(p); this.save(); this.msg(p, 0x10a);
  }
  // 아지트로 가기 (ProcessGoArmyAgit 0x41a270): 0 = 기지, 1~20 = 진영 아지트. 들어갈 수 있으면 (13,13), 기지는 기본 자리
  goAgit(p, k) {
    k |= 0; if (k < 0 || k > 20) return;
    const camp = this.side(p.world) || (this.db.armies[this.idOf(p.name, true)] || {}).camp; if (!camp) return;
    const n = k === 0 ? 100 : k - 20 + camp * 20, map = k === 0 ? 131 : this.agitMap(n), id = this.idOf(p.name, true);
    const w = p.world; if (w.mapId >= 0xb4 && w.mapId <= 0xbc) return;
    let can = 0;
    if (id > 0) can = n === 100 ? (this.isBaseOwner(id) ? 1 : 0) : this.isAgitOwner(id, n) ? 1 : 0;   // 전쟁 중 상대 입장은 전쟁을 옮길 때 (CArmyManager::CanEnterAgit 0x403640)
    if (can !== 1) { this.msg(p, 0x23); return; }
    if (n === 100) { const d = this.defPos(map); if (d) this.game.gotoMap(p, map, d[0], d[1]); } else this.game.gotoMap(p, map, 13, 13);
  }

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
