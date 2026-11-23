'use strict';
// 게시판.
// 원작: 서버는 게시판 번호와 주소만 보내고 (SendOpenBulletinPacket 0x42af40, 패킷 0x1a5: [번호(short), BOARD 주소]),
//   클라이언트가 게임 안 웹 창에 http://<주소>/board.asp?db=tblRM<…>Board<…>_<번호 3자리>&GameID=<이름>&method=list|write 를 띄운다
//   (Main.dll 0x1003d941, 0x100c5754). 그 웹 게시판(board.asp)은 받은 파일에 없다.
// 여기서는 운영 결정으로 우리 서버가 간단한 게시판(목록·읽기·쓰기·지우기)을 맡는다. 번호와 이름을 쓰는 방식만 원작을 따른다.
// 게시판을 여는 곳 (원작 그대로):
//   - 이벤트 종류 2 (ProcessEvent case 2): 번호 = 이벤트 값 (전역 이벤트 [2, 1] 이 네 곳)
//   - 군단 게시판 (SendOpenArmyBulletin 0x411d40): 51 또는 10 + 군단 번호. 운영자 게시판 (ProcessOpenOpBulletin 0x41c0b0): 999
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PAGE = 10;
const MAX_TITLE = 40, MAX_TEXT = 2000, MAX_POSTS = 500;

class Board {
  constructor(game) {
    this.game = game; this.file = path.join(ROOT, 'save', 'boards.json');
    try { this.db = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { this.db = {}; }
  }
  save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.db)); } catch (e) {} }
  key(no) { return String(no | 0).padStart(3, '0'); }
  posts(no) { return this.db[this.key(no)] ||= []; }
  open(p, no) { p.boardNo = no | 0; p.send({ t: 'board', a: 'open', no: p.boardNo }); this.list(p, 0); }
  ok(p) { return p.boardNo !== undefined && p.boardNo !== null; }
  list(p, page) {
    if (!this.ok(p)) return;
    const all = this.posts(p.boardNo), pages = Math.max(1, Math.ceil(all.length / PAGE));
    page = Math.min(pages - 1, Math.max(0, page | 0));
    const rows = all.slice().reverse().slice(page * PAGE, page * PAGE + PAGE).map(x => ({ id: x.id, title: x.title, by: x.by, time: x.time }));
    p.send({ t: 'board', a: 'list', no: p.boardNo, page, pages, rows });
  }
  read(p, id) {
    if (!this.ok(p)) return;
    const x = this.posts(p.boardNo).find(q => q.id === (id | 0)); if (!x) return;
    p.send({ t: 'board', a: 'read', no: p.boardNo, post: x, mine: x.by === p.name ? 1 : 0 });
  }
  write(p, title, text) {
    if (!this.ok(p)) return;
    title = String(title || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, MAX_TITLE);
    text = String(text || '').replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').trim().slice(0, MAX_TEXT);
    if (!title || !text) return;
    const all = this.posts(p.boardNo), id = (all.length ? all[all.length - 1].id : 0) + 1;
    all.push({ id, title, text, by: p.name, time: Date.now() });
    if (all.length > MAX_POSTS) all.splice(0, all.length - MAX_POSTS);
    this.save(); this.list(p, 0);
  }
  del(p, id) {
    if (!this.ok(p)) return;
    const all = this.posts(p.boardNo), i = all.findIndex(q => q.id === (id | 0));
    if (i < 0 || all[i].by !== p.name) return;
    all.splice(i, 1); this.save(); this.list(p, 0);
  }
  handle(p, m) {
    if (m.a === 'list') this.list(p, m.page); else if (m.a === 'read') this.read(p, m.id);
    else if (m.a === 'write') this.write(p, m.title, m.text); else if (m.a === 'del') this.del(p, m.id);
    else if (m.a === 'close') p.boardNo = null;
  }
}
module.exports = { Board };
