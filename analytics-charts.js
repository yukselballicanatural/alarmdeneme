/* ═══════════════════════════════════════════════════════════════════════
   NCCharts — Analitik ekranı için bağımsız SVG grafik katmanı
   ---------------------------------------------------------------------
   Neden ayrı dosya: Analitik iki ayrı yoldan çiziliyor —
   renderSummaryFromRPC() (sunucu özeti) ve _renderSummaryClientSide()
   (49K satır istemcide). Grafik biçimlendirmesi ikisinde de KOPYALANMIŞTI;
   biri güncellenip diğeri atlandığında ekranlar sessizce ayrışıyordu.
   Burası tek kaynak: her iki yol da aynı normalize edilmiş diziyi verip
   aynı çizimi alıyor.

   Hiçbir dış kütüphane yok (CDN'e bağımlılık eklemiyoruz), Canvas yok —
   düz SVG. Böylece cam tema, tema geçişi ve metin seçimi kendiliğinden
   çalışıyor; renkler CSS değişkenlerinden geliyor.
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  // Marka paleti — iki temada da okunur doygunlukta seçildi
  var PALETTE = [
    '#6366f1', '#0d9488', '#f59e0b', '#ec4899', '#38bdf8',
    '#22c55e', '#a855f7', '#ef4444', '#84cc16', '#f97316',
    '#14b8a6', '#8b5cf6',
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function el(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function nfmt(n) {
    return (Number(n) || 0).toLocaleString('tr-TR');
  }
  function pct(part, whole) {
    if (!whole) return '0';
    return (part / whole * 100).toFixed(1);
  }

  /* ── Paylaşılan cam ipucu (tooltip) ─────────────────────────────────
     Tek bir öğe body'de yaşıyor ve position:fixed. Grafiklerin içine
     gömülü bir ipucu kabın overflow'una ve yığın bağlamına takılıyordu
     (export menüsündeki aynı sorun) — body + fixed bundan kurtarıyor. */
  var tip = null;
  function ensureTip() {
    if (tip && tip.isConnected) return tip;
    tip = document.createElement('div');
    tip.className = 'ac-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
    return tip;
  }
  function showTip(html, x, y) {
    var t = ensureTip();
    t.innerHTML = html;
    t.classList.add('ac-tip-on');
    // Ölçüden sonra konumla: imlecin sağ-üstü, ekran dışına taşmadan
    var w = t.offsetWidth, h = t.offsetHeight, M = 10;
    var left = x + 14, top = y - h - 12;
    if (left + w > window.innerWidth - M) left = x - w - 14;
    if (left < M) left = M;
    if (top < M) top = y + 18;
    if (top + h > window.innerHeight - M) top = Math.max(M, window.innerHeight - h - M);
    t.style.left = left + 'px';
    t.style.top = top + 'px';
  }
  function hideTip() {
    if (tip) tip.classList.remove('ac-tip-on');
  }
  // Kaydırma sırasında ipucu havada kalmasın
  window.addEventListener('scroll', hideTip, true);

  // Bir öğeye ipucu bağla (mouse + dokunma + klavye odağı)
  function bindTip(node, htmlFn) {
    node.addEventListener('mousemove', function (e) { showTip(htmlFn(), e.clientX, e.clientY); });
    node.addEventListener('mouseleave', hideTip);
    node.addEventListener('focus', function () {
      var r = node.getBoundingClientRect();
      showTip(htmlFn(), r.left + r.width / 2, r.top);
    });
    node.addEventListener('blur', hideTip);
  }

  /* ── 1. Yatay çubuk listesi (Ödeme / Stage / Bölge) ─────────────────
     items: [{ label, value, color? }]  — sıralama ÇAĞIRANA ait değil,
     burada yapılır ki üç grafik de aynı davranışı göstersin. */
  function bars(host, items, opts) {
    if (!host) return;
    opts = opts || {};
    host.innerHTML = '';
    items = (items || []).filter(function (i) { return i && (Number(i.value) || 0) > 0; })
      .sort(function (a, b) { return b.value - a.value; });
    if (!items.length) { host.appendChild(emptyNote(opts.emptyText)); return; }

    var total = items.reduce(function (s, i) { return s + i.value; }, 0);
    var max = items[0].value || 1;
    var wrap = document.createElement('div');
    wrap.className = 'ac-bars';

    items.forEach(function (it, i) {
      var row = document.createElement('div');
      row.className = 'ac-bar-row';
      row.tabIndex = 0;
      var color = it.color || PALETTE[i % PALETTE.length];
      row.innerHTML =
        '<div class="ac-bar-head">' +
          '<span class="ac-bar-label">' + esc(it.label) + '</span>' +
          '<span class="ac-bar-val"><b>' + nfmt(it.value) + '</b>' +
          '<i class="ac-bar-pct">' + pct(it.value, total) + '%</i></span>' +
        '</div>' +
        '<div class="ac-bar-track"><div class="ac-bar-fill"></div></div>';
      var fill = row.querySelector('.ac-bar-fill');
      fill.style.background = 'linear-gradient(90deg,' + color + ' 0%,' + mix(color) + ' 100%)';
      // Genişlik bir sonraki karede atanır: 0'dan büyümesi animasyonu tetikler
      requestAnimationFrame(function () {
        fill.style.width = Math.max(2, it.value / max * 100).toFixed(1) + '%';
      });
      bindTip(row, function () {
        return '<b>' + esc(it.label) + '</b><br>' + nfmt(it.value) + ' deal · ' +
               pct(it.value, total) + '%';
      });
      wrap.appendChild(row);
    });
    host.appendChild(wrap);
  }

  // Rengin daha açık bir tonu — degrade için (hex→rgb, beyaza %28 karışım)
  function mix(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return hex;
    var f = function (h) { return Math.round(parseInt(h, 16) + (255 - parseInt(h, 16)) * 0.28); };
    return 'rgb(' + f(m[1]) + ',' + f(m[2]) + ',' + f(m[3]) + ')';
  }

  function emptyNote(text) {
    var d = document.createElement('div');
    d.className = 'ac-empty';
    d.textContent = text || 'Veri yok.';
    return d;
  }

  /* ── 2. Halka (donut) — Dil Dağılımı ────────────────────────────────
     Eski hali her dil için bir kutucuktu: 15+ dilde ekranı kaplayan,
     oranı hiç göstermeyen bir ızgara çıkıyordu. Halka payı tek bakışta
     verir; küçük diller "Diğer"de toplanır ve ipucunda dökümü görünür. */
  function donut(host, items, opts) {
    if (!host) return;
    opts = opts || {};
    host.innerHTML = '';
    items = (items || []).filter(function (i) { return i && (Number(i.value) || 0) > 0; })
      .sort(function (a, b) { return b.value - a.value; });
    if (!items.length) { host.appendChild(emptyNote(opts.emptyText)); return; }

    var total = items.reduce(function (s, i) { return s + i.value; }, 0);
    var topN = opts.topN || 8;
    var shown = items.slice(0, topN);
    var rest = items.slice(topN);
    if (rest.length) {
      shown.push({
        label: opts.restLabel || 'Diğer',
        value: rest.reduce(function (s, i) { return s + i.value; }, 0),
        _rest: rest,
      });
    }

    var box = document.createElement('div');
    box.className = 'ac-donut-box';

    // — Halka
    var R = 54, SW = 17, C = 2 * Math.PI * R, size = 148;
    var svg = el('svg', { viewBox: '0 0 ' + size + ' ' + size, class: 'ac-donut' });
    svg.appendChild(el('circle', {
      cx: size / 2, cy: size / 2, r: R, fill: 'none',
      'stroke-width': SW, class: 'ac-donut-track',
    }));
    var offset = 0;
    var arcs = [];
    shown.forEach(function (it, i) {
      var frac = it.value / total;
      var arc = el('circle', {
        cx: size / 2, cy: size / 2, r: R, fill: 'none',
        stroke: it.color || PALETTE[i % PALETTE.length],
        'stroke-width': SW, 'stroke-linecap': 'butt',
        // 2px görsel boşluk: dilimler birbirine yapışmasın
        'stroke-dasharray': Math.max(0, frac * C - 2) + ' ' + (C - Math.max(0, frac * C - 2)),
        'stroke-dashoffset': -offset,
        transform: 'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')',
        class: 'ac-donut-arc',
      });
      arcs.push(arc);
      svg.appendChild(arc);
      offset += frac * C;
      it._color = arc.getAttribute('stroke');
    });

    // — Ortadaki toplam
    var center = document.createElement('div');
    center.className = 'ac-donut-center';
    center.innerHTML = '<b>' + nfmt(total) + '</b><i>' + esc(opts.centerLabel || 'toplam') + '</i>';

    var ring = document.createElement('div');
    ring.className = 'ac-donut-ring';
    ring.appendChild(svg);
    ring.appendChild(center);
    box.appendChild(ring);

    // — Açıklama listesi (legend); üzerine gelince ilgili dilim öne çıkar
    var legend = document.createElement('div');
    legend.className = 'ac-legend';
    shown.forEach(function (it, i) {
      var row = document.createElement('div');
      row.className = 'ac-legend-row';
      row.tabIndex = 0;
      row.innerHTML =
        '<span class="ac-dot" style="background:' + it._color + '"></span>' +
        '<span class="ac-legend-label">' + esc(it.label) + '</span>' +
        '<span class="ac-legend-val">' + nfmt(it.value) + '</span>' +
        '<span class="ac-legend-pct">' + pct(it.value, total) + '%</span>';
      var focus = function (on) {
        arcs.forEach(function (a, j) { a.classList.toggle('ac-arc-dim', on && j !== i); });
        row.classList.toggle('ac-legend-on', on);
      };
      row.addEventListener('mouseenter', function () { focus(true); });
      row.addEventListener('mouseleave', function () { focus(false); });
      row.addEventListener('focus', function () { focus(true); });
      row.addEventListener('blur', function () { focus(false); });
      bindTip(row, function () {
        var h = '<b>' + esc(it.label) + '</b><br>' + nfmt(it.value) + ' deal · ' + pct(it.value, total) + '%';
        if (it._rest) {
          h += '<hr>' + it._rest.slice(0, 10).map(function (r) {
            return esc(r.label) + ' · ' + nfmt(r.value);
          }).join('<br>');
          if (it._rest.length > 10) h += '<br>+' + (it._rest.length - 10) + ' daha';
        }
        return h;
      });
      legend.appendChild(row);
    });
    box.appendChild(legend);
    host.appendChild(box);
  }

  /* ── 3. Alan + çizgi grafiği — Aylık trend ──────────────────────────
     Eskiden CSS çubuklarıydı: eğilim okunmuyordu ve ciro ayrı bir
     rakam olarak altta duruyordu. Şimdi deal adedi alan olarak, ciro
     ikinci bir çizgi olarak aynı eksende; imleç dikey kılavuzla
     gezdirilebiliyor.
     points: [{ label, count, amount }] */
  function area(host, points, opts) {
    if (!host) return;
    opts = opts || {};
    host.innerHTML = '';
    points = (points || []).filter(Boolean);
    if (points.length < 2) {
      host.appendChild(emptyNote(points.length ? (opts.singleText || 'Eğilim için en az iki ay gerekli.') : opts.emptyText));
      return;
    }

    var W = 900, H = 230, P = { t: 16, r: 14, b: 26, l: 14 };
    var iw = W - P.l - P.r, ih = H - P.t - P.b;
    var maxC = Math.max.apply(null, points.map(function (p) { return p.count || 0; })) || 1;
    var maxA = Math.max.apply(null, points.map(function (p) { return p.amount || 0; })) || 1;
    var X = function (i) { return P.l + (points.length === 1 ? iw / 2 : i * iw / (points.length - 1)); };
    var Yc = function (v) { return P.t + ih - (v / maxC) * ih; };
    var Ya = function (v) { return P.t + ih - (v / maxA) * ih; };

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'ac-area', preserveAspectRatio: 'none' });

    // Degrade tanımı — her grafik örneği kendi id'sini kullanmalı, yoksa
    // aynı sayfadaki ikinci grafik birincinin degradesini eziyor
    var uid = 'acg' + (area._n = (area._n || 0) + 1);
    var defs = el('defs');
    var g = el('linearGradient', { id: uid, x1: '0', y1: '0', x2: '0', y2: '1' });
    g.appendChild(el('stop', { offset: '0%', 'stop-color': '#6366f1', 'stop-opacity': '0.42' }));
    g.appendChild(el('stop', { offset: '100%', 'stop-color': '#6366f1', 'stop-opacity': '0.02' }));
    defs.appendChild(g);
    svg.appendChild(defs);

    // Yatay kılavuz çizgileri
    [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
      svg.appendChild(el('line', {
        x1: P.l, x2: W - P.r, y1: P.t + ih * f, y2: P.t + ih * f, class: 'ac-grid',
      }));
    });

    var lineD = points.map(function (p, i) { return (i ? 'L' : 'M') + X(i) + ' ' + Yc(p.count); }).join(' ');
    svg.appendChild(el('path', {
      d: lineD + ' L' + X(points.length - 1) + ' ' + (P.t + ih) + ' L' + X(0) + ' ' + (P.t + ih) + ' Z',
      fill: 'url(#' + uid + ')', stroke: 'none',
    }));
    svg.appendChild(el('path', { d: lineD, fill: 'none', stroke: '#6366f1', 'stroke-width': '2.5', class: 'ac-line' }));
    svg.appendChild(el('path', {
      d: points.map(function (p, i) { return (i ? 'L' : 'M') + X(i) + ' ' + Ya(p.amount); }).join(' '),
      fill: 'none', stroke: '#0d9488', 'stroke-width': '2', 'stroke-dasharray': '5 4', class: 'ac-line2',
    }));

    // İmleç kılavuzu + noktalar
    var guide = el('line', { class: 'ac-guide', y1: P.t, y2: P.t + ih, x1: 0, x2: 0, opacity: '0' });
    svg.appendChild(guide);
    var dotC = el('circle', { r: '4.5', fill: '#6366f1', class: 'ac-dot-c', opacity: '0' });
    var dotA = el('circle', { r: '3.5', fill: '#0d9488', class: 'ac-dot-c', opacity: '0' });
    svg.appendChild(dotC); svg.appendChild(dotA);

    // Yakalama katmanı: SVG viewBox ölçekli olduğu için imleç x'i
    // getBoundingClientRect üzerinden orana çevrilir
    var hit = el('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent', class: 'ac-hit' });
    svg.appendChild(hit);

    var moneyFmt = opts.moneyFmt || nfmt;
    function onMove(e) {
      var r = svg.getBoundingClientRect();
      var rel = (e.clientX - r.left) / r.width * W;
      var i = Math.round((rel - P.l) / (iw / (points.length - 1)));
      i = Math.max(0, Math.min(points.length - 1, i));
      var p = points[i];
      guide.setAttribute('x1', X(i)); guide.setAttribute('x2', X(i)); guide.setAttribute('opacity', '1');
      dotC.setAttribute('cx', X(i)); dotC.setAttribute('cy', Yc(p.count)); dotC.setAttribute('opacity', '1');
      dotA.setAttribute('cx', X(i)); dotA.setAttribute('cy', Ya(p.amount)); dotA.setAttribute('opacity', '1');
      showTip(
        '<b>' + esc(p.label) + '</b><br>' +
        '<span class="ac-k" style="--c:#6366f1"></span>' + nfmt(p.count) + ' deal<br>' +
        '<span class="ac-k" style="--c:#0d9488"></span>' + moneyFmt(p.amount),
        e.clientX, e.clientY
      );
    }
    svg.addEventListener('mousemove', onMove);
    svg.addEventListener('mouseleave', function () {
      hideTip();
      guide.setAttribute('opacity', '0');
      dotC.setAttribute('opacity', '0');
      dotA.setAttribute('opacity', '0');
    });

    var frame = document.createElement('div');
    frame.className = 'ac-area-frame';
    frame.appendChild(svg);

    // Ay etiketleri: SVG içinde yazı viewBox ile çarpık ölçeklenirdi
    // (preserveAspectRatio=none), bu yüzden HTML katmanında
    var axis = document.createElement('div');
    axis.className = 'ac-axis';
    var step = Math.ceil(points.length / 12);
    points.forEach(function (p, i) {
      var s = document.createElement('span');
      s.textContent = (i % step === 0 || i === points.length - 1) ? p.label : '';
      axis.appendChild(s);
    });

    var key = document.createElement('div');
    key.className = 'ac-key';
    key.innerHTML =
      '<span><i style="background:#6366f1"></i>' + esc(opts.countLabel || 'Deal adedi') + '</span>' +
      // Kesikli çizgi border ile çiziliyor; rengi border-top-color'dan
      // gelmeli. background verilince CSS'teki `background:none` onu
      // eziyor ve çizgi currentColor'a (metin grisi) düşüyordu.
      '<span><i class="ac-key-dash" style="border-top-color:#0d9488"></i>' + esc(opts.amountLabel || 'Ciro') + '</span>';

    host.appendChild(key);
    host.appendChild(frame);
    host.appendChild(axis);
  }

  /* ── 4. Huni (funnel) — dönüşüm adımları ────────────────────────────
     steps: [{ label, value, color? }] — ilk adım %100 kabul edilir,
     her satırda önceki adıma göre dönüşüm oranı gösterilir. */
  function funnel(host, steps, opts) {
    if (!host) return;
    opts = opts || {};
    host.innerHTML = '';
    steps = (steps || []).filter(Boolean);
    if (!steps.length || !steps[0].value) { host.appendChild(emptyNote(opts.emptyText)); return; }
    var first = steps[0].value;
    var wrap = document.createElement('div');
    wrap.className = 'ac-funnel';
    steps.forEach(function (st, i) {
      var prev = i ? steps[i - 1].value : st.value;
      var color = st.color || PALETTE[i % PALETTE.length];
      var row = document.createElement('div');
      row.className = 'ac-fn-row';
      row.tabIndex = 0;
      row.innerHTML =
        '<div class="ac-fn-head">' +
          '<span class="ac-fn-label"><span class="ac-dot" style="background:' + color + '"></span>' + esc(st.label) + '</span>' +
          '<span class="ac-fn-val"><b>' + nfmt(st.value) + '</b>' +
          '<i class="ac-fn-pct">' + pct(st.value, first) + '%</i></span>' +
        '</div>' +
        '<div class="ac-fn-track"><div class="ac-fn-fill"></div></div>' +
        (i ? '<div class="ac-fn-step">↳ ' + esc(steps[i - 1].label) + ' → ' +
             '<b>' + pct(st.value, prev) + '%</b> ' + esc(opts.convText || 'dönüşüm') +
             ' <span class="ac-fn-drop">(−' + nfmt(Math.max(0, prev - st.value)) + ')</span></div>' : '');
      var fill = row.querySelector('.ac-fn-fill');
      fill.style.background = 'linear-gradient(90deg,' + color + ' 0%,' + mix(color) + ' 100%)';
      requestAnimationFrame(function () {
        fill.style.width = Math.max(2, st.value / first * 100).toFixed(1) + '%';
      });
      bindTip(row, function () {
        return '<b>' + esc(st.label) + '</b><br>' + nfmt(st.value) +
          '<br>' + esc(opts.ofTotalText || 'toplamın') + ' ' + pct(st.value, first) + '%' +
          (i ? '<br>' + esc(opts.convText || 'dönüşüm') + ': ' + pct(st.value, prev) + '%' : '');
      });
      wrap.appendChild(row);
    });
    host.appendChild(wrap);
  }

  /* ── 5. Gösterge (gauge) — tahsilat oranı ───────────────────────────
     Yarım halka; 0–100 arası tek bir oranı gösterir. */
  function gauge(host, value, opts) {
    if (!host) return;
    opts = opts || {};
    host.innerHTML = '';
    var v = Math.max(0, Math.min(100, Number(value) || 0));
    var W = 200, H = 116, R = 78, cx = W / 2, cy = 96, SW = 15;
    var half = Math.PI * R;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'ac-gauge' });
    var arcPath = 'M ' + (cx - R) + ' ' + cy + ' A ' + R + ' ' + R + ' 0 0 1 ' + (cx + R) + ' ' + cy;
    svg.appendChild(el('path', {
      d: arcPath, fill: 'none', 'stroke-width': SW, 'stroke-linecap': 'round', class: 'ac-gauge-track',
    }));
    var arc = el('path', {
      d: arcPath, fill: 'none', stroke: opts.color || '#0d9488', 'stroke-width': SW,
      'stroke-linecap': 'round', 'stroke-dasharray': half + ' ' + half,
      'stroke-dashoffset': half, class: 'ac-gauge-arc',
    });
    svg.appendChild(arc);
    requestAnimationFrame(function () {
      arc.setAttribute('stroke-dashoffset', String(half * (1 - v / 100)));
    });
    var box = document.createElement('div');
    box.className = 'ac-gauge-box';
    box.appendChild(svg);
    var lbl = document.createElement('div');
    lbl.className = 'ac-gauge-val';
    lbl.innerHTML = '<b>' + v.toFixed(1) + '%</b><i>' + esc(opts.label || '') + '</i>';
    box.appendChild(lbl);
    if (opts.sub) {
      var sub = document.createElement('div');
      sub.className = 'ac-gauge-sub';
      sub.textContent = opts.sub;
      box.appendChild(sub);
    }
    if (opts.tip) bindTip(box, function () { return opts.tip; });
    host.appendChild(box);
  }

  global.NCCharts = {
    bars: bars, donut: donut, area: area, funnel: funnel, gauge: gauge,
    PALETTE: PALETTE, hideTip: hideTip,
  };
})(window);
