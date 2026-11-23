'use strict';
// 게시판 창. 원작은 게임 안 웹 창에 board.asp 를 띄웠다 (받은 파일에 없음). 이 창의 모양은 새로 만든 것이고,
// 제목·안내 글은 원작 클라이언트의 게시판 글 묶음 Message 0/3 을 쓴다 (0 "Bulletin Board.", 7 "No text in that bulletin." 등).
const BoardUI = (() => {
  const el = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const M3 = c => (UI.msg ? UI.msg(0, 3, c) : '') || '';
  const B = o => send(Object.assign({ t: 'board' }, o));
  let no = 0, page = 0, pages = 1;
  function win() {
    let d = el('winBoard'); if (d) return d;
    d = document.createElement('div'); d.id = 'winBoard'; d.className = 'win';
    // 원작 게시판은 게임 안 웹 창이었다. 창 기본 위치 "Board" (150,80) 는 Main.dll 0x10007480 GetProfileInt 값, 바탕은 원작 일반 창 iw-ge-ba (500×400) 를 쓴다 (게시판이 이 바탕인지는 확인 못 함)
    d.style.cssText = 'display:none;position:fixed;left:calc(50% - 400px + 150px);top:calc(50% - 300px + 80px);width:500px;height:400px;z-index:22;background:url(assets/int/142.png);color:#dfe8d0;font-size:12px';
    d.innerHTML = `<div id="bdtitle" style="height:22px;line-height:22px;padding:0 8px;background:#1c2a16;border-bottom:1px solid #4a6a3a;font-weight:bold"></div>
      <div id="bdclose" style="position:absolute;right:6px;top:3px;cursor:pointer;pointer-events:auto">✕</div>
      <div id="bdbody" style="position:absolute;left:8px;right:8px;top:30px;bottom:36px;overflow:auto;pointer-events:auto"></div>
      <div id="bdfoot" style="position:absolute;left:8px;right:8px;bottom:6px;height:24px;display:flex;gap:6px;align-items:center;pointer-events:auto"></div>`;
    document.body.appendChild(d);
    el('bdclose').onclick = close;
    return d;
  }
  const btn = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; b.style.cssText = 'background:#1c2a16;color:#dfe8d0;border:1px solid #4a6a3a;padding:2px 10px;cursor:pointer'; return b; };
  function foot(list) { const f = el('bdfoot'); f.innerHTML = ''; for (const b of list) f.appendChild(b); }
  function close() { const d = el('winBoard'); if (d) d.style.display = 'none'; B({ a: 'close' }); }
  const day = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  function showList(m) {
    page = m.page; pages = m.pages;
    const rows = m.rows.map(r => `<tr data-id="${r.id}" style="cursor:pointer"><td style="width:40px;color:#9fb88f">${r.id}</td><td>${esc(r.title)}</td><td style="width:110px">${esc(r.by)}</td><td style="width:80px;color:#9fb88f">${day(r.time)}</td></tr>`).join('');
    el('bdbody').innerHTML = rows ? `<table style="width:100%;border-collapse:collapse">${rows}</table>` : `<div style="padding:20px;text-align:center;color:#9fb88f">${esc(M3(7))}</div>`;
    el('bdbody').querySelectorAll('tr').forEach(tr => { tr.onclick = () => B({ a: 'read', id: Number(tr.dataset.id) }); });
    const pg = document.createElement('span'); pg.textContent = `${page + 1} / ${pages}`; pg.style.flex = '1'; pg.style.textAlign = 'center';
    foot([btn('◀', () => { if (page > 0) B({ a: 'list', page: page - 1 }); }), pg, btn('▶', () => { if (page + 1 < pages) B({ a: 'list', page: page + 1 }); }), btn('WRITE', showWrite)]);
  }
  function showRead(m) {
    const x = m.post;
    el('bdbody').innerHTML = `<div style="font-weight:bold;font-size:13px">${esc(x.title)}</div><div style="color:#9fb88f;margin:2px 0 8px">${esc(x.by)} · ${day(x.time)}</div><div style="white-space:pre-wrap;line-height:1.5">${esc(x.text)}</div>`;
    const list = [btn('LIST', () => B({ a: 'list', page }))];
    if (m.mine) list.push(btn('DELETE', () => B({ a: 'del', id: x.id })));
    foot(list);
  }
  function showWrite() {
    el('bdbody').innerHTML = `<input id="bdt" maxlength="40" placeholder="Title" style="width:100%;box-sizing:border-box;background:#000;color:#fff;border:1px solid #4a6a3a;padding:3px;margin-bottom:6px">
      <textarea id="bdx" maxlength="2000" style="width:100%;box-sizing:border-box;height:250px;background:#000;color:#fff;border:1px solid #4a6a3a;padding:3px;resize:none"></textarea>`;
    foot([btn('SEND', () => B({ a: 'write', title: el('bdt').value, text: el('bdx').value })), btn('CANCEL', () => B({ a: 'list', page }))]);
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
