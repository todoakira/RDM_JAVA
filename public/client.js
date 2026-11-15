'use strict';
// 레드문 JS 클라이언트: 화면 그리기와 입력만 담당한다. 판정은 모두 서버가 한다.
const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');
const CH = 16;                 // 바닥 캐시 한 덩어리의 크기(타일)
const ANIM_MS = 50;            // 동작표 한 칸의 재생 시간
const FONT = '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

let map = null, ws = null, myId = 0, safeStr = '', stat = null;
let zoom = innerHeight >= 1300 ? 2 : 1, runToggle = false, shift = false;
const ents = new Map();        // 주인공과 몬스터 전부 (id -> 개체)
const images = { tle: new Map(), obj: new Map() };
const chrSets = new Map();     // 캐릭터 그림 묶음 (번호 -> {def, img})
const chunks = new Map();
const floaters = [];           // 떠오르는 피해 숫자
const ground = new Map();      // 바닥에 떨어진 아이템
const icoSets = new Map();     // 아이템 아이콘 묶음 (분류 -> {def, img})
let objBuckets = null, marker = null, redrawTiles = false, hoverId = 0, hoverItem = 0, targetId = 0, mouse = null, inv = { money: 0, items: [] };

// ---------- 자료 불러오기 ----------
function image(kind, id) {
  const m = images[kind]; let e = m.get(id);
  if (!e) {
    e = { img: new Image(), ok: false };
    e.img.onload = () => { e.ok = true; if (kind === 'tle') redrawTiles = true; };
    e.img.src = `assets/${kind}/${id}.png`;
    m.set(id, e);
  }
  return e.ok ? e.img : null;
}
const ACT = { walk: 0, run: 1, attack: 2, attack2: 3, hit: 4, stand: 6, die: 57 };   // 동작 번호 (원본 정의 파일 기준)
function chrSet(no) {
  let s = chrSets.get(no);
  if (!s) {
    s = { def: null, pages: [] }; chrSets.set(no, s);
    fetch(`assets/chr/${no}.json`).then(r => r.ok ? r.json() : null).then(d => { s.def = d; }).catch(() => {});
  }
  return s.def ? s : null;
}
function chrPage(s, no, pg) {
  let e = s.pages[pg];
  if (!e) { e = s.pages[pg] = { img: new Image(), ok: false }; e.img.onload = () => { e.ok = true; }; e.img.src = `assets/chr/${no}_${pg}.png`; }
  return e.ok ? e.img : null;
}
// 아이콘 묶음: 항목 2n 이 소지품 칸 그림, 2n+1 이 바닥에 놓인 그림이다
function icoSet(k) {
  let s = icoSets.get(k);
  if (!s) {
    s = { def: null, img: new Image(), ok: false }; icoSets.set(k, s);
    fetch(`assets/ico/${k}.json`).then(r => r.ok ? r.json() : null).then(d => { if (!d) return; s.def = d; s.img.onload = () => { s.ok = true; drawInv(); }; s.img.src = `assets/ico/${k}_0.png`; }).catch(() => {});
  }
  return s.ok ? s : null;
}
const icoFrame = (s, icon, onGround) => { const e = s.def.entries[icon * 2 + (onGround ? 1 : 0)]; return e >= 0 ? s.def.frames[e] : null; };
function groundAt(wx, wy) {
  for (const g of ground.values()) { const [gx, gy] = cellPx(g.x, g.y, g.z); if (Math.abs(wx - gx) <= 18 && Math.abs(wy - gy) <= 14) return g; }
  return null;
}
const seqOf = (s, act, dir) => (s.def.anims[act] && (s.def.anims[act][dir] || s.def.anims[act][2])) || null;
async function loadAssets(mapId) {
  map = await fetch(`assets/maps/${mapId}.json`).then(r => r.json());
  map.pw = map.w * map.tw; map.ph = map.h * map.th;
  // 오브젝트 조각을 덩어리별로 묶어 둔다 (화면에 보이는 것만 빨리 찾기 위해)
  objBuckets = new Map();
  for (let i = 0; i < map.objs.length; i += 3) {
    const x = map.objs[i], y = map.objs[i + 1], d = map.objDefs[map.objs[i + 2]];
    const o = { d, x: x * map.tw + d[5], y: y * map.th + d[6], key: y * map.th + d[7] };
    const k = ((y / CH) | 0) * 1000 + ((x / CH) | 0);
    if (!objBuckets.has(k)) objBuckets.set(k, []);
    objBuckets.get(k).push(o);
  }
}

// ---------- 바닥: 덩어리 단위로 미리 그려 두고 재사용 ----------
function chunk(cx, cy) {
  const k = cy * 1000 + cx; let c = chunks.get(k);
  if (c && c.done) return c.cv;
  if (!c) { c = { cv: document.createElement('canvas'), done: false }; c.cv.width = CH * map.tw; c.cv.height = CH * map.th; chunks.set(k, c); }
  else if (!redrawTiles) return c.cv;
  const g = c.cv.getContext('2d'); let all = true;
  for (let ty = 0; ty < CH; ty++) for (let tx = 0; tx < CH; tx++) {
    const mx = cx * CH + tx, my = cy * CH + ty;
    if (mx >= map.w || my >= map.h) continue;
    const di = map.ground[my * map.w + mx]; if (di < 0) continue;
    const d = map.tileDefs[di];
    for (let i = 0; i < d.length; i += 7) {
      const im = image('tle', d[i]);
      if (!im) { all = false; continue; }
      g.drawImage(im, d[i + 1], d[i + 2], d[i + 3], d[i + 4], tx * map.tw + d[i + 5], ty * map.th + d[i + 6], d[i + 3], d[i + 4]);
    }
  }
  c.done = all;
  return c.cv;
}

// ---------- 개체(주인공·몬스터) ----------
// 칸마다 서는 자리가 둘: z=0 은 칸의 왼쪽 위 모서리, z=1 은 칸 한가운데 (원작 서버의 위치 체계)
const cellPx = (x, y, z = 1) => [x * map.tw + (z ? map.tw / 2 : 0), y * map.th + (z ? map.th / 2 : 0)];
const isSafe = (x, y) => safeStr.charCodeAt(y * map.w + x) === 49;
// 그림 겹마다 정해진 섞는 방식 (원작 ExStage.dll CxDDGround::Draw 0x10009090 의 표)
//   0 그대로, 1 그림 75% + 바탕 25%, 2 반반(그림자·유리), 3 그림 25% + 바탕 75%, 4 더하기, 5 그림 150% 더하기, 6 그림 200% 더하기
function blit(fx, draw) {
  if (!fx) { draw(); return; }
  if (fx <= 3) { ctx.globalAlpha = [0, .75, .5, .25][fx]; draw(); ctx.globalAlpha = 1; return; }
  if (fx > 6) { draw(); return; }
  ctx.globalCompositeOperation = 'lighter'; draw();
  if (fx === 5) { ctx.globalAlpha = .5; draw(); ctx.globalAlpha = 1; } else if (fx === 6) draw();
  ctx.globalCompositeOperation = 'source-over';
}
function addEnt(p) {
  const [px, py] = cellPx(p.x, p.y, p.z);
  ents.set(p.id, { ...p, px, py, fx: px, fy: py, tx: px, ty: py, t0: 0, dur: 0, moving: false, run: 0, say: '', sayUntil: 0, act: '', actAt: 0, deadAt: p.dead ? -1e9 : 0, shownAt: 0 });
}
function updateEnt(e, now) {
  if (!e.moving) return;
  const k = e.dur ? Math.min(1, (now - e.t0) / e.dur) : 1;
  e.px = e.fx + (e.tx - e.fx) * k; e.py = e.fy + (e.ty - e.fy) * k;
  if (k >= 1 && (e.last || now - e.t0 > e.dur + 200)) e.moving = false;
}
function drawEnt(e, now) {
  const s = chrSet(e.chr); if (!s) return;
  let seq = null, i = 0;
  if (e.deadAt) { seq = seqOf(s, ACT.die, e.dir); if (seq) i = Math.min(seq.length - 1, Math.floor((now - e.deadAt) / ANIM_MS)); }
  else if (e.act) {
    seq = seqOf(s, ACT[e.act], e.dir) || (e.act === 'attack2' ? seqOf(s, ACT.attack, e.dir) : null); i = Math.floor((now - e.actAt) / ANIM_MS);
    if (!seq || i >= seq.length) { e.act = ''; seq = null; }
  }
  if (!seq) {
    seq = (e.moving ? (e.run && seqOf(s, ACT.run, e.dir)) || seqOf(s, ACT.walk, e.dir) : null) || seqOf(s, ACT.stand, e.dir) || seqOf(s, ACT.walk, e.dir);
    if (!seq) return;
    i = Math.floor(now / ANIM_MS) % seq.length;
  }
  const fi = seq[Math.max(0, Math.min(i, seq.length - 1))], f = s.def.frames[fi]; if (!f) return;
  const img = chrPage(s, e.chr, f[0]); if (!img) return;
  if (e.deadAt && e.mob) ctx.globalAlpha = Math.max(0, Math.min(1, (e.deadAt + 4000 - now) / 800));
  if (f[3]) ctx.drawImage(img, f[1], f[2], f[3], f[4], Math.round(e.px) + f[5], Math.round(e.py) + f[6], f[3], f[4]);
  // 밝게 더해 그리는 겹(빛·기술 효과)
  const g = s.def.adds && s.def.adds[fi], gi = g && chrPage(s, e.chr, g[0]);
  if (gi) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(gi, g[1], g[2], g[3], g[4], Math.round(e.px) + g[5], Math.round(e.py) + g[6], g[3], g[4]); ctx.globalCompositeOperation = 'source-over'; }
  ctx.globalAlpha = 1;
}
function outlined(text, x, y, color) { ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y); }
function drawLabels(e, now) {
  if (e.deadAt && e.mob) return;
  const x = Math.round(e.px), y = Math.round(e.py) - 92; ctx.textAlign = 'center';
  const focus = e.id === hoverId || e.id === targetId;
  if (!e.mob || focus) {
    ctx.font = `bold 12px ${FONT}`;
    outlined(e.mob || e.npc ? e.name : `${e.name} Lv.${e.level}`, x, y, e.mob ? '#ff9a8a' : e.npc ? '#9fe89f' : e.id === myId ? '#ffd27a' : '#fff');
  }
  if (!e.npc && e.hp < e.maxHp && !e.deadAt && (e.mob ? now - e.shownAt < 6000 || focus : e.id !== myId)) {
    ctx.fillStyle = '#000'; ctx.fillRect(x - 21, y + 5, 42, 5);
    ctx.fillStyle = e.mob ? '#d33' : '#3c3'; ctx.fillRect(x - 20, y + 6, 40 * e.hp / e.maxHp, 3);
  }
  if (e.say && now < e.sayUntil) {
    ctx.font = `12px ${FONT}`;
    const w = Math.min(220, ctx.measureText(e.say).width) + 12;
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(x - w / 2, y - 34, w, 20);
    ctx.fillStyle = '#fff'; ctx.fillText(e.say, x, y - 20, 220);
  }
}
// 화면 좌표에 있는 몬스터 찾기
function mobAt(wx, wy, npc) {
  let best = null;
  for (const e of ents.values()) {
    if (npc ? !e.npc : (!e.mob || e.deadAt)) continue;
    if (Math.abs(wx - e.px) <= 20 && wy >= e.py - 80 && wy <= e.py + 10 && (!best || e.py > best.py)) best = e;
  }
  return best;
}

// ---------- 화면 그리기 ----------
let camX = 0, camY = 0;
function frame() {
  requestAnimationFrame(frame);
  if (!map || !myId) return;
  const now = performance.now(), me = ents.get(myId);
  if (cv.width !== innerWidth || cv.height !== innerHeight) { cv.width = innerWidth; cv.height = innerHeight; }
  const vw = cv.width / zoom, vh = cv.height / zoom;
  for (const e of ents.values()) { updateEnt(e, now); if (e.mob && e.deadAt && now - e.deadAt > 4000) ents.delete(e.id); }
  if (me) {
    camX = Math.round(Math.max(0, Math.min(map.pw - vw, me.px - vw / 2)));
    camY = Math.round(Math.max(0, Math.min(map.ph - vh, me.py - vh / 2 - 30)));
  }
  if (mouse) { const h = mobAt(mouse.x / zoom + camX, mouse.y / zoom + camY); const hn = h ? null : mobAt(mouse.x / zoom + camX, mouse.y / zoom + camY, true); hoverId = h ? h.id : 0; const gi = h || hn ? null : groundAt(mouse.x / zoom + camX, mouse.y / zoom + camY); hoverItem = gi ? gi.id : 0; cv.style.cursor = h || gi || hn ? 'pointer' : 'crosshair'; }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(zoom, 0, 0, zoom, -camX * zoom, -camY * zoom); ctx.imageSmoothingEnabled = false;

  const cwp = CH * map.tw, chp = CH * map.th;
  for (let cy = Math.floor(camY / chp); cy * chp < camY + vh; cy++)
    for (let cx = Math.floor(camX / cwp); cx * cwp < camX + vw; cx++)
      if (cx >= 0 && cy >= 0 && cx * CH < map.w && cy * CH < map.h) ctx.drawImage(chunk(cx, cy), cx * cwp, cy * chp);
  redrawTiles = false;

  // 보이는 오브젝트 조각 모으기 (큰 건물이 화면 밖 칸에 걸쳐 있을 수 있어 여유를 둔다)
  const M = 260, list = [];
  for (let cy = Math.floor((camY - M) / chp); cy * chp < camY + vh + M; cy++)
    for (let cx = Math.floor((camX - M) / cwp); cx * cwp < camX + vw + M; cx++) {
      const b = objBuckets.get(cy * 1000 + cx); if (!b) continue;
      for (const o of b) {
        if (o.x > camX + vw || o.y > camY + vh || o.x + o.d[3] < camX || o.y + o.d[4] < camY) continue;
        list.push(o);
      }
    }
  if (marker && now < marker.until) {
    const [mx, my] = cellPx(marker.x, marker.y, marker.z), r = 4 + 6 * ((marker.until - now) / 600);
    ctx.strokeStyle = '#ff5050'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(mx, my, r * 1.6, r * 0.8, 0, 0, 7); ctx.stroke();
  }
  for (const g of ground.values()) {
    const [gx, gy] = cellPx(g.x, g.y, g.z); if (gx < camX - 40 || gx > camX + vw + 40 || gy < camY - 40 || gy > camY + vh + 40) continue;
    const s = icoSet(g.k), f = s && icoFrame(s, g.icon, true);
    if (f) ctx.drawImage(s.img, f[1], f[2], f[3], f[4], Math.round(gx) + f[5], Math.round(gy) + f[6], f[3], f[4]);
    if (g.id === hoverItem) { ctx.font = `12px ${FONT}`; ctx.textAlign = 'center'; outlined(g.n > 1 ? `${g.name} ×${g.n.toLocaleString()}` : g.name, gx, gy - 18, '#fff3a0'); }
  }
  const tg = ents.get(targetId);
  if (tg && !tg.deadAt) { ctx.strokeStyle = '#ff3030'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(tg.px, tg.py, 20, 9, 0, 0, 7); ctx.stroke(); } else targetId = 0;

  // 깊이 순서: 기준선(발 위치)이 위쪽인 것부터 그린다
  const visible = [];
  for (const e of ents.values()) if (e.px > camX - 120 && e.px < camX + vw + 120 && e.py > camY - 60 && e.py < camY + vh + 160) { visible.push(e); list.push({ e, key: e.deadAt ? e.py - 12 : e.py }); }
  list.sort((a, b) => a.key - b.key);
  for (const o of list) {
    if (o.e) drawEnt(o.e, now);
    else { const im = image('obj', o.d[0]); if (im) blit(o.d[9], () => ctx.drawImage(im, o.d[1], o.d[2], o.d[3], o.d[4], o.x, o.y, o.d[3], o.d[4])); }
  }
  for (const e of visible) drawLabels(e, now);
  ctx.font = `bold 14px ${FONT}`; ctx.textAlign = 'center';
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i], k = (now - f.t0) / 900;
    if (k >= 1) { floaters.splice(i, 1); continue; }
    ctx.globalAlpha = 1 - k * k; outlined(f.text, f.x, f.y - 70 - k * 30, f.color); ctx.globalAlpha = 1;
  }
  if (me) {
    $('hud').innerHTML = `<b>${map.name}</b> (맵 ${map.id})${isSafe(me.x, me.y) ? ' · <span style="color:#8f8">안전지대</span>' : ''}<br>위치 ${me.x}, ${me.y}${me.z ? "" : "\u00b7"} · ${runToggle ? '달리기' : '걷기'}`;
  }
}

// ---------- 입력 ----------
let holdTimer = null, lastPtr = null;
const send = m => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
function sendMove() {
  if (!lastPtr) return;
  const wx = lastPtr.x / zoom + camX, wy = lastPtr.y / zoom + camY;
  // 누른 곳에서 가장 가까운 자리를 고른다: 칸 모서리(z=0)와 칸 한가운데(z=1) 중 가까운 쪽
  const x0 = Math.round(wx / map.tw), y0 = Math.round(wy / map.th), x1 = Math.floor(wx / map.tw), y1 = Math.floor(wy / map.th);
  const d0 = Math.abs(wx - x0 * map.tw) / 2 + Math.abs(wy - y0 * map.th), d1 = Math.abs(wx - (x1 + .5) * map.tw) / 2 + Math.abs(wy - (y1 + .5) * map.th);
  const [x, y, z] = d0 < d1 ? [x0, y0, 0] : [x1, y1, 1];
  send({ t: 'move', x, y, z, run: runToggle !== shift }); targetId = 0;
  marker = { x, y, z, until: performance.now() + 600 };
}
cv.addEventListener('pointerdown', e => {
  if (!map) return;
  $('say').blur(); shift = e.shiftKey; clearInterval(holdTimer);
  const m = mobAt(e.clientX / zoom + camX, e.clientY / zoom + camY);
  if (m) { targetId = m.id; send({ t: 'attack', id: m.id, run: runToggle !== shift }); return; }
  const nc = mobAt(e.clientX / zoom + camX, e.clientY / zoom + camY, true);
  if (nc) { targetId = 0; send({ t: 'talk', id: nc.id, run: runToggle !== shift }); return; }
  const gi = groundAt(e.clientX / zoom + camX, e.clientY / zoom + camY);
  if (gi) { targetId = 0; send({ t: 'pickup', id: gi.id, run: runToggle !== shift }); return; }
  lastPtr = { x: e.clientX, y: e.clientY }; sendMove(); holdTimer = setInterval(sendMove, 300);
});
cv.addEventListener('pointermove', e => { mouse = { x: e.clientX, y: e.clientY }; if (lastPtr) lastPtr = mouse; });
addEventListener('pointerup', () => { clearInterval(holdTimer); lastPtr = null; });
cv.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', e => {
  const typing = document.activeElement === $('say') || document.activeElement === $('nm') || document.activeElement === $('pw');
  if (e.key === 'Enter' && myId) {
    if (document.activeElement === $('say')) {
      const text = $('say').value.trim();
      if (text) send({ t: 'chat', text });
      $('say').value = ''; $('say').blur();
    } else $('say').focus();
    e.preventDefault();
  } else if (!typing) {
    if (e.key === 'r' || e.key === 'R' || e.key === 'ㄱ') runToggle = !runToggle;
    else if (e.key === 'i' || e.key === 'I' || e.key === 'ㅑ') UI.toggle('winInv');
    else if (e.key === 'e' || e.key === 'E' || e.key === 'ㄷ') UI.toggle('winEq');
    else if (e.key === 'c' || e.key === 'C' || e.key === 'ㅊ') UI.toggle('winChr');
    else if (e.key === '+' || e.key === '=') zoom = Math.min(3, zoom + 1);
    else if (e.key === '-') zoom = Math.max(1, zoom - 1);
  }
});
function log(html, cls) {
  const d = document.createElement('div'); if (cls) d.className = cls; d.innerHTML = html;
  $('log').appendChild(d); while ($('log').children.length > 8) $('log').firstChild.remove();
}
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ---------- 소지품 창 ----------
const STAT_KR = ['근력', '정신력', '민첩성', '기골'];
const CLASS_KR = ['필라르', '아즐라', '사다드', '데스티노', '박진희', '캐논', '한지화', '루나레나', '라비타'];
function itemTip(it) {
  const pct = v => v >= 1900000000 ? (v - 1900000000) + '%' : v;
  return `${it.name}${it.n > 1 ? ' ×' + it.n : ''}\n${it.desc}` + (it.hp ? `\n체력 회복 ${pct(it.hp)}` : '') + (it.mp ? `\n마력 회복 ${pct(it.mp)}` : '') +
    (it.atk ? `\n공격 ${it.atk}` : '') + (it.def ? `\n방어 ${it.def}` : '') + (it.v || []).map((v, q) => v ? `\n${STAT_KR[q]} +${v}` : '').join('') + (it.wear && it.req ? `\n요구 레벨 ${it.req}` : '') + (it.reqStat || []).map((v, q) => v ? `\n요구 ${STAT_KR[q]} ${v}` : '').join('') +
    (it.wear && it.cls ? `\n착용 직업: ${CLASS_KR.filter((_, c) => it.cls & (1 << c)).join(', ')}` : '') + (it.weight ? `\n무게 ${it.weight}` : '');
}
function drawInv() { if (typeof UI !== 'undefined') UI.inv(); }

// ---------- 서버 통신 ----------
function snapTo(e, x, y, z) { const [px, py] = cellPx(x, y, z); e.x = x; e.y = y; e.z = z; e.px = e.fx = e.tx = px; e.py = e.fy = e.ty = py; e.moving = false; }
const handlers = {
  add(m) { addEnt(m.p); log(`${esc(m.p.name)} 님이 들어왔습니다.`, 'sys'); },
  madd(m) { addEnt(m.m); },
  del(m) { const p = ents.get(m.id); if (p) log(`${esc(p.name)} 님이 나갔습니다.`, 'sys'); ents.delete(m.id); },
  step(m) {
    const p = ents.get(m.id); if (!p) return;
    const [tx, ty] = cellPx(m.x, m.y, m.z);
    if (Math.abs(tx - p.px) > 110 || Math.abs(ty - p.py) > 60) snapTo(p, m.x, m.y, m.z);   // 멀리서 들어온 소식은 바로 옮긴다
    p.fx = p.px; p.fy = p.py; p.tx = tx; p.ty = ty; p.t0 = performance.now(); p.dur = m.dur;
    p.x = m.x; p.y = m.y; p.z = m.z; p.dir = m.dir; p.run = m.run; p.last = m.last; p.moving = true;
  },
  atk(m) {
    const now = performance.now(), a = ents.get(m.id), d = ents.get(m.tid);
    if (a) { a.dir = m.dir; a.act = m.k ? 'attack2' : 'attack'; a.actAt = now; a.moving = false; a.shownAt = now; }
    if (!d) return;
    d.hp = m.hp; d.shownAt = now;
    if (!m.miss && !d.act && !d.moving) { d.act = 'hit'; d.actAt = now; }
    floaters.push({ x: d.px, y: d.py, text: m.miss ? '빗나감' : m.crit ? m.dmg + '!' : String(m.dmg), color: m.miss ? '#bbb' : d.mob ? '#ffe066' : '#ff5a5a', t0: now });
    if (d.id === myId && stat) stat.hp = m.hp;
  },
  hp(m) { const e = ents.get(m.id); if (e) { e.hp = m.hp; if (m.maxHp) e.maxHp = m.maxHp; } if (m.id === myId && stat) stat.hp = m.hp; },
  die(m) {
    const e = ents.get(m.id); if (!e) return;
    e.deadAt = performance.now(); e.hp = 0; e.act = ''; e.moving = false;
    if (m.id === myId) { log('쓰러졌습니다.', 'sys'); targetId = 0; $('dead').style.display = 'block'; }
  },
  respawn(m) { const e = ents.get(m.id); if (e) { e.deadAt = 0; e.hp = m.hp; e.dir = 2; snapTo(e, m.x, m.y, m.z); } },
  pos(m) { const e = ents.get(m.id); if (e) { e.dir = m.dir; snapTo(e, m.x, m.y, m.z); } },
  gadd(m) { ground.set(m.g.id, m.g); },
  gdel(m) { ground.delete(m.id); },
  inv(m) { inv = m; drawInv(); },
  got(m) { log(`${esc(m.name)}${m.n > 1 ? ' ' + m.n.toLocaleString() : ''} 획득`, 'sys'); },
  stat(m) {
    stat = m; const me = myId && ents.get(myId); if (me) { me.hp = m.hp; me.maxHp = m.maxHp; me.level = m.level; }
    if (typeof UI !== 'undefined') UI.stat();
  },
  shop(m) { UI.shop(m); },
  shopclose() { UI.closeShop(); },
  exch(m) { UI.exch(m); },
  exchclose() { UI.closeExch(); },
  bank(m) { UI.bank(m); },
  bankclose() { UI.closeBank(); },
  exp(m) { log(`경험치 +${m.gain.toLocaleString()}`, 'sys'); },
  lvl(m) {
    const e = ents.get(m.id); if (!e) return;
    e.level = m.level; e.hp = m.hp; e.maxHp = m.maxHp;
    floaters.push({ x: e.px, y: e.py - 20, text: 'LEVEL UP', color: '#7fe0ff', t0: performance.now() });
    if (m.id === myId) log(`레벨 ${m.level}이 되었습니다.`, 'sys');
  },
  chat(m) {
    const p = ents.get(m.id); if (p) { p.say = m.text; p.sayUntil = performance.now() + 5000; }
    log(`<span class="who">${esc(m.name)}</span>: ${esc(m.text)}`);
  },
};
function connect(name, pw, chr, beginner) {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => send({ t: 'join', name, pw, chr, beginner });
  let ready = null;
  ws.onmessage = async ev => {
    const m = JSON.parse(ev.data);
    if (m.t === 'welcome') { if (typeof UI !== 'undefined') { UI.closeShop(); UI.closeBank(); UI.closeExch(); }
      // 처음 접속할 때와 다른 맵으로 넘어갈 때 모두 온다
      const first = !myId; myId = 0;
      ready = loadAssets(m.map); await ready;
      safeStr = m.safe || ''; ents.clear(); chunks.clear(); floaters.length = 0; targetId = 0; marker = null; ground.clear();
      for (const g of m.ground || []) ground.set(g.id, g);
      for (const p of m.players) addEnt(p);
      for (const q of m.mobs) addEnt(q);
      for (const q of m.npcs || []) addEnt(q);
      $('dead').style.display = 'none';
      myId = m.id; $('login').style.display = 'none'; UI.show(first);
      log(first ? `${esc(map.name)}에 접속했습니다.` : `${esc(map.name)}(으)로 이동했습니다.`, 'sys');
      return;
    }
    if (m.t === 'error') { $('msg').textContent = m.text; ws.onclose = null; ws.close(); return; }
    if (ready) await ready;
    if (handlers[m.t] && (myId || m.t === 'stat' || m.t === 'inv')) handlers[m.t](m);
  };
  ws.onclose = () => {
    if (myId) log('서버와 연결이 끊어졌습니다. 새로고침해 주세요.', 'sys');
    else $('msg').textContent = '서버에 연결할 수 없습니다.';
  };
}
// 직업 고르기: 얼굴 그림은 원작 캐릭터 창의 것 (assets/int 113~121)
$('classes').innerHTML = CLASS_KR.map((n, i) => `<label><input type="radio" name="chr" value="${i}"${i === 1 ? ' checked' : ''}><img src="assets/int/${[113, 114, 115, 116, 118, 117, 121, 119, 120][i]}.png"><span>${n}</span></label>`).join('');
$('restart').addEventListener('click', () => send({ t: 'restart' }));
$('lf').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('nm').value.trim(); if (!name) return;
  $('msg').textContent = '접속 중...'; const fd = new FormData($('lf')); connect(name, $('pw').value, Number(fd.get('chr')), fd.get('beginner') === '1');
});
requestAnimationFrame(frame);
