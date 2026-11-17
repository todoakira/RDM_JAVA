'use strict';
// 레드문 JS 서버: 정적 파일 제공(HTTP) + 실시간 통신(WebSocket)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Game, CFG } = require('./world');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, '..');
const MIME = { '.wav': 'audio/wav', '.mid': 'audio/midi', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  let u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (u === '/') u = '/index.html';
  const base = u.startsWith('/assets/') || u === '/data/skills.json' ? ROOT : path.join(ROOT, 'public');   // 기술 정보는 클라이언트도 쓴다 (원작 클라이언트도 skill00.rmi 를 읽는다)
  const file = path.normalize(path.join(base, u));
  if (!file.startsWith(base + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': u.startsWith('/assets/') ? 'public, max-age=86400' : 'no-cache' });
    res.end(data);
  });
});

const game = new Game();
const wss = new WebSocketServer({ server, maxPayload: 2048 });

wss.on('connection', ws => {
  let player = null, msgCount = 0, windowStart = Date.now();
  const send = m => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
  ws.on('message', raw => {
    // 과도한 전송 차단: 1초에 20개까지
    const now = Date.now();
    if (now - windowStart > 1000) { windowStart = now; msgCount = 0; }
    if (++msgCount > 20) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (!player) {
      if (m.t !== 'join') return;
      const name = String(m.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, CFG.maxName);
      if (!name) { send({ t: 'error', text: '이름을 입력해 주세요.' }); return; }
      if (game.isOnline(name)) { send({ t: 'error', text: '같은 이름으로 이미 접속 중입니다.' }); return; }
      const a = game.auth(name, m.pw);
      if (a.error) { send({ t: 'error', text: a.error }); return; }
      // 이름 규칙은 원작 로그인 서버와 같다: 14바이트(한글 7자)까지, 작은따옴표 금지 (svIP.exe CIPClient::ProcessNewCharacterID 0x404a10)
      if (a.created && ([...name].reduce((n, c) => n + (c.charCodeAt(0) > 127 ? 2 : 1), 0) > 14 || name.includes("'"))) { send({ t: 'error', text: '이름은 한글 7자(영문 14자)까지이고 작은따옴표를 쓸 수 없습니다.' }); return; }
      player = game.join(name, send, a.auth, a.created && Number.isInteger(m.chr) && m.chr >= 0 && m.chr <= 8 ? m.chr : 1, !!m.beginner); game.save(player);
      game.mail.login(player); game.army.sendBadge(player); game.story.sendInfo(player, false); game.story.checkAndStart(player);
      console.log(`[입장] ${name} (#${player.id}) 접속자 ${game.online}명`);
      return;
    }
    const world = player.world;
    // 거래 중에는 아이템을 쓰거나 옮길 수 없다 (0/2/0xa0, ProcessMoveItem 0x42f660 등)
    if (player.trade && ['use', 'unequip', 'qput', 'qget', 'quse', 'buy', 'sell', 'pickup', 'bankput', 'bankget', 'bankmoney', 'exchsell', 'exchbuy', 'talk'].includes(m.t)) { game.story.msg(player, 0xa0); return; }
    if (m.t === 'move') world.moveTo(player, m.x, m.y, m.z, m.run);
    else if (m.t === 'attack') world.attackCmd(player, m.id, m.run);
    else if (m.t === 'evsel') world.script.choose(player, m.ev, m.k);                    // 이벤트 선택지
    else if (m.t === 'evc') world.script.client(player, String(m.name), m.arg);         // 클라이언트가 알리는 이벤트 조건
    else if (m.t === 'revive') world.reviveAnswer(player, !!m.yes);
    else if (m.t === 'skill') { if (m.id) world.skillCmd(player, Number(m.sk), m.id, m.run); else world.selfSkillCmd(player, Number(m.sk)); }
    else if (m.t === 'gcreate') game.groups.create(player);
    else if (m.t === 'ginvite') game.groups.invite(player, m.name);
    else if (m.t === 'gjoin') game.groups.join(player, String(m.leader || ''), !!m.ok);
    else if (m.t === 'gleave') game.groups.leave(player, m.name ? String(m.name) : null);
    else if (m.t === 'gchat') game.groups.chat(player, m.text);
    else if (m.t === 'qput') game.quickPut(player, m.slot | 0);
    else if (m.t === 'qget') game.quickGet(player, m.q | 0);
    else if (m.t === 'quse') game.quickUse(player, m.q | 0);
    else if (m.t === 'shout') world.shout(player, m.text);
    else if (m.t === 'whisper') world.whisper(player, m.to, m.text);
    else if (m.t === 'tradeask') game.trades.ask(player, m.name);
    else if (m.t === 'tradeans') game.trades.answer(player, String(m.from || ''), !!m.ok);
    else if (m.t === 'tradeadd') game.trades.add(player, String(m.where || ''), m.slot | 0, m.n);
    else if (m.t === 'tradeok') game.trades.ok(player);
    else if (m.t === 'tradecancel') game.trades.cancel(player);
    else if (m.t === 'army') {                                                         // 군단 (패킷 0x70a~0x796)
      const A = game.army, a = String(m.a || '');
      if (a === 'reserves') A.reserveList(player, m.like); else if (a === 'reservetry') A.reserveTry(player);
      else if (a === 'reservenew') A.reserveCreate(player, m.name, m.notice); else if (a === 'reserveinfo') A.reserveInfo(player, m.name);
      else if (a === 'reservejoin') A.reserveJoin(player, m.commander); else if (a === 'reservebreak') A.reserveBreak(player, m.commander);
      else if (a === 'try') A.armyTry(player); else if (a === 'create') A.armyInfo(player, m.name, m.password, m.mark);
      else if (a === 'invite') A.invite(player, m.name); else if (a === 'inviteans') A.inviteAnswer(player, m.commander, !!m.ok);
      else if (a === 'uninvite') A.removeInit(player, m.name); else if (a === 'form') A.armyForm(player); else if (a === 'cancel') A.armyCancel(player);
      else if (a === 'info') A.info(player); else if (a === 'members') A.memberList(player); else if (a === 'login') A.login(player, m.password);
      else if (a === 'notice') A.notice(player, m.text, m.kind | 0); else if (a === 'hire') A.hire(player, m.name, !!m.fire); else if (a === 'hireans') A.hireAnswer(player, m.commander, !!m.ok);
      else if (a === 'cmdpw') A.cmdPassword(player, m.password); else if (a === 'transfer') A.transfer(player, m.name);
      else if (a === 'transferans') A.transferAnswer(player, m.commander, !!m.ok, m.password); else if (a === 'appoint') A.appoint(player, m.name, !!m.on);
      else if (a === 'appointans') A.appointAnswer(player, m.commander, !!m.ok, m.unit, m.password); else if (a === 'changelt') A.changeLt(player, m.from, m.to);
      else if (a === 'changeltans') A.changeLtAnswer(player, m.commander, !!m.ok, m.password); else if (a === 'getperm') A.getPerm(player, m.name);
      else if (a === 'setperm') A.setPerm(player, m.name, m.perm); else if (a === 'ltpw') A.ltPassword(player, m.password);
      else if (a === 'unithire') A.unitHire(player, m.name, !!m.fire); else if (a === 'unitans') A.unitAnswer(player, !!m.ok);
      else if (a === 'unitquit') A.unitQuit(player); else if (a === 'unit') A.unitList(player, m.name);
      else if (a === 'allyclick') A.allyClick(player); else if (a === 'ally') A.allyRequest(player, m.name, m.amount);
      else if (a === 'allyans') A.allyAnswer(player, m.commander, !!m.ok); else if (a === 'allybreakclick') A.allyBreakClick(player);
      else if (a === 'allybreak') A.allyBreak(player, m.name);
      else if (a === 'withdraw') A.withdraw(player); else if (a === 'breakup') A.breakUp(player); else if (a === 'chat') A.chat(player, m.text);
    }
    else if (m.t === 'inform') game.mail.inform(player, m.ev | 0);                      // 맵 클릭 영역의 이벤트 번호 (ProcessInformEvent)
    else if (m.t === 'maillist') game.mail.sendList(player, m.from | 0);
    else if (m.t === 'mailread') game.mail.read(player, m.i | 0);
    else if (m.t === 'maildel') game.mail.del(player, m.i | 0);
    else if (m.t === 'mailstart') game.mail.startWrite(player, m.to);
    else if (m.t === 'mailsend') game.mail.send(player, m.title, m.text, m.att);
    else if (m.t === 'mailget') game.mail.getItem(player, m.i | 0, m.slot | 0);
    else if (m.t === 'bonus') game.useBonus(player, m.stat);
    else if (m.t === 'pickup') world.pickupCmd(player, m.id, m.run);
    else if (m.t === 'use') game.useItem(player, m.slot | 0);
    else if (m.t === 'unequip') game.unequip(player, m.slot | 0);
    else if (m.t === 'talk') world.talkCmd(player, m.id, m.run);
    else if (m.t === 'restart') game.restart(player);
    else if (m.t === 'buy') game.buy(player, m.idx | 0, m.n);
    else if (m.t === 'sell') game.sell(player, m.slot | 0, m.n);
    else if (m.t === 'shopclose') player.shop = null;
    else if (m.t === 'bankmoney') game.bankMoney(player, m.n, !!m.put);
    else if (m.t === 'bankput') game.bankPut(player, m.slot | 0, m.n);
    else if (m.t === 'bankget') game.bankGet(player, m.slot | 0, m.n);
    else if (m.t === 'bankclose') player.bankNpc = 0;
    else if (m.t === 'exchsell') game.exchSell(player, m.slot | 0, m.n, m.price, m.memo);
    else if (m.t === 'exchbuy') game.exchBuy(player, m.id | 0, m.n);
    else if (m.t === 'exchrepay') game.exchRepay(player);
    else if (m.t === 'exchcancel') game.exchCancel(player);
    else if (m.t === 'exchclose') player.exchAt = null;
    else if (m.t === 'chat') {
      // 시험용 명령: "/맵 3" 으로 해당 맵에 바로 이동 ("/맵 1 75 100" 처럼 칸을 줄 수도 있다)
      const g = /^\/(?:맵|map)\s+(\d+)(?:\s+(\d+)\s+(\d+))?$/.exec(String(m.text || '').trim());
      const it = /^\/(?:아이템|item)\s+(\d+)\s+(\d+)(?:\s+(\d+))?$/.exec(String(m.text || '').trim());
      const lv = /^\/(?:레벨|level)\s+(\d+)$/.exec(String(m.text || '').trim());
      const mo = /^\/(?:돈|money)\s+(\d+)$/.exec(String(m.text || '').trim());
      const tm = /^`trade(?:\s+(\S+))?$/i.exec(String(m.text || '').trim());   // 원작 도움말: "`trade" 로 거래 시작 (1/1/115)
      if (tm) { if (tm[1]) game.trades.ask(player, tm[1]); else send({ t: 'tradename' }); return; }
      const fm = /^\/(?:명성|fame)\s+(-?\d+)$/.exec(String(m.text || '').trim());   // 시험용: 명성 바꾸기
      if (fm) { player.fame = Number(fm[1]); game.sendStat(player); return; }
      const sq = /^\/(?:퀘스트|story)\s+(\d+)$/.exec(String(m.text || '').trim());
      if (sq) { player.story = Number(sq[1]) >>> 0; game.story.sendInfo(player, true); } else   // 시험용: 이야기 진행 값 바꾸기
      if (/^\/(?:dp|DP)$/.test(String(m.text || '').trim())) { player.dp = player.maxDp; game.sendStat(player); }   // 시험용: DP 가득
      else if (mo) { player.money = Math.min(4000000000, Number(mo[1])); game.sendInv(player); }
      else if (lv) game.cheatLevel(player, Number(lv[1]));
      else if (it) { if (!game.cheatItem(player, Number(it[1]), Number(it[2]), Number(it[3] || 1))) send({ t: 'chat', id: 0, name: '안내', text: '그런 아이템이 없습니다.' }); }
      else if (g) { if (!game.gotoMap(player, Number(g[1]), g[2] && Number(g[2]), g[3] && Number(g[3]))) send({ t: 'chat', id: 0, name: '안내', text: '그 번호의 맵이 없습니다.' }); }
      else { const wm = /^\/(\S+)\s+(.+)$/.exec(String(m.text || '').trim()); if (wm) world.whisper(player, wm[1], wm[2]); else world.chat(player, m.text); }   // "/이름 내용" 은 귓속말 (1/1/37)
    }
  });
  ws.on('close', () => { if (player) { if (player.trade) game.trades.cancel(player); game.groups.offline(player); game.save(player); player.world.leave(player); console.log(`[퇴장] ${player.name} 접속자 ${game.online}명`); } });
  ws.on('error', () => {});
});

setInterval(() => game.tick(Date.now()), 50);
// 접속 중인 캐릭터를 1분마다 저장한다
setInterval(() => { for (const w of game.worlds.values()) for (const p of w.players.values()) game.save(p); }, 60000);
server.listen(PORT, () => console.log(`레드문 JS 서버 시작: http://localhost:${PORT}  (맵 ${game.mapIndex.size}장, 캐릭터 그림 ${Object.keys(game.chrIndex).length}종)`));
