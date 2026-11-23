'use strict';
// 우편. 원작 서버(svMapServer.exe)와 DB(tblMail1) 그대로:
//  - 우편은 받는 사람마다 쌓인다. DB 칸은 Time, Recipient, Sender, ReadOrNot, Title, Line, Content, Item (RMS_SENDMAIL)
//  - 우체통 (CMapServerServer::IsExistExtraEvent 0x447370, 종류 4): 맵마다 한 곳. 맵 1·3·21·29·37·38 은 서버에 박힌 칸이고 (0x4460e7~),
//    맵 47~67, 109~129, 131 은 서버 맵에서 이벤트 번호가 4인 첫 칸이다 (CrsMap 0x486710). 우체통과 거리 33 이하면 쓸 수 있다.
//    클라이언트는 맵(.rmm) 의 클릭 영역(번호 2)을 누르면 이벤트 2를 알리고 (ProcessInformEvent 0x41ed70),
//    서버는 이벤트 종류가 4이고 우체통 가까이면 우편함을 연다 (ProcessEvent case 4 → SendOpenMailPacket 0x42b030, 패킷 0x1c3)
//  - 목록 (ProcessGetMailList 0x4105f0): 우체통 가까이에서만. 0번을 달라면 처음부터 새로 읽고, 최근 것부터 16개씩 보낸다 (0x1af, 0x1b1, 0x1b3)
//  - 읽기 (ProcessReadMail 0x410730): 본문과 아이템 다섯 칸을 보내고 읽음으로 표시 (0x1b5, 0x1b7, 0x1b9)
//  - 지우기 (ProcessDelMail 0x410930)
//  - 쓰기 시작 (ProcessStartWritingMail 0x410a20): 받는 이름 1~16자. 없는 사람이면 0/4/2, 받는 사람 우편이 50통 이상이면 0/4/3
//  - 보내기 (ProcessEndWriteMail 0x410be0): 거래 중이면 0/2/0xa0. 붙이는 것은 다섯까지. 돈(분류 5의 0번)은 가진 만큼만,
//    아이템은 소지품에 있는 만큼만 붙는다. 받는 사람이 접속해 있으면 0/2/0x5d "Mail has arrived from player %s."
//  - 아이템 받기 (ProcessGetMailItem 0x411390): 돈은 40억까지 (넘으면 0/2/3), 아이템은 들 수 있는 만큼. 남은 것은 우편에 남는다 (0x1bf)
const fs = require('fs');
const path = require('path');
const F = require('./formulas');
const G = require('./grid');

const ROOT = path.join(__dirname, '..');
const MONEY_MAX = 4000000000;
const MAX_MAILS = 50;        // ProcessStartWritingMail: GetMailCount < 0x32
const PAGE = 16;             // ProcessGetMailList: 0xf < 개수 이면 그만
const ATTACH = 5;            // ProcessEndWriteMail: 개수 < 6, 아이템 칸 다섯
const RANGE = 33;            // IsExistExtraEvent: 거리 <= 0x21
const EV_MAILBOX = 4;        // 이벤트 종류 4
// CMapServerServer 맵 읽기 0x4460cc: 맵 번호별 우체통 칸 (x, y, 자리 0)
const FIXED = { 1: [72, 99], 3: [113, 116], 21: [159, 62], 29: [51, 70], 37: [150, 147], 38: [70, 65] };
const scanned = id => (id >= 47 && id <= 67) || (id >= 109 && id <= 129) || id === 131;

class Mail {
  constructor(game) {
    this.game = game;
    try { this.box = JSON.parse(fs.readFileSync(path.join(ROOT, 'save', 'mail.json'), 'utf8')); } catch (e) { this.box = {}; }
  }
  save() { try { fs.mkdirSync(path.join(ROOT, 'save'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'save', 'mail.json'), JSON.stringify(this.box)); } catch (e) { console.log('우편 저장 실패', e.message); } }
  list(name) { return this.box[name] ||= []; }
  msg(p, code, ...a) { this.game.story.msg(p, code, ...a); }
  board(p, code, ...a) { p.send({ t: 'mailmsg', code, args: a }); }   // 0x1c1: Message.ctf 0/4

  // 예전 저장 파일의 우편(p.mails)은 우편함으로 옮긴다
  login(p) {
    if (Array.isArray(p.mails) && p.mails.length) {
      const box = this.list(p.name);
      for (const m of p.mails) box.push({ time: m.time || Date.now(), from: m.from, read: m.read ? 1 : 0, title: m.title, text: m.text, items: [] });
      p.mails = []; this.save();
    }
  }

  // 우체통 위치
  pos(w) {
    if (w.mailbox !== undefined) return w.mailbox;
    let b = null;
    if (FIXED[w.mapId]) b = { x: FIXED[w.mapId][0], y: FIXED[w.mapId][1], z: 0 };
    else if (scanned(w.mapId) && w.ev) { const i = w.ev.indexOf(4); if (i >= 0) b = { x: i % w.w, y: Math.floor(i / w.w), z: 0 }; }
    return (w.mailbox = b);
  }
  near(p) { const b = p.world && this.pos(p.world); return !!b && G.dist(p, b) <= RANGE; }

  // 클라이언트가 알린 이벤트 (맵 클릭 영역의 번호)
  inform(p, ev) {
    const e = this.game.gEvents[ev]; if (!e || p.dead) return;
    if (e[0] === EV_MAILBOX && this.near(p)) p.send({ t: 'mailopen' });
    else if (e[0] === 11) this.game.army.openComputer(p);
    else if (e[0] === 2) this.game.board.open(p, e[1]);              // 게시판 (ProcessEvent case 2 → SendOpenBulletinPacket)            // ProcessEvent case 0xb: 군단 컴퓨터
  }
  // 서버가 보내는 우편 (RMS_SENDMAIL): 받는 사람이 접속해 있으면 알린다
  deliver(to, from, title, text) {
    this.list(to).push({ time: Date.now(), from, read: 0, title, text, items: [] }); this.save();
  }

  header(m, i) { return { i, read: m.read ? 1 : 0, time: m.time, from: m.from, title: m.title, lines: String(m.text || '').split('\n').length, items: (m.items || []).filter(Boolean).length }; }
  // 목록: from = 0 이면 처음부터 (최근 것부터 16개), 아니면 그 번호부터 아래로 16개
  sendList(p, from) {
    if (!this.near(p)) return;
    const box = this.list(p.name); from = Math.floor(Number(from)) || 0;
    const top = from === 0 ? box.length : Math.min(from, box.length), heads = [];
    for (let k = 0; k < PAGE && top - k >= 1; k++) heads.push(this.header(box[top - k - 1], top - k));
    p.send({ t: 'maillist', reset: from === 0 ? 1 : 0, heads, unread: box.filter(m => !m.read).length });
  }
  view(e) {
    if (!e) return null;
    const f = this.game.itemInfo(e.k, e.i);
    return { k: e.k, i: e.i, n: e.n, name: f ? f.name : '?', icon: f ? f.icon : 0, desc: f ? f.desc || '' : '', money: f && f.money ? 1 : 0 };
  }
  read(p, i) {
    const box = this.list(p.name), m = box[i - 1]; if (!m) return;
    m.read = 1; this.save();
    p.send({ t: 'mailread', i, from: m.from, title: m.title, time: m.time, text: m.text, items: Array.from({ length: ATTACH }, (_, k) => this.view((m.items || [])[k])) });
  }
  del(p, i) {
    const box = this.list(p.name); if (!box[i - 1]) return;
    box.splice(i - 1, 1); this.save();
    p.send({ t: 'maildel', i }); this.sendList(p, 0);
  }

  // 쓰기 시작: 받는 사람 확인
  startWrite(p, to) {
    to = String(to || '').trim(); if (to.length < 1 || to.length > 16) return;
    if (!this.game.exists(to)) { this.board(p, 2); return; }
    if (this.list(to).length >= MAX_MAILS) { this.board(p, 3); return; }
    p.mailTo = to; p.send({ t: 'mailwrite', to });
  }
  // 보내기. att: [{ money: n } | { slot: 소지품 칸, n }] 다섯까지
  send(p, title, text, att) {
    if (p.trade) { this.msg(p, 0xa0); return; }
    const to = p.mailTo; if (!to) return;
    title = String(title || '').slice(0, 80); text = String(text || '').slice(0, 1000);
    const items = [];
    const take = [];   // 소지품 칸 번호가 바뀌지 않게, 빼는 일은 마지막에
    for (const a of (Array.isArray(att) ? att : []).slice(0, ATTACH)) {
      if (!a) continue;
      const n = Math.floor(Number(a.n)); if (!(n > 0)) continue;
      if (a.money) {
        const got = Math.min(n, p.money); if (got <= 0) continue;
        p.money -= got; items.push({ k: 5, i: 0, n: got }); continue;
      }
      const e = p.inv[a.slot]; if (!e) continue;
      const left = e.n - take.filter(t => t.e === e).reduce((s, t) => s + t.n, 0);
      const got = Math.min(n, left); if (got <= 0) continue;
      take.push({ e, n: got }); items.push({ k: e.k, i: e.i, n: got });
    }
    for (const t of take) t.e.n -= t.n;
    p.inv = p.inv.filter(e => e.n > 0);
    this.list(to).push({ time: Date.now(), from: p.name, read: 0, title, text, items });
    p.mailTo = null; this.save();
    this.game.recalc(p, false); this.game.sendInv(p); this.game.sendStat(p); this.game.save(p);
    p.send({ t: 'mailsent' });
    const q = this.game.findOnline(to); if (q) this.msg(q, 0x5d, p.name);
  }
  // 우편의 아이템 받기
  getItem(p, i, slot) {
    if (p.trade) { this.msg(p, 0xa0); return; }
    const m = this.list(p.name)[i - 1], e = m && (m.items || [])[slot]; if (!e || p.dead) return;
    let got = 0;
    if (e.k === 5 && e.i === 0) {
      if (p.money >= MONEY_MAX) { p.money = MONEY_MAX; this.msg(p, 3); return; }
      got = Math.min(e.n, MONEY_MAX - p.money); p.money += got;
    } else {
      const f = this.game.itemInfo(e.k, e.i); if (!f) return;
      let fit = e.n;
      if (f.weight > 0) fit = Math.min(fit, Math.floor((F.weightMax(p.str) - this.game.weightOf(p)) / f.weight));
      if (fit <= 0) { this.board(p, 5); return; }
      const st = p.inv.find(x => x.k === e.k && x.i === e.i);
      if (!st && p.inv.length >= F.INV_SLOTS) { this.board(p, 7); return; }
      if (st) st.n += fit; else p.inv.push({ k: e.k, i: e.i, n: fit });
      got = fit;
    }
    if (got <= 0) return;
    e.n -= got; if (e.n <= 0) m.items[slot] = null;
    this.save(); this.game.recalc(p, false); this.game.sendInv(p); this.game.sendStat(p); this.game.save(p);
    p.send({ t: 'mailitem', i, slot, item: this.view(m.items[slot]), items: m.items.filter(Boolean).length });
  }
  // 이야기 퀘스트 우편 (RMS_BEGINSPYQUEST 등 DB 프로시저가 tblMail1 에 넣는다)
  system(p, m) {
    this.list(p.name).push({ time: Date.now(), from: m.from, read: 0, title: m.title, text: m.text, items: [] });
    this.save();
  }
}
module.exports = { Mail };
