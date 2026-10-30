/* Denglish Vocab (iPhone) - so tu va lich on 5 cap (giong het vocab.py ben may tinh)
 *
 *   thuoc       -> len mot cap, gap lai sau 1, 3, 7, 14, 30 ngay (cap 5 thi nhan doi, toi da 180)
 *   mang mang   -> giu cap (cap 4-5 lui mot cap), on lai sau nua gian cach cua cap do
 *   chua thuoc  -> ve cap 1, den han lai sau 10 phut (trong buoi on gap lai cuoi luot)
 */
import { db, getMeta, setMeta } from './db.js';
import { cleanTerm, isoSec, newId, norm, stamp, today, validPattern, validTerm } from './util.js';

const INTERVALS = [0, 1, 3, 7, 14, 30];
const MAX_INTERVAL = 180;
const RELEARN_MINUTES = 10;
const DAY_START_HOUR = 3;
const MAX_ITEMS = 500;
export const KINDS = ['word', 'phrasal verb', 'phrase', 'idiom', 'collocation', 'pattern'];   // pattern: mau cau
export const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const LOCAL_ONLY = ['prev', 'tries'];

export const S = {
  cards: new Map(),        // id -> the
  deleted: new Map(),      // id -> luc xoa
  days: {},                // so tu on moi ngay tren may nay
  daysRemote: {},          // may khac: {may: {days}}
};
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
function changed(what) { listeners.forEach(fn => { try { fn(what); } catch (e) { console.error(e); } }); }

export class VocabError extends Error {}

export async function load() {
  const rows = await db.all('cards');
  S.cards.clear();
  S.deleted.clear();
  for (const r of rows) {
    if (r.deleted) S.deleted.set(r.id, r.modified);
    else S.cards.set(r.id, r);
  }
  S.days = await getMeta('days', {});
  S.daysRemote = await getMeta('daysRemote', {});
}

const save = (c) => db.put('cards', c);
const touch = (c) => { c.modified = stamp(); };

/* ---------- doc ---------- */
export const LIGHT = ['id', 'term', 'kind', 'pos', 'cefr', 'meaning_vi', 'emoji', 'image', 'level', 'due',
                      'status', 'reviews', 'created', 'source'];
export const light = (c) => Object.fromEntries(LIGHT.map(k => [k, c[k]]));
export const pub = (c) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'prev' && k !== 'keys'));

export function keyIndex() {
  const idx = new Map();
  for (const c of S.cards.values()) {
    for (const k of (c.keys && c.keys.length ? c.keys : [norm(c.term)])) if (!idx.has(k)) idx.set(k, c);
  }
  return idx;
}

export function listLight() {
  return [...S.cards.values()].sort((a, b) => String(b.created || '').localeCompare(String(a.created || ''))).map(light);
}

export function get(id) {
  const c = S.cards.get(id);
  if (!c) throw new VocabError('Không tìm thấy thẻ này (có thể đã bị xoá).');
  return pub(c);
}

/* ---------- them / sua / xoa ---------- */
function newCard(term, note, context, source, sourceUrl, contextVi) {
  const now = isoSec(Date.now());
  return {
    id: newId(), term, keys: [norm(term)],
    kind: '', pos: '', cefr: '', ipa_uk: '', ipa_us: '', audio: false, ox_url: '',
    def_en: '', meaning_vi: '', examples: [], synonyms: [], note_vi: '',
    emoji: '', image: '', image_query: '', image_credit: '', image_state: '',
    user_note: note || '', context: context || '', context_vi: contextVi || '', source: source || '', source_url: sourceUrl || '',
    status: 'pending', error: '', engine: '',
    level: 0, interval: 0, due: '', reviews: 0, lapses: 0,
    last_grade: '', last_review: '', session: '',
    created: now, updated: now, modified: stamp(),
  };
}

export async function addItems(items) {
  const added = [], existing = [];
  const idx = keyIndex();
  for (const it of (items || []).slice(0, MAX_ITEMS)) {
    const pattern = !!it && it.kind === 'pattern';        // boi den ca cau: luu thanh mau cau
    const term = cleanTerm(it && it.term, pattern);
    const key = norm(term);
    if (!(pattern ? validPattern(term) : validTerm(term)) || !key) continue;
    const note = String(it.note || '').trim().slice(0, 300);
    const hit = idx.get(key);
    if (hit) {
      if (note && !hit.user_note) { hit.user_note = note; touch(hit); await save(hit); }
      if (!existing.includes(hit)) existing.push(hit);
      continue;
    }
    const context = String(it.context || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    // context_vi: ban dich cau trong bai (bai Dictation) - AI lay nghia theo dung cach dich nay
    const contextVi = context ? String(it.context_vi || '').replace(/\s+/g, ' ').trim().slice(0, 600) : '';
    const c = newCard(term, note, context, String(it.source || '').slice(0, 200), String(it.source_url || '').slice(0, 300), contextVi);
    if (pattern) c.kind = 'pattern';
    S.cards.set(c.id, c);
    idx.set(key, c);
    added.push(c);
  }
  if (added.length) await db.putMany('cards', added);
  if (added.length || existing.length) changed('add');
  return { added: added.map(light), existing: existing.map(light) };
}

const EDIT_TEXT = { term: 220, meaning_vi: 200, def_en: 400, ipa_uk: 80, ipa_us: 80, pos: 40,
                    note_vi: 600, user_note: 300, emoji: 16, context: 400, context_vi: 600 };

export function cleanExamples(items) {
  const out = [];
  for (const e of items || []) {
    const en = String((e && e.en) || (typeof e === 'string' ? e : '')).trim();
    const vi = String((e && e.vi) || '').trim();
    if (en) out.push({ en: en.slice(0, 300), vi: vi.slice(0, 300) });
  }
  return out.slice(0, 6);
}

export async function updateCard(id, patch) {
  const c = S.cards.get(id);
  if (!c) throw new VocabError('Không tìm thấy thẻ này.');
  for (const [field, limit] of Object.entries(EDIT_TEXT)) {
    if (!(field in patch)) continue;
    let value = String(patch[field] || '').replace(/[ \t]+/g, ' ').trim().slice(0, limit);
    if (field === 'term') {
      const pattern = (patch.kind || c.kind) === 'pattern';
      value = cleanTerm(value, pattern);
      if (!(pattern ? validPattern(value) : validTerm(value))) throw new VocabError(pattern ? 'Mẫu câu không hợp lệ.' : 'Từ / cụm từ không hợp lệ.');
      const key = norm(value);
      const other = [...S.cards.values()].find(o => o.id !== id && (o.keys || [norm(o.term)]).includes(key));
      if (other) throw new VocabError('“' + other.term + '” đã có trong sổ từ.');
      c.keys = c.keys || [];
      if (!c.keys.includes(key)) c.keys.push(key);
    }
    c[field] = value;
  }
  if ('kind' in patch && KINDS.includes(patch.kind)) c.kind = patch.kind;
  if ('cefr' in patch && (CEFR.includes(patch.cefr) || patch.cefr === '')) c.cefr = patch.cefr;
  if (Array.isArray(patch.examples)) c.examples = cleanExamples(patch.examples);
  if (Array.isArray(patch.synonyms)) c.synonyms = patch.synonyms.map(s => String(s).trim().slice(0, 60)).filter(Boolean).slice(0, 8);
  if (patch.reset) { Object.assign(c, { level: 0, interval: 0, due: '', last_grade: '', session: '' }); delete c.prev; }
  c.updated = isoSec(Date.now());
  touch(c);
  await save(c);
  changed('edit');
  return pub(c);
}

/** Ghi de cac truong (AI soan xong, doi anh...) */
export async function patchCard(id, fields, quiet) {
  const c = S.cards.get(id);
  if (!c) return null;
  Object.assign(c, fields);
  touch(c);
  await save(c);
  if (!quiet) changed('patch');
  return c;
}

export async function deleteCard(id) {
  const c = S.cards.get(id);
  if (!c) return false;
  S.cards.delete(id);
  const ts = stamp();
  S.deleted.set(id, ts);
  await db.put('cards', { id, deleted: true, modified: ts });
  changed('delete');
  return true;
}

export async function regenerate(id) {
  const c = S.cards.get(id);
  if (!c) throw new VocabError('Không tìm thấy thẻ này.');
  c.status = 'pending'; c.error = ''; delete c.tries;
  touch(c);
  await save(c);
  changed('regen');
  return pub(c);
}

/* ---------- on tap ---------- */
function dueAfter(days, now) {
  if (days < 1) return new Date(now.getTime() + days * 86400000);
  const d = new Date(now);
  d.setDate(d.getDate() + Math.floor(days + 0.5));
  d.setHours(DAY_START_HOUR, 0, 0, 0);
  return d;
}

function schedule(c, grade, relearn, now) {
  const lv = +c.level || 0;
  if (relearn) {
    if (grade === 'know') {
      const days = INTERVALS[Math.max(1, lv)];
      return { due: isoSec(dueAfter(days, now)), interval: days };
    }
    return { due: isoSec(new Date(now.getTime() + RELEARN_MINUTES * 60000)), interval: 0 };
  }
  let lapses = +c.lapses || 0, newLv, days;
  if (grade === 'know') {
    if (lv === 0) { newLv = 2; days = INTERVALS[2]; }
    else if (lv >= 5) { newLv = 5; days = Math.min(MAX_INTERVAL, Math.max(INTERVALS[5], Math.round((+c.interval || 0) * 2))); }
    else { newLv = lv + 1; days = INTERVALS[lv + 1]; }
  } else if (grade === 'vague') {
    newLv = lv === 0 ? 1 : (lv >= 4 ? lv - 1 : lv);
    days = Math.max(0.5, INTERVALS[newLv] / 2);
  } else {
    newLv = 1; days = 0;
    if (lv >= 1) lapses += 1;
  }
  const due = days === 0 ? new Date(now.getTime() + RELEARN_MINUTES * 60000) : dueAfter(days, now);
  return { level: newLv, interval: days, due: isoSec(due), lapses };
}

const SRS = ['level', 'interval', 'due', 'reviews', 'lapses', 'last_grade', 'last_review', 'session'];

export async function answer(id, grade, session) {
  if (!['know', 'vague', 'unknown'].includes(grade)) throw new VocabError('Câu trả lời không hợp lệ.');
  const c = S.cards.get(id);
  if (!c) throw new VocabError('Không tìm thấy thẻ này (có thể đã bị xoá).');
  const now = new Date();
  const relearn = !!session && c.session === session && !!c.last_review;
  const prev = Object.fromEntries(SRS.map(k => [k, c[k]]));
  prev.counted = !relearn;
  Object.assign(c, schedule(c, grade, relearn, now));
  c.reviews = (+c.reviews || 0) + 1;
  c.last_grade = grade;
  c.last_review = isoSec(now);
  c.session = session || '';
  c.prev = (c.prev || []).concat([prev]).slice(-5);
  touch(c);
  await save(c);
  if (!relearn) await bumpToday(1);
  changed('answer');
  return { id, level: c.level, due: c.due };
}

export async function undo(id) {
  const c = S.cards.get(id);
  const stack = c && Array.isArray(c.prev) ? c.prev : [];
  const prev = stack.pop();
  if (!prev) throw new VocabError('Không còn gì để hoàn tác cho thẻ này.');
  const counted = prev.counted;
  delete prev.counted;
  Object.assign(c, prev);
  touch(c);
  await save(c);
  if (counted) await bumpToday(-1);
  changed('undo');
  return { id, level: c.level, due: c.due };
}

async function bumpToday(delta) {
  const d = today();
  S.days[d] = Math.max(0, (+S.days[d] || 0) + delta);
  if (!S.days[d]) delete S.days[d];
  await setMeta('days', S.days);
}

export function allDays() {
  const days = Object.assign({}, S.days);
  for (const dev of Object.values(S.daysRemote || {})) {
    for (const [d, n] of Object.entries((dev && dev.days) || {})) days[d] = (+days[d] || 0) + (+n || 0);
  }
  return days;
}

function streak(days) {
  const d = new Date();
  if (!days[today(d)]) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days[today(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

export function isDue(c, now) {
  return (+c.level || 0) >= 1 && (!c.due || new Date(c.due) <= (now || new Date()));
}

export function summary() {
  const now = new Date();
  const levels = [0, 0, 0, 0, 0, 0];
  let due = 0, pending = 0, next = null;
  for (const c of S.cards.values()) {
    const lv = Math.min(5, Math.max(0, +c.level || 0));
    levels[lv]++;
    if (c.status === 'pending') pending++;
    if (lv >= 1) {
      const d = c.due ? new Date(c.due) : null;
      if (!d || d <= now) due++;
      else if (!next || d < next) next = d;
    }
  }
  const days = allDays();
  return {
    total: S.cards.size, new: levels[0], levels: levels.slice(1), due,
    next_due: next ? next.toISOString() : '', pending,
    today: +days[today()] || 0, streak: streak(days),
  };
}

export function sessionCards(mode, limit, level) {
  const now = new Date();
  limit = Math.max(1, Math.min(+limit || 20, 500));
  const all = [...S.cards.values()];
  let pick;
  if (mode === 'new') {
    pick = all.filter(c => !c.level)
      .sort((a, b) => (a.status === 'pending') - (b.status === 'pending') || String(a.created).localeCompare(String(b.created)));
  } else if (mode === 'practice') {
    pick = all.filter(c => level == null || (+c.level || 0) === level);
    for (let i = pick.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pick[i], pick[j]] = [pick[j], pick[i]]; }
  } else {
    pick = all.filter(c => isDue(c, now))
      .sort((a, b) => String(a.due || '').localeCompare(String(b.due || '')) || (a.level - b.level));
  }
  return pick.slice(0, limit).map(pub);
}

/* ---------- dong bo (sync.js goi) ---------- */
export const shardOf = (id) => {
  const ch = String(id || '').charAt(1).toLowerCase();
  return /[0-9a-f]/.test(ch) ? ch : '0';
};

export function syncRecords() {
  const out = {};
  for (const c of S.cards.values()) {
    const rec = Object.fromEntries(Object.entries(c).filter(([k]) => !LOCAL_ONLY.includes(k)));
    (out[shardOf(c.id)] = out[shardOf(c.id)] || []).push(rec);
  }
  for (const [id, ts] of S.deleted) (out[shardOf(id)] = out[shardOf(id)] || []).push({ id, deleted: true, modified: ts });
  for (const k of Object.keys(out)) out[k].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** Hai may cung them mot tu: giu the on nhieu hon (hoac tao truoc) - giong vocab._dedupe */
function dedupe() {
  const groups = new Map();
  for (const c of S.cards.values()) {
    const k = norm(c.term);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const removed = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => (+b.reviews || 0) - (+a.reviews || 0) ||
      String(a.created || '').localeCompare(String(b.created || '')) || (a.id < b.id ? -1 : 1));
    for (const loser of group.slice(1)) {
      S.cards.delete(loser.id);
      S.deleted.set(loser.id, stamp());
      removed.push({ id: loser.id, deleted: true, modified: S.deleted.get(loser.id) });
    }
  }
  return removed;
}

/** Gop ban ghi tu kho: ban nao sua sau thi thang. -> so the da doi */
export async function applyRemote(records) {
  let n = 0;
  const writes = [];
  for (const r of records || []) {
    if (!r || !r.id) continue;
    const local = S.cards.get(r.id);
    const lmod = local ? (local.modified || '') : (S.deleted.get(r.id) || '');
    if (String(r.modified || '') <= lmod) continue;
    if (r.deleted) {
      S.cards.delete(r.id);
      S.deleted.set(r.id, r.modified);
      writes.push({ id: r.id, deleted: true, modified: r.modified });
    } else {
      const c = Object.fromEntries(Object.entries(r).filter(([k]) => !LOCAL_ONLY.includes(k)));
      c.keys = Array.isArray(c.keys) ? c.keys.filter(k => typeof k === 'string') : [];
      if (!c.keys.includes(norm(c.term))) c.keys.push(norm(c.term));
      S.cards.set(c.id, c);
      S.deleted.delete(c.id);
      writes.push(c);
    }
    n++;
  }
  if (n) writes.push(...dedupe());
  if (writes.length) await db.putMany('cards', writes);
  if (n) changed('sync');
  return n;
}
