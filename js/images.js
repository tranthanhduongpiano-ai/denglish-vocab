/* Denglish Vocab (iPhone) - anh minh hoa
 * Tim tren Openverse / Wikimedia Commons, tai ve luu trong may (IndexedDB), gui len kho GitHub khi dong bo.
 * Anh the soan tren may tinh thi lay tu kho ve, luu lai de xem offline.
 */
import { db, getMeta, setMeta } from './db.js';
import { S, patchCard } from './store.js';
import { esc, fetchT, hex } from './util.js';
import { getRaw } from './sync.js';

const OPENVERSE = 'https://api.openverse.org/v1/images/';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const MAX_IMAGE = 6 * 1024 * 1024;
const urls = new Map();          // ten anh -> object URL
let openversePause = 0;

const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function openverse(q, n) {
  if (Date.now() < openversePause) return [];
  const out = [];
  for (const extra of [{ aspect_ratio: 'wide' }, {}]) {
    const params = new URLSearchParams(Object.assign({ q, page_size: n, mature: 'false' }, extra));
    let r;
    try { r = await fetchT(OPENVERSE + '?' + params, {}, 15000); } catch (e) { return out; }
    if (r.status === 429) { openversePause = Date.now() + 600000; return out; }
    if (!r.ok) return out;
    const data = await r.json();
    for (const it of data.results || []) {
      if (!it.thumbnail) continue;
      const lic = [(it.license || '').toUpperCase(), it.license_version || ''].filter(Boolean).join(' ');
      const credit = [it.title, it.creator, lic ? 'CC ' + lic : '', it.source].filter(Boolean).join(' · ');
      out.push({ url: it.thumbnail, credit: credit.slice(0, 200) });
    }
    if (out.length >= Math.min(n, 4)) break;
  }
  return out.slice(0, n);
}

async function commons(q, n) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', generator: 'search', gsrnamespace: '6',
    gsrsearch: q + ' filetype:bitmap', gsrlimit: String(n), prop: 'imageinfo',
    iiprop: 'url|mime|extmetadata', iiurlwidth: '640', iiextmetadatafilter: 'Artist|LicenseShortName|ObjectName',
  });
  let pages;
  try { pages = ((await (await fetchT(COMMONS + '?' + params, {}, 15000)).json()).query || {}).pages || {}; }
  catch (e) { return []; }
  return Object.values(pages).sort((a, b) => (a.index || 0) - (b.index || 0)).map(p => {
    const info = (p.imageinfo || [{}])[0];
    if (!info.thumburl || !String(info.mime || '').startsWith('image/')) return null;
    const m = info.extmetadata || {};
    const credit = [strip((m.ObjectName || {}).value) || String(p.title || '').replace('File:', ''),
                    strip((m.Artist || {}).value), strip((m.LicenseShortName || {}).value), 'Wikimedia Commons'].filter(Boolean).join(' · ');
    return { url: info.thumburl, credit: credit.slice(0, 200) };
  }).filter(Boolean);
}

export async function searchImages(q, n) {
  n = n || 12;
  q = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!q) return [];
  const a = await openverse(q, Math.max(4, n - 4));
  const b = await commons(q, Math.max(4, n - a.length));
  const seen = new Set();
  return a.concat(b).filter(x => !seen.has(x.url) && seen.add(x.url)).slice(0, n);
}

export function sniff(bytes) {
  const b = bytes.subarray(0, 12);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'webp';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  return '';
}
const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

export async function fetchImage(url) {
  let r;
  try { r = await fetchT(url, { mode: 'cors' }, 25000); }
  catch (e) { throw new Error('Không tải được ảnh này (trang ảnh chặn hoặc mất mạng).'); }
  if (!r.ok) throw new Error('Trang ảnh báo lỗi (' + r.status + ').');
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length > MAX_IMAGE) throw new Error('Ảnh quá lớn (tối đa 6 MB).');
  const ext = sniff(bytes);
  if (!ext) throw new Error('Link này không phải ảnh JPG, PNG, WEBP hoặc GIF.');
  return { bytes, ext };
}

async function queueUpload(path) {
  const list = await getMeta('uploads', []);
  if (!list.includes(path)) { list.push(path); await setMeta('uploads', list); }
}

/** Luu anh cho the (ten giong may tinh: <id>-<6 hex>.<duoi>) */
export async function storeImage(id, bytes, ext, credit) {
  const name = id + '-' + hex(3) + '.' + ext;
  const blob = new Blob([bytes], { type: TYPES[ext] });
  await db.put('blobs', { path: 'img/' + name, blob });
  await queueUpload('img/' + name);
  urls.set(name, URL.createObjectURL(blob));
  return patchCard(id, { image: name, image_credit: String(credit || '').slice(0, 200), image_state: 'ok' });
}

export const setImageFromUrl = async (id, url, credit) => {
  const { bytes, ext } = await fetchImage(url);
  return storeImage(id, bytes, ext, credit);
};

export const removeImage = (id) => patchCard(id, { image: '', image_credit: '', image_state: 'removed' });

/** Anh tu dien thoai thuong rat lon: thu nho con ~900px roi moi luu */
export function shrink(file) {
  return new Promise((resolve) => {
    if (!/^image\//.test(file.type) || file.type === 'image/gif') return resolve(file);
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 900 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob(b => resolve(b || file), 'image/jpeg', 0.86);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

export async function setImageFromFile(id, file) {
  const blob = await shrink(file);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const ext = sniff(bytes);
  if (!ext) throw new Error('File không phải ảnh JPG, PNG, WEBP hoặc GIF.');
  if (bytes.length > MAX_IMAGE) throw new Error('Ảnh quá lớn (tối đa 6 MB).');
  return storeImage(id, bytes, ext, 'Ảnh của bạn');
}

/** Tu tim anh cho the vua soan xong (lay ket qua dau tien tai duoc) */
export async function autoImage(id) {
  const c = S.cards.get(id);
  if (!c || c.image) return;
  const queries = [...new Set([c.image_query, c.term].filter(Boolean))];
  for (const q of queries) {
    for (const r of (await searchImages(q, 6)).slice(0, 3)) {
      try { const { bytes, ext } = await fetchImage(r.url); await storeImage(id, bytes, ext, r.credit); return; }
      catch (e) { /* thu anh khac */ }
    }
  }
  const cur = S.cards.get(id);
  if (cur && !cur.image) await patchCard(id, { image_state: 'none' }, true);
}

/** URL hien anh: trong may truoc, khong co thi lay tu kho GitHub roi luu lai */
export async function imageUrl(name) {
  if (!name) return null;
  if (urls.has(name)) return urls.get(name);
  const row = await db.get('blobs', 'img/' + name);
  if (row && row.blob) { const u = URL.createObjectURL(row.blob); urls.set(name, u); return u; }
  if (!navigator.onLine) return null;
  try {
    const bytes = await getRaw('img/' + name);
    const ext = sniff(bytes);
    if (!ext) return null;
    const blob = new Blob([bytes], { type: TYPES[ext] });
    await db.put('blobs', { path: 'img/' + name, blob });
    const u = URL.createObjectURL(blob);
    urls.set(name, u);
    return u;
  } catch (e) { return null; }
}

export function imgHtml(card, cls) {
  if (card.image) return '<img data-img="' + esc(card.image) + '" alt="" draggable="false" />' +
    '<span class="' + (cls || 'emo') + ' img-fallback">' + esc(card.emoji || '📘') + '</span>';
  return '<span class="' + (cls || 'emo') + '">' + esc(card.emoji || '📘') + '</span>';
}

/** Gan anh that vao cac <img data-img> vua ve */
export function hydrate(root) {
  (root || document).querySelectorAll('img[data-img]:not([src])').forEach(img => {
    imageUrl(img.dataset.img).then(u => {
      if (u) { img.src = u; img.onload = () => img.classList.add('ok'); }
    });
  });
}

export function preloadImages(cards) {
  (cards || []).forEach(c => { if (c && c.image) imageUrl(c.image); });
}
