// net-util.js — Supabase OKUMA istekleri için ortak yeniden deneme katmanı.
//
// NEDEN
// Paneldeki "HTTP 500" hatalarının kaynağı bizim kodumuz değil: Postgres
// statement_timeout (SQLSTATE 57014). Supabase bunu 500 olarak döndürüyor ve
// bu GEÇİCİ bir durum — aynı istek saniyeler sonra 200 dönüyor. Ölçüm: 20
// sayfalık kapalı alarm sorgusu boş bir anda 0 hata verirken, veritabanı
// yüklüyken aynı sayfalar 500'e düşüyor.
//
// Önceden yalnızca deal yüklemesinde (admin.html _fetchAllRaw) elle yazılmış
// bir yeniden deneme vardı. Diğer TÜM okumalar korumasızdı ve iki farklı
// kötü sonuç veriyordu:
//   1) İlk sayfa 500 alırsa ekrana "Yükleme hatası: HTTP 500" basılıyordu.
//   2) Sonraki sayfalar 500 alırsa `[]` dönüp SESSİZCE veri kaybediyordu —
//      panel eksik veriyi tam sanıyordu. Bu, görünür hatadan daha kötü.
//
// KURAL: yalnızca OKUMA (GET / HEAD) yeniden denenir. Yazma isteklerini
// (POST/PATCH/DELETE) yeniden denemek kayıt tekrarına yol açabilir; istek
// sunucuya ulaşıp yanıtı kaybolmuş olabilir. Bu yüzden yazmalar bilinçli
// olarak bu katmanın dışında.
window.NCNet = (function () {
  'use strict';

  // Geçici sayılan durumlar: 500 (statement timeout dahil), 502/503/504
  // (ağ geçidi / kapasite), 429 (hız sınırı). 4xx'in geri kalanı kalıcı
  // hatadır — yeniden denemek yalnızca zaman kaybettirir.
  const RETRIABLE = new Set([429, 500, 502, 503, 504]);

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Artan bekleme + jitter: aynı anda 500 alan 20 sayfa aynı anda tekrar
  // denerse veritabanını yeniden aynı duvara sürer. Jitter onları dağıtır.
  function backoff(attempt) {
    return Math.round((350 * Math.pow(1.8, attempt - 1)) * (0.75 + Math.random() * 0.5));
  }

  // fetch ile aynı imza; ek olarak opts.ncTries (varsayılan 4).
  // Son deneme de başarısızsa SON yanıtı aynen döndürür (fırlatmaz) —
  // çağıran taraftaki mevcut `if (!r.ok)` mantığı bozulmasın.
  async function fetchRetry(url, opts) {
    const o = opts || {};
    const method = (o.method || 'GET').toUpperCase();
    const tries = o.ncTries || 4;
    // Yazma isteği geldiyse tek deneme — bkz. yukarıdaki KURAL.
    const maxTries = (method === 'GET' || method === 'HEAD') ? tries : 1;
    let last = null;
    for (let attempt = 1; attempt <= maxTries; attempt++) {
      try {
        const r = await fetch(url, o);
        if (r.ok || !RETRIABLE.has(r.status) || attempt === maxTries) return r;
        last = r;
      } catch (e) {
        // Ağ hatası (kopan bağlantı, DNS, timeout) — son denemeyse fırlat.
        if (attempt === maxTries) throw e;
      }
      await sleep(backoff(attempt));
    }
    return last;
  }

  // ── Neden global fetch yaması ────────────────────────────────────────
  // Panellerde Supabase'e giden 50+ ayrı çağrı noktası var. Hepsini tek tek
  // NCNet.fetch'e çevirmek, bir tanesini atlarsam o sayfanın yine 500
  // göstereceği anlamına gelir — ve atlanan yer, en nadir açılan sayfa
  // olacağı için de fark edilmez. Bu yüzden tek noktadan sarıyoruz.
  //
  // Yama SADECE şu koşullarda araya giriyor:
  //   • istek metodu GET/HEAD (yazmalar hiç dokunulmuyor — bkz. KURAL)
  //   • adres /rest/v1/ veya /api/ içeriyor (kendi uçlarımız)
  //   • ilk argüman düz bir string (Request nesnesi gövdesi tek kullanımlık
  //     olabildiği için yeniden denenmesi güvenli değil)
  // Diğer her durumda orijinal fetch aynen çağrılıyor.
  function install() {
    if (window.__ncNetPatched) return;
    const orig = window.fetch.bind(window);
    window.fetch = function (input, init) {
      const o = init || {};
      const method = (o.method || 'GET').toUpperCase();
      const isRead = method === 'GET' || method === 'HEAD';
      const url = typeof input === 'string' ? input : '';
      if (!isRead || !url || !(url.includes('/rest/v1/') || url.includes('/api/'))) {
        return orig(input, init);
      }
      return (async () => {
        let last = null;
        const maxTries = o.ncTries || 4;
        for (let attempt = 1; attempt <= maxTries; attempt++) {
          try {
            const r = await orig(url, o);
            if (r.ok || !RETRIABLE.has(r.status) || attempt === maxTries) return r;
            last = r;
          } catch (e) {
            if (attempt === maxTries) throw e;
          }
          await sleep(backoff(attempt));
        }
        return last;
      })();
    };
    window.__ncNetPatched = true;
  }

  install();

  // ── Sayfalı okumada EKSİK kalan sayfa ────────────────────────────────
  // Panellerde çok yerde şu kalıp vardı:
  //     fetch(url).then(r => r.ok ? r.json() : [])
  // Yani bir sayfa gelmezse boş dizi dönüyor ve panel eksik veriyi TAM
  // sanıyordu — 20.890 kapalı alarmın 1.000'i sessizce kaybolabiliyordu.
  // Görünür bir hata, sessiz eksik veriden iyidir.
  //
  // Uyarı borçlanıyor (debounce): 20 sayfa birden düşerse 20 bildirim değil
  // tek bir "N sayfa yüklenemedi" çıkar.
  let _notifier = null;
  let _missed = 0;
  let _timer = null;

  // Panel kendi bildirim fonksiyonunu veriyor (admin: showSiteNotice,
  // takım lideri: showNotice) — bu dosya panele bağımlı olmasın.
  function setNotifier(fn) { _notifier = fn; }

  function pageFailed() {
    _missed++;
    clearTimeout(_timer);
    _timer = setTimeout(() => {
      const n = _missed;
      _missed = 0;
      if (!_notifier) return;
      const msg = (typeof I18N !== 'undefined' && I18N.t)
        ? I18N.t('{n} veri sayfası yüklenemedi — liste eksik olabilir. ↻ Yenile ile tekrar deneyin.').replace('{n}', n)
        : n + ' veri sayfası yüklenemedi — liste eksik olabilir.';
      _notifier(msg);
    }, 1500);
  }

  // Sayfalı okuma için tek giriş noktası: başarısızsa [] döner AMA sessizce
  // değil — sayacı artırır, kullanıcı eksik veriden haberdar olur.
  async function page(url, headers) {
    try {
      const r = await fetchRetry(url, { headers });
      if (r && r.ok) return await r.json();
    } catch (e) { /* ağ hatası — aşağıda sayılıyor */ }
    pageFailed();
    return [];
  }

  return { fetch: fetchRetry, install, page, setNotifier, RETRIABLE };
})();
