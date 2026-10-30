/* Denglish Vocab (iPhone) - tien ich dung chung */

export const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Khoa so sanh: giong vocab.norm() ben may tinh */
export function norm(t) {
  t = String(t || '').replace(/[’‘]/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();
  return t.replace(/^[ .,;:!?"“”()[\]{}*_`~\-–—•]+|[ .,;:!?"“”()[\]{}*_`~\-–—•]+$/g, '');
}

export function cleanTerm(t, pattern) {
  t = String(t || '').replace(/\s+/g, ' ').trim().replace(/[’‘]/g, "'");
  t = t.replace(/^[ .,;:!?"“”*_`~•–—]+|[ .,;:!?"“”*_`~•–—]+$/g, '');
  return t.slice(0, pattern ? 220 : 80);
}

/** Mau cau ("it's less about sth and more about sth"): toi da 40 chu, duoc co so va dau cau (giong vocab._valid_pattern) */
export function validPattern(t) {
  if (!t || t.length > 220 || t.split(/\s+/).length > 40 || (t.match(/[A-Za-z]+/g) || []).length < 3 || VI_ONLY.test(t)) return false;
  return /^[A-Za-zÀ-ÖØ-öø-ÿ0-9 '\-/().,!?&;:%$"…]+$/.test(t);
}

export const VI_CHARS = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const VI_ONLY = /[ăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịĩọỏốồổỗộớờởỡợụủũứừửữựỳỵỷỹ]/i;

/** Tu / cum tu tieng Anh hop le (giong vocab._valid_term) */
export function validTerm(t) {
  if (!t || t.length > 80 || !/[A-Za-z]/.test(t)) return false;
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ '\-/().,!?&]+$/.test(t) || VI_ONLY.test(t)) return false;
  if (t.split(/\s+/).filter(tok => VI_CHARS.test(tok)).length > 1) return false;
  return t.split(/\s+/).length <= 10;
}

/** Moc sua doi: "2026-10-14T03:00:00.123Z" (giong _stamp() ben may tinh) */
export const stamp = () => new Date().toISOString();
/** Moc ngay gio: "2026-10-14T03:00:00+00:00" (giong _iso() ben may tinh) */
export const isoSec = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, '+00:00');

export function hex(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const newId = () => 'c' + hex(6);

export function today(d) {
  d = d ? new Date(d) : new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export const utf8 = (s) => new TextEncoder().encode(s);
export const fromUtf8 = (b) => new TextDecoder().decode(b);

export function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToBytes(b64) {
  const s = atob(String(b64).replace(/\s+/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** JSON khoa sap xep, gon - giong json.dumps(sort_keys=True, separators=(",", ":")) ben may tinh */
export function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort()
      .map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

export async function sha1hex(text) {
  const buf = await crypto.subtle.digest('SHA-1', typeof text === 'string' ? utf8(text) : text);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function relTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const mins = Math.round((d - Date.now()) / 60000);
  if (mins <= 0) return 'bây giờ';
  if (mins < 60) return mins + ' phút nữa';
  const hours = Math.round(mins / 60);
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - t0) / 86400000);
  if (days <= 0) return hours + ' giờ nữa';
  if (days === 1) return 'ngày mai';
  if (days < 30) return days + ' ngày nữa';
  return d.toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric' });
}

export function ago(iso) {
  const t = new Date(iso);
  if (!iso || isNaN(t)) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return m + ' phút trước';
  if (m < 1440) return Math.round(m / 60) + ' giờ trước';
  return t.toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric' });
}

export function toast(msg, ms) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms || 2600);
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** fetch co gioi han thoi gian */
export async function fetchT(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 30000);
  try { return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal })); }
  finally { clearTimeout(timer); }
}
