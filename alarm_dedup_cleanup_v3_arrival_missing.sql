-- ============================================================
-- ALARM KOPYA TEMİZLİĞİ v3 — arrival_missing birikmesi
-- Supabase SQL Editor'de BİR KEZ çalıştır.
-- ============================================================
--
-- SORUN
-- 'arrival_missing' alarmı, arrival_date girilene kadar 3 günde bir yeniden
-- hatırlatmak için her periyotta YENİ bir dedup_key üretiyor
-- (alarm-engine.js: `${deal.id}_arrival_missing_${threeDayBucket()}`).
-- Amaç hatırlatmaydı ama önceki periyodun satırı KAPATILMIYORDU, dolayısıyla
-- alarmlar üst üste birikiyordu. Tarihi aylarca eksik kalan bir deal 9-10
-- özdeş kart gösteriyor.
--
-- NEDEN ÖNCEKİ TEMİZLİKLER YAKALAMADI
-- alarm_dedup_cleanup_v2.sql ve motordaki closeDuplicateAlarms(), ikisi de
-- `reference_date IS NOT NULL` koşuluyla çalışıyordu. arrival_missing'in
-- reference_date'i NULL olduğu için bu tip dedup'un TAMAMEN dışında kaldı.
--
-- ÖLÇÜM (bu betik yazılırken, canlı veri)
--   toplam alarm                      : 22.951
--   panelde görünebilir (aktif, payment_tracking hariç) : 16.317
--   mükerrer yaşayan deal              : 1.860
--   bu deallerin ürettiği alarm        : 15.890
--   gereksiz fazlalık                  : 14.030
-- Yani görünen alarmların ~%86'sı aynı problemin kopyasıydı.
--
-- MANTIK
-- Aktif durumdaki arrival_missing alarmlarında, deal başına yalnızca EN GÜNCEL
-- olanı (en son created_at) aktif bırakır, diğerlerini 'closed' yapar.
-- SİLMEZ — close_reason='duplicate' ile kapatır, böylece geçmiş denetlenebilir
-- kalır ve alarm_logs'taki referanslar kırılmaz.
--
-- Periyot mekanizması KORUNUR: takım lideri alarmı kapatıp arrival_date hâlâ
-- eksikse, 3 gün sonra motor yeni bir satır açmaya devam eder.
--
-- Motor da düzeltildi (alarm-engine.js closeDuplicateAlarms artık bu tipi de
-- kapsıyor), yani bu birikme tekrar oluşmaz. Bu betik geçmişi temizler.

-- ── Önce ne olacağını gör (yazma yok) ──────────────────────
SELECT count(*) AS kapatilacak_alarm,
       count(DISTINCT deal_id) AS etkilenen_deal
  FROM (
    SELECT id, deal_id,
           row_number() OVER (PARTITION BY deal_id ORDER BY created_at DESC, id DESC) AS rn
      FROM public.alarms
     WHERE alarm_type = 'arrival_missing'
       AND reference_date IS NULL
       AND status IN ('open','seen','in_progress','escalated','arrived','examined','processing')
  ) t
 WHERE rn > 1;


-- ── Temizliği uygula ───────────────────────────────────────
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY deal_id ORDER BY created_at DESC, id DESC) AS rn
    FROM public.alarms
   WHERE alarm_type = 'arrival_missing'
     AND reference_date IS NULL
     AND status IN ('open','seen','in_progress','escalated','arrived','examined','processing')
)
UPDATE public.alarms a
   SET status      = 'closed',
       close_reason = 'duplicate',
       closed_at   = now(),
       closed_by   = 'system'
  FROM ranked r
 WHERE a.id = r.id
   AND r.rn > 1;


-- ── Doğrulama: 0 satır dönmeli ─────────────────────────────
SELECT deal_id, count(*)
  FROM public.alarms
 WHERE alarm_type = 'arrival_missing'
   AND reference_date IS NULL
   AND status IN ('open','seen','in_progress','escalated','arrived','examined','processing')
 GROUP BY deal_id
HAVING count(*) > 1;
