// deals-live.js — Natural Clinic CRM "deals değişim akışı" (change feed)
//
// SORUN
// Paneller deals tablosunu sayfa açılışında bir kez çekiyordu. Zoho senkronu
// (5–20 dk aralıkla çalışıyor) bir deal'i güncellediğinde — stage, tutar,
// Result_Codes/etiket, varış/vizit tarihleri — ya da başka bir kullanıcı panel
// içinden sonuç kodu yazdığında, açık duran sekme bunu görmüyordu:
//   * agent.html      → sessionStorage'da 5 dk TTL, periyodik yenileme YOK
//   * team-leader.html→ "Dealler" sayfası hiç yenilenmiyordu (canlı yenileme
//                       yalnız Alarmlar/İptal/Won sekmelerini kapsıyordu)
//   * admin.html      → IndexedDB'de 20 dk TTL, "Dealler" sayfasında periyodik
//                       yenileme YOK
//
// ÇÖZÜM
// Tüm deal listesini tekrar tekrar çekmek yerine (admin'de 49K+ satır) yalnızca
// "son bakıştan beri DEĞİŞEN satırları" çekiyoruz. Damga (watermark) olarak
// deals.row_updated_at kullanılıyor — bkz. deals_row_updated_at.sql; o trigger
// her INSERT/UPDATE'te kolonu tazeler, yani hem Zoho senkronunu hem panel içi
// yazmaları yakalar. Kolon henüz kurulmadıysa sessizce synced_at'e düşer
// (yalnız Zoho kaynaklı değişiklikler görünür).
//
// NEDEN "Realtime" (websocket) DEĞİL
// Zoho → Supabase senkronunun kendisi 5 dk aralıklı; Supabase → tarayıcı ayağını
// websocket'e taşımak uçtan uca tazeliği ölçülebilir şekilde iyileştirmiyor.
// Bu yaklaşım supabase-js bağımlılığı, publication/RLS ayarı ve `raw` JSONB'nin
// her UPDATE'te websocket üzerinden akması sorunlarını da getirmiyor.
//
// KULLANIM
//   const handle = NCDealsLive.watch({
//     url, key,
//     select: 'id,deal_id,stage,amount,...',   // sayfanın ihtiyaç duyduğu kolonlar
//     scopeQuery: '&team=in.("A","B")',        // opsiyonel PostgREST filtre eki
//     intervalMs: 30000,
//     onRows(rows) { /* yalnızca değişen satırlar */ },
//   });
//   handle.stop();  handle.poke();  handle.setScope('&team=eq.X');
window.NCDealsLive = (function () {
  'use strict';

  // Damga kolonu tercih sırası — ilki yoksa sıradakine düşülür.
  const WATERMARK_COLS = ['row_updated_at', 'synced_at'];

  // Damgayı bu kadar geriye alarak sorguluyoruz: bir satır biz max()'ı
  // okuduktan sonra AYNI mikrosaniyede yazılırsa kaçmasın diye. Aynı satırın
  // iki kez yayınlanmasını (id, damga) ikilisini hatırlayarak engelliyoruz.
  const OVERLAP_MS = 2000;

  const PAGE = 500;

  function _isMissingColumn(status, bodyText) {
    // PostgREST bilinmeyen kolonda 400 + {"code":"42703"} döndürüyor
    return status === 400 && /42703|does not exist/i.test(String(bodyText || ''));
  }

  function watch(opts) {
    const url        = String(opts.url || '').replace(/\/+$/, '');
    const key        = opts.key;
    const select     = opts.select;
    const onRows     = typeof opts.onRows === 'function' ? opts.onRows : function () {};
    const onError    = typeof opts.onError === 'function' ? opts.onError : function () {};
    const intervalMs = Math.max(10000, Number(opts.intervalMs) || 30000);

    let scopeQuery = opts.scopeQuery || '';
    let wcolIdx    = 0;
    let watermark  = null;     // ISO string — DB'nin kendi saati (istemci saatine GÜVENİLMEZ)
    let lastKeys   = new Set();// bir önceki turda yayınlanan "id|damga" anahtarları
    let timer      = null;
    let running    = false;
    let stopped    = false;
    let pokeTimer  = null;

    const H = { apikey: key, Authorization: 'Bearer ' + key };

    function wcol() { return WATERMARK_COLS[wcolIdx]; }

    // Damga kolonu yoksa sıradakine geç; hiç kalmadıysa false dön.
    function _degrade() {
      if (wcolIdx < WATERMARK_COLS.length - 1) {
        wcolIdx++;
        watermark = null;
        return true;
      }
      return false;
    }

    // Başlangıç damgası: kapsamdaki EN BÜYÜK damga değeri. Böylece izlemeye
    // başladığımız andan öncesi "değişmiş" sayılmaz (ilk turda 49K satır akmaz).
    async function _initWatermark() {
      while (true) {
        // select / order ENCODE EDİLMİYOR: PostgREST'te virgül alan ayırıcısı,
        // ve panellerin select'lerinde `rawLang:raw->>Language` gibi ifadeler
        // geçiyor — encode edilirse sorgu bozulur.
        const q = `${url}/rest/v1/deals?select=${wcol()}` +
                  `&order=${wcol()}.desc.nullslast&limit=1${scopeQuery}`;
        const r = await fetch(q, { headers: H });
        if (!r.ok) {
          const body = await r.text().catch(() => '');
          if (_isMissingColumn(r.status, body) && _degrade()) continue;
          throw new Error('HTTP ' + r.status);
        }
        const rows = await r.json();
        watermark = (rows[0] && rows[0][wcol()]) || new Date().toISOString();
        return;
      }
    }

    // Damgadan (OVERLAP_MS kadar geriden) sonrasını sayfalı çek.
    async function _fetchChanged() {
      const since = new Date(new Date(watermark).getTime() - OVERLAP_MS).toISOString();
      const sel = `${select},${wcol()}`;
      let all = [], offset = 0;
      while (true) {
        const q = `${url}/rest/v1/deals?select=${sel}` +
                  `&${wcol()}=gte.${encodeURIComponent(since)}` +
                  `&order=${wcol()}.asc,id.asc` +
                  `&limit=${PAGE}&offset=${offset}${scopeQuery}`;
        const r = await fetch(q, { headers: H });
        if (!r.ok) {
          const body = await r.text().catch(() => '');
          if (_isMissingColumn(r.status, body) && _degrade()) { await _initWatermark(); return []; }
          throw new Error('HTTP ' + r.status);
        }
        const batch = await r.json();
        if (!Array.isArray(batch) || !batch.length) break;
        all = all.concat(batch);
        if (batch.length < PAGE) break;
        offset += PAGE;
        // Emniyet supabı: bir turda 5000'den fazla değişiklik varsa (ör. toplu
        // Zoho yeniden senkronu) turu burada kes; kalanı sonraki tur alır.
        if (all.length >= 5000) break;
      }
      return all;
    }

    async function tick() {
      if (stopped || running) return;
      // Arka plandaki sekme boşuna sorgu atmasın; öne gelince zaten poke() ile
      // hemen bir tur çalıştırılıyor.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      running = true;
      try {
        if (watermark === null) { await _initWatermark(); return; }

        const rows = await _fetchChanged();
        if (!rows.length) return;

        const col = wcol();
        let maxW = watermark;
        const fresh = [];
        const seen = new Set();
        for (const row of rows) {
          const w = row[col];
          const k = String(row.id) + '|' + String(w);
          seen.add(k);
          if (!lastKeys.has(k)) fresh.push(row);
          if (w && String(w) > String(maxW)) maxW = w;
        }
        watermark = maxW;
        lastKeys = seen;

        if (fresh.length) onRows(fresh);
      } catch (e) {
        onError(e);
      } finally {
        running = false;
      }
    }

    function poke() {
      // Sekmeye dönüldüğünde birkaç olay üst üste gelebiliyor — kısa debounce.
      clearTimeout(pokeTimer);
      pokeTimer = setTimeout(tick, 250);
    }

    function onVis() { if (document.visibilityState === 'visible') poke(); }

    function stop() {
      stopped = true;
      clearInterval(timer);
      clearTimeout(pokeTimer);
      document.removeEventListener('visibilitychange', onVis);
    }

    // İlk damgayı hemen kur, ardından periyodik dön.
    tick();
    timer = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', onVis);

    return {
      stop,
      poke,
      // Kapsam değişince (RM bölge seçimi vb.) damgayı sıfırla — yeni kapsamın
      // eski değişiklikleri toptan akmasın.
      setScope(q) { scopeQuery = q || ''; watermark = null; lastKeys = new Set(); poke(); },
      get watermark() { return watermark; },
      get column()    { return wcol(); },
    };
  }

  // Bir liste içindeki satırları id'ye göre yerinde günceller / yenilerini ekler.
  // keyOf: liste elemanından id çıkaran fonksiyon (paneller 'Deal Id' kullanıyor).
  // Dönen değer: { updated, added } — çağıran render'ı buna göre atlayabilir.
  function mergeById(list, incoming, keyOf) {
    const idx = new Map();
    list.forEach((item, i) => idx.set(String(keyOf(item)), i));
    let updated = 0, added = 0;
    for (const row of incoming) {
      const k = String(keyOf(row));
      if (idx.has(k)) { list[idx.get(k)] = row; updated++; }
      else { idx.set(k, list.length); list.push(row); added++; }
    }
    return { updated, added };
  }

  return { watch, mergeById };
})();
