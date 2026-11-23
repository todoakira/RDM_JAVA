'use strict';
// PK (사람끼리 싸우기)와 PK 벌칙. 근거는 docs/pk_notes.md
//  - PK 모드: 꺼짐 0 → 켜는 중 1 (5초) → 켜짐 2 (사용자 +0x37d0, 효과 비트 37 = +0x4028 & 0x20)
//    ProcessChangePKMode 0x41bb10, OnPKModeTimerExpired 0x42e6b0, SetPKModeOff 0x440090, SendChangePKMode 0x43a710
//  - 타일·맵 (IsPKOffTile 0x472c10, IsFightTile 0x472cf0, IsUserSafeTile 0x472ca0): 맵의 기본 이벤트(지역 이벤트 0)와 그 칸의 이벤트 종류
//  - 공격 (CMapServerServer::DoAttack 0x469dd0 의 사람 쪽): 정당방위 (CLegalDefenseManager, 5분)
//  - 죽음 (CMapServerClient::Dead 0x43b010): 기본 이벤트 종류 30 맵에서 벌칙 없는 사람을 정당방위 없이 죽이면 DoPKPenaltyAction 0x42d840
//  - 벌칙 시간 (OnTimer 0x43e131~0x43e26c)

const ARM_MS = 5000;                  // +0x40c4 = 5000
const LEGAL_MS = 300000;              // CExMapStringToPtr::Add(…, 0x493e0)
const OFF_KINDS = [7, 5, 0x12, 0x13];
const SAFE_KINDS = [5, 0x12];
const FIGHT_KIND = 0xa;
const PENALTY_KIND = 0x1e;            // 맵 기본 이벤트 [30, 벌칙 한 번의 시간 ms] (CMapServerServer 0x446375)
const JAIL = 0x4e;                    // 맵 78 감옥 (DungeonPrison)
const JAIL_FEE = 100000000;           // ProcessMoveJail 0x41c190
const MIN_LEVEL = 15;                 // 레벨 15 이하는 싸울 수 없다 (Lang 2·3·4 는 20. 여기 Lang=1)
// 벌칙 시간이 흐르지 않는 맵 (0x30~0x43, 0x6e~0x81, 0x82~0x83) 과 절반만 흐르는 감옥
const noTick = m => (m >= 0x30 && m <= 0x43) || (m >= 0x6e && m <= 0x81) || (m >= 0x82 && m <= 0x83);

class PK {
  constructor(game) { this.game = game; }
  msg(p, code, ...args) { this.game.story.msg(p, code, ...args); }

  // ---------- 맵·타일 ----------
  defaultKind(w) { const e = w.events && w.events[0]; return e ? e[0] : -1; }
  tileKind(w, x, y) { const e = w.eventAt(x, y); return e ? e[0] : -1; }
  // 맵 PK 설정 (+0x35d0): 기본 이벤트 종류 10 이면 2 (싸움터), 그 밖은 −1 (GM 이 바꿀 수 있다)
  mapMode(w) { return w.pkMode !== undefined ? w.pkMode : this.defaultKind(w) === FIGHT_KIND ? 2 : -1; }
  pkOff(w, x, y) {
    const k = this.tileKind(w, x, y);
    if (OFF_KINDS.includes(k)) return true;
    if (k === FIGHT_KIND) return false;
    const m = this.mapMode(w);
    if (m === 0) return true;
    if (m > 0 && m <= 2) return false;
    return OFF_KINDS.includes(this.defaultKind(w));
  }
  fight(w, x, y) { return this.tileKind(w, x, y) === FIGHT_KIND || this.mapMode(w) === 2 || this.defaultKind(w) === FIGHT_KIND; }
  safe(w, x, y) { const k = this.tileKind(w, x, y); return SAFE_KINDS.includes(k) || SAFE_KINDS.includes(this.defaultKind(w)); }
  penaltyMs(w) { const e = w.events && w.events[0]; return e && e[0] === PENALTY_KIND ? e[1] || 0 : 0; }
  // 맵에 들어올 때 안내 (0x42452c): 0x161 싸울 수 없음, 0x162 벌칙 있음, 0x163 벌칙 없음
  enterNotice(p, w) {
    if (!w.mobs.size && !w.pendingSpawn.length) return;
    let m = this.mapMode(w);
    if (m === -1) { const k = this.defaultKind(w); m = k === 7 ? 0 : k === FIGHT_KIND ? 2 : 1; }
    if (m === 0) this.msg(p, 0x161); else if (m === 1) this.msg(p, 0x162); else if (m === 2) this.msg(p, 0x163);
  }

  // ---------- PK 모드 ----------
  isOn(p) { return p.pkState === 2; }
  send(p) { p.send({ t: 'pkmode', on: p.pkState === 2 ? 1 : 0, arming: p.pkState === 1 ? 1 : 0 }); p.world.near(p, { t: 'pk', id: p.id, s: p.pkState || 0, pen: p.pkPen > 0 ? 1 : 0 }); }
  change(p, on) {
    if (!on) { p.pkState = 0; p.pkArmAt = 0; this.send(p); return; }
    if (p.pkState) return;                                              // 이미 켜는 중이거나 켜짐 (효과 37)
    p.pkState = 1; p.pkArmAt = Date.now() + ARM_MS; this.send(p);
  }
  // SendChangePKMode(3): 공격받은 사람의 PK 모드를 바로 켠다. 벌칙 중이면 안 켠다
  force(p) { if (p.pkPen > 0 || p.pkState === 2) return; p.pkState = 2; p.pkArmAt = 0; this.send(p); }

  // ---------- 정당방위 ----------
  isLegal(holder, other) { return !!(holder.legal && holder.legal[other.name] > 0); }
  setLegal(holder, other) {
    holder.legal ||= {};
    if (holder.legal[other.name] > 0) return;
    holder.legal[other.name] = LEGAL_MS; this.msg(holder, 0xcc, other.name);
  }
  // 들어올 때 남아 있는 정당방위 이름을 다섯씩 알린다 (EnterMap 0x408e70, 0/2/0xce)
  legalNotice(p) {
    const names = Object.keys(p.legal || {}).filter(n => p.legal[n] > 0);
    for (let i = 0; i < names.length; i += 5) this.msg(p, 0xce, names.slice(i, i + 5).join(' '));
  }

  // ---------- 공격 ----------
  // 사람이 사람을 때릴 때 (DoAttack 0x469dd0). 'skip' 이면 아무 일도 없고, 아니면 맞았는지 (false 면 빗나감 처리)
  attack(a, d) {
    const w = a.world;
    if (d.dead || d.world !== w) return 'skip';
    const offA = this.pkOff(w, a.x, a.y), offD = this.pkOff(w, d.x, d.y), fA = this.fight(w, a.x, a.y), fD = this.fight(w, d.x, d.y);
    const sA = this.safe(w, a.x, a.y), sD = this.safe(w, d.x, d.y);
    let ok = this.isOn(a) && !offA && !offD && fA === fD;
    if ((!fA || !fD) && (a.level <= MIN_LEVEL || d.level <= MIN_LEVEL)) ok = false;
    if (!fA && !fD && !offA && !offD && !this.isLegal(a, d)) { this.setLegal(d, a); if (!this.isOn(d)) this.force(d); }
    if (sA || sD || ((offA || offD) && !(fA && fD))) return 'skip';
    return ok;
  }

  // ---------- 죽음과 벌칙 ----------
  killed(victim, killer) {
    if (!killer || killer.mob || killer === victim) return;
    const ms = this.penaltyMs(victim.world);
    if (!ms || victim.pkPen > 0 || this.isLegal(killer, victim)) return;
    this.penalize(killer, ms);
  }
  // DoPKPenaltyAction: 횟수 +1 (최대 1000), 벌칙 시간 = 맵 값 × 횟수, 효과 39 (움직이기·공격·기술 막힘) 5초 + 횟수 × 0.2초, PK 모드 끔
  penalize(p, ms) {
    p.pkCount = Math.min(1000, (p.pkCount || 0) + 1);
    p.pkPen = ms * p.pkCount; p.pkDecay = 0;
    p.fx ||= {}; p.fx[39] = Date.now() + 5000 + p.pkCount * 200; p.world.sendFx(p);
    p.pkState = 0; p.pkArmAt = 0; this.send(p);
    this.sendPenalty(p);
  }
  sendPenalty(p) { if (p.pkPen > 0) this.msg(p, 0xad, Math.floor(p.pkPen / 60000) + 1); }

  // 접속자마다 (OnTimer)
  tick(p, now, dt) {
    if (p.pkState === 1 && now >= p.pkArmAt) { p.pkState = 2; p.pkArmAt = 0; this.send(p); }   // OnPKModeTimerExpired
    for (const n in p.legal || {}) {                                                             // CLegalDefenseManager::OnTimer
      p.legal[n] -= dt;
      if (p.legal[n] <= 0) { delete p.legal[n]; this.msg(p, 0xcd, n); }
    }
    if (p.dead) return;
    const m = p.world.mapId; if (noTick(m)) return;
    const step = m === JAIL ? Math.floor(dt / 2) : dt;
    if (!(p.pkPen > 0) && p.pkCount > 0) {                                  // 벌칙 횟수는 15시간마다 하나씩 준다
      p.pkDecay = (p.pkDecay || 0) + step;
      if (p.pkDecay >= 54000000) { p.pkCount = Math.max(0, p.pkCount - 1); p.pkDecay = p.pkCount > 0 && p.pkDecay > 18000000 ? p.pkDecay - 18000000 : 0; }
    }
    if (p.pkPen > 0) {
      if (p.pkPen <= step) { p.pkPen = 0; this.send(p); this.game.story.checkAndStart(p); }
      else p.pkPen -= step;
    }
  }

  // ---------- 교도관 (종류 43, SendOpenJailorPacket 0x41b440 / ProcessMoveJail 0x41c190) ----------
  jailor(p) {
    if (p.world.mapId === JAIL) p.send({ t: 'jail', inJail: 1, min: p.pkPen > 0 ? Math.floor(p.pkPen / 60000) + 1 : 0 });
    else p.send({ t: 'jail', inJail: 0 });
  }
  moveJail(p, leave) {
    if (p.dead) return;
    if (leave) {
      if (p.world.mapId !== JAIL) return;
      if (p.pkPen > 0) { this.msg(p, 0xaa); return; }                   // "Not allowed to leave the Prison while under PK penalty."
      if (!((p.story || 0) & 0x100)) { this.game.gotoMap(p, 1); return; }
    } else if (p.world.mapId === JAIL) return;
    if (p.money < JAIL_FEE) { this.msg(p, leave ? 0xaf : 0xae); return; }
    p.money -= JAIL_FEE; this.game.sendInv(p);
    this.game.gotoMap(p, leave ? 1 : JAIL);
  }
}
module.exports = { PK, JAIL };
