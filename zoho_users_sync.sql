-- ============================================================
-- ZOHO KULLANICI AYNASI + Users YAŞAM DÖNGÜSÜ
-- Supabase SQL Editor'e yapıştır ve çalıştır.
-- ============================================================
--
-- SORUN
-- Users tablosunda kullanıcının AKTİF olup olmadığını gösteren hiçbir alan
-- yoktu (is_active / status / left_at / created_at — hiçbiri). Sonucu:
--   * İşten ayrılan birinin girişi süresiz çalışmaya devam ediyor.
--   * Ayrılan kişi "Takımımdaki Kişiler" ve "Günlük Ekip Girişi" listelerinde
--     görünmeye devam ediyor, takım lideri her gün onun için satır görüyor.
--   * Kimin gerçekte çalıştığı yalnızca elle bakımla güncel tutuluyor.
--
-- Zoho tarafındaki gerçeği deals tablosundan ÇIKARAMIYORUZ: deals.raw.Owner
-- yalnızca deal SAHİBİ olanları veriyor (275 kişi) ve aktif/pasif bayrağı
-- taşımıyor. Bu yüzden Zoho'nun Users (org kullanıcıları) modülü ayrı bir
-- tabloya aynalanıyor ve Users onunla uzlaştırılıyor.

-- ── 1. Zoho kullanıcı aynası ────────────────────────────────
-- Bu tabloyu DIŞ SENKRON (deals'i yazan aynı iş akışı) doldurur.
-- deals tablosuyla aynı desen: kanonik alanlar + tam ham kayıt (raw).
CREATE TABLE IF NOT EXISTS public.zoho_users (
    id           text PRIMARY KEY,          -- Zoho user id (raw.Owner.id ile aynı uzay)
    full_name    text,                      -- Zoho: full_name  → Users."Deal Owner Name" ile eşlenir
    email        text,
    role         text,                      -- Zoho: role.name
    profile      text,                      -- Zoho: profile.name
    team         text,                      -- Zoho'da takım/grup alanı (deals.team ile aynı yazım uzayı)
    status       text,                      -- Zoho: status ('active' | 'inactive' | 'deleted')
    is_confirmed boolean,                   -- Zoho: confirm
    raw          jsonb,                     -- tam ham kayıt (yeni alanlar için şema değişikliği gerekmesin)
    synced_at    timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.zoho_users ENABLE ROW LEVEL SECURITY;

-- Users tablosuyla AYNI sertlik: bu ayna kim çalışıyor/kim ayrıldı bilgisini
-- ve kurumsal e-postaları taşıyor — tarayıcıdaki anon key'e kapalı, yalnızca
-- service_role (api/* uçları) okur. Politika YOK demek = anon'a erişim yok.
-- (bkz. users_rls_lockdown.sql — Users için aynı yaklaşım.)

CREATE INDEX IF NOT EXISTS zoho_users_full_name_idx ON public.zoho_users(lower(full_name));
CREATE INDEX IF NOT EXISTS zoho_users_email_idx     ON public.zoho_users(lower(email));
CREATE INDEX IF NOT EXISTS zoho_users_status_idx    ON public.zoho_users(status);

COMMENT ON TABLE public.zoho_users IS
  'Zoho Users (org kullanicilari) modulunun aynasi. Dis senkron doldurur; '
  'api/sync-user-teams.js buradan Users."Takim Adi" ve aktiflik durumunu uzlastirir.';


-- ── 2. Users yaşam döngüsü kolonları ────────────────────────
ALTER TABLE public."Users"
  ADD COLUMN IF NOT EXISTS "zoho_user_id"        text,
  -- VARSAYILAN true: bu betik çalıştıktan sonra da mevcut davranış birebir
  -- korunur. Kimse otomatik kapatılmaz; kapatma yalnızca zoho_users'ta
  -- status<>'active' görüldüğünde ya da admin elle yaptığında olur.
  ADD COLUMN IF NOT EXISTS "is_active"           boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "deactivated_at"      timestamptz,
  ADD COLUMN IF NOT EXISTS "deactivation_reason" text,
  ADD COLUMN IF NOT EXISTS "updated_at"          timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS users_is_active_idx    ON public."Users"("is_active");
CREATE INDEX IF NOT EXISTS users_zoho_user_id_idx ON public."Users"("zoho_user_id");

COMMENT ON COLUMN public."Users"."is_active" IS
  'false ise api/login.js girisi REDDEDER ve kisi Takimimdaki Kisiler / Gunluk '
  'Ekip Girisi listelerinde gorunmez. Kayit SILINMEZ: daily_performance, '
  'alarm_logs ve audit gecmisi bu satira bagli oldugu icin korunur.';


-- ── 3. Zoho user id eşleştirmesi (geriye dönük, tek seferlik) ──
-- Mevcut Users satırlarını deals.raw.Owner üzerinden Zoho id'sine bağla.
-- İsim eşlemesi: küçük harf + fazla boşluk sadeleştirme (uygulamadaki
-- nameKey() ile aynı mantık).
WITH zoho_owners AS (
  SELECT DISTINCT
         raw->'Owner'->>'id'   AS zid,
         lower(regexp_replace(raw->'Owner'->>'name', '\s+', ' ', 'g')) AS zname
    FROM public.deals
   WHERE raw->'Owner'->>'id' IS NOT NULL
)
UPDATE public."Users" u
   SET "zoho_user_id" = z.zid
  FROM zoho_owners z
 WHERE u."zoho_user_id" IS NULL
   AND lower(regexp_replace(trim(COALESCE(u."Deal Owner Name", u."Username")), '\s+', ' ', 'g')) = trim(z.zname);


-- ── Doğrulama ──────────────────────────────────────────────
-- Kaç Users satırı Zoho id'sine bağlandı / bağlanamadı:
--   SELECT count(*) FILTER (WHERE "zoho_user_id" IS NOT NULL) AS eslesen,
--          count(*) FILTER (WHERE "zoho_user_id" IS NULL)     AS eslesmeyen
--     FROM public."Users";
--
-- Eşleşmeyenler (isim Zoho'daki ile birebir tutmuyor olabilir):
--   SELECT "Username", "Deal Owner Name", "Role", "Takim Adi"
--     FROM public."Users" WHERE "zoho_user_id" IS NULL ORDER BY "Deal Owner Name";


-- ── DIŞ SENKRONA VERİLECEK SÖZLEŞME ────────────────────────
-- Zoho API: GET https://www.zohoapis.eu/crm/v8/users?type=AllUsers
-- (AllUsers pasifleri de döndürür — ayrılanları görmek için ŞART; yalnızca
--  ActiveUsers çekilirse ayrılan kişi listeden düşer ama biz onu "ayrıldı"
--  olarak İŞARETLEYEMEYİZ, sadece hiç görmeyiz.)
--
-- Her kullanıcı için upsert (on conflict id):
--   id           <- id
--   full_name    <- full_name
--   email        <- email
--   role         <- role.name
--   profile      <- profile.name
--   team         <- (Zoho'daki takım alanı; deals.Team ile aynı yazımda olmalı)
--   status       <- status
--   is_confirmed <- confirm
--   raw          <- kullanıcı kaydının tamamı
--   synced_at    <- now()
--
-- Sıklık: günde bir yeterli (deals gibi 5 dakikada bir olmasına gerek yok).
