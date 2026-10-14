/* Denglish Vocab (iPhone) - phat am
 * Tu don le: giong doc mau Oxford do may tinh tai ve va gui len kho (audio/...), iPhone luu lai nghe offline.
 * Cum tu, thanh ngu, hoac chua co file: giong doc cua iPhone (Anh / My).
 *
 * Ba dieu iPhone bat buoc:
 *  - Chi cho trang web phat tieng ngay trong luc cham. Nen lan cham dau tien "mo khoa" mot trinh phat
 *    dung chung (phat mot doan im lang); sau do trinh phat nay phat duoc ca khi file tai xong muon hon.
 *  - Gat cong tac im lang thi tieng trang web bi tat: dat phien am thanh la "playback" (nhu app nghe nhac)
 *    de van nghe duoc.
 *  - Goi speechSynthesis.cancel() ngay truoc speak() co luc lam iPhone khong doc: chi huy khi dang doc.
 */
import { db, getMeta } from './db.js';
import { getRaw } from './sync.js';

const urls = new Map();       // duong dan trong kho -> object URL
const loading = new Map();    // duong dan -> Promise dang tai
let player = null;            // trinh phat dung chung (da mo khoa)
let unlocked = false;
let unlocking = false;
let playToken = 0;
// WAV im lang rat ngan, dung de mo khoa trinh phat
const SILENT = 'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';

export async function accent() { return (await getMeta('accent', 'uk')) === 'us' ? 'us' : 'uk'; }
let accentNow = 'uk';
export const setAccentCache = (a) => { accentNow = a === 'us' ? 'us' : 'uk'; };
export const currentAccent = () => accentNow;

function ensurePlayer() {
  if (!player) {
    player = new Audio();
    player.preload = 'auto';
    player.setAttribute('playsinline', '');
  }
  return player;
}

/** Goi trong lan cham dau tien: mo khoa trinh phat va giong doc cua iPhone */
export function unlock() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  if (unlocked || unlocking) return;
  unlocking = true;
  const p = ensurePlayer();
  try {
    p.src = SILENT;
    const r = p.play();
    if (r && r.then) r.then(() => { unlocked = true; }, () => {}).finally(() => { unlocking = false; });
    else { unlocked = true; unlocking = false; }
  } catch (e) { unlocking = false; }
  try {
    if (window.speechSynthesis && !speechSynthesis.speaking) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  } catch (e) {}
}
['touchend', 'click', 'keydown'].forEach(t => document.addEventListener(t, unlock, { capture: true, passive: true }));

async function audioUrl(path) {
  if (urls.has(path)) return urls.get(path);
  if (loading.has(path)) return loading.get(path);
  const job = (async () => {
    const row = await db.get('blobs', path);
    let blob = row && row.blob;
    if (!blob && navigator.onLine) {
      try {
        blob = new Blob([await getRaw(path)], { type: 'audio/mpeg' });
        await db.put('blobs', { path, blob });
      } catch (e) { return null; }
    }
    if (!blob) return null;
    const u = URL.createObjectURL(blob);
    urls.set(path, u);
    return u;
  })();
  loading.set(path, job);
  try { return await job; } finally { loading.delete(path); }
}

const pathFor = (card, acc) => {
  const f = card && card.audio_files;
  return f ? (f[acc] || f.uk || f.us || '') : '';
};

/** Tai truoc giong doc cua cac the sap on (luu trong may, lan sau nghe ngay ca khi mat mang) */
export function prefetch(cards) {
  (cards || []).forEach(c => { const p = pathFor(c, accentNow); if (p) audioUrl(p); });
}

function pickVoice(lang) {
  const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  const norm = (v) => v.lang.replace('_', '-');
  return voices.find(v => norm(v) === lang && /enhanced|premium|natural/i.test(v.name)) ||
         voices.find(v => norm(v) === lang) || voices.find(v => norm(v).startsWith('en-')) || null;
}

export function speak(text, acc) {
  if (!window.speechSynthesis || !text) return;
  try {
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text).replace(/\*\*/g, ''));
    u.lang = (acc || accentNow) === 'us' ? 'en-US' : 'en-GB';
    const v = pickVoice(u.lang);
    if (v) u.voice = v;
    u.rate = 0.92;
    speechSynthesis.speak(u);
  } catch (e) {}
}

export function stop() {
  playToken++;
  if (player) { try { player.pause(); } catch (e) {} }
  if (window.speechSynthesis && (speechSynthesis.speaking || speechSynthesis.pending)) {
    try { speechSynthesis.cancel(); } catch (e) {}
  }
}

function playUrl(url, text, acc, btn, token) {
  const p = ensurePlayer();
  if (btn) btn.classList.add('playing');
  const off = () => { if (btn) btn.classList.remove('playing'); };
  p.onended = off;
  p.onerror = () => { off(); if (token === playToken) speak(text, acc); };
  p.src = url;
  const r = p.play();
  if (r && r.then) r.then(() => { unlocked = true; }, () => { off(); if (token === playToken) speak(text, acc); });
}

export function sayTerm(card, acc, btn) {
  acc = acc || accentNow;
  unlock();
  stop();
  const token = playToken;
  const path = pathFor(card, acc);
  if (!path) { speak(card.term, acc); return; }
  const ready = urls.get(path);
  if (ready) { playUrl(ready, card.term, acc, btn, token); return; }
  // Chua tai file Oxford: tai xong thi phat (trinh phat da mo khoa nen phat muon van duoc)
  const t0 = Date.now();
  if (btn) btn.classList.add('playing');
  audioUrl(path).then(u => {
    if (btn) btn.classList.remove('playing');
    if (token !== playToken) return;               // da sang the khac / bam nghe lai
    if (u && Date.now() - t0 < 8000) playUrl(u, card.term, acc, btn, token);
    else speak(card.term, acc);
  });
}
