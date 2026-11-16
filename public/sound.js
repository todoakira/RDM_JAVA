'use strict';
// 소리: 배경음악과 효과음.
// 배경음악: 맵 번호마다 정해진 곡 (Main.dll 0x10005458 의 표 + rm3944cl.dll NewMapFix, tools/music_table.py → assets/music.json).
//   원본은 MIDI 다. 브라우저가 MIDI 를 재생하지 못해 GM 사운드폰트로 OGG 로 바꿔 두었다 (tools/midi2ogg.py → assets/bgm).
// 효과음: 그림 묶음(캐릭터·총알)의 동작마다 [소리 번호, 장면] 이 있다 (ExStage.dll SOUND_SET). 그 동작의 그 장면이 나올 때 snd<번호> 를 낸다.
const Sound = (() => {
  let music = null, cur = '', on = true, ctx = null;
  const buffers = new Map();
  try { on = localStorage.getItem('rmSound') !== 'off'; } catch (e) {}
  fetch('assets/music.json').then(r => r.json()).then(j => { music = j; if (pendingMap !== null) playMap(pendingMap); }).catch(() => {});
  const bgm = new Audio(); bgm.loop = true; bgm.volume = 0.5;
  let pendingMap = null;
  function trackOf(id) {
    if (!music) return null;
    return music.patch[id] || (id <= 188 ? music.maps[id] : null) || music.default;
  }
  function playMap(id) {
    pendingMap = id; if (!music) return;
    const t = trackOf(id); if (!t || t === cur) return;
    cur = t; bgm.src = `assets/bgm/${t}.ogg`;
    if (on) bgm.play().catch(() => {});
  }
  function ac() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  function play(no, vol = 1) {
    if (!on || !no) return;
    const c = ac(); if (!c) return;
    let b = buffers.get(no);
    if (b === undefined) {
      buffers.set(no, null);
      fetch(`assets/snd/snd${String(no).padStart(5, '0')}.wav`).then(r => r.ok ? r.arrayBuffer() : Promise.reject()).then(a => c.decodeAudioData(a))
        .then(d => { buffers.set(no, d); }).catch(() => {});
      return;   // 처음 한 번은 받는 동안 건너뛴다
    }
    if (!b) return;
    const s = c.createBufferSource(), g = c.createGain(); g.gain.value = 0.7 * vol;
    s.buffer = b; s.connect(g).connect(c.destination); s.start();
  }
  // 그림 묶음의 동작 소리: 같은 동작이 시작될 때마다 한 번, 정해진 장면에서
  function frameSound(def, act, frameIdx, holder, key) {
    const e = def && def.snd && def.snd[act]; if (!e) return;
    if (frameIdx >= e[1] && holder[key] !== true) { holder[key] = true; play(e[0]); }
  }
  function toggle() {
    on = !on; try { localStorage.setItem('rmSound', on ? 'on' : 'off'); } catch (e) {}
    if (on) { ac(); if (bgm.src) bgm.play().catch(() => {}); } else bgm.pause();
    return on;
  }
  // 브라우저는 사용자가 한 번 누르기 전에는 소리를 막는다
  addEventListener('pointerdown', () => { ac(); if (on && bgm.src && bgm.paused) bgm.play().catch(() => {}); }, { once: false });
  return { playMap, play, frameSound, toggle, get on() { return on; } };
})();
