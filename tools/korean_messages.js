// 한국어 Message.ctf 를 기본 글자 자료로 쓴다.
// 사용: node tools/korean_messages.js <첫째 한국어 클라이언트> [<둘째 한국어 클라이언트>]
//
// 지금 assets/messages.json 은 Redmoon Advanced(영어) 클라이언트에서 뽑은 것이다.
// 한국 서비스 클라이언트들(엑사토 3944, Zeus)의 Message.ctf 는 같은 번호에 같은 뜻의 한국어 원문이 들어 있다.
// 기술·아이템·시스템 글이 번호별로 맞는다 (docs/korean_client_notes.md).
//
// 고르는 순서:
//  - 번호 하나마다: 첫째 클라이언트 → 둘째 클라이언트 → 영어. 비었거나 "blank" 면 다음으로 넘어간다.
//  - 묶음 1(도움말)은 분류째로 고른다. 줄 나눔이 판마다 달라서, 한 분류 안에 두 언어가 섞이지 않게 하려는 것이다.
//
// 영어 원본은 assets/messages_en.json 으로 남긴다 (처음 한 번만 만든다).
const fs = require('fs'), path = require('path');
function parse(f) {
  const b = fs.readFileSync(f); let p = 0;
  const len = () => { let n = b[p++]; if (n === 0xff) { n = b.readUInt16LE(p); p += 2; if (n === 0xffff) { n = b.readUInt32LE(p); p += 4; } } return n; };
  const cs = () => { const n = len(); const v = b.subarray(p, p + n); p += n; return v; };
  const dec = new TextDecoder('euc-kr'); cs(); const cnt = b.readUInt32LE(p); p += 4; const o = {};
  for (let i = 0; i < cnt; i++) { cs(); const g = b.readUInt32LE(p), c = b.readUInt32LE(p + 4), n = b.readUInt32LE(p + 8); p += 12; ((o[g] ||= {})[c] ||= {})[n] = dec.decode(cs()); }
  return o;
}
const ctf = dir => { const d = path.join(dir, 'DATAs', 'Info'); const f = fs.readdirSync(d).find(x => x.toLowerCase() === 'message.ctf'); return parse(path.join(d, f)); };
const A = path.join(__dirname, '..', 'assets'), EN = path.join(A, 'messages_en.json');
if (!fs.existsSync(EN)) fs.copyFileSync(path.join(A, 'messages.json'), EN);
const en = JSON.parse(fs.readFileSync(EN, 'utf8')), ko = process.argv.slice(2).map(ctf);
const ok = t => typeof t === 'string' && t.trim() !== '' && t.trim().toLowerCase() !== 'blank';
const out = {}, cnt = { ko: 0, en: 0 };
const groups = new Set([...Object.keys(en), ...ko.flatMap(Object.keys)]);
for (const g of groups) {
  const secs = new Set([...Object.keys(en[g] || {}), ...ko.flatMap(k => Object.keys(k[g] || {}))]);
  for (const c of secs) {
    const src = [...ko.map(k => (k[g] || {})[c]), (en[g] || {})[c]];
    let sec;
    if (g === '1') { const s = src.find(x => x && Object.values(x).some(ok)) || {}; sec = { ...s }; for (const n in sec) (src.indexOf(s) < ko.length ? cnt.ko++ : cnt.en++); }
    else {
      sec = {}; const ns = new Set(src.flatMap(x => Object.keys(x || {})));
      for (const n of ns) { const i = src.findIndex(x => x && ok(x[n])); if (i < 0) { const any = src.find(x => x && n in x); sec[n] = any ? any[n] : ''; continue; } sec[n] = src[i][n]; i < ko.length ? cnt.ko++ : cnt.en++; }
    }
    (out[g] ||= {})[c] = sec;
  }
}
fs.writeFileSync(path.join(A, 'messages.json'), JSON.stringify(out));
console.log(`한국어 ${cnt.ko}개, 영어로 남은 것 ${cnt.en}개`);
