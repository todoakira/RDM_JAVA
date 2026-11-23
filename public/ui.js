'use strict';
// 화면 구성: 원작 인터페이스 그림(assets/int)을 쓴다. 칸·단추·값 칸의 자리는 그림에서 잰 좌표다.
// 창을 화면 어디에 띄우는지는 임시로 정했다 (원작은 800×600 고정 화면).
const UI = (() => {
  // 아래 메뉴 줄의 단추: [그림 번호, 왼쪽 좌표, 너비, 하는 일]. 원작 Main.dll 0x1000c3d5~0x1000dbeb 의 단추 자리 (위 572, 높이 20)
  // im-hm(Status) im-gc(Character) im-it(Item) im-eq(Equipment) im-sk(Skill) im-hi(History) im-gr(Group) im-qi(Quick) ia-ia(Army) im-qe(Quest) im-he(Help) im-qu(Quit)
  const MENU = [[41, 44, 51, 'gauge'], [37, 96, 74, 'winChr'], [42, 171, 44, 'winInv'], [34, 216, 82, 'winEq'], [47, 299, 46, 'skill'], [40, 346, 59, 'winHist'], [38, 406, 52, 'group'], [44, 459, 51, 'quick'], [271, 511, 51, 'army'], [355, 563, 52, 'winQuest'], [39, 670, 46, 'help'], [45, 717, 41, 'quit']];
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
    else if (act === 'group') groupMenu();
    else if (act === 'quit') location.reload();
    else if (act === 'quick') toggle('winQuick');
    else if (act === 'army') ArmyUI.open(); else if (act === 'help') openHelp(1);
    else log('아직 구현되지 않은 메뉴입니다.', 'sys');
  }
  function marks() { for (const b of el('menubar').children) { const a = b.dataset.act; b.classList.toggle('on', (a.startsWith('win') || a === 'gauge') && el(a).style.display === 'block' || a === 'skill' && el('winSk').style.display === 'block' || a === 'group' && el('winGroup').style.display === 'block' || a === 'quick' && el('winQuick').style.display === 'block'); } }
  function toggle(id) { const w = el(id); w.style.display = w.style.display === 'block' ? 'none' : 'block'; marks(); if (id === 'winQuest') drawQuest(); if (id === 'winHist') drawHist(); if (id === 'winQuick') drawQuick(); if (id === 'winInv') drawInvWin(); if (id === 'winEq') drawEq(); if (id === 'winChr') drawChr(); if (id === 'winSk') drawSk(); }
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
      if (it) { e.onclick = () => { invSel = slot; drawInvWin(); if (shop && shopMode === 'sell') { shopSel = slot; drawShop(); } }; e.ondblclick = ev => { if (post.writing()) post.attach(slot, it); else if (trade) send({ t: 'tradeadd', where: 'inv', slot, n: it.n }); else if (bank) send({ t: 'bankput', slot, n: ev.shiftKey ? it.n : 1 }); else if (shop) send({ t: 'sell', slot, n: 1 }); else send({ t: 'use', slot }); };
        e.oncontextmenu = ev => { ev.preventDefault(); if (!bank && !shop) send({ t: 'qput', slot }); }; }   // 오른쪽 클릭: 빠른 창으로 (1/1/119~122)
      box.appendChild(e);
    }
    arrow(box, 175, 12, () => { invTop--; drawInvWin(); }); arrow(box, 175, 118, () => { invTop++; drawInvWin(); });
    const it = inv.items[invSel]; el('invtxt').textContent = it ? itemTip(it) : '';
  }
  // 거래 창: 칸 자리는 그림의 틀 (왼쪽 내 칸 2×3, 오른쪽 상대 칸 2×3)
  const TR_MINE = [[22, 82], [63, 82], [22, 123], [63, 123], [22, 163], [63, 163]], TR_THEIRS = [[162, 106], [202, 106], [162, 147], [202, 147], [162, 187], [202, 187]];
  let trade = null;
  function setTrade(m) {
    if (m.close) { trade = null; el('winTrade').style.display = 'none'; marks(); return; }
    trade = m; el('winTrade').style.display = 'block'; drawTrade();
  }
  function drawTrade() {
    if (!trade) return;
    el('trmymoney').textContent = trade.mine.money.toLocaleString(); el('trthmoney').textContent = trade.theirs.money.toLocaleString();
    el('trmytau').textContent = (trade.mine.tau || 0).toLocaleString(); el('trthtau').textContent = (trade.theirs.tau || 0).toLocaleString();
    el('trok').classList.toggle('done', !!trade.mine.ok);
    const box = el('trcells'); box.innerHTML = '';
    trade.mine.items.forEach((it, k) => { const c = cell(it, TR_MINE[k][0] + 1, TR_MINE[k][1] + 1, false); if (it) c.title = itemTip(it); box.appendChild(c); });
    trade.theirs.items.forEach((it, k) => { const c = cell(it, TR_THEIRS[k][0] + 1, TR_THEIRS[k][1] + 1, false); if (it) { c.title = itemTip(it); if (trade.theirs.ok) c.classList.add('okd'); } box.appendChild(c); });
  }
  setTimeout(() => {
    el('trok').onclick = () => send({ t: 'tradeok' });
    el('trcancel').onclick = () => send({ t: 'tradecancel' });
    el('trmymoney').onclick = () => msgBox(M0(45), ['ok', 'cancel'], (y, v) => { const n = parseInt(v, 10); if (y && n > 0) send({ t: 'tradeadd', where: 'money', n }); }, true);
    el('trmytau').onclick = () => msgBox(M0(437), ['ok', 'cancel'], (y, v) => { const n = parseInt(v, 10); if (y && n > 0) send({ t: 'tradeadd', where: 'tau', n }); }, true);
  });
  // 빠른 창 (Quick, iw-qi-ba 479×64, 원작 위치 136,4, Main.dll 0x100909d0): 아이템 칸 여덟 (19+41k, 15) 35×35, 기술 칸 둘 (351,15)·(409,15) 50×35
  function drawQuick() {
    const box = el('qkcells'); if (!box || !inv) return; box.innerHTML = '';
    for (let k = 0; k < 8; k++) {
      const it = (inv.quick || [])[k], e = cell(it, 19 + k * 41, 15, false);
      if (it) { e.title = `CTRL+${k + 1}\n` + itemTip(it); e.ondblclick = () => send(trade ? { t: 'tradeadd', where: 'quick', slot: k, n: it.n } : { t: 'quse', q: k }); e.oncontextmenu = ev => { ev.preventDefault(); send({ t: 'qget', q: k }); }; }
      box.appendChild(e);
    }
  }
  function drawEq() {
    if (el('winEq').style.display !== 'block' || !inv) return;
    const box = el('eqcells'); box.innerHTML = '';
    (inv.equip || []).forEach((it, slot) => { if (!it || !EQ_POS[slot]) return; const e = cell(it, EQ_POS[slot][0], EQ_POS[slot][1]); e.title = itemTip(it); e.ondblclick = () => send({ t: 'unequip', slot }); box.appendChild(e); });
  }
  function drawChr() {
    if (!stat) return;
    // 상태 막대 (n-iw-hm-ba, Main.dll 0x10095960): 값은 % 로 (0x10095f80 등). 막대 너비 HP·MP 154, SP·DP 111, 경험치 276
    const bar = (id, v, max, w) => { el(id).style.width = Math.round(w * Math.min(100, max ? Math.floor(Math.max(0, v) * 100 / max) : 0) / 100) + 'px'; };
    bar('gh', stat.hp, stat.maxHp, 154); bar('gm', stat.mp, stat.maxMp, 154); bar('gs', stat.sp, 2000, 111); bar('gd', stat.dp || 0, stat.maxDp || 0, 111); bar('ge', stat.exp, stat.need, 276);
    el('gauge').title = `체력 ${stat.hp} / ${stat.maxHp}\n마력 ${stat.mp} / ${stat.maxMp}\n기력 ${stat.sp} / 2000\n위험 점수(DP) ${stat.dp || 0} / ${stat.maxDp || 0}\n경험치 ${stat.exp} / ${stat.need}`;
    if (el('winChr').style.display !== 'block') return;
    el('cface').style.background = `url(assets/int/${FACE[stat.chr] || 114}.png)`;
    el('cname').textContent = `${stat.name}\n${CLASS_KR[stat.chr] || ''}  Lv.${stat.level}\n공격 ${Math.floor(stat.atk * stat.minPct / 100)}~${stat.atk}  방어 ${stat.armor}`;
    el('cexp').textContent = stat.exp.toLocaleString(); el('cnext').textContent = stat.need.toLocaleString();
    el('cstats').innerHTML = ['str', 'spi', 'dex', 'pow'].map(k => `<span style="flex:1;text-align:center">${stat[k]}</span>`).join('');
    el('cbonus').textContent = stat.bonus; el('cfame').textContent = stat.fame || 0; el('cweight').textContent = `${stat.weight} / ${stat.weightMax}`;
    el('cmoney').textContent = inv ? inv.money.toLocaleString() : '';
    el('ctau').textContent = inv ? (inv.tau || 0).toLocaleString() : '';   // 물방울 칸: Tau (시그너스 돈)
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
    for (let k = 0; k < 2; k++) {
      const id = typeof qsk !== 'undefined' ? qsk[k] : 0, c = el('qksk' + k); if (!c) continue;
      c.style.cssText = `position:absolute;left:${351 + 58 * k}px;top:15px;width:50px;height:35px;` + (id ? skIcon(id, 0) : '');
      c.title = id ? skText(id).name + (k ? ' (SHIFT + 오른쪽 단추)' : ' (오른쪽 단추)') : '';
    }
  }

  // ---------- 도움말 창 (Main.dll 0x10081900 만들기, 0x10082410 글 채우기) ----------
  // 글은 Message 그룹 1: 0 = 로그인 도움말, 1 = 게임 도움말. 0번 줄이 제목, 1번부터 ':EOF' 줄 앞까지가 본문.
  // 창 위치는 원작에서 찾지 못해 화면 가운데에 둔다. 글 색은 COLORREF 로 읽었다 (본문 0x91d7ff, 제목 0xffff)
  let helpTop = 0, helpLines = [];
  function openHelp(sec) {
    const g = msgs && msgs[1] && msgs[1][sec]; if (!g) return;
    el('helptitle').textContent = g[0] || ''; helpLines = [];
    for (let i = 1; g[i] !== undefined && g[i] !== ':EOF'; i++) helpLines.push(g[i]);
    helpTop = 0; drawHelp(); const w = el('winHelp'); w.style.display = 'block'; marks();
  }
  const HELP_ROWS = 12;
  function drawHelp() {
    helpTop = Math.max(0, Math.min(helpTop, helpLines.length - HELP_ROWS));
    el('helptext').textContent = helpLines.slice(helpTop, helpTop + HELP_ROWS).join('\n');
    const span = Math.max(1, helpLines.length - HELP_ROWS); el('helpth').style.top = (17 + Math.round((192 - 17 - 8) * helpTop / span)) + 'px';
  }
  document.addEventListener('click', e => {
    const t = e.target; if (!t || !t.id) return;
    if (t.id === 'helpcl') el('winHelp').style.display = 'none';
    else if (t.id === 'helpup') { helpTop--; drawHelp(); } else if (t.id === 'helpdn') { helpTop++; drawHelp(); }
  });
  document.addEventListener('wheel', e => { if (el('winHelp') && el('winHelp').style.display === 'block' && e.target.closest && e.target.closest('#winHelp')) { helpTop += e.deltaY > 0 ? 3 : -3; drawHelp(); } });
  // ---------- 이벤트 대본 ----------
  const WINID = id => id === 'skill' ? 'winSk' : id;
  function closeWin(id) { id = WINID(id); if (id && el(id) && el(id).style.display === 'block') toggle(id); }
  function openWin(id) { id = WINID(id); if (id && el(id) && el(id).style.display !== 'block') toggle(id); }
  // 선택지 창: 메시지 창 그림 iw-me-ba(73) 위에 고를 줄을 늘어놓는다 (원작 창 안의 배치는 아직 확인하지 못함)
  // 대화 기록 창 (History, iw-hi-ba 400×250, 원작 위치 397,317, Main.dll 0x10082870): 글 칸 (23,12)~(358,215),
  // 아래 단추 System (36) Shout (96) Whisper (147) Group (216) Army (272), 위 220 높이 17. 단추를 누르면 그 종류의 글을 보이거나 감춘다
  const HIST = [], HSHOW = { sys: 1, shout: 1, whisper: 1, grp: 1, army: 1 };
  function hist(html, cls) { HIST.push([html, cls || '']); if (HIST.length > 300) HIST.shift(); if (el('winHist').style.display === 'block') drawHist(); }
  function drawHist() {
    const box = el('histtext'); if (!box) return;
    box.innerHTML = HIST.filter(([, c]) => !c || HSHOW[c] !== 0).map(([h, c]) => `<div class="${c}">${h}</div>`).join('');
    box.scrollTop = box.scrollHeight;
    for (const b of document.querySelectorAll('#winHist .htab')) b.classList.toggle('on', !!HSHOW[b.dataset.k]);
  }
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('#winHist .htab'); if (b) { HSHOW[b.dataset.k] = HSHOW[b.dataset.k] ? 0 : 1; drawHist(); } });
  // 원작 메시지 창 (iw-me-ba, Main.dll 0x10086e20): 글, 입력칸(선택), 단추 둘 (예/아니오, 확인/취소)
  const M0 = c => (msgs && msgs[0] && msgs[0][0] && msgs[0][0][c] || '').replace(/\\n/g, '\n');
  const BTN = { ok: [88, 41], yes: [89, 41], cancel: [85, 45], no: [87, 45] };
  function msgBox(text, kinds, cb, input) {
    const box = el('winMsg'); el('msgtext').textContent = text;
    const inp = el('msgin'); inp.style.display = input ? 'block' : 'none'; inp.value = '';
    [el('msgb1'), el('msgb2')].forEach((b, k) => {
      const kd = kinds[k]; b.style.display = kd ? 'block' : 'none'; if (!kd) return;
      b.style.width = BTN[kd][1] + 'px'; b.style.backgroundImage = `url(assets/int/${BTN[kd][0]}.png)`;
      b.onclick = () => { box.style.display = 'none'; cb && cb(k === 0, inp.value.trim()); };
    });
    box.style.display = 'block'; if (input) setTimeout(() => inp.focus());
    inp.onkeydown = e => { if (e.key === 'Enter') { e.stopPropagation(); el('msgb1').onclick(); } };
  }
  // 그룹 창 (Main.dll 0x1007f100, 그리기 0x10080220): 그룹장이 맨 위. 멤버마다 60×60 칸, 얼굴은 (5,5) 에 50×50.
  // 체력은 얼굴 위쪽부터 체력/2 픽셀만 보이고 나머지는 빈 얼굴(gr-fa-bl)을 반투명으로 덮는다. 다른 맵에 있는 멤버는 효과를 입혀 그린다.
  // 단추: 칸마다 (48,5) 의 '−' (그룹장은 내보내기·해산, 멤버는 자기 칸에서 나가기), 그룹장 칸 (5,5) 의 '+' (초대). 마우스를 올리면 이름과 맵 이름
  const GFACE = [122, 123, 124, 125, 127, 126, 130, 128, 129, 124];   // 직업 0~9 → gr-fa-pi, az, sa, de, pa, ca, ha, lu, la, sa (0x100800a0)
  let grp = { members: [] }, me = '';
  function setGroup(g, myName) {
    grp = g; me = myName;
    if (g.why) log(esc(M0(g.why)), 'sys');                            // 34 해산, 35 내보내짐, 36 나감
    el('winGroup').style.display = g.members.length ? 'block' : 'none'; drawGroup(); marks();
  }
  function groupMenu() {
    if (!grp.members.length) { msgBox(M0(28), ['yes', 'no'], y => { if (y) send({ t: 'gcreate' }); }); return; }   // 그룹이 없으면 만들지 묻는다
    toggle('winGroup');
  }
  function drawGroup() {
    const box = el('winGroup'); if (!box) return;
    const lead = grp.leader === me;
    box.innerHTML = ''; box.style.height = grp.members.length * 60 + 'px';
    grp.members.forEach((m, i) => {
      const d = document.createElement('div'); d.className = 'gslot'; d.style.top = i * 60 + 'px';
      const away = m.hp < 0 || m.hp > 100, hp = away ? 100 : m.hp;
      d.innerHTML = `<div class="face" style="background:url(assets/int/${GFACE[m.chr] || 131}.png);${away ? 'filter:grayscale(1) brightness(.6)' : ''}"></div>`
        + (away ? '' : `<div class="blank" style="top:${5 + Math.floor(hp / 2)}px;height:${50 - Math.floor(hp / 2)}px"></div>`)
        + `<div class="gtip"><span style="color:#ffff80">${esc(m.name)}</span><br><span style="color:#0080ff">${esc(m.mapName || '')}</span></div>`;
      const btn = (x, img, fn) => { const b = document.createElement('div'); b.className = 'gbtn'; b.style.cssText += `left:${x}px;top:5px;background:url(assets/int/${img}.png)`; b.onclick = fn; d.appendChild(b); };
      if (lead || m.name === me) btn(48, 133, () => {
        if (m.name !== me) msgBox(M0(37).replace('%s', m.name), ['yes', 'no'], y => { if (y) send({ t: 'gleave', name: m.name }); });
        else msgBox(M0(lead ? 30 : 31), ['yes', 'no'], y => { if (y) send({ t: 'gleave' }); });
      });
      if (lead && m.name === me) btn(5, 132, () => {
        if (grp.members.length >= 5) { msgBox(M0(32), ['ok']); return; }
        msgBox(M0(33), ['ok', 'cancel'], (y, v) => { if (y && v) send({ t: 'ginvite', name: v }); }, true);
      });
      box.appendChild(d);
    });
  }
  function groupInvite(leader, cb) { msgBox(leader + M0(29), ['yes', 'no'], y => cb(y)); }
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
    const tx = v => typeof v === 'string' ? v : m7(v);                 // 보조 퀘스트 줄은 서버가 채워 글로 보낸다
    el('qtitle').textContent = tx(quest.lines[0]);
    el('qtext').textContent = tx(quest.lines[1]);
    el('qtime').textContent = quest.time || '';                        // 남은 분 ("%13u %s", 0/7/0xf4)
    const cs = el('qcells'); cs.innerHTML = '';
    (quest.items || []).forEach((it, k) => { const c = cell(it, 67 + k * 41, 159, false); if (it) c.title = it.name + (it.desc ? '\n' + it.desc : ''); cs.appendChild(c); });
  }
  // 우편함 창 (Post, iw-px-ba 500×282, 원작 위치 150,140, Main.dll 0x1008ca10): 목록 (18,36)~(463,236), 막대 (465,36),
  //   Write (298,244) 61×20, Read (360,245) 60×18, Delete (421,245) 60×18, 닫기 (477,0).
  //   목록 한 줄은 원작 형식 "%c %05u %14s %s %d %05d %s" = 읽음 표시(R), 번호, 보낸 사람, 날짜(%Y/%m/%d), 아이템 수, 줄 수, 제목 (0x1008d870)
  // 우편 창 (PostItem, iw-xw-ba 400×300, 원작 위치 200,130, 0x1008e6b0): From/To (27,20) 이름칸 (82,20)~(178,38), Title (27,46) 제목칸 (82,46)~(290,64),
  //   본문 (18,75)~(363,239), 막대 (364,73), 아이템 다섯 칸 (16+42k, 247), Send (260,263) Cancel (321,263) 은 쓸 때, Close (321,263) 는 읽을 때
  const post = (() => {
    let heads = [], sel = 0, cur = null, mode = '', to = '', att = [];
    const pad = (v, n, c = '0') => String(v).padStart(n, c);
    const day = t => { const d = new Date(t); return `${d.getFullYear()}/${pad(d.getMonth() + 1, 2)}/${pad(d.getDate(), 2)}`; };
    const line = h => `${h.read ? 'R' : ' '} ${pad(h.i, 5)} ${pad(h.from, 14, ' ')} ${day(h.time)} ${h.items} ${pad(h.lines, 5)} ${h.title}`;
    function drawList() {
      const b = el('pxlist'); b.innerHTML = '';
      for (const h of heads) {
        const d = document.createElement('div'); d.className = 'pxl' + (h.i === sel ? ' on' : ''); d.textContent = line(h);
        d.onclick = () => { sel = h.i; drawList(); }; d.ondblclick = () => { sel = h.i; send({ t: 'mailread', i: h.i }); };
        b.appendChild(d);
      }
    }
    function open() { heads = []; sel = 0; drawList(); el('winPost').style.display = 'block'; send({ t: 'maillist', from: 0 }); }
    function list(m) {
      if (m.reset) heads = [];
      for (const h of m.heads) if (!heads.some(x => x.i === h.i)) heads.push(h);
      heads.sort((a, b) => b.i - a.i); drawList();
    }
    // 목록 끝까지 내리면 그 아래 16통을 더 받는다
    function more() { const b = el('pxlist'); const low = heads.length && heads[heads.length - 1].i; if (low > 1 && b.scrollTop + b.clientHeight >= b.scrollHeight - 2) send({ t: 'maillist', from: low - 1 }); }
    function drawCells() {
      const b = el('xwcells'); b.innerHTML = '';
      const items = mode === 'read' ? cur.items : att.map(a => a && a.view);
      for (let k = 0; k < 5; k++) {
        const it = items[k] || null, c = cell(it, 16 + 42 * k, 247, false);
        if (it) c.title = it.money ? `${it.n.toLocaleString()}` : itemTip(it);
        c.onclick = () => {
          if (mode === 'read') { if (it) send({ t: 'mailget', i: cur.i, slot: k }); return; }
          if (att[k]) { att[k] = null; drawCells(); return; }           // 붙인 것을 다시 떼기
          msgBox(M0(45), ['ok', 'cancel'], (y, v) => { const n = parseInt(v, 10); if (y && n > 0) { att[k] = { money: 1, n, view: { k: 5, i: 0, n, icon: 0, money: 1, name: '' } }; drawCells(); } }, true);   // 빈 칸: 돈 붙이기
        };
        b.appendChild(c);
      }
    }
    function show(kind) {
      mode = kind; const w = el('winPost2'); w.style.display = 'block';
      el('xwlabel').textContent = kind === 'read' ? 'From' : 'To';
      el('xwsend').style.display = el('xwcancel').style.display = kind === 'write' ? 'block' : 'none';
      el('xwclose').style.display = kind === 'read' ? 'block' : 'none';
      for (const id of ['xwtitle', 'xwbody']) el(id).readOnly = kind === 'read';
      drawCells();
    }
    function read(m) {
      cur = m; el('xwname').value = m.from; el('xwtitle').value = m.title; el('xwbody').value = m.text;
      const h = heads.find(x => x.i === m.i); if (h) { h.read = 1; drawList(); }
      show('read');
    }
    function write(name) { to = name; att = [null, null, null, null, null]; el('xwname').value = name; el('xwtitle').value = ''; el('xwbody').value = ''; show('write'); el('xwtitle').focus(); }
    function close() { el('winPost2').style.display = 'none'; mode = ''; cur = null; att = []; }
    function sent() { close(); }
    function item(m) {
      if (cur && cur.i === m.i) { cur.items[m.slot] = m.item; drawCells(); }
      const h = heads.find(x => x.i === m.i); if (h) { h.items = m.items; drawList(); }
    }
    function del(m) { if (cur && cur.i === m.i) close(); sel = 0; }
    // 쓰는 중에 소지품을 두 번 누르면 빈 칸에 붙인다 (보낼 때 서버가 소지품에서 뺀다)
    function attach(slot, it) {
      const k = att.findIndex(a => !a); if (k < 0 || att.some(a => a && a.slot === slot)) return;
      att[k] = { slot, n: it.n, view: it }; drawCells();
    }
    el('pxwrite').onclick = () => msgBox(M0(24), ['ok', 'cancel'], (y, v) => { if (y && v) send({ t: 'mailstart', to: v }); }, true);
    el('pxread').onclick = () => { if (sel) send({ t: 'mailread', i: sel }); };
    el('pxdel').onclick = () => { if (!sel) return; const i = sel; msgBox(boardText(8), ['yes', 'no'], y => { if (y) send({ t: 'maildel', i }); }); };
    el('pxlist').onscroll = more;
    el('xwclose').onclick = close; el('xwcancel').onclick = close;
    el('xwsend').onclick = () => {
      const title = el('xwtitle').value.trim(); if (!title) { msgBox(M0(25), ['ok']); return; }
      send({ t: 'mailsend', title, text: el('xwbody').value, att: att.map(a => a && (a.money ? { money: 1, n: a.n } : { slot: a.slot, n: a.n })) });
    };
    return { open, list, read, write, sent, item, del, attach, writing: () => mode === 'write' };
  })();
  // 우편 알림 (패킷 0x1c1): Message.ctf 0/4 의 그 번호 줄
  function boardText(code, args) {
    const t = msgs && msgs[0] && msgs[0][4] && msgs[0][4][code]; if (!t) return '';
    let k = 0; return t.replace(/\\n/g, '\n').replace(/%[uds]/g, () => String(args && args[k] !== undefined ? args[k++] : ''));
  }
  // 선택지 창 (Main.dll 0x100797c0): 보기 단추 다섯 개, 왼쪽 17, 위 18·45·71·99·125, 크기 436×25
  const ASK_TOP = [18, 45, 71, 99, 125];
  function askChoice(options, cb) {
    const box = el('winAsk');
    box.innerHTML = options.slice(0, 5).map((t, k) => `<div class="askopt" data-k="${k + 1}" style="top:${ASK_TOP[k]}px">${esc(t)}</div>`).join('');
    box.style.display = 'block';
    box.onclick = e => { const o = e.target.closest('.askopt'); if (!o) return; box.style.display = 'none'; cb(Number(o.dataset.k)); };
  }
  return { help: openHelp, msg: (g, sec, c) => (msgs && msgs[g] && msgs[g][sec] && msgs[g][sec][c] || '').replace(/\\n/g, '\n'), trade: setTrade, M0, hist, group: setGroup, groupInvite, msgBox, sysText, quest: setQuest, post, boardText, sysLine: t => { if (t) log(esc(t), 'sys'); }, ask: askChoice, open: openWin, close: closeWin, skillBul: id => (skInfo && skInfo[id] && skInfo[id].e) || 0, skN: id => (skInfo && skInfo[id] ? skInfo[id].n : -1), isAreaSkill, isSelfSkill, fx: drawFx, menu, exch: openExch, closeExch, bank: openBank, closeBank, toggle, show, inv() { drawInvWin(); drawQuick(); drawEq(); drawChr(); if (shop) drawShop(); if (exch) drawExch(); }, stat() { drawChr(); drawSk(); drawQuickSkill(); }, skills() { drawSk(); drawQuickSkill(); }, skText, shop: openShop, closeShop };
})();
