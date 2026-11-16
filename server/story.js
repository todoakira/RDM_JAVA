'use strict';
// 이야기 퀘스트(스토리 퀘스트): 아귈라스 첩자 → 고고학자 → 지리학자 → 카삼 → 에스퍼 → 첩보대장 → 히말라야 회상.
// 원작 서버(svMapServer.exe)의 진행 표시(StoryQuestState, CMapServerClient+0x4170)와 퀘스트 아이템 다섯 칸(+0x4174, 16바이트씩)을 그대로 쓴다.
//
// 진행 표시 비트 (누가 켜는가)
//   0x1    첩자 퀘스트 시작   레벨 50 이상이 되면 (CheckAndStartStoryQuest 0x43ffc0 → DB RMS_BEGINSPYQUEST, 카삼의 우편)
//   0x2    첩자를 잡음        SpyQuestEnd1/2
//   0x4    고고학자 해독      대본 MarkStoryQuestState 4
//   0x8    지리학자 지도      SaharaMiniMapQuestEnd
//   0x10   카삼을 만남        대본 MarkStoryQuestState 16
//   0x20   에스퍼를 잡음      대본 MarkStoryQuestState 32
//   0x40   카삼 2             KasamQuestEnd
//   0x80   첩보대장 우편      레벨 50 이상이고 0x40 이면 (BeginKasamMail2Quest 0x438260 → RMS_BEGINCAPTAINYQUEST)
//   0x100  카삼 3             대본 MarkStoryQuestState 256
//   0x200  첩보대장을 잡음    대본 MarkStoryQuestState 512
//   0x400  카삼 4             KasamQuest4End
//   0x800  회상 이야기        SayKasamRecollectEnd (맵 79 → 83 이동 지점)
//   0x1000 카삼 회상          KasamRecollectQuestEnd
//   0x2000 회상 퀘스트 끝     RecollectQuestEnd (0x6000 을 켜고 우주선 우편 RMS_KASAMSPACESHIPMAIL 은 0x4000)
const fs = require('fs');
const path = require('path');
const F = require('./formulas');

const read = (...p) => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8')); } catch { return null; } };
const MAIL = read('data', 'story_mail.json') || {};   // tools/story_mail.py: 원작 DB 의 우편 내용

const LV = 50;          // 0x31 < 레벨 (0x438350 등)
const QSLOTS = 5;
const has = (p, b) => ((p.story || 0) & b) !== 0;
const hasQItem = (p, k, i) => (p.qitems || []).some(e => e && e.k === k && e.i === i);

// 준비 확인 (0x438350~0x438700). 전투넷·대전장·교환 중 조건은 이 게임에 아직 없어 늘 통과
const ready = {
  spy: p => p.level >= LV && has(p, 1) && !hasQItem(p, 5, 1) && !has(p, 4),
  gogo: p => p.level >= LV && has(p, 2) && hasQItem(p, 5, 1) && !has(p, 4),
  sahara: p => has(p, 4) && !has(p, 8),
  kasam1: p => p.level >= LV && has(p, 8) && !has(p, 0x10),
  esper: p => has(p, 0x10) && !has(p, 0x20),
  kasam2: p => has(p, 0x20) && !has(p, 0x40),
  kasam3: p => has(p, 0x80) && !has(p, 0x100),
  captain: p => has(p, 0x100) && !has(p, 0x200),
  kasam4: p => has(p, 0x200) && !has(p, 0x400),
  recollect: p => has(p, 0x800) && !has(p, 0x1000),
  spaceship: p => has(p, 0x4000) && !has(p, 0x8000),
};

// 퀘스트 정보 창 두 줄 (SendQuestInfo 0x4254e0). 번호는 Message.ctf 0/7
function questInfo(p) {
  if (ready.spy(p)) return [0xe6, 0xe7];
  if (ready.gogo(p) || ready.sahara(p)) return [0xe8, 0xe9];
  if (ready.kasam1(p) || ready.esper(p) || ready.kasam2(p)) return [0xea, 0xeb];
  const s = p.story || 0;
  if ((s & 0x80) && !(s & 0x400)) return [0x112, 0x113];
  if ((s & 0x800) && !(s & 0x2000)) return [0x291, 0x292];
  if ((s & 0x4000) && !(s & 0x10000)) return [0x293, p.chr === 3 ? 0x295 : 0x294];
  return [0, 0];
}

class Story {
  constructor(game) { this.game = game; }
  // 시스템 메시지 (SendMessagePacket 0x43fc10 → 패킷 0x123, 클라이언트는 Message.ctf 0/2 의 그 번호 줄을 보인다)
  msg(p, code, ...args) { p.send({ t: 'sys', code, args }); }
  sendInfo(p, open) {
    p.send({ t: 'quest', lines: questInfo(p), items: (p.qitems || []).map(e => e && this.view(e)), open: open ? 1 : 0 });
  }
  view(e) { const f = this.game.itemInfo(e.k, e.i); return { k: e.k, i: e.i, n: e.n, name: f ? f.name : '?', desc: f ? f.desc || '' : '', icon: f ? f.icon : 0 }; }
  mail(p, key) {
    const m = MAIL[key]; if (!m) return;
    this.game.mail.system(p, m);
    this.msg(p, 0x74);                                // "You have an urgent mail. Please check it now at a mailbox."
  }

  set(p, bits) { p.story = (p.story || 0) | bits; }

  // CheckAndStartStoryQuest 0x43ffc0: 레벨이 오르거나 몬스터를 잡거나 접속해 있는 동안 확인
  checkAndStart(p) {
    const gogo = hasQItem(p, 5, 1), k1 = !has(p, 0x10);
    if (p.level >= LV && !has(p, 1)) { this.set(p, 1); this.mail(p, 'RMS_BEGINSPYQUEST'); this.sendInfo(p, true); }
    if (p.level >= LV && has(p, 0x40) && !has(p, 0x80)) this.beginCaptainMail(p);
    if (gogo !== hasQItem(p, 5, 1) || k1 !== !has(p, 0x10)) this.sendInfo(p, true);
  }
  beginCaptainMail(p) { this.set(p, 0x80); this.mail(p, 'RMS_BEGINCAPTAINYQUEST'); this.sendInfo(p, true); }

  // 퀘스트 아이템 (AddQuestItem 0x432100, RemoveQuestItem 0x4321e0): 같은 것이 이미 있으면 넣지 않는다
  addQItem(p, k, i, n) {
    if (!this.game.itemInfo(k, i)) return false;
    const q = p.qitems ||= Array(QSLOTS).fill(null);
    if (q.some(e => e && e.k === k && e.i === i)) return false;
    const s = q.findIndex(e => !e); if (s < 0) return false;
    q[s] = { k, i, n: n || 0 };
    this.sendInfo(p, true); return true;
  }
  removeQItem(p, k, i, n = -1) {
    const q = p.qitems || [], s = q.findIndex(e => e && e.k === k && e.i === i); if (s < 0) return false;
    if (n >= 0 && n < q[s].n) q[s].n -= n; else q[s] = null;
    this.sendInfo(p, true); return true;
  }

  // 명성 올리기 (IncreaseAbsFame 0x4397c0): 이야기 진행에 따라 한계가 100, 200, 300, 400, 500, 1000
  increaseAbsFame(p, n) {
    const s = p.story || 0;
    const cap = !(s & 2) ? 100 : !(s & 8) ? 200 : !(s & 0x40) ? 300 : !(s & 0x400) ? 400 : (s & 0x2000) ? 1000 : 500;
    const old = p.fame || 0;
    if (n < 1 || cap <= Math.abs(old)) return 0;
    const nv = old < 0 ? Math.max(-cap, old - n) : Math.min(cap, old + n);
    p.fame = nv; this.game.sendStat(p); this.sendInfo(p, false);
    return Math.abs(nv - old);
  }
  // 보상: 경험치 = 경험치표[기준 레벨] ÷ 나눔 (원작 +0x21cc 표의 100·200·300·400·500 번째 값), 명성은 이미 명성이 있을 때만
  reward(p, lvIdx, div, fame, capMsg) {
    const gain = this.game.gainExp(p, Math.floor(F.expTable[lvIdx] / div));
    if (gain) this.msg(p, 0x7d, gain);
    if (fame && (p.fame || 0) !== 0) { const f = this.increaseAbsFame(p, fame); if (f) this.msg(p, 0x7c, f); }
    if (capMsg) this.msg(p, 0x7b, capMsg);            // "이제 명성을 |n| 넘게 얻을 수 있습니다"
  }

  // 대본의 퀘스트 관련 서버 행동 (DoEventServerAction 0x4260b0). 처리했으면 true
  action(p, cmd, w) {
    switch (cmd) {
      case 'ActivateUser': p.activated = 1; return true;   // 패턴 3 몬스터(첩자)가 이 사람을 노린다 (+0x4340)
      case 'AddQuestItem': this.addQItem(p, +w[1], +w[2], +w[3] || 0); return true;
      case 'RemoveQuestItem': this.removeQItem(p, +w[1], +w[2], -1); return true;
      case 'MarkStoryQuestState':
        this.set(p, Number(w[1]) >>> 0); this.sendInfo(p, false);
        if (p.level >= LV && has(p, 0x40) && !has(p, 0x80)) this.beginCaptainMail(p);
        return true;
      case 'SendQuestInfo': this.sendInfo(p, false); return true;
      case 'SendMessagePacket': this.msg(p, Number(w[1])); return true;
      case 'SpyQuestEnd1': if (!has(p, 2)) this.reward(p, 100, 50, 0, 100); return true;
      case 'SpyQuestEnd2': if (!has(p, 2)) this.reward(p, 100, 10, 0, 100); return true;
      case 'SaharaMiniMapQuestEnd':
        if (!has(p, 8)) { this.set(p, 8); this.reward(p, 200, 50, 30, 200); }
        this.msg(p, 0x77); return true;                   // "퀘스트를 마쳤습니다"
      case 'KasamQuestEnd':
        if (!has(p, 0x40)) { this.set(p, 0x40); this.reward(p, 300, 50, 50, 300); }
        // 사하라 지도 두 장은 퀘스트 칸에서 빠지고 보통 아이템으로 받는다. 못 받으면 발밑에 떨어진다
        for (const i of [102, 103]) {
          this.removeQItem(p, 5, i, -1);
          if (!this.game.giveItem(p, 5, i, 1)) p.world.dropItem(p, [5, i, 1]);
        }
        this.msg(p, 0x77); return true;
      case 'KasamQuest4End':
        if (!has(p, 0x400)) { this.set(p, 0x400); this.reward(p, 400, 50, 50, 400); }
        this.msg(p, 0x77); this.sendInfo(p, false); return true;
      case 'SayKasamRecollectEnd': this.set(p, 0x800); this.sendInfo(p, true); return true;
      case 'KasamRecollectQuestEnd': this.set(p, 0x1000); return true;
      case 'KasamSpaceShipQuestEnd': this.set(p, 0x8000); return true;
      case 'IncreaseRecollectBonus': p.recollect = (p.recollect || 0) + 1; return true;
      case 'RecollectQuestEnd':
        if (!has(p, 0x2000)) {
          this.set(p, 0x6000);                            // 0x4000 은 우주선 우편 프로시저가 켠다
          const k = Math.min(4, (p.recollect || 0) + 1); p.recollect = 0;
          const gain = this.game.gainExp(p, Math.floor(F.expTable[500] / 50) * k);
          if (gain) this.msg(p, 0x7d, gain);
          if ((p.fame || 0) !== 0) { const f = this.increaseAbsFame(p, k * 10); if (f) this.msg(p, 0x7c, f); }
          this.msg(p, 0x7b, 500);
          this.mail(p, 'RMS_KASAMSPACESHIPMAIL');
        }
        this.sendInfo(p, true); return true;
    }
    return false;
  }
}

module.exports = { Story, ready, questInfo, hasQItem };
