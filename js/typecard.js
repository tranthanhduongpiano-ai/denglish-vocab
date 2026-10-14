/* Denglish - the "go tu": chi hien nghia tieng Viet, nguoi hoc go lai tu / cum tu tieng Anh.
 *
 * Dung chung cho trang Vocabulary tren laptop (dictation-app/static/js/typecard.js) va app iPhone
 * (denglish-vocab/js/typecard.js) - sua mot ben thi chep y nguyen sang ben kia.
 *
 * Trong mot luot on, the go xen ke voi the vuot (ngau nhien, khong qua 2 the cung kieu lien nhau).
 * Moi chu cai mot o gach chan (moi tu mot nhom), san 1-2 chu goi y. Go xong Enter / "Kiểm tra":
 *   dung het -> Thuoc · sai 1 chu (tu 5 chu cai tro len) -> Mang mang · con lai, bo trong -> Chua thuoc.
 * Sai thi chu sai to do, o thieu gach do (bo trong: gach do het) va hien dap an dung.
 */
window.TypeCard = (() => {
  'use strict';

  const esc = (s) => String(s == null ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // So sanh khong phan biet hoa thuong, bo dau (cafe = café)
  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const letters = (s) => fold(s).replace(/[^a-z]/g, '');
  const touch = () => window.matchMedia && matchMedia('(hover: none)').matches;
  const VERDICT = {
    know: '✓ Chính xác!',
    vague: '≈ Gần đúng — sai một chữ',
    unknown: '✗ Chưa đúng',
    skip: 'Đáp án',
  };

  /** The nay go duoc khong: co nghia tieng Viet, dai vua phai */
  function eligible(card) {
    const n = letters(card && card.term).length;
    return !!(card && card.meaning_vi && n >= 2 && n <= 32);
  }

  /** Chon kieu cho the thu `pos` (luu vao card._type: 'type' | 'swipe').
   *  Chi go nhung tu da gap (da hoc, hoac vua gap lai trong luot); xen ke ngau nhien,
   *  khong de qua 2 the cung kieu lien nhau. */
  function decide(list, pos, enabled) {
    const c = list[pos];
    if (!c || c._type) return;
    if (!enabled || !eligible(c) || !(c.level >= 1 || c._again)) { c._type = 'swipe'; return; }
    const prev = list.slice(Math.max(0, pos - 2), pos).map(x => x._type);
    if (prev.length === 2 && prev[0] === prev[1]) c._type = prev[0] === 'type' ? 'swipe' : 'type';
    else c._type = Math.random() < 0.5 ? 'type' : 'swipe';
  }

  /** term -> cac tu; moi tu la day {ch, k}: k = so thu tu chu cai, null voi dau ' - / ( ) */
  function words(term) {
    let k = 0;
    return String(term || '').trim().split(/\s+/).map(w => [...w].map(ch =>
      (/^[a-z]$/.test(fold(ch)) ? { ch, k: k++ } : { ch, k: null })));
  }

  /** Chu goi y: luon co chu dau, tu 6 chu cai tro len them mot chu ngau nhien (giu nguyen khi hoan tac) */
  function hints(card, n) {
    if (!card._hint) {
      const h = [0];
      if (n >= 6) h.push(1 + Math.floor(Math.random() * (n - 1)));
      card._hint = h;
    }
    return new Set(card._hint);
  }

  /** Mat truoc cua the go. `tags`: hang nhan cap do... cua app (dat o goc tren). */
  function html(card, tags) {
    const ws = words(card.term);
    const n = letters(card.term).length;
    const hs = hints(card, n);
    const longest = Math.max(...ws.map(w => w.length));
    const size = longest > 12 ? ' xs' : longest > 9 ? ' sm' : '';
    const vi = String(card.meaning_vi || '');
    let h = (tags || '') + '<div class="ty">';
    h += '<div class="ty-label">⌨ Gõ từ tiếng Anh</div>';
    h += '<div class="ty-vi' + (vi.length > 42 ? ' long' : '') + '">' + esc(vi) + '</div>';
    h += '<div class="ty-box"><div class="ty-slots' + size + '">' + ws.map(w => '<span class="ty-w">' + w.map(x => {
      if (x.k == null) return '<b class="ty-p">' + esc(x.ch) + '</b>';
      const hint = hs.has(x.k) ? x.ch.toLowerCase() : '';
      return '<i class="ty-s' + (hint ? ' hint' : '') + '" data-h="' + esc(hint) + '">' + esc(hint) + '</i>';
    }).join('') + '</span>').join('') + '</div>';
    h += '<input class="ty-in" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" ' +
         'enterkeyhint="done" aria-label="Gõ từ tiếng Anh có nghĩa này" /></div>';
    h += '<div class="ty-res"></div>';
    h += '<div class="ty-btns"><button type="button" data-ty="skip">Không nhớ</button>' +
         '<button type="button" class="primary" data-ty="check">Kiểm tra</button></div>';
    h += '<div class="ty-tip">' + n + ' chữ cái' + (ws.length > 1 ? ' · ' + ws.length + ' từ' : '') +
         (touch() ? ' · chạm vào các ô để gõ' : ' · gõ cả chữ gợi ý, Enter để kiểm tra') + '</div>';
    return h + '</div>';
  }

  /** Bo chu cai thua: chi giu `n` chu cai dau (dau cach / dau cau van giu) */
  function cut(v, n) {
    let k = 0, out = '';
    for (const ch of v) {
      if (/^[a-z]$/.test(fold(ch))) { if (k === n) break; k++; }
      out += ch;
    }
    return out;
  }

  /** Can chu da go `t` voi dap an `a` (khoang cach Damerau: go thieu / thua / sai / dao hai chu).
   *  -> {dist, marks}: marks[j] cho chu thu j cua dap an: {st: ok|bad|miss, ch: chu da go, ins: go thua truoc o nay} */
  function align(t, a) {
    const n = t.length, m = a.length;
    const D = [];
    for (let i = 0; i <= n; i++) { D.push(new Array(m + 1).fill(0)); D[i][0] = i; }
    for (let j = 0; j <= m; j++) D[0][j] = j;
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (t[i - 1] === a[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && t[i - 1] === a[j - 2] && t[i - 2] === a[j - 1]) D[i][j] = Math.min(D[i][j], D[i - 2][j - 2] + 1);
      }
    }
    const marks = [...a].map(() => ({ st: 'miss', ch: '' }));
    let i = n, j = m;
    // Lan nguoc; cung so loi thi uu tien chi ra "thieu / thua mot chu" hon la "sai lien hai chu" (taxk ~ take)
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && t[i - 1] === a[j - 1] && D[i][j] === D[i - 1][j - 1]) {
        marks[j - 1] = { st: 'ok', ch: t[i - 1] };
        i--; j--;
      } else if (i > 1 && j > 1 && t[i - 1] === a[j - 2] && t[i - 2] === a[j - 1] && D[i][j] === D[i - 2][j - 2] + 1) {
        marks[j - 1] = { st: 'bad', ch: t[i - 1] };      // dao hai chu
        marks[j - 2] = { st: 'bad', ch: t[i - 2] };
        i -= 2; j -= 2;
      } else if (j > 0 && D[i][j] === D[i][j - 1] + 1) {
        marks[j - 1] = { st: 'miss', ch: '' };            // thieu chu
        j--;
      } else if (i > 0 && D[i][j] === D[i - 1][j] + 1) {
        if (j < m) marks[j].ins = true;                   // thua chu, nam truoc o j
        else if (m) marks[m - 1].insEnd = true;
        i--;
      } else {
        marks[j - 1] = { st: 'bad', ch: t[i - 1] };       // sai chu
        i--; j--;
      }
    }
    return { dist: D[n][m], marks };
  }

  /** Gan hanh vi cho the go dang o tren cung.
   *  opts: { done(grade), result(grade), accent } - done: bam Tiep; result: vua cham xong (de doc tu) */
  function mount(el, card, opts) {
    opts = opts || {};
    const box = el.querySelector('.ty');
    const inp = box.querySelector('.ty-in');
    const slots = [...box.querySelectorAll('.ty-s')];
    const ans = letters(card.term);
    // Moi tu cua dap an: o dau tien va so o
    const groups = words(card.term).map(w => w.filter(x => x.k != null).map(x => x.k))
      .filter(ks => ks.length).map(ks => ({ start: ks[0], len: ks.length }));
    let result = null;

    const typed = () => letters(inp.value);
    const toEnd = () => { try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) {} };

    /** Chu da go -> tung o. Khong go dau cach: dien lien mot mach. Co dau cach: moi tu vao dung nhom cua no
     *  (go thieu mot chu o tu dau thi tu sau khong bi lech). -> {cells, cur} */
    function fill() {
      const v = fold(inp.value).replace(/^\s+/, '');
      const cells = new Array(ans.length).fill('');
      if (!/\s/.test(v) || groups.length < 2) {
        const t = letters(v);
        for (let i = 0; i < Math.min(t.length, cells.length); i++) cells[i] = t[i];
        return { cells, cur: t.length };
      }
      const tw = v.split(/\s+/);
      groups.forEach((g, w) => {
        const t = letters(tw[w] || '');
        for (let i = 0; i < Math.min(t.length, g.len); i++) cells[g.start + i] = t[i];
      });
      const last = tw.length - 1;
      const g = groups[last];
      return { cells, cur: g ? g.start + Math.min(letters(tw[last]).length, g.len) : ans.length };
    }

    function paint() {
      if (result) return;
      const { cells, cur } = fill();
      const focused = document.activeElement === inp;
      slots.forEach((s, i) => {
        s.textContent = cells[i] || s.dataset.h || '';
        s.classList.toggle('on', !!cells[i]);
        s.classList.toggle('cur', focused && i === cur);
      });
    }

    function check(giveUp) {
      if (result) return;
      const t = giveUp ? '' : typed();
      const al = align(t, ans);
      const grade = !t ? 'unknown' : al.dist === 0 ? 'know' : al.dist === 1 && ans.length >= 5 ? 'vague' : 'unknown';
      result = { grade };
      inp.readOnly = true;
      el.classList.add('ty-done', 'ty-' + grade);
      slots.forEach((s, i) => {
        const m = al.marks[i];
        s.textContent = m.ch;
        s.className = 'ty-s ' + m.st + (m.ins ? ' ins' : '') + (m.insEnd ? ' ins-end' : '');
      });
      // Dap an dung: to dam nhung chu go sai / thieu
      let k = 0;
      const answer = [...String(card.term)].map(ch => {
        if (!/^[a-z]$/.test(fold(ch))) return esc(ch);
        const m = al.marks[k++];
        return m && m.st !== 'ok' ? '<u>' + esc(ch) + '</u>' : esc(ch);
      }).join('');
      const v = giveUp || !t ? 'skip' : grade;
      box.querySelector('.ty-res').innerHTML = '<div class="ty-verdict ' + v + '">' + VERDICT[v] + '</div>' +
        '<div class="ty-ans">' + answer + '<button type="button" class="spk" data-say="' + esc(opts.accent || '') + '" title="Nghe">🔊</button></div>' +
        (card.ipa_uk || card.ipa_us ? '<div class="ty-ipa">' + esc(card.ipa_uk || card.ipa_us) + '</div>' : '');
      box.querySelector('.ty-btns').innerHTML = '<button type="button" data-ty="flip">Xem thẻ</button>' +
        '<button type="button" class="primary" data-ty="next">Tiếp →</button>';
      box.querySelector('.ty-tip').textContent = touch() ? 'Bấm Tiếp để sang thẻ sau' : 'Enter để sang thẻ sau';
      if (opts.result) opts.result(grade);
    }

    function next() {
      if (!result) return;
      inp.blur();
      if (opts.done) opts.done(result.grade);
    }

    const enter = () => (result ? next() : check(false));

    inp.addEventListener('input', () => {
      if (result) return;
      // Go lien khong dau cach: khong cho qua so o (go dau cach thi de nguyen, cham se bao chu thua)
      if (!/\s/.test(inp.value.trim()) && letters(inp.value).length > ans.length) inp.value = cut(inp.value, ans.length);
      paint();
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); enter(); return; }
      // Chu go an duoi cac o: con tro luon o cuoi
      if (/^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End)$/.test(e.key)) e.preventDefault();
    });
    ['focus', 'click'].forEach(t => inp.addEventListener(t, () => { setTimeout(toEnd, 0); paint(); }));
    inp.addEventListener('blur', paint);
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ty]');
      if (!b) return;
      e.stopPropagation();
      const a = b.dataset.ty;
      if (a === 'check') check(false);
      else if (a === 'skip') check(true);
      else if (a === 'next') next();
      else if (a === 'flip') el.classList.toggle('flipped');
    });

    el._ty = { enter, focus: () => { if (!result) inp.focus(); } };
    paint();
    // May tinh: go ngay. iPhone chi mo ban phim khi cham vao o.
    if (!touch()) setTimeout(() => { if (el.isConnected && !result) inp.focus({ preventScroll: true }); }, 60);
  }

  return { eligible, decide, html, mount, align };
})();
