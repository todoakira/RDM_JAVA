'use strict';
// 이벤트 대본: NPC 대사, 초보 안내, 퀘스트 흐름.
// 원본: 서버 Data/Event/EventScript.res (원본 표 Data/Event/work/EventScript.txt) → tools/event_script.py → data/event_script.json
//   이벤트마다 [맵 번호(60000 = 어느 맵이나), 랜덤, 단계들], 단계마다 [S/C, 발생조건, 클라이언트 행동, 서버 행동]
//
// 서버 동작 (svMapServer.exe):
//  - 단계 진행: 서버 행동을 하고 다음 단계로. "Jmp n" 이면 n 칸 뒤로. 끝을 넘으면 0 단계로 돌아가 다시 시작할 수 있다 (CMapServerClient::EventStepDone 0x425000)
//  - 다음 단계 조건이 "Timeout n" 이면 n × 1000ms 뒤에 저절로 진행 (0x4250f8, CExtraServer::EventStepDone 0x406af2)
//  - 그 밖의 조건은 그 일이 일어날 때 확인: AppearAt(그 네모 안에 들어옴, DoEventIfProper 0x410450), BuyItem, KillMonster, 퀘스트 이름 등
//  - C 단계(Key, Walk, Run, Turn, Chat)는 클라이언트가 알린다
//  - 선택지: GetUserResponseByCode a b … 를 보여 주고, 고른 번호 k(1부터)에 따라 지금 단계 + (k−1) 의 UserResponse 단계로 간다 (ProcessInformUserSelection 0x428c90)
//  - 랜덤 이벤트(랜덤=1)는 맵 쪽(CExtraServer)이 돌린다. 단계를 차례대로가 아니라 무작위로 고르고, 그 단계의 Timeout 뒤에 그 줄을 말한다 (0x406a16~0x406a3f)
//  - 대사 번호는 Message.ctf 의 0/7 묶음. ChatOneByCode 는 그 사람에게만, ChatAllByCode 는 NPC 주변 모두에게 (SendRectChatByCodePacket)
const fs = require('fs');
const path = require('path');

const ANY_MAP = 60000;
const read = (...p) => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8')); } catch { return null; } };
const SCRIPT = (read('data', 'event_script.json') || { events: [] }).events;
const MSG = read('assets', 'messages.json') || {};
const line = code => (MSG[0] && MSG[0][7] && MSG[0][7][code]) || '';

const words = s => String(s || '').trim().split(/\s+/).filter(Boolean);
const acts = s => String(s || '').split('&').map(x => x.trim()).filter(Boolean);
const firstWord = s => words(s)[0] || '';

class Events {
  constructor(world) {
    this.w = world;
    // 이 맵의 랜덤 이벤트 (CExtraServer)
    this.ambient = SCRIPT.map((e, i) => ({ e, i })).filter(x => x.e.random === 1 && x.e.map === world.mapId).map(x => ({ ...x, step: 0, at: 0 }));
  }
  // 이 맵에서 그 사람에게 걸릴 수 있는 이벤트 번호들
  personal() { return SCRIPT.map((e, i) => i).filter(i => SCRIPT[i].random !== 1 && (SCRIPT[i].map === this.w.mapId || SCRIPT[i].map === ANY_MAP)); }
  stepOf(p, i) { return (p.ev ||= {})[i] || 0; }
  cond(i, k) { const s = SCRIPT[i].steps[k]; return s ? s.cond : ''; }

  // ---------- 맵 쪽 랜덤 대사 ----------
  tickAmbient(now) {
    if (!this.w.players.size) return;
    for (const a of this.ambient) {
      if (a.at === 0) { this.ambientNext(a, now); continue; }
      if (now < a.at) continue;
      const s = a.e.steps[a.step];
      if (s && s.s) this.serverActions(null, a.i, s.server, null);
      this.ambientNext(a, now);
    }
  }
  ambientNext(a, now) {
    a.step = Math.floor(Math.random() * a.e.steps.length);   // rand() % 단계 수
    const c = words(a.e.steps[a.step].cond);
    a.at = now + (c[0] === 'Timeout' ? Number(c[1]) * 1000 : 1000);
  }

  // ---------- 사람 쪽 ----------
  // 지금 단계의 조건 첫 낱말이 name 이고 check(나머지 낱말)가 맞으면 진행한다
  trigger(p, name, check = () => true, fromClient = false) {
    for (const i of this.personal()) {
      const k = this.stepOf(p, i), st = SCRIPT[i].steps[k]; if (!st) continue;
      if ((st.s === 1) === fromClient) continue;               // S 단계는 서버가, C 단계는 클라이언트가 알린다
      const c = words(st.cond); if (c[0] !== name || !check(c.slice(1))) continue;
      this.run(p, i, k);
    }
  }
  // 한 단계 실행: 클라이언트 행동과 서버 행동을 하고 다음 단계로
  run(p, i, k, npc) {
    const st = SCRIPT[i].steps[k]; if (!st) return;
    for (const a of acts(st.client)) p.send({ t: 'evui', act: a });
    const jump = this.serverActions(p, i, st.server, npc || (p.evNpc && p.evNpc[i]));
    this.stepDone(p, i, jump);
  }
  stepDone(p, i, jump = 1, now = Date.now()) {
    const n = SCRIPT[i].steps.length;
    let k = this.stepOf(p, i) + (jump > 0 ? jump : 1);
    if (k >= n) k = 0;
    p.ev[i] = k;
    (p.evAt ||= {}); delete p.evAt[i];
    if (k === 0) { if (p.evNpc) delete p.evNpc[i]; return; }
    const c = words(this.cond(i, k));
    if (c[0] === 'Timeout') p.evAt[i] = now + Number(c[1]) * 1000;
  }
  // 시간 조건이 찬 사람 단계 진행 (CMapServerClient::OnTimer)
  tickPlayer(p, now) {
    if (!p.evAt) return;
    for (const i in p.evAt) if (now >= p.evAt[i]) { const k = this.stepOf(p, i); delete p.evAt[i]; if (SCRIPT[i] && SCRIPT[i].steps[k] && SCRIPT[i].steps[k].s) this.run(p, Number(i), k); }
  }
  // 선택지 고름 (ProcessInformUserSelection)
  choose(p, i, choice) {
    i = Number(i); choice = Math.floor(Number(choice));
    if (!SCRIPT[i] || !(choice >= 1)) return;
    const k = this.stepOf(p, i) + choice - 1;
    if (firstWord(this.cond(i, k)) !== 'UserResponse') return;
    p.ev[i] = k; this.run(p, i, k);
  }
  // 걸음을 마쳤을 때: AppearAt x1 y1 x2 y2 (그 네모 안)
  moved(p) { this.trigger(p, 'AppearAt', ([x1, y1, x2, y2]) => p.x >= +x1 && p.x <= +x2 && p.y >= +y1 && p.y <= +y2); }
  bought(p, k, i, n) { this.trigger(p, 'BuyItem', ([a, b]) => +a === k && +b === i); }
  killed(p, mobName) { this.trigger(p, 'KillMonster', ([nm]) => nm === '+' + mobName); }
  // 클라이언트가 알리는 C 조건 (Key 코드, Walk, Run, Turn, Chat)
  client(p, name, arg) { if (['Key', 'Walk', 'Run', 'Turn', 'Chat'].includes(name)) this.trigger(p, name, a => name !== 'Key' || +a[0] === +arg, true); }

  // 서버 행동. 돌려주는 값은 다음 단계까지 건너뛸 칸 수
  serverActions(p, i, text, npc) {
    let jump = 1;
    for (const a of acts(text)) {
      const w = words(a), cmd = w[0];
      if (cmd === 'Jmp') jump = Number(w[1]) || 1;
      else if (cmd === 'ChatOneByCode' || cmd === 'ChatAllByCode') {
        const who = this.npcByRef(w[1], npc), text = line(w[2]); if (!text) continue;
        const msg = { t: 'chat', id: who ? who.id : 0, name: who ? who.name : (w[1] || '').replace(/^\+/, ''), text, npc: 1 };
        if (cmd === 'ChatOneByCode' && p) p.send(msg); else if (who) this.w.near(who, msg); else if (p) p.send(msg);
      } else if (cmd === 'GetUserResponseByCode' && p) {
        p.send({ t: 'ask', ev: i, options: w.slice(1).map(c => line(c)) });
      } else if (cmd === 'Move' && p) {
        const dst = this.w.game.world(Number(w[1]));
        if (dst) { const from = p.world; from.leave(p); dst.enter(p, Number(w[2]), Number(w[3])); }
      }
      // 그 밖의 서버 행동(퀘스트 아이템, 퀘스트 상태, 그룹, 보너스 초기화 등)은 아직 옮기지 않았다
    }
    return jump;
  }
  // "+이름" 은 그 맵의 그 이름 NPC, "%NPCID" 는 이벤트를 건 NPC
  npcByRef(ref, npc) {
    if (ref === '%NPCID') return npc || null;
    const name = String(ref || '').replace(/^\+/, '');
    return this.w.npcs.find(n => n.name === name) || null;
  }
}
module.exports = { Events, SCRIPT };
