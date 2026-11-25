'use strict';
// 게시판 창. 원작은 게임 안 웹 창에 board.asp 를 띄웠다. 창 틀은 원작 그대로, 안의 글 목록은 우리 서버 게시판이다.
// 제목·안내 글은 원작 클라이언트의 게시판 글 묶음 Message 0/3 을 쓴다 (0 "Bulletin Board.", 7 "No text in that bulletin." 등).
const BoardUI = (() => {
  const el = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const M3 = c => (UI.msg ? UI.msg(0, 3, c) : '') || '';
  const B = o => send(Object.assign({ t: 'board' }, o));
  let no = 0, page = 0, pages = 1;
  // 원작 게시판 창 (Main.dll 0x1003d2a0~0x1003d4ee): 그림은 Red2.dll 안 비트맵 (assets/board).
  //   바탕 IW-GE-BA 500×400, 닫기 IW-CL-BU (475,0)-(500,24), 쓰기 GE-WR-BU (296,367)-(356,385), 목록 GE-LI-BU (362,367)-(415,385),
  //   닫기 WR-CL-BU (421,367)-(481,385) (둘 다 명령 0x470), 제목 글 (390,19)-(504,37) 글꼴 13·굵기 300·색 0x9cf0 (f09c00), 내용 창 (16,43)-(483,358).
  //   단추 그림은 -N 보통, -D 눌림. 지우기는 Red2.dll 의 GE-DE-BU 를 쓰기 자리에 둔다 (원작 지우기는 웹 쪽이라 창에 자리가 없음).
  const P = n => `url(assets/board/${n}.png)`;
  function bb(id, img, x, y, w, h) {
    return `<div id="${id}" data-img="${img}" style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${P(img + '-n')};cursor:pointer;pointer-events:auto"></div>`;
  }
  function win() {
    let d = el('winBoard'); if (d) return d;
    d = document.createElement('div'); d.id = 'winBoard'; d.className = 'win';
    // 창 기본 위치 "Board" (150,80) 는 Main.dll 0x10007480 GetProfileInt 값
    d.style.cssText = `display:none;position:fixed;left:calc(50% - 400px + 150px);top:calc(50% - 300px + 80px);width:500px;height:400px;z-index:22;background:${P('iw-ge-ba')};color:#dfe8d0;font-size:12px`;
    d.innerHTML = `<div id="bdtitle" style="position:absolute;left:390px;top:19px;width:114px;height:18px;line-height:18px;color:#f09c00;font:300 13px var(--uf);white-space:nowrap;overflow:hidden"></div>
      ${bb('bdclose', 'iw-cl-bu', 475, 0, 25, 24)}
      <div id="bdbody" style="position:absolute;left:16px;top:43px;width:467px;height:315px;overflow:auto;pointer-events:auto"></div>
      ${bb('bdw', 'ge-wr-bu', 296, 367, 60, 18)}${bb('bdl', 'ge-li-bu', 362, 367, 54, 18)}${bb('bdc', 'wr-cl-bu', 421, 367, 60, 18)}`;
    document.body.appendChild(d);
    for (const b of d.querySelectorAll('[data-img]')) {
      b.onmousedown = () => { b.style.background = P(b.dataset.img + '-d'); };
      b.onmouseup = b.onmouseleave = () => { b.style.background = P(b.dataset.img + '-n'); };
    }
    el('bdclose').onclick = close; el('bdc').onclick = close;
    return d;
  }
  // 쓰기 자리 단추 (쓰기·지우기·보내기)와 목록 자리 단추에 할 일을 건다
  function foot(w, l) {
    const bw = el('bdw'), bl = el('bdl');
    bw.style.display = w ? 'block' : 'none'; if (w) { bw.dataset.img = w[0]; bw.style.background = P(w[0] + '-n'); bw.onclick = w[1]; }
    bl.onclick = l;
  }
  function close() { const d = el('winBoard'); if (d) d.style.display = 'none'; B({ a: 'close' }); }
  const day = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  function showList(m) {
    page = m.page; pages = m.pages;
    const rows = m.rows.map(r => `<tr data-id="${r.id}" style="cursor:pointer"><td style="width:40px;color:#9fb88f">${r.id}</td><td>${esc(r.title)}</td><td style="width:110px">${esc(r.by)}</td><td style="width:80px;color:#9fb88f">${day(r.time)}</td></tr>`).join('');
    el('bdbody').innerHTML = rows ? `<table style="width:100%;border-collapse:collapse">${rows}</table>` : `<div style="padding:20px;text-align:center;color:#9fb88f">${esc(M3(7))}</div>`;
    el('bdbody').querySelectorAll('tr').forEach(tr => { tr.onclick = () => B({ a: 'read', id: Number(tr.dataset.id) }); });
    const pg = document.createElement('div'); pg.style.cssText = 'text-align:center;margin-top:6px';
    pg.innerHTML = `<span data-p="-1" style="cursor:pointer">◀</span> ${page + 1} / ${pages} <span data-p="1" style="cursor:pointer">▶</span>`;
    pg.querySelectorAll('[data-p]').forEach(x => { x.onclick = () => { const q = page + Number(x.dataset.p); if (q >= 0 && q < pages) B({ a: 'list', page: q }); }; });
    el('bdbody').appendChild(pg);
    foot(['ge-wr-bu', showWrite], () => B({ a: 'list', page }));
  }
  function showRead(m) {
    const x = m.post;
    el('bdbody').innerHTML = `<div style="font-weight:bold;font-size:13px">${esc(x.title)}</div><div style="color:#9fb88f;margin:2px 0 8px">${esc(x.by)} · ${day(x.time)}</div><div style="white-space:pre-wrap;line-height:1.5">${esc(x.text)}</div>`;
    foot(m.mine ? ['ge-de-bu', () => B({ a: 'del', id: x.id })] : null, () => B({ a: 'list', page }));
  }
  function showWrite() {
    el('bdbody').innerHTML = `<input id="bdt" maxlength="40" placeholder="Title" style="width:100%;box-sizing:border-box;background:#000;color:#fff;border:1px solid #4a6a3a;padding:3px;margin-bottom:6px">
      <textarea id="bdx" maxlength="2000" style="width:100%;box-sizing:border-box;height:270px;background:#000;color:#fff;border:1px solid #4a6a3a;padding:3px;resize:none"></textarea>`;
    foot(['ge-wr-bu', () => B({ a: 'write', title: el('bdt').value, text: el('bdx').value })], () => B({ a: 'list', page }));
    el('bdt').focus();
  }
  function handle(m) {
    const d = win();
    if (m.a === 'open') { no = m.no; el('bdtitle').textContent = `${M3(0)} #${String(no).padStart(3, '0')}`; d.style.display = 'block'; }
    else if (m.a === 'list') showList(m);
    else if (m.a === 'read') showRead(m);
  }
  return { handle, close };
})();
