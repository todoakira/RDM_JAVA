'use strict';
// 화면 구성: 원작 인터페이스 그림(assets/int)을 쓴다. 칸·단추·값 칸의 자리는 그림에서 잰 좌표다.
// 창을 화면 어디에 띄우는지와 장비 칸이 어느 부위인지는 원작 클라이언트에서 아직 읽지 못해 임시로 정했다.
const UI = (() => {
  // 아래 메뉴 줄의 단추: [그림 번호, 왼쪽 좌표, 너비, 하는 일]
  const MENU = [[38, 45, 52, 'group'], [37, 97, 74, 'winChr'], [42, 173, 44, 'winInv'], [34, 217, 82, 'winEq'], [39, 301, 45, 'help'], [40, 347, 59, 'history'], [41, 407, 51, 'gauge'], [44, 460, 51, 'quick'], [46, 512, 51, 'setup'], [47, 671, 46, 'skill'], [45, 718, 41, 'quit']];
  const FACE = [113, 114, 115, 116, 118, 117, 121, 119, 120];      // 직업 번호 → 얼굴 그림
  // 장비 창의 칸 자리 (그림에서 잰 값). 어느 칸이 어느 부위인지는 임시 배정
  const EQ_POS = [[105, 11], [105, 65], [105, 114], [105, 178], [105, 262], [150, 167], [15, 116], [55, 165], [35, 76], [15, 165], [15, 212], [34, 252], [57, 36], [190, 167]];
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
    else if (act === 'quit') location.reload();
    else log('아직 구현되지 않은 메뉴입니다.', 'sys');
  }
  function marks() { for (const b of el('menubar').children) { const a = b.dataset.act; b.classList.toggle('on', (a.startsWith('win') || a === 'gauge') && el(a).style.display === 'block'); } }
  function toggle(id) { const w = el(id); w.style.display = w.style.display === 'block' ? 'none' : 'block'; marks(); if (id === 'winInv') drawInvWin(); if (id === 'winEq') drawEq(); if (id === 'winChr') drawChr(); }
  function show(first) { el('menubar').style.display = 'block'; if (first) { el('gauge').style.display = 'block'; el('winInv').style.display = 'block'; } marks(); }
  document.addEventListener('click', e => { const c = e.target.dataset && e.target.dataset.close; if (c) { if (c === 'winShop') closeShop(true); else if (c === 'winBank') closeBank(true); else { el(c).style.display = 'none'; marks(); } } });

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
    hp.style.height = Math.round(120 * Math.max(0, stat.hp) / stat.maxHp) + 'px'; mp.style.height = Math.round(120 * stat.mp / stat.maxMp) + 'px'; sp.style.height = Math.round(120 * stat.sp / 2000) + 'px';
    el('gauge').title = `체력 ${stat.hp} / ${stat.maxHp}\n마력 ${stat.mp} / ${stat.maxMp}\n기력 ${stat.sp} / 2000`;
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
    el('shoptxt').textContent = cur ? `${cur.name}\n${shopMode === 'buy' ? '값' : '파는 값'} ${cur.price.toLocaleString()} 시그${cur.weight ? ' · 무게 ' + cur.weight : ''}${shopMode === 'buy' && cur.stock >= 0 ? ' · 남은 수량 ' + cur.stock : ''}\n${cur.desc || ''}\n\n두 번 클릭: 1개 · Shift+두 번 클릭: 10개\n가진 돈 ${inv.money.toLocaleString()} 시그`
      : `${shopMode === 'buy' ? '살 물건을 고르세요.' : list.length ? '팔 물건을 고르세요.' : '이 상점이 사 주는 물건이 없습니다.'}\n가진 돈 ${inv.money.toLocaleString()} 시그`;
  }
  const deal = (key, n) => send(shopMode === 'buy' ? { t: 'buy', idx: key, n } : { t: 'sell', slot: key, n });
  el('sbBuy').onclick = () => { if (shopMode === 'buy' && shopSel >= 0) deal(shopSel, 1); else { shopMode = 'buy'; shopSel = -1; shopTop = 0; drawShop(); } };
  el('sbSell').onclick = () => { if (shopMode === 'sell' && shopSel >= 0) deal(shopSel, 1); else { shopMode = 'sell'; shopSel = -1; shopTop = 0; drawShop(); } };
  el('sbCancel').onclick = () => closeShop(true);
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

  return { bank: openBank, closeBank, toggle, show, inv() { drawInvWin(); drawEq(); drawChr(); if (shop) drawShop(); }, stat: drawChr, shop: openShop, closeShop };
})();
