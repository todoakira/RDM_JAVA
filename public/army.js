'use strict';
// 군단 창들. 그림과 자리는 Main.dll 의 창 초기화 함수에서 읽은 값 (docs/army_notes.md).
//  ia-z18-ba 군단 컴퓨터 (0x10062660), ia-z38-ba 예비 군단 목록 (0x100600b0), ia-z36-ba 예비 군단 만들기 (0x10061a40),
//  ia-z35-ba 예비 군단 상세 (0x1005e440), ia-z22-ba 군단 만들기 정보 (0x1004c350), ia-z8-ba 핵심 멤버 (0x1005ae60), n-ia-ib-ba 군단 정보 (0x1003e870)
// 단추가 하는 일은 각 창의 단추 처리 함수가 부르는 보내기 함수로 확인했다 (예: 예비 목록의 세 그림 단추 = 0x70c 만들기, 0x70a 새로 읽기, 0x710 찾기).
const ArmyUI = (() => {
  const el = id => document.getElementById(id);
  const M0 = c => UI.M0(c);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const A = o => send(Object.assign({ t: 'army' }, o));
  // 창 하나: 원작 배경 그림, 화면 가운데 (원작의 이 창들 기본 위치는 아직 찾지 못했다)
  function win(id, img, w, h) {
    let d = el(id); if (d) return d;
    d = document.createElement('div'); d.id = id; d.className = 'win armyw';
    d.style.cssText = `display:none;position:fixed;left:calc(50% - ${w >> 1}px);top:calc(50% - ${h >> 1}px);width:${w}px;height:${h}px;background:url(assets/int/${img}.png);z-index:22`;
    document.body.appendChild(d); return d;
  }
  // 그림 단추: 위·아래 두 칸 (보통, 눌림)
  function btn(d, img, x, y, w, h, fn, label) {
    const b = document.createElement('div'); b.className = 'pbtn';
    b.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;background-image:url(assets/int/${img}.png)`;
    if (label) { b.textContent = label; b.style.cssText += ';color:#fff;font:12px sans-serif;line-height:' + h + 'px;text-align:center;text-shadow:0 0 2px #000'; }
    b.onclick = fn; d.appendChild(b); return b;
  }
  function text(d, x, y, w, h, t, cls) { const s = document.createElement('div'); s.className = 'txt ' + (cls || ''); s.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;color:#fff`; s.textContent = t || ''; d.appendChild(s); return s; }
  function input(d, x, y, w, h, max, type) { const i = document.createElement(type === 'area' ? 'textarea' : 'input'); i.className = 'xwin'; if (type === 'pw') i.type = 'password'; i.maxLength = max; i.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;resize:none`; d.appendChild(i); return i; }
  const show = d => { d.style.display = 'block'; }, hide = d => { d.style.display = 'none'; };

  // ---- 군단 컴퓨터: PENDING (0x70a), IMMEDIATE (0x714), MANAGE (비밀번호 0/0/0x101 → 0x726)
  function computer() {
    const d = win('arComp', 489, 146, 130);
    if (!d.dataset.ok) {
      d.dataset.ok = 1;
      btn(d, 490, 24, 18, 97, 23, () => A({ a: 'reserves' }), M0(0xe6).trim());
      btn(d, 490, 24, 44, 97, 23, () => A({ a: 'try' }), M0(0xe7).trim());
      btn(d, 490, 24, 69, 97, 23, () => UI.msgBox(M0(0x101), ['ok', 'cancel'], (y, v) => { if (y) A({ a: 'login', password: v }); }, true), M0(0xe8).trim());
      btn(d, 553, 42, 99, 60, 20, () => hide(d));
    }
    show(d);
  }
  // ---- 예비 군단 목록 (0x70b): 이름, 사람 수, 만든 날. 두 번 누르면 상세 (0/0/0x1a7)
  let rsSel = '';
  function reserves(m) {
    const d = win('arRes', 512, 250, 186);
    if (!d.dataset.ok) {
      d.dataset.ok = 1;
      btn(d, 529, 20, 12, 33, 32, () => A({ a: 'reservetry' }));
      btn(d, 530, 54, 12, 34, 32, () => A({ a: 'reserves' }));
      const q = input(d, 97, 21, 75, 16, 10);
      btn(d, 531, 186, 14, 35, 29, () => A({ a: 'reserves', like: q.value.trim() }));
      text(d, 26, 47, 94, 16, M0(0x192)); text(d, 120, 47, 42, 16, M0(0x193)); text(d, 162, 47, 58, 16, M0(0x194));
      const l = document.createElement('div'); l.id = 'arResList'; l.style.cssText = 'position:absolute;left:26px;top:72px;width:194px;height:68px;overflow-y:auto;font:12px/17px sans-serif;color:#fff'; d.appendChild(l);
      btn(d, 553, 95, 154, 60, 20, () => hide(d));
    }
    const l = el('arResList'); l.innerHTML = '';
    for (const r of m.list) {
      const row = document.createElement('div'); row.className = 'pxl'; row.style.display = 'flex';
      const dt = new Date(r.at); const day = `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}`;
      row.innerHTML = `<span style="width:94px">${esc(r.name)}</span><span style="width:42px">${r.n}</span><span>${day}</span>`;
      row.onclick = () => { rsSel = r.name; for (const c of l.children) c.classList.toggle('on', c === row); };
      row.ondblclick = () => A({ a: 'reserveinfo', name: r.name });
      l.appendChild(row);
    }
    UI.sysLine(M0(m.list.length ? 0x1a7 : 0x1a8));
    show(d);
  }
  // ---- 예비 군단 만들기 (0x70d): 이름 10자, 공지
  function reserveNew() {
    const d = win('arResNew', 510, 213, 165);
    if (!d.dataset.ok) {
      d.dataset.ok = 1;
      text(d, 12, 25, 78, 12, M0(0xe9)); text(d, 12, 44, 78, 14, M0(0xec));
      const n = input(d, 95, 25, 85, 12, 10); n.id = 'arResName';
      const t = input(d, 34, 65, 152, 61, 84, 'area'); t.id = 'arResNotice';
      btn(d, 560, 54, 134, 47, 20, () => { if (n.value.trim()) A({ a: 'reservenew', name: n.value.trim(), notice: t.value }); });
      btn(d, 457, 104, 134, 60, 20, () => hide(d));
    }
    el('arResName').value = ''; el('arResNotice').value = ''; show(d);
  }
  // ---- 예비 군단 상세 (0x713): 이름, 군단장, 멤버, 공지. 아래 단추 넷 = 바로 만들기(0x714), 해산(0x792), 들기(0x720), 닫기
  let rsInfo = null;
  function reserveInfo(m) {
    rsInfo = m; const d = win('arResInfo', 509, 213, 352);
    if (!d.dataset.ok) {
      d.dataset.ok = 1;
      text(d, 12, 25, 78, 12, M0(0xe9)); text(d, 12, 58, 78, 12, M0(0xed)); text(d, 12, 92, 78, 12, M0(0xee)); text(d, 12, 218, 78, 12, M0(0xec));
      text(d, 91, 25, 86, 14).id = 'arRiName'; text(d, 91, 58, 86, 14).id = 'arRiCmd'; text(d, 91, 92, 40, 14).id = 'arRiCnt';
      const l = text(d, 52, 134, 108, 72); l.id = 'arRiMembers'; l.style.overflowY = 'auto';
      const t = text(d, 27, 236, 160, 60); t.id = 'arRiNotice';
      btn(d, 532, 91, 301, 23, 22, () => A({ a: 'try' }));                                                    // ia-zb2-bu
      btn(d, 534, 91, 322, 23, 21, () => UI.msgBox(M0(0x151), ['yes', 'no'], y => { if (y) A({ a: 'reservebreak', commander: rsInfo.commander }); }));   // ia-zb4-bu
      btn(d, 528, 44, 310, 22, 23, () => A({ a: 'reservejoin', commander: rsInfo.commander }));                   // ia-zb1-bu
      btn(d, 533, 139, 310, 23, 23, () => hide(d));                                                               // ia-zb3-bu
    }
    el('arRiName').textContent = m.name; el('arRiCmd').textContent = m.commander; el('arRiCnt').textContent = m.members.length + 1;
    el('arRiMembers').textContent = m.members.join('\n'); el('arRiNotice').textContent = m.notice;
    show(d);
  }
  // ---- 군단 만들기 정보 (0x715): 이름, 군단장 비밀번호, 확인, 문장 10×10 (자리 (36+16x, 145+16y), 진영 1 은 1~100, 진영 2 는 101~200)
  let crest = 0, camp = 1, used = [];
  function create(m) {
    camp = m.camp; used = m.used; crest = 0; const d = win('arCreate', 496, 228, 347);
    if (!d.dataset.ok) {
      d.dataset.ok = 1;
      text(d, 20, 30, 100, 12, M0(0xe9)); text(d, 20, 65, 100, 17, M0(0xf0)); text(d, 20, 104, 99, 14, M0(0x10e)); text(d, 20, 130, 100, 14, M0(0xf1));
      input(d, 114, 20, 82, 18, 10).id = 'arCrName'; input(d, 114, 58, 82, 18, 20, 'pw').id = 'arCrPw'; input(d, 114, 97, 82, 18, 20, 'pw').id = 'arCrPw2';
      const g = document.createElement('div'); g.id = 'arCrGrid'; g.style.cssText = 'position:absolute;left:36px;top:145px;width:160px;height:160px'; d.appendChild(g);
      btn(d, 560, 64, 312, 47, 20, () => {
        const pw = el('arCrPw').value; if (!pw || pw !== el('arCrPw2').value) { UI.msgBox(M0(0x153), ['ok']); return; }
        if (!crest) return;
        A({ a: 'create', name: el('arCrName').value.trim(), password: pw, mark: crest });
      });
      btn(d, 457, 112, 312, 60, 20, () => { hide(d); });
    }
    el('arCrName').value = m.name || ''; el('arCrName').readOnly = !!m.name; el('arCrPw').value = el('arCrPw2').value = '';
    drawGrid(); show(d);
  }
  // 문장 (Main.dll 0x100012f0): 모양 = (번호-1)/10 → is-i0~19-bu (진영 2 는 10~19), 색 = 나머지 10 가지 → 색 표 0x100c777c 로 물들인다.
  // 그 색 표는 실행 중에 채워져 아직 값을 읽지 못해 모양 그림만 원래 색(회색)으로 그린다. 이미 쓰는 문장은 원작처럼 그리지 않는다. 고른 것에는 is-f2-bu 틀
  const SHAPE = [294, 295, 296, 297, 298, 299, 300, 301, 302, 303, 535, 536, 537, 538, 539, 540, 541, 542, 543, 544];
  const crestImg = mk => SHAPE[Math.floor((mk - 1) / 10)];
  function drawGrid() {
    const g = el('arCrGrid'); g.innerHTML = '';
    for (let k = 0; k < 100; k++) {
      const mk = (camp === 2 ? 101 : 1) + k; if (used.includes(mk)) continue;
      const c = document.createElement('div');
      c.style.cssText = `position:absolute;left:${(k % 10) * 16}px;top:${Math.floor(k / 10) * 16}px;width:15px;height:15px;cursor:pointer;background:url(assets/int/${crestImg(mk)}.png)`;
      c.title = mk;
      if (mk === crest) { const f = document.createElement('div'); f.style.cssText = 'position:absolute;inset:0;background:url(assets/int/293.png)'; c.appendChild(f); }
      c.onclick = () => { crest = mk; drawGrid(); };
      g.appendChild(c);
    }
  }
  // ---- 핵심 멤버 (0x717): + 초대 (0x718), − 빼기 (0x71a), OK 마침 (0x71c), CANCEL 취소 (0x71e)
  let core = [];
  function coreWin(m) {
    hide(el('arCreate') || document.createElement('div'));
    core = m.members.slice(); const d = win('arCore', 524, 214, 279);
    if (!d.dataset.ok) {
      d.dataset.ok = 1;
      text(d, 30, 20, 110, 12, M0(0xf2));
      const n = input(d, 30, 44, 110, 16, 14); n.id = 'arCoreName';
      btn(d, 555, 147, 42, 23, 20, () => { if (n.value.trim()) A({ a: 'invite', name: n.value.trim() }); });
      btn(d, 554, 173, 42, 23, 20, () => { const v = n.value.trim() || core.sel; if (v) A({ a: 'uninvite', name: v }); });
      const l = text(d, 30, 87, 132, 151); l.id = 'arCoreList'; l.style.overflowY = 'auto'; l.style.pointerEvents = 'auto';
      btn(d, 560, 39, 248, 47, 20, () => A({ a: 'form' }));
      btn(d, 457, 89, 248, 60, 20, () => { A({ a: 'cancel' }); hide(d); });
    }
    drawCore(); show(d);
  }
  function drawCore() {
    const l = el('arCoreList'); l.innerHTML = '';
    for (const n of core) { const r = document.createElement('div'); r.className = 'pxl'; r.textContent = n; r.onclick = () => { core.sel = n; el('arCoreName').value = n; }; l.appendChild(r); }
  }
  // ---- 군단 정보 (F9, n-ia-ib-ba 309×388, 0x1003e870): 글 칸 자리는 창 초기화 함수를 돌려 얻은 값
  //   이름 (70,60), 군단장 0/0/0xdb (50,80), 부관 0/0/0xdc (50,94), 동맹 0/0/0xdd (50,108), 군단 공지 0/0/0xde (48,163)→(50,180), 부대 공지 0/0/0xdf (48,211)→(50,230), 상태 0/0/0xe0 (48,261)→(50,278)
  //   아래 단추 일곱: 군단 탈퇴(0/0/0x148), 부대 탈퇴(0x149), 정규병·용병·부대원 모집, 홀로 돌아가기(0x1a5), 멤버에게 가기(0x1a4). 닫기 (279,9)
  function info(m) {
    const d = win('arInfo', 556, 309, 388);
    if (!d.dataset.ok) {
      d.dataset.ok = 1;
      text(d, 70, 60, 180, 14).id = 'arInName'; text(d, 50, 80, 200, 14).id = 'arInCmd'; text(d, 50, 94, 200, 14).id = 'arInLt';
      text(d, 50, 108, 100, 14, M0(0xdd)); text(d, 48, 163, 192, 13, M0(0xde)); text(d, 48, 211, 192, 13, M0(0xdf)); text(d, 48, 261, 192, 13, M0(0xe0));
      text(d, 50, 122, 200, 36).id = 'arInAll'; text(d, 50, 180, 210, 25).id = 'arInNotice'; text(d, 50, 230, 210, 25).id = 'arInUnit'; text(d, 50, 278, 210, 26).id = 'arInStat';
      const no = () => UI.sysLine('아직 없는 기능입니다.');
      btn(d, 470, 76, 348, 24, 23, () => UI.msgBox(M0(0x148).trim(), ['yes', 'no'], y => { if (y) A({ a: 'withdraw' }); }));
      btn(d, 471, 99, 348, 22, 23, () => UI.msgBox(M0(0x149), ['yes', 'no'], y => { if (y) A({ a: 'unitquit' }); }));
      btn(d, 472, 121, 348, 24, 23, () => employ(1));
      btn(d, 473, 145, 348, 23, 23, no);
      btn(d, 474, 169, 348, 22, 23, () => employ(3));
      btn(d, 475, 191, 348, 24, 23, () => UI.msgBox(M0(0x1a5), ['yes', 'no'], y => { if (y) no(); }));
      btn(d, 476, 214, 348, 24, 23, () => UI.msgBox(M0(0x1a4), ['ok', 'cancel'], (y, v) => { if (y && v) no(); }, true));
      btn(d, 477, 279, 9, 22, 22, () => hide(d));
    }
    const f = (c, v) => fmt(M0(c), v || '');
    el('arInName').textContent = m.none ? '' : m.name; el('arInCmd').textContent = m.none ? '' : f(0xdb, m.commander); el('arInLt').textContent = m.none ? '' : f(0xdc, m.lt ? `${m.lt} (${m.unit})` : '');
    el('arInAll').textContent = m.none ? '' : (m.allies || []).join(', '); el('arInNotice').textContent = m.none ? '' : m.notice; el('arInUnit').textContent = m.none ? '' : m.unitNotice || ''; el('arInStat').textContent = '';
    show(d);
  }
  // ---- 모집 (ia-z11-ba 235×114, 0x100415a0): 이름칸 (36,53)~(151,70), + 넣기 (166,53), − 빼기 (192,53), 닫기 (56,81). 문장 0/0/0x155
  //   같은 창을 부관 임명·해임(0x72e, 문장 0/0/0x156)과 부대원 모집(0x780)에도 쓴다 (받는 패킷 0x731, 0x1001ed50)
  let empKind = 1;
  function employ(kind) {
    empKind = kind; const d = win('arEmp', 482, 235, 114);
    if (!d.dataset.ok) {
      d.dataset.ok = 1;
      text(d, 18, 24, 207, 22).id = 'arEmpText';
      const n = input(d, 36, 53, 115, 17, 14); n.id = 'arEmpName';
      const go = fire => { const v = n.value.trim(); if (!v) return;
        if (empKind === 'lt') A({ a: 'appoint', name: v, on: fire ? 0 : 1 }); else if (empKind === 3) A({ a: 'unithire', name: v, fire }); else A({ a: 'hire', name: v, fire }); };
      btn(d, 555, 166, 53, 23, 20, () => go(0));
      btn(d, 554, 192, 53, 23, 20, () => go(1));
      btn(d, 553, 56, 81, 60, 20, () => hide(d));
    }
    el('arEmpText').textContent = M0(kind === 'lt' ? 0x156 : 0x155);
    el('arEmpName').value = ''; show(d);
  }
  // ---- 관리 (0x727 → ia-z20-ba 136×325, 0x100534f0): 단추 아홉 ia-z20-bu (19, 49+약 25.4k), 글 0/0/0xf3~0xfb, 닫기 (35,281)
  //   부관 관리(0x72c)·동맹·전쟁(0x748)·공지·멤버(0x754)·군단장 관리·홀(0x75c)·본부(0x79c)·해산(0/0/0x65)
  const Z20_TOP = [49, 75, 101, 127, 152, 176, 202, 227, 252];
  function manage() {
    const d = win('arMng', 492, 136, 325);
    if (!d.dataset.ok) {
      d.dataset.ok = 1;
      const no = () => UI.sysLine('아직 없는 기능입니다.');
      const act = [() => ltMenu(), () => allyMenu(), no, () => bulletin(), () => A({ a: 'members' }), () => cmdMenu(), no, no,
        () => UI.msgBox(M0(0x65), ['yes', 'no'], y => { if (y) { A({ a: 'breakup' }); hide(d); } })];
      act.forEach((fn, k) => btn(d, 493, 19, Z20_TOP[k], 97, 23, fn, M0(0xf3 + k).trim()));
      btn(d, 553, 35, 281, 60, 20, () => hide(d));
    }
    show(d);
  }
  // 공지 고르기 (ia-z21-ba 190×108, 0x100579c0): 단추 둘 ia-z21-bu (22,19) (22,44), 닫기 (64,76)
  function bulletin() {
    const d = win('arBul', 494, 190, 108);
    if (!d.dataset.ok) {
      d.dataset.ok = 1;
      btn(d, 495, 22, 19, 148, 23, () => { A({ a: 'notice' }); hide(d); }, M0(0x11e).trim());
      btn(d, 495, 22, 44, 148, 23, () => { A({ a: 'notice', kind: 2 }); hide(d); }, M0(0x11f).trim());
      btn(d, 553, 64, 76, 60, 20, () => hide(d));
    }
    show(d);
  }
  // 군단장 관리 (ia-z21-ba 둘째, 0x10057220): 비밀번호 바꾸기 0/0/0x128, 군단장 넘기기 0x129 — 아직 없음
  function cmdMenu() {
    const d = win('arCmd', 494, 190, 108);
    if (!d.dataset.ok) {
      d.dataset.ok = 1;
      btn(d, 495, 22, 19, 148, 23, () => pwWin('cmdpw'), M0(0x128).trim());
      btn(d, 495, 22, 44, 148, 23, () => UI.msgBox(M0(0x12a), ['ok', 'cancel'], (y, v) => { if (y && v) A({ a: 'transfer', name: v }); }, true), M0(0x129).trim());
      btn(d, 553, 64, 76, 60, 20, () => hide(d));
    }
    show(d);
  }
  // 공지 쓰기 (ia-z15-ba 255×166, 0x1005a1b0): 지금 공지 0/0/0x120 (30,15), 새 공지 0/0/0x121 (30,70), OK (107,130), CANCEL (159,130)
  let noticeKind = 1;
  function noticeWin(cur, kind) {
    noticeKind = kind || 1;
    const d = win('arNot', 487, 255, 166);
    if (!d.dataset.ok) {
      d.dataset.ok = 1;
      text(d, 30, 15, 203, 13, M0(0x120)); text(d, 30, 70, 203, 15, M0(0x121));
      text(d, 36, 34, 186, 29).id = 'arNotCur';
      const t = input(d, 36, 88, 186, 36, 62, 'area'); t.id = 'arNotNew';
      btn(d, 560, 107, 130, 47, 20, () => { A({ a: 'notice', text: t.value, kind: noticeKind }); hide(d); });
      btn(d, 457, 159, 130, 60, 20, () => hide(d));
    }
    el('arNotCur').textContent = cur; el('arNotNew').value = ''; show(d);
  }
  // 멤버 (ia-z4-ba 214×547, 0x100507b0): CMD (50,38) 이름 (90,38), LT (50,63), UNIT (50,174), REG (50,285), MERC (50,395), 목록은 그 아래 칸. 닫기 (77,512)
  function members(m) {
    const d = win('arMem', 514, 214, 547);
    if (!d.dataset.ok) {
      d.dataset.ok = 1;
      [[0x122, 38], [0x123, 63], [0x124, 174], [0x125, 285], [0x126, 395]].forEach(([c, y]) => text(d, 50, y, 40, 14, M0(c)));
      text(d, 90, 38, 90, 14).id = 'arMemCmd';
      [['arMemLt', 88], ['arMemUnit', 200], ['arMemReg', 311], ['arMemMerc', 421]].forEach(([id, y]) => { const t = text(d, 50, y, 113, 78); t.id = id; t.style.overflowY = 'auto'; t.style.pointerEvents = 'auto'; });
      btn(d, 553, 77, 512, 60, 20, () => hide(d));
    }
    el('arMemCmd').textContent = m.commander; el('arMemUnit').textContent = ''; el('arMemReg').textContent = m.members.join('\n');
    const lt = el('arMemLt'); lt.innerHTML = '';
    for (const n of m.lts || []) { const r = document.createElement('div'); r.className = 'pxl'; r.textContent = n; r.onclick = () => A({ a: 'unit', name: n }); lt.appendChild(r); } el('arMemMerc').textContent = '';
    UI.sysLine(M0(0x1a9));
    show(d);
  }
  // ---- 부관 관리 (0x72d → ia-z12-ba 210×164, 0x10058190): 단추 넷 ia-z12-bu (23,20/46/73/99) 0/0/0xfc~0xff, CANCEL (74,131)
  function ltMenu() {
    const d = win('arLt', 483, 210, 164);
    if (!d.dataset.ok) {
      d.dataset.ok = 1;
      btn(d, 484, 23, 20, 160, 23, () => employ('lt'), M0(0xfc).trim());
      btn(d, 484, 23, 46, 160, 23, () => UI.msgBox(M0(0x104), ['ok', 'cancel'], (y, from) => { if (y && from) UI.msgBox(M0(0x155), ['ok', 'cancel'], (y2, to) => { if (y2 && to) A({ a: 'changelt', from, to }); }, true); }, true), M0(0xfd).trim());
      btn(d, 484, 23, 73, 160, 23, () => permWin(), M0(0xfe).trim());
      btn(d, 484, 23, 99, 160, 23, () => pwWin('ltpw'), M0(0xff).trim());
      btn(d, 457, 74, 131, 60, 20, () => hide(d));
    }
    show(d);
  }
  // ---- 권한 (0x737 → ia-z16-ba 210×284, 0x1005c750): 부관 이름칸 (80,25), 찾기 ia-z6-bu (181,22), 권한 여섯 0/0/0x105~0x10a (20, 74+약 28.6k),
  //   칸마다 두 단추 ia-z6s-bu (126,y)(160,y) = 줌·뺌, OK (53,253), CANCEL (103,253). 비트 1 모집, 2 용병, 4 아이템, 8 돈, 16 구매, 32 홀 (RMS_ARMY_CHANGEPERMISSION)
  const PERM_Y = [74, 103, 131, 159, 188, 217];
  let perm = 0;
  function permWin() {
    const d = win('arPerm', 488, 210, 284);
    if (!d.dataset.ok) {
      d.dataset.ok = 1;
      text(d, 20, 25, 58, 14, M0(0x104));
      const n = input(d, 82, 25, 92, 14, 14); n.id = 'arPermName';
      btn(d, 520, 181, 22, 19, 19, () => { if (n.value.trim()) A({ a: 'getperm', name: n.value.trim() }); });
      PERM_Y.forEach((y, k) => {
        text(d, 20, y, 100, 18, M0(0x105 + k));
        btn(d, 521, 126, y, 18, 17, () => { perm |= 1 << k; drawPerm(); }).id = 'arPermOn' + k;
        btn(d, 521, 160, y, 18, 17, () => { perm &= ~(1 << k); drawPerm(); }).id = 'arPermOff' + k;
      });
      btn(d, 560, 53, 253, 47, 20, () => { if (n.value.trim()) A({ a: 'setperm', name: n.value.trim(), perm }); });
      btn(d, 457, 103, 253, 60, 20, () => hide(d));
    }
    perm = 0; drawPerm(); el('arPermName').value = ''; show(d);
  }
  function drawPerm() { if (!el('arPermOn0')) return; for (let k = 0; k < 6; k++) { const on = !!(perm & (1 << k)); el('arPermOn' + k).style.backgroundPosition = on ? '0 100%' : '0 0'; el('arPermOff' + k).style.backgroundPosition = on ? '0 0' : '0 100%'; } }
  // ---- 비밀번호 (ia-z23-ba 227×141, 0x1004b440): ENTER PW 0/0/0x10d (20,27), CONFIRM PW 0/0/0x10e (20,70), OK (61,105), CANCEL (109,105)
  //   군단장 비밀번호(0x756), 부관 비밀번호(0x73e), 군단장을 넘겨받을 때·부관이 바뀔 때의 새 비밀번호에 쓴다
  let pwThen = null;
  function pwWin(kind, then) {
    pwThen = then || (pw => A({ a: kind, password: pw }));
    const d = win('arPw', 497, 227, 141);
    if (!d.dataset.ok) {
      d.dataset.ok = 1;
      text(d, 20, 27, 90, 15, M0(0x10d)); text(d, 20, 70, 90, 18, M0(0x10e));
      input(d, 122, 27, 73, 15, 10, 'pw').id = 'arPw1'; input(d, 122, 70, 73, 18, 10, 'pw').id = 'arPw2';
      btn(d, 560, 61, 105, 47, 20, () => { const a = el('arPw1').value; if (!a || a !== el('arPw2').value) { UI.msgBox(M0(0x153), ['ok']); return; } hide(d); pwThen(a); });
      btn(d, 457, 109, 105, 60, 20, () => { hide(d); if (pwThen.cancel) pwThen.cancel(); });
    }
    el('arPw1').value = el('arPw2').value = ''; show(d);
  }
  // ---- 부관으로 임명될 때 (0/0/0x195, 0x197 → ia-z13-ba 220×195, 0x10045c10): 부대 이름 0/0/0x100, 비밀번호 0x101, 확인 0x10e, OK (57,165), CANCEL (106,165)
  let ltAsk = null;
  function ltWin(m) {
    ltAsk = m; const d = win('arLtNew', 485, 220, 195);
    if (!d.dataset.ok) {
      d.dataset.ok = 1;
      text(d, 18, 16, 186, 12, M0(0x100)); text(d, 18, 64, 186, 12, M0(0x101)); text(d, 18, 112, 186, 12, M0(0x10e));
      input(d, 66, 31, 88, 16, 10).id = 'arLtUnit'; input(d, 66, 81, 88, 16, 10, 'pw').id = 'arLtPw'; input(d, 66, 131, 88, 16, 10, 'pw').id = 'arLtPw2';
      btn(d, 560, 57, 165, 47, 20, () => {
        const u = el('arLtUnit').value.trim(), pw = el('arLtPw').value; if (!u) { UI.msgBox(M0(0x100), ['ok']); return; }
        if (!pw || pw !== el('arLtPw2').value) { UI.msgBox(M0(0x153), ['ok']); return; }
        A({ a: 'appointans', commander: ltAsk.commander, ok: 1, unit: u, password: pw }); hide(d);
      });
      btn(d, 457, 106, 165, 60, 20, () => { A({ a: 'appointans', commander: ltAsk.commander, ok: 0 }); hide(d); });
    }
    for (const id of ['arLtUnit', 'arLtPw', 'arLtPw2']) el(id).value = '';
    UI.sysLine(fmt(M0(0x195), m.commander, m.army)); UI.sysLine(M0(0x197)); show(d);
  }
  // ---- 동맹 (ia-z7-ba 129×105, 0x10055540): Form 0/0/0x10f (18,16) → 0x740, Dissolve 0x110 (18,42) → 0x78e, 닫기 (34,72)
  function allyMenu() {
    const d = win('arAlly', 522, 129, 105);
    if (!d.dataset.ok) {
      d.dataset.ok = 1;
      btn(d, 523, 18, 16, 93, 23, () => A({ a: 'allyclick' }), M0(0x10f).trim());
      btn(d, 523, 18, 42, 93, 23, () => A({ a: 'allybreakclick' }), M0(0x110).trim());
      btn(d, 553, 34, 72, 60, 20, () => hide(d));
    }
    show(d);
  }
  // 동맹 신청 (0x741 → ia-z23-ba, 0x10046c00): Army Name: 0/0/0x111 (12,27), Amount: 0x112 (12,70), OK (61,105), CANCEL (109,105)
  function allyAsk() {
    const d = win('arAllyAsk', 497, 227, 141);
    if (!d.dataset.ok) {
      d.dataset.ok = 1;
      text(d, 12, 27, 98, 15, M0(0x111)); text(d, 12, 70, 98, 18, M0(0x112));
      input(d, 122, 27, 73, 15, 10).id = 'arAaName'; input(d, 122, 70, 73, 18, 10).id = 'arAaAmt';
      btn(d, 560, 61, 105, 47, 20, () => { const n = el('arAaName').value.trim(); if (n) { A({ a: 'ally', name: n, amount: parseInt(el('arAaAmt').value, 10) || 0 }); hide(d); } });
      btn(d, 457, 109, 105, 60, 20, () => hide(d));
    }
    el('arAaName').value = ''; el('arAaAmt').value = '0'; show(d);
  }
  // 동맹 깨기 (0x78f → ia-z14-ba 230×108, 0x10049d60): Army Name 0/0/0x113, 이름칸 (74,47)~(170,64), OK (64,77), CANCEL (113,77)
  function allyBreak() {
    const d = win('arAllyBrk', 486, 230, 108);
    if (!d.dataset.ok) {
      d.dataset.ok = 1;
      text(d, 17, 30, 198, 14, M0(0x113));
      input(d, 74, 47, 96, 17, 10).id = 'arAbName';
      btn(d, 560, 64, 77, 47, 20, () => { const n = el('arAbName').value.trim(); if (n) { A({ a: 'allybreak', name: n }); hide(d); } });
      btn(d, 457, 113, 77, 60, 20, () => hide(d));
    }
    el('arAbName').value = ''; show(d);
  }
  function handle(m) {
    switch (m.w) {
      case 'computer': computer(); break;
      case 'reserves': reserves(m); break;
      case 'reservenew': reserveNew(); break;
      case 'reservemade': hide(el('arResNew')); UI.sysLine(M0(0x199)); break;
      case 'reserveinfo': reserveInfo(m); break;
      case 'reservegone': UI.sysLine(M0(0x1a8)); break;
      case 'joined': UI.sysLine(M0(0x19d)); break;
      case 'create': create(m); break;
      case 'core': coreWin(m); break;
      case 'coreadd': core.push(m.name); drawCore(); UI.sysLine(M0(0x19a)); break;
      case 'coredel': core = core.filter(n => n !== m.name); drawCore(); UI.sysLine(M0(0x19b)); break;
      case 'formed': hide(el('arCore')); hide(el('arComp') || document.createElement('div')); UI.sysLine(M0(0x19c)); break;
      case 'askcore': UI.msgBox(fmt(M0(0x157), m.army, m.commander), ['yes', 'no'], y => A({ a: 'inviteans', commander: m.commander, ok: y ? 1 : 0 })); break;
      case 'askjoin': UI.msgBox(fmt(M0(0x158), m.army, m.commander), ['yes', 'no'], y => A({ a: 'hireans', commander: m.commander, ok: y ? 1 : 0 })); break;
      case 'info': info(m); break;
      case 'members': members(m); break;
      case 'manage': manage(); break;
      case 'notice': noticeWin(m.text, m.kind); break;
      case 'noticed': UI.sysLine(M0(0x19e)); break;
      case 'badge': UI.armyName = m.name; break;
      case 'perm': perm = m.perm; drawPerm(); break;
      case 'allyask': allyAsk(); break;
      case 'allybreak': allyBreak(); break;
      case 'allybroken': UI.sysLine(M0(0x1a2)); break;
      case 'askally': UI.msgBox(fmt(M0(0x15b), m.commander, m.army, m.amount), ['yes', 'no'], y => A({ a: 'allyans', commander: m.commander, ok: y ? 1 : 0 })); break;
      case 'permdone': UI.sysLine(M0(0x1a1)); break;
      case 'pwchanged': UI.sysLine(M0(0x198)); break;
      case 'unit': el('arMemUnit').textContent = m.members.join('\n'); break;
      case 'asklt': ltWin(m); break;
      case 'ltdone': UI.sysLine(M0(0x19f)); break;
      case 'askltchange': UI.msgBox(fmt(M0(0x196), m.unit, m.from), ['yes', 'no'], y => {
        if (!y) { A({ a: 'changeltans', commander: m.commander, ok: 0 }); return; }
        const f = pw => A({ a: 'changeltans', commander: m.commander, ok: 1, password: pw }); f.cancel = () => A({ a: 'changeltans', commander: m.commander, ok: 0 }); pwWin('', f); }); break;
      case 'askcmd': UI.msgBox(fmt(M0(0x15c), m.commander, m.army), ['yes', 'no'], y => {
        if (!y) { A({ a: 'transferans', commander: m.commander, ok: 0 }); return; }
        const f = pw => A({ a: 'transferans', commander: m.commander, ok: 1, password: pw }); f.cancel = () => A({ a: 'transferans', commander: m.commander, ok: 0 }); pwWin('', f); }); break;
      case 'askunit': UI.msgBox(fmt(M0(0x159), m.unit, m.army), ['yes', 'no'], y => A({ a: 'unitans', ok: y ? 1 : 0 })); break;
    }
  }
  const fmt = (t, ...a) => { let k = 0; return t.replace(/%[sud]/g, () => String(a[k++] ?? '')); };
  return { handle, open: () => A({ a: 'info' }) };
})();
