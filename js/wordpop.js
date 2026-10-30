/* Denglish - tra tu khi re chuot, dung chung cho moi trang.
 *
 * Bang tra tu KHONG tat khi dua chuot vao no: ban bam duoc nut nghe giong Anh/My,
 * mo trang Oxford, them tu vao so tu vung. Bang chi tat khi chuot roi ca tu lan bang.
 * Tren dien thoai (khong co chuot): cham vao tu de mo bang, cham ra ngoai de tat.
 * Boi den mot cum tu / thanh ngu (2-8 tu) thi hien nut "Them cum tu" ngay duoi; boi den ca cau / ve cau
 * (4-40 tu) thi co nut "Mau cau" - luu thanh the mau cau de hoc cach noi.
 * Tu dang tra nam trong mot cum dong tu / thanh ngu cua Oxford co mat trong cau (vd "conjure up")
 * thi bang tra hien them nut "Them cum" ben duoi nut them tu don - muon luu rieng tu nao cung duoc.
 *
 * File nay dung chung voi app iPhone (denglish-vocab/js/wordpop.js, giong het - sua mot ben thi chep sang ben kia).
 * Mac dinh goi API cua Denglish tren may tinh; app iPhone truyen ham rieng qua init():
 *   lookup(key) -> Promise du lieu tra tu   knownTerms() -> Promise<Set khoa>   saveTerm(item) -> Promise<{added}>
 *   removeTerm(term) -> Promise             audioSrc(key, accent, data) -> link mp3   vocabUrl
 */
window.WordPop = (() => {
  const options = { onBeforePlay: null, getAccent: null, getVi: null, getContext: null, lookup: null, knownTerms: null,
                    saveTerm: null, removeTerm: null, audioSrc: null, vocabUrl: '/vocab' };
  const wordData = new Map();      // tu -> ket qua da tra xong
  const wordPending = new Map();   // tu -> Promise dang tra
  let pop = null;
  let hoverEl = null;
  let popEl = null;                // tu dang hien trong bang (de lay cau ngu canh khi them)
  let showTimer = null, hideTimer = null, scrollTimer = null;
  let audio = null;
  let lastTouch = 0;
  let vocabKeys = null, vocabKeysAt = 0;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const wordKey = (el) => String(el.dataset.word || el.textContent || '')
    .trim().toLowerCase().replace(/’/g, "'")
    .replace(/[^a-z'-]/g, '').replace(/^['-]+|['-]+$/g, '');

  const shownWord = (el) => String(el.dataset.word || el.textContent || '').trim()
    .replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '');

  /** Giong vocab.norm() phia may chu */
  const normKey = (t) => String(t || '').replace(/[’‘]/g, "'").toLowerCase().replace(/\s+/g, ' ').trim()
    .replace(/^[\s.,;:!?"“”()[\]{}*_`~\-–—•]+|[\s.,;:!?"“”()[\]{}*_`~\-–—•]+$/g, '');

  const touchy = () => Date.now() - lastTouch < 1200;

  function ensurePop() {
    if (pop) return pop;
    pop = document.getElementById('wordpop');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'wordpop';
      document.body.appendChild(pop);
    }
    pop.className = 'wordpop';
    pop.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    pop.addEventListener('mouseleave', () => { if (!touchy()) scheduleHide(220); });
    pop.addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      if (del) { e.preventDefault(); e.stopPropagation(); removeTerm(del.dataset.del, del.closest('[data-add]')); return; }
      const add = e.target.closest('[data-add]');
      if (add) { e.preventDefault(); addTerm(add.dataset.add, popEl, add); return; }
      const btn = e.target.closest('[data-play]');
      if (!btn) return;
      e.preventDefault();
      play(btn.dataset.key, btn.dataset.play, btn.dataset.text, btn);
    });
    return pop;
  }

  function init(opts) {
    Object.assign(options, opts || {});
    ensurePop();
  }

  function hide() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hoverEl = null;
    if (pop) pop.classList.remove('show');
  }

  function scheduleHide(ms) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, ms == null ? 260 : ms);
  }

  function accent() {
    if (options.getAccent) return options.getAccent() === 'us' ? 'us' : 'uk';
    try { return localStorage.getItem('denglish.accent') === 'us' ? 'us' : 'uk'; } catch (e) { return 'uk'; }
  }

  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') lastTouch = Date.now();
  }, true);

  document.addEventListener('mouseover', (e) => {
    if (touchy()) return;                 // cham tren dien thoai: xu ly o su kien click ben duoi
    ensurePop();
    if (pop.contains(e.target)) { clearTimeout(hideTimer); return; }
    const el = e.target.closest ? e.target.closest('.w') : null;
    if (el) {
      clearTimeout(hideTimer);
      if (el === hoverEl) return;
      clearTimeout(showTimer);
      hoverEl = el;
      const quick = pop.classList.contains('show');
      showTimer = setTimeout(() => show(el), quick ? 120 : 220);
      return;
    }
    clearTimeout(showTimer);
    if (pop.classList.contains('show')) scheduleHide();
    else hoverEl = null;
  });

  // Dien thoai / may tinh bang: cham vao tu thi mo bang, cham cho khac thi tat
  document.addEventListener('click', (e) => {
    if (!touchy()) return;
    ensurePop();
    if (pop.contains(e.target)) return;
    const el = e.target.closest ? e.target.closest('.w') : null;
    if (el) {
      const sel = window.getSelection && window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim().includes(' ')) return;   // dang boi den cum tu
      clearTimeout(hideTimer);
      clearTimeout(showTimer);
      hoverEl = el;
      show(el);
      return;
    }
    if (pop.classList.contains('show')) hide();
  });

  // Cuon trang: tam an (tru khi dang thao tac trong bang); cuon xong ma chuot van tren tu thi hien lai
  document.addEventListener('scroll', (e) => {
    hideChip();
    if (!pop || !pop.classList.contains('show') || pop.matches(':hover') || pop.contains(e.target)) return;
    pop.classList.remove('show');
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      if (hoverEl && hoverEl.isConnected && hoverEl.matches(':hover') && !touchy()) show(hoverEl);
    }, 180);
  }, true);

  // Nhap dup vao tu: nghe doc (khong boi den chu)
  document.addEventListener('mousedown', (e) => {
    if (e.detail === 2 && e.target.closest && e.target.closest('.w')) e.preventDefault();
  });
  document.addEventListener('dblclick', (e) => {
    const el = e.target.closest ? e.target.closest('.w') : null;
    if (el) play(wordKey(el), accent(), shownWord(el));
  });

  function lookup(key) {
    if (wordData.has(key)) return Promise.resolve(wordData.get(key));
    if (wordPending.has(key)) return wordPending.get(key);
    if (options.lookup) {
      const p = Promise.resolve(options.lookup(key))
        .then(d => { if (!d) throw new Error('lookup failed'); wordData.set(key, d); return d; })
        .finally(() => wordPending.delete(key));
      wordPending.set(key, p);
      return p;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const p = fetch('/api/word?w=' + encodeURIComponent(key), { signal: ctrl.signal })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(d => {
        if (d.error) throw new Error('lookup failed');
        // Oxford tam thoi loi thi khong giu lai - lan sau tra lai cho du
        if (d.ox_status !== 'error' && d.ox_status !== 'paused') wordData.set(key, d);
        return d;
      })
      .finally(() => { clearTimeout(timer); wordPending.delete(key); });
    wordPending.set(key, p);
    return p;
  }

  async function show(el) {
    const key = wordKey(el);
    if (!key || !el.isConnected) return;
    const word = shownWord(el);
    popEl = el;

    const ready = wordData.get(key);
    if (ready) { render(ready, word, el); return; }

    pop.innerHTML = '<span class="muted">Đang tra…</span>';
    place(el);
    pop.classList.add('show');
    try {
      const d = await lookup(key);
      if (hoverEl === el && el.isConnected) render(d, word, el);
    } catch (e) {
      if (hoverEl !== el || !el.isConnected) return;
      pop.innerHTML = '<span class="muted">Chưa tra được từ này — ' + (touchy() ? 'chạm lại' : 'rê chuột ra rồi vào lại') + ' để thử lại.</span>';
      place(el);
      pop.classList.add('show');
      hoverEl = null;
    }
  }

  function render(d, shown, el) {
    const ox = d.oxford || null;
    const word = shown || d.word;
    const key = d.word;
    let html = '<div class="wp-head"><span class="wp-word">' + esc(word) + '</span>';
    if (ox && ox.pos) html += '<span class="wp-pos">' + esc(ox.pos) + '</span>';
    if (ox && ox.level) html += '<span class="wp-level" title="Cấp độ theo Oxford">' + esc(ox.level) + '</span>';
    html += '</div>';

    const btn = (acc, label) => '<button class="wp-btn" data-play="' + acc + '" data-key="' + esc(key) +
      '" data-text="' + esc(word) + '" title="Nghe">🔊 ' + label + '</button>';
    html += '<div class="wp-ipa-row">';
    if (ox && (ox.ipa_uk || ox.ipa_us)) {
      if (ox.ipa_uk) html += btn('uk', 'UK') + '<span class="wp-ipa">' + esc(ox.ipa_uk) + '</span>';
      if (ox.ipa_us) html += btn('us', 'US') + '<span class="wp-ipa">' + esc(ox.ipa_us) + '</span>';
    } else {
      html += btn('tts', 'Nghe');
    }
    html += '</div>';
    if (ox && ox.ipa_for && ox.ipa_for.toLowerCase() !== word.toLowerCase()) {
      html += '<div class="wp-note">phiên âm của “' + esc(ox.ipa_for) + '”</div>';
    }

    if (d.vi) html += '<div class="wp-vi">' + esc(d.vi) + '</div>';
    const senses = (d.senses || []).slice().sort((a, b) =>
      (ox && b.pos === ox.pos ? 1 : 0) - (ox && a.pos === ox.pos ? 1 : 0));
    senses.slice(0, 3).forEach(s => {
      const terms = String(s.def || '').split(', ').slice(0, 4).join(', ');
      html += '<div class="wp-sense"><b>' + esc(s.pos) + '</b> ' + esc(terms) + '</div>';
    });
    if (ox && ox.definition) {
      const other = ox.headword && ox.headword !== word && ox.headword !== word.toLowerCase();
      html += '<div class="wp-def">' + (other ? '<b>' + esc(ox.headword) + ':</b> ' : '') + esc(ox.definition) + '</div>';
    }
    if (!d.vi && !(d.senses || []).length && !(ox && (ox.ipa_uk || ox.ipa_us || ox.definition))) {
      html += '<div class="wp-sense">Không tìm thấy nghĩa.</div>';
    }

    // Them vao so tu: luon uu tien nguyen mau (chases -> chase, took -> take, assumed -> assume).
    // Chu dang chia co muc rieng tren Oxford (assumed: tinh tu, building: danh tu) thi them nut phu de luu dung chu do.
    const plain = /^[A-Z][a-z]/.test(word) && !d.vi ? word : word.toLowerCase();
    const lemma = ox && ox.base ? ox.base
      : ox && ox.verb && ox.verb.toLowerCase() !== word.toLowerCase() ? ox.verb
      : ox && ox.same_entry && ox.headword ? ox.headword : plain;
    const isBase = lemma.toLowerCase() !== word.toLowerCase();
    html += '<div class="wp-add-row"><button class="wp-add" data-add="' + esc(lemma) + '">＋ Thêm “' + esc(lemma) + '” vào từ vựng' +
      (isBase ? '<small class="wp-lemma">nguyên mẫu của “' + esc(word) + '”</small>' : '') + '</button>';
    if (isBase && ox && !ox.base && ox.verb && plain.toLowerCase() !== lemma.toLowerCase()) {
      html += '<button class="wp-add wp-add-alt" data-add="' + esc(plain) + '">hoặc lưu đúng “' + esc(plain) + '”' +
        (ox.pos ? ' (' + esc(ox.pos) + ')' : '') + '</button>';
    }
    html += '</div>';
    html += '<div class="wp-phr" hidden></div>';   // cum tu trong cau (fillPhrases)

    const link = ox && ox.url ? ' · <a href="' + esc(ox.url) + '" target="_blank" rel="noopener">Oxford ↗</a>' : '';
    const tip = touchy() ? 'Bôi đen nhiều từ để thêm cụm từ' : 'Nhấp đúp vào từ cũng nghe được';
    html += '<div class="wp-foot">' + tip + link + '</div>';

    pop.innerHTML = html;
    fillPhrases(d, el);
    place(el);
    pop.classList.add('show');
    pop.querySelectorAll('.wp-add-row [data-add]').forEach(markAdded);
  }

  /* =======================================================================
     Cum tu trong cau: cum dong tu / thanh ngu cua Oxford co mat quanh tu dang tra.
     Re vao "conjure" (hoac "up") trong "conjure up an idea" -> them nut "Thêm cụm “conjure up”".
     Nut them tu don van o tren: muon luu rieng "conjure" thi bam nut do.
     ======================================================================= */
  const PARTICLES = new Set(('about above across after against ahead along apart around as aside at away back ' +
    'before behind below between beyond by down for forth forward from in into of off on onto out over past ' +
    'round through to together towards under up upon with within without').split(' '));
  // Tieu tu cho phep tan ngu chen giua: "conjure it up", "take your coat off"
  const SPLITTABLE = new Set('up down out off away back apart aside together forward around round over'.split(' '));
  // Chu khong the nam trong tan ngu chen giua / cho trong
  const GAP_STOP = new Set(('and or but nor that which who whom whose when where while if because so than then not ' +
    'is are was were be been').split(' '));
  const OBJ_SLOT = new Set('sb sth somebody something someone somewhere anybody anything anyone'.split(' '));
  const REFL_SLOT = new Set('oneself yourself myself himself herself itself ourselves yourselves themselves'.split(' '));
  const POSS_SLOT = new Set("one's your my his her its our their somebody's someone's sb's".split(' '));
  const AUX = {
    be: new Set("be is are was were am been being isn't aren't wasn't weren't".split(' ')),
    have: new Set("have has had having hasn't haven't hadn't".split(' ')),
    do: new Set("do does did done doing don't doesn't didn't".split(' ')),
  };
  // Dung truoc tieu tu ma khong phai dong tu: bo qua khi tim dong tu cho "up" trong "conjure it up"
  const NOT_VERB = new Set(('a an the it him her them me us you i he she we they this that these those my your his our ' +
    'their its some any one').split(' '));

  /** Giong dictionary._is_inflection: conjured <- conjure, stopping <- stop, carries <- carry */
  function inflects(w, head) {
    if (w === head) return true;
    const stems = [head];
    if (head.endsWith('e')) stems.push(head.slice(0, -1));
    if (head.endsWith('y')) stems.push(head.slice(0, -1) + 'i');
    if (head.length >= 3 && !'aeiouwxy'.includes(head[head.length - 1])) stems.push(head + head[head.length - 1]);
    return stems.some(s => ['s', 'es', 'ed', 'd', 'ing'].some(x => w === s + x));
  }

  function slotOk(kind, w) {
    if (kind === 'refl') return REFL_SLOT.has(w);
    return /^(my|your|his|her|its|our|their)$/.test(w) || /[a-z]'s?$/.test(w);   // poss
  }

  /** "have (got) what it takes" -> cac bien the token: {lit: [cac lua chon]} | {slot: obj|refl|poss} */
  const specCache = new Map();
  function phraseSpecs(phrase) {
    if (specCache.has(phrase)) return specCache.get(phrase);
    const s = String(phrase).toLowerCase().replace(/[’‘]/g, "'").replace(/…/g, ' ').replace(/[!?.]+\s*$/, '').trim();
    let out = [];
    if (s && !/\betc\b|[,;:"]/.test(s)) {
      let vars = [s];
      for (let k = 0; k < 2; k++) {        // phan trong ngoac co the co hoac khong
        vars = vars.flatMap(v => {
          const m = v.match(/\(([^()]*)\)/);
          return m ? [v.replace(m[0], m[1]), v.replace(m[0], ' ')] : [v];
        });
      }
      out = vars.map(v => {
        const toks = v.replace(/[()]/g, ' ').split(/\s+/).filter(Boolean).map(t => {
          const alts = t.split('/').filter(Boolean);
          if (alts.every(a => OBJ_SLOT.has(a))) return { slot: 'obj' };
          if (alts.every(a => REFL_SLOT.has(a))) return { slot: 'refl' };
          if (alts.every(a => POSS_SLOT.has(a))) return { slot: 'poss' };
          return { lit: alts };
        });
        // "somebody can take it..." / "... out of somebody": cho trong o hai dau khong can khop
        while (toks.length && toks[0].slot === 'obj') toks.shift();
        while (toks.length && toks[toks.length - 1].slot === 'obj') toks.pop();
        return toks;
      }).filter(t => t.length && t[0].lit && t.filter(x => x.lit).length >= 2);
    }
    specCache.set(phrase, out);
    return out;
  }

  const EN_BLOCK = '.en, .ft-en, .mine-en, .now-en, p, li, td, blockquote, .sh-def, .exs .en';
  const VI_BLOCK = '.vi, .ft-vi, .mine-vi, .now-vi';

  /** Ban dich tieng Viet cua cau / doan chua `el` trong bai (dong .vi ngay duoi dong tieng Anh) */
  function viOf(el) {
    if (!el || !el.isConnected) return '';
    if (options.getVi) { try { const v = options.getVi(el); if (v) return String(v); } catch (e) {} }
    const block = el.closest(EN_BLOCK);
    if (!block) return '';
    let vi = block.nextElementSibling;
    while (vi && !vi.matches(VI_BLOCK)) vi = vi.nextElementSibling;
    if (!vi || vi.classList.contains('pending')) return '';
    const box = (vi.querySelector('.vi-text') || vi).cloneNode(true);
    box.querySelectorAll('.auto-tag, .pair-label, button').forEach(x => x.remove());
    const t = box.textContent.replace(/\s+/g, ' ').trim();
    return t === '—' ? '' : t.slice(0, 600);
  }

  /** Cac .w cua cau chua `el` (lien nhau trong cung mot khoi chu) va vi tri cua `el` trong do */
  function sentenceOf(el) {
    if (!el || !el.isConnected) return { toks: [], i: -1 };
    const block = el.closest(EN_BLOCK) || el.parentElement;
    if (!block) return { toks: [], i: -1 };
    const all = [...block.querySelectorAll('.w')];
    const at = all.indexOf(el.closest('.w') || el);
    if (at < 0) return { toks: [], i: -1 };
    const ends = (t) => /[.!?]["”’)]*$/.test(tokText(t));
    let a = at, b = at;
    while (a > 0 && !ends(all[a - 1]) && at - a < 40) a--;
    while (b < all.length - 1 && !ends(all[b]) && b - at < 40) b++;
    return { toks: all.slice(a, b + 1), i: at - a };
  }

  const tokText = (t) => (t.dataset.word && t.dataset.word !== t.textContent ? t.dataset.word : t.textContent).trim();

  function sentenceWords(toks) {
    return toks.map(t => {
      const raw = tokText(t);
      return {
        w: raw.toLowerCase().replace(/[’‘]/g, "'").replace(/^[^a-z']+|[^a-z']+$/g, ''),
        stop: /[,;:.!?)\]"”—–]$/.test(raw),     // het menh de: cum tu khong vuot qua
        open: /^[(\["“—–]/.test(raw),
      };
    });
  }

  /** Tim mot bien the cum tu trong cau, phu len vi tri `anchor` -> [dau, cuoi) hoac null */
  function matchSpec(spec, words, anchor, head, forms, splittable) {
    const lit = (tok, w) => tok.lit.some(a => a === w || (a === head && (forms.has(w) || inflects(w, head))) ||
      (AUX[a] && AUX[a].has(w)));
    for (let s = Math.max(0, anchor - 8); s <= anchor; s++) {
      const go = (ti, wi) => {
        if (ti === spec.length) return wi;
        if (wi >= words.length) return -1;
        if (wi > s && (words[wi - 1].stop || words[wi].open)) return -1;
        const tok = spec[ti];
        if (tok.slot === 'obj') {           // "look somebody up and down": 1-4 chu bat ky
          for (let k = 1; k <= 4 && wi + k <= words.length; k++) {
            if (GAP_STOP.has(words[wi + k - 1].w) || (k > 1 && words[wi + k - 2].stop)) break;
            const e = go(ti + 1, wi + k);
            if (e >= 0) return e;
          }
          return -1;
        }
        if (tok.slot) return slotOk(tok.slot, words[wi].w) ? go(ti + 1, wi + 1) : -1;
        if (lit(tok, words[wi].w)) {
          const e = go(ti + 1, wi + 1);
          if (e >= 0) return e;
        }
        // Cum dong tu tach doi: tan ngu ngan nam giua dong tu va tieu tu
        if (splittable && ti > 0 && spec[ti - 1].lit && tok.lit.some(a => SPLITTABLE.has(a))) {
          for (let g = 1; g <= 3 && wi + g < words.length; g++) {
            const x = words[wi + g - 1];
            if (!x.w || PARTICLES.has(x.w) || GAP_STOP.has(x.w) || x.stop || words[wi + g].open) break;
            if (lit(tok, words[wi + g].w)) {
              const e = go(ti + 1, wi + g + 1);
              if (e >= 0) return e;
            }
          }
        }
        return -1;
      };
      const e = go(0, s);
      if (e > anchor) return [s, e];
    }
    return null;
  }

  /** Cum dong tu / thanh ngu (theo du lieu Oxford cua mot tu) co mat trong cau, phu len `anchor` */
  function findPhrases(d, words, anchor) {
    const ox = d && d.oxford;
    if (!ox || !words[anchor] || !words[anchor].w) return [];
    const head = String(ox.verb || ox.base || ox.headword || d.word || '').toLowerCase();
    const forms = new Set(ox.forms || []);
    const hits = [];
    const scan = (list, kind) => (list || []).forEach(term => {
      for (const spec of phraseSpecs(term)) {
        const span = matchSpec(spec, words, anchor, head, forms, kind === 'pv');
        if (span) {
          hits.push({ term, kind, span, score: spec.filter(x => x.lit).length * 10 - (span[1] - span[0]) });
          break;
        }
      }
    });
    scan(ox.phrases, 'pv');
    scan(ox.idioms, 'idm');
    return hits;
  }

  async function fillPhrases(d, el) {
    const box = pop.querySelector('.wp-phr');
    const { toks, i } = sentenceOf(el);
    if (!box || i < 0) return;
    const words = sentenceWords(toks);
    let hits = findPhrases(d, words, i);
    draw(hits);
    // Re vao tieu tu ("up" trong "conjure it up"): xem cum dong tu cua dong tu dung truoc
    if (!PARTICLES.has(words[i].w)) return;
    const near = [];
    for (let j = i - 1; j >= 0 && i - j <= 4 && near.length < 2; j--) {
      if (words[j].stop) break;
      const w = words[j].w;
      if (w && !PARTICLES.has(w) && !NOT_VERB.has(w) && !GAP_STOP.has(w) && !/^[a-z]+'[a-z]+$/.test(w)) near.push(w);
    }
    for (const w of near) {
      let nd = null;
      try { nd = await lookup(w); } catch (e) { continue; }
      if (popEl !== el || !box.isConnected) return;
      hits = hits.concat(findPhrases(nd, words, i));
      draw(hits);
    }

    function draw(list) {
      const seen = new Set();
      // Cum nam tron trong mot cum dai hon thi bo: "looked me up and down" chi con "look somebody up and down"
      const inside = (h, o) => o !== h && o.span[0] <= h.span[0] && h.span[1] <= o.span[1] && o.score > h.score;
      const top = list.slice().sort((a, b) => b.score - a.score)
        .filter(h => !list.some(o => inside(h, o)))
        .filter(h => { const k = normKey(h.term); return seen.has(k) ? false : seen.add(k); })
        .slice(0, 3);
      if (!top.length || popEl !== el || !box.isConnected) return;
      const key = top.map(h => h.term).join('|');
      if (box.dataset.terms === key) return;
      box.dataset.terms = key;
      box.innerHTML = '<div class="wp-phr-h">Đi cùng nhau trong câu này</div>' + top.map(h =>
        '<div class="wp-phr-item"><button class="wp-add" data-add="' + esc(h.term) + '">＋ Thêm cụm “' + esc(h.term) + '”</button>' +
        '<div class="wp-phr-meta">' + (h.kind === 'pv' ? 'cụm động từ' : 'thành ngữ') +
        '<span data-vi="' + esc(normKey(h.term)) + '"></span></div></div>').join('');
      box.hidden = false;
      place(el);
      box.querySelectorAll('[data-add]').forEach(markAdded);
      // Nghia tieng Viet cua ca cum (tra mot lan, lan sau co ngay)
      box.querySelectorAll('[data-vi]').forEach(async (m) => {
        try {
          const r = await lookup(m.dataset.vi);
          if (r && r.vi && m.isConnected) { m.textContent = ' · ' + r.vi; if (popEl === el) place(el); }
        } catch (e) {}
      });
    }
  }

  function place(el) {
    if (!el || !el.isConnected) return;
    const r = el.getBoundingClientRect();
    const w = pop.offsetWidth || 340;
    const h = pop.offsetHeight || 140;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(10, Math.min(left, window.innerWidth - w - 10));
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  async function play(key, acc, text, btn) {
    if (!key) return;
    if (options.onBeforePlay) { try { options.onBeforePlay(); } catch (e) {} }
    if (acc !== 'tts') {
      let d = wordData.get(key);
      if (!d) { try { d = await lookup(key); } catch (e) { d = null; } }
      const ox = d && d.oxford;
      if (ox && (ox.audio_uk || ox.audio_us)) {
        try {
          if (audio) audio.pause();
          const a2 = acc === 'us' ? 'us' : 'uk';
          const src = options.audioSrc ? options.audioSrc(key, a2, d)
            : '/api/audio?w=' + encodeURIComponent(key) + '&accent=' + a2;
          if (!src) throw new Error('no audio');
          audio = new Audio(src);
          if (btn) {
            btn.classList.add('playing');
            const off = () => btn.classList.remove('playing');
            audio.onended = off;
            audio.onerror = off;
          }
          await audio.play();
          return;
        } catch (e) {
          if (btn) btn.classList.remove('playing');
        }
      }
    }
    speak(text || key);
  }

  function speak(word) {
    const clean = String(word || '').replace(/[^A-Za-z' -]/g, '').trim();
    if (!clean || !window.speechSynthesis) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = accent() === 'us' ? 'en-US' : 'en-GB';
      u.rate = 0.9;
      speechSynthesis.speak(u);
    } catch (e) {}
  }

  /* =======================================================================
     Them tu / cum tu vao so tu vung (trang Vocabulary)
     ======================================================================= */
  function loadKeys() {
    if (vocabKeys && Date.now() - vocabKeysAt < 60000) return Promise.resolve(vocabKeys);
    const get = options.knownTerms ? Promise.resolve(options.knownTerms()).then(keys => ({ keys: [...keys] }))
      : fetch('/api/vocab/terms').then(r => r.json());
    return get.then(d => {
      vocabKeys = new Set(d.keys || []);
      vocabKeysAt = Date.now();
      return vocabKeys;
    }).catch(() => vocabKeys || new Set());
  }

  async function markAdded(btn) {
    if (!btn) return;
    const keys = await loadKeys();
    if (btn.isConnected && keys.has(normKey(btn.dataset.add)) && !btn.classList.contains('done')) {
      btn.classList.add('done');
      btn.innerHTML = doneHtml(btn.dataset.add, false);
    }
  }

  // Ghi ro tu / cum nao da co - bang tra co the co nhieu nut them. Luu nham thi xoa ngay tai day.
  const doneHtml = (term, fresh) => (fresh
    ? '✓ Đã thêm “' + esc(term) + '” — AI đang soạn thẻ'
    : '✓ “' + esc(term) + '” đã có trong từ vựng · <a href="' + esc(options.vocabUrl) + '">mở sổ từ</a>') +
    ' · <a href="#" class="wp-del" data-del="' + esc(term) + '">xoá</a>';

  async function removeTerm(term, btn) {
    if (!term || !confirm('Xoá “' + term + '” khỏi sổ từ?')) return;
    try {
      if (options.removeTerm) await options.removeTerm(term);
      else {
        const r = await fetch('/api/vocab/delete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ term }),
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
      }
      (await loadKeys()).delete(normKey(term));
      if (btn && btn.isConnected) {
        btn.classList.remove('done');
        btn.textContent = '✓ Đã xoá “' + term + '” — bấm để thêm lại';
      }
    } catch (e) {
      if (btn && btn.isConnected) btn.textContent = 'Chưa xoá được — thử lại sau';
    }
  }

  /** Cau chua tu `el` - giup AI chon dung nghia */
  function contextOf(el) {
    if (options.getContext) { try { const c = options.getContext(el); if (c) return String(c).slice(0, 400); } catch (e) {} }
    return sentenceOf(el).toks.map(tokText).join(' ').replace(/\s+/g, ' ').slice(0, 400);
  }

  function pageSource() {
    const t = (document.title || '').replace(/\s+—\s+Denglish\s*$/, '').trim();
    return t && t !== 'Denglish' ? t : '';
  }

  async function addTerm(term, ctxEl, btn, kind) {
    if (!term || (btn && (btn.disabled || btn.classList.contains('done')))) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Đang thêm…'; }
    // Kem ban dich cau trong bai: AI lay nghia theo dung cach bai dich ("tai nghe gia re thuoc loai binh dan")
    const item = { term, context: contextOf(ctxEl), context_vi: viOf(ctxEl), source: pageSource(),
                   source_url: location.pathname + location.search };
    if (kind === 'pattern') item.kind = 'pattern';      // mau cau: AI viet thanh khung dung lai duoc
    try {
      let d;
      if (options.saveTerm) d = await options.saveTerm(item);
      else {
        const r = await fetch('/api/vocab/add', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [item] }),
        });
        d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.detail || 'HTTP ' + r.status);
      }
      d = d || {};
      (await loadKeys()).add(normKey(term));
      if (btn) {
        btn.disabled = false;
        btn.classList.add('done');
        btn.innerHTML = doneHtml(term, !!(d.added && d.added.length));
      }
      return true;
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Chưa thêm được — bấm thử lại'; }
      return false;
    }
  }

  /* ---------- boi den cum tu / ca cau -> nut "Them cum" va "Mau cau" ----------
   * 2-8 chu: them cum tu (tu 4 chu co them nut luu thanh mau cau). 9-40 chu: chi luu mau cau
   * ("it's less about particular foods and more about particular nutrients" -> AI viet thanh khung dung lai). */
  let chip = null, selTimer = null, chipCtx = null;
  const short = (t, n) => (t.length > n ? t.slice(0, n - 2) + '…' : t);

  function ensureChip() {
    if (chip) return chip;
    chip = document.createElement('div');
    chip.className = 'phrase-chips';
    document.body.appendChild(chip);
    chip.addEventListener('mousedown', (e) => e.preventDefault());   // giu nguyen vung boi den
    chip.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-kind]');
      e.preventDefault();
      const term = chip.dataset.term;
      if (!b || !term || chip.classList.contains('done')) return;
      const kind = b.dataset.kind;
      chip.classList.add('done');
      chip.innerHTML = '<span class="phrase-chip">Đang thêm…</span>';
      const ok = await addTerm(term, chipCtx, null, kind).catch(() => false);
      chip.innerHTML = '<span class="phrase-chip">' + (ok ? '✓ Đã lưu ' + (kind === 'pattern' ? 'mẫu câu' : 'cụm') +
        ' “' + esc(short(term, 30)) + '”' : 'Chưa thêm được') + '</span>';
      setTimeout(hideChip, 1800);
    });
    return chip;
  }

  function hideChip() {
    if (chip) { chip.classList.remove('show', 'done'); chip.dataset.term = ''; }
  }

  document.addEventListener('selectionchange', () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(checkSelection, 350);
  });

  function checkSelection() {
    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { if (chip && !chip.classList.contains('done')) hideChip(); return; }
    const raw = sel.toString().replace(/\s+/g, ' ').trim().replace(/[’‘]/g, "'");
    const term = raw.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9')%]+$/g, '');
    const words = term.split(' ');
    const phraseOk = words.length >= 2 && words.length <= 8 && term.length <= 80 && /^[A-Za-z][A-Za-z' ,\-()/]*$/.test(term);
    const patternOk = words.length >= 4 && words.length <= 40 && term.length <= 220 &&
      /^[A-Za-z0-9"'(][A-Za-z0-9' ,\-()/;:%$"…]*$/.test(term);
    if (!phraseOk && !patternOk) { hideChip(); return; }
    const range = sel.getRangeAt(0);
    let node = range.commonAncestorContainer;
    if (node.nodeType !== 1) node = node.parentElement;
    if (!node || !(node.closest('.w') || node.querySelector('.w'))) { hideChip(); return; }  // chi chu tieng Anh co tra tu
    const first = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement);
    const r = range.getBoundingClientRect();
    if (!r.width && !r.height) { hideChip(); return; }
    const c = ensureChip();
    if (c.dataset.term === term && c.classList.contains('show')) return;
    c.classList.remove('done');
    c.dataset.term = term;
    c.innerHTML = (phraseOk ? '<button type="button" class="phrase-chip" data-kind="">＋ Thêm cụm “' + esc(short(term, 34)) + '”</button>' : '') +
      (patternOk ? '<button type="button" class="phrase-chip pattern" data-kind="pattern" title="Lưu cả câu làm mẫu câu để học cách nói">＋ ' +
        (phraseOk ? 'Mẫu câu' : 'Lưu mẫu câu “' + esc(short(term, 30)) + '”') + '</button>' : '');
    c.classList.add('show');
    const w = c.offsetWidth, h = c.offsetHeight;
    let top = r.bottom + 10;
    if (top + h > window.innerHeight - 10) top = r.top - h - 10;
    c.style.top = Math.max(8, top) + 'px';
    c.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8)) + 'px';
    // Cau ngu canh lay tu tu dau tien trong vung boi den
    chipCtx = first && first.closest ? (first.closest('.w') || node.querySelector('.w')) : null;
  }

  return { init, hide, addTerm };
})();
