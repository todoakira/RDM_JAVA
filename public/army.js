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
  // 문장 그림을 원작이 어디서 그리는지(0x100012f0) 아직 다 읽지 못해 칸에 번호를 쓴다
  function drawGrid() {
    const g = el('arCrGrid'); g.innerHTML = '';
    for (let k = 0; k < 100; k++) {
      const mk = (camp === 2 ? 101 : 1) + k, c = document.createElement('div');
      const off = used.includes(mk);
      c.style.cssText = `position:absolute;left:${(k % 10) * 16}px;top:${Math.floor(k / 10) * 16}px;width:15px;height:15px;font:9px/15px sans-serif;text-align:center;color:${off ? '#555' : '#fff'};cursor:${off ? 'default' : 'pointer'};${mk === crest ? 'outline:1px solid #ffd27a' : ''}`;
      c.textContent = mk; if (!off) c.onclick = () => { crest = mk; drawGrid(); };
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
  // ---- 군단 정보 (F9, n-ia-ib-ba 309×388): 이름, 군단장, 공지. 아래 단추 일곱(ia-b1~b7-bu) 중 아직 쓰는 것은 탈퇴·멤버뿐
  function info(m) {
    const d = win('arInfo', 556, 309, 388);
    if (!d.dataset.ok) {
      d.dataset.ok = 1;
      text(d, 50, 108, 100, 14).id = 'arInName'; text(d, 48, 163, 192, 13).id = 'arInCmd'; text(d, 48, 211, 192, 13).id = 'arInAll';
      const n = text(d, 48, 261, 192, 50); n.id = 'arInNotice';
      btn(d, 470, 76, 348, 24, 23, () => A({ a: 'members' }));
      btn(d, 471, 99, 348, 22, 23, () => UI.msgBox(M0(0x66), ['yes', 'no'], y => { if (y) A({ a: 'withdraw' }); }));
      btn(d, 477, 279, 9, 22, 22, () => hide(d));
    }
    el('arInName').textContent = m.none ? '' : m.name; el('arInCmd').textContent = m.none ? '' : m.commander;
    el('arInAll').textContent = ''; el('arInNotice').textContent = m.none ? '' : m.notice;
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
      case 'members': UI.sysLine(`${M0(0xed)}: ${m.commander} / ${M0(0xee)}: ${m.members.join(', ')}`); break;
      case 'manage': manage(); break;
      case 'notice': UI.msgBox(M0(0x152), ['ok', 'cancel'], (y, v) => { if (y) A({ a: 'notice', text: v }); }, true); break;
      case 'noticed': UI.sysLine(M0(0x19e)); break;
      case 'badge': UI.armyName = m.name; break;
    }
  }
  const fmt = (t, ...a) => { let k = 0; return t.replace(/%[sud]/g, () => String(a[k++] ?? '')); };
  // ---- 관리 (0x727 → ia-z20-ba): 원작 창은 다음 단계에서. 지금은 공지·모집·해고·해산만 차례로 묻는다
  function manage() {
    UI.ask([M0(0xf6).trim(), M0(0x127).trim(), M0(0x105).trim(), M0(0xfb).trim()], k => {
      if (k === 1) A({ a: 'notice' });
      else if (k === 2) UI.msgBox(M0(0x155), ['ok', 'cancel'], (y, v) => { if (y && v) A({ a: 'hire', name: v }); }, true);
      else if (k === 3) UI.msgBox(M0(0x155), ['ok', 'cancel'], (y, v) => { if (y && v) A({ a: 'hire', name: v, fire: 1 }); }, true);
      else if (k === 4) UI.msgBox(M0(0x151), ['yes', 'no'], y => { if (y) A({ a: 'breakup' }); });
    });
  }
  return { handle, open: () => A({ a: 'info' }) };
})();
