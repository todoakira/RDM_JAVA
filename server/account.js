'use strict';
// 계정과 캐릭터 세 칸. 원작 로그인 서버 svIP.exe (CIPClient):
//  - 로그인 ID 하나에 캐릭터 이름 세 칸 (계정 +0x87c 부터 17바이트씩 세 개, ProcessDeleteCharacterID 0x4068a0 의 세 번 도는 고리).
//    클라이언트 고르기 화면도 칸 셋 (if-co-ba).
//  - 새 캐릭터 (ProcessNewCharacterID 0x404a10): 이름 14바이트까지, 작은따옴표 금지, 이미 있는 이름이면 0/1/17, 빈 칸이 없으면 0/1/3.
//  - 지우기 (ProcessDeleteCharacterID): 레벨이 1001 이상이면 0/1/29 ("To delete characters over level %u…", 서버 종류 2·3 은 500),
//    군단장이면 0/1/25. 지우면 군단에서 빼고, 캐릭터·우편·특수 아이템을 지운다.
//    원작은 계정의 생년월일(dd-dd-dd)이 맞아야 지운다. 여기서는 계정에 생년월일이 없어서 비밀번호로 대신한다.
//  - 0/1/0 이미 있는 ID, 0/1/1 없는 ID, 0/1/2 비밀번호가 틀림, 0/1/4 "Select your character."
// 예전 판의 캐릭터(이름마다 비밀번호)는, 그 이름을 ID 로 처음 로그인하면 그 캐릭터 하나를 가진 계정으로 옮긴다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const SLOTS = 3;
const DELETE_MAX_LEVEL = 1001;

const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32);
const bytes = s => [...s].reduce((n, c) => n + (c.charCodeAt(0) > 127 ? 2 : 1), 0);

class Accounts {
  constructor(game) {
    this.game = game; this.file = path.join(ROOT, 'save', 'accounts.json');
    try { this.db = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { this.db = {}; }
  }
  save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.db)); } catch (e) {} }
  key(id) { return String(id).toLowerCase(); }
  check(a, pw) { const h = hash(pw, Buffer.from(a.auth.salt, 'hex')); return crypto.timingSafeEqual(h, Buffer.from(a.auth.hash, 'hex')); }
  newAuth(pw) { const salt = crypto.randomBytes(16); return { salt: salt.toString('hex'), hash: hash(pw, salt).toString('hex') }; }
  owner(name) { for (const [k, a] of Object.entries(this.db)) if (a.chars.includes(name)) return k; return null; }
  // 로그인: { error } 또는 { id }
  login(id, pw, create) {
    id = String(id || '').replace(/[\u0000-\u001f<>']/g, '').trim(); pw = String(pw || '');
    if (!id || bytes(id) > 14) return { code: 9 };
    if (pw.length < 4 || pw.length > 64) return { code: 10 };
    const k = this.key(id); let a = this.db[k];
    if (create) {
      if (a || this.oldSave(id)) return { code: 0 };
      this.db[k] = { id, auth: this.newAuth(pw), chars: new Array(SLOTS).fill(null) }; this.save();
      return { id: k };
    }
    if (!a) {
      const d = this.oldSave(id);                                        // 예전 판 캐릭터 옮기기
      if (!d || this.owner(id)) return { code: 1 };
      if (!d.auth || !this.check({ auth: d.auth }, pw)) return { code: 2 };
      a = this.db[k] = { id, auth: d.auth, chars: [id, null, null] }; this.save();
      return { id: k };
    }
    if (!this.check(a, pw)) return { code: 2 };
    return { id: k };
  }
  oldSave(name) { try { const f = this.game.saveFile(name); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; } catch (e) { return null; } }
  list(k) {
    const a = this.db[k]; if (!a) return [];
    return a.chars.map(n => { if (!n) return null; const d = this.oldSave(n) || {}; return { name: n, chr: d.chr | 0, level: d.level || 1 }; });
  }
  // 새 캐릭터 이름 잡기 (저장 파일은 처음 들어갈 때 만든다)
  newChar(k, slot, name) {
    const a = this.db[k]; if (!a) return { code: 6 };
    name = String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim();
    if (!name || bytes(name) > 14 || name.includes("'")) return { code: 24 };
    if (!(slot >= 0 && slot < SLOTS) || a.chars[slot]) { slot = a.chars.indexOf(null); if (slot < 0) return { code: 3 }; }
    if (this.oldSave(name) || this.owner(name)) return { code: 17 };
    a.chars[slot] = name; this.save();
    return { slot, created: true };
  }
  delChar(k, slot, pw) {
    const a = this.db[k]; if (!a || !a.chars[slot]) return { code: 6 };
    if (!this.check(a, String(pw || ''))) return { code: 2 };
    const name = a.chars[slot], d = this.oldSave(name) || {};
    if ((d.level || 1) >= DELETE_MAX_LEVEL) return { code: 29, args: [DELETE_MAX_LEVEL] };
    if (this.game.isOnline(name)) return { code: 8 };
    const army = this.game.army;                                        // 군단장이면 못 지운다, 병사면 군단에서 뺀다 (CArmy::RemoveArmyMember)
    if (army && Object.values(army.db.armies).some(x => x.commander === name)) return { code: 25 };
    if (army && army.db.members[name]) { delete army.db.members[name]; army.save(); }
    try { fs.unlinkSync(this.game.saveFile(name)); } catch (e) {}
    if (this.game.mail && this.game.mail.box) { delete this.game.mail.box[name]; this.game.mail.save(); }   // CMailDB::DelAllMail
    a.chars[slot] = null; this.save();
    return { ok: 1 };
  }
  has(k, name) { const a = this.db[k]; return !!(a && a.chars.includes(name)); }
}
module.exports = { Accounts, SLOTS };
