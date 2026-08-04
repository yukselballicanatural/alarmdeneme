/* ═══════════════════════════════════════════════════════════════════════
   liquid-ui.js — Liquid Glass etkileşim katmanı
   ───────────────────────────────────────────────────────────────────────
   İki geliştirme yapar, ikisi de yalnızca AÇIK (light) temada devreye
   girer ve mevcut mantığa DOKUNMAZ:

   1) LiquidSelect — native <select> elemanları işletim sistemi tarafından
      çizilir; köşeli görünümü ve açılış animasyonu CSS ile değiştirilemez.
      Bu yüzden orijinal <select> DOM'da kalır (değer kaynağı hâlâ o,
      onchange'leri aynen çalışır), üzerine cam bir açılır liste giydirilir.
      Seçim yapıldığında select.value set edilip 'change' event'i
      tetiklenir — yani var olan hiçbir JS'in değişmesi gerekmez.

      • Seçenekler JS ile yeniden doldurulursa (innerHTML) MutationObserver
        yakalar ve listeyi tazeler.
      • Kod `sel.value = x` derse instance üzerinde tanımlı setter etiketi
        günceller.
      • 8'den fazla seçenek varsa otomatik arama alanı eklenir.
      • Panel body'ye position:fixed olarak eklenir — modal/kanban gibi
        overflow'lu kapsayıcılarda kırpılmaz.

   2) LiquidSegment — .tab-pill ve .nav-btn gruplarında aktif seçimi
      gösteren, iOS segment kontrolü gibi KAYAN cam gösterge. Aktif
      butonun kendi zemini şeffaflaşır, göstergeyi bu katman çizer.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var SPRING = 'cubic-bezier(.34,1.4,.56,1)';

  function isLight() {
    return document.documentElement.getAttribute('data-theme') !== 'dark';
  }

  /* ════════════════ 1. LIQUID SELECT ════════════════ */

  var openInstance = null;

  function LiquidSelect(sel) {
    if (sel.__lq) return sel.__lq;
    var self = this;
    this.sel = sel;
    sel.__lq = this;

    // Sarmalayıcı — orijinal select'in yerinde durur, ölçüsünü korur
    var wrap = document.createElement('div');
    wrap.className = 'lq-sel';
    // Select'e satır içi genişlik verilmişse sarmalayıcıya taşı, yoksa
    // flex satırlarında ölçü kayar
    if (sel.style.width) wrap.style.width = sel.style.width;
    if (sel.style.minWidth) wrap.style.minWidth = sel.style.minWidth;
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.classList.add('lq-native');

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'lq-trigger';
    trigger.innerHTML =
      '<span class="lq-trigger-label"></span>' +
      '<svg class="lq-trigger-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">' +
      '<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>';
    wrap.appendChild(trigger);

    this.wrap = wrap;
    this.trigger = trigger;
    this.label = trigger.querySelector('.lq-trigger-label');
    this.panel = null;

    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      self.toggle();
    });
    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        self.open();
      }
    });

    // Değer programatik olarak set edilirse etiketi güncelle
    try {
      var desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
      Object.defineProperty(sel, 'value', {
        configurable: true,
        get: function () { return desc.get.call(this); },
        set: function (v) { desc.set.call(this, v); self.syncLabel(); }
      });
    } catch (err) { /* tarayıcı izin vermezse etiket 'change' ile güncellenir */ }

    sel.addEventListener('change', function () { self.syncLabel(); });

    // Seçenekler sonradan doldurulursa listeyi tazele
    new MutationObserver(function () {
      self.syncLabel();
      if (self.panel) self.buildOptions();
    }).observe(sel, { childList: true, subtree: true });

    this.syncLabel();
  }

  LiquidSelect.prototype.syncLabel = function () {
    var opt = this.sel.options[this.sel.selectedIndex];
    this.label.textContent = opt ? opt.textContent : '';
    this.trigger.disabled = this.sel.disabled;
    this.wrap.classList.toggle('lq-disabled', !!this.sel.disabled);
    // Günlük Ekip Girişi'ndeki devam durumu (Çalışıyor / İzinli) anlamsal
    // renk taşıyor — değeri sınıf olarak yansıt, rengi CSS versin
    if (this.sel.classList.contains('dep-att-sel')) {
      var v = String(this.sel.value || '').toLowerCase();
      this.wrap.classList.add('lq-att');
      this.trigger.classList.toggle('lq-att-off', v === 'off');
      this.trigger.classList.toggle('lq-att-working', v !== 'off');
    }
  };

  LiquidSelect.prototype.buildOptions = function () {
    var self = this;
    var list = this.panel.querySelector('.lq-list');
    list.innerHTML = '';
    var opts = Array.prototype.slice.call(this.sel.options);
    opts.forEach(function (o, i) {
      var row = document.createElement('div');
      row.className = 'lq-opt' + (i === self.sel.selectedIndex ? ' lq-opt-on' : '');
      row.setAttribute('role', 'option');
      row.dataset.idx = String(i);
      row.style.setProperty('--i', String(i));
      row.textContent = o.textContent;
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        self.pick(i);
      });
      list.appendChild(row);
    });
    // Uzun listelerde arama alanı
    var search = this.panel.querySelector('.lq-search');
    if (opts.length > 8) {
      search.style.display = '';
    } else {
      search.style.display = 'none';
    }
  };

  LiquidSelect.prototype.pick = function (i) {
    // Orijinal select'i güncelle + change tetikle — mevcut mantık aynen çalışır
    var d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
    if (d && d.set) d.set.call(this.sel, i); else this.sel.selectedIndex = i;
    this.syncLabel();
    this.sel.dispatchEvent(new Event('change', { bubbles: true }));
    this.sel.dispatchEvent(new Event('input', { bubbles: true }));
    this.close();
  };

  LiquidSelect.prototype.ensurePanel = function () {
    if (this.panel) return;
    var self = this;
    var p = document.createElement('div');
    p.className = 'lq-panel';
    p.innerHTML =
      '<div class="lq-search" style="display:none"><input type="text" placeholder="Ara…" spellcheck="false"></div>' +
      '<div class="lq-list" role="listbox"></div>';
    document.body.appendChild(p);
    this.panel = p;

    p.addEventListener('click', function (e) { e.stopPropagation(); });
    var inp = p.querySelector('.lq-search input');
    inp.addEventListener('input', function () {
      var q = this.value.toLowerCase();
      p.querySelectorAll('.lq-opt').forEach(function (row) {
        row.style.display = row.textContent.toLowerCase().indexOf(q) >= 0 ? '' : 'none';
      });
    });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); self.close(); }
      if (e.key === 'Enter') {
        var first = p.querySelector('.lq-opt:not([style*="display: none"])');
        if (first) self.pick(Number(first.dataset.idx));
      }
    });
  };

  LiquidSelect.prototype.position = function () {
    var r = this.trigger.getBoundingClientRect();
    var p = this.panel;
    p.style.minWidth = Math.max(r.width, 170) + 'px';
    p.style.left = 'auto'; p.style.right = 'auto';
    var maxH = 320;
    var below = window.innerHeight - r.bottom - 16;
    var above = r.top - 16;
    var flip = below < 180 && above > below;
    p.style.maxHeight = Math.min(maxH, flip ? above : below) + 'px';
    // Sağ kenardan taşmayı engelle
    var w = p.offsetWidth || r.width;
    var left = Math.min(r.left, window.innerWidth - w - 12);
    p.style.left = Math.max(12, left) + 'px';
    if (flip) {
      p.style.top = 'auto';
      p.style.bottom = (window.innerHeight - r.top + 8) + 'px';
      p.classList.add('lq-flip');
    } else {
      p.style.bottom = 'auto';
      p.style.top = (r.bottom + 8) + 'px';
      p.classList.remove('lq-flip');
    }
  };

  LiquidSelect.prototype.open = function () {
    if (this.sel.disabled) return;
    if (openInstance && openInstance !== this) openInstance.close();
    this.ensurePanel();
    this.buildOptions();
    this.panel.classList.add('lq-open');
    this.position();
    this.trigger.classList.add('lq-active');
    openInstance = this;
    var inp = this.panel.querySelector('.lq-search input');
    if (inp && this.panel.querySelector('.lq-search').style.display !== 'none') {
      inp.value = '';
      setTimeout(function () { inp.focus(); }, 60);
    }
    var on = this.panel.querySelector('.lq-opt-on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  };

  LiquidSelect.prototype.close = function () {
    if (!this.panel) return;
    this.panel.classList.remove('lq-open');
    this.trigger.classList.remove('lq-active');
    if (openInstance === this) openInstance = null;
  };

  LiquidSelect.prototype.toggle = function () {
    if (this.panel && this.panel.classList.contains('lq-open')) this.close();
    else this.open();
  };

  function closeAll() { if (openInstance) openInstance.close(); }

  // Açık listeyi kapatmak için CAPTURE fazında 'mousedown' dinlenir.
  // Neden: takvim tetikleyicisi gibi bazı kontroller kendi handler'ında
  // event'i durduruyor; bubble fazındaki bir 'click' dinleyicisine hiç
  // ulaşmıyor ve açılır liste ekranda takılı kalıyordu. Takvim de aynı
  // mekanizmayı (mousedown + capture) kullandığı için ikisi artık tutarlı:
  // hangisi açılırsa diğeri kapanır.
  document.addEventListener('mousedown', function (e) {
    if (e.target.closest && (e.target.closest('.lq-sel') || e.target.closest('.lq-panel'))) return;
    closeAll();
  }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(); });
  window.addEventListener('resize', function () { if (openInstance) openInstance.position(); });
  window.addEventListener('scroll', function () { if (openInstance) openInstance.position(); }, true);

  function enhanceSelects(root) {
    (root || document).querySelectorAll('select.filter-sel, select.dep-att-sel').forEach(function (s) {
      if (!s.__lq) new LiquidSelect(s);
    });
  }

  /* ════════════════ 2. LIQUID SEGMENT (kayan gösterge) ════════════════ */

  // activeFn: hangi öğenin aktif olduğunu belirleyen yordam. Bazı gruplar
  // (Tablo/Kanban gibi) aktifliği CSS sınıfıyla değil satır içi stille
  // işaretliyor — bu yüzden ölçüt dışarıdan verilebilir.
  function Segment(container, itemSel, activeFn) {
    var self = this;
    if (container.__lqSeg) return;
    container.__lqSeg = this;
    this.el = container;
    this.itemSel = itemSel;
    this.activeFn = activeFn || function (el) { return el.classList.contains('active'); };
    container.classList.add('lq-seg');

    var ind = document.createElement('span');
    ind.className = 'lq-seg-ind';
    container.insertBefore(ind, container.firstChild);
    this.ind = ind;

    new MutationObserver(function () { self.update(); })
      .observe(container, { attributes: true, attributeFilter: ['class', 'style'], subtree: true });
    window.addEventListener('resize', function () { self.update(true); });
    this.update(true);
  }

  Segment.prototype.update = function (instant) {
    var self = this;
    var active = null;
    Array.prototype.slice.call(this.el.querySelectorAll(this.itemSel)).some(function (el) {
      if (self.activeFn(el)) { active = el; return true; }
      return false;
    });
    if (!active || active.offsetParent === null) { this.ind.style.opacity = '0'; return; }
    var i = this.ind;
    if (instant) i.style.transition = 'none';
    i.style.opacity = '1';
    i.style.width = active.offsetWidth + 'px';
    i.style.height = active.offsetHeight + 'px';
    i.style.transform = 'translate(' + active.offsetLeft + 'px,' + active.offsetTop + 'px)';
    if (instant) {
      // reflow'dan sonra geçişi geri aç
      void i.offsetWidth;
      i.style.transition = '';
    }
  };

  function enhanceSegments() {
    // .tab-pill grupları
    var groups = new Set();
    document.querySelectorAll('.tab-pill').forEach(function (b) {
      if (b.parentElement && b.parentElement.querySelectorAll('.tab-pill').length > 1) {
        groups.add(b.parentElement);
      }
    });
    groups.forEach(function (g) { new Segment(g, '.tab-pill'); });

    // Sidebar navigasyonu
    var nav = document.querySelector('#sidebarFull .nav-btn');
    if (nav && nav.parentElement && nav.parentElement.querySelectorAll('.nav-btn').length > 1) {
      new Segment(nav.parentElement, '.nav-btn');
    }

    // Tablo / Kanban geçişleri — aktiflik satır içi background ile
    // işaretleniyor (JS '#4f46e5' veya 'transparent' yazıyor)
    var inlineActive = function (el) {
      var b = (el.style.background || el.style.backgroundColor || '').toLowerCase();
      return !!b && b !== 'transparent' && b.indexOf('rgba(0, 0, 0, 0)') < 0;
    };
    ['alarmsViewBtnTable', 'dealsViewBtnTable'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b && b.parentElement) new Segment(b.parentElement, 'button', inlineActive);
    });

    // Günlük Ekip Girişi — Bugün / Dün
    var dq = document.querySelector('.dep-quick-btn');
    if (dq && dq.parentElement && dq.parentElement.querySelectorAll('.dep-quick-btn').length > 1) {
      new Segment(dq.parentElement, '.dep-quick-btn', function (el) {
        return el.classList.contains('dep-quick-active');
      });
    }
  }

  /* ════════════════ 3. TELEFON MASKESİ ════════════════
     Türk cep numarasını yazarken biçimlendirir: (5xx) xxx xx xx
     Güvenli: _validatePhone() zaten rakam dışı her şeyi soyuyor
     (v.replace(/[^\d]/g,'')), yani parantez/boşluk kaydı bozmaz. */

  function formatTRPhone(raw) {
    var d = String(raw || '').replace(/\D/g, '').slice(0, 10);
    if (!d) return '';
    if (d.length <= 3) return '(' + d;
    var rest = [d.slice(3, 6), d.slice(6, 8), d.slice(8, 10)].filter(Boolean);
    return '(' + d.slice(0, 3) + ') ' + rest.join(' ');
  }

  function isPhoneInput(el) {
    return el && el.tagName === 'INPUT' &&
      (el.id === 'waPhoneInput' || /^tmPhone-/.test(el.id || ''));
  }

  function applyPhoneMask(el) {
    if (el.maxLength && el.maxLength < 16) el.maxLength = 16;
    var f = formatTRPhone(el.value);
    if (f !== el.value) {
      el.value = f;
      // İmleci sona al — kullanıcı soldan sağa yazdığı için doğal davranış
      try { el.setSelectionRange(f.length, f.length); } catch (e) {}
    }
  }

  document.addEventListener('input', function (e) {
    if (isPhoneInput(e.target)) applyPhoneMask(e.target);
  });
  // Satır "Düzenle" ile açıldığında mevcut değeri de biçimlendir
  document.addEventListener('focusin', function (e) {
    if (isPhoneInput(e.target)) applyPhoneMask(e.target);
  });

  /* ════════════════ 4. DİL SEÇİCİ (cam açılır liste) ════════════════
     Eski TR/EN segment pill'i yerine bayraklı cam açılır liste.
     SADECE tr/en var — i18n.js sözlüğü bu iki dili kapsıyor; olmayan
     dilleri listelemek boş/çeviri­siz seçenek üretirdi.
     #langToggleMount içeriğini uygulamanın init'i sonradan
     I18N.renderToggleButton() ile dolduruyor, bu yüzden MutationObserver
     ile üzerine yeniden yazıyoruz. */

  var LANGS = [
    { code: 'tr', label: 'Türkçe',  flag: 'TR' },
    { code: 'en', label: 'English', flag: 'EN' }
  ];

  function enhanceLangSwitcher() {
    var mount = document.getElementById('langToggleMount');
    if (!mount || typeof window.I18N === 'undefined') return;

    function build() {
      var cur = window.I18N.getLang() === 'en' ? LANGS[1] : LANGS[0];
      var html =
        '<div class="lang-dd">' +
          '<button type="button" class="lang-trigger" aria-haspopup="listbox" aria-expanded="false">' +
            '<span class="lang-code">' + cur.flag + '</span>' +
            '<span class="lang-name">' + cur.label + '</span>' +
            '<svg class="lang-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 9l-7 7-7-7"/></svg>' +
          '</button>' +
          '<div class="lang-menu" role="listbox">' +
            LANGS.map(function (l, i) {
              return '<button type="button" class="lang-item' + (l.code === cur.code ? ' lang-on' : '') +
                '" data-code="' + l.code + '" role="option" style="--i:' + i + '">' +
                '<span class="lang-code">' + l.flag + '</span>' +
                '<span class="lang-name">' + l.label + '</span>' +
                '<svg class="lang-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>' +
                '</button>';
            }).join('') +
          '</div>' +
        '</div>';
      mount.innerHTML = html;

      var dd = mount.querySelector('.lang-dd');
      var trig = dd.querySelector('.lang-trigger');
      trig.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var isOpen = dd.classList.toggle('lang-open');
        trig.setAttribute('aria-expanded', String(isOpen));
      });
      dd.querySelectorAll('.lang-item').forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          dd.classList.remove('lang-open');
          window.I18N.setLangAndReload(b.dataset.code);
        });
      });
    }

    build();
    // Uygulamanın init'i mount'u kendi butonuyla doldurursa geri al
    new MutationObserver(function () {
      if (!mount.querySelector('.lang-dd')) build();
    }).observe(mount, { childList: true });

    // Dışarı tıklama / Esc — açılır listelerle aynı capture mekanizması
    document.addEventListener('mousedown', function (e) {
      if (e.target.closest && e.target.closest('.lang-dd')) return;
      document.querySelectorAll('.lang-dd.lang-open').forEach(function (d) {
        d.classList.remove('lang-open');
        var t = d.querySelector('.lang-trigger');
        if (t) t.setAttribute('aria-expanded', 'false');
      });
    }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('.lang-dd.lang-open').forEach(function (d) { d.classList.remove('lang-open'); });
    });
  }

  /* ════════════════ Başlatma ════════════════ */

  function init() {
    if (!isLight()) return;   // koyu tema birebir orijinal kalır
    enhanceSelects();
    enhanceSegments();
    enhanceLangSwitcher();

    // Sonradan DOM'a eklenen select'ler (modal içerikleri, yeniden render)
    new MutationObserver(function (muts) {
      var found = false;
      muts.forEach(function (m) {
        m.addedNodes && m.addedNodes.forEach(function (n) {
          if (n.nodeType === 1 && (n.matches && n.matches('select.filter-sel, select.dep-att-sel') ||
              n.querySelector && n.querySelector('select.filter-sel, select.dep-att-sel'))) found = true;
        });
      });
      if (found) enhanceSelects();
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.LiquidUI = { enhanceSelects: enhanceSelects, closeAll: closeAll };
})();
