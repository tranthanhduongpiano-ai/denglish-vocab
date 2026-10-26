/* Denglish Dictation (iPhone) - luyen nghe chep cac bai da tao tren may tinh, chay ca khi may tinh tat.
 *
 * May tinh (vocab_sync.py + lesson_export.py) day bai len kho rieng tu:
 *   lessons/index.json      danh sach bai
 *   lessons/<video>.json    loi thoai, ban dich tung cau, tu dien cua bai (ket qua tra Oxford + Google)
 * App tai bai ve, luu trong may (IndexedDB) de lan sau mo ngay. Video van phat tu YouTube (can mang).
 *
 * Cham bai, goi y ten rieng, che do "Toan bai" giong het trang Dictation tren may tinh (static/js/exercise.js).
 * Cham vao tu de tra; luu tu / cum tu thang vao so tu tren iPhone (dong bo ve may tinh nhu the them tay).
 */
import { askPersist, getMeta, setMeta } from './db.js';
import * as store from './store.js';
import * as sync from './sync.js';
import { enrichPending } from './ai.js';
import { esc, fromUtf8, norm, toast } from './util.js';

const $ = (id) => document.getElementById(id);
const VIDEO_ID = new URLSearchParams(location.search).get('v') || '';
const ICON_ROW_PLAY =
  '<svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">' +
  '<circle cx="16" cy="16" r="14.5" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
  '<path d="M13 10.3v11.4l9.2-5.7z" fill="currentColor"/></svg>';

/* =========================================================================
   Cai dat (luu trong may)
   ========================================================================= */
const SET_KEY = 'denglish.dict.settings';
const DEFAULTS = {
  autoReplay: '0', gap: '0.5', hints: '1', showVi: 'check', autoNext: '1',
  showImmediate: true, showFull: false, speed: '1', accent: 'uk',
  ftVi: true, ftAutoScroll: true,
};
let S = Object.assign({}, DEFAULTS);
try { S = Object.assign(S, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch (e) {}
const saveSettings = () => { try { localStorage.setItem(SET_KEY, JSON.stringify(S)); } catch (e) {} };

$('themeBtn') && ($('themeBtn').onclick = () => {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('denglish.theme', t); } catch (e) {}
});

/* =========================================================================
   Tai bai tu kho
   ========================================================================= */
async function fetchJson(path) {
  return JSON.parse(fromUtf8(await sync.getRaw(path)));
}

async function loadIndex() {
  const cached = await getMeta('lessons:index', null);
  if (!navigator.onLine || !(await sync.config())) return cached;
  try {
    const fresh = await fetchJson('lessons/index.json');
    await setMeta('lessons:index', fresh);
    return fresh;
  } catch (e) {
    if (cached) return cached;
    throw e;
  }
}

async function loadLesson(vid) {
  const cached = await getMeta('lesson:' + vid, null);
  const index = await getMeta('lessons:index', null);
  const entry = index && (index.lessons || []).find(l => l.video_id === vid);
  if (cached && (!entry || cached.hash === entry.hash || !navigator.onLine)) return cached.data;
  try {
    const data = await fetchJson('lessons/' + vid + '.json');
    await setMeta('lesson:' + vid, { hash: entry ? entry.hash : '', data });
    return data;
  } catch (e) {
    if (cached) return cached.data;
    throw e;
  }
}

const progressKey = (vid) => 'dict:progress:' + vid;

function fmtDur(sec) {
  sec = Math.round(sec || 0);
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

/* =========================================================================
   Danh sach bai
   ========================================================================= */
async function showList() {
  $('listView').classList.remove('hidden');
  const box = $('lessons');
  const cfg = await sync.config();
  if (!cfg) {
    box.innerHTML = '<div class="notice">Chưa kết nối với máy tính. Mở trang <a href="./" style="color:var(--accent)">Từ vựng</a> → ⚙ → ' +
      '<b>Quét mã cài đặt</b> (mã nằm trong Denglish trên máy tính: ⚙ Cài đặt → ☁ Sổ từ trên iPhone).</div>';
    return;
  }
  let index = null;
  try { index = await loadIndex(); }
  catch (e) { box.innerHTML = '<div class="notice warn">Chưa tải được danh sách bài: ' + esc(e.message) + '</div>'; return; }
  const list = (index && index.lessons) || [];
  if (!list.length) {
    box.innerHTML = '<div class="notice">Chưa có bài nào. Trên máy tính, mở Denglish và tạo bài Dictation — ' +
      'Denglish tự gửi bài sang đây trong vài phút (cần đã kết nối ☁ Sổ từ trên iPhone).</div>';
    return;
  }
  const rows = await Promise.all(list.map(async (l) => {
    const p = await getMeta(progressKey(l.video_id), null);
    const pct = p && l.n ? Math.round((p.done || []).length / l.n * 100) : 0;
    return '<a class="lcard" href="dictation.html?v=' + encodeURIComponent(l.video_id) + '">' +
      // Anh nho (320px) cua YouTube cho nhe, thay vi anh 1280px luu trong bai
      '<span class="lthumb"><img src="https://i.ytimg.com/vi/' + encodeURIComponent(l.video_id) + '/mqdefault.jpg" alt="" loading="lazy" />' +
      (l.duration ? '<span class="dur">' + fmtDur(l.duration) + '</span>' : '') + '</span>' +
      '<span class="linfo"><span class="ltitle">' + esc(l.title) + '</span>' +
      '<span class="lmeta">' + esc(l.channel || '') + (l.n ? ' · ' + l.n + ' câu' : '') + '</span>' +
      '<span class="lprog"><span class="pbar"><i style="width:' + pct + '%"></i></span>' + pct + '%</span></span></a>';
  }));
  box.innerHTML = rows.join('');
  if (!navigator.onLine) $('listNote').textContent = 'Đang mất mạng — đây là danh sách đã lưu; video cần có mạng để phát.';
}

/* =========================================================================
   Mot bai
   ========================================================================= */
let lesson = null;
let segs = [];
let mode = 'dict';
let idx = 0, solved = false, counted = false, lastCheck = null;
let score = { correct: 0, wrong: 0, skipped: 0 };
let done = new Set();
let ftIdx = 0, followHold = 0;

async function showLesson() {
  document.documentElement.classList.add('in-lesson');
  $('lessonView').classList.remove('hidden');
  fitViewport();
  try {
    lesson = await loadLesson(VIDEO_ID);
  } catch (e) {
    $('lzTitle').textContent = 'Không mở được bài này';
    $('dictPane').innerHTML = '<div class="notice warn">Chưa tải được bài: ' + esc(e.message) +
      ' — <a href="dictation.html" style="color:var(--accent)">về danh sách bài</a></div>';
    return;
  }
  segs = lesson.segments || [];
  computeHints(segs);
  document.title = lesson.title + ' — Denglish';
  $('lzTitle').textContent = lesson.title;
  $('sourceNote').textContent = sourceLabel(lesson);

  const prog = await getMeta(progressKey(VIDEO_ID), null);
  if (prog) {
    idx = Math.min(prog.index || 0, Math.max(segs.length - 1, 0));
    done = new Set(prog.done || []);
    score = { correct: prog.correct || 0, wrong: prog.wrong || 0, skipped: prog.skipped || 0 };
  }
  initOptions();
  renderFullTranscript();
  updateScore();
  loadSentence(idx, false);
  tryCreatePlayer();
}

function sourceLabel(l) {
  const k = l.source_kind || 'auto';
  const map = { manual: 'Phụ đề gốc do người viết', auto: 'Phụ đề tự động của YouTube', whisper: 'Nhận dạng giọng nói (Whisper)' };
  return (map[k] || '') + (l.user_translation ? ' · bản dịch của bạn' : '');
}

function viHtml(seg) {
  const auto = lesson && lesson.user_translation && seg.vi_by === 'auto' && seg.vi;
  return esc(seg.vi || '') + (auto ? '<span class="auto-tag">máy</span>' : '');
}

/* ---------- vua man hinh: ban phim mo thi trang co lai, video nho lai ---------- */
function fitViewport() {
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  const top = vv ? vv.offsetTop : 0;
  const root = document.documentElement.style;
  root.setProperty('--vv-h', h + 'px');
  root.setProperty('--vv-top', top + 'px');
  // Ban phim mo: phan nhin thay ngan han han man hinh trong luc dang go
  const typing = document.activeElement === $('answer');
  const kb = typing && (window.innerHeight - h > 120 || h < (screen.height || 800) * 0.7 || h < 560);
  $('lessonView').classList.toggle('kb', kb);
  window.scrollTo(0, 0);
}
if (window.visualViewport) {
  visualViewport.addEventListener('resize', fitViewport);
  visualViewport.addEventListener('scroll', fitViewport);
}
window.addEventListener('resize', fitViewport);

/* =========================================================================
   Trinh phat YouTube
   ========================================================================= */
let player = null, apiReady = false, everPlayed = false;
let loopTimer = null, replayTimer = null, followTimer = null;

window.onYouTubeIframeAPIReady = () => { apiReady = true; tryCreatePlayer(); };
if (window.YT && window.YT.Player) apiReady = true;

function tryCreatePlayer() {
  if (!apiReady || !lesson || player) return;
  player = new YT.Player('player', {
    videoId: lesson.video_id,
    playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
    events: {
      onReady: () => setSpeed(S.speed),
      onStateChange: (e) => {
        if (e.data === 1) everPlayed = true;
        syncPlayIcon();
      },
    },
  });
}

function playerState() {
  try { return player && player.getPlayerState ? player.getPlayerState() : -1; } catch (e) { return -1; }
}
function currentTime() {
  try { return player && player.getCurrentTime ? player.getCurrentTime() : 0; } catch (e) { return 0; }
}
const isPlaying = () => { const s = playerState(); return s === 1 || s === 3; };
function syncPlayIcon() { $('playBtn').classList.toggle('is-playing', isPlaying()); }

function setSpeed(rate) {
  S.speed = String(rate); saveSettings();
  $('speedBtn').textContent = String(parseFloat(rate)) + '×';
  try { player && player.setPlaybackRate(parseFloat(rate)); } catch (e) {}
}

function stopLoop() {
  clearInterval(loopTimer); loopTimer = null;
  clearTimeout(replayTimer); replayTimer = null;
}

/** iPhone chi cho phat sau lan cham dau tien vao video: neu bam ▶ ma video khong chay thi nhac */
function nudgeIfBlocked() {
  if (everPlayed) return;
  setTimeout(() => {
    if (!everPlayed && !isPlaying()) toast('Chạm vào nút ▶ giữa video một lần để iPhone cho phát — sau đó dùng nút bên dưới.', 4200);
  }, 1800);
}

function playSegment(seg, replays) {
  if (!player || !player.seekTo || !seg) return;
  stopLoop();
  let left = replays || 0;
  const startedAt = Date.now();
  let armed = false;
  player.seekTo(Math.max(0, seg.start), true);
  player.playVideo();
  nudgeIfBlocked();
  loopTimer = setInterval(() => {
    const t = currentTime();
    if (!armed) {
      if (t < seg.end - 0.05 || Date.now() - startedAt > 1500) armed = true;
      else return;
    }
    if (t >= seg.end) {
      stopLoop();
      player.pauseVideo();
      if (left > 0) {
        left--;
        replayTimer = setTimeout(() => {
          if (mode === 'dict' && segs[idx] === seg) playSegment(seg, left);
        }, parseFloat(S.gap) * 1000);
      }
    }
  }, 50);
}

function togglePlayDict() {
  if (!player || !player.getPlayerState) return;
  if (isPlaying()) { stopLoop(); player.pauseVideo(); }
  else playSegment(segs[idx], 0);
}

/* =========================================================================
   Goi y: ten rieng, con so, tu dac biet (giong exercise.js)
   ========================================================================= */
const ABBR = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'jr', 'sr', 'vs', 'mt', 'lt', 'gen', 'col']);
const SKIP_PROPER = new Set([
  'ok', 'okay', 'tv', 'am', 'pm', 'english', 'god', 'mom', 'dad', 'mum', 'mr', 'mrs', 'ms', 'dr',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december'
]);
const COMMON = new Set((
  'a an the and but or so if then than that this these those there here where when what which ' +
  'who whom whose why how in on at to of for from by with about as into onto over under after ' +
  'before while during since until because though although it its he she we they you me him ' +
  'her us them my your his our their is are was were be been being do does did have has had ' +
  'will would can could should may might must not no yes all some any every each one two just ' +
  'also only even now well oh hey hi soon still yet very really maybe perhaps again once first ' +
  'next finally however therefore meanwhile today tomorrow yesterday later let lets please'
).split(' '));
const LOANWORDS = new Set([
  'video', 'internet', 'online', 'offline', 'email', 'website', 'youtube', 'google', 'facebook',
  'album', 'robot', 'radio', 'taxi', 'piano', 'guitar', 'golf', 'tennis', 'pizza', 'menu',
  'hotel', 'camera', 'laptop', 'virus', 'vitamin', 'protein', 'model', 'show', 'game', 'test',
  'team', 'club', 'style', 'blog', 'chat', 'file', 'link', 'check', 'logo', 'sale', 'shop',
  'yoga', 'cafe', 'coffee', 'okay', 'hello', 'sorry', 'thanks', 'super', 'mail', 'media',
  'studio', 'stress', 'design', 'fashion', 'clip', 'podcast', 'idol', 'smartphone', 'marketing'
]);
const VN_ASCII = new Set([
  'long', 'hang', 'than', 'sang', 'bang', 'hung', 'thong', 'tong', 'cong', 'dong', 'song',
  'chung', 'nhung', 'trong', 'thanh', 'khong', 'hoang', 'quang', 'khang', 'minh', 'linh',
  'binh', 'tinh', 'dinh', 'ninh', 'kinh', 'thin', 'chin', 'bien', 'tien', 'lien', 'mien',
  'dien', 'nhan', 'xanh', 'gian', 'nguyen', 'tuan', 'toan', 'hoan', 'loan', 'doan', 'chan'
]);

function tokenCore(raw) {
  let core = String(raw).replace(/^[^\p{L}\p{N}$£€]+/u, '').replace(/[^\p{L}\p{N}%]+$/u, '');
  const hadDot = /\.["'”’)\]]*$/u.test(raw);
  const bare = core.toLowerCase().replace(/\./g, '');
  if (hadDot && (ABBR.has(bare) || /^\p{L}$/u.test(core) || /^(\p{L}\.)+\p{L}$/u.test(core))) core += '.';
  return core;
}
function endsSentence(tok) {
  if (!tok) return true;
  if (!/[.!?:…]["'”’)\]]*$/u.test(tok.raw)) return false;
  const bare = tok.core.toLowerCase().replace(/\./g, '');
  if (ABBR.has(bare)) return false;
  if (/^\p{L}\.?$/u.test(tok.core)) return false;
  return true;
}
function breaksAfter(tok) {
  return /[,;:!?)\]"”]$/u.test(tok.raw) || (/\.$/.test(tok.raw) && endsSentence(tok));
}
function inVietnamese(viLower, word) {
  let from = 0;
  for (;;) {
    const at = viLower.indexOf(word, from);
    if (at < 0) return false;
    const before = viLower[at - 1], after = viLower[at + word.length];
    const isL = (ch) => !!ch && /\p{L}/u.test(ch);
    if (!isL(before) && !isL(after)) return true;
    from = at + 1;
  }
}

function computeHints(list) {
  const stream = [];
  list.forEach((seg, si) => {
    String(seg.text || '').split(/\s+/).filter(Boolean).forEach(raw => stream.push({ si, raw, core: tokenCore(raw) }));
  });
  const stats = new Map(), capForm = new Map();
  stream.forEach((t, k) => {
    t.start = k === 0 || endsSentence(stream[k - 1]) || /^["'“‘(]/u.test(t.raw);
    if (!/^\p{L}/u.test(t.core)) return;
    const key = t.core.toLowerCase();
    const st = stats.get(key) || { capMid: 0, lower: 0 };
    if (/^\p{Ll}/u.test(t.core)) st.lower++;
    else if (!t.start) { st.capMid++; if (!capForm.has(key)) capForm.set(key, t.core); }
    stats.set(key, st);
  });
  const canonical = (core) => capForm.get(core.toLowerCase()) || core;
  stream.forEach(t => {
    const c = t.core;
    t.num = /\p{N}/u.test(c);
    t.proper = false;
    if (!/^\p{Lu}/u.test(c) || /^i('(m|ve|ll|d|s))?$/i.test(c)) return;
    const letters = c.replace(/[^\p{L}]/gu, '');
    if (letters.length >= 2 && letters === letters.toUpperCase()) { t.proper = true; return; }
    const key = c.toLowerCase();
    if (COMMON.has(key.replace(/['’]s$/u, ''))) return;
    const st = stats.get(key) || { capMid: 0, lower: 0 };
    t.proper = t.start ? st.capMid > 0 && st.lower === 0 : st.lower === 0 || st.capMid >= 3;
  });
  const bySeg = list.map(() => []);
  stream.forEach(t => bySeg[t.si].push(t));
  list.forEach((seg, si) => {
    const toks = bySeg[si];
    const hints = [], seen = new Set();
    const add = (text) => { const key = text.toLowerCase(); if (text && !seen.has(key)) { seen.add(key); hints.push(text); } };
    const viLower = String(seg.vi || '').toLowerCase();
    const longWords = toks.filter(t => /^\p{L}{4,}$/u.test(t.core));
    const kept = longWords.filter(t => inVietnamese(viLower, t.core.toLowerCase())).length;
    const viUsable = viLower && !(longWords.length >= 3 && kept / longWords.length > 0.5);
    let group = [];
    const flush = () => {
      if (!group.length) return;
      const one = group.length === 1 ? group[0] : null;
      const skip = one && !one.num && SKIP_PROPER.has(one.core.toLowerCase().replace(/\./g, ''));
      if (!skip) add(group.map(t => t.core).join(' '));
      group = [];
    };
    toks.forEach((t, k) => {
      const prev = toks[k - 1], next = toks[k + 1];
      if (group.length && prev && breaksAfter(prev)) flush();
      const numJoins = t.num && (group.length > 0 || (next && next.proper && !breaksAfter(t)));
      if (t.proper || numJoins) { group.push(t); return; }
      flush();
      if (t.num) { add(t.core); return; }
      const lower = t.core.toLowerCase();
      if (viUsable && /^\p{L}[\p{L}'-]{3,}$/u.test(t.core) && !COMMON.has(lower) && !LOANWORDS.has(lower) &&
          !VN_ASCII.has(lower) && inVietnamese(viLower, lower)) add(canonical(t.core));
    });
    flush();
    seg.hints = hints;
  });
}

function renderHint(seg) {
  const el = $('nameHint');
  const hints = S.hints === '1' && seg && seg.hints ? seg.hints : [];
  if (!hints.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.innerHTML = '<b>Gợi ý:</b>' + hints.map(h => '<span class="hint-chip">' + esc(h) + '</span>').join('');
  el.classList.remove('hidden');
}

/* =========================================================================
   So dap an (giong exercise.js)
   ========================================================================= */
function normWord(w) {
  return (w || '').toLowerCase().replace(/[‘’ʼ']/g, '').replace(/[^\p{L}\p{N}]/gu, '');
}
function tokenize(text) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const norms = [], owner = [];
  words.forEach((w, wi) => {
    w.split(/[-‐-―]+/).forEach(part => { const n = normWord(part); if (n) { norms.push(n); owner.push(wi); } });
  });
  return { words, norms, owner };
}
function align(a, b) {
  const n = a.length, m = b.length;
  const dp = [];
  for (let i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: 'ok', u: i, c: j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: 'extra', u: i }); i++; }
    else { out.push({ t: 'miss', c: j }); j++; }
  }
  while (i < n) out.push({ t: 'extra', u: i++ });
  while (j < m) out.push({ t: 'miss', c: j++ });
  return out;
}
function compare(userText, correctText) {
  const U = tokenize(userText), C = tokenize(correctText);
  const ops = align(U.norms, C.norms);
  const cState = C.norms.map(() => 'ok');
  const uState = U.norms.map(() => 'ok');
  let extras = [], misses = [];
  const flush = (okAfter) => {
    const n = Math.min(extras.length, misses.length);
    for (let k = 0; k < n; k++) { cState[misses[k]] = 'sub'; uState[extras[k]] = 'wrong'; }
    for (let k = n; k < misses.length; k++) cState[misses[k]] = okAfter ? 'gap' : 'tail';
    for (let k = n; k < extras.length; k++) uState[extras[k]] = 'extra';
    extras = []; misses = [];
  };
  ops.forEach(op => { if (op.t === 'ok') flush(true); else if (op.t === 'extra') extras.push(op.u); else misses.push(op.c); });
  flush(false);
  const rank = { ok: 0, tail: 1, gap: 2, sub: 3 };
  const wordState = C.words.map(() => 'ok');
  cState.forEach((s, k) => { const wi = C.owner[k]; if (rank[s] > rank[wordState[wi]]) wordState[wi] = s; });
  const wrongUserWords = new Set();
  uState.forEach((s, k) => { if (s !== 'ok') wrongUserWords.add(U.owner[k]); });
  const mistakes = cState.filter(s => s === 'sub' || s === 'gap').length + uState.filter(s => s === 'extra').length;
  const remaining = wordState.filter(s => s === 'tail').length;
  return { words: C.words, wordState, wrongUserWords, mistakes, remaining,
           empty: U.norms.length === 0, perfect: mistakes === 0 && remaining === 0 };
}

const starWord = (w) => w.replace(/[\p{L}\p{N}]/gu, '*');

function renderResult(r, forceFull) {
  const box = $('result');
  box.innerHTML = '';
  const full = forceFull || S.showFull;
  const clean = r.mistakes === 0;
  let nextShown = false;
  r.words.forEach((w, i) => {
    const st = r.wordState[i];
    const span = document.createElement('span');
    let shown = true;
    if (r.perfect) span.className = 'rw good w';
    else if (st === 'ok') span.className = 'rw ok w';
    else {
      let reveal = full;
      if (!reveal && S.showImmediate) {
        if (st === 'sub' || st === 'gap') reveal = true;
        else if (st === 'tail' && clean && !nextShown) { reveal = true; nextShown = true; }
      }
      if (reveal) span.className = 'rw rev w';
      else { span.className = 'rw star'; shown = false; }
    }
    if (shown) { span.textContent = w; span.dataset.word = w; } else span.textContent = starWord(w);
    box.appendChild(span);
    box.appendChild(document.createTextNode(' '));
  });
}

function renderVerdict(r) {
  const v = $('verdict');
  if (r.perfect) { v.className = 'verdict ok'; v.textContent = '✓ Chính xác!'; }
  else if (r.empty) { v.className = 'verdict so-far'; v.textContent = 'Câu này có ' + r.words.length + ' từ'; }
  else if (r.mistakes === 0) { v.className = 'verdict so-far'; v.textContent = '✓ Đúng tới đây · còn ' + r.remaining + ' từ'; }
  else { v.className = 'verdict no'; v.innerHTML = '<span class="v-ico">⚠</span> Chưa đúng'; }
  $('checkBtn').classList.add('hidden');
}

function markTyped(wrongSet) {
  const ta = $('answer'), bd = $('answerBackdrop');
  const val = ta.value;
  let html = '', last = 0, wi = 0;
  val.replace(/\S+/g, (m, offset) => {
    html += esc(val.slice(last, offset));
    html += wrongSet.has(wi) ? '<mark>' + esc(m) + '</mark>' : esc(m);
    last = offset + m.length;
    wi++;
    return m;
  });
  bd.innerHTML = html + esc(val.slice(last)) + '\n';
  bd.scrollTop = ta.scrollTop;
}
const clearMarks = () => { $('answerBackdrop').innerHTML = ''; };

/* =========================================================================
   Mot cau
   ========================================================================= */
function loadSentence(i, autoplay) {
  if (!segs.length) return;
  idx = Math.max(0, Math.min(i, segs.length - 1));
  solved = false; counted = false; lastCheck = null;
  const seg = segs[idx];
  $('counter').textContent = (idx + 1) + ' / ' + segs.length;
  $('prevBtn').disabled = idx === 0;
  $('nextBtn').disabled = idx >= segs.length - 1;
  const ta = $('answer');
  ta.value = '';
  ta.classList.remove('right');
  clearMarks();
  $('result').innerHTML = '';
  $('verdict').className = 'verdict hidden';
  $('checkBtn').classList.remove('hidden');
  renderHint(seg);
  const vi = $('viLine');
  if (S.showVi === 'always' && seg.vi) { vi.innerHTML = viHtml(seg); vi.classList.remove('hidden'); }
  else vi.classList.add('hidden');
  updateScore();
  if (autoplay !== false && mode === 'dict') playSegment(seg, parseInt(S.autoReplay, 10) || 0);
  saveProgress();
}

function updateScore() {
  const pct = segs.length ? Math.round((done.size / segs.length) * 100) : 0;
  $('pbar').style.width = pct + '%';
  $('pctText').textContent = pct + '%';
  $('scOk').textContent = score.correct;
  $('scNo').textContent = score.wrong;
  $('scSk').textContent = score.skipped;
}

function showVi(seg) {
  if (S.showVi === 'never' || !seg.vi) return;
  const vi = $('viLine');
  vi.innerHTML = viHtml(seg);
  vi.classList.remove('hidden');
}

function checkAnswer() {
  const seg = segs[idx];
  if (!seg) return;
  if (solved) { if (idx < segs.length - 1) loadSentence(idx + 1, true); return; }
  const value = $('answer').value;
  const r = compare(value, seg.text);
  lastCheck = { result: r, value };
  renderResult(r, false);
  renderVerdict(r);
  markTyped(r.wrongUserWords);
  $('answer').classList.toggle('right', r.perfect);
  if (r.perfect) {
    solved = true;
    if (!done.has(idx)) { done.add(idx); score.correct++; }
    showVi(seg);
    updateScore(); saveProgress();
    if (S.autoNext === '1') {
      const at = idx;
      setTimeout(() => { if (idx === at && mode === 'dict' && idx < segs.length - 1) loadSentence(idx + 1, true); }, 1000);
    }
    return;
  }
  if (r.mistakes > 0 && !counted) { counted = true; score.wrong++; updateScore(); saveProgress(); }
}

function revealAnswer() {
  const seg = segs[idx];
  if (!seg) return;
  const r = compare($('answer').value, seg.text);
  lastCheck = { result: r, value: $('answer').value, forced: true };
  renderResult(r, true);
  markTyped(r.wrongUserWords);
  if (!r.perfect && !counted) { counted = true; score.skipped++; }
  const v = $('verdict');
  v.className = 'verdict so-far';
  v.textContent = '↷ Đáp án đây — gõ lại cho nhớ';
  $('checkBtn').classList.add('hidden');
  showVi(seg);
  updateScore(); saveProgress();
}

function skipSentence() {
  if (!counted && !done.has(idx)) { score.skipped++; counted = true; }
  updateScore(); saveProgress();
  if (idx < segs.length - 1) loadSentence(idx + 1, true);
}

function rerenderLastCheck() { if (lastCheck) renderResult(lastCheck.result, !!lastCheck.forced); }

let saveTimer = null;
function saveProgress() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    setMeta(progressKey(VIDEO_ID), { index: idx, done: [...done], correct: score.correct, wrong: score.wrong,
                                     skipped: score.skipped, at: new Date().toISOString() }).catch(() => {});
  }, 500);
}

/* =========================================================================
   Toan bai: video chay lien tuc, dong dang doc sang len
   ========================================================================= */
function wordSpans(text) {
  return String(text || '').split(/\s+/).filter(Boolean)
    .map(w => '<span class="w" data-word="' + esc(w) + '">' + esc(w) + '</span>').join(' ');
}

function renderFullTranscript() {
  const list = $('ftList');
  list.innerHTML = segs.map((seg, i) =>
    '<div class="ft-row" data-i="' + i + '"><button class="ft-play" data-play="' + i + '" title="Nghe từ câu này">' + ICON_ROW_PLAY + '</button>' +
    '<div class="ft-text"><div class="ft-en">' + wordSpans(seg.text) + '</div>' +
    (seg.vi ? '<div class="ft-vi">' + viHtml(seg) + '</div>' : '') + '</div></div>').join('');
  // Cham vao tu: tra tu (wordpop). Cham nut ▶ dau dong: nghe tu cau do.
  list.onclick = (e) => {
    const b = e.target.closest('[data-play]');
    if (b) ftGo(parseInt(b.dataset.play, 10), true);
  };
  list.classList.toggle('hide-vi', !S.ftVi);
}

function setFtActive(i, instant) {
  const list = $('ftList');
  const prev = list.querySelector('.ft-row.active');
  if (prev) prev.classList.remove('active');
  const row = list.children[i];
  if (row) {
    row.classList.add('active');
    if (S.ftAutoScroll) {
      const body = $('lzBody');
      const top = row.offsetTop - list.offsetTop - (body.clientHeight - row.offsetHeight) / 3;
      body.scrollTo({ top: Math.max(0, top + list.offsetTop - 10), behavior: instant ? 'auto' : 'smooth' });
    }
  }
}

function segAt(t) {
  let lo = 0, hi = segs.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].start <= t + 0.08) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

function ftGo(i, autoplay) {
  if (!segs.length) return;
  ftIdx = Math.max(0, Math.min(i, segs.length - 1));
  setFtActive(ftIdx, false);
  followHold = Date.now() + 700;
  if (player && player.seekTo) {
    player.seekTo(Math.max(0, segs[ftIdx].start), true);
    if (autoplay !== false) { player.playVideo(); nudgeIfBlocked(); }
  }
}

function startFollow() {
  stopFollow();
  followTimer = setInterval(() => {
    if (playerState() !== 1 || !segs.length || Date.now() < followHold) return;
    const t = currentTime();
    const seg = segs[ftIdx];
    if ($('ftRepeat').checked && seg) {
      const userSeeked = t < seg.start - 1.5 || t > seg.end + 2;
      if (!userSeeked) {
        if (t >= seg.end) { player.seekTo(Math.max(0, seg.start), true); followHold = Date.now() + 400; }
        return;
      }
    }
    const i = segAt(t);
    if (i !== ftIdx) { ftIdx = i; setFtActive(i, false); }
  }, 120);
}
function stopFollow() { clearInterval(followTimer); followTimer = null; }

function setMode(m) {
  if (m === mode) return;
  mode = m;
  document.querySelectorAll('.lz-tab').forEach(t => t.classList.toggle('on', t.dataset.tab === m));
  $('dictPane').classList.toggle('hidden', m !== 'dict');
  $('fullPane').classList.toggle('hidden', m !== 'full');
  WordPop.hide();
  stopLoop();
  try { player && player.pauseVideo(); } catch (e) {}
  if (m === 'full') { ftIdx = idx; setFtActive(ftIdx, true); startFollow(); }
  else { stopFollow(); $('lzBody').scrollTop = 0; }
}
document.querySelectorAll('.lz-tab').forEach(tab => { tab.onclick = () => setMode(tab.dataset.tab); });

/* =========================================================================
   Tra tu + luu tu (bang tra tu dung chung voi may tinh: js/wordpop.js)
   ========================================================================= */
WordPop.init({
  onBeforePlay: () => { if (isPlaying()) { stopLoop(); try { player.pauseVideo(); } catch (e) {} } },
  getAccent: () => S.accent,
  // Tu trong o dap an: cau day du va ban dich cua cau dang chep (dap an co the con dau *)
  getContext: (el) => el && el.closest('#result') && segs[idx] ? segs[idx].text : '',
  getVi: (el) => el && el.closest('#result') && segs[idx] ? segs[idx].vi : '',
  // Tu dien cua bai do may tinh tra san; chu khong co thi van hien bang de luu duoc
  lookup: (key) => (lesson && lesson.dict && lesson.dict[key]) || { word: key, vi: '', senses: [], oxford: null },
  audioSrc: (key, acc, d) => {
    const ox = d && d.oxford;
    return ox ? (acc === 'us' ? ox.audio_us || ox.audio_uk : ox.audio_uk || ox.audio_us) : '';
  },
  knownTerms: () => new Set(store.keyIndex().keys()),
  saveTerm: async (item) => {
    item.source = lesson ? lesson.title : '';
    item.source_url = '';
    const r = await store.addItems([item]);
    setTimeout(() => enrichPending(), 400);
    return r;
  },
  removeTerm: async (term) => {
    const c = store.keyIndex().get(norm(term));
    if (c) await store.deleteCard(c.id);
  },
  vocabUrl: './',
});

/* =========================================================================
   Nut bam, o go
   ========================================================================= */
function bindLesson() {
  $('playBtn').onclick = togglePlayDict;
  $('prevBtn').onclick = () => loadSentence(idx - 1, true);
  $('nextBtn').onclick = () => loadSentence(idx + 1, true);
  $('checkBtn').onclick = checkAnswer;
  $('skipBtn').onclick = skipSentence;
  $('revealBtn').onclick = revealAnswer;
  $('speedBtn').onclick = () => {
    const rates = ['0.5', '0.75', '1', '1.25'];
    setSpeed(rates[(rates.indexOf(String(parseFloat(S.speed))) + 1) % rates.length]);
  };
  $('gearBtn').onclick = openOptions;
  const ta = $('answer');
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); checkAnswer(); }
  });
  ta.addEventListener('input', () => {
    clearMarks();
    ta.classList.remove('right');
    $('verdict').classList.add('hidden');
    $('checkBtn').classList.remove('hidden');
    solved = false;
  });
  ta.addEventListener('scroll', () => { $('answerBackdrop').scrollTop = ta.scrollTop; });
  ta.addEventListener('focus', () => setTimeout(fitViewport, 300));
  ta.addEventListener('blur', () => setTimeout(fitViewport, 300));
  // Nut bam khong lam mat ban phim (giu con tro trong o go khi bam Kiem tra / nghe lai)
  ['playBtn', 'checkBtn', 'prevBtn', 'nextBtn', 'speedBtn'].forEach(id => {
    $(id).addEventListener('mousedown', (e) => { if (document.activeElement === ta) e.preventDefault(); });
  });
}

function initOptions() {
  const optImmediate = $('optImmediate'), optFull = $('optFull');
  optImmediate.checked = !!S.showImmediate;
  optFull.checked = !!S.showFull;
  optImmediate.onchange = () => { S.showImmediate = optImmediate.checked; saveSettings(); rerenderLastCheck(); };
  optFull.onchange = () => { S.showFull = optFull.checked; saveSettings(); rerenderLastCheck(); };
  $('ftVi').checked = !!S.ftVi;
  $('ftVi').onchange = (e) => { S.ftVi = e.target.checked; saveSettings(); $('ftList').classList.toggle('hide-vi', !S.ftVi); };
  $('ftAutoScroll').checked = !!S.ftAutoScroll;
  $('ftAutoScroll').onchange = (e) => { S.ftAutoScroll = e.target.checked; saveSettings(); if (S.ftAutoScroll) setFtActive(ftIdx, false); };
  setSpeed(S.speed);
}

/* ---------- bang tuy chon ---------- */
const OPTS = [
  ['autoReplay', 'Tự nghe lại', 'Lặp lại câu mấy lần khi mở', [['0', 'Không']].concat(Array.from({ length: 5 }, (_, i) => [String(i + 1), (i + 1) + ' lần']))],
  ['gap', 'Giãn cách mỗi lần lặp', '', [['0.5', '0.5 giây'], ['1', '1 giây'], ['1.5', '1.5 giây'], ['2', '2 giây'], ['3', '3 giây']]],
  ['hints', 'Gợi ý tên riêng, con số', 'Hiện dưới ô gõ những từ không thể đoán', [['1', 'Hiện'], ['0', 'Ẩn']]],
  ['showVi', 'Hiện bản dịch', '', [['check', 'Sau khi làm đúng'], ['always', 'Luôn hiện'], ['never', 'Không hiện']]],
  ['autoNext', 'Tự sang câu sau khi đúng', '', [['1', 'Có'], ['0', 'Không (bấm Kiểm tra để sang)']]],
  ['accent', 'Giọng đọc khi tra từ', '', [['uk', 'Anh (UK)'], ['us', 'Mỹ (US)']]],
];

function openOptions() {
  let h = '<button class="sh-close" data-close="1" title="Đóng">✕</button><div class="sh-body"><div class="sh-term" style="font-size:1.2rem">Tuỳ chọn</div>' +
    '<div class="opt-list">';
  OPTS.forEach(([key, label, hint, choices]) => {
    h += '<label class="opt"><span>' + esc(label) + (hint ? '<small>' + esc(hint) + '</small>' : '') + '</span><select data-key="' + key + '">' +
      choices.map(([v, t]) => '<option value="' + v + '"' + (String(S[key]) === v ? ' selected' : '') + '>' + esc(t) + '</option>').join('') +
      '</select></label>';
  });
  h += '</div><div class="row" style="margin-top:16px;gap:8px;flex-wrap:wrap">' +
    '<button class="btn btn-sm" data-reset="1">⟲ Học lại bài này từ đầu</button></div></div>';
  $('sheet').innerHTML = h;
  $('sheetWrap').classList.remove('hidden');
}
function closeSheet() { $('sheetWrap').classList.add('hidden'); $('sheet').innerHTML = ''; }
$('sheetWrap').addEventListener('click', (e) => {
  if (e.target === $('sheetWrap') || e.target.closest('[data-close]')) return closeSheet();
  if (e.target.closest('[data-reset]')) {
    if (!confirm('Xoá tiến độ và học lại bài này từ đầu?')) return;
    done = new Set();
    score = { correct: 0, wrong: 0, skipped: 0 };
    closeSheet();
    loadSentence(0, true);
  }
});
$('sheetWrap').addEventListener('change', (e) => {
  const sel = e.target.closest('select[data-key]');
  if (!sel) return;
  S[sel.dataset.key] = sel.value; saveSettings();
  if (sel.dataset.key === 'hints') renderHint(segs[idx]);
  if (sel.dataset.key === 'showVi') {
    if (S.showVi === 'always' || (S.showVi === 'check' && solved)) showVi(segs[idx]);
    else $('viLine').classList.add('hidden');
  }
});

/* =========================================================================
   Khoi dong
   ========================================================================= */
async function boot() {
  askPersist();
  await store.load();
  store.onChange((what) => { if (what !== 'sync') sync.requestSync(); });
  sync.startAutoSync();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!VIDEO_ID) return showList();
  bindLesson();
  return showLesson();
}

boot();
