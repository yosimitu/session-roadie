// 予定表HTMLに埋め込むブラウザ側のスクリプト（セッション一覧・全体像・メモ候補・日本語訳）。
// String.raw で埋め込むため、この中ではバッククォート・"${"・"\u" を使わない（文字列連結で書く）。
// データは <script type="application/json" id="ri-data"> から読む。外部への通信は行わない
// （翻訳は Chrome 内蔵の Translator API でブラウザ内で行う。Google 翻訳はリンクを開くだけ）。
//
// ブラウザへの保存キーは 'roadie26_' で始める（別のカタログHTMLと同じキーを使うと、file:// で開いたときに混ざる）。
//
// 画面に出す文字列は、カタログ由来のものをすべて esc() を通してから HTML にする。
// 数値（分・件数）と、このスクリプト自身が持つ固定の文言だけは、そのまま連結してよい。
export const CLIENT_SCRIPT = String.raw`
(function () {
  'use strict';
  var raw = JSON.parse(document.getElementById('ri-data').textContent);
  var DATA = raw.data, JA = raw.ja, META = raw.meta, L = raw.ui, ST = raw.st;
  var LS = 'roadie26_';
  function lsGet(k, d) { try { var v = localStorage.getItem(LS + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} }
  function $(id) { return document.getElementById(id); }
  function fmt(t) { var a = arguments; return t.replace(/\{(\d)\}/g, function (m, i) { return a[+i + 1]; }); }
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
  function ja(v) { return JA[v] || v; }
  function dayLabel(d) { if (!d) return L.dayTbd; var x = new Date(d + 'T12:00:00'); return fmt(L.dayFormat, x.getMonth() + 1, x.getDate(), L.weekdays[x.getDay()]); }
  function band(t) { if (!t) return L.timeBands[5]; var h = +t.split(':')[0]; return h < 10 ? L.timeBands[0] : h < 12 ? L.timeBands[1] : h < 14 ? L.timeBands[2] : h < 17 ? L.timeBands[3] : L.timeBands[4]; }
  function hhmm(min) { return String(Math.floor(min / 60) % 24).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); }

  var DIMS = [
    { k: 'ss', l: L.dims[0], open: 1 }, { k: 'dt', l: L.dims[1], open: 1 }, { k: 'ty', l: L.dims[2], open: 1 },
    { k: 'lv', l: L.dims[3] }, { k: 'rl', l: L.dims[4] }, { k: 'tp', l: L.dims[5] }, { k: 'ar', l: L.dims[6] },
    { k: 'in', l: L.dims[7] }, { k: 'sv', l: L.dims[8], search: 1 }, { k: 'ft', l: L.dims[9] },
    { k: 've', l: L.dims[10] }, { k: 'tb', l: L.dims[11] }
  ];
  var ORDER = {
    lv: ['100 - Foundational', '200 - Intermediate', '300 - Advanced', '400 - Expert', '500 - Distinguished', 'No Level'],
    tb: L.timeBands,
    ss: [ST.reserved, ST.favorite, ST.isNew, ST.recommend, ST.open, ST.full, ST.walkUp]
  };
  var STATUS_CLASS = {};
  STATUS_CLASS[ST.reserved] = 'rs'; STATUS_CLASS[ST.favorite] = 'fv'; STATUS_CLASS[ST.isNew] = 'nw'; STATUS_CLASS[ST.recommend] = 'rc';
  STATUS_CLASS[ST.open] = 'op'; STATUS_CLASS[ST.full] = 'fl'; STATUS_CLASS[ST.walkUp] = 'wu';

  var byId = {};
  DATA.forEach(function (s) {
    byId[s.id] = s;
    s.tb = band(s.tm);
    s.st = s.tm ? (+s.tm.slice(0, 2)) * 60 + (+s.tm.slice(3, 5)) : null;
    s.q = (s.c + ' ' + s.t + ' ' + s.a + ' ' + s.sp.join(' ') + ' ' + s.sv.join(' ')).toLowerCase();
  });
  function vals(s, k) { var v = s[k]; if (Array.isArray(v)) return v; if (v === '' && k !== 've' && k !== 'dt') return []; return [v]; }
  function label(k, v) { return k === 'dt' ? dayLabel(v) : k === 've' ? (v || L.venueTbd) : k === 'ss' ? v : ja(v); }
  function statusTags(s) { return s.ss.map(function (x) { return '<span class="tag st-' + (STATUS_CLASS[x] || 'op') + '">' + esc(x) + '</span>'; }).join(''); }

  var sel = {}; DIMS.forEach(function (d) { sel[d.k] = new Set(); });
  var q = '', memoOnly = false, sortBy = 'time', shown = 60, expandAll = false;
  var memo = new Set(lsGet('memo', []));
  var TR = lsGet('tr', {});
  var current = [];

  var OPTS = {};
  DIMS.forEach(function (d) {
    var c = {};
    DATA.forEach(function (s) { vals(s, d.k).forEach(function (v) { c[v] = (c[v] || 0) + 1; }); });
    var ks = Object.keys(c);
    if (ORDER[d.k]) ks = ORDER[d.k].filter(function (x) { return c[x]; });
    else if (d.k === 'dt') ks.sort(function (a, b) { return (a || '9').localeCompare(b || '9'); });
    else ks.sort(function (a, b) { return c[b] - c[a]; });
    OPTS[d.k] = ks;
  });

  function match(s, skip) {
    if (memoOnly && !memo.has(s.id)) return false;
    if (q) {
      var words = q.split(/\s+/);
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        if (w && s.q.indexOf(w) < 0 && !(TR[s.id] && TR[s.id].t && TR[s.id].t.indexOf(w) >= 0)) return false;
      }
    }
    for (var j = 0; j < DIMS.length; j++) {
      var d = DIMS[j];
      if (d.k === skip) continue;
      var S = sel[d.k];
      if (!S.size) continue;
      if (!vals(s, d.k).some(function (v) { return S.has(v); })) return false;
    }
    return true;
  }

  function buildFilters() {
    var el = $('filters');
    el.innerHTML = DIMS.map(function (d) {
      var opts = OPTS[d.k].map(function (v) {
        var text = label(d.k, v);
        var en = (d.k !== 'ss' && d.k !== 'dt' && d.k !== 've' && JA[v] && JA[v] !== v) ? '<span class="en">' + esc(v) + '</span>' : '';
        return '<label class="opt" data-v="' + esc(v) + '"><input type="checkbox" value="' + esc(v) + '"><span>' + esc(text) + en + '</span><span class="n"></span></label>';
      }).join('');
      return '<details class="f" data-k="' + d.k + '"' + (d.open ? ' open' : '') + '><summary><span>' + d.l + '<span class="badge hidden"></span></span></summary>'
        + (d.search ? '<input class="mini" placeholder="' + esc(L.servicePlaceholder) + '" aria-label="' + esc(L.serviceAria) + '">' : '')
        + '<div class="opts">' + opts + '</div></details>';
    }).join('');
    el.querySelectorAll('details').forEach(function (det) {
      var k = det.dataset.k;
      det.addEventListener('change', function (e) {
        if (e.target.type !== 'checkbox') return;
        if (e.target.checked) sel[k].add(e.target.value); else sel[k].delete(e.target.value);
        shown = 60; update();
      });
      var m = det.querySelector('.mini');
      if (m) m.addEventListener('input', function () {
        var t = m.value.toLowerCase();
        det.querySelectorAll('.opt').forEach(function (o) { o.classList.toggle('hidden', o.dataset.v.toLowerCase().indexOf(t) < 0); });
      });
    });
  }

  function updateCounts() {
    DIMS.forEach(function (d) {
      var c = {};
      DATA.forEach(function (s) { if (match(s, d.k)) vals(s, d.k).forEach(function (v) { c[v] = (c[v] || 0) + 1; }); });
      var det = document.querySelector('details[data-k="' + d.k + '"]');
      det.querySelectorAll('.opt').forEach(function (o) {
        var n = c[o.dataset.v] || 0;
        o.querySelector('.n').textContent = n;
        o.classList.toggle('zero', !n);
        o.querySelector('input').checked = sel[d.k].has(o.dataset.v);
      });
      var b = det.querySelector('.badge');
      b.textContent = sel[d.k].size;
      b.classList.toggle('hidden', !sel[d.k].size);
    });
  }

  function lvOrder(k) { return parseInt(k, 10) || 999; }
  function update() {
    current = DATA.filter(function (s) { return match(s); });
    current.sort(sortBy === 'rec'
      ? function (a, b) { return (b.rc || 0) - (a.rc || 0) || (a.dt || '9').localeCompare(b.dt || '9') || (a.tm || '99').localeCompare(b.tm || '99'); }
      : sortBy === 'code'
      ? function (a, b) { return a.c.localeCompare(b.c); }
      : sortBy === 'level'
        ? function (a, b) { return lvOrder(a.lv) - lvOrder(b.lv) || a.c.localeCompare(b.c); }
        : function (a, b) { return (a.dt || '9').localeCompare(b.dt || '9') || (a.tm || '99').localeCompare(b.tm || '99') || a.c.localeCompare(b.c); });
    $('count').textContent = fmt(L.count, current.length.toLocaleString());
    updateCounts(); renderChips(); renderList();
    $('memon').textContent = memo.size ? '(' + memo.size + ')' : '';
  }

  function renderChips() {
    var c = [];
    DIMS.forEach(function (d) {
      sel[d.k].forEach(function (v) { c.push('<button class="chip" data-k="' + d.k + '" data-v="' + esc(v) + '">' + esc(d.l) + ': ' + esc(label(d.k, v)) + ' ✕</button>'); });
    });
    $('chips').innerHTML = c.join('');
  }
  $('chips').addEventListener('click', function (e) {
    var b = e.target.closest('.chip'); if (!b) return;
    sel[b.dataset.k].delete(b.dataset.v); update();
  });

  function card(s) {
    var tr = TR[s.id] || {};
    var time = s.dt ? dayLabel(s.dt) + ' ' + esc(s.tm || '') + (s.ln ? esc(fmt(L.minutes, Number(s.ln))) : '') : esc(L.dayTbd);
    var title = tr.t ? '<span class="ja">' + esc(tr.t) + '</span><span class="orig">' + esc(s.t) + '</span>' : esc(s.t);
    var g = 'https://translate.google.com/?sl=en&tl=ja&op=translate&text=' + encodeURIComponent(s.t + '\n\n' + s.a.slice(0, 1800));
    var isMemo = memo.has(s.id);
    var extra = '';
    if (s.ar.length) extra += '<p class="note">' + esc(L.labelAreas) + ': ' + s.ar.map(ja).map(esc).join(' / ') + '</p>';
    if (s.sv.length) extra += '<p class="note">' + esc(L.labelServices) + ': ' + s.sv.map(esc).join(' / ') + '</p>';
    if (s.in.length) extra += '<p class="note">' + esc(L.labelIndustries) + ': ' + s.in.map(ja).map(esc).join(' / ') + '</p>';
    if (s.ft.length) extra += '<p class="note">' + esc(L.labelFeatures) + ': ' + s.ft.map(ja).map(esc).join(' / ') + '</p>';
    return '<article class="card' + (expandAll ? ' open' : '') + (s.ss.indexOf(ST.reserved) >= 0 ? ' is-reserved' : '') + '" data-id="' + esc(s.id) + '">'
      + '<div class="row1"><span class="code">' + esc(s.c) + '</span><h2 class="title">' + title + '</h2>'
      + '<button class="star' + (isMemo ? ' on' : '') + '" aria-label="' + esc(L.starAria) + '" title="' + esc(L.starTitle) + '">' + (isMemo ? '★' : '☆') + '</button></div>'
      + '<div class="meta"><span>🕒 ' + time + '</span><span>📍 ' + esc(s.ve || L.venueTbd) + (s.rm ? ' / ' + esc(s.rm) : '') + '</span>' + (s.sp.length ? '<span>🎤 ' + esc(s.sp.join(', ')) + '</span>' : '') + '</div>'
      + '<div class="tags">' + statusTags(s) + '<span class="tag ty">' + esc(ja(s.ty)) + '</span>' + (s.lv ? '<span class="tag lv">' + esc(ja(s.lv)) + '</span>' : '')
      + s.tp.map(function (x) { return '<span class="tag">' + esc(ja(x)) + '</span>'; }).join('')
      + s.rl.map(function (x) { return '<span class="tag rl">' + esc(ja(x)) + '</span>'; }).join('') + '</div>'
      + (s.rc ? '<div class="rec"><b>' + esc(fmt(L.recScore, Number(s.rc))) + '</b>' + esc(fmt(L.recWhy, (s.rw || []).join(' / '))) + '</div>' : '')
      + '<div class="abs">' + (L.tr && tr.a ? '<p class="lbl">' + esc(L.tr.absLabel) + '</p><p class="jaabs">' + esc(tr.a) + '</p>' : '')
      + '<p class="lbl">' + esc(L.abstractLabel) + '</p><p>' + esc(s.a) + '</p>' + extra
      + (L.tr ? '<div class="acts">' + (tr.a ? '' : '<button class="btn trOne">' + esc(L.tr.one) + '</button>')
        + '<a class="btn" href="' + esc(g) + '" target="_blank" rel="noopener" style="text-decoration:none">' + esc(L.tr.google) + '</a></div>' : '')
      + '</div></article>';
  }

  function renderList() {
    $('list').innerHTML = current.length
      ? current.slice(0, shown).map(card).join('')
      : '<div class="empty">' + esc(L.emptyList) + '</div>';
    var m = $('moreBtn');
    m.classList.toggle('hidden', current.length <= shown);
    m.textContent = fmt(L.moreButton, Math.max(0, current.length - shown));
  }

  $('list').addEventListener('click', function (e) {
    var c = e.target.closest('.card'); if (!c) return;
    var s = byId[c.dataset.id];
    if (e.target.closest('.star')) {
      if (memo.has(s.id)) memo.delete(s.id); else memo.add(s.id);
      lsSet('memo', Array.from(memo));
      var b = e.target.closest('.star');
      b.classList.toggle('on'); b.textContent = memo.has(s.id) ? '★' : '☆';
      $('memon').textContent = memo.size ? '(' + memo.size + ')' : '';
      renderSchedMemo();
      return;
    }
    if (e.target.closest('.trOne')) {
      translate([s], true).then(function () {
        c.outerHTML = card(s);
        var n = document.querySelector('.card[data-id="' + CSS.escape(s.id) + '"]'); if (n) n.classList.add('open');
      });
      return;
    }
    if (e.target.closest('a')) return;
    c.classList.toggle('open');
  });

  // 日本語訳: Chrome 内蔵の Translator API（ブラウザ内で完結）
  var T = L.tr, translator = null;
  function status(t) { $('trStatus').textContent = t; }
  function getTranslator() {
    if (translator) return Promise.resolve(translator);
    if (!('Translator' in self)) { status(T.noApi); return Promise.resolve(null); }
    return Translator.availability({ sourceLanguage: 'en', targetLanguage: 'ja' }).then(function (av) {
      if (av === 'unavailable') { status(T.unavailable); return null; }
      status(T.preparing);
      return Translator.create({ sourceLanguage: 'en', targetLanguage: 'ja', monitor: function (m) { m.addEventListener('downloadprogress', function (e) { status(fmt(T.downloading, Math.round(e.loaded * 100))); }); } })
        .then(function (t) { translator = t; return t; });
    }).catch(function (err) { status(fmt(T.failed, err.message)); return null; });
  }
  function translate(list, withAbs) {
    return getTranslator().then(function (tr) {
      if (!tr) return;
      var n = 0;
      var chain = Promise.resolve();
      list.forEach(function (s) {
        chain = chain.then(function () {
          var o = TR[s.id] || {};
          return Promise.resolve(o.t ? o.t : tr.translate(s.t)).then(function (t) { o.t = t; return withAbs && !o.a ? tr.translate(s.a) : o.a; })
            .then(function (a) { if (a) o.a = a; TR[s.id] = o; n++; if (list.length > 1) status(fmt(T.progress, n, list.length)); });
        });
      });
      return chain.then(function () { lsSet('tr', TR); status(fmt(T.done, n)); })
        .catch(function (e) { lsSet('tr', TR); status(fmt(T.error, e.message)); });
    });
  }
  if (T) $('trBulk').onclick = function () { translate(current.slice(0, shown), true).then(function () { renderList(); renderSchedMemo(); }); };
  $('moreBtn').onclick = function () { shown += 60; renderList(); };
  $('expandAll').onclick = function (e) { expandAll = !expandAll; e.target.textContent = expandAll ? L.collapseAll : L.expandAll; renderList(); };
  var qt; $('q').addEventListener('input', function (e) { clearTimeout(qt); qt = setTimeout(function () { q = e.target.value.trim().toLowerCase(); shown = 60; update(); }, 200); });
  $('memoOnly').onchange = function (e) { memoOnly = e.target.checked; update(); };
  $('sort').onchange = function (e) { sortBy = e.target.value; update(); };
  $('clear').onclick = function () {
    DIMS.forEach(function (d) { sel[d.k].clear(); });
    q = ''; $('q').value = ''; memoOnly = false; $('memoOnly').checked = false; update();
  };

  // 上部の統計
  (function () {
    function n(label) { return DATA.filter(function (s) { return s.ss.indexOf(label) >= 0; }).length; }
    var days = OPTS.dt.filter(Boolean).length;
    var st = [[L.stats[0], DATA.length], [L.stats[1], n(ST.reserved)], [L.stats[2], n(ST.favorite)],
      [L.stats[3], n(ST.isNew)], [L.stats[4], fmt(L.daysCount, days)], [L.stats[5], OPTS.ve.filter(Boolean).length]];
    $('stats').innerHTML = st.map(function (x) {
      return '<div class="stat"><b>' + (typeof x[1] === 'number' ? x[1].toLocaleString() : esc(x[1])) + '</b><span>' + esc(x[0]) + '</span></div>';
    }).join('');
    $('newNote').textContent = META.newBaseline
      ? fmt(L.newNote, META.newBaseline)
      : L.newNoteNone;
  })();

  // おすすめの基準（トピックの重みの出どころと、点数の配分）
  function renderRecipe() {
    var el = $('recipe');
    var R = META.recipe || [];
    var src = { priority: function (r) { return fmt(L.recipePriority, Number(r.r)); }, favorites: function () { return L.recipeFavorites; }, interest: function () { return L.recipeInterest; } };
    el.innerHTML = '<summary>' + esc(L.recipeSummary) + '</summary>'
      + (R.length
        ? '<ul>' + R.map(function (r) {
          var how = src[r.s] ? src[r.s](r) : '';
          return '<li>' + esc(ja(r.t)) + ' … ' + esc(fmt(L.recipeWeight, Number(r.w).toFixed(2))) + ' <span class="src">(' + esc(how) + ')</span></li>';
        }).join('') + '</ul>'
        : '<p class="note">' + esc(L.recipeNone) + '</p>')
      + '<p class="note">' + esc(fmt(L.recipePoints, Number(META.threshold || 60))) + '</p>'
      + '<p class="note">' + esc(L.recipeExcluded) + '</p>'
      + '<p class="note">' + esc(L.recipeBasis) + '</p>';
  }

  // 全体像
  function renderOv() {
    var P = [['dt', L.overview[0]], ['ty', L.overview[1]], ['rl', L.overview[2]], ['tp', L.overview[3]], ['lv', L.overview[4]], ['ve', L.overview[5]], ['ar', L.overview[6]], ['sv', L.overview[7]]];
    $('ov').innerHTML = P.map(function (p) {
      var k = p[0], c = {};
      DATA.forEach(function (s) { vals(s, k).forEach(function (v) { c[v] = (c[v] || 0) + 1; }); });
      var ks = OPTS[k].slice(0, 15);
      var mx = Math.max.apply(null, ks.map(function (x) { return c[x]; }).concat([1]));
      return '<div class="panel"><h3>' + p[1] + '</h3>' + ks.map(function (v) {
        return '<div class="bar" data-k="' + k + '" data-v="' + esc(v) + '" title="' + esc(v) + '"><span class="lab">' + esc(label(k, v)) + '</span><span class="tr"><span class="fl" style="display:block;width:' + Number(c[v] / mx * 100) + '%"></span></span><span class="v">' + Number(c[v]) + '</span></div>';
      }).join('') + '</div>';
    }).join('');
  }
  $('ov').addEventListener('click', function (e) {
    var b = e.target.closest('.bar'); if (!b) return;
    DIMS.forEach(function (d) { sel[d.k].clear(); });
    sel[b.dataset.k].add(b.dataset.v); show('list'); update();
  });

  // メモ候補（このブラウザだけ。公式の予定は変わらない）
  function renderMemo() {
    var list = Array.from(memo).map(function (id) { return byId[id]; }).filter(Boolean)
      .sort(function (a, b) { return (a.dt || '9').localeCompare(b.dt || '9') || (a.tm || '').localeCompare(b.tm || ''); });
    $('memoCount').textContent = fmt(L.memoCount, list.length);
    if (!list.length) { $('memoPlan').innerHTML = '<div class="empty">' + esc(L.memoEmpty) + '</div>'; return; }
    var cf = new Set();
    for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) {
      var a = list[i], b = list[j];
      if (a.dt && a.dt === b.dt && a.st != null && b.st != null && a.st < b.st + b.ln && b.st < a.st + a.ln) { cf.add(a.id); cf.add(b.id); }
    }
    var g = {};
    list.forEach(function (s) { (g[s.dt] = g[s.dt] || []).push(s); });
    $('memoPlan').innerHTML = Object.keys(g).map(function (d) {
      return '<section class="mday"><h3>' + dayLabel(d) + esc(fmt(L.memoDayCount, g[d].length)) + '</h3>' + g[d].map(function (s) {
        var end = s.st != null ? hhmm(s.st + s.ln) : '';
        var tr = TR[s.id];
        return '<div class="slot' + (cf.has(s.id) ? ' cf' : '') + '"><div><b>' + esc(s.tm || L.memoTbd) + '</b>' + (end ? '〜' + end : '') + (cf.has(s.id) ? '<div class="warn">' + esc(L.memoConflict) + '</div>' : '') + '</div>'
          + '<div><button class="mstar" data-id="' + esc(s.id) + '" title="' + esc(L.memoRemove) + '" aria-label="' + esc(L.memoRemove) + '">★</button>'
          + '<span class="code">' + esc(s.c) + '</span> ' + esc(tr && tr.t ? tr.t : s.t) + ' ' + statusTags(s)
          + '<div class="note">' + esc(ja(s.ty)) + esc(L.dot) + esc(s.ve || '') + ' ' + esc(s.rm || '') + ' <button class="linkbtn" data-jump="' + esc(s.id) + '">' + esc(L.memoJump) + '</button></div></div></div>';
      }).join('') + '</section>';
    }).join('');
  }
  $('csv').onclick = function () {
    var list = Array.from(memo).map(function (id) { return byId[id]; }).filter(Boolean);
    function qq(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
    var rows = list.map(function (s) { return [s.c, s.t, (TR[s.id] || {}).t || '', s.dt, s.tm, s.ln, s.ve, s.rm, ja(s.ty), ja(s.lv), s.rl.map(ja).join(' / '), s.sp.join(', ')].map(qq).join(','); });
    var blob = new Blob([String.fromCharCode(65279) + [L.csvHeader.map(qq).join(',')].concat(rows).join('\n')], { type: 'text/csv' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = L.csvFilename; a.click();
  };

  // ★メモを「予定」のタイムライン（日別・通しの両方）に重ねる。公式の予定・予約は変えない
  var PX = META.px || 1.2;
  var showMemo = lsGet('showMemo', true);
  $('showMemo').checked = showMemo;
  function overlap(a1, a2, b1, b2) { return a1 < b2 && b1 < a2; }
  function memoTags(s) {
    var tags = [];
    var end = s.st + (s.ln || 30);
    if (s.ss.indexOf(ST.reserved) >= 0) {
      tags.push(['info', L.tagReserved]);
    } else {
      var clash = DATA.filter(function (o) { return o.id !== s.id && o.dt === s.dt && o.st != null && o.ss.indexOf(ST.reserved) >= 0 && overlap(s.st, end, o.st, o.st + (o.ln || 30)); });
      if (clash.length) tags.push(['warn', fmt(L.tagClashReserved, clash.map(function (o) { return o.c; }).join(', '))]);
    }
    (META.personal || []).forEach(function (p) {
      if (p.date === s.dt && overlap(s.st, end, p.start, p.end)) tags.push(['warn', fmt(L.tagClashPersonal, p.title)]);
    });
    return tags;
  }
  function lanesOf(list) {
    var sorted = list.slice().sort(function (a, b) { return a.st - b.st; });
    var placed = [], cluster = [], laneEnds = [], clusterEnd = -1;
    function flush() {
      cluster.forEach(function (p) { p.lanes = laneEnds.length; });
      placed = placed.concat(cluster); cluster = []; laneEnds = [];
    }
    sorted.forEach(function (s) {
      var dispEnd = s.st + Math.max(s.ln || 30, 24);
      if (cluster.length && s.st >= clusterEnd) flush();
      var lane = laneEnds.findIndex(function (e) { return e <= s.st; });
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(dispEnd); } else { laneEnds[lane] = dispEnd; }
      clusterEnd = Math.max(clusterEnd, dispEnd);
      cluster.push({ s: s, lane: lane, lanes: 1 });
    });
    flush();
    return placed;
  }
  function renderSchedMemo() {
    document.body.classList.toggle('show-memo', showMemo);
    var byDate = {};
    memo.forEach(function (id) {
      var s = byId[id];
      if (s && s.dt && s.st != null) (byDate[s.dt] = byDate[s.dt] || []).push(s);
    });
    document.querySelectorAll('.t-memo').forEach(function (box) {
      var list = byDate[box.dataset.date] || [], start = +box.dataset.start;
      var grid = box.parentNode;
      grid.classList.toggle('has-memo', list.length > 0);
      var placed = lanesOf(list);
      var maxLanes = placed.reduce(function (m, p) { return Math.max(m, p.lanes); }, 1);
      // 5日間通しは列が狭いので、★メモが同時に重なる数に応じてメモの列を広げる（最大60%）
      var inWeek = !!box.closest('.w-col');
      grid.style.setProperty('--memo-w', (inWeek ? Math.min(60, 33 + 10 * (maxLanes - 1)) : 33) + '%');
      box.innerHTML = placed.map(function (p) {
        var s = p.s, tr = TR[s.id], w = 100 / p.lanes;
        var compact = p.lanes >= 3;
        var top = Math.max(0, (s.st - start) * PX), height = Math.max(s.ln || 30, 24) * PX;
        var tagList = memoTags(s);
        var tags = compact
          ? '<span class="t-tag memo-tag">★</span>' + tagList.map(function (x) { return '<span class="t-tag ' + x[0] + '" title="' + esc(x[1]) + '">' + (x[0] === 'warn' ? '⚠' : esc(x[1])) + '</span>'; }).join('')
          : '<span class="t-tag memo-tag">' + esc(L.tagMemo) + '</span>' + tagList.map(function (x) { return '<span class="t-tag ' + x[0] + '">' + esc(x[1]) + '</span>'; }).join('');
        var tip = s.c + ' ' + s.t + (tagList.length ? '\n' + tagList.map(function (x) { return x[1]; }).join('\n') : '');
        return '<div class="t-card memo' + (compact ? ' compact' : '') + '" data-id="' + esc(s.id) + '" title="' + esc(tip) + '" style="top:' + top.toFixed(1) + 'px;height:' + height.toFixed(1) + 'px;left:' + (p.lane * w).toFixed(2) + '%;width:' + w.toFixed(2) + '%">'
          + '<button class="mstar" data-id="' + esc(s.id) + '" title="' + esc(L.memoRemove) + '" aria-label="' + esc(L.memoRemove) + '">★</button>'
          + '<div class="t-time">' + hhmm(s.st) + '–' + hhmm(s.st + (s.ln || 30)) + '</div>'
          + '<div class="t-tags">' + tags + '</div>'
          + '<div class="t-ttl"><span class="t-abbr">' + esc(s.c) + '</span> ' + esc(tr && tr.t ? tr.t : s.t) + '</div>'
          + '<div class="t-meta">' + esc(s.ve || '') + '</div></div>';
      }).join('');
    });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.mstar') : null;
    if (!b) return;
    memo.delete(b.dataset.id); lsSet('memo', Array.from(memo)); renderSchedMemo(); renderMemo(); update();
  });

  // 予定のカード・メモ候補から、セッション一覧の詳細へ移動する。
  // 一覧の条件（検索・絞り込み・メモのみ）はいったん解除し、そのセッションのコードで検索した状態にする
  // （再演も同じコードで並ぶ。元に戻すときは「クリア」）
  function jumpToSession(id) {
    var s = byId[id];
    if (!s) return;
    DIMS.forEach(function (d) { sel[d.k].clear(); });
    memoOnly = false; $('memoOnly').checked = false;
    q = s.c.toLowerCase(); $('q').value = s.c; shown = 60;
    show('list'); update();
    var el = document.querySelector('.card[data-id="' + CSS.escape(id) + '"]');
    if (!el) return;
    el.classList.add('open', 'flash');
    el.scrollIntoView({ block: 'center' });
    setTimeout(function () { el.classList.remove('flash'); }, 2500);
  }
  document.addEventListener('click', function (e) {
    if (!e.target.closest || e.target.closest('.mstar')) return;
    var c = e.target.closest('.t-card[data-session], .t-card.memo[data-id]');
    if (c) { jumpToSession(c.dataset.session || c.dataset.id); return; }
    var j = e.target.closest('[data-jump]');
    if (j) jumpToSession(j.dataset.jump);
  });
  var showFav = lsGet('showFav', true);
  $('showFav').checked = showFav;
  document.body.classList.toggle('hide-fav', !showFav);
  $('showFav').onchange = function (e) { showFav = e.target.checked; lsSet('showFav', showFav); document.body.classList.toggle('hide-fav', !showFav); };
  $('showMemo').onchange = function (e) { showMemo = e.target.checked; lsSet('showMemo', showMemo); renderSchedMemo(); };
  document.querySelectorAll('[data-sv]').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('[data-sv]').forEach(function (x) { x.classList.toggle('on', x === b); });
      $('vday').classList.toggle('hidden', b.dataset.sv !== 'day');
      $('vweek').classList.toggle('hidden', b.dataset.sv !== 'week');
    };
  });

  var VIEWS = { sched: 'vsched', list: 'vlist', ov: 'vov', memo: 'vmemo' };
  function show(v) {
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('on', t.dataset.v === v); });
    Object.keys(VIEWS).forEach(function (k) { $(VIEWS[k]).classList.toggle('hidden', k !== v); });
    if (v === 'ov') renderOv();
    if (v === 'memo') renderMemo();
    if (v === 'sched') renderSchedMemo();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.tab').forEach(function (t) { t.onclick = function () { show(t.dataset.v); }; });
  renderRecipe(); buildFilters(); update(); renderSchedMemo();
})();
`;
