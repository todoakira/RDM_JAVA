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
      btn(d, 471, 99, 348, 22, 23, () => UI.msgBox(M0(0x149), ['yes', 'no'], y => { if (y) no(); }));
      btn(d, 472, 121, 348, 24, 23, () => employ(1));
      btn(d, 473, 145, 348, 23, 23, no);
      btn(d, 474, 169, 348, 22, 23, no);
      btn(d, 475, 191, 348, 24, 23, () => UI.msgBox(M0(0x1a5), ['yes', 'no'], y => { if (y) no(); }));
      btn(d, 476, 214, 348, 24, 23, () => UI.msgBox(M0(0x1a4), ['ok', 'cancel'], (y, v) => { if (y && v) no(); }, true));
      btn(d, 477, 279, 9, 22, 22, () => hide(d));
    }
    const f = (c, v) => fmt(M0(c), v || '');
    el('arInName').textContent = m.none ? '' : m.name; el('arInCmd').textContent = m.none ? '' : f(0xdb, m.commander); el('arInLt').textContent = m.none ? '' : f(0xdc, '');
    el('arInAll').textContent = ''; el('arInNotice').textContent = m.none ? '' : m.notice; el('arInUnit').textContent = ''; el('arInStat').textContent = '';
    show(d);
  }
  // ---- 모집 (ia-z11-ba 235×114, 0x100415a0): 이름칸 (36,53)~(151,70), + 넣기 (166,53), − 빼기 (192,53), 닫기 (56,81). 문장 0/0/0x155
  function employ(kind) {
    const d = win('arEmp', 482, 235, 114);
    if (!d.dataset.ok) {
      d.dataset.ok = 1;
      text(d, 18, 24, 207, 22, M0(0x155));
      const n = input(d, 36, 53, 115, 17, 14); n.id = 'arEmpName';
      btn(d, 555, 166, 53, 23, 20, () => { if (n.value.trim()) A({ a: 'hire', name: n.value.trim() }); });
      btn(d, 554, 192, 53, 23, 20, () => { if (n.value.trim()) A({ a: 'hire', name: n.value.trim(), fire: 1 }); });
      btn(d, 553, 56, 81, 60, 20, () => hide(d));
    }
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
      const act = [no, no, no, () => bulletin(), () => A({ a: 'members' }), () => cmdMenu(), no, no,
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
      btn(d, 495, 22, 44, 148, 23, () => UI.sysLine('아직 없는 기능입니다.'), M0(0x11f).trim());
      btn(d, 553, 64, 76, 60, 20, () => hide(d));
    }
    show(d);
  }
  // 군단장 관리 (ia-z21-ba 둘째, 0x10057220): 비밀번호 바꾸기 0/0/0x128, 군단장 넘기기 0x129 — 아직 없음
  function cmdMenu() {
    const d = win('arCmd', 494, 190, 108);
    if (!d.dataset.ok) {
      d.dataset.ok = 1;
      btn(d, 495, 22, 19, 148, 23, () => UI.sysLine('아직 없는 기능입니다.'), M0(0x128).trim());
      btn(d, 495, 22, 44, 148, 23, () => UI.sysLine('아직 없는 기능입니다.'), M0(0x129).trim());
      btn(d, 553, 64, 76, 60, 20, () => hide(d));
    }
    show(d);
  }
  // 공지 쓰기 (ia-z15-ba 255×166, 0x1005a1b0): 지금 공지 0/0/0x120 (30,15), 새 공지 0/0/0x121 (30,70), OK (107,130), CANCEL (159,130)
  function noticeWin(cur) {
    const d = win('arNot', 487, 255, 166);
    if (!d.dataset.ok) {
      d.dataset.ok = 1;
      text(d, 30, 15, 203, 13, M0(0x120)); text(d, 30, 70, 203, 15, M0(0x121));
      text(d, 36, 34, 186, 29).id = 'arNotCur';
      const t = input(d, 36, 88, 186, 36, 62, 'area'); t.id = 'arNotNew';
      btn(d, 560, 107, 130, 47, 20, () => { A({ a: 'notice', text: t.value }); hide(d); });
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
    el('arMemCmd').textContent = m.commander; el('arMemLt').textContent = ''; el('arMemUnit').textContent = ''; el('arMemReg').textContent = m.members.join('\n'); el('arMemMerc').textContent = '';
    UI.sysLine(M0(0x1a9));
    show(d);
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
      case 'notice': noticeWin(m.text); break;
      case 'noticed': UI.sysLine(M0(0x19e)); break;
      case 'badge': UI.armyName = m.name; break;
    }
  }
  const fmt = (t, ...a) => { let k = 0; return t.replace(/%[sud]/g, () => String(a[k++] ?? '')); };
  return { handle, open: () => A({ a: 'info' }) };
})();
