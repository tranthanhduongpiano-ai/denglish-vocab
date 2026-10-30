/* Denglish Vocab (iPhone) - giao dien: tong quan on tap (kieu Mochi), them tu, so tu, the lat vuot (kieu Quizlet),
 * cai dat va quet ma cai dat tu may tinh.
 *
 * Vuot the: trai = Thuoc (xanh la), phai = Chua thuoc (do), len = Mang mang (vang). Cham de lat.
 */
import { askPersist, db, getMeta, setMeta } from './db.js';
import * as store from './store.js';
import { S } from './store.js';
import { extractFile, parseHeuristic } from './parse.js';
import { aiState, enrichPending, geminiKey, onAi, parseSmart, aiCall } from './ai.js';
import { hydrate, imgHtml, preloadImages, removeImage, searchImages, setImageFromFile, setImageFromUrl } from './images.js';
import * as audio from './audio.js';
import * as sync from './sync.js';
import { ago, esc, norm, relTime, toast } from './util.js';

const $ = (id) => document.getElementById(id);
const LEVEL_COLORS = ['', 'var(--lv1)', 'var(--lv2)', 'var(--lv3)', 'var(--lv4)', 'var(--lv5)'];
const KIND_VI = { word: 'từ', 'phrasal verb': 'cụm động từ', phrase: 'cụm từ', idiom: 'thành ngữ', collocation: 'collocation',
                  pattern: 'mẫu câu' };
const GRADE = {
  know: { label: 'Thuộc', c: 'var(--know)' },
  vague: { label: 'Mang máng', c: 'var(--vague)' },
  unknown: { label: 'Chưa thuộc', c: 'var(--unknown)' },
};
const DIR_GRADE = { left: 'know', up: 'vague', right: 'unknown' };
const GRADE_DIR = { know: 'left', vague: 'up', unknown: 'right' };
const spin = '<span class="spin" style="display:inline-block;vertical-align:-3px"></span> ';

const prefs = { autoplay: true, reverse: false, size: 20, coached: false, typing: true };
let cards = [];
let summary = null;
let filter = { q: '', level: 'all' };
let shown = 150;
let hasKey = false;

/* =========================================================================
   Khoi dong
   ========================================================================= */
async function boot() {
  askPersist();
  Object.assign(prefs, await getMeta('prefs', {}));
  audio.setAccentCache(await getMeta('accent', 'uk'));
  await store.load();
  hasKey = !!(await geminiKey());
  refresh();
  store.onChange((what) => {
    scheduleRefresh();
    if (what !== 'sync') sync.requestSync();
    if (['add', 'regen', 'sync'].includes(what)) setTimeout(() => enrichPending(), 300);
    if (what === 'sync') prefetchSoon();
  });
  sync.onState(renderSyncPill);
  onAi(() => scheduleRefresh());
  await sync.startAutoSync();
  enrichPending();
  prefetchSoon();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

/** Tai san giong doc Oxford cua cac the sap on, de lat the la nghe ngay (ca khi mat mang) */
let prefetchTimer = null;
function prefetchSoon() {
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => {
    audio.prefetch(store.sessionCards('review', 40).concat(store.sessionCards('new', prefs.size)));
  }, 2500);
}

let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 150);
}

function refresh() {
  cards = store.listLight();
  summary = store.summary();
  renderWelcome();
  renderOverview();
  renderList();
}

$('themeBtn').onclick = () => {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('denglish.theme', t); } catch (e) {}
};
$('settingsBtn').onclick = () => openSettings();
$('syncPill').onclick = async () => {
  if (!sync.state.configured) return openSettings();
  const r = await sync.syncNow();
  if (r) toast(r.pulled || r.pushed ? 'Đã đồng bộ: nhận ' + r.pulled + ' thẻ, gửi ' + r.pushed + ' nhóm thẻ' : 'Sổ từ đã khớp với máy tính');
  else if (sync.state.error) toast(sync.state.error, 4000);
};

function renderSyncPill(st) {
  const p = $('syncPill');
  p.className = 'sync-pill';
  if (!st.configured) { p.textContent = '☁ Chưa kết nối'; return; }
  if (st.running) { p.innerHTML = '<span class="spin"></span> Đồng bộ'; return; }
  if (st.error) { p.classList.add('bad'); p.textContent = '⚠ Đồng bộ'; p.title = st.error; return; }
  p.classList.add('ok');
  p.textContent = '☁ ' + (st.last ? ago(st.last) : '✓');
  p.title = 'Đồng bộ lần cuối: ' + (st.last ? new Date(st.last).toLocaleString('vi-VN') : '—');
}

const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function renderWelcome() {
  const parts = [];
  if (isIOS() && !standalone()) {
    parts.push('<section class="vcard"><div class="install"><span style="font-size:1.6rem">📲</span><div>' +
      '<b>Cài lên màn hình chính:</b> bấm nút <b>Chia sẻ</b> (ô vuông có mũi tên lên) → <b>Thêm vào MH chính</b>. ' +
      'Mở từ biểu tượng thì app chạy toàn màn hình, ôn được cả khi không có mạng. Sổ từ trong Safari và trong app ' +
      'là riêng — kết nối sau khi đã mở bằng biểu tượng.</div></div></section>');
  }
  if (!sync.state.configured) {
    parts.push('<section class="vcard welcome"><h2>Kết nối với sổ từ trên máy tính</h2>' +
      '<p class="vsub">Trên máy tính mở Denglish → ⚙ Cài đặt → <b>☁ Sổ từ trên iPhone</b> → <b>Hiện mã cài đặt cho iPhone</b>, ' +
      'rồi quét mã đó ở đây. App tự nhận kho sổ từ và khoá Gemini.</p>' +
      '<div class="row"><button class="btn btn-primary" id="wScan">📷 Quét mã cài đặt</button>' +
      '<button class="btn" id="wManual">Nhập tay</button></div></section>');
  }
  $('welcome').innerHTML = parts.join('');
  if ($('wScan')) $('wScan').onclick = () => openScanner();
  if ($('wManual')) $('wManual').onclick = () => openSettings();
}

function renderOverview() {
  const s = summary;
  const parts = ['Hôm nay đã ôn <b>' + s.today + '</b> từ'];
  if (s.streak) parts.push('🔥 <b>' + s.streak + '</b> ngày liên tiếp');
  $('ovStats').innerHTML = parts.join(' · ');

  const max = Math.max(1, ...s.levels);
  $('chart').innerHTML = s.levels.map((n, i) => {
    const h = n ? Math.max(10, Math.round(n / max * 100)) : 0;
    return '<button class="col' + (n ? '' : ' zero') + (filter.level === String(i + 1) ? ' on' : '') + '" data-level="' + (i + 1) +
      '" style="--c:' + LEVEL_COLORS[i + 1] + '"><span class="cnt">' + n.toLocaleString('vi-VN') + ' <small>từ</small></span>' +
      '<span class="bar" data-h="' + h + '"></span></button>';
  }).join('');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $('chart').querySelectorAll('.bar').forEach(b => {
      b.style.height = b.dataset.h === '0' ? '4px' : 'max(10px, calc((100% - 34px) * ' + (b.dataset.h / 100) + '))';
    });
  }));
  $('chart').querySelectorAll('.col').forEach(col => {
    col.onclick = () => {
      filter.level = filter.level === col.dataset.level ? 'all' : col.dataset.level;
      shown = 150;
      renderList();
      $('chart').querySelectorAll('.col').forEach(c => c.classList.toggle('on', c.dataset.level === filter.level));
      $('listBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });

  const go = $('goBtn');
  const more = [];
  if (s.due) {
    $('dueLine').innerHTML = 'Đến giờ ôn tập: <b>' + s.due.toLocaleString('vi-VN') + '</b> từ';
    go.textContent = 'Ôn tập ngay';
    go.disabled = false;
    go.onclick = () => startStudy('review');
    if (s.new) more.push('<button class="btn" data-go="new">Học từ mới (' + s.new + ')</button>');
  } else if (s.new) {
    $('dueLine').innerHTML = s.next_due ? 'Chưa đến giờ ôn · lần tới: <b>' + esc(relTime(s.next_due)) + '</b>'
                                        : 'Có <b>' + s.new + '</b> từ mới chờ học';
    go.textContent = 'Học ' + Math.min(s.new, prefs.size) + ' từ mới';
    go.disabled = false;
    go.onclick = () => startStudy('new');
  } else {
    $('dueLine').innerHTML = s.total
      ? 'Chưa đến giờ ôn' + (s.next_due ? ' · lần tới: <b>' + esc(relTime(s.next_due)) + '</b>' : '')
      : 'Sổ từ còn trống — thêm từ ở bên dưới.';
    go.textContent = 'Ôn tập ngay';
    go.disabled = true;
  }
  if (s.total) more.push('<button class="btn btn-ghost" data-go="practice">Luyện tự do</button>');
  $('ovMore').innerHTML = more.join('');
  $('ovMore').querySelectorAll('[data-go]').forEach(b => {
    b.onclick = () => b.dataset.go === 'practice' ? practiceChooser() : startStudy(b.dataset.go);
  });

  const notes = [];
  if (s.pending) {
    if (!hasKey) notes.push('⏳ ' + s.pending + ' thẻ chờ soạn — máy tính sẽ soạn khi đồng bộ, hoặc thêm khoá Gemini trong ⚙ Cài đặt để iPhone tự soạn.');
    else if (!navigator.onLine) notes.push('⏳ ' + s.pending + ' thẻ chờ soạn — có mạng là AI soạn tiếp.');
    else if (aiState.retryAt > Date.now()) notes.push(spin + 'AI đang soạn ' + s.pending + ' thẻ… (' + esc(aiState.note || 'Gemini đang bận') + ' — tự thử lại sau ' + Math.ceil((aiState.retryAt - Date.now()) / 1000) + ' giây)');
    else notes.push(spin + 'AI đang soạn ' + s.pending + ' thẻ…' + (aiState.note && !aiState.running ? ' (' + esc(aiState.note) + ')' : ''));
  }
  $('ovNote').innerHTML = notes.join('<br>');
}

/* =========================================================================
   So tu
   ========================================================================= */
function matches(c) {
  if (filter.level === 'new' && c.level) return false;
  if (filter.level === 'due' && !store.isDue(c)) return false;
  if (filter.level === 'pending' && c.status !== 'pending') return false;
  if (/^[1-5]$/.test(filter.level) && String(c.level) !== filter.level) return false;
  if (filter.q && !(c.term || '').toLowerCase().includes(filter.q) && !(c.meaning_vi || '').toLowerCase().includes(filter.q)) return false;
  return true;
}

function renderList() {
  const s = summary;
  $('count').textContent = s.total ? s.total.toLocaleString('vi-VN') + ' mục' : '';
  const chip = (key, label, n, color) =>
    '<button class="chip' + (filter.level === key ? ' on' : '') + '" data-f="' + key + '"' + (color ? ' style="--c:' + color + '"' : '') + '>' +
    (color ? '<i></i>' : '') + label + (n != null ? ' · ' + n : '') + '</button>';
  let chips = chip('all', 'Tất cả', s.total) + chip('due', 'Cần ôn', s.due) + chip('new', 'Mới', s.new);
  s.levels.forEach((n, i) => { chips += chip(String(i + 1), 'Cấp ' + (i + 1), n, LEVEL_COLORS[i + 1]); });
  if (s.pending) chips += chip('pending', 'Đang soạn', s.pending);
  $('filters').innerHTML = chips;
  $('filters').querySelectorAll('[data-f]').forEach(b => {
    b.onclick = () => {
      filter.level = b.dataset.f; shown = 150; renderList();
      $('chart').querySelectorAll('.col').forEach(c => c.classList.toggle('on', c.dataset.level === filter.level));
    };
  });
  const list = cards.filter(matches);
  if (!list.length) {
    $('wlist').innerHTML = '<div class="empty">' + (cards.length ? 'Không có từ nào khớp.' : 'Chưa có từ nào.') + '</div>';
    $('moreBtn').classList.add('hidden');
    return;
  }
  $('wlist').innerHTML = list.slice(0, shown).map(rowHtml).join('');
  $('moreBtn').classList.toggle('hidden', list.length <= shown);
  $('moreBtn').textContent = 'Xem thêm (' + (list.length - shown) + ')';
}

function rowHtml(c) {
  const lv = c.level ? '<span class="lv" style="--c:' + LEVEL_COLORS[c.level] + '">' + c.level + '</span>'
                     : '<span class="lv new">MỚI</span>';
  const meta = [c.kind && c.kind !== 'word' ? KIND_VI[c.kind] || c.kind : c.pos, c.cefr].filter(Boolean).join(' · ');
  let side = '';
  if (c.status === 'pending') side = '<span class="wr-side">' + spin + '</span>';
  else if (c.level && store.isDue(c)) side = '<span class="wr-side due">cần ôn</span>';
  else if (c.level && c.due) side = '<span class="wr-side">ôn ' + esc(relTime(c.due)) + '</span>';
  const vi = c.meaning_vi || (c.status === 'pending' ? 'đang chờ soạn…' : '');
  return '<button class="wrow" data-id="' + esc(c.id) + '">' + lv +
    '<span class="wr-main"><span class="wr-top"><span class="wr-term">' + esc(c.term) + '</span>' +
    (meta ? '<span class="wr-meta">' + esc(meta) + '</span>' : '') + '</span>' +
    '<span class="wr-vi">' + esc(vi) + '</span></span>' + side + '</button>';
}

$('wlist').addEventListener('click', (e) => { const r = e.target.closest('.wrow'); if (r) openDetail(r.dataset.id); });
$('moreBtn').onclick = () => { shown += 300; renderList(); };
let qTimer = null;
$('q').addEventListener('input', () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { filter.q = $('q').value.trim().toLowerCase(); shown = 150; renderList(); }, 150);
});

/* =========================================================================
   Them tu
   ========================================================================= */
let pending = { items: [], source: '', method: 'rules', fromFile: false, text: '' };
let parseSeq = 0;

function setMsg(html, cls) { $('addMsg').className = 'add-msg' + (cls ? ' ' + cls : ''); $('addMsg').innerHTML = html || ''; }

function markExisting(items) {
  const idx = store.keyIndex();
  items.forEach(it => { it.exists = idx.has(norm(it.term)); });
  return items;
}

function renderPreview(note) {
  const items = pending.items;
  const fresh = items.filter(i => !i.exists);
  $('smartBtn').classList.toggle('hidden', !hasKey || pending.method === 'ai' || !pending.text || !!pending.aiBusy || !navigator.onLine);
  if (!items.length) {
    $('preview').innerHTML = note ? '<div class="pv-head">' + esc(note) + '</div>' : '';
    $('addBtn').disabled = true;
    $('addBtn').textContent = 'Thêm';
    return;
  }
  const head = (pending.fromFile ? 'Từ file <b>' + esc(pending.source) + '</b>' : 'Sẽ thêm') +
    (pending.method === 'ai' ? ' (AI đã tách)' : '') + ': ' + fresh.length + ' mục mới' +
    (items.length > fresh.length ? ', ' + (items.length - fresh.length) + ' mục đã có trong sổ' : '') + (note ? ' — ' + esc(note) : '');
  $('preview').innerHTML = '<div class="pv-head">' + head + '</div>' + items.map((it, i) =>
    '<span class="pchip' + (it.exists ? ' exists' : '') + '"><b>' + esc(it.term) + '</b>' +
    (it.exists ? '<small>đã có</small>' : it.note ? '<small>' + esc(it.note) + '</small>' : '') +
    '<button class="x" data-i="' + i + '" title="Bỏ mục này">✕</button></span>').join('');
  $('addBtn').disabled = !fresh.length;
  $('addBtn').textContent = fresh.length ? 'Thêm ' + fresh.length + ' mục' : 'Thêm';
}

$('preview').addEventListener('click', (e) => {
  const x = e.target.closest('[data-i]');
  if (!x) return;
  pending.items.splice(+x.dataset.i, 1);
  pending.touched = true;
  renderPreview();
});

let parseTimer = null;
$('addText').addEventListener('input', () => {
  clearTimeout(parseTimer);
  setMsg('');
  parseTimer = setTimeout(() => {
    parseSeq++;
    const text = $('addText').value;
    pending = { items: markExisting(parseHeuristic(text)), source: 'Gõ tay', method: 'rules', fromFile: false, text: text.trim() };
    renderPreview();
  }, 250);
});

async function smartSplit(text, label) {
  const seq = ++parseSeq;
  pending.aiBusy = true;
  renderPreview();
  setMsg(spin + 'AI đang đọc' + (label ? ' lại ' + esc(label) : '') + ' để tách chính xác hơn — có thể thêm ngay nếu danh sách đã ổn.');
  try {
    const r = await parseSmart(text);
    if (seq !== parseSeq) return;
    if (pending.touched && pending.fromFile) { setMsg('AI đã tách xong, nhưng bạn đã sửa danh sách nên giữ nguyên bản của bạn.'); return; }
    if (r.items.length) Object.assign(pending, { items: markExisting(r.items), method: 'ai', touched: false });
    setMsg('');
    renderPreview(r.note);
  } catch (e) {
    if (seq === parseSeq) setMsg('AI chưa tách được (' + esc(e.message) + ') — dùng danh sách theo dòng.');
  } finally {
    if (seq === parseSeq) { pending.aiBusy = false; renderPreview(); }
  }
}

$('smartBtn').onclick = () => smartSplit(pending.fromFile ? pending.fullText : $('addText').value, pending.fromFile ? pending.source : '');

async function readFile(file) {
  if (!file) return;
  const seq = ++parseSeq;
  setMsg(spin + 'Đang đọc ' + esc(file.name) + '…');
  $('addBtn').disabled = true;
  let text;
  try { text = await extractFile(file); }
  catch (e) { if (seq === parseSeq) setMsg(esc(e.message), 'bad'); return; }
  if (seq !== parseSeq) return;
  const items = markExisting(parseHeuristic(text));
  pending = { items, source: file.name, method: 'rules', fromFile: true, text: 'file', fullText: text, touched: false };
  setMsg(items.length ? '' : 'Không thấy từ nào theo từng dòng.', items.length ? '' : 'bad');
  renderPreview();
  if (hasKey && navigator.onLine) smartSplit(text, file.name);
}
$('fileInput').addEventListener('change', (e) => { readFile(e.target.files[0]); e.target.value = ''; });

$('addBtn').onclick = async () => {
  const items = pending.items.filter(i => !i.exists).map(i => ({ term: i.term, note: i.note || '', source: pending.source }));
  if (!items.length) return;
  parseSeq++;
  $('addBtn').disabled = true;
  const r = await store.addItems(items);
  setMsg('✓ Đã thêm ' + r.added.length + ' mục' + (hasKey ? ' — AI đang soạn thẻ.' : ' — máy tính sẽ soạn thẻ khi đồng bộ.'), 'ok');
  if (!pending.fromFile) $('addText').value = '';
  pending = { items: [], source: '', method: 'rules', fromFile: false, text: '' };
  renderPreview();
};

/* =========================================================================
   Tien ich hien the
   ========================================================================= */
function fmtEx(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*\*/g, ''); }

function markIn(sentence, card) {
  const plain = esc(sentence);
  const words = [card.seen_as, card.term].filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  for (const w of words) {
    const stem = w.length > 4 ? w.slice(0, -1) : w;
    const re = new RegExp('\\b(' + stem + '[a-z]*)', 'i');
    if (re.test(plain)) return plain.replace(re, '<mark>$1</mark>');
  }
  return plain;
}

function ipaHtml(card) {
  const out = [];
  if (card.ipa_uk) out.push('<span class="ipa"><button class="spk" data-say="uk">🔊 UK</button><span>' + esc(card.ipa_uk) + '</span></span>');
  if (card.ipa_us && card.ipa_us !== card.ipa_uk) {
    out.push('<span class="ipa"><button class="spk" data-say="us">🔊 US</button><span>' + esc(card.ipa_us) + '</span></span>');
  } else if (card.ipa_us && card.ipa_uk) out[0] = out[0].replace('🔊 UK', '🔊 UK·US');
  if (!out.length) out.push('<span class="ipa"><button class="spk" data-say="' + audio.currentAccent() + '">🔊 Nghe</button></span>');
  return out.join('');
}

function tagsHtml(card) {
  const t = [];
  if (card.kind && card.kind !== 'word') t.push('<span class="tag">' + esc(KIND_VI[card.kind] || card.kind) + '</span>');
  if (card.pos && card.pos !== card.kind) t.push('<span class="tag">' + esc(card.pos) + '</span>');
  if (card.cefr) t.push('<span class="tag cefr">' + esc(card.cefr) + '</span>');
  return t.join('');
}

/* =========================================================================
   Bang chi tiet / cai dat (bottom sheet)
   ========================================================================= */
let sheetCard = null;
let sheetClose = null;
function openSheet(html, onClose) {
  if (sheetClose) { const f = sheetClose; sheetClose = null; f(); }
  $('sheet').innerHTML = html;
  $('sheetWrap').classList.remove('hidden');
  $('sheet').scrollTop = 0;
  sheetClose = onClose || null;
  hydrate($('sheet'));
}
function closeSheet() {
  $('sheetWrap').classList.add('hidden');
  $('sheet').innerHTML = '';
  sheetCard = null;
  if (sheetClose) { const f = sheetClose; sheetClose = null; f(); }
}
$('sheetWrap').addEventListener('click', (e) => { if (e.target === $('sheetWrap')) closeSheet(); });

function openDetail(id) {
  try { sheetCard = store.get(id); } catch (e) { toast(e.message); return; }
  renderDetail(sheetCard);
}

function renderDetail(c) {
  const lvTag = c.level ? '<span class="tag lvl" style="--c:' + LEVEL_COLORS[c.level] + '">Cấp ' + c.level + '</span>' : '<span class="tag">Từ mới</span>';
  let h = '<button class="sh-close" data-act="close">✕</button>';
  h += '<div class="sh-img">' + imgHtml(c) + (c.image_credit ? '<span class="credit">' + esc(c.image_credit) + '</span>' : '') +
       '<button class="imgbtn" data-act="image">🖼 Đổi ảnh</button></div><div class="sh-body">';
  h += '<div class="sh-term">' + esc(c.term) + '</div><div class="sh-tags">' + lvTag + tagsHtml(c) + '</div>';
  h += '<div class="ipa-row">' + ipaHtml(c) + '</div>';
  if (c.status === 'pending') h += '<div class="sh-warn">' + spin + (hasKey ? 'AI đang soạn thẻ này…' : 'Đang chờ soạn — máy tính sẽ soạn khi đồng bộ.') + '</div>';
  if (c.meaning_vi) h += '<div class="sh-vi">' + esc(c.meaning_vi) + '</div>';
  if (c.def_en) h += '<div class="sh-def">' + esc(c.def_en) + '</div>';
  if ((c.examples || []).length) {
    h += '<div class="sh-sec"><h4>Ví dụ</h4><ul class="exs">' + c.examples.map((e, i) =>
      '<li><div class="t"><div class="en">' + fmtEx(e.en) + '</div>' + (e.vi ? '<div class="vi">' + esc(e.vi) + '</div>' : '') +
      '</div><button class="spk" data-ex="' + i + '">🔊</button></li>').join('') + '</ul></div>';
  }
  if ((c.synonyms || []).length) h += '<div class="sh-sec"><h4>Đồng nghĩa</h4><div class="syns">' + c.synonyms.map(s => '<span class="tag">' + esc(s) + '</span>').join('') + '</div></div>';
  if (c.note_vi) h += '<div class="sh-sec"><h4>Cách dùng</h4><div class="note">' + esc(c.note_vi) + '</div></div>';
  if (c.context) h += '<div class="sh-sec"><h4>Gặp trong</h4><div class="ctx">' + markIn(c.context, c) + (c.context_vi ? '<div class="ctx-vi">' + esc(c.context_vi) + '</div>' : '') + (c.source ? '<small>' + esc(c.source) + '</small>' : '') + '</div></div>';
  if (c.user_note) h += '<div class="sh-sec"><h4>Ghi chú của bạn</h4><div class="note">' + esc(c.user_note) + '</div></div>';
  if (c.status === 'basic' && c.error) h += '<div class="sh-warn">⚠ ' + esc(c.error) + '</div>';
  const srs = [c.level ? 'Cấp ' + c.level + (c.due ? ' · ôn lại ' + (new Date(c.due) <= new Date() ? '<b>bây giờ</b>' : esc(relTime(c.due))) : '') : 'Chưa học lần nào'];
  if (c.reviews) srs.push('đã ôn ' + c.reviews + ' lần' + (c.lapses ? ', quên ' + c.lapses + ' lần' : ''));
  if (c.ox_url) srs.push('<a href="' + esc(c.ox_url) + '" target="_blank" rel="noopener" style="color:var(--blue)">Oxford ↗</a>');
  h += '<div class="srs">' + srs.join(' · ') + '</div><div class="sh-actions">' +
    '<button class="btn btn-sm" data-act="edit">✎ Sửa</button>' +
    '<button class="btn btn-sm" data-act="regen">↻ Soạn lại bằng AI</button>' +
    (c.level ? '<button class="btn btn-sm" data-act="reset">⟲ Học lại từ đầu</button>' : '') +
    '<button class="btn btn-sm btn-ghost" data-act="delete" style="color:var(--red)">🗑 Xoá</button></div></div>';
  openSheet(h);
}

$('sheet').addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act], [data-say], [data-ex], [data-img-pick], [data-cancel]');
  if (!t) return;
  const act = t.dataset.act;
  if (act === 'close') return closeSheet();
  const c = sheetCard;
  if (!c) return;
  if (t.dataset.say) return audio.sayTerm(c, t.dataset.say, t);
  if (t.dataset.ex) return audio.speak((c.examples[+t.dataset.ex] || {}).en);
  if (t.dataset.imgPick != null) return chooseImage(+t.dataset.imgPick);
  if (t.dataset.cancel != null) return renderDetail(c);
  try {
    if (act === 'edit') return renderEdit(c);
    if (act === 'image') return renderImagePicker(c);
    if (act === 'regen') { sheetCard = await store.regenerate(c.id); return renderDetail(sheetCard); }
    if (act === 'reset') {
      if (!confirm('Đưa “' + c.term + '” về từ mới để học lại từ đầu?')) return;
      sheetCard = await store.updateCard(c.id, { reset: true });
      return renderDetail(sheetCard);
    }
    if (act === 'delete') {
      if (!confirm('Xoá “' + c.term + '” khỏi sổ từ? (Xoá cả trên máy tính khi đồng bộ.)')) return;
      await store.deleteCard(c.id);
      closeSheet();
      return toast('Đã xoá “' + c.term + '”');
    }
    if (act === 'save') return saveEdit(c);
    if (act === 'img-search') return searchImgs(c);
    if (act === 'img-remove') { await removeImage(c.id); sheetCard = store.get(c.id); return renderDetail(sheetCard); }
    if (act === 'img-link') {
      const url = prompt('Dán link ảnh (https://…):');
      if (url) await setImg(() => setImageFromUrl(c.id, url.trim(), ''));
      return;
    }
    if (act === 'img-upload') return $('imgFile') && $('imgFile').click();
  } catch (err) { toast(err.message, 3500); }
});

function renderEdit(c) {
  const opt = (list, v) => list.map(x => '<option value="' + esc(x[0]) + '"' + (x[0] === v ? ' selected' : '') + '>' + esc(x[1]) + '</option>').join('');
  const exText = (c.examples || []).map(e => e.en + (e.vi ? ' | ' + e.vi : '')).join('\n');
  let h = '<button class="sh-close" data-act="close">✕</button><div class="sh-body" style="padding-top:22px">';
  h += '<h2 style="font-size:1.2rem;margin-bottom:14px">Sửa thẻ</h2><div class="form">';
  h += '<label>Từ / cụm từ<input id="e_term" value="' + esc(c.term) + '" autocapitalize="off" /></label>';
  h += '<label>Nghĩa tiếng Việt<input id="e_vi" value="' + esc(c.meaning_vi) + '" /></label>';
  h += '<label>Định nghĩa tiếng Anh<textarea id="e_def" style="min-height:70px">' + esc(c.def_en) + '</textarea></label>';
  h += '<div class="two"><label>IPA Anh (UK)<input id="e_uk" value="' + esc(c.ipa_uk) + '" /></label><label>IPA Mỹ (US)<input id="e_us" value="' + esc(c.ipa_us) + '" /></label></div>';
  h += '<div class="three"><label>Loại<select id="e_kind">' + opt([['', '—'], ['word', 'Từ'], ['phrasal verb', 'Cụm động từ'], ['phrase', 'Cụm từ'], ['idiom', 'Thành ngữ'], ['collocation', 'Collocation'], ['pattern', 'Mẫu câu']], c.kind) + '</select></label>' +
       '<label>Từ loại<input id="e_pos" value="' + esc(c.pos) + '" /></label>' +
       '<label>Cấp độ<select id="e_cefr">' + opt([['', '—']].concat(store.CEFR.map(x => [x, x])), c.cefr) + '</select></label></div>';
  h += '<label>Ví dụ — mỗi dòng một câu, bản dịch sau dấu “|”; bọc từ cần nhấn trong **…**<textarea id="e_ex">' + esc(exText) + '</textarea></label>';
  h += '<label>Đồng nghĩa (cách nhau dấu phẩy)<input id="e_syn" value="' + esc((c.synonyms || []).join(', ')) + '" /></label>';
  h += '<label>Cách dùng<textarea id="e_note" style="min-height:60px">' + esc(c.note_vi) + '</textarea></label>';
  h += '<label>Ghi chú của bạn<textarea id="e_user" style="min-height:60px">' + esc(c.user_note) + '</textarea></label>';
  h += '<label>Emoji<input id="e_emoji" value="' + esc(c.emoji) + '" style="width:90px" /></label>';
  h += '</div><div class="sh-actions"><button class="btn btn-primary" data-act="save">Lưu</button><button class="btn" data-cancel="1">Huỷ</button></div></div>';
  openSheet(h);
}

async function saveEdit(c) {
  const v = (id) => ($(id) ? $(id).value : '');
  const examples = v('e_ex').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const i = l.indexOf('|');
    return i >= 0 ? { en: l.slice(0, i).trim(), vi: l.slice(i + 1).trim() } : { en: l, vi: '' };
  });
  sheetCard = await store.updateCard(c.id, {
    term: v('e_term'), meaning_vi: v('e_vi'), def_en: v('e_def'), ipa_uk: v('e_uk'), ipa_us: v('e_us'),
    kind: v('e_kind'), pos: v('e_pos'), cefr: v('e_cefr'), examples,
    synonyms: v('e_syn').split(',').map(s => s.trim()).filter(Boolean),
    note_vi: v('e_note'), user_note: v('e_user'), emoji: v('e_emoji'),
  });
  renderDetail(sheetCard);
  toast('Đã lưu');
}

/* ---------- doi anh ---------- */
let imgResults = [];
function renderImagePicker(c) {
  let h = '<button class="sh-close" data-act="close">✕</button><div class="sh-body" style="padding-top:22px">';
  h += '<h2 style="font-size:1.2rem">Ảnh minh hoạ cho “' + esc(c.term) + '”</h2>';
  h += '<p class="vsub">Ảnh giấy phép mở trên Openverse và Wikimedia Commons. Gõ từ khoá tiếng Anh mô tả một cảnh cụ thể sẽ dễ ra ảnh hợp hơn.</p>';
  h += '<div class="img-q" style="margin-top:12px"><input id="imgQ" value="' + esc(c.image_query || c.term) + '" /><button class="btn btn-primary" data-act="img-search">Tìm</button></div>';
  h += '<div class="imgs" id="imgs"></div><div class="img-tools">' +
       '<button class="btn btn-sm" data-act="img-upload">📷 Ảnh của bạn</button>' +
       '<button class="btn btn-sm" data-act="img-link">🔗 Dán link ảnh</button>' +
       (c.image ? '<button class="btn btn-sm btn-ghost" data-act="img-remove">Bỏ ảnh</button>' : '') +
       '<button class="btn btn-sm btn-ghost" data-cancel="1">← Quay lại</button></div>' +
       '<input type="file" id="imgFile" accept="image/*" hidden /></div>';
  openSheet(h);
  $('imgQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchImgs(c); } });
  $('imgFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) setImg(() => setImageFromFile(c.id, f)); });
  searchImgs(c);
}

async function searchImgs(c) {
  const box = $('imgs');
  if (!box) return;
  if (!navigator.onLine) { box.innerHTML = '<div class="empty" style="grid-column:1/-1">Cần có mạng để tìm ảnh.</div>'; return; }
  box.innerHTML = '<div class="empty" style="grid-column:1/-1">' + spin + 'Đang tìm ảnh…</div>';
  imgResults = await searchImages(($('imgQ') && $('imgQ').value.trim()) || c.term);
  if (!$('imgs')) return;
  $('imgs').innerHTML = imgResults.length
    ? imgResults.map((x, i) => '<button data-img-pick="' + i + '"><img src="' + esc(x.url) + '" alt="" referrerpolicy="no-referrer" /></button>').join('')
    : '<div class="empty" style="grid-column:1/-1">Không tìm thấy ảnh — thử từ khoá khác.</div>';
}

function chooseImage(i) {
  const x = imgResults[i];
  if (x && sheetCard) setImg(() => setImageFromUrl(sheetCard.id, x.url, x.credit));
}

async function setImg(fn) {
  const id = sheetCard && sheetCard.id;
  toast('Đang lưu ảnh…', 10000);
  try {
    await fn();
    document.querySelectorAll('.toast').forEach(t => t.remove());
    if (sheetCard && sheetCard.id === id) { sheetCard = store.get(id); renderDetail(sheetCard); }
  } catch (e) { toast(e.message, 3500); }
}

/* =========================================================================
   Cai dat, ket noi, quet ma cai dat
   ========================================================================= */
async function openSettings() {
  sheetCard = { id: '' };
  const repo = await getMeta('repo', '');
  const token = await getMeta('token', '');
  const key = await geminiKey();
  const acc = await getMeta('accent', 'uk');
  const st = sync.state;
  let h = '<button class="sh-close" data-act="close">✕</button><div class="sh-body" style="padding-top:22px">';
  h += '<h2 style="font-size:1.25rem">Cài đặt</h2>';
  h += '<div class="sec-title">Kết nối với máy tính</div>';
  h += '<button class="btn btn-primary" id="sScan">📷 Quét mã cài đặt</button>';
  h += '<p class="vsub" style="margin-top:8px">Mã nằm ở Denglish trên máy tính → ⚙ Cài đặt → ☁ Sổ từ trên iPhone → Hiện mã cài đặt cho iPhone.</p>';
  h += '<div class="form" style="margin-top:12px">' +
       '<label>Kho sổ từ<input id="sRepo" value="' + esc(repo) + '" placeholder="tên-tài-khoản/denglish-data" autocapitalize="off" autocorrect="off" spellcheck="false" /></label>' +
       '<label>Mã truy cập GitHub<input id="sToken" type="password" placeholder="' + (token ? 'Đã lưu …' + esc(token.slice(-4)) + ' — dán mã mới để đổi' : 'github_pat_…') + '" autocapitalize="off" autocorrect="off" spellcheck="false" /></label>' +
       '</div><div class="sh-actions"><button class="btn" id="sConnect">Lưu kết nối</button>' +
       (st.configured ? '<button class="btn" id="sSync">Đồng bộ ngay</button>' : '') + '</div>';
  h += '<div class="st-line ' + (st.error ? 'bad' : st.configured ? 'ok' : '') + '" id="sSyncSt">' +
       (st.error ? '✕ ' + esc(st.error) : st.configured ? '✓ Đã kết nối ' + esc(repo) + (st.last ? ' · đồng bộ ' + ago(st.last) : '') : 'Chưa kết nối — sổ từ chỉ nằm trên iPhone này.') + '</div>';
  h += '<div class="sec-title">Khoá Gemini (AI soạn thẻ)</div><div class="form">' +
       '<label>Khoá Gemini API<input id="sKey" type="password" placeholder="' + (key ? 'Đã lưu …' + esc(key.slice(-4)) + ' — dán khoá mới để đổi' : 'Dán khoá từ aistudio.google.com/api-keys') + '" autocapitalize="off" autocorrect="off" spellcheck="false" />' +
       '<span class="hint">Miễn phí. Khoá chỉ lưu trên iPhone này và chỉ gửi tới Google. Không có khoá thì máy tính soạn thẻ khi đồng bộ.</span></label>' +
       '</div><div class="sh-actions"><button class="btn" id="sKeySave">Lưu khoá</button>' + (key ? '<button class="btn" id="sKeyTest">Kiểm tra</button>' : '') + '</div>' +
       '<div class="st-line" id="sKeySt"></div>';
  h += '<div class="sec-title">Ôn thẻ</div>' +
       '<label class="opt-row">Giọng đọc<select id="sAcc"><option value="uk">Anh (UK)</option><option value="us">Mỹ (US)</option></select></label>' +
       '<label class="opt-row">Tự đọc khi lật thẻ<input type="checkbox" id="sAuto"' + (prefs.autoplay ? ' checked' : '') + ' /></label>' +
       '<label class="opt-row">Số thẻ mỗi lượt<select id="sSize"><option>10</option><option>20</option><option>30</option><option>50</option><option>100</option></select></label>';
  h += '<div class="sec-title">Dữ liệu</div><p class="vsub">' + summary.total + ' thẻ trên iPhone này' +
       (st.configured ? ', đồng bộ với kho ' + esc(repo) : '') + '.</p>' +
       '<div class="sh-actions"><button class="btn btn-sm btn-ghost" id="sWipe" style="color:var(--red)">Xoá dữ liệu trên iPhone này</button></div>';
  h += '</div>';
  openSheet(h);
  $('sAcc').value = acc;
  $('sSize').value = String(prefs.size);
  $('sScan').onclick = () => openScanner();
  $('sConnect').onclick = async () => {
    const r = $('sRepo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/+$/, '');
    const t = $('sToken').value.trim() || token;
    $('sSyncSt').className = 'st-line';
    $('sSyncSt').textContent = 'Đang kiểm tra…';
    try { await connect(r, t, null); openSettings(); }
    catch (e) { $('sSyncSt').className = 'st-line bad'; $('sSyncSt').textContent = '✕ ' + e.message; }
  };
  if ($('sSync')) $('sSync').onclick = async () => { $('sSyncSt').textContent = 'Đang đồng bộ…'; await sync.syncNow(); openSettings(); };
  $('sKeySave').onclick = async () => {
    const k = $('sKey').value.trim();
    if (!k) return $('sKey').focus();
    await setMeta('geminiKey', k);
    hasKey = true;
    $('sKeySt').className = 'st-line ok';
    $('sKeySt').textContent = '✓ Đã lưu khoá.';
    enrichPending();
    scheduleRefresh();
  };
  if ($('sKeyTest')) $('sKeyTest').onclick = async () => {
    $('sKeySt').className = 'st-line';
    $('sKeySt').textContent = 'Đang thử…';
    try {
      await aiCall('Bạn là trợ lý kiểm tra kết nối.', 'Trả lời đúng một từ: OK',
        { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'] }, 2000);
      $('sKeySt').className = 'st-line ok'; $('sKeySt').textContent = '✓ Kết nối được Gemini.';
    } catch (e) { $('sKeySt').className = 'st-line bad'; $('sKeySt').textContent = '✕ ' + e.message; }
  };
  $('sAcc').onchange = async (e) => { await setMeta('accent', e.target.value); audio.setAccentCache(e.target.value); };
  $('sAuto').onchange = (e) => { prefs.autoplay = e.target.checked; setMeta('prefs', prefs); };
  $('sSize').onchange = (e) => { prefs.size = +e.target.value; setMeta('prefs', prefs); scheduleRefresh(); };
  $('sWipe').onclick = async () => {
    if (!confirm('Xoá toàn bộ sổ từ, khoá và cài đặt trên iPhone này? Sổ từ đã đồng bộ vẫn còn trong kho GitHub và trên máy tính.')) return;
    await db.clear('cards'); await db.clear('blobs'); await db.clear('meta');
    location.reload();
  };
}

/** Luu ket noi kho (sau khi thu duoc) */
async function connect(repo, token, gemini) {
  if (!repo || !token) throw new Error('Cần cả tên kho và mã truy cập.');
  const info = await sync.check(repo, token);
  const old = await getMeta('repo', '');
  await setMeta('repo', repo);
  await setMeta('token', token);
  if (gemini) { await setMeta('geminiKey', gemini); hasKey = true; }
  if (old !== repo) await sync.resetSyncState();
  await sync.startAutoSync();
  await sync.syncNow();
  refresh();
  enrichPending();
  if (!info.private) toast('⚠ Kho ' + repo + ' đang để Public — nên đổi sang Private trên GitHub.', 6000);
  return info;
}

let jsqrLoad = null;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve();
  if (!jsqrLoad) {
    jsqrLoad = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
      s.onload = resolve;
      s.onerror = () => { jsqrLoad = null; reject(new Error('Không tải được bộ đọc mã QR (cần mạng).')); };
      document.head.appendChild(s);
    });
  }
  return jsqrLoad;
}

async function openScanner() {
  sheetCard = { id: '' };
  let stream = null, raf = 0, done = false;
  const stop = () => { done = true; cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach(t => t.stop()); };
  openSheet('<button class="sh-close" data-act="close">✕</button><div class="sh-body" style="padding-top:22px">' +
    '<h2 style="font-size:1.2rem">Quét mã cài đặt</h2>' +
    '<p class="vsub">Trên máy tính: Denglish → ⚙ Cài đặt → ☁ Sổ từ trên iPhone → <b>Hiện mã cài đặt cho iPhone</b>. Hướng camera vào mã đó.</p>' +
    '<div class="scan"><video id="scanVideo" playsinline muted></video><div class="frame"></div></div>' +
    '<div class="scan-msg" id="scanMsg">Đang mở camera…</div></div>', stop);
  try {
    await loadJsQR();
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch (e) {
    $('scanMsg').textContent = e && e.name === 'NotAllowedError'
      ? 'iPhone chưa cho app dùng camera — vào Cài đặt iPhone cho phép, hoặc nhập tay trong ⚙ Cài đặt.'
      : (e.message || 'Không mở được camera.');
    return;
  }
  if (done) { stop(); return; }
  const video = $('scanVideo');
  video.srcObject = stream;
  await video.play().catch(() => {});
  $('scanMsg').textContent = 'Đưa mã QR vào khung…';
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const tick = async () => {
    if (done) return;
    if (video.readyState >= 2 && video.videoWidth) {
      const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
      cv.width = Math.round(video.videoWidth * scale);
      cv.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, cv.width, cv.height);
      const code = window.jsQR(ctx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height, { inversionAttempts: 'dontInvert' });
      if (code && code.data) {
        if (!code.data.startsWith('DENGLISH1:')) {
          $('scanMsg').textContent = code.data.startsWith('http') ? 'Đây là mã mở app — hãy bấm “Hiện mã cài đặt cho iPhone” rồi quét mã mới hiện ra.' : 'Không phải mã cài đặt Denglish.';
        } else {
          stop();
          $('scanMsg').innerHTML = spin + 'Đang kết nối…';
          try {
            const d = JSON.parse(atob(code.data.slice(10)));
            await connect(d.r, d.t, d.g || '');
            closeSheet();
            toast('✓ Đã kết nối với sổ từ trên máy tính', 3500);
          } catch (e) {
            $('scanMsg').textContent = '✕ ' + e.message;
          }
          return;
        }
      }
    }
    raf = requestAnimationFrame(tick);
  };
  tick();
}

/* =========================================================================
   On tap: the lat + vuot
   ========================================================================= */
const St = { open: false, mode: 'review', practice: false, session: '', cards: [], pos: 0,
             tally: { know: 0, vague: 0, unknown: 0 }, history: [], results: new Map(), busy: false };

async function startStudy(mode, opts) {
  opts = opts || {};
  const list = opts.cards || store.sessionCards(mode, opts.limit || prefs.size, opts.level);
  if (!list.length) { toast(mode === 'review' ? 'Chưa có từ nào đến giờ ôn.' : 'Không có thẻ nào.'); return; }
  Object.assign(St, {
    open: true, mode, practice: mode === 'practice' || !!opts.practice,
    session: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    cards: list.map(c => Object.assign({}, c)), pos: 0,
    tally: { know: 0, vague: 0, unknown: 0 }, history: [], results: new Map(), busy: false,
  });
  $('study').classList.remove('hidden');
  document.body.classList.add('studying');
  closePop();
  if (!history.state || !history.state.study) history.pushState({ study: 1 }, '');
  $('stMode').textContent = St.practice ? 'Luyện tự do · không tính vào lịch ôn' : mode === 'new' ? 'Học từ mới' : 'Ôn tập';
  preloadImages(St.cards.slice(0, 6));
  audio.prefetch(St.cards);
  renderStage();
  if (!prefs.coached) showCoach();
}

function closeStudy(fromPop) {
  if (!St.open) return;
  St.open = false;
  $('study').classList.add('hidden');
  document.body.classList.remove('studying');
  $('stage').innerHTML = '';
  closePop();
  audio.stop();
  if (!fromPop && history.state && history.state.study) history.back();
  refresh();
}
window.addEventListener('popstate', () => { if (St.open) closeStudy(true); else if (!$('sheetWrap').classList.contains('hidden')) closeSheet(); });
$('stClose').onclick = () => closeStudy();

function updateTop() {
  const total = St.cards.length, done = Math.min(St.pos, total);
  $('stBar').style.width = (total ? done / total * 100 : 0) + '%';
  $('stTally').innerHTML = '<span class="k">✓ ' + St.tally.know + '</span><span class="v">~ ' + St.tally.vague +
    '</span><span class="u">✗ ' + St.tally.unknown + '</span><span style="color:var(--text-fade);font-weight:600">' + Math.min(done + 1, total) + '/' + total + '</span>';
  $('stUndo').disabled = !St.history.length;
}

function renderStage(opts) {
  opts = opts || {};
  const stage = $('stage');
  stage.innerHTML = '';
  updateTop();
  // The go tu (js/typecard.js) xen ke voi the vuot
  TypeCard.decide(St.cards, St.pos, prefs.typing);
  TypeCard.decide(St.cards, St.pos + 1, prefs.typing);
  const typing = St.pos < St.cards.length && St.cards[St.pos]._type === 'type';
  $('stActions').style.visibility = St.pos >= St.cards.length || typing ? 'hidden' : 'visible';
  if (St.pos >= St.cards.length) { showDone(); return; }
  const next = St.cards[St.pos + 1];
  if (next) { const b = makeCard(next); b.classList.add('behind'); stage.appendChild(b); }
  preloadImages(St.cards.slice(St.pos + 1, St.pos + 4));
  const top = makeCard(St.cards[St.pos]);
  stage.appendChild(top);
  hydrate(stage);
  fitBack(top);
  if (next) fitBack(stage.querySelector('.fc.behind'));
  if (typing) bindType(top, St.cards[St.pos]);
  else bindDrag(top, St.cards[St.pos]);
  if (opts.from) {
    top.style.transform = flyTransform(opts.from, 0, 0);
    top.style.opacity = '0';
    top.getBoundingClientRect();
    top.classList.add('snap');
    top.style.transform = '';
    top.style.opacity = '';
    setTimeout(() => top.classList.remove('snap'), 360);
  } else if (!opts.still) top.classList.add('enter');
}

function makeCard(card) {
  const el = document.createElement('div');
  const typing = card._type === 'type';
  el.className = 'fc' + (typing ? ' fc-type' : '');
  el.dataset.id = card.id;
  el.innerHTML = '<div class="fc-in"><div class="face front">' + (typing ? TypeCard.html(card, frontTags(card)) : frontHtml(card)) +
    '</div><div class="face back">' + backHtml(card) + '</div></div>' +
    '<div class="tint"></div><div class="stamp k">THUỘC ✓</div><div class="stamp u">CHƯA THUỘC ✗</div><div class="stamp v">MANG MÁNG ~</div>';
  return el;
}

function frontTags(c) {
  const lv = c.level ? '<span class="tag lvl" style="--c:' + LEVEL_COLORS[c.level] + '">Cấp ' + c.level + '</span>' : '<span class="tag">Từ mới</span>';
  const again = c._again ? '<span class="tag" style="color:var(--unknown)">Gặp lại</span>' : '';
  return '<div class="fr-tags">' + lv + again + '<span>' + (c.cefr ? '<span class="tag cefr">' + esc(c.cefr) + '</span>' : '') + '</span></div>';
}

function frontHtml(c) {
  let h = frontTags(c);
  if (prefs.reverse && c.meaning_vi) {
    h += '<div class="fr-emoji">' + esc(c.emoji || '') + '</div><div class="fr-term vi' + (c.meaning_vi.length > 22 ? ' long' : '') + '">' + esc(c.meaning_vi) + '</div>';
    if (c.kind && c.kind !== 'word') h += '<div class="fr-sub">' + esc(KIND_VI[c.kind] || c.kind) + '</div>';
    return h + '<div class="fr-hint">Nhớ ra từ tiếng Anh chưa? Chạm để lật</div>';
  }
  h += '<div class="fr-term' + (c.term.length > 40 ? ' xlong' : c.term.length > 14 ? ' long' : '') + '">' + esc(c.term) + '</div>';
  const sub = c.kind && c.kind !== 'word' ? KIND_VI[c.kind] : c.pos;
  if (sub) h += '<div class="fr-sub">' + esc(sub) + '</div>';
  return h + '<button class="spk" data-say="' + audio.currentAccent() + '">🔊 Nghe</button><div class="fr-hint">Chạm để lật · vuốt trái nếu đã thuộc</div>';
}

function backHtml(c) {
  let h = '<div class="bk-img">' + imgHtml(c) + '</div><div class="bk-body">';
  h += '<div class="bk-head"><div class="bk-term">' + esc(c.term) + '</div>' + (c.cefr ? '<span class="tag cefr">' + esc(c.cefr) + '</span>' : '') + '</div>';
  const sub = [c.kind && c.kind !== 'word' ? KIND_VI[c.kind] : '', c.pos].filter((x, i, a) => x && a.indexOf(x) === i).join(' · ');
  if (sub) h += '<div class="bk-sub">' + esc(sub) + '</div>';
  h += '<div class="bk-ipa">' + ipaHtml(c) + '</div>';
  if (c.status === 'pending' && !c.meaning_vi) h += '<div class="bk-wait"><span class="spin"></span> Thẻ đang chờ soạn…</div>';
  if (c.meaning_vi) h += '<div class="bk-vi">' + esc(c.meaning_vi) + '</div>';
  if (c.def_en) h += '<div class="bk-def">' + esc(c.def_en) + '</div>';
  if ((c.examples || []).length) h += '<ul class="bk-ex">' + c.examples.map(e => '<li>' + fmtEx(e.en) + (e.vi ? '<div class="vi">' + esc(e.vi) + '</div>' : '') + '</li>').join('') + '</ul>';
  else if (c.context) h += '<ul class="bk-ex"><li>' + markIn(c.context, c) + '</li></ul>';
  return h + '</div><div class="bk-foot"><button data-more="1">Chi tiết · sửa · đổi ảnh</button></div>';
}

/** Mat sau vua khung the (khong cuon, de vuot khong vuong): bot vi du, thu nho anh */
function fitBack(fc) {
  if (!fc) return;
  const body = fc.querySelector('.bk-body');
  if (!body) return;
  const items = [...body.querySelectorAll('.bk-ex li')];
  items.forEach(li => { li.hidden = false; });
  fc.classList.remove('tight', 'tighter');
  const over = () => body.scrollHeight > body.clientHeight + 1;
  if (!over()) return;
  for (let i = items.length - 1; i >= 2 && over(); i--) items[i].hidden = true;
  if (over()) fc.classList.add('tight');
  for (let i = Math.min(1, items.length - 1); i >= 1 && over(); i--) items[i].hidden = true;
  if (over()) fc.classList.add('tighter');
  if (over() && items[0]) items[0].hidden = true;
}
let fitTimer = null;
window.addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(() => $('stage').querySelectorAll('.fc').forEach(fitBack), 120); });

const topCard = () => $('stage').querySelector('.fc:not(.behind)');

function flip(el, card) {
  el = el || topCard();
  card = card || St.cards[St.pos];
  if (!el || !card) return;
  const toBack = !el.classList.contains('flipped');
  el.classList.toggle('flipped');
  if (toBack && prefs.autoplay) audio.sayTerm(card);
}

function dirOf(dx, dy) {
  if (-dy > Math.abs(dx) * 1.1 && -dy > 18) return 'up';
  if (Math.abs(dx) > 18 && Math.abs(dx) >= -dy) return dx < 0 ? 'left' : 'right';
  return '';
}
function setEdges(dir, p) {
  const st = $('study').style;
  st.setProperty('--pl', dir === 'left' ? p : 0);
  st.setProperty('--pr', dir === 'right' ? p : 0);
  st.setProperty('--pt', dir === 'up' ? p : 0);
}

function bindDrag(el, card) {
  let pid = null, sx = 0, sy = 0, st = 0, dx = 0, dy = 0, dragging = false;
  el.addEventListener('pointerdown', (e) => {
    if (St.busy || pid !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('button, a, input, select, textarea')) return;
    pid = e.pointerId; sx = e.clientX; sy = e.clientY; st = performance.now(); dx = dy = 0; dragging = false;
    try { el.setPointerCapture(pid); } catch (err) {}
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    dx = e.clientX - sx; dy = e.clientY - sy;
    if (!dragging && Math.hypot(dx, dy) > 8) { dragging = true; el.classList.add('dragging'); el.classList.remove('snap', 'enter'); }
    if (!dragging) return;
    const dir = dirOf(dx, dy);
    const dist = dir === 'up' ? -dy : Math.abs(dx);
    const p = Math.min(1, Math.max(0, (dist - 15) / 100));
    el.style.transform = 'translate(' + dx + 'px,' + dy + 'px) rotate(' + (dx * 0.05) + 'deg)';
    el.dataset.dir = dir;
    el.style.setProperty('--p', p);
    setEdges(dir, p * 0.9);
  });
  const end = (e) => {
    if (e.pointerId !== pid) return;
    pid = null;
    if (!dragging) { if (e.type === 'pointerup') flip(el, card); return; }
    el.classList.remove('dragging');
    dragging = false;
    const dir = dirOf(dx, dy);
    const dist = dir === 'up' ? -dy : Math.abs(dx);
    const speed = Math.hypot(dx, dy) / Math.max(1, performance.now() - st);
    const far = dist > Math.min(120, el.offsetWidth * 0.28) || (speed > 0.55 && dist > 45);
    setEdges('', 0);
    if (dir && far && e.type === 'pointerup') commit(DIR_GRADE[dir], dx, dy);
    else {
      el.classList.add('snap');
      el.style.transform = '';
      el.dataset.dir = '';
      el.style.setProperty('--p', 0);
      setTimeout(() => el.classList.remove('snap'), 360);
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-say], [data-more]');
    if (!b) return;
    e.stopPropagation();
    if (b.dataset.say) audio.sayTerm(card, b.dataset.say, b);
    else openDetail(card.id);
  });
}

/** The go tu: go xong bam Tiep thi bay di theo ket qua (giong vuot); da cham thi cham vao the de lat xem */
function bindType(el, card) {
  TypeCard.mount(el, card, {
    accent: audio.currentAccent(),
    result: () => { if (prefs.autoplay) audio.sayTerm(card); },
    done: (grade) => commit(grade),
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-say], [data-more]');
    if (b) {
      e.stopPropagation();
      if (b.dataset.say != null) audio.sayTerm(card, b.dataset.say, b);
      else openDetail(card.id);
      return;
    }
    if (el.classList.contains('flipped') && !e.target.closest('button, a, input')) el.classList.remove('flipped');
  });
}

function flyTransform(dir, dx, dy) {
  const w = window.innerWidth, h = window.innerHeight;
  if (dir === 'left') return 'translate(' + (-w * 1.2) + 'px,' + (dy + 60) + 'px) rotate(-24deg)';
  if (dir === 'right') return 'translate(' + (w * 1.2) + 'px,' + (dy + 60) + 'px) rotate(24deg)';
  return 'translate(' + dx + 'px,' + (-h * 1.1) + 'px)';
}

function commit(grade, dx, dy) {
  if (St.busy || St.pos >= St.cards.length) return;
  const el = topCard();
  if (!el) return;
  St.busy = true;
  const dir = GRADE_DIR[grade];
  el.dataset.dir = dir;
  el.style.setProperty('--p', 1);
  el.classList.remove('snap', 'enter');
  el.classList.add('fly');
  el.style.transform = flyTransform(dir, dx || 0, dy || 0);
  el.style.opacity = '0.2';
  setEdges(dir, 0.8);
  const behind = $('stage').querySelector('.fc.behind');
  if (behind) { behind.style.transform = 'none'; behind.style.opacity = '1'; }
  setTimeout(() => { setEdges('', 0); record(grade); }, 300);
}

function record(grade) {
  const card = St.cards[St.pos];
  const again = !!card._again;
  const entry = { pos: St.pos, card, grade, tallied: !again, requeued: false };
  if (!again) { St.tally[grade]++; St.results.set(card.id, { card, grade }); }
  if (grade === 'unknown') { St.cards.push(Object.assign({}, card, { _again: true, _type: '', _hint: null })); entry.requeued = true; }
  St.history.push(entry);
  if (!St.practice) store.answer(card.id, grade, St.session).catch(e => toast(e.message));
  St.pos++;
  St.busy = false;
  renderStage({ still: true });
}

function undo() {
  if (St.busy || !St.history.length) return;
  const last = St.history.pop();
  if (last.requeued) St.cards.pop();
  if (last.tallied) { St.tally[last.grade]--; St.results.delete(last.card.id); }
  St.pos = last.pos;
  if (!St.practice) store.undo(last.card.id).catch(() => {});
  renderStage({ from: GRADE_DIR[last.grade] });
}
$('stUndo').onclick = undo;
$('stActions').addEventListener('click', (e) => { const b = e.target.closest('[data-grade]'); if (b) commit(b.dataset.grade); });

document.addEventListener('keydown', (e) => {
  if (!St.open || (e.target.closest && e.target.closest('input, textarea, select'))) return;
  if (!$('sheetWrap').classList.contains('hidden')) { if (e.key === 'Escape') closeSheet(); return; }
  const k = e.key;
  if (k === 'Escape') { if ($('stagePop')) closePop(); else closeStudy(); return; }
  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (St.pos >= St.cards.length) return;
  if (St.cards[St.pos]._type === 'type') {        // the go tu: phim de go, Enter de kiem tra / sang the
    const t = topCard();
    if (!t || !t._ty) return;
    if (k === 'Enter') { e.preventDefault(); t._ty.enter(); }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) t._ty.focus();
    return;
  }
  if (k === ' ' || k === 'Enter') { e.preventDefault(); flip(); }
  else if (k === 'ArrowLeft') { e.preventDefault(); commit('know'); }
  else if (k === 'ArrowRight') { e.preventDefault(); commit('unknown'); }
  else if (k === 'ArrowUp') { e.preventDefault(); commit('vague'); }
});

function showCoach() {
  const c = document.createElement('div');
  c.className = 'coach';
  c.innerHTML = '<div class="coach-in"><h3>Cách ôn thẻ</h3><div class="coach-rows">' +
    '<div><span class="ar" style="--c:var(--know)">←</span><span>Vuốt <b>trái</b>: đã <b>thuộc</b></span></div>' +
    '<div><span class="ar" style="--c:var(--unknown)">→</span><span>Vuốt <b>phải</b>: <b>chưa thuộc</b> — gặp lại cuối lượt</span></div>' +
    '<div><span class="ar" style="--c:var(--vague)">↑</span><span>Vuốt <b>lên</b>: nhớ <b>mang máng</b></span></div>' +
    '<div><span class="ar" style="--c:var(--text-fade)">👆</span><span><b>Chạm</b> để lật xem nghĩa, ví dụ, ảnh</span></div>' +
    '<div><span class="ar" style="--c:var(--accent)">⌨</span><span>Xen kẽ có thẻ <b>gõ từ</b>: chỉ hiện nghĩa, gõ lại từ tiếng Anh</span></div>' +
    '</div><button class="go" style="font-size:1.05rem;padding:13px">Bắt đầu</button></div>';
  $('study').appendChild(c);
  c.querySelector('button').onclick = () => { c.remove(); prefs.coached = true; setMeta('prefs', prefs); };
}

function closePop() { const p = $('stagePop'); if (p) p.remove(); }
$('stGear').onclick = () => {
  if ($('stagePop')) { closePop(); return; }
  const p = document.createElement('div');
  p.className = 'pop';
  p.id = 'stagePop';
  p.innerHTML =
    '<label class="opt-row">Tự đọc khi lật thẻ<input type="checkbox" id="oAuto"' + (prefs.autoplay ? ' checked' : '') + ' /></label>' +
    '<label class="opt-row">Mặt trước là nghĩa tiếng Việt<input type="checkbox" id="oRev"' + (prefs.reverse ? ' checked' : '') + ' /></label>' +
    '<label class="opt-row">Xen kẽ thẻ gõ từ<input type="checkbox" id="oType"' + (prefs.typing ? ' checked' : '') + ' /></label>' +
    '<label class="opt-row">Giọng đọc<select id="oAcc"><option value="uk">Anh (UK)</option><option value="us">Mỹ (US)</option></select></label>';
  $('study').appendChild(p);
  $('oAcc').value = audio.currentAccent();
  $('oAuto').onchange = (e) => { prefs.autoplay = e.target.checked; setMeta('prefs', prefs); };
  $('oRev').onchange = (e) => { prefs.reverse = e.target.checked; setMeta('prefs', prefs); renderStage({ still: true }); };
  $('oType').onchange = (e) => {
    prefs.typing = e.target.checked;
    setMeta('prefs', prefs);
    St.cards.forEach((c, i) => { if (i >= St.pos) c._type = ''; });      // chon lai kieu cho cac the con lai
    renderStage({ still: true });
  };
  $('oAcc').onchange = (e) => { setMeta('accent', e.target.value); audio.setAccentCache(e.target.value); audio.prefetch(St.cards); renderStage({ still: true }); };
};
document.addEventListener('pointerdown', (e) => {
  const p = $('stagePop');
  if (p && !p.contains(e.target) && e.target !== $('stGear')) closePop();
});

function showDone() {
  const t = St.tally;
  const res = [...St.results.values()];
  const weak = res.filter(r => r.grade !== 'know').map(r => r.card);
  const d = document.createElement('div');
  d.className = 'done';
  const emoji = !res.length ? '👋' : t.know === res.length ? '🏆' : t.know >= res.length / 2 ? '🎉' : '💪';
  let h = '<div class="done-emo">' + emoji + '</div><h2>' + (St.practice ? 'Xong lượt luyện!' : 'Xong lượt ôn!') + '</h2>' +
    '<div class="done-stats"><div style="--c:var(--know)"><b>' + t.know + '</b><span>Thuộc</span></div>' +
    '<div style="--c:var(--vague)"><b>' + t.vague + '</b><span>Mang máng</span></div>' +
    '<div style="--c:var(--unknown)"><b>' + t.unknown + '</b><span>Chưa thuộc</span></div></div>';
  if (res.length) h += '<div class="done-list">' + res.map(r => '<div style="--c:' + GRADE[r.grade].c + '"><b>' + esc(r.card.term) + '</b><span>' + esc(r.card.meaning_vi || '') + '</span><i>' + GRADE[r.grade].label + '</i></div>').join('') + '</div>';
  d.innerHTML = h + '<div class="done-actions" id="doneActions"></div>';
  $('stage').appendChild(d);
  const s = store.summary();
  const acts = [];
  if (!St.practice && St.mode === 'review' && s.due) acts.push(['review', 'Ôn tiếp ' + s.due + ' từ', true]);
  if (!St.practice && St.mode === 'new' && s.new) acts.push(['new', 'Học tiếp ' + Math.min(s.new, prefs.size) + ' từ mới', true]);
  if (weak.length) acts.push(['weak', 'Ôn lại ' + weak.length + ' từ chưa chắc', !acts.length]);
  acts.push(['close', 'Xong', !acts.length]);
  const box = $('doneActions');
  box.innerHTML = acts.map(a => '<button class="' + (a[2] ? 'go' : 'btn') + '" data-done="' + a[0] + '" style="' + (a[2] ? '' : 'justify-content:center;padding:13px') + '">' + esc(a[1]) + '</button>').join('');
  box.onclick = (e) => {
    const b = e.target.closest('[data-done]');
    if (!b) return;
    const k = b.dataset.done;
    if (k === 'close') closeStudy();
    else if (k === 'weak') startStudy('practice', { cards: weak.map(c => Object.assign({}, c, { _again: false, _type: '', _hint: null })), practice: true });
    else startStudy(k);
  };
}

function practiceChooser() {
  const s = summary;
  const opts = [['', 'Tất cả', s.total], ['0', 'Từ mới', s.new]].concat(s.levels.map((n, i) => [String(i + 1), 'Cấp ' + (i + 1), n]));
  sheetCard = { id: '' };
  openSheet('<button class="sh-close" data-act="close">✕</button><div class="sh-body" style="padding-top:22px">' +
    '<h2 style="font-size:1.2rem">Luyện tự do</h2><p class="vsub">Lật thẻ ngẫu nhiên trong nhóm bạn chọn — không tính vào lịch ôn.</p>' +
    '<div class="pick">' + opts.filter(o => o[2]).map(o => '<button class="chip" data-lv="' + o[0] + '">' + o[1] + ' · ' + o[2] + '</button>').join('') + '</div>' +
    '<label class="opt-row" style="border:none">Số thẻ<select id="pSize"><option>20</option><option>50</option><option>100</option><option value="500">Tất cả</option></select></label></div>');
  $('sheet').querySelectorAll('[data-lv]').forEach(b => {
    b.onclick = () => {
      const lv = b.dataset.lv, size = +$('pSize').value;
      closeSheet();
      startStudy('practice', { level: lv === '' ? null : +lv, limit: size });
    };
  });
}

window.addEventListener('online', () => { scheduleRefresh(); enrichPending(); });
window.addEventListener('offline', scheduleRefresh);

boot().catch(e => {
  console.error(e);
  $('wlist').innerHTML = '<div class="notice warn">Không mở được sổ từ trên máy này: ' + esc(e.message) + '</div>';
});
