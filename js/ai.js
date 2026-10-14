/* Denglish Vocab (iPhone) - Gemini soan the va tach tu (cung loi nhac voi may tinh)
 *
 * iPhone goi thang Gemini bang khoa mien phi cua ban (khoa chi luu trong may). Gemini qua tai thi the giu
 * "dang soan" va tu thu lai; het luot / chua co khoa thi de may tinh soan khi dong bo.
 * Phien am / cap do / giong doc Oxford: may tinh bo sung sau (trinh duyet khong tra Oxford duoc).
 */
import { getMeta } from './db.js';
import { autoImage } from './images.js';
import { CEFR, KINDS, S, cleanExamples, patchCard } from './store.js';
import { ENRICH_SCHEMA, ENRICH_SYSTEM, PARSE_SCHEMA, PARSE_SYSTEM } from './prompts.js';
import { cleanTerm, fetchT, norm, sleep, validTerm } from './util.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
const BATCH = 8;
const MAX_TRIES = 3;
const exhausted = {};
const noThinking = new Set();

export const aiState = { note: '', retryAt: 0, running: false };
const listeners = new Set();
export const onAi = (fn) => listeners.add(fn);
const emit = () => listeners.forEach(fn => { try { fn(aiState); } catch (e) {} });

export class AIError extends Error {
  constructor(msg, o) { super(msg); Object.assign(this, o || {}); }
}

export const geminiKey = async () => String(await getMeta('geminiKey', '') || '').trim();

/** JSON Schema -> dang responseSchema cua Gemini (kieu viet hoa, bo additionalProperties) */
function openapi(s) {
  if (Array.isArray(s)) return s.map(openapi);
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'additionalProperties') continue;
    if (k === 'type' && typeof v === 'string') out[k] = v.toUpperCase();
    else if (k === 'properties') out[k] = Object.fromEntries(Object.entries(v).map(([n, x]) => [n, openapi(x)]));
    else if (k === 'items') out[k] = openapi(v);
    else out[k] = v;
  }
  return out;
}

async function callModel(model, key, system, text, schema, maxTokens) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const gen = { responseMimeType: 'application/json', responseSchema: openapi(schema), maxOutputTokens: maxTokens };
    if (!noThinking.has(model)) gen.thinkingConfig = { thinkingLevel: 'low' };
    let r;
    try {
      r = await fetchT(BASE + model + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text }] }],
          generationConfig: gen,
        }),
      }, 90000);
    } catch (e) {
      throw new AIError('Không kết nối được Gemini (mất mạng hoặc Gemini chậm).', { busy: true });
    }
    if (r.ok) {
      const data = await r.json();
      const cand = (data.candidates || [])[0];
      if (!cand) throw new AIError('Gemini từ chối xử lý nội dung này.', { fatal: true });
      const out = ((cand.content || {}).parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
      try { return JSON.parse(out); }
      catch (e) {
        const m = out.match(/\{[\s\S]*\}/);
        if (m) { try { return JSON.parse(m[0]); } catch (e2) {} }
        throw new AIError('Gemini trả về dữ liệu không đọc được.', { busy: true });
      }
    }
    const err = await r.json().catch(() => ({}));
    const msg = String((err.error || {}).message || '');
    const blob = JSON.stringify(err);
    if (r.status === 429) {
      if (/per ?day|daily/i.test(blob)) {
        exhausted[model] = Date.now() + 6 * 3600000;
        throw new AIError(model + ' đã hết lượt miễn phí hôm nay.', { quota: true });
      }
      const m = blob.match(/"retryDelay":"([\d.]+)s"/);
      if (attempt < 2) { await sleep(Math.min(((m ? +m[1] : 10) + 1) * 1000, 60000)); continue; }
      throw new AIError('Gemini đang giới hạn số lượt mỗi phút.', { busy: true });
    }
    if (r.status >= 500) {
      if (attempt < 1) { await sleep(5000); continue; }
      throw new AIError('Gemini đang quá tải.', { busy: true });
    }
    if (r.status === 400 && /thinking/i.test(msg) && !noThinking.has(model)) { noThinking.add(model); continue; }
    if (r.status === 404) throw new AIError('Không tìm thấy model ' + model + '.', { missing: true });
    if (r.status === 401 || r.status === 403 || /api.?key/i.test(msg)) {
      throw new AIError('Khoá Gemini không đúng hoặc chưa được phép dùng — kiểm tra trong ⚙ Cài đặt.', { fatal: true });
    }
    throw new AIError('Gemini báo lỗi ' + r.status + ': ' + msg.slice(0, 160), { fatal: true });
  }
  throw new AIError('Gemini không trả lời.', { busy: true });
}

export async function aiCall(system, text, schema, maxTokens) {
  const key = await geminiKey();
  if (!key) throw new AIError('Chưa có khoá Gemini — thêm trong ⚙ Cài đặt.', { fatal: true, nokey: true });
  const models = MODELS.filter(m => !(exhausted[m] > Date.now()));
  if (!models.length) throw new AIError('Đã hết lượt Gemini miễn phí hôm nay.', { quota: true });
  let last = null;
  for (const m of models) {
    try { return await callModel(m, key, system, text, schema, Math.max(maxTokens, 16000)); }
    catch (e) { last = e; if (e.fatal) break; }
  }
  if (last && last.quota && models.every(m => exhausted[m] > Date.now())) {
    last = new AIError('Đã hết lượt Gemini miễn phí hôm nay (mở lại khoảng 14–15 giờ chiều).', { quota: true });
  }
  throw last || new AIError('Không gọi được Gemini.', { busy: true });
}

/* ---------- tach tu bang AI ---------- */
export async function parseSmart(text) {
  let note = '';
  if (text.length > 60000) { text = text.slice(0, 60000); note = 'Văn bản dài quá nên chỉ đọc phần đầu.'; }
  const data = await aiCall(PARSE_SYSTEM, 'Ghi chú:\n\n' + text, PARSE_SCHEMA, 16000);
  const seen = new Set(), items = [];
  for (const it of data.items || []) {
    const term = cleanTerm(it.term);
    const key = norm(term);
    if (validTerm(term) && !seen.has(key)) { seen.add(key); items.push({ term, note: String(it.note || '').trim().slice(0, 300) }); }
  }
  return { items: items.slice(0, 500), note };
}

/* ---------- soan the ---------- */
function enrichPrompt(jobs) {
  const parts = ['Soạn thẻ cho ' + jobs.length + ' mục sau:'];
  jobs.forEach((j, i) => {
    const lines = ['<item n="' + (i + 1) + '">', 'term: ' + j.term];
    if (j.context) lines.push('câu ngữ cảnh: ' + j.context);
    if (j.note) lines.push('ghi chú của người học: ' + j.note);
    lines.push('</item>');
    parts.push(lines.join('\n'));
  });
  return parts.join('\n\n');
}

function fmtIpa(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s && !s.startsWith('/') && !s.startsWith('[')) s = '/' + s.replace(/^\/+|\/+$/g, '') + '/';
  return s.slice(0, 80);
}

function aiFields(it) {
  const f = {
    kind: KINDS.includes(it.kind) ? it.kind : '',
    pos: String(it.pos || '').trim().toLowerCase().slice(0, 40),
    cefr: CEFR.includes(it.cefr) ? it.cefr : '',
    ipa_uk: fmtIpa(it.ipa_uk), ipa_us: fmtIpa(it.ipa_us),
    def_en: String(it.def_en || '').trim().slice(0, 400),
    meaning_vi: String(it.meaning_vi || '').trim().slice(0, 200),
    examples: cleanExamples(it.examples),
    synonyms: (it.synonyms || []).map(s => String(s).trim().slice(0, 60)).filter(Boolean).slice(0, 6),
    note_vi: String(it.note_vi || '').trim().slice(0, 600),
    image_query: String(it.image_query || '').trim().slice(0, 80),
    emoji: String(it.emoji || '').trim().slice(0, 16),
  };
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '' && !(Array.isArray(v) && !v.length)));
}

/** Soan cac the dang cho (chay ngam, tung lo 8 the) */
export async function enrichPending() {
  if (aiState.running || !navigator.onLine || Date.now() < aiState.retryAt) return;
  if (!(await geminiKey())) return;
  aiState.running = true;
  emit();
  try {
    for (;;) {
      const pending = [...S.cards.values()].filter(c => c.status === 'pending').slice(0, BATCH);
      if (!pending.length) break;
      const jobs = pending.map(c => ({ id: c.id, term: c.term, context: c.context, note: c.user_note }));
      let data;
      try {
        data = await aiCall(ENRICH_SYSTEM, enrichPrompt(jobs), ENRICH_SCHEMA, 12000);
        aiState.note = '';
      } catch (e) {
        aiState.note = e.message;
        if (e.busy) {
          const tries = Math.max(...pending.map(c => +c.tries || 0)) + 1;
          pending.forEach(c => { c.tries = tries; });
          aiState.retryAt = Date.now() + 60000 * tries;
          setTimeout(() => enrichPending(), 60000 * tries + 500);
          if (tries >= MAX_TRIES) {
            // De may tinh soan khi dong bo (co them tu dien Oxford)
            for (const c of pending) await patchCard(c.id, { status: 'basic', error: 'AI chưa soạn được: ' + e.message });
          }
        }
        break;
      }
      const byN = new Map();
      for (const it of data.items || []) if (Number.isInteger(it.n) && it.n >= 1 && it.n <= jobs.length && !byN.has(it.n)) byN.set(it.n, it);
      for (let i = 0; i < jobs.length; i++) {
        const c = S.cards.get(jobs[i].id);
        if (!c || c.status !== 'pending') continue;          // da xoa / da sua trong luc soan
        const it = byN.get(i + 1);
        if (!it) { await patchCard(c.id, { status: 'basic', error: 'AI chưa soạn được mục này.' }); continue; }
        const fields = aiFields(it);
        const term = cleanTerm(it.term);
        const key = norm(term);
        if (validTerm(term) && term !== c.term && ![...S.cards.values()].some(o => o.id !== c.id && norm(o.term) === key)) {
          fields.seen_as = c.term;
          fields.term = term;
          fields.keys = [...new Set((c.keys || []).concat([key]))];
        }
        delete c.tries;
        await patchCard(c.id, Object.assign(fields, { status: 'ready', error: '', engine: 'gemini' }));
        if (!c.image && c.image_state !== 'none' && c.image_state !== 'removed') {
          autoImage(c.id).catch(() => {});
        }
      }
    }
  } finally {
    aiState.running = false;
    emit();
  }
}
