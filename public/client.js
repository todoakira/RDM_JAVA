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
let myPk = 0;
const ignored = new Set(); let ignoreAll = false;   // 귓속말 거부 목록 (클라이언트가 가진다)
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
const onScreen = e => e.px > camX - 50 && e.px < camX + cv.width / zoom + 50 && e.py > camY - 50 && e.py < camY + cv.height / zoom + 150;
function drawEnt(e, now) {
  const s = chrSet(e.chr); if (!s) return;
  let seq = null, i = 0;
  if (e.deadAt) { seq = seqOf(s, ACT.die, e.dir); if (seq) { i = Math.min(seq.length - 1, Math.floor((now - e.deadAt) / ANIM_MS)); if (e.deadAt > 0 && onScreen(e)) Sound.frameSound(s.def, ACT.die, i, e, 'snd' + e.deadAt); } }
  else if (e.act) {
    let a = ACT[e.act];
    seq = seqOf(s, a, e.dir); if (!seq && e.act === 'attack2') { a = ACT.attack; seq = seqOf(s, a, e.dir); }
    i = Math.floor((now - e.actAt) / ANIM_MS);
    if (!seq || i >= seq.length) { e.act = ''; seq = null; }
    else if (onScreen(e)) Sound.frameSound(s.def, a, i, e, 'snd' + e.actAt);   // 동작 소리 (ExStage SOUND_SET)
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
// 사람 이름 색: 명성 단계 (클라이언트 Main.dll 0x10031ff0 의 표, COLORREF → CSS). 0 과 그 밖은 흰색
const FAME_COLOR = { '-5': '#9b0505', '-4': '#af3737', '-3': '#c36969', '-2': '#d79b9b', '-1': '#ebcdcd', 1: '#cdcdeb', 2: '#9b9bd7', 3: '#6969c3', 4: '#3737af', 5: '#05059b' };
function outlined(text, x, y, color) { ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y); }
function drawLabels(e, now) {
  if (e.deadAt && e.mob) return;
  const x = Math.round(e.px), y = Math.round(e.py) - 92; ctx.textAlign = 'center';
  const focus = e.id === hoverId || e.id === targetId;
  if (!e.mob || focus) {
    ctx.font = `bold 12px ${FONT}`;
    outlined(e.mob || e.npc ? e.name : `${e.name} Lv.${e.level}`, x, y, e.mob ? '#ff9a8a' : e.npc ? '#9fe89f' : FAME_COLOR[e.ft] || '#fff');
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
    // PK 모드가 켜져 있으면 다른 사람도 고를 수 있다
    if (npc ? !e.npc : (e.npc || e.deadAt || (!e.mob && (myPk !== 2 || e.id === myId || e.dead)))) continue;
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
  if (mouse) { const h = mobAt(mouse.x / zoom + camX, mouse.y / zoom + camY); const hn = h ? null : mobAt(mouse.x / zoom + camX, mouse.y / zoom + camY, true); hoverId = h ? h.id : 0; const gi = h || hn ? null : groundAt(mouse.x / zoom + camX, mouse.y / zoom + camY); hoverItem = gi ? gi.id : 0; cv.style.cursor = h || gi || hn || rectAt(mouse.x / zoom + camX, mouse.y / zoom + camY) ? 'pointer' : 'crosshair'; }
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
  drawBullets(now);
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

// ---------- 기술 효과 그림 (총알) ----------
// 기술 정보의 e(+8) 가 총알 그림 번호다: DATAs/Bul/bul<e>.rmd (Main.dll 0x10023f33 에서 기술의 +8 바이트를 총알 만들기 0x1002f820 에 넘긴다).
// 총알 그림의 동작 0 은 날아가는 모양(방향별), 동작 1 은 맞은 자리의 모양. 동작 0 이 없으면 맞은 자리 모양만 나온다.
// 날아가는 속도(한 칸 50ms 에 몇 점)는 총알 번호마다 정해져 있다 (Main.dll 0x1002f87f 의 분기표, 나머지는 23).
const BUL_SPEED = { 1: 15, 2: 15, 3: 15, 6: 25, 13: 20, 16: 15, 18: 13, 19: 18, 23: 10, 24: 10, 25: 10, 40: 18, 43: 23, 52: 10, 53: 10, 54: 14, 64: 15, 65: 15, 67: 15, 71: 8, 81: 1, 82: 1, 83: 10, 84: 10, 85: 1, 86: 1, 87: 1, 88: 1, 90: 12 };
const bulSets = new Map(), bullets = [];
function bulSet(no) {
  let s = bulSets.get(no);
  if (!s) { s = { def: null, pages: [] }; bulSets.set(no, s); fetch(`assets/bul/${no}.json`).then(r => r.ok ? r.json() : null).then(d => { s.def = d; }).catch(() => {}); }
  return s.def ? s : null;
}
function bulPage(s, no, pg) {
  let e = s.pages[pg];
  if (!e) { e = s.pages[pg] = { img: new Image(), ok: false }; e.img.onload = () => { e.ok = true; }; e.img.src = `assets/bul/${no}_${pg}.png`; }
  return e.ok ? e.img : null;
}
function pxDir(ax, ay, bx, by) {                                   // grid.direction 과 같은 규칙을 화면 좌표에 적용
  const dx = Math.round(bx - ax), dy = Math.round(by - ay), adx = Math.abs(dx), ady = Math.abs(dy);
  if (dy === 0) return dx > 0 ? 6 : dx < 0 ? 4 : 2;
  if (dx === 0) return dy > 0 ? 2 : 8;
  if (2 * ady < adx) return dx > 0 ? 6 : 4;
  if (dx > 0) return dy > 0 ? (2 * adx >= ady ? 3 : 2) : (2 * adx >= ady ? 9 : 8);
  return dy > 0 ? (2 * adx < ady ? 2 : 1) : (2 * adx < ady ? 8 : 7);
}
// from: 시작 엔티티(없으면 to 자리에서 바로 터짐), to: 엔티티 또는 {px, py}
function addBullet(no, from, to) {
  if (!no) return;
  bulSet(no);
  bullets.push({ no, x: from ? from.px : to.px, y: from ? from.py - 40 : to.py, to, t0: performance.now(), phase: from ? 0 : 1, dir: from ? pxDir(from.px, from.py, to.px, to.py) : 2 });
}
function drawBullets(now) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i], s = bulSet(b.no);
    if (!s) { if (now - b.t0 > 3000) bullets.splice(i, 1); continue; }
    const tx = b.to.px, ty = b.to.py - 40;
    if (b.phase === 0) {
      const fly = s.def.anims[0] && (s.def.anims[0][b.dir] || s.def.anims[0][2]);
      const step = (BUL_SPEED[b.no] || 23) * (now - (b.last || b.t0)) / ANIM_MS; b.last = now;
      const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy);
      if (!fly || d <= step) { b.phase = 1; b.t0 = now; b.x = tx; b.y = ty; }
      else { b.x += dx / d * step; b.y += dy / d * step; const k0 = Math.floor((now - b.t0) / ANIM_MS); Sound.frameSound(s.def, 0, k0, b, 's0'); drawBulFrame(s, b, fly[k0 % fly.length]); continue; }
    }
    const hit = s.def.anims[1] && (s.def.anims[1][b.dir] || s.def.anims[1][2]);
    const k = Math.floor((now - b.t0) / ANIM_MS);
    if (!hit || k >= hit.length) { bullets.splice(i, 1); continue; }
    b.x = tx; b.y = b.to.py; Sound.frameSound(s.def, 1, k, b, 's1'); drawBulFrame(s, b, hit[k]);
  }
}
function drawBulFrame(s, b, fi) {
  const f = s.def.frames[fi], g = s.def.adds && s.def.adds[fi];
  if (f && f[3]) { const im = bulPage(s, b.no, f[0]); if (im) ctx.drawImage(im, f[1], f[2], f[3], f[4], Math.round(b.x) + f[5], Math.round(b.y) + f[6], f[3], f[4]); }
  if (g && g[3]) { const im = bulPage(s, b.no, g[0]); if (im) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(im, g[1], g[2], g[3], g[4], Math.round(b.x) + g[5], Math.round(b.y) + g[6], g[3], g[4]); ctx.globalCompositeOperation = 'source-over'; } }
}

// ---------- 입력 ----------
let holdTimer = null, lastPtr = null;
const send = m => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
// 맵의 클릭 영역 (.rmm 머리, tools/map_rects.js). 누르면 그 이벤트 번호를 서버에 알린다 (게시판 1, 우체통 2 등)
function rectAt(wx, wy) { return ((map && map.rects) || []).find(r => wx >= r[1] && wx < r[3] && wy >= r[2] && wy < r[4]) || null; }
function sendMove() {
  if (!lastPtr) return;
  const wx = lastPtr.x / zoom + camX, wy = lastPtr.y / zoom + camY;
  // 누른 곳에서 가장 가까운 자리를 고른다: 칸 모서리(z=0)와 칸 한가운데(z=1) 중 가까운 쪽
  const x0 = Math.round(wx / map.tw), y0 = Math.round(wy / map.th), x1 = Math.floor(wx / map.tw), y1 = Math.floor(wy / map.th);
  const d0 = Math.abs(wx - x0 * map.tw) / 2 + Math.abs(wy - y0 * map.th), d1 = Math.abs(wx - (x1 + .5) * map.tw) / 2 + Math.abs(wy - (y1 + .5) * map.th);
  const [x, y, z] = d0 < d1 ? [x0, y0, 0] : [x1, y1, 1];
  send({ t: 'move', x, y, z, run: runToggle !== shift }); targetId = 0;
  send({ t: 'evc', name: runToggle !== shift ? 'Run' : 'Walk' });   // 이벤트 조건 Walk / Run
  marker = { x, y, z, until: performance.now() + 600 };
}
cv.addEventListener('pointerdown', e => {
  if (!map) return;
  $('say').blur(); shift = e.shiftKey; clearInterval(holdTimer);
  const m = mobAt(e.clientX / zoom + camX, e.clientY / zoom + camY);
  // 오른쪽 단추: 고른 기술을 그 몬스터에게 쓴다. 왼쪽 단추: 일반 공격
  if (e.button === 2) {
    const useSk = qsk[e.shiftKey ? 1 : 0] || 0;
    if (useSk && UI.skN(useSk) === 35 && !m) {           // Warp: 누른 자리로 (ProcessUseSkill 0x43c47c)
      const wx = e.clientX / zoom + camX, wy = e.clientY / zoom + camY;
      const x0 = Math.round(wx / map.tw), y0 = Math.round(wy / map.th), x1 = Math.floor(wx / map.tw), y1 = Math.floor(wy / map.th);
      const d0 = Math.abs(wx - x0 * map.tw) / 2 + Math.abs(wy - y0 * map.th), d1 = Math.abs(wx - (x1 + .5) * map.tw) / 2 + Math.abs(wy - (y1 + .5) * map.th);
      const [x, y, z] = d0 < d1 ? [x0, y0, 0] : [x1, y1, 1];
      send({ t: 'skill', sk: useSk, x, y, z });
    }
    else if (useSk && UI.isSelfSkill(useSk)) useSelfSkill(useSk);
    else if (!m && useSk && UI.isAreaSkill(useSk)) useSelfSkill(useSk);     // 범위 기술을 빈 곳에: 내 자리가 중심
    else if (m && useSk) { targetId = m.id; send({ t: 'skill', sk: useSk, id: m.id, run: runToggle }); }
    return;
  }
  if (m) { targetId = m.id; send({ t: 'attack', id: m.id, run: runToggle !== shift }); return; }
  const nc = mobAt(e.clientX / zoom + camX, e.clientY / zoom + camY, true);
  if (nc) { targetId = 0; send({ t: 'talk', id: nc.id, run: runToggle !== shift }); return; }
  const gi = groundAt(e.clientX / zoom + camX, e.clientY / zoom + camY);
  if (gi) { targetId = 0; send({ t: 'pickup', id: gi.id, run: runToggle !== shift }); return; }
  const ra = rectAt(e.clientX / zoom + camX, e.clientY / zoom + camY);
  if (ra) { send({ t: 'inform', ev: ra[0] }); return; }
  lastPtr = { x: e.clientX, y: e.clientY }; sendMove(); holdTimer = setInterval(sendMove, 300);
});
cv.addEventListener('pointermove', e => { mouse = { x: e.clientX, y: e.clientY }; if (lastPtr) lastPtr = mouse; });
addEventListener('pointerup', () => { clearInterval(holdTimer); lastPtr = null; });
cv.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', e => {
  const ae = document.activeElement; if (ae && ae !== $('say') && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && !['nm', 'pw'].includes(ae.id)))) return;   // 우편·메시지 창 입력칸
  const typing = document.activeElement === $('say') || document.activeElement === $('nm') || document.activeElement === $('pw');
  if (e.key === 'Enter' && myId) {
    if (document.activeElement === $('say')) {
      const text = $('say').value.trim();
      // 귓속말 거부 (원작 도움말 1/1/38~39): `ex 는 모두, `ex 이름 은 그 사람. 같은 명령을 다시 하면 푼다
      const ex = /^`ex(?:\s+(\S+))?$/i.exec(text);
      if (ex) {
        const who = ex[1];
        if (!who) { ignoreAll = !ignoreAll; log(esc(ignoreAll ? UI.M0(161).replace('%s', 'All') : '귓속말 거부를 풀었습니다.'), 'sys'); }
        else if (who === myName()) log(esc(UI.M0(160)), 'sys');                                         // 0/0/160 자기 자신은 거부할 수 없다
        else if (ignored.has(who)) { ignored.delete(who); log(esc(`${who} 의 귓속말 거부를 풀었습니다.`), 'sys'); }
        else { ignored.add(who); log(esc(UI.M0(161).replace('%s', who)), 'sys'); }                          // 0/0/161
        $('say').value = ''; $('say').blur(); $('chatbar').style.display = 'none'; e.preventDefault(); return;
      }
      if (/^`(대화|chatview|음악|music|효과음|sound)(\s|$)/i.test(text) && setupCommand(text)) { $('say').value = ''; $('say').blur(); $('chatbar').style.display = 'none'; e.preventDefault(); return; }
      const gm = /^@(.+)$/.exec(text);   // 그룹 대화: 글 앞에 '@' 또는 입력줄의 Group 단추 (원작 도움말 Message.ctf 1/1/41~42)
      const sm = /^!(.+)$/.exec(text);   // 외치기: '!' 또는 Shout 단추 (1/1/32~33)
      if (gm || (chatMode === 'grp' && text)) send({ t: 'gchat', text: gm ? gm[1] : text });
      else if (sm || (chatMode === 'shout' && text)) send({ t: 'shout', text: sm ? sm[1] : text });
      else if (chatMode === 'army' && text) send({ t: 'army', a: 'chat', text });   // 군단 대화 (Army 단추)
      else if (chatMode === 'whisper' && chatTo && text && text[0] !== '/') send({ t: 'whisper', to: chatTo, text });
      else if (text) { send({ t: 'chat', text }); send({ t: 'evc', name: 'Chat' }); }   // 이벤트 조건 Chat
      $('say').value = ''; $('say').blur(); $('chatbar').style.display = 'none';
    } else { $('chatbar').style.display = 'block'; $('say').focus(); }
    e.preventDefault();
  } else if (!typing && myId && /^F([1-9]|1[0-2])$/.test(e.key) && (send({ t: 'evc', name: 'Key', arg: 111 + Number(e.key.slice(1)) }), !/^F[1-8]$/.test(e.key))) {
    e.preventDefault();   // F9~F12: 이벤트 조건 Key 도 알린다 (원작 키 코드 112 = F1)
    if (e.key === 'F9') ArmyUI.open();   // [F9] Army Window (1/1/77)
  } else if (!typing && myId && e.key === 'Tab') {
    e.preventDefault(); send({ t: 'pkmode', on: myPk ? 0 : 1 });   // [TAB] PK 모드 켜기·끄기 (원작 도움말 1/1/10~11)
  } else if (!typing && myId && /^F[1-8]$/.test(e.key)) {
    // 원작 도움말: [F1] 상태 창, [F2] 캐릭터 창, [F3] 아이템 창, [F4] 장비 창, [F5] 기술 창 (Message.ctf 1/1/52~65)
    e.preventDefault(); UI.menu(['gauge', 'winChr', 'winInv', 'winEq', 'skill', 'group', 'winHist', 'quick'][Number(e.key.slice(1)) - 1]);   // [F6] 그룹, [F7] 대화 기록, [F8] 빠른 창 (1/1/52~75)
  } else if (!typing && myId && e.ctrlKey && /^Digit[1-8]$/.test(e.code)) {
    e.preventDefault(); send({ t: 'quse', q: Number(e.code[5]) - 1 });   // 빠른 창 아이템 CTRL+1~8 (1/1/123)
  } else if (!typing && myId && e.ctrlKey && /^Key[A-Z]$/.test(e.code) && SKILL_KEYS.includes(e.code[3].toLowerCase())) {
    // 브라우저가 가로채는 조합(CTRL+W, CTRL+T 등)은 막을 수 없다
    e.preventDefault();
    const id = stat && stat.skills && stat.skills[SKILL_KEYS.indexOf(e.code[3].toLowerCase())];
    if (id) selectSkill(id);
  } else if (!typing) {
    if (e.key === 'r' || e.key === 'R' || e.key === 'ㄱ') runToggle = !runToggle;
    else if (e.key === 'i' || e.key === 'I' || e.key === 'ㅑ') UI.toggle('winInv');
    else if (e.key === 'm' || e.key === 'M' || e.key === 'ㅡ') log(Sound.toggle() ? '소리를 켭니다.' : '소리를 끕니다.', 'sys');
    else if (e.key === 'e' || e.key === 'E' || e.key === 'ㄷ') UI.toggle('winEq');
    else if (e.key === 'c' || e.key === 'C' || e.key === 'ㅊ') UI.toggle('winChr');
    else if (e.key === 'q' || e.key === 'Q' || e.key === 'ㅂ') UI.toggle('winQuest');
    else if (e.key === '+' || e.key === '=') zoom = Math.min(3, zoom + 1);
    else if (e.key === '-') zoom = Math.max(1, zoom - 1);
  }
});
// ---------- 기술 고르기 ----------
// 원작 도움말(Message.ctf 1/1/126~143): [CTRL]+Q, W, E, R, T, A, S, D, F, Z, X, C, V 가 기술 창의 순서대로 기술을 고르고,
// 고른 기술은 빠른 메뉴에 놓이며 몬스터를 오른쪽 단추로 누르면 쓴다.
const SKILL_KEYS = ['q', 'w', 'e', 'r', 't', 'a', 's', 'd', 'f', 'z', 'x', 'c', 'v'];
let skillSel = 0;
// 빠른 창의 기술 두 칸 (원작 Main.dll 0x10090bc3: 창 (351,15) 의 50×35 칸 둘, 서버 +0x4020 / +0x4022).
// 보통 기술은 첫 칸, 특수 기술은 둘째 칸에 올라가고 (ProcessRegisterSkill 0x42b240),
// 몬스터를 오른쪽 단추로 누르면 첫 칸, [SHIFT] 를 누른 채면 둘째 칸 기술을 쓴다 (WM_RBUTTONDOWN 0x10011d70: GetKeyState(VK_SHIFT))
const qsk = [0, 0];
function selectSkill(id) {
  const special = stat && stat.special === id;
  skillSel = id; send({ t: 'regskill', kind: special ? 2 : 1, id }); drawSkills();
}
function useSelfSkill(id) { send({ t: 'skill', sk: id }); }
function drawSkills() {
  const list = (stat && stat.skills) || [];
  if (skillSel && !list.includes(skillSel)) skillSel = 0;
  if (typeof UI !== 'undefined') UI.skills();
}
// 원작 `대화/`chatview: 종류별로 화면 대화 줄에 보일지 정한다 (Main.dll 0x1001be96). 대화 기록 창에는 늘 남는다.
// 순서는 원작 상태 글 0/0/477 그대로: 일반(G) 시스템(Sys) 외침(S) 귓속말(W) 그룹(Gr) 군단(A)
const CHATVIEW = ['say', 'sys', 'shout', 'whisper', 'grp', 'army'], chatView = { say: 1, sys: 1, shout: 1, whisper: 1, grp: 1, army: 1 };
function chatViewState() { let t = UI.M0(477); for (const k of CHATVIEW) t = t.replace('%s', UI.M0(chatView[k] ? 478 : 479)); return t; }
// 대화 명령 (Main.dll 0x10076486 의 일부). 켜기/on, 끄기/off, 상태/state 는 원작 글자 그대로 받는다
function setupCommand(text) {
  const w = text.slice(1).trim().split(/\s+/), cmd = w[0], arg = w[1] || '';
  const ON = arg === '켜기' || arg === 'on', OFF = arg === '끄기' || arg === 'off';
  if (cmd === '대화' || cmd === 'chatview') {
    if (ON || OFF) for (const k of CHATVIEW) chatView[k] = ON ? 1 : 0;
    else if (arg !== '상태' && arg !== 'state') { if (!/^[01]{6}$/.test(arg)) return true; CHATVIEW.forEach((k, i) => chatView[k] = arg[i] === '1' ? 1 : 0); }
    log(esc(chatViewState()), 'sys', true); return true;
  }
  if (cmd === '음악' || cmd === 'music') { if (ON || OFF) Sound.setMusic(ON); return true; }
  if (cmd === '효과음' || cmd === 'sound') { if (ON || OFF) Sound.setSfx(ON); return true; }
  return false;
}
function log(html, cls, force) {
  if (typeof UI !== 'undefined' && UI.hist) UI.hist(html, cls);   // 대화 기록 창에도 남긴다
  if (!force && chatView[cls || 'say'] === 0) return;
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
    if (m.sk && !m.area) addBullet(UI.skillBul(m.sk), a, d);   // 한 대상 기술: 시전자에서 대상까지 날아간다
    else if (m.bul) addBullet(m.bul, a, d);                     // 원거리 무기·몬스터 원거리 공격의 총알
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
    drawSkills();
  },
  note(m) { log(esc(m.text), 'sys'); },
  sys(m) { const t = UI.sysText(m.code, m.args); if (t) log(esc(t), 'sys'); },
  quest(m) { UI.quest(m); },
  // 우편 (서버 패킷 0x1c3 우편함 열기, 0x1af~0x1b3 목록, 0x1b5~0x1b9 읽기, 0x1bb 지우기, 0x1bd 쓰기 시작, 0x1bf 아이템 받기, 0x1c1 우편 알림)
  army(m) { ArmyUI.handle(m); },
  mailopen() { UI.post.open(); },
  maillist(m) { UI.post.list(m); },
  mailread(m) { UI.post.read(m); },
  maildel(m) { UI.post.del(m); },
  mailwrite(m) { UI.post.write(m.to); },
  mailsent() { UI.post.sent(); },
  mailitem(m) { UI.post.item(m); },
  mailmsg(m) { const t = UI.boardText(m.code, m.args); if (t) log(esc(t), 'sys'); },
  // 이벤트 대본의 클라이언트 행동: CloseWindow n / OpenWindow n. n 1~5 는 F1~F5 창, 100 은 상점 창
  evui(m) {
    const [cmd, n] = m.act.split(/\s+/), WIN = { 1: 'gauge', 2: 'winChr', 3: 'winInv', 4: 'winEq', 5: 'skill' };
    if (cmd === 'CloseWindow') { if (+n === 100) UI.closeShop && UI.closeShop(); else UI.close && UI.close(WIN[n]); }
    else if (cmd === 'OpenWindow' && WIN[n]) UI.open && UI.open(WIN[n]);
  },
  // 선택지 (GetUserResponseByCode)
  // 이동 기술 입력 창 (서버 0xff / 0x101 / 0x107 → 0/0/185 Gate, 186 Recall, 197 Teleport)
  mvask(m) { const code = { 20: 185, 23: 186, 48: 197 }[m.kind]; UI.msgBox(UI.M0(code), ['ok', 'cancel'], (y, v) => { if (y && v) send({ t: 'mvskill', kind: m.kind, text: v }); }, true); },
  askrecall(m) { UI.msgBox(UI.M0(187).replace('%s', m.name), ['yes', 'no'], y => send({ t: 'recall', yes: y ? 1 : 0 })); },   // 0/0/187
  gate() {},
  askrevive(m) { UI.msgBox(UI.M0(482).replace('%s', m.name), ['yes', 'no'], y => send({ t: 'revive', yes: y ? 1 : 0 })); },   // 0/0/482 (0x109/0x11)
  ask(m) { UI.ask(m.options, k => send({ t: 'evsel', ev: m.ev, k })); },
  cast(m) {
    const a = ents.get(m.id); if (a) { a.act = 'attack2'; a.actAt = performance.now(); a.moving = false; a.shownAt = a.actAt; }
    const no = UI.skillBul(m.sk);
    if (m.r !== undefined) { const [px, py] = cellPx(m.x, m.y, m.z); addBullet(no, null, { px, py }); }   // 범위 기술: 중심 자리
    else if (m.tid) { const d = ents.get(m.tid); if (d) addBullet(no, a, d); }                       // 약화 등 대상 기술
    else if (a) addBullet(no, null, a);                                                              // 자기 기술
  },
  fx(m) { UI.fx(m.fx); },
  // PK 모드 (패킷 0x3f7): 켜는 중이면 0/0/208, 켜지면 71, 꺼지면 72
  pkmode(m) { const was = myPk; myPk = m.on ? 2 : m.arming ? 1 : 0; if (myPk !== was) log(esc(UI.M0(myPk === 2 ? 71 : myPk === 1 ? 208 : 72)), 'sys'); },
  pk(m) { const e = ents.get(m.id); if (e) { e.pk = m.s; e.pen = m.pen; } },
  ftier(m) { const e = ents.get(m.id); if (e) e.ft = m.v; },
  wave(m) { Sound.play(m.id); },
  board(m) { BoardUI.handle(m); },
  qskill(m) { qsk[m.slot] = m.id || 0; if (typeof UI !== 'undefined') UI.skills(); },   // SendSetUserSkill(3, 칸, 기술)
  whisperfail(m) { log(esc(UI.M0(159).replace('%s', m.name)), 'sys'); },   // 0/0/159 "%s refuses to hear your whisper."                                       // 서버가 내는 소리 (AllPlayWave 0x473380: snd<번호>)
  // 교도관 (0x1d9 / 0x1db): 감옥 밖이면 0/0/214, 안이면 남은 분이 있으면 215 아니면 216
  jail(m) {
    const t = m.inJail ? (m.min ? UI.M0(215).replace('%u', m.min) : UI.M0(216)) : UI.M0(214);
    UI.msgBox(t, ['yes', 'no'], y => { if (y) send({ t: 'jail', leave: m.inJail ? 1 : 0 }); });
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
    // 거부한 사람의 귓속말은 보이지 않고, 서버에 알려 보낸 사람에게 0/0/159 가 간다 (원작 서버 ProcessWhisperFailed 0x474030)
    if (m.kind === 'whisper' && m.name !== myName() && (ignoreAll || ignored.has(m.name))) { send({ t: 'whisperfail', from: m.name }); return; }
    const p = m.kind !== 'whisper' && ents.get(m.id); if (p) { p.say = m.text; p.sayUntil = performance.now() + 5000; }
    const tag = m.group ? '[그룹] ' : m.kind === 'army' ? '[군단] ' : m.kind === 'shout' ? '[외침] ' : m.kind === 'whisper' ? (m.name === myName() ? `[→${m.to}] ` : '[귓속말] ') : '';
    log(`<span class="who">${esc(tag)}${esc(m.name)}</span>: ${esc(m.text)}`, m.group ? 'grp' : m.kind || undefined);
  },
  group(m) { UI.group(m, myName()); },
  trade(m) { UI.trade(m); },
  tradeask(m) { UI.msgBox(UI.M0(207).replace('%s', m.from), ['yes', 'no'], y => send({ t: 'tradeans', from: m.from, ok: y ? 1 : 0 })); },   // 0/0/207
  tradename() { UI.msgBox('', ['ok', 'cancel'], (y, v) => { if (y && v) send({ t: 'tradeask', name: v }); }, true); },
  ginvite(m) { UI.groupInvite(m.leader, y => send({ t: 'gjoin', leader: m.leader, ok: y ? 1 : 0 })); },
};
// 대화 입력줄 단추 (Main.dll 0x10075960): Shout, To(귓속말), Group, Army. 이 게임은 Group 만 한다
let chatMode = '', chatTo = '';
setTimeout(() => { const s = $('say'); if (s) s.addEventListener('blur', () => { $('chatbar').style.display = 'none'; }); });
addEventListener('DOMContentLoaded', () => {});
document.addEventListener('mousedown', e => {
  const b = e.target.closest && e.target.closest('#chatbar .cb'); if (!b) return; e.preventDefault();
  if (b.dataset.mode === 'whisper' && chatMode !== 'whisper') {   // To: 받는 사람 이름을 묻는다 (1/1/35~36)
    UI.msgBox(UI.M0(26), ['ok', 'cancel'], (y, v) => { if (y && v) { chatTo = v; chatMode = 'whisper'; } else chatMode = ''; for (const c of document.querySelectorAll('#chatbar .cb')) c.classList.toggle('on', c.dataset.mode === chatMode); $('chatbar').style.display = 'block'; $('say').focus(); }, true);
    return;
  }
  chatMode = chatMode === b.dataset.mode ? '' : b.dataset.mode; for (const c of document.querySelectorAll('#chatbar .cb')) c.classList.toggle('on', c.dataset.mode === chatMode);
});
const myName = () => { const me = ents.get(myId); return me ? me.name : ''; };
// 로그인 → 캐릭터 세 칸 → 고르기 (원작 로그인 서버 svIP.exe, 글은 Message 0/1). 고르기 화면의 원작 그림 배치는 아직이다
const FACE = [113, 114, 115, 116, 118, 117, 121, 119, 120];
let slotList = [], mkSlot = -1;
function showChars(list) {
  slotList = list; $('step1').style.display = 'none'; $('step2').style.display = 'block'; $('mk').style.display = 'none';
  $('selhead').textContent = (UI.msg && UI.msg(0, 1, 4)) || 'Select your character.';
  $('slots').innerHTML = list.map((c, i) => c
    ? `<div style="width:150px"><img src="assets/int/${FACE[c.chr] || 113}.png" style="width:90px;height:90px;border:2px solid #733"><div>${esc(c.name)}</div><div style="color:#aaa;font-size:12px">${CLASS_KR[c.chr] || ''} Lv.${c.level}</div><button type="button" data-sel="${i}">선택</button><button type="button" data-del="${i}" style="background:#333">지우기</button></div>`
    : `<div style="width:150px"><div style="width:90px;height:90px;margin:auto;border:2px dashed #444"></div><div style="color:#777">빈 칸</div><button type="button" data-new="${i}">새 캐릭터</button></div>`).join('');
  $('slots').querySelectorAll('[data-sel]').forEach(b => b.onclick = () => { $('msg').textContent = '접속 중...'; send({ t: 'select', slot: Number(b.dataset.sel) }); });
  $('slots').querySelectorAll('[data-new]').forEach(b => b.onclick = () => { mkSlot = Number(b.dataset.new); $('mk').style.display = 'block'; $('cn').focus(); });
  $('slots').querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const c = slotList[Number(b.dataset.del)]; const pw = prompt(`${c.name} 을(를) 지웁니다. 계정 비밀번호를 넣어 주세요.`); if (pw) send({ t: 'delchar', slot: Number(b.dataset.del), pw });
  });
}
function connect(id, pw, create) {
  if (ws && ws.readyState <= 1) { ws.onclose = null; ws.close(); }
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => send({ t: 'login', id, pw, create: create ? 1 : 0 });
  let ready = null;
  ws.onmessage = async ev => {
    const m = JSON.parse(ev.data);
    if (m.t === 'welcome') { if (typeof UI !== 'undefined') { UI.closeShop(); UI.closeBank(); UI.closeExch(); }
      // 처음 접속할 때와 다른 맵으로 넘어갈 때 모두 온다
      const first = !myId; myId = 0;
      ready = loadAssets(m.map); Sound.playMap(m.map); await ready;
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
    if (m.t === 'chars') { $('msg').textContent = ''; showChars(m.list); return; }
    if (m.t === 'lerr') { let t = (UI.msg && UI.msg(0, 1, m.code)) || '오류'; for (const a of m.args || []) t = t.replace(/%[ud]/, a); $('msg').textContent = t; return; }
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
  if ($('step1').style.display === 'none') return;
  const id = $('nm').value.trim(); if (!id) return;
  $('msg').textContent = '접속 중...'; connect(id, $('pw').value, false);
});
$('loginhelp').addEventListener('click', () => UI.help(0));   // 원작 로그인 화면의 Help 단추 (if-he-bu) → 로그인 도움말 (Message 1/0). 단추 자리는 원작과 다르다
$('newid').addEventListener('click', () => { const id = $('nm').value.trim(); if (!id) return; $('msg').textContent = '접속 중...'; connect(id, $('pw').value, true); });
$('mkok').addEventListener('click', () => { const fd = new FormData($('lf')); send({ t: 'newchar', slot: mkSlot, name: $('cn').value.trim(), chr: Number(fd.get('chr')), beginner: fd.get('beginner') === '1' }); });
$('mkno').addEventListener('click', () => { $('mk').style.display = 'none'; });
requestAnimationFrame(frame);
