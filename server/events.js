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
  trigger(p, name, check = () => true, fromClient = false, after = null, npc = null) {
    for (const i of this.personal()) {
      const k = this.stepOf(p, i), st = SCRIPT[i].steps[k]; if (!st) continue;
      if ((st.s === 1) === fromClient) continue;               // S 단계는 서버가, C 단계는 클라이언트가 알린다
      const c = words(st.cond); if (c[0] !== name || !check(c.slice(1))) continue;
      if (npc) (p.evNpc ||= {})[i] = npc;
      this.run(p, i, k);
      if (after) after();
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
  // 몬스터 이름표는 "+이름_n" (n 은 맵의 몬스터를 불러온 순서, CMopServer::LoadMop 0x4772f3).
  // 에스퍼·첩보대장은 그 퀘스트 차례일 때만 진행되고, 진행한 뒤 이야기 퀘스트 시작 조건을 다시 본다 (CMopServer::Dead 0x479140~0x4792e1)
  killed(p, sid) {
    const S = this.w.game.story, R = require('./story').ready;
    this.trigger(p, 'KillMonster', ([nm]) => {
      if (nm !== sid) return false;
      if (sid.includes('첩보대장')) return R.captain(p);
      if (sid.includes('에스퍼')) return R.esper(p);
      return true;
    }, false, () => S.checkAndStart(p));
  }
  line(c) { return line(c); }
  // 종류 41 NPC: 그 이벤트를 처음 단계로 되돌리고, 첫 조건이 EventTriggered 면 바로 진행 (ProcessEvent 0x421e60)
  startAt(p, i, npc) {
    if (!SCRIPT[i] || !(SCRIPT[i].map === this.w.mapId || SCRIPT[i].map === ANY_MAP)) return;
    (p.ev ||= {})[i] = 0;
    if (firstWord(this.cond(i, 0)) === 'EventTriggered') { (p.evNpc ||= {})[i] = npc; this.run(p, i, 0); }
  }
  // 이름 붙은 조건(GoGoQuest, KasamQuest1 …)을 지금 단계로 가진 이벤트를 모두 진행 (DoProperEvent 0x410410)
  named(p, name, npc) { this.trigger(p, name, () => true, false, null, npc); }
  // 클라이언트가 알리는 C 조건 (Key 코드, Walk, Run, Turn, Chat)
  client(p, name, arg) { if (['Key', 'Walk', 'Run', 'Turn', 'Chat'].includes(name)) this.trigger(p, name, a => name !== 'Key' || +a[0] === +arg, true); }

  // 서버 행동. 돌려주는 값은 다음 단계까지 건너뛸 칸 수
  serverActions(p, i, text, npc) {
    let jump = 0;
    for (const a of acts(text)) {
      const w = words(a), cmd = w[0];
      if (cmd === 'Jmp') { if (Number(w[1]) > 0) jump += Number(w[1]); }   // 여러 번이면 더한다, 0 이하면 1 (0x42639b, 0x4280cc)
      else if (cmd === 'ChatOneByCode' || cmd === 'ChatAllByCode') {
        const who = this.npcByRef(w[1], npc), text = line(w[2]); if (!text) continue;
        const msg = { t: 'chat', id: who ? who.id : 0, name: who ? who.name : (w[1] || '').replace(/^\+/, '').replace(/_\d+$/, ''), text, npc: 1 };
        if (cmd === 'ChatOneByCode' && p) p.send(msg); else if (who) this.w.near(who, msg); else if (p) p.send(msg);
      } else if (cmd === 'GetUserResponseByCode' && p) {
        let codes = w.slice(1, 6).map(Number);
        // 보기 281·282·283 은 이야기 진행에 따라 줄어든다: 0x8 전이면 하나, 0x400 전이면 둘 (0x426300)
        if (codes.length === 3 && codes[0] === 0x119 && codes[1] === 0x11a && codes[2] === 0x11b) {
          if (!((p.story || 0) & 8)) codes = codes.slice(0, 1); else if (!((p.story || 0) & 0x400)) codes = codes.slice(0, 2);
        }
        p.send({ t: 'ask', ev: i, options: codes.map(c => line(c)) });
      } else if (cmd === 'Move' && p) {
        const dst = this.w.game.world(Number(w[1]));
        if (dst) { const from = p.world; from.leave(p); dst.enter(p, Number(w[2]), Number(w[3])); }
      }
      else if (p && this.w.game.story.action(p, cmd, w)) { /* 퀘스트 행동 */ }
      // 그룹 만들기·해산, 보너스 초기화(InitBonus, 그 조건 WantToInitBonus 는 이 서버판에서 어디서도 걸리지 않는다), 보조 퀘스트(BeginSubQuest*)는 아직
    }
    return jump > 0 ? jump : 1;
  }
  // "+이름" 은 그 맵의 그 이름 NPC, "%NPCID" 는 이벤트를 건 NPC
  // "+첩자_0" 처럼 몬스터 이름표일 수도 있다 (대본 18: 첩자가 말한다)
  npcByRef(ref, npc) {
    if (ref === '%NPCID') return npc || null;
    const name = String(ref || '').replace(/^\+/, '');
    return this.w.npcs.find(n => n.name === name) || [...this.w.mobs.values()].find(m => m.sid === ref) || null;
  }
}
module.exports = { Events, SCRIPT };
