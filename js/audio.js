/* Denglish Vocab (iPhone) - phat am
 * Tu don le: giong doc mau Oxford do may tinh tai ve va gui len kho (audio/...), iPhone luu lai nghe offline.
 * Cum tu, thanh ngu, hoac chua co file: giong doc cua iPhone (Anh / My).
 */
import { db, getMeta } from './db.js';
import { getRaw } from './sync.js';

const urls = new Map();     // duong dan trong kho -> object URL
let audioEl = null;

export async function accent() { return (await getMeta('accent', 'uk')) === 'us' ? 'us' : 'uk'; }
let accentNow = 'uk';
export const setAccentCache = (a) => { accentNow = a === 'us' ? 'us' : 'uk'; };
export const currentAccent = () => accentNow;

async function audioUrl(path) {
  if (urls.has(path)) return urls.get(path);
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
}

const pathFor = (card, acc) => {
  const f = card && card.audio_files;
  return f ? (f[acc] || f.uk || f.us || '') : '';
};

/** Tai truoc giong doc cua cac the sap on: iPhone chi cho phat am thanh ngay trong luc cham */
export function prefetch(cards) {
  (cards || []).forEach(c => { const p = pathFor(c, accentNow); if (p) audioUrl(p); });
}

export function speak(text, acc) {
  if (!window.speechSynthesis || !text) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text).replace(/\*\*/g, ''));
    u.lang = (acc || accentNow) === 'us' ? 'en-US' : 'en-GB';
    const v = speechSynthesis.getVoices().find(v => v.lang.replace('_', '-') === u.lang);
    if (v) u.voice = v;
    u.rate = 0.92;
    speechSynthesis.speak(u);
  } catch (e) {}
}

export function stop() {
  if (audioEl) { try { audioEl.pause(); } catch (e) {} }
  if (window.speechSynthesis) { try { speechSynthesis.cancel(); } catch (e) {} }
}

export function sayTerm(card, acc, btn) {
  acc = acc || accentNow;
  stop();
  const path = pathFor(card, acc);
  const url = path && urls.get(path);
  if (url) {
    audioEl = new Audio(url);
    if (btn) {
      btn.classList.add('playing');
      const off = () => btn.classList.remove('playing');
      audioEl.onended = off; audioEl.onerror = off;
    }
    audioEl.play().catch(() => { if (btn) btn.classList.remove('playing'); speak(card.term, acc); });
    return;
  }
  speak(card.term, acc);
  if (path) audioUrl(path);       // lan sau co san
}
