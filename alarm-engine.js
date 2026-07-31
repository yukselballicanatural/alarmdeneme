// alarm-engine.js — Natural Clinic Alarm Motor v1.0
// Supabase deals tablosundan otomatik alarm üretir, alarms tablosuna yazar.
window.AlarmEngine = (function () {
  'use strict';

  // Eşik gün pencereleri — her aralık bir öncekinin hemen üstünden başlar
  // Eşik listesi app_settings.alarm_thresholds parametresinden gelir (varsayılan 45,30,15,7,3)
  function buildThresholds(list) {
    const sorted = [...new Set(list)].filter(n => n > 0).sort((a, b) => b - a);
    return sorted.map((t, i) => ({
      t,
      min: (sorted[i + 1] || 0) + 1,
      max: t,
    }));
  }

  let THRESHOLDS = buildThresholds([45, 30, 15, 7, 3]);
  let MISSING_REPEAT_DAYS = 3;

  // Sistem geneli kesim: yalnızca created_time 2026 ve sonrası olan deallerden
  // alarm üret. (Önceki yıllar sistemden tamamen gizleniyor.)
  const CREATED_2026_Q = '&created_time=gte.2026-01-01T00:00:00';

  // app_settings tablosundan parametreleri yükle — tablo yoksa varsayılanlar kalır
  async function loadSettings(BASE, KEY) {
    try {
      const r = await fetch(`${BASE}/rest/v1/app_settings?select=key,value`, {
        headers: { apikey: KEY, Authorization: 'Bearer ' + KEY },
      });
      if (!r.ok) return;
      const rows = await r.json();
      for (const row of rows) {
        if (row.key === 'alarm_thresholds') {
          const nums = String(row.value).split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
          if (nums.length) THRESHOLDS = buildThresholds(nums);
        }
        if (row.key === 'missing_repeat_days') {
          const n = parseInt(row.value);
          if (!isNaN(n) && n > 0) MISSING_REPEAT_DAYS = n;
        }
      }
    } catch (e) { /* tablo henüz oluşturulmamış olabilir — varsayılanlarla devam */ }
  }

  const ACTIVE_STAGES = [
    'Waiting appointment', 'Reservation Pending', 'Approval',
    'Appointment confirmed', 'Waiting next visit',
    'Waiting hotel confirmation', 'On Hold', 'Check in completed',
  ];
  const ACTIVE_SET = new Set(ACTIVE_STAGES);

  // Bir tarihe kaç gün kaldığını hesapla (negatif = geçmiş)
  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const s = String(dateStr).split('T')[0];
    const d = new Date(s + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - today.getTime()) / 86400000);
  }

  // Epoch gününü periyoda böl → eksik tarih alarmı her N günde bir yenilenir
  function threeDayBucket() {
    return Math.floor(Math.floor(Date.now() / 86400000) / MISSING_REPEAT_DAYS);
  }

  // Takım adından bölge belirle — TeamMap varsa onu kullan
  function getRegion(team) {
    if (typeof window !== 'undefined' && window.TeamMap) return window.TeamMap.regionForTeam(team);
    return (team || '').toLowerCase().includes('morocco') ? 'Morocco' : 'Istanbul';
  }

  // deals.team varyantını kanonik takım adına çevir (TL panelindeki filtrelerle eşleşsin)
  function canonicalTeam(team) {
    if (typeof window !== 'undefined' && window.TeamMap) {
      return window.TeamMap.normalize(team) || team || '';
    }
    return team || '';
  }

  // deal.raw alanını parse et
  function getRaw(deal) {
    const r = deal.raw;
    if (!r) return {};
    if (typeof r === 'string') { try { return JSON.parse(r); } catch (e) { return {}; } }
    return r;
  }

  const ACTIVE_SET_LOWER = new Set(ACTIVE_STAGES.map(s => s.toLowerCase().trim()));

  // Bir deal için üretilmesi gereken alarm listesini hesapla
  function computeAlarms(deal) {
    if (!ACTIVE_SET_LOWER.has((deal.stage || '').toLowerCase().trim())) return [];

    const raw = getRaw(deal);

    // Tüm tarih/ödeme alanları raw JSONB'den okunuyor (tablo kolonları yok)
    // Zoho alan adları: Visit_Date = 1. vizit, Visit_Date1 = 2. vizit, Visit_Date2 = 3. vizit
    const pft          = raw.Payment_Or_Flight_Ticket || raw.payment_or_flight_ticket || null;
    const arrivalDate  = raw.Arrival_Date  || raw.arrival_date  || null;
    const lastActivity = raw.Last_Activity_Time || raw.last_activity_time || null;
    const v1 = raw.Visit_Date  || raw.Visit_Date_1 || null;
    const v2 = raw.Visit_Date1 || raw.Visit_Date_2 || null;
    const v3 = raw.Visit_Date2 || raw.Visit_Date_3 || null;

    const team   = canonicalTeam(deal.team);
    const region = getRegion(deal.team);
    const base = {
      deal_id:                  String(deal.id),
      deal_name:                deal.deal_name  || '',
      deal_owner:               deal.deal_owner || '',
      team,
      region,
      payment_or_flight_ticket: pft,
      status:                   'open',
      assigned_to:              team,
    };

    const alarms    = [];
    const isPayment = pft === 'Payment';
    const isFlight  = pft === 'Flight Ticket';

    // ── Arrival + Visit tarihleri ────────────────────────────────────
    const dateFields = [];

    // Hasta ZATEN GELMİŞ mi? Vizit tarihlerinden biri geçmişteyse gelmiş sayılır.
    // Böyle bir hastada arrival_date boş olsa bile "varış tarihi eksik" alarmı
    // anlamsız: ayarlanacak bir uçuş/karşılama kalmadı. Ölçümde 11 deal tam
    // bunu yaşıyordu — geri gelen hasta için hem arrival_missing hem vizit
    // alarmı açıktı, yani aynı hasta iki kart olarak görünüyordu.
    const alreadyArrived = [v1, v2, v3].some(v => {
      const d = daysUntil(v);
      return d !== null && d < 0;
    });

    if (!isPayment) {
      if (arrivalDate) {
        dateFields.push({ field: 'arrival_date', date: arrivalDate });
      } else if (alreadyArrived) {
        // gelmiş hasta — arrival_missing üretilmez
      } else {
        // Arrival date eksik → 3 günde bir tekrar alarm
        alarms.push({
          ...base,
          alarm_type:      'arrival_missing',
          reference_field: 'arrival_date',
          reference_date:  null,
          threshold_days:  null,
          days_remaining:  null,
          dedup_key:       `${deal.id}_arrival_missing_${threeDayBucket()}`,
        });
      }
    }

    if (v1) dateFields.push({ field: 'visit_date_1', date: v1 });
    if (v2) dateFields.push({ field: 'visit_date_2', date: v2 });
    if (v3) dateFields.push({ field: 'visit_date_3', date: v3 });

    // ── BİR HASTA = BİR KART ─────────────────────────────────────────
    // Önceden her tarih alanı (arrival + 3 vizit) için AYRI alarm üretiliyordu.
    // Sonuç: aynı hasta alarm listesinde 2-3 kez görünüyordu — ölçüm sırasında
    // 58 deal'de böyleydi ve 7'sinde tip bile aynıydı (today_patient hem
    // arrival_date hem visit_date_1 için, yani aynı gün iki özdeş kart).
    // Takım liderinin ihtiyacı olan şey "şu hastayla ilgilen" — tek kart.
    // Bu yüzden EN ACİL tarih seçilip yalnızca onun için alarm üretiliyor;
    // diğer tarihler deal detayında zaten görünüyor.
    // Eşitlikte arrival_date öne geçer (dateFields sırası: arrival, v1, v2, v3
    // ve karşılaştırma kesin `<` olduğu için ilk gelen kalır).
    let mostUrgent = null;
    for (const { field, date } of dateFields) {
      const days = daysUntil(date);
      if (days === null || days < 0) continue;   // geçmiş tarih alarm üretmez
      if (!mostUrgent || days < mostUrgent.days) mostUrgent = { field, date, days };
    }

    if (mostUrgent) {
      const { field, date, days } = mostUrgent;
      const dateStr = String(date).split('T')[0];
      const aType   = field === 'arrival_date' ? 'arrival_approaching' : 'visit_approaching';

      if (days === 0) {
        alarms.push({
          ...base,
          alarm_type:      'today_patient',
          reference_field: field,
          reference_date:  dateStr,
          threshold_days:  0,
          days_remaining:  0,
          // "Yaklaşıyor" (days>0) alarmıyla AYNI dedup_key kullanılır — aksi
          // halde hasta günü geldiğinde eski "Xg yaklaşıyor" alarmı kapanmadan
          // yeni bir "Bugün" alarmı daha açılıyor, aynı hasta için 2 kart
          // birden görünüyordu (bkz. ekran görüntüsü şikayeti).
          dedup_key:       `${deal.id}_${field}_${dateStr}`,
        });
      } else if (days > 0) {
        for (const { t, min, max } of THRESHOLDS) {
          if (days >= min && days <= max) {
            alarms.push({
              ...base,
              alarm_type:      aType,
              reference_field: field,
              reference_date:  dateStr,
              threshold_days:  t,
              days_remaining:  days,
              // Eşik (t) dedup_key'e DAHIL EDILMEZ — bkz. yukarıdaki açıklama.
              // Her hasta/tarih için tek alarm; hasta yaklaştıkça güncellenir.
              dedup_key:       `${deal.id}_${field}_${dateStr}`,
            });
            break;
          }
        }
      }
    }

    return alarms;
  }

  // Supabase'den TÜM aktif dealleri çek — takım filtresi YOK, motor global çalışır
  async function fetchActiveDeals(BASE, KEY) {
    const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
    // encodeURIComponent ile tüm filtre değerini encode et — Supabase JS client da böyle yapar
    const stageParam = encodeURIComponent('in.(' + ACTIVE_STAGES.map(s => '"' + s + '"').join(',') + ')');
    let all = [], offset = 0;
    while (true) {
      const url = `${BASE}/rest/v1/deals?stage=${stageParam}` +
        `&select=id,deal_name,deal_owner,stage,team,amount,total_paid_amount,raw` +
        CREATED_2026_Q +
        `&limit=500&offset=${offset}`;
      const r = await fetch(url, { headers: H });
      if (!r.ok) {
        let detail = '';
        try { const j = await r.json(); detail = j.message || j.hint || ''; } catch(e) {}
        throw new Error(`Deals alınamadı: HTTP ${r.status}${detail ? ' — ' + detail : ''}`);
      }
      const batch = await r.json();
      if (!Array.isArray(batch) || !batch.length) break;
      all.push(...batch);
      if (batch.length < 500) break;
      offset += 500;
    }
    return all;
  }

  // Alarmları Supabase'e yaz — dedup_key UNIQUE constraint tekrarı engeller
  async function insertAlarms(BASE, KEY, list) {
    if (!list.length) return { inserted: 0, total: 0 };
    const H = {
      apikey:         KEY,
      Authorization:  'Bearer ' + KEY,
      'Content-Type': 'application/json',
      Prefer:         'return=minimal,resolution=ignore-duplicates',
    };
    let inserted = 0;
    for (let i = 0; i < list.length; i += 100) {
      const r = await fetch(`${BASE}/rest/v1/alarms?on_conflict=dedup_key`, {
        method: 'POST', headers: H,
        body:   JSON.stringify(list.slice(i, i + 100)),
      });
      if (r.ok) inserted += Math.min(100, list.length - i);
    }
    return { inserted, total: list.length };
  }

  // Arrival Date girilmiş deallerin açık arrival_missing alarmlarını kapat
  async function closeStaleArrivalMissing(BASE, KEY, deals) {
    // Arrival Date artık dolu OLAN, ya da hasta ZATEN GELMİŞ olan deal ID'leri.
    // İkinci durum: vizit tarihlerinden biri geçmişteyse hasta gelmiş demektir;
    // arrival_date boş kalsa bile "varış tarihi eksik" alarmının açık durması
    // anlamsız (ayarlanacak uçuş/karşılama kalmadı) ve aynı hastayı vizit
    // alarmının yanında ikinci bir kart olarak gösteriyordu.
    const filledIds = [];
    for (const d of deals) {
      const raw = getRaw(d);
      const arrivalDate = raw.Arrival_Date || raw.arrival_date || null;
      const alreadyArrived = [
        raw.Visit_Date  || raw.Visit_Date_1 || null,
        raw.Visit_Date1 || raw.Visit_Date_2 || null,
        raw.Visit_Date2 || raw.Visit_Date_3 || null,
      ].some(v => { const n = daysUntil(v); return n !== null && n < 0; });
      if (arrivalDate || alreadyArrived) filledIds.push(String(d.id));
    }
    if (!filledIds.length) return 0;

    const H   = { apikey: KEY, Authorization: 'Bearer ' + KEY };
    const now = new Date().toISOString();
    const PH  = { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
    let closed = 0;

    // URL uzunluğu sınırı nedeniyle 200'lük gruplar halinde işle
    for (let i = 0; i < filledIds.length; i += 200) {
      const idList = filledIds.slice(i, i + 200).join(',');
      const r = await fetch(
        `${BASE}/rest/v1/alarms?alarm_type=eq.arrival_missing&status=in.(open,seen,in_progress)&deal_id=in.(${idList})&select=id`,
        { headers: H }
      );
      if (!r.ok) continue;
      const toClose = await r.json();
      if (!toClose.length) continue;

      const idListAlarms = toClose.map(a => a.id).join(',');
      const pr = await fetch(
        `${BASE}/rest/v1/alarms?id=in.(${idListAlarms})`,
        { method: 'PATCH', headers: PH,
          body: JSON.stringify({ status: 'closed', close_reason: 'date_added', closed_at: now, closed_by: 'system' }) }
      );
      if (pr.ok) closed += toClose.length;
    }
    return closed;
  }

  // Aynı (deal, alan, tarih) için birden fazla AKTİF alarm varsa fazlalıkları
  // kapat. Eski motor sürümleri farklı dedup_key formatları kullandığı için
  // (eşik dahil: "..._15_...", bugün ayrı: "..._today_...") geçmişte üretilen
  // satırlar yeni formatla çakışmıyor ve aynı hasta 2+ kart görünüyordu.
  // SQL ile tek seferlik temizlik yeterli olmadı çünkü eski satır dururken
  // motor yeni formatta bir satır daha ekliyordu. Bu adım her motor
  // çalışmasında dedup'u garanti eder: YENİ format anahtarlı satır tutulur
  // (gelecek upsert'ler onunla çakışıp ignore edilir), diğerleri kapatılır.
  async function closeDuplicateAlarms(BASE, KEY) {
    const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
    const ACTIVE = 'in.(open,seen,in_progress,escalated,arrived,examined,processing)';

    async function fetchActive(extraFilter, select) {
      const out = [];
      let offset = 0;
      while (true) {
        const url = `${BASE}/rest/v1/alarms?status=${ACTIVE}${extraFilter}` +
          `&select=${select}&limit=1000&offset=${offset}`;
        const r = await fetch(url, { headers: H });
        if (!r.ok) break;
        const batch = await r.json();
        if (!Array.isArray(batch) || !batch.length) break;
        out.push(...batch);
        if (batch.length < 1000) break;
        offset += 1000;
      }
      return out;
    }

    // alarm_type DAHİL: aşağıdaki "bir hasta = bir kart" adımı tipe göre süzüyor.
    const rows = await fetchActive('&reference_date=not.is.null',
      'id,deal_id,alarm_type,reference_field,reference_date,dedup_key,created_at');

    // ── arrival_missing (reference_date NULL) ──────────────────────────
    // Bu tip, arrival_date girilene kadar MISSING_REPEAT_DAYS'de bir yeniden
    // hatırlatmak için her periyotta YENİ bir dedup_key üretiyor
    // (`${deal.id}_arrival_missing_${threeDayBucket()}`). Amaç hatırlatmaydı ama
    // önceki periyodun satırı kapatılmadığı için alarmlar ÜST ÜSTE BİRİKİYORDU:
    // tarihi aylarca eksik kalan bir deal 9-10 özdeş kart gösteriyor, takım
    // liderinin alarm sayısı gerçek problem sayısının kat kat üstüne çıkıyordu.
    //
    // Yukarıdaki sorgu `reference_date=not.is.null` filtresi kullandığı için bu
    // tip dedup'un TAMAMEN DIŞINDA kalıyordu (arrival_missing'in reference_date'i
    // null). alarm_dedup_cleanup_v2.sql de aynı nedenle bunlara dokunmuyordu.
    //
    // Çözüm: deal başına yalnızca EN GÜNCEL periyodun satırı aktif kalır,
    // eskiler 'duplicate' olarak kapatılır. Periyot mekanizması korunuyor —
    // lider alarmı kapatıp tarih hâlâ eksikse 3 gün sonra yeni satır yine açılır.
    const missingRows = await fetchActive('&reference_date=is.null&alarm_type=eq.arrival_missing',
      'id,deal_id,alarm_type,dedup_key,created_at');

    if (!rows.length && !missingRows.length) return 0;

    // Eski format anahtar: "..._today_..." veya eşik içeren "..._15_2026-…"
    const isLegacyKey = (k) => !k || k.includes('_today_') || /_\d+_\d{4}-\d{2}-\d{2}$/.test(k);

    const groups = new Map();
    for (const a of rows) {
      const g = `${a.deal_id}|${a.reference_field}|${a.reference_date}`;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(a);
    }

    const toClose = [];
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      // Tutulacak satır: önce YENİ format anahtarlı olan (en yenisi),
      // hiç yoksa en son oluşturulan.
      const modern = list.filter(a => !isLegacyKey(a.dedup_key));
      const pool = modern.length ? modern : list;
      pool.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const keepId = pool[0].id;
      for (const a of list) if (a.id !== keepId) toClose.push(a.id);
    }

    // arrival_missing: deal başına en güncel periyot kalır (bkz. yukarıdaki not).
    const missingGroups = new Map();
    for (const a of missingRows) {
      if (!missingGroups.has(a.deal_id)) missingGroups.set(a.deal_id, []);
      missingGroups.get(a.deal_id).push(a);
    }
    for (const list of missingGroups.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      for (let i = 1; i < list.length; i++) toClose.push(list[i].id);
    }

    // ── BİR HASTA = BİR KART (tarih bazlı tipler) ─────────────────────
    // computeAlarms artık deal başına yalnızca EN ACİL tarih için alarm üretiyor,
    // ama geçmişte her tarih alanı (arrival + 3 vizit) için ayrı alarm üretilmişti:
    // ölçümde 58 deal'de aynı hasta 2-3 kart olarak görünüyordu. Yukarıdaki
    // (deal, alan, tarih) grubu bunları YAKALAMIYOR çünkü alanları farklı.
    // Burada deal başına tek aktif kart bırakılıyor: en YAKIN tarihli olan.
    const DATE_TYPES = new Set(['arrival_approaching', 'visit_approaching', 'today_patient']);
    const perDeal = new Map();
    for (const a of rows) {
      if (!DATE_TYPES.has(a.alarm_type)) continue;
      if (!a.reference_date) continue;
      if (!perDeal.has(a.deal_id)) perDeal.set(a.deal_id, []);
      perDeal.get(a.deal_id).push(a);
    }
    for (const list of perDeal.values()) {
      if (list.length < 2) continue;
      // En yakın tarih (bugün/en acil) kalır; eşitlikte en son oluşturulan.
      list.sort((a, b) =>
        String(a.reference_date).localeCompare(String(b.reference_date)) ||
        String(b.created_at).localeCompare(String(a.created_at)));
      const keepId = list[0].id;
      for (const a of list) if (a.id !== keepId) toClose.push(a.id);
    }

    // Aynı id birden fazla kuraldan işaretlenebilir ((deal,alan,tarih) grubu ve
    // "bir hasta = bir kart" adımı) — tekilleştir, aksi halde aynı satır için
    // gereksiz PATCH atılır ve sayaç şişer.
    const uniqueToClose = [...new Set(toClose)];
    if (!uniqueToClose.length) return 0;

    // Tek motor çalışmasında yapılacak kapatma sayısı sınırlı: geçmişte
    // birikmiş büyük bir yığın (ölçüm sırasında 14.030 satır) tek seferde
    // 140+ ardışık PATCH demek olurdu ve tarayıcıda arka planda çalışan motoru
    // dakikalarca meşgul ederdi. Kalanı bir sonraki çalışmada temizlenir.
    // Toplu geçmiş temizliği için alarm_dedup_cleanup_v3_arrival_missing.sql.
    const MAX_CLOSE_PER_RUN = 2000;
    const batchIds = uniqueToClose.slice(0, MAX_CLOSE_PER_RUN);

    const now = new Date().toISOString();
    const PH = { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
    let closed = 0;
    for (let i = 0; i < batchIds.length; i += 100) {
      const slice = batchIds.slice(i, i + 100);
      const pr = await fetch(`${BASE}/rest/v1/alarms?id=in.(${slice.join(',')})`, {
        method: 'PATCH', headers: PH,
        body: JSON.stringify({ status: 'closed', close_reason: 'duplicate', closed_at: now, closed_by: 'system' }),
      });
      if (pr.ok) closed += slice.length;
    }
    return closed;
  }

  // ── Motorun KAPSAMI DIŞINDAKİ deallerin açık alarmlarını kapat ─────────
  // fetchActiveDeals iki filtre uyguluyor: created_time >= 2026-01-01 ve
  // stage ∈ ACTIVE_STAGES. Bu filtrelerin dışına düşen bir deal'in alarmları
  // motor tarafından bir daha ASLA görülmüyor — ne güncellenebiliyor ne
  // kapatılabiliyor. Ölçümde 802 alarm bu durumdaydı (745'i arrival_missing),
  // yani panelde görünen alarmların ~%33'ü hiç temizlenemeyen bayat kayıttı.
  // Örnek: 2025'te açılmış, hastası çoktan gelmiş dealler aylardır "varış
  // tarihi eksik" kartı gösteriyordu.
  async function closeOutOfScopeAlarms(BASE, KEY, deals) {
    // GÜVENLİK: deal listesi boş/eksik geldiyse hiçbir şey kapatma — aksi halde
    // geçici bir sorgu hatası tüm alarmları süpürebilirdi.
    if (!deals || !deals.length) return 0;
    const inScope = new Set(deals.map(d => String(d.id)));
    const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };

    let rows = [], offset = 0;
    while (true) {
      const r = await fetch(
        `${BASE}/rest/v1/alarms?status=in.(open,seen,in_progress,escalated)` +
        `&select=id,deal_id&limit=1000&offset=${offset}`, { headers: H });
      if (!r.ok) return 0;
      const b = await r.json();
      if (!Array.isArray(b) || !b.length) break;
      rows.push(...b);
      if (b.length < 1000) break;
      offset += 1000;
    }
    const suspect = rows.filter(a => !inScope.has(String(a.deal_id)));
    if (!suspect.length) return 0;

    // Şüpheliyi DOĞRULA: deal'e bakıp gerçekten kapsam dışı mı diye teyit et.
    // (Sadece "listede yoktu" demek yetmez — sayfalama kaçırmış olabilir.)
    const ids = [...new Set(suspect.map(a => String(a.deal_id)))];
    const outOfScope = new Set();
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const r = await fetch(
        `${BASE}/rest/v1/deals?id=in.(${chunk.join(',')})&select=id,stage,created_time`,
        { headers: H });
      if (!r.ok) continue;   // teyit edilemedi → dokunma
      const found = await r.json();
      const byId = new Map((found || []).map(d => [String(d.id), d]));
      for (const id of chunk) {
        const d = byId.get(id);
        if (!d) { outOfScope.add(id); continue; }          // deal silinmiş
        const tooOld   = !d.created_time || String(d.created_time) < '2026-01-01';
        const badStage = !ACTIVE_SET_LOWER.has(String(d.stage || '').toLowerCase().trim());
        if (tooOld || badStage) outOfScope.add(id);
      }
    }
    const toClose = suspect.filter(a => outOfScope.has(String(a.deal_id))).map(a => a.id);
    if (!toClose.length) return 0;

    const now = new Date().toISOString();
    const PH = { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
    let closed = 0;
    for (let i = 0; i < toClose.length; i += 100) {
      const slice = toClose.slice(i, i + 100);
      const r = await fetch(`${BASE}/rest/v1/alarms?id=in.(${slice.join(',')})`, {
        method: 'PATCH', headers: PH,
        body: JSON.stringify({
          status: 'closed', close_reason: 'out_of_scope',
          closed_at: now, closed_by: 'system',
        }),
      });
      if (r.ok) closed += slice.length;
    }
    return closed;
  }

  // Stage'i "Cancelled" (veya iptal anlamına gelen bir varyant) olan deallerin
  // hâlâ açık kalmış alarmlarını iptal et — deal iptal olunca alarm da iptal sayılır
  async function closeAlarmsForCancelledDeals(BASE, KEY) {
    const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
    const stageParam = encodeURIComponent('ilike.*cancel*');
    let dealIds = [], offset = 0;
    while (true) {
      const url = `${BASE}/rest/v1/deals?stage=${stageParam}&select=id${CREATED_2026_Q}&limit=1000&offset=${offset}`;
      const r = await fetch(url, { headers: H });
      if (!r.ok) break;
      const batch = await r.json();
      if (!Array.isArray(batch) || !batch.length) break;
      dealIds.push(...batch.map(d => String(d.id)));
      if (batch.length < 1000) break;
      offset += 1000;
    }
    if (!dealIds.length) return 0;

    const now = new Date().toISOString();
    const PH  = { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
    let cancelled = 0;

    for (let i = 0; i < dealIds.length; i += 200) {
      const idList = dealIds.slice(i, i + 200).join(',');
      const r = await fetch(
        `${BASE}/rest/v1/alarms?status=in.(open,seen,in_progress,escalated,arrived,examined,processing)&deal_id=in.(${idList})&select=id`,
        { headers: H }
      );
      if (!r.ok) continue;
      const toCancel = await r.json();
      if (!toCancel.length) continue;

      const idListAlarms = toCancel.map(a => a.id).join(',');
      const pr = await fetch(
        `${BASE}/rest/v1/alarms?id=in.(${idListAlarms})`,
        { method: 'PATCH', headers: PH,
          body: JSON.stringify({ status: 'cancelled', close_reason: 'deal_cancelled', closed_at: now, closed_by: 'system' }) }
      );
      if (pr.ok) cancelled += toCancel.length;
    }
    return cancelled;
  }

  // Stage'i Won VE bakiyesi tamamen ödenmiş (ödenen >= tutar) deallerin hâlâ
  // açık kalan TÜM alarmlarını kapat — iş tamamlandı, hatırlatmaya gerek yok.
  // fetchActiveDeals() Won'u zaten dışarıda bıraktığı için (ACTIVE_STAGES'e
  // dahil değil) burada Won dealleri ayrıca, doğrudan çekiyoruz.
  async function closeAlarmsForWonPaidDeals(BASE, KEY) {
    const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
    const stageParam = encodeURIComponent('ilike.*won*');
    let deals = [], offset = 0;
    while (true) {
      const url = `${BASE}/rest/v1/deals?stage=${stageParam}&select=id,amount,total_paid_amount${CREATED_2026_Q}&limit=1000&offset=${offset}`;
      const r = await fetch(url, { headers: H });
      if (!r.ok) break;
      const batch = await r.json();
      if (!Array.isArray(batch) || !batch.length) break;
      deals.push(...batch);
      if (batch.length < 1000) break;
      offset += 1000;
    }
    const paidIds = deals
      .filter(d => (Number(d.amount) || 0) > 0 && (Number(d.total_paid_amount) || 0) >= Number(d.amount))
      .map(d => String(d.id));
    if (!paidIds.length) return 0;

    const now = new Date().toISOString();
    const PH  = { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
    let closed = 0;

    for (let i = 0; i < paidIds.length; i += 200) {
      const idList = paidIds.slice(i, i + 200).join(',');
      const r = await fetch(
        `${BASE}/rest/v1/alarms?status=in.(open,seen,in_progress,escalated,arrived,examined,processing)&deal_id=in.(${idList})&select=id`,
        { headers: H }
      );
      if (!r.ok) continue;
      const toClose = await r.json();
      if (!toClose.length) continue;

      const idListAlarms = toClose.map(a => a.id).join(',');
      const pr = await fetch(
        `${BASE}/rest/v1/alarms?id=in.(${idListAlarms})`,
        { method: 'PATCH', headers: PH,
          body: JSON.stringify({ status: 'closed', close_reason: 'Ödeme %100 ve deal Won — otomatik kapatıldı', closed_at: now, closed_by: 'system' }) }
      );
      if (pr.ok) closed += toClose.length;
    }
    return closed;
  }

  // Zoho_Deals_Alarm_Yonetimi.md: "Arrival Date ileri bir tarihe değiştirildi
  // → eski Bugün/Yaklaşan/Gecikmiş alarmı otomatik kapanır, yeni tarihe göre
  // yeni alarm oluşturulur" (aynı kural visit_date_1/2/3 için de geçerli).
  // computeAlarms() dedup_key'i {deal_id}_{field}_{tarih} olarak ürettiği için
  // tarih değişince YENİ bir satır eklenir ama ESKİ satır kapanmadan açık
  // kalırdı (mükerrer/yanlış "gecikmiş" görünümüne yol açar). Bu fonksiyon her
  // motor çalışmasında, açık arrival/visit alarmlarının reference_date'ini
  // deal'in GÜNCEL tarih alanıyla karşılaştırır; eşleşmiyorsa (tarih
  // değişmiş veya silinmiş) alarmı kapatır.
  async function closeStaleDateAlarms(BASE, KEY, deals) {
    const norm = (v) => (v ? String(v).split('T')[0] : null);
    const currentByDeal = new Map();
    for (const d of deals) {
      const raw = getRaw(d);
      currentByDeal.set(String(d.id), {
        arrival_date: norm(raw.Arrival_Date || raw.arrival_date || null),
        visit_date_1: norm(raw.Visit_Date  || raw.Visit_Date_1 || null),
        visit_date_2: norm(raw.Visit_Date1 || raw.Visit_Date_2 || null),
        visit_date_3: norm(raw.Visit_Date2 || raw.Visit_Date_3 || null),
      });
    }
    const dealIds = [...currentByDeal.keys()];
    if (!dealIds.length) return 0;

    const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
    let openAlarms = [];
    for (let i = 0; i < dealIds.length; i += 200) {
      const idList = dealIds.slice(i, i + 200).join(',');
      const r = await fetch(
        `${BASE}/rest/v1/alarms?status=in.(open,seen,in_progress,escalated)` +
        `&alarm_type=in.(arrival_approaching,visit_approaching,today_patient)` +
        `&deal_id=in.(${idList})&select=id,deal_id,reference_field,reference_date`,
        { headers: H }
      );
      if (!r.ok) continue;
      const batch = await r.json();
      if (Array.isArray(batch)) openAlarms.push(...batch);
    }
    if (!openAlarms.length) return 0;

    const toClose = [];
    for (const a of openAlarms) {
      const cur = currentByDeal.get(String(a.deal_id));
      if (!cur || !(a.reference_field in cur)) continue;
      const curDate = cur[a.reference_field];
      const alarmDate = norm(a.reference_date);
      if (curDate !== alarmDate) toClose.push({ id: a.id, field: a.reference_field, wasRemoved: !curDate });
    }
    if (!toClose.length) return 0;

    const now = new Date().toISOString();
    const PH = { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
    let closed = 0;
    // Kapanış nedenini (silindi/güncellendi) ve alanı gruplu şekilde işaretle
    const groups = new Map();
    for (const item of toClose) {
      const isArrival = item.field === 'arrival_date';
      const reason = item.wasRemoved
        ? (isArrival ? 'Arrival Date Removed' : 'Visit Date Removed')
        : (isArrival ? 'Arrival Date Updated' : 'Visit Date Updated');
      if (!groups.has(reason)) groups.set(reason, []);
      groups.get(reason).push(item.id);
    }
    for (const [reason, ids] of groups) {
      for (let i = 0; i < ids.length; i += 100) {
        const idList = ids.slice(i, i + 100).join(',');
        const pr = await fetch(`${BASE}/rest/v1/alarms?id=in.(${idList})`, {
          method: 'PATCH', headers: PH,
          body: JSON.stringify({ status: 'closed', close_reason: reason, closed_at: now, closed_by: 'system' }),
        });
        if (pr.ok) closed += Math.min(100, ids.length - i);
      }
    }
    return closed;
  }

  // ── Ana çalıştırma — her zaman TÜM takımlar için üretir ─────────
  const _t = (s) => (typeof I18N !== 'undefined' ? I18N.t(s) : s);
  async function run(BASE, KEY, opts = {}) {
    const { onProgress } = opts;
    if (onProgress) onProgress(_t('Parametreler yükleniyor...'));
    await loadSettings(BASE, KEY);
    if (onProgress) onProgress(_t('Aktif deallar alınıyor...'));
    const deals = await fetchActiveDeals(BASE, KEY);
    if (onProgress) onProgress(`${deals.length} ${_t('deal için alarm hesaplanıyor...')}`);
    const newAlarms = [];
    for (const deal of deals) newAlarms.push(...computeAlarms(deal));
    if (onProgress) onProgress(`${newAlarms.length} ${_t('alarm kaydediliyor (dedup aktif)...')}`);
    const result = await insertAlarms(BASE, KEY, newAlarms);
    // Arrival/Visit tarihi değişen veya silinen deallerin ESKİ (artık tarihi
    // uyuşmayan) alarmlarını kapat — bkz. Zoho_Deals_Alarm_Yonetimi.md
    if (onProgress) onProgress(_t('Tarihi değişen alarmlar kapatılıyor...'));
    const staleDateCount = await closeStaleDateAlarms(BASE, KEY, deals);
    // Aynı hasta/tarih için birden fazla aktif alarm kalmışsa fazlalıkları kapat
    if (onProgress) onProgress(_t('Kopya alarmlar temizleniyor...'));
    const dedupCount = await closeDuplicateAlarms(BASE, KEY);
    // Arrival Date artık dolu olan deallerin eksik tarih alarmlarını kapat
    if (onProgress) onProgress(_t('Tarih girilen alarmlar kapatılıyor...'));
    const closedCount = await closeStaleArrivalMissing(BASE, KEY, deals);
    // Stage'i Cancelled olan deallerin açık kalan alarmlarını iptal et
    if (onProgress) onProgress(_t('İptal olan dealler için alarmlar kapatılıyor...'));
    const cancelledCount = await closeAlarmsForCancelledDeals(BASE, KEY);
    // Won + ödemesi %100 tamamlanmış deallerin açık kalan alarmlarını kapat
    if (onProgress) onProgress(_t('Won ve ödemesi tamamlanan dealler için alarmlar kapatılıyor...'));
    const wonPaidCount = await closeAlarmsForWonPaidDeals(BASE, KEY);
    // Motorun kapsamı dışına düşmüş deallerin (2026 öncesi / aktif olmayan
    // stage / silinmiş) açık alarmlarını kapat — bkz. closeOutOfScopeAlarms.
    if (onProgress) onProgress(_t('Kapsam dışı dealler için alarmlar kapatılıyor...'));
    const outOfScopeCount = await closeOutOfScopeAlarms(BASE, KEY, deals);
    return { deals: deals.length, generated: newAlarms.length, closed: closedCount, cancelled: cancelledCount, deduped: dedupCount, wonPaid: wonPaidCount, staleDateClosed: staleDateCount, outOfScope: outOfScopeCount, ...result };
  }

  return { run, computeAlarms, daysUntil, getRegion, ACTIVE_STAGES, closeStaleArrivalMissing, closeAlarmsForCancelledDeals, closeDuplicateAlarms, closeAlarmsForWonPaidDeals, closeStaleDateAlarms, closeOutOfScopeAlarms };
})();
