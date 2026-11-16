'use strict';
// 레드문 클라이언트·서버 자료를 웹용(PNG + JSON)으로 변환한다.
//
// 전부 변환:  node tools/convert.js <Redmoon 클라이언트 폴더> --all --server <서버 Bin/Data 폴더>
// 일부만:     node tools/convert.js <클라이언트 폴더> --map 1,2 --chr 1,21 [--server ...]
const fs = require('fs');
const path = require('path');
const { Reader, findFile, parseLst, parseRmd, RleFile, parseRmm, encodePng } = require('./formats');
const { spriteOf } = require('../server/sprites');

const args = process.argv.slice(2);
const src = args[0];
const has = n => args.includes('--' + n);
function opt(name) { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1].split(',').map(Number) : null; }
const dataDir = src && findFile(src, 'DATAs'), rleDir = src && findFile(src, 'RLEs');
if (!dataDir || !rleDir) {
  console.error('사용법: node tools/convert.js <Redmoon 클라이언트 폴더> --all --server <서버 Bin/Data 폴더>');
  process.exit(1);
}
const ALL = has('all');
const si = args.indexOf('--server');
const SRV = si >= 0 ? args[si + 1] : null;
const OUT = path.join(__dirname, '..', 'assets');
const DATA = path.join(__dirname, '..', 'data');
const sub1 = (root, p) => { let d = root; for (const n of p) d = findFile(d, n) || path.join(d, n); return d; };
const D = (...p) => sub1(dataDir, p);
const RL = (...p) => sub1(rleDir, p);
const pad = n => String(n).padStart(5, '0');
const mk = d => fs.mkdirSync(d, { recursive: true });
const numbersIn = (dir, re) => fs.existsSync(dir) ? fs.readdirSync(dir).map(f => re.exec(f)).filter(Boolean).map(m => Number(m[1])).sort((a, b) => a - b) : [];
const krText = f => new TextDecoder('euc-kr').decode(fs.readFileSync(f));
const dataLines = t => t.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith(';'));

const maps = ALL ? numbersIn(D('Map'), /^map(\d+)\.rmm$/i) : (opt('map') || [1]);
const chrs = new Set(ALL ? numbersIn(D('Chr'), /^chr(\d+)\.rmd$/i) : (opt('chr') || [1]));

// 그림 파일은 크므로 최근에 쓴 몇 개만 메모리에 둔다
const rleCache = new Map();
function rle(dir, name) {
  const f = findFile(dir, name);
  if (!f) return null;
  let r = rleCache.get(f);
  if (r) { rleCache.delete(f); rleCache.set(f, r); return r; }
  r = new RleFile(f); rleCache.set(f, r);
  if (rleCache.size > 24) rleCache.delete(rleCache.keys().next().value);
  return r;
}
const rmdCache = new Map();
function rmd(kind, n) {
  const k = kind + n;
  if (!rmdCache.has(k)) {
    const f = findFile(D(kind), `${kind}${pad(n)}.rmd`);
    let v = null; try { if (f) v = parseRmd(fs.readFileSync(f)); } catch (e) { console.warn(`${kind} ${n}: 정의 파일을 읽지 못함`); }
    rmdCache.set(k, v);
  }
  return rmdCache.get(k);
}

// ---------- 맵 ----------
const imgSeen = { Tle: new Map(), Obj: new Map() };   // 그림 id -> {ox,oy,w,h} (없으면 null). 맵끼리 공유
function convertMap(no, lists) {
  const f = findFile(D('Map'), `Map${pad(no)}.rmm`);
  if (!f) { console.warn(`맵 ${no}: 파일 없음`); return null; }
  let m; try { m = parseRmm(fs.readFileSync(f)); } catch (e) { console.warn(`맵 ${no}: 읽지 못함`); return null; }
  function image(kind, id) {
    const seen = imgSeen[kind];
    if (seen.has(id)) return seen.get(id);
    let info = null;
    const e = lists[kind].get(id);
    const file = e && rle(RL(kind), `${kind}${pad(e.file)}.rle`);
    let im = null; try { im = file && file.decode(e.index); } catch (err) { im = null; }
    if (im) {
      const dir = path.join(OUT, kind.toLowerCase()); mk(dir);
      fs.writeFileSync(path.join(dir, id + '.png'), encodePng(im.w, im.h, im.rgba));
      // 그림자 그림은 정의 파일의 겹 번호나 이름으로는 완전히 구분되지 않아 그림 내용으로 판별한다
      let black = false;
      if (kind === 'Obj') {     // 불투명한 점의 90% 이상이 아주 어두우면 그림자로 본다 (추정 규칙)
        let n = 0, dark = 0;
        for (let q = 0; q < im.rgba.length; q += 4) if (im.rgba[q + 3]) { n++; if (Math.max(im.rgba[q], im.rgba[q + 1], im.rgba[q + 2]) <= 40) dark++; }
        black = n > 0 && dark >= n * 0.9;
      }
      info = { ox: im.ox, oy: im.oy, w: im.w, h: im.h, black };
    }
    seen.set(id, info);
    return info;
  }
  // 정의 한 겹을 "PNG 안의 잘라낼 영역 + 칸 기준 그릴 위치"로 바꾼다
  function layerDef(kind, L) {
    const id = L.ids[0]; if (id === undefined) return null;
    const im = image(kind, id);
    if (!im) return null;
    const x1 = Math.max(L.sx1, im.ox), y1 = Math.max(L.sy1, im.oy);
    const x2 = Math.min(L.sx2, im.ox + im.w), y2 = Math.min(L.sy2, im.oy + im.h);
    if (x2 <= x1 || y2 <= y1) return null;
    const d = [id, x1 - im.ox, y1 - im.oy, x2 - x1, y2 - y1, L.dx + x1 - L.sx1, L.dy + y1 - L.sy1]; d.black = im.black; return d;
  }
  const tileDefs = [], tileKey = new Map(), objDefs = [], objKey = new Map();
  const ground = new Array(m.w * m.h).fill(-1), objs = [];
  let col = '';
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const t = m.tiles[y * m.w + x];
    col += t.walk & 12 ? '1' : '0';      // 본타일(주인공이 다니는 면) 이동 가능 여부
    if (t.tleFile) {
      const k = t.tleFile + ':' + t.tleIdx;
      if (!tileKey.has(k)) {
        const ent = rmd('Tle', t.tleFile)?.ents[t.tleIdx];
        const layers = ent ? ent.map(L => layerDef('Tle', L)).filter(Boolean) : [];
        tileKey.set(k, layers.length ? tileDefs.push(layers.flat()) - 1 : -1);
      }
      ground[y * m.w + x] = tileKey.get(k);
    }
    if (t.objFile) {
      const k = t.objFile + ':' + t.objIdx;
      if (!objKey.has(k)) {
        const ent = rmd('Obj', t.objFile)?.ents[t.objIdx];
        const list = [];
        for (const L of ent || []) {
          const d = layerDef('Obj', L);
          if (d) list.push(objDefs.push([...d, -L.ey, d.black ? 1 : 0, L.z]) - 1);   // + 깊이 기준선, 그림자 여부, 겹 번호
        }
        objKey.set(k, list);
      }
      for (const d of objKey.get(k)) objs.push(x, y, d);
    }
  }
  // 기본 시작 위치: 맵 가운데에서 가장 가까운 이동 가능 칸
  const cw = m.w, ch = m.h; let spawn = [cw >> 1, ch >> 1], best = Infinity;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (col[y * cw + x] === '1') {
    const d = (x - cw / 2) ** 2 + (y - ch / 2) ** 2; if (d < best) { best = d; spawn = [x, y]; }
  }
  mk(path.join(OUT, 'maps'));
  fs.writeFileSync(path.join(OUT, 'maps', no + '.json'), JSON.stringify({
    id: no, name: m.name, w: m.w, h: m.h, tw: 48, th: 24, spawn, tileDefs, ground, objDefs, objs, col,
  }));
  return { id: no, name: m.name, w: m.w, h: m.h };
}

// ---------- 스프라이트 묶음 (캐릭터·몬스터·NPC, 총알·효과, 아이콘) ----------
// 정의(RMD)의 항목마다 여러 겹을 합쳐 한 장면으로 만들고, 2048x2048 쪽 단위로 모아 저장한다.
// 결과: <out>/<no>.json { name, pages, frames:[쪽,x,y,w,h,기준점x,기준점y], anims:{동작번호:{방향:[장면...]}} }, <out>/<no>_<쪽>.png
const PAGE = 2048;
function convertSprite(kind, no, lstName, folder, outName, quiet) {
  const def = rmd(kind, no);
  const lf = findFile(RL(...(kind === 'Chr' ? ['Chr'] : [])), lstName + '.lst');
  if (!def || !def.ents.length || !lf) return false;
  const lst = parseLst(fs.readFileSync(lf));
  const dir = findFile(RL(...(kind === 'Chr' ? ['Chr'] : [])), folder) || RL(folder);
  const prefix = kind === 'Chr' ? lstName : kind.toLowerCase();
  const out = path.join(OUT, outName); mk(out);
  const frames = [], index = new Map(), pages = [];
  let page = null, x = 0, y = 0, rowH = 0, missing = 0;
  const flush = () => { if (page) { fs.writeFileSync(path.join(out, `${no}_${pages.length}.png`), encodePng(PAGE, Math.max(1, page.h), page.buf.subarray(0, Math.max(1, page.h) * PAGE * 4))); pages.push(page.h); page = null; } };
  // 한 장면을 쪽에 붙인다. 겹마다 정해진 섞는 방식을 따른다 (원작 ExStage.dll CxDDGround::Draw 0x10009090 의 표):
  //   0 그대로, 1·2·3 그림 75·50·25% 로 반투명, 4·5·6 그림 100·150·200% 를 더하기.
  // 더하는 겹은 따로 한 장면으로 모아 두고(adds), 클라이언트가 밝게 더해 그린다.
  const place = parts => {
    const x1 = Math.min(...parts.map(p => p.x)), y1 = Math.min(...parts.map(p => p.y));
    const x2 = Math.max(...parts.map(p => p.x + p.im.w)), y2 = Math.max(...parts.map(p => p.y + p.im.h));
    const w = x2 - x1, h = y2 - y1; if (w > PAGE || h > PAGE) return null;
    if (x + w + 1 > PAGE) { x = 0; y += rowH + 1; rowH = 0; }
    if (!page || y + h > PAGE) { flush(); page = { buf: Buffer.alloc(PAGE * PAGE * 4), h: 0 }; x = 0; y = 0; rowH = 0; }
    const buf = page.buf;
    for (const p of parts) {
      const sw = p.im.w, sr = p.im.rgba, bx = x + p.x - x1, by = y + p.y - y1, fx = p.fx;
      const a = fx === 1 ? 0.75 : fx === 2 ? 0.5 : fx === 3 ? 0.25 : 1, gain = fx === 5 ? 1.5 : fx === 6 ? 2 : 1;
      for (let yy = 0; yy < p.im.h; yy++) {
        let q = yy * sw * 4, t = ((by + yy) * PAGE + bx) * 4;
        for (let xx = 0; xx < sw; xx++, q += 4, t += 4) {
          if (!sr[q + 3]) continue;
          if (fx >= 4) { for (let c = 0; c < 3; c++) buf[t + c] = Math.min(255, buf[t + c] + sr[q + c] * gain); buf[t + 3] = 255; }
          else if (a === 1) { buf[t] = sr[q]; buf[t + 1] = sr[q + 1]; buf[t + 2] = sr[q + 2]; buf[t + 3] = 255; }
          else {            // 반투명 겹을 아래 것 위에 얹는다
            const da = buf[t + 3] / 255, oa = a + da * (1 - a);
            for (let c = 0; c < 3; c++) buf[t + c] = Math.round((sr[q + c] * a + buf[t + c] * da * (1 - a)) / oa);
            buf[t + 3] = Math.round(oa * 255);
          }
        }
      }
    }
    const f = [pages.length, x, y, w, h, x1, y1];
    x += w + 1; rowH = Math.max(rowH, h); page.h = Math.max(page.h, y + h);
    return f;
  };
  const adds = {};
  for (let e = 0; e < def.ents.length; e++) {
    const parts = [];
    for (const L of def.ents[e]) {
      const le = lst.get(L.ids[0]); if (!le) { if (L.ids.length) missing++; continue; }
      const file = rle(dir, `${prefix}${pad(le.file)}.rle`);
      let im = null; try { im = file && file.decode(le.index); } catch (err) { im = null; }
      if (!im) { missing++; continue; }
      const px = L.dx + im.ox, py = L.dy + im.oy;
      if (px < -600 || py < -600 || px + im.w > 600 || py + im.h > 600) continue;
      if (L.z > 6) continue;          // 254 등: 원작도 그리지 않는 겹
      parts.push({ im, x: px, y: py, fx: L.z });
    }
    if (!parts.length) continue;
    const base = parts.filter(p => p.fx < 4), glow = parts.filter(p => p.fx >= 4);
    let f = base.length ? place(base) : null;
    const g = glow.length ? place(glow) : null;
    if (!f && !g) continue;
    if (!f) f = [g[0], g[1], g[2], 0, 0, g[5], g[6]];      // 더하는 겹뿐인 장면
    index.set(e, frames.length); if (g) adds[frames.length] = g; frames.push(f);
  }
  flush();
  if (!frames.length) return false;
  const anims = {};
  def.seqs.forEach((seq, i) => {
    const fr = seq.map(e => index.get(e)).filter(v => v !== undefined); if (!fr.length) return;
    (anims[Math.floor(i / 10)] ||= {})[i % 10] = fr;
  });
  const json = { id: no, name: def.name, pages: pages.length, frames, anims };
  if (Object.keys(adds).length) json.adds = adds;      // 장면 번호 → 밝게 더해 그릴 그림
  if (kind !== 'Chr') json.entries = def.ents.map((_, e) => index.has(e) ? index.get(e) : -1);   // 항목 번호 → 장면 번호
  if (Object.keys(def.sounds || {}).length) json.snd = def.sounds;   // 동작 번호 → [소리 번호, 장면]
  fs.writeFileSync(path.join(out, no + '.json'), JSON.stringify(json));
  if (!quiet) console.log(`${outName} ${no} "${def.name}": 장면 ${frames.length}개, ${pages.length}쪽` + (missing ? `, 찾지 못한 그림 ${missing}장` : ''));
  return { name: def.name, frames: frames.length };
}
// 주인공(0~9번)은 cNN, 그 밖(NPC·몬스터)은 etc 묶음을 쓴다
const convertChr = no => no <= 9 ? convertSprite('Chr', no, 'c' + String(no).padStart(2, '0'), 'c' + String(no).padStart(2, '0'), 'chr') : convertSprite('Chr', no, 'etc', 'etc', 'chr');

// 인터페이스 그림: 정의 파일이 없어 목록의 그림을 한 장씩 그대로 저장한다
function convertInt() {
  const lf = findFile(RL(), 'int.lst'); if (!lf) return;
  const lst = parseLst(fs.readFileSync(lf)), out = path.join(OUT, 'int'), idx = {}; mk(out);
  for (const [id, e] of lst) {
    const file = rle(RL('Int'), `int${pad(e.file)}.rle`);
    let im = null; try { im = file && file.decode(e.index); } catch (err) { im = null; }
    if (!im) continue;
    fs.writeFileSync(path.join(out, id + '.png'), encodePng(im.w, im.h, im.rgba));
    idx[id] = [e.name, im.ox, im.oy, im.w, im.h];
  }
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(idx));
  console.log(`인터페이스 그림 ${Object.keys(idx).length}장`);
}
// 소리: .rms 는 이름만 다른 WAV, .mid 는 그대로 MIDI
function convertSound() {
  let n = 0;
  for (const [dir, re, ext, outName] of [['SND', /\.rms$/i, '.wav', 'snd'], ['Mid', /\.mid$/i, '.mid', 'mid']]) {
    const d = findFile(RL(), dir); if (!d) continue;
    const out = path.join(OUT, outName); mk(out);
    for (const f of fs.readdirSync(d)) if (re.test(f)) { fs.copyFileSync(path.join(d, f), path.join(out, f.replace(re, ext).toLowerCase())); n++; }
  }
  console.log(`소리 ${n}개`);
}

// ---------- 서버 자료 (몬스터 표, 배치표, 이벤트, NPC) ----------
function convertServer(mapInfo) {
  mk(path.join(DATA, 'maps'));
  const sub = (d, f) => findFile(path.join(SRV, d), f);
  // MopInfo.rsm: 종류 모습 시야 이동속도 범위1 범위2 간격1 간격2 총알1 총알2 기술1 기술2 기술간격1 기술간격2 근력 정신력 민첩성 기골 경험치 방향1 방향2 명성치 자리차지안함
  const mops = {};
  for (const l of dataLines(krText(sub('Mop', 'MopInfo.rsm')))) {
    const v = l.split(/\s+/).map(Number); if (v.length < 19 || v.some(isNaN)) continue;
    mops[v[0]] = { img: v[1], sight: v[2], speed: v[3], range: v[4], range2: v[5], interval: v[6], interval2: v[7], bullet: v[8], bullet2: v[9], skill: v[10], skill2: v[11], skillMs: v[12], skillMs2: v[13],
      str: v[14], spi: v[15], dex: v[16], con: v[17], exp: v[18], dir1: v[19] || 0, dir2: v[20] || 0, fame: v[21] || 0, noOccupy: v[22] || 0 };
  }
  fs.writeFileSync(path.join(DATA, 'mops.json'), JSON.stringify(mops));
  // ItemInfo0N.rsi: 머리말, 분류, 개수, 그리고 항목마다 [분류, 아이콘, 이름, 설명, 수치 74바이트]
  const items = {}; let nItem = 0;
  for (let k = 1; k <= 9; k++) {
    const f = sub(path.join('Item', 'Info'), `ItemInfo0${k}.rsi`); if (!f) continue;
    const b = fs.readFileSync(f), kr = new TextDecoder('euc-kr'); let p = 1 + b[0]; p += 4; const cnt = b.readInt32LE(p); p += 4;
    const list = [];
    try {
      for (let i = 0; i < cnt; i++) {
        const kind = b.readInt32LE(p), icon = b.readInt32LE(p + 4); p += 8;
        let n = b[p]; const name = kr.decode(b.subarray(p + 1, p + 1 + n)); p += 1 + n;
        n = b[p]; const desc = kr.decode(b.subarray(p + 1, p + 1 + n)); p += 1 + n;
        const v = []; for (let q = 0; q < 14; q++) v.push(b.readInt32LE(p + q * 4));
        // 수치 순서 (CMapServerClient::CheckEquipment 0x43439b, InitializeEquipmentEffect 0x436b8c, InitializeRemainWeight 0x435135 에서 확인):
        //   0 체력 회복, 1 마력 회복, 2 공격, 3 방어, 4~7 근력·정신력·민첩성·기골 증가,
        //   8 요구 레벨, 9~12 요구 근력·정신력·민첩성·기골, 13 요구 명성
        //   56 착용 가능 직업(비트), 58 무게, 62 착용 부위, 66 특수 계산 종류, 67 무기 사거리, 70 가격
        // 착용 부위: 0 모자, 1 목걸이, 2 상의, 3 하의, 4 신발, 5 방패, 6 장갑, 7 무기, 8 벨트, 300 반지, 14 착용 불가
        const cls = b.readUInt16LE(p + 56), weight = b.readInt16LE(p + 58), type = b.readInt32LE(p + 62), grade = b[p + 66], range = b[p + 67], price = b.readInt32LE(p + 70); p += 74;
        list.push(kind ? { name, desc, icon, hp: v[0], mp: v[1], atk: v[2], def: v[3], v: v.slice(4, 8), req: v[8], reqStat: v.slice(9, 13), fame: v[13], cls, weight, type, grade, range, price } : null);
        if (kind) nItem++;
      }
    } catch (e) { console.warn(`아이템 정보 ${k}: 끝까지 읽지 못함`); }
    items[k] = list;
  }
  fs.writeFileSync(path.join(DATA, 'items.json'), JSON.stringify(items));
  console.log(`아이템 ${nItem}종`);
  // EventInfo.rse: NPC가 가리키는 이벤트 번호 → [종류, 정보...]. 맵마다 있는 이벤트 파일과는 별개의 표다 (CEventInfo::LoadEventInfo 0x404940, GetGlobalEvent 0x404ce0)
  const gev = {}; let gf = sub('Event', 'EventInfo.rse');
  for (const l of gf ? dataLines(krText(gf)) : []) { const v = l.split(/\s+/).map(Number); if (v.length >= 2 && !v.some(isNaN)) gev[v[0]] = v.slice(1); }
  fs.writeFileSync(path.join(DATA, 'events.json'), JSON.stringify(gev));
  // ShopNNNNN.rss: 분류 번호 수량(4000000001 = 무제한) 가격(%) 표시(1 = 상점이 판다, 2 = 상점이 사 준다) (CShopFile::ReadShopItem 0x486c00, CShopManager::Get 0x4872b0)
  const shops = {}; const sdir = findFile(SRV, 'Shop');
  for (const f of sdir ? fs.readdirSync(sdir) : []) {
    const m = /^shop(\d+)\.rss$/i.exec(f); if (!m) continue;
    const list = [];
    for (const l of dataLines(krText(path.join(sdir, f)))) { const v = l.split(/\s+/).map(Number); if (v.length >= 5 && !v.some(isNaN)) list.push(v.slice(0, 5)); }
    shops[Number(m[1])] = list;
  }
  fs.writeFileSync(path.join(DATA, 'shops.json'), JSON.stringify(shops));
  console.log(`NPC 이벤트 ${Object.keys(gev).length}개, 상점 ${Object.keys(shops).length}곳`);
  // skill00.rmi: 기술 정보. 머리말, 개수, 그리고 기술마다 아래 순서의 값 (CrSkillInfo::Serialize 0x485750 의 읽는 순서와 크기 그대로).
  // 값 하나하나의 뜻은 기술을 쓰는 함수들(UseSkill*, DoSkillEffect)을 읽어야 정해진다. 지금은 읽은 순서대로 a~p 로만 내보낸다.
  //   a 바이트(0 기술, 1 특수 기술), b 문자열, c 문자열(직업 번호), d 정수, e 바이트, f 바이트, g·h·i 정수, j 바이트, k 정수, l 2바이트, m 정수, n 바이트, o·p 정수
  const sk = sub('Skill', 'skill00.rmi');
  if (sk) {
    const r = new Reader(fs.readFileSync(sk)); r.str(); const n = r.i32(), skills = {};
    for (let i = 0; i < n; i++) {
      const v = { a: r.u8(), b: r.str(), c: r.str(), d: r.i32(), e: r.u8(), f: r.u8(), g: r.i32(), h: r.i32(), i: r.i32(), j: r.u8(), k: r.i32(), l: r.i16() & 0xffff, m: r.i32(), n: r.u8(), o: r.i32(), p: r.i32() };
      if (v.b !== '' || v.d) skills[i] = v;
    }
    fs.writeFileSync(path.join(DATA, 'skills.json'), JSON.stringify(skills));
    console.log(`기술 ${Object.keys(skills).length}개`);
  }
  let nSpawn = 0, nWarp = 0, nNpc = 0;
  for (const mi of mapInfo) {
    const no = mi.id, out = { map: no, spawns: [], events: {}, npcs: [], ev: '' };
    // Mop000NN.rsm: 이름 종류 왼쪽 위 오른쪽 아래 아이템종류수 (분류 번호 수량)... 패턴 마릿수 리젠시간(초)
    let f = sub('Mop', `Mop${pad(no)}.rsm`);
    for (const l of f ? dataLines(krText(f)) : []) {
      const t = l.split(/\s+/); const v = t.slice(1).map(Number); if (v.length < 9 || v.some(isNaN)) continue;
      const n = v[5], drops = [];
      for (let i = 0; i < n; i++) drops.push([v[6 + i * 3], v[7 + i * 3], v[8 + i * 3]]);
      const r = v.slice(6 + n * 3); if (r.length < 3 || !mops[v[0]]) continue;
      out.spawns.push({ name: t[0], kind: v[0], rect: v.slice(1, 5), drops, pattern: r[0], count: r[1], regen: r[2] });
      chrs.add(spriteOf(mops[v[0]].img));      // 모습 번호 → 캐릭터 그림 번호 (클라이언트의 대응표)
      nSpawn += r[1];
    }
    // EventNNNNN.rse: 번호 종류 정보...  (종류 1 = 맵 이동: 맵 x y 타일종류, 종류 5 = 안전지대)
    f = sub('Event', `Event${pad(no)}.rse`);
    for (const l of f ? dataLines(krText(f)) : []) {
      const v = l.split(/\s+/).map(Number); if (v.length < 2 || v.some(isNaN)) continue;
      out.events[v[0]] = v.slice(1); if (v[1] === 1) nWarp++;
    }
    // ExtraNNNNN.rme: +이름 모습 이벤트 왼쪽 위 오른쪽 아래 무작위이동
    f = sub('Extra', `Extra${pad(no)}.rme`);
    for (const l of f ? dataLines(krText(f)) : []) {
      const t = l.split(/\s+/); if (!t[0].startsWith('+')) continue;
      const v = t.slice(1).map(Number); if (v.length < 6 || v.some(isNaN)) continue;
      out.npcs.push({ name: t[0].slice(1), img: v[0], event: v[1], rect: v.slice(2, 6), move: v[6] || 0 });
      chrs.add(spriteOf(v[0])); nNpc++;
    }
    // 서버 맵(.smm): 칸마다 64비트 값이 상위 4바이트, 하위 4바이트 순으로 들어 있다 (CrsMap::Serialize 0x486af5).
    // 한 칸에는 서는 자리가 둘 있다: 자리 0은 칸의 왼쪽 위 모서리, 자리 1은 칸 한가운데 (Staff2.dll STAFFGetDirection 0x10006a80).
    // 비트 30~37 이벤트 번호, 비트 48/56 주인공 이동 가능(자리 0/1), 비트 49/57 몬스터 이동 가능(자리 0/1)
    // (CrsMap::GetEvent 0x486430, GetCanExistUser 0x486300, GetCanExistMop 0x486290)
    // walkUser·walkMop 은 칸마다 숫자 하나: 1 = 자리 0 가능, 2 = 자리 1 가능, 3 = 둘 다
    f = sub('Map', `Map${pad(no)}.smm`);
    if (f) {
      const b = fs.readFileSync(f); let p = 1 + b[0]; const w = b.readInt32LE(p), h = b.readInt32LE(p + 4); p += 8; p += 1 + b[p]; p += 4;
      if (w === mi.w && h === mi.h && p + w * h * 8 <= b.length) {
        const ev = Buffer.alloc(w * h); let uw = '', mw = '';
        for (let i = 0; i < w * h; i++) {
          const hi = b.readUInt32LE(p + i * 8), lo = b.readUInt32LE(p + i * 8 + 4);
          ev[i] = ((hi & 0x3f) << 2) | (lo >>> 30); uw += ((hi >>> 16) & 1) | ((hi >>> 23) & 2); mw += ((hi >>> 17) & 1) | ((hi >>> 24) & 2);
        }
        out.ev = ev.toString('base64'); out.walkUser = uw; out.walkMop = mw;
      }
    }
    fs.writeFileSync(path.join(DATA, 'maps', no + '.json'), JSON.stringify(out));
  }
  console.log(`서버 자료: 몬스터 종류 ${Object.keys(mops).length}, 배치 몬스터 ${nSpawn}마리, 맵 이동 지점 ${nWarp}개, NPC ${nNpc}명`);
}

// ---------- 글자 자료 (DATAs/Info/Message.ctf) ----------
// Message.dll 이 읽는 파일 (MESSAGEGetString(묶음, 번호)). 머리 문자열 "J.C.TypeConvTool Ver 1.1.2", 개수(u32),
// 그 뒤로 [열쇠 문자열 "묶음\t분류\t번호", u32 묶음, u32 분류, u32 번호, 글자] 가 개수만큼. 문자열은 MFC CString 저장 형식.
// 묶음 2 = 기술 ("이름@설명", 분류 = 기술 정보의 c, 번호 = b), 1/1 = 도움말, 0/x = 시스템 메시지, 4~9 = 아이템 이름·설명.
function convertMessages() {
  const f = D('Info', 'Message.ctf'); if (!fs.existsSync(f)) return;
  const b = fs.readFileSync(f); let p = 0;
  const len = () => { let n = b[p++]; if (n === 0xff) { n = b.readUInt16LE(p); p += 2; if (n === 0xffff) { n = b.readUInt32LE(p); p += 4; } } return n; };
  const cs = () => { const n = len(); const v = b.subarray(p, p + n); p += n; return v; };
  const dec = new TextDecoder('euc-kr');
  cs(); const cnt = b.readUInt32LE(p); p += 4;
  const out = {};
  for (let i = 0; i < cnt; i++) {
    cs(); const g = b.readUInt32LE(p), c = b.readUInt32LE(p + 4), n = b.readUInt32LE(p + 8); p += 12;
    const t = dec.decode(cs());
    ((out[g] ||= {})[c] ||= {})[n] = t;
  }
  fs.writeFileSync(path.join(OUT, 'messages.json'), JSON.stringify(out));
  console.log(`글자 자료 ${cnt}개`);
}

// ---------- 실행 ----------
if (has('sounds-only')) {    // 그림은 그대로 두고 동작 소리만 기존 json 에 넣는다
  let n = 0;
  for (const [kind, folder] of [['Chr', 'chr'], ['Bul', 'bul']]) for (const no of numbersIn(D(kind), new RegExp('^' + kind + '(\\d+)\\.rmd$', 'i'))) {
    const f = path.join(OUT, folder, no + '.json'); if (!fs.existsSync(f)) continue;
    const def = rmd(kind, no); if (!def) continue;
    const j = JSON.parse(fs.readFileSync(f, 'utf8')); delete j.snd;
    if (Object.keys(def.sounds).length) { j.snd = def.sounds; n++; }
    fs.writeFileSync(f, JSON.stringify(j));
  }
  console.log(`동작 소리가 있는 그림 묶음 ${n}개`);
  process.exit(0);
}
if (has('server-only')) {      // 그림은 그대로 두고 서버 자료만 다시 만든다
  convertMessages();
  convertServer(JSON.parse(fs.readFileSync(path.join(OUT, 'maps', 'index.json'), 'utf8')));
  process.exit(0);
}
const t0 = Date.now();
convertMessages();
const lists = { Tle: parseLst(fs.readFileSync(RL('tle.lst'))), Obj: parseLst(fs.readFileSync(RL('obj.lst'))) };
const mapInfo = [];
for (const n of maps) { const r = convertMap(n, lists); if (r) mapInfo.push(r); if (mapInfo.length % 25 === 0) console.log(`맵 ${mapInfo.length}/${maps.length}...`); }
const miss = [...imgSeen.Tle, ...imgSeen.Obj].filter(e => !e[1]).length;
console.log(`맵 ${mapInfo.length}장, 바닥·오브젝트 그림 ${imgSeen.Tle.size + imgSeen.Obj.size - miss}장` + (miss ? `, 찾지 못한 그림 ${miss}장` : ''));
// 일부만 변환했을 때는 기존 목록에 합친다
const mergeIndex = (file, add, isArr) => {
  let cur = isArr ? [] : {}; try { if (!ALL) cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  const out = isArr ? [...cur.filter(m => !add.some(a => a.id === m.id)), ...add].sort((a, b) => a.id - b.id) : { ...cur, ...add };
  fs.writeFileSync(file, JSON.stringify(out)); return out;
};
mk(path.join(OUT, 'maps')); mk(path.join(OUT, 'chr'));
const allMaps = mergeIndex(path.join(OUT, 'maps', 'index.json'), mapInfo, true);
if (SRV) convertServer(ALL ? mapInfo : allMaps);
const chrIndex = {};
for (const n of [...chrs].sort((a, b) => a - b)) { const r = convertChr(n); if (r) chrIndex[n] = r.name; }
mergeIndex(path.join(OUT, 'chr', 'index.json'), chrIndex, false);
if (has('ico')) for (const n of numbersIn(D('Ico'), /^ico(\d+)\.rmd$/i)) convertSprite('Ico', n, 'ico', 'Ico', 'ico');
if (!ALL && has('bul')) for (const n of numbersIn(D('Bul'), /^bul(\d+)\.rmd$/i)) convertSprite('Bul', n, 'bul', 'Bul', 'bul', true);
if (ALL) {
  let nb = 0, ni = 0;
  for (const n of numbersIn(D('Bul'), /^bul(\d+)\.rmd$/i)) if (convertSprite('Bul', n, 'bul', 'Bul', 'bul', true)) nb++;
  for (const n of numbersIn(D('Ico'), /^ico(\d+)\.rmd$/i)) if (convertSprite('Ico', n, 'ico', 'Ico', 'ico', true)) ni++;
  console.log(`총알·효과 ${nb}묶음, 아이콘 ${ni}묶음`);
  convertInt(); convertSound();
}
console.log(`변환 완료 (${Math.round((Date.now() - t0) / 1000)}초) →`, OUT);
