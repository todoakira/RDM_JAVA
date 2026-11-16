'use strict';
// 플레이어 사이 거래. 원작 서버(svMapServer.exe) 그대로:
//  - 신청 (ProcessTryTrade 0x40e910, AskTrade 0x443060): 자기 자신이면 0/2/0x95, 없는 이름이면 0x96, 같은 맵에 없으면 0x97,
//    상대가 거래 중이면 0x9b, 내가 거래 중이면 0x9a. 상대에게는 "%s has offered to trade." (0x98) 와 예/아니오
//  - 대답 (ResponseAskTrade 0x443260): 거절이면 신청한 사람에게 0x99. 받아들이면 둘 다 거래 창을 연다 (BeginTrade 0x40eb00)
//  - 올리기 (ProcessAddTradeItem 0x40eb70): 돈(분류 4)이나 소지품·빠른 창의 아이템을 거래 칸 여섯에 올린다. 올린 것은 내 쪽에서 빠진다.
//    같은 아이템은 한 칸에 겹친다. 내가 OK 를 누른 뒤에는 더 올릴 수 없다
//  - OK (ProcessTradeOK 0x40f200, TradeOK 0x443720): 한쪽만 누르면 상대에게 0xa2. 둘 다 누르면
//    돈이 40억을 넘지 않고, 받는 무게가 (남은 무게 + 내가 주는 무게) 이하일 때 서로 바꾸고 0x9d, 아니면 0x9f 를 보내고 취소
//  - 취소 (CancelTrade 0x40f010): 올린 돈과 아이템을 돌려주고 0x9e. 맵을 옮기거나 접속을 끊어도 취소
const F = require('./formulas');
const MONEY_MAX = 4000000000;
const SLOTS = 6;

class Trades {
  constructor(game) { this.game = game; }
  msg(p, code, ...a) { this.game.story.msg(p, code, ...a); }
  partner(p) { return p.trade ? this.game.findOnline(p.trade.with) : null; }

  ask(p, name) {
    name = String(name || '').trim(); if (!name || p.dead) return;
    if (p.trade) { this.msg(p, 0x9a); return; }
    if (name === p.name) { this.msg(p, 0x95); return; }
    if (!this.game.exists(name)) { this.msg(p, 0x96); return; }
    const q = [...p.world.players.values()].find(x => x.name === name);
    if (!q) { this.msg(p, 0x97); return; }
    if (q.trade) { this.msg(p, 0x9b, q.name); return; }
    (q.tradeAsk ||= new Set()).add(p.name);
    q.send({ t: 'tradeask', from: p.name });
  }
  answer(p, from, yes) {
    if (!p.tradeAsk || !p.tradeAsk.delete(from)) return;
    const q = [...p.world.players.values()].find(x => x.name === from);
    if (!q) { this.msg(p, 0x97); return; }
    if (!yes) { this.msg(q, 0x99, p.name); return; }
    if (q.trade || p.trade) { this.msg(q, 0x9b, p.name); return; }
    for (const [a, b] of [[p, q], [q, p]]) { a.trade = { with: b.name, items: Array(SLOTS).fill(null), money: 0, ok: 0 }; a.shop = null; a.bankNpc = 0; }
    this.send(p); this.send(q);
  }
  // 거래 창 내용: 내 쪽과 상대 쪽
  send(p) {
    const q = this.partner(p); if (!p.trade || !q) return;
    const view = e => { if (!e) return null; const f = this.game.itemInfo(e.k, e.i); return { k: e.k, i: e.i, n: e.n, name: f ? f.name : '?', icon: f ? f.icon : 0, desc: f ? f.desc || '' : '' }; };
    p.send({ t: 'trade', with: q.name, mine: { items: p.trade.items.map(view), money: p.trade.money, ok: p.trade.ok }, theirs: { items: q.trade.items.map(view), money: q.trade.money, ok: q.trade.ok } });
  }
  both(p) { const q = this.partner(p); this.send(p); if (q) this.send(q); }
  // 올리기: what = 'money' 이면 n 만큼, 아니면 소지품 칸(where='inv') 또는 빠른 창 칸(where='quick') 의 아이템 n 개
  add(p, where, slot, n) {
    const t = p.trade, q = this.partner(p); if (!t || !q || t.ok) return;
    n = Math.floor(Number(n)); if (!(n > 0)) return;
    if (where === 'money') {
      n = Math.min(n, p.money, MONEY_MAX - t.money); if (n <= 0) return;
      p.money -= n; t.money += n; this.game.sendInv(p); this.both(p); return;
    }
    const list = where === 'quick' ? (p.quick || []) : p.inv, e = list[slot]; if (!e) return;
    n = Math.min(n, e.n);
    let k = t.items.findIndex(x => x && x.k === e.k && x.i === e.i); if (k < 0) k = t.items.findIndex(x => !x); if (k < 0) return;
    if (t.items[k]) t.items[k].n += n; else t.items[k] = { k: e.k, i: e.i, n };
    e.n -= n; if (e.n <= 0) { if (where === 'quick') list[slot] = null; else list.splice(slot, 1); }
    this.game.recalc(p, false); this.game.sendInv(p); this.game.sendStat(p); this.both(p);
  }
  weight(items) { let w = 0; for (const e of items) { const f = e && this.game.itemInfo(e.k, e.i); if (f && f.weight) w += f.weight * e.n; } return w; }
  ok(p) {
    const t = p.trade, q = this.partner(p); if (!t || !q) return;
    t.ok = 1;
    if (!q.trade.ok) { this.msg(q, 0xa2); this.both(p); return; }
    const u = q.trade;
    const room = x => F.weightMax(x.str) - this.game.weightOf(x);   // 거래 칸에 올린 것은 이미 빠져 있다
    const fine = p.money + u.money <= MONEY_MAX && q.money + t.money <= MONEY_MAX
      && this.weight(u.items) <= room(p) && this.weight(t.items) <= room(q);
    if (!fine) { this.msg(p, 0x9f); this.msg(q, 0x9f); this.cancel(p); return; }
    const give = (to, items, money) => {
      to.money += money;
      for (const e of items) if (e) { const got = this.game.giveItem(to, e.k, e.i, e.n); if (got < e.n) to.world.dropItem(to, [e.k, e.i, e.n - got]); }
    };
    const pi = t.items, qi = u.items, pm = t.money, qm = u.money;
    p.trade = null; q.trade = null;
    give(p, qi, qm); give(q, pi, pm);
    for (const x of [p, q]) { this.msg(x, 0x9d); x.send({ t: 'trade', close: 1 }); this.game.recalc(x, false); this.game.sendInv(x); this.game.sendStat(x); this.game.save(x); }
  }
  // 취소: 둘 다 돌려받는다 (CMapServerServer::CancelTrade 0x444280)
  cancel(p, quiet) {
    const q = this.partner(p);
    for (const x of [p, q]) {
      if (!x || !x.trade) continue;
      const t = x.trade; x.trade = null;
      x.money += t.money;
      for (const e of t.items) if (e) { const got = this.game.giveItem(x, e.k, e.i, e.n); if (got < e.n) x.world.dropItem(x, [e.k, e.i, e.n - got]); }
      if (!quiet) this.msg(x, 0x9e);
      x.send({ t: 'trade', close: 1 }); this.game.recalc(x, false); this.game.sendInv(x); this.game.sendStat(x);
    }
  }
}
module.exports = { Trades };
