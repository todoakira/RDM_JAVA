'use strict';
// 화면 구성: 원작 인터페이스 그림(assets/int)을 쓴다. 칸·단추·값 칸의 자리는 그림에서 잰 좌표다.
// 창을 화면 어디에 띄우는지는 임시로 정했다 (원작은 800×600 고정 화면).
const UI = (() => {
  // 아래 메뉴 줄의 단추: [그림 번호, 왼쪽 좌표, 너비, 하는 일]
  const MENU = [[38, 45, 52, 'group'], [37, 97, 74, 'winChr'], [42, 173, 44, 'winInv'], [34, 217, 82, 'winEq'], [39, 301, 45, 'help'], [40, 347, 59, 'history'], [41, 407, 51, 'gauge'], [44, 460, 51, 'quick'], [46, 512, 51, 'setup'], [47, 671, 46, 'skill'], [45, 718, 41, 'quit']];
  const FACE = [113, 114, 115, 116, 118, 117, 121, 119, 120];      // 직업 번호 → 얼굴 그림
  // 장비 창의 칸 자리. 원작 클라이언트가 장비 창을 만들 때 칸을 등록하는 순서와 좌표 그대로다 (Main.dll 0x1007a6c9~0x1007a936).
  // 순서가 곧 장비 칸 번호: 0 모자, 1 목걸이, 2 상의, 3 하의, 4 신발, 5 방패, 6 장갑, 7 무기, 8 허리띠, 9~11 반지, 12·13
  const EQ_POS = [[105, 11], [105, 65], [105, 114], [105, 178], [105, 262], [150, 166], [190, 166], [55, 165], [14, 165], [56, 36], [35, 76], [14, 116], [14, 211], [34, 252]];
  const el = id => document.getElementById(id);
  let invTop = 0, invSel = -1, bank = null, shop = null, shopMode = 'buy', shopTop = 0, shopSel = -1;

  for (const [img, x, w, act] of MENU) {
    const b = document.createElement('div'); b.className = 'mb'; b.dataset.act = act;
    b.style.cssText = `left:${x}px;width:${w}px;background-image:url(assets/int/${img}.png)`;
    b.onclick = () => menu(act); el('menubar').appendChild(b);
  }
  function menu(act) {
    if (act.startsWith('win')) toggle(act);
    else if (act === 'gauge') { el('gauge').style.display = el('gauge').style.display === 'none' ? 'block' : 'none'; marks(); }
    else if (act === 'skill') { toggle('winSk'); }
    else if (act === 'quit') location.reload();
    else log('아직 구현되지 않은 메뉴입니다.', 'sys');
  }
  function marks() { for (const b of el('menubar').children) { const a = b.dataset.act; b.classList.toggle('on', (a.startsWith('win') || a === 'gauge') && el(a).style.display === 'block' || a === 'skill' && el('winSk').style.display === 'block'); } }
  function toggle(id) { const w = el(id); w.style.display = w.style.display === 'block' ? 'none' : 'block'; marks(); if (id === 'winQuest') drawQuest(); if (id === 'winInv') drawInvWin(); if (id === 'winEq') drawEq(); if (id === 'winChr') drawChr(); if (id === 'winSk') drawSk(); }
  function show(first) { el('menubar').style.display = 'block'; if (first) { el('gauge').style.display = 'block'; el('winInv').style.display = 'block'; } marks(); }
  document.addEventListener('click', e => { const c = e.target.dataset && e.target.dataset.close; if (c) { if (c === 'winShop') { if (exch) closeExch(true); else closeShop(true); } else if (c === 'winBank') closeBank(true); else { el(c).style.display = 'none'; marks(); } } });

  // 아이템 그림 한 칸
  function cell(it, x, y, sel) {
    const c = document.createElement('canvas'); c.width = 35; c.height = 35; c.className = 'cell' + (sel ? ' sel' : ''); c.style.left = x + 'px'; c.style.top = y + 'px';
    if (it) {
      const g = c.getContext('2d'), s = icoSet(it.k), f = s && icoFrame(s, it.icon, false);
      if (f) g.drawImage(s.img, f[1], f[2], f[3], f[4], Math.round((35 - f[3]) / 2), Math.round((35 - f[4]) / 2), f[3], f[4]);
      if (it.n > 1) { g.font = '10px sans-serif'; g.textAlign = 'right'; g.lineWidth = 3; g.strokeStyle = '#000'; g.strokeText(it.n, 34, 33); g.fillStyle = '#fff'; g.fillText(it.n, 34, 33); }
    }
    return c;
  }
  const arrow = (box, x, y, fn) => { const a = document.createElement('div'); a.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:20px;height:20px;cursor:pointer`; a.onclick = fn; box.appendChild(a); };

  // 소지품 창: 네 칸 × 세 줄, 오른쪽에 설명
  function drawInvWin() {
    if (el('winInv').style.display !== 'block' || !inv) return;
    const box = el('invcells'); box.innerHTML = '';
    const rows = Math.max(3, Math.ceil(inv.items.length / 4)); invTop = Math.max(0, Math.min(invTop, rows - 3));
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      const slot = (invTop + r) * 4 + c, it = inv.items[slot], e = cell(it, 18 + c * 40, 18 + r * 40, slot === invSel);
      if (it) { e.onclick = () => { invSel = slot; drawInvWin(); if (shop && shopMode === 'sell') { shopSel = slot; drawShop(); } }; e.ondblclick = ev => { if (bank) send({ t: 'bankput', slot, n: ev.shiftKey ? it.n : 1 }); else if (shop) send({ t: 'sell', slot, n: 1 }); else send({ t: 'use', slot }); }; }
      box.appendChild(e);
    }
    arrow(box, 175, 12, () => { invTop--; drawInvWin(); }); arrow(box, 175, 118, () => { invTop++; drawInvWin(); });
    const it = inv.items[invSel]; el('invtxt').textContent = it ? itemTip(it) : '';
  }
  function drawEq() {
    if (el('winEq').style.display !== 'block' || !inv) return;
    const box = el('eqcells'); box.innerHTML = '';
    (inv.equip || []).forEach((it, slot) => { if (!it || !EQ_POS[slot]) return; const e = cell(it, EQ_POS[slot][0], EQ_POS[slot][1]); e.title = itemTip(it); e.ondblclick = () => send({ t: 'unequip', slot }); box.appendChild(e); });
  }
  function drawChr() {
    if (!stat) return;
    const hp = el('gh'), mp = el('gm'), sp = el('gs');
    hp.style.height = Math.round(120 * Math.max(0, stat.hp) / stat.maxHp) + 'px'; mp.style.height = Math.round(120 * stat.mp / stat.maxMp) + 'px'; sp.style.height = Math.round(120 * stat.sp / 2000) + 'px'; el('gd').style.height = Math.round(120 * (stat.dp || 0) / (stat.maxDp || 1)) + 'px';
    el('gauge').title = `체력 ${stat.hp} / ${stat.maxHp}\n마력 ${stat.mp} / ${stat.maxMp}\n기력 ${stat.sp} / 2000\n위험 점수(DP) ${stat.dp || 0} / ${stat.maxDp || 0}`;
    if (el('winChr').style.display !== 'block') return;
    el('cface').style.background = `url(assets/int/${FACE[stat.chr] || 114}.png)`;
    el('cname').textContent = `${stat.name}\n${CLASS_KR[stat.chr] || ''}  Lv.${stat.level}\n공격 ${Math.floor(stat.atk * stat.minPct / 100)}~${stat.atk}  방어 ${stat.armor}`;
    el('cexp').textContent = stat.exp.toLocaleString(); el('cnext').textContent = stat.need.toLocaleString();
    el('cstats').innerHTML = ['str', 'spi', 'dex', 'pow'].map(k => `<span style="flex:1;text-align:center">${stat[k]}</span>`).join('');
    el('cbonus').textContent = stat.bonus; el('cfame').textContent = stat.fame || 0; el('cweight').textContent = `${stat.weight} / ${stat.weightMax}`;
    el('cmoney').textContent = inv ? inv.money.toLocaleString() : '';
    for (const b of document.querySelectorAll('.stb')) { b.classList.toggle('can', stat.bonus > 0); b.title = STAT_KR[['str', 'spi', 'dex', 'pow'].indexOf(b.dataset.s)] + ' ' + stat[b.dataset.s]; }
  }
  for (const b of document.querySelectorAll('.stb')) b.onclick = () => { if (stat && stat.bonus > 0) send({ t: 'bonus', stat: b.dataset.s }); };
  setInterval(drawChr, 250);

  // 상점 창: 여섯 칸 × 네 줄. Buy = 상점이 파는 물건, Sell = 내 소지품 중 상점이 사 주는 물건
  function shopList() {
    if (shopMode === 'buy') return shop.items.filter(q => q.sells).map(q => ({ ...q, n: q.n < 0 ? 1 : q.n, stock: q.n }));
    return inv.items.map((it, slot) => { const q = shop.items.find(s => s.k === it.k && s.i === it.i && s.buys); return q ? { ...it, slot, price: Math.floor(q.price / shop.div) } : null; }).filter(Boolean);
  }
  function drawShop() {
    if (!shop) return;
    const box = el('shopcells'); box.innerHTML = ''; const list = shopList();
    const rows = Math.max(4, Math.ceil(list.length / 6)); shopTop = Math.max(0, Math.min(shopTop, rows - 4));
    el('shoptitle').textContent = `${shop.name} · ${shopMode === 'buy' ? '사기' : '팔기'}`;
    el('sbBuy').classList.toggle('on', shopMode === 'buy'); el('sbSell').classList.toggle('on', shopMode === 'sell');
    let cur = null;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
      const it = list[(shopTop + r) * 6 + c]; if (!it) continue;
      const key = shopMode === 'buy' ? it.idx : it.slot, e = cell(it, 23 + c * 40, 40 + r * 40, key === shopSel);
      if (key === shopSel) cur = it;
      e.onclick = () => { shopSel = key; drawShop(); };
      e.ondblclick = ev => deal(key, ev.shiftKey ? 10 : 1);
      box.appendChild(e);
    }
    arrow(box, 270, 38, () => { shopTop--; drawShop(); }); arrow(box, 270, 176, () => { shopTop++; drawShop(); });
    el('shoptxt').textContent = cur ? `${cur.name}\n${shopMode === 'buy' ? '값' : '파는 값'} ${cur.price.toLocaleString()}${cur.weight ? ' · 무게 ' + cur.weight : ''}${shopMode === 'buy' && cur.stock >= 0 ? ' · 남은 수량 ' + cur.stock : ''}\n${cur.desc || ''}\n\n두 번 클릭: 1개 · Shift+두 번 클릭: 10개\n가진 돈 ${inv.money.toLocaleString()} `
      : `${shopMode === 'buy' ? '살 물건을 고르세요.' : list.length ? '팔 물건을 고르세요.' : '이 상점이 사 주는 물건이 없습니다.'}\n가진 돈 ${inv.money.toLocaleString()} `;
  }
  const deal = (key, n) => send(shopMode === 'buy' ? { t: 'buy', idx: key, n } : { t: 'sell', slot: key, n });
  el('sbBuy').onclick = () => { if (exch) return exchTab('buy'); if (shopMode === 'buy' && shopSel >= 0) deal(shopSel, 1); else { shopMode = 'buy'; shopSel = -1; shopTop = 0; drawShop(); } };
  el('sbSell').onclick = () => { if (exch) return exchTab('sell'); if (shopMode === 'sell' && shopSel >= 0) deal(shopSel, 1); else { shopMode = 'sell'; shopSel = -1; shopTop = 0; drawShop(); } };
  el('sbCancel').onclick = () => { if (exch) closeExch(true); else closeShop(true); };

  // 거래소: 상점과 같은 창(여섯 칸 × 네 줄 = 한 쪽 스물네 건)을 쓴다. Buy = 올라온 물건, Sell = 내 소지품에서 골라 올리기
  let exch = null, exMode = 'buy', exTop = 0, exSel = -1;
  function exchTab(m) { exMode = m; exSel = -1; exTop = 0; drawExch(); }
  function drawExch() {
    if (!exch) return;
    const box = el('shopcells'); box.innerHTML = '';
    const list = exMode === 'buy' ? exch.items.map(q => ({ ...q, key: q.id })) : inv.items.map((it, slot) => ({ ...it, key: slot }));
    const rows = Math.max(4, Math.ceil(list.length / 6)); exTop = Math.max(0, Math.min(exTop, rows - 4));
    el('shoptitle').textContent = `${exch.name} · ${exMode === 'buy' ? '사기' : '올리기'}`;
    el('sbBuy').classList.toggle('on', exMode === 'buy'); el('sbSell').classList.toggle('on', exMode === 'sell');
    let cur = null;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
      const it = list[(exTop + r) * 6 + c]; if (!it) continue;
      const e = cell(it, 23 + c * 40, 40 + r * 40, it.key === exSel); if (it.key === exSel) cur = it;
      e.onclick = () => { exSel = it.key; drawExch(); };
      e.ondblclick = ev => {
        if (exMode === 'buy') { send({ t: 'exchbuy', id: it.id, n: ev.shiftKey ? it.n : 1 }); return; }
        const n = it.n > 1 ? ask('올릴 수량', it.n) : 1; if (!n) return;
        const price = ask('개당 값', 100); if (!price) return;
        send({ t: 'exchsell', slot: it.key, n, price, memo: (prompt('남길 말 (16자까지, 비워도 됨)', '') || '') });
      };
      box.appendChild(e);
    }
    arrow(box, 270, 38, () => { exTop--; drawExch(); }); arrow(box, 270, 176, () => { exTop++; drawExch(); });
    const t = el('shoptxt'); t.textContent = '';
    const line = s => { const d = document.createElement('div'); d.textContent = s; t.appendChild(d); return d; };
    if (cur && exMode === 'buy') { line(`${cur.name} × ${cur.n}`); line(`개당 ${cur.price.toLocaleString()} · 파는 사람 ${cur.seller}`); if (cur.memo) line(`"${cur.memo}"`); if (cur.desc) line(cur.desc); line('두 번 클릭: 1개 · Shift+두 번 클릭: 전부'); }
    else if (cur) { line(cur.name + (cur.n > 1 ? ' × ' + cur.n : '')); line('두 번 클릭하면 수량과 값을 정해 올립니다.'); }
    else line(exMode === 'buy' ? (exch.items.length ? '살 물건을 고르세요.' : '올라온 물건이 없습니다.') : '올릴 물건을 고르세요. (다섯 건까지)');
    line(`가진 돈 ${inv.money.toLocaleString()} · 내가 올린 물건 ${exch.mine}건`);
    const link = (txt, fn) => { const d = line(txt); d.style.cssText = 'color:#ffd27a;cursor:pointer;text-decoration:underline'; d.onclick = fn; };
    if (exch.owed) link(`판 돈 ${exch.owed.toLocaleString()} 찾기`, () => send({ t: 'exchrepay' }));
    if (exch.mine) link('올린 물건 모두 거두기', () => send({ t: 'exchcancel' }));
  }
  function openExch(m) { closeShop(true); exch = m; if (el('winShop').style.display !== 'block') { exMode = 'buy'; exSel = -1; exTop = 0; } el('winShop').style.display = 'block'; if (el('winInv').style.display !== 'block') toggle('winInv'); drawExch(); }
  function closeExch(tell) { if (exch && tell) send({ t: 'exchclose' }); exch = null; el('winShop').style.display = 'none'; }
  function openShop(m) { shop = m; shopMode = 'buy'; shopSel = -1; shopTop = 0; el('winShop').style.display = 'block'; if (el('winInv').style.display !== 'block') toggle('winInv'); drawShop(); }
  function closeShop(tell) { if (shop && tell) send({ t: 'shopclose' }); shop = null; el('winShop').style.display = 'none'; }

  // 은행 창: 다섯 칸 × 네 줄(스무 칸)과 맡긴 돈
  function drawBank() {
    if (!bank) return;
    const box = el('bankcells'); box.innerHTML = ''; el('bankmoney').textContent = bank.money.toLocaleString();
    bank.items.forEach((it, slot) => { const e = cell(it, 34 + (slot % 5) * 40, 69 + Math.floor(slot / 5) * 40); e.title = it.name + (it.desc ? '\n' + it.desc : ''); e.ondblclick = ev => send({ t: 'bankget', slot, n: ev.shiftKey ? it.n : 1 }); box.appendChild(e); });
  }
  const ask = (msg, max) => { const v = Math.floor(Number(prompt(msg, String(max)))); return v >= 1 ? v : 0; };
  el('bankput').onclick = () => { const n = bank && inv && inv.money ? ask('맡길 금액', inv.money) : 0; if (n) send({ t: 'bankmoney', n, put: 1 }); };
  el('bankmoney').onclick = () => { const n = bank && bank.money ? ask('찾을 금액', bank.money) : 0; if (n) send({ t: 'bankmoney', n, put: 0 }); };
  function openBank(m) { bank = { ...m, name: m.name || (bank && bank.name) }; el('winBank').style.display = 'block'; if (el('winInv').style.display !== 'block') toggle('winInv'); drawBank(); }
  function closeBank(tell) { if (bank && tell) send({ t: 'bankclose' }); bank = null; el('winBank').style.display = 'none'; }

  // ---------- 기술 창 (F5) ----------
  // 그림 iw-sk-ba(80). 위 줄 일반 기술, 아래 줄 특수 기술, 한 줄에 3칸, 양 끝 화살표로 넘긴다. 아래쪽은 설명 칸.
  // 칸 자리는 창 그림에서 잰 값이다 (원작 코드의 좌표는 아직 찾지 못함).
  // 기술 그림은 기술 정보의 d 번 인터페이스 그림(sk-xx-nn, 50×105)으로, 35줄씩 위에서부터 보통·강조·사용 불가 세 모양이다.
  // 이름·설명은 Message.ctf 의 묶음 2, 분류 = 기술 정보 c, 번호 = b ("이름@설명").
  const SK_CELL_X = [38, 90, 142], SK_ROW_Y = [28, 81];
  let skTop = 0, skInfo = null, msgs = null, skHover = 0;
  fetch('data/skills.json').then(r => r.json()).then(j => { skInfo = j; drawSk(); }).catch(() => {});
  fetch('assets/messages.json').then(r => r.json()).then(j => { msgs = j; drawSk(); }).catch(() => {});
  function skText(id) {
    const s = skInfo && skInfo[id], t = s && msgs && msgs[2] && msgs[2][s.c] && msgs[2][s.c][s.b];
    if (!t) return { name: '기술 ' + id, desc: '' };
    const [name, desc = ''] = t.split('@'); return { name, desc };
  }
  function skIcon(id, state) {
    const s = skInfo && skInfo[id]; if (!s) return '';
    return `background:url(assets/int/${s.d}.png) 0 -${state * 35}px`;
  }
  function drawSk() {
    if (el('winSk').style.display !== 'block' || !stat) return;
    const list = stat.skills || [], sel = typeof skillSel !== 'undefined' ? skillSel : 0;
    if (skTop > Math.max(0, list.length - 3)) skTop = Math.max(0, list.length - 3);
    let h = '';
    for (let i = 0; i < 3; i++) {
      const id = list[skTop + i]; if (!id) continue;
      h += `<div class="skc" data-sk="${id}" style="left:${SK_CELL_X[i]}px;top:${SK_ROW_Y[0]}px;${skIcon(id, id === sel ? 1 : 0)}"></div>`;
    }
    // 특수 기술: DP 가 가득 차야 쓸 수 있다. 덜 찼으면 사용 불가 모양
    if (stat.special) h += `<div class="skc" data-sk="${stat.special}" style="left:${SK_CELL_X[0]}px;top:${SK_ROW_Y[1]}px;${skIcon(stat.special, stat.dp >= stat.maxDp ? (stat.special === sel ? 1 : 0) : 2)}"></div>`;
    h += `<div class="ska" data-d="-1" style="left:12px;top:${SK_ROW_Y[0]}px"></div><div class="ska" data-d="1" style="left:196px;top:${SK_ROW_Y[0]}px"></div>`;
    el('skcells').innerHTML = h;
    const show = skHover || sel;
    if (show) {
      const t = skText(show), s = skInfo && skInfo[show];
      const cost = s ? (s.k >= 1e9 ? `최대 MP의 ${s.k - 1e9}%` : s.a ? '' : `MP ${s.k}`) : '';
      el('sktxt').innerHTML = `<b style="color:#ffd27a">${esc(t.name)}</b>${cost ? ' <span style="color:#9fd0ff">' + cost + '</span>' : ''}<br>${esc(t.desc).replace(/\\n|\n/g, '<br>')}`;
    } else el('sktxt').innerHTML = '';
  }
  el('winSk').addEventListener('click', e => {
    const a = e.target.closest('.ska'); if (a) { skTop = Math.max(0, skTop + Number(a.dataset.d)); drawSk(); return; }
  });
  // 원작 도움말: 기술 창에서 두 번 누르거나 오른쪽 단추로 누르면 그 기술이 빠른 메뉴에 올라간다 (Message.ctf 1/1/126~143)
  const pickSk = e => { const c = e.target.closest('.skc'); if (!c || c.dataset.sp) return false; selectSkill(Number(c.dataset.sk)); return true; };
  // 두 번 클릭: 대상이 필요 없는 기술은 바로 쓰고, 필요한 기술은 골라 둔다
  el('winSk').addEventListener('dblclick', e => { if (!pickSk(e)) return; if (isSelfSkill(skillSel)) useSelfSkill(skillSel); });
  el('winSk').addEventListener('contextmenu', e => { e.preventDefault(); pickSk(e); });
  el('winSk').addEventListener('mouseover', e => { const c = e.target.closest('.skc'); const v = c ? Number(c.dataset.sk) : 0; if (v !== skHover) { skHover = v; drawSk(); } });
  el('winSk').addEventListener('mouseleave', () => { skHover = 0; drawSk(); });
  setInterval(() => { if (fxList.length) drawFx(); }, 1000);
  const isSelfSkill = id => !!(skInfo && skInfo[id] && skInfo[id].l === 0);
  const isAreaSkill = id => !!(skInfo && skInfo[id] && skInfo[id].l >= 10000);
  // 걸려 있는 효과: [효과 번호, 남은 초, 건 기술]. 서버는 끝날 때만 다시 알려 주므로 초는 여기서 센다.
  let fxList = [], fxAt = 0;
  function drawFx(list) {
    if (list) { fxList = list; fxAt = performance.now(); }
    const gone = (performance.now() - fxAt) / 1000;
    el('fxlist').innerHTML = fxList.map(([e, sec, id]) => `<div>${esc(id ? skText(id).name : '효과 ' + e)} ${Math.max(0, Math.ceil(sec - gone))}초</div>`).join('');
  }
  function drawQuickSkill() {
    const id = typeof skillSel !== 'undefined' ? skillSel : 0;
    el('skquick').style.cssText = id ? skIcon(id, 0) : 'display:none';
    el('skquick').title = id ? skText(id).name : '';
  }

  // ---------- 이벤트 대본 ----------
  const WINID = id => id === 'skill' ? 'winSk' : id;
  function closeWin(id) { id = WINID(id); if (id && el(id) && el(id).style.display === 'block') toggle(id); }
  function openWin(id) { id = WINID(id); if (id && el(id) && el(id).style.display !== 'block') toggle(id); }
  // 선택지 창: 메시지 창 그림 iw-me-ba(73) 위에 고를 줄을 늘어놓는다 (원작 창 안의 배치는 아직 확인하지 못함)
  // 원작 시스템 메시지 (Message.ctf 0/2): %u %d %s 를 차례로 채운다
  function sysText(code, args) {
    const t = msgs && msgs[0] && msgs[0][2] && msgs[0][2][code]; if (!t) return '';
    let k = 0; return t.replace(/\\n/g, '\n').replace(/%[uds]/g, () => String(args && args[k] !== undefined ? args[k++] : ''));
  }
  const m7 = c => (c && msgs && msgs[0] && msgs[0][7] && msgs[0][7][c] || '').replace(/\\n/g, '\n');
  // 퀘스트 정보 창: 제목, 할 일, 퀘스트 아이템 다섯 칸 (SendSetQuestInfoWindow, 아이템 분류 0xe)
  let quest = null;
  function setQuest(q) { quest = q; drawQuest(); if (q.open) openWin('winQuest'); }
  function drawQuest() {
    const box = el('winQuest'); if (!box || !quest) return;
    el('qtitle').textContent = m7(quest.lines[0]) || '진행 중인 퀘스트가 없습니다.';
    el('qtext').textContent = m7(quest.lines[1]);
    const cs = el('qcells'); cs.innerHTML = '';
    (quest.items || []).forEach((it, k) => { const c = cell(it, 14 + k * 38, 0, false); if (it) c.title = it.name + (it.desc ? '\n' + it.desc : ''); cs.appendChild(c); });
  }
  // 우편: 원작은 우체통에서 읽는다. 여기서는 받은 우편을 바로 띄운다
  let mails = [];
  function showMail(list) {
    mails = mails.concat(list); const m = mails[0]; if (!m) return;
    el('mfrom').textContent = m.from; el('mtitle').textContent = m.title; el('mtext').textContent = m.text;
    el('winMail').style.display = 'block';
  }
  function nextMail() { mails.shift(); if (mails.length) showMail([]); else { el('winMail').style.display = 'none'; return true; } }
  function askChoice(options, cb) {
    const box = el('winAsk');
    box.innerHTML = options.map((t, k) => `<div class="askopt" data-k="${k + 1}">${esc(t)}</div>`).join('');
    box.style.display = 'block';
    box.onclick = e => { const o = e.target.closest('.askopt'); if (!o) return; box.style.display = 'none'; cb(Number(o.dataset.k)); };
  }
  return { sysText, quest: setQuest, mail: showMail, nextMail, ask: askChoice, open: openWin, close: closeWin, skillBul: id => (skInfo && skInfo[id] && skInfo[id].e) || 0, isAreaSkill, isSelfSkill, fx: drawFx, menu, exch: openExch, closeExch, bank: openBank, closeBank, toggle, show, inv() { drawInvWin(); drawEq(); drawChr(); if (shop) drawShop(); if (exch) drawExch(); }, stat() { drawChr(); drawSk(); drawQuickSkill(); }, skills() { drawSk(); drawQuickSkill(); }, skText, shop: openShop, closeShop };
})();
