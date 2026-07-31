-- ============================================================
-- Users."Takim Adi" <- deals.team (Zoho gercegi) — SQL ile senkron
-- Supabase SQL Editor'e yapistir. 3 adim: ONIZLE -> UYGULA -> EKSIKLERI GOR
-- ============================================================
--
-- NEDEN
-- Bir danisman Zoho'da takim degistirdiginde bu yalnizca deals tablosuna
-- yansiyor; Users."Takim Adi" elle bakimli oldugu icin kisi ESKI takiminda
-- kaliyor. Sonucu: yeni takim liderinin "Takimimdaki Kisiler" ve "Gunluk Ekip
-- Girisi" sayfalari BOS goruntuluyor — Moutaharrik Team - Morocco'da tam bu
-- oldu: Adam Naciri / Rim El Amrani / Malak Fadili deals'te bu takimda ama
-- Users'ta eski takimlarinda kalmis.
--
-- KURAL: kisinin EN SON deal'inin takimi = guncel takimi.
-- Canli veriyle dogrulandi (49.937 deal / 337 deal sahibi): 334 sahip tek
-- takimda hic gecis yok, 2 sahipte gecis var ve TEMIZ/kronolojik, 1 sahip
-- satis disi bir birime (Executive Board) gidip geliyor ve o birim elenıyor.
--
-- GUVENLIK
--   * Yalnizca TANINAN satis takimlari yazilir. Profclinic / Finance / VIP Team /
--     Executive Board / Aftercare gibi birimler ve taninmayan adlar Users'a
--     YAZILMAZ ("Takim Adi" yetki kapsamini belirliyor).
--   * Yonetici rolleri DISLANIR: takimlari goreve gore atanir, deallerden
--     turetilemez. Somut vaka: Marco Rahimi Farah Team'de danismanken
--     Moutaharrik lideri oldu; en son deal'i hala "Farah Team" diyor, bu koruma
--     olmasa liderliginden alinip Farah'a geri atilirdi.


-- ════════════════════════════════════════════════════════════
-- ADIM 1 — ONIZLEME (yazma YOK): ne degisecek?
-- ════════════════════════════════════════════════════════════
WITH alias_map(alias, canonical) AS (VALUES
  ('Arij  Team','Arij  Team'), ('Arij Team','Arij  Team'), ('Team Leader-Arij Mahjoubi','Arij  Team'),
  ('Askif Team','Askif Team'), ('Team Leader - Abdulrahman Ziad Askif','Askif Team'),
  ('Touma Team','Touma Team'), ('Team Leader- Abdulkader Touma','Touma Team'), ('Toumi Team','Touma Team'),
  ('Mihoubi Team','Mihoubi Team'), ('Team Leader - Mihoubi','Mihoubi Team'),
  ('Ahmed Anwar Team','Ahmed Anwar Team'), ('Team Leader-Ahmed Anwar','Ahmed Anwar Team'),
  ('Ghazal Team','Ghazal Team'), ('Team Leader - Ahmad Ghazal','Ghazal Team'),
  ('Ali Omer Team','Ali Omer Team'), ('Team Leader - Ali Omer','Ali Omer Team'),
  ('Aamir Ali Team','Aamir Ali Team'), ('Team Leader - Aamir Ali','Aamir Ali Team'),
  ('Joel Team','Joel Team'), ('Team Leader - Joel','Joel Team'),
  ('SM- Mert Team','SM- Mert Team'), ('Mert Jospeh - Sales Master','SM- Mert Team'),
  ('Sales Master - Amin Connor West','Sales Master - Amin Connor West'),
  ('SM Amin Connor - Team','Sales Master - Amin Connor West'),
  ('Farah Team - Morocco','Farah Team - Morocco'), ('Team Leader - Farah','Farah Team - Morocco'),
  ('Sara Team - Morocco','Sara Team - Morocco'), ('Team Leader - Sara','Sara Team - Morocco'),
  ('Selma Team - Morocco','Selma Team - Morocco'), ('Team Leader - Selma','Selma Team - Morocco'),
  ('Ramadan Team - Morocco','Ramadan Team - Morocco'), ('Team Leader - Abdelatif Ramadan','Ramadan Team - Morocco'),
  ('Moutaharrik Team - Morocco','Moutaharrik Team - Morocco'),
  ('Team Leader - Moutaharrik Marco','Moutaharrik Team - Morocco')
),
am AS (SELECT lower(regexp_replace(alias,'\s+',' ','g')) AS k, canonical FROM alias_map),
latest AS (
  SELECT DISTINCT ON (lower(regexp_replace(d.deal_owner,'\s+',' ','g')))
         lower(regexp_replace(d.deal_owner,'\s+',' ','g')) AS owner_key,
         am.canonical AS team, d.created_time AS last_deal
    FROM public.deals d
    JOIN am ON am.k = lower(regexp_replace(d.team,'\s+',' ','g'))
   WHERE d.deal_owner IS NOT NULL AND d.deal_owner <> ''
   -- NULLS LAST sart: DESC'te Postgres varsayilani NULLS FIRST, tarihi bos bir
   -- deal "en son" sayilip yanlis takim yazilirdi.
   ORDER BY lower(regexp_replace(d.deal_owner,'\s+',' ','g')), d.created_time DESC NULLS LAST
)
SELECT u."Username", u."Deal Owner Name", u."Role",
       u."Takim Adi" AS mevcut, l.team AS yeni, l.last_deal::date AS son_deal
  FROM public."Users" u
  JOIN latest l ON l.owner_key = lower(regexp_replace(trim(COALESCE(u."Deal Owner Name",u."Username")),'\s+',' ','g'))
 WHERE COALESCE(u."Role",'') !~* '(leader|lider|manager|müdür|mudur|admin|yönetici|yonetici)'
   AND COALESCE(u."Takim Adi",'') <> l.team
 ORDER BY l.team, u."Deal Owner Name";


-- ════════════════════════════════════════════════════════════
-- ADIM 2 — UYGULA (Adim 1'in ciktisini onayladiktan SONRA calistir)
-- ════════════════════════════════════════════════════════════
WITH alias_map(alias, canonical) AS (VALUES
  ('Arij  Team','Arij  Team'), ('Arij Team','Arij  Team'), ('Team Leader-Arij Mahjoubi','Arij  Team'),
  ('Askif Team','Askif Team'), ('Team Leader - Abdulrahman Ziad Askif','Askif Team'),
  ('Touma Team','Touma Team'), ('Team Leader- Abdulkader Touma','Touma Team'), ('Toumi Team','Touma Team'),
  ('Mihoubi Team','Mihoubi Team'), ('Team Leader - Mihoubi','Mihoubi Team'),
  ('Ahmed Anwar Team','Ahmed Anwar Team'), ('Team Leader-Ahmed Anwar','Ahmed Anwar Team'),
  ('Ghazal Team','Ghazal Team'), ('Team Leader - Ahmad Ghazal','Ghazal Team'),
  ('Ali Omer Team','Ali Omer Team'), ('Team Leader - Ali Omer','Ali Omer Team'),
  ('Aamir Ali Team','Aamir Ali Team'), ('Team Leader - Aamir Ali','Aamir Ali Team'),
  ('Joel Team','Joel Team'), ('Team Leader - Joel','Joel Team'),
  ('SM- Mert Team','SM- Mert Team'), ('Mert Jospeh - Sales Master','SM- Mert Team'),
  ('Sales Master - Amin Connor West','Sales Master - Amin Connor West'),
  ('SM Amin Connor - Team','Sales Master - Amin Connor West'),
  ('Farah Team - Morocco','Farah Team - Morocco'), ('Team Leader - Farah','Farah Team - Morocco'),
  ('Sara Team - Morocco','Sara Team - Morocco'), ('Team Leader - Sara','Sara Team - Morocco'),
  ('Selma Team - Morocco','Selma Team - Morocco'), ('Team Leader - Selma','Selma Team - Morocco'),
  ('Ramadan Team - Morocco','Ramadan Team - Morocco'), ('Team Leader - Abdelatif Ramadan','Ramadan Team - Morocco'),
  ('Moutaharrik Team - Morocco','Moutaharrik Team - Morocco'),
  ('Team Leader - Moutaharrik Marco','Moutaharrik Team - Morocco')
),
am AS (SELECT lower(regexp_replace(alias,'\s+',' ','g')) AS k, canonical FROM alias_map),
latest AS (
  SELECT DISTINCT ON (lower(regexp_replace(d.deal_owner,'\s+',' ','g')))
         lower(regexp_replace(d.deal_owner,'\s+',' ','g')) AS owner_key,
         am.canonical AS team
    FROM public.deals d
    JOIN am ON am.k = lower(regexp_replace(d.team,'\s+',' ','g'))
   WHERE d.deal_owner IS NOT NULL AND d.deal_owner <> ''
   -- NULLS LAST sart: DESC'te Postgres varsayilani NULLS FIRST, tarihi bos bir
   -- deal "en son" sayilip yanlis takim yazilirdi.
   ORDER BY lower(regexp_replace(d.deal_owner,'\s+',' ','g')), d.created_time DESC NULLS LAST
)
UPDATE public."Users" u
   SET "Takim Adi" = l.team
  FROM latest l
 WHERE l.owner_key = lower(regexp_replace(trim(COALESCE(u."Deal Owner Name",u."Username")),'\s+',' ','g'))
   AND COALESCE(u."Role",'') !~* '(leader|lider|manager|müdür|mudur|admin|yönetici|yonetici)'
   AND COALESCE(u."Takim Adi",'') <> l.team;


-- ════════════════════════════════════════════════════════════
-- ADIM 3 — deals'te var ama Users'ta HIC OLMAYAN kisiler
-- Bunlar icin giris olusturulmasi gerekir (SQL bunu yapamaz, karar senin).
-- ════════════════════════════════════════════════════════════
WITH alias_map(alias, canonical) AS (VALUES
  ('Farah Team - Morocco','Farah Team - Morocco'), ('Team Leader - Farah','Farah Team - Morocco'),
  ('Sara Team - Morocco','Sara Team - Morocco'), ('Team Leader - Sara','Sara Team - Morocco'),
  ('Selma Team - Morocco','Selma Team - Morocco'), ('Team Leader - Selma','Selma Team - Morocco'),
  ('Ramadan Team - Morocco','Ramadan Team - Morocco'), ('Team Leader - Abdelatif Ramadan','Ramadan Team - Morocco'),
  ('Moutaharrik Team - Morocco','Moutaharrik Team - Morocco'),
  ('Team Leader - Moutaharrik Marco','Moutaharrik Team - Morocco'),
  ('Arij  Team','Arij  Team'), ('Arij Team','Arij  Team'), ('Team Leader-Arij Mahjoubi','Arij  Team'),
  ('Askif Team','Askif Team'), ('Team Leader - Abdulrahman Ziad Askif','Askif Team'),
  ('Touma Team','Touma Team'), ('Team Leader- Abdulkader Touma','Touma Team'), ('Toumi Team','Touma Team'),
  ('Mihoubi Team','Mihoubi Team'), ('Team Leader - Mihoubi','Mihoubi Team'),
  ('Ahmed Anwar Team','Ahmed Anwar Team'), ('Team Leader-Ahmed Anwar','Ahmed Anwar Team'),
  ('Ghazal Team','Ghazal Team'), ('Team Leader - Ahmad Ghazal','Ghazal Team'),
  ('Ali Omer Team','Ali Omer Team'), ('Team Leader - Ali Omer','Ali Omer Team'),
  ('Aamir Ali Team','Aamir Ali Team'), ('Team Leader - Aamir Ali','Aamir Ali Team'),
  ('Joel Team','Joel Team'), ('Team Leader - Joel','Joel Team'),
  ('SM- Mert Team','SM- Mert Team'), ('Mert Jospeh - Sales Master','SM- Mert Team'),
  ('Sales Master - Amin Connor West','Sales Master - Amin Connor West'),
  ('SM Amin Connor - Team','Sales Master - Amin Connor West')
),
am AS (SELECT lower(regexp_replace(alias,'\s+',' ','g')) AS k, canonical FROM alias_map),
latest AS (
  SELECT DISTINCT ON (lower(regexp_replace(d.deal_owner,'\s+',' ','g')))
         lower(regexp_replace(d.deal_owner,'\s+',' ','g')) AS owner_key,
         d.deal_owner AS ad, am.canonical AS team, d.created_time AS last_deal
    FROM public.deals d
    JOIN am ON am.k = lower(regexp_replace(d.team,'\s+',' ','g'))
   WHERE d.deal_owner IS NOT NULL AND d.deal_owner <> ''
   -- NULLS LAST sart: DESC'te Postgres varsayilani NULLS FIRST, tarihi bos bir
   -- deal "en son" sayilip yanlis takim yazilirdi.
   ORDER BY lower(regexp_replace(d.deal_owner,'\s+',' ','g')), d.created_time DESC NULLS LAST
)
SELECT l.ad AS "deals'teki ad", l.team AS "takim", l.last_deal::date AS "son deal"
  FROM latest l
 WHERE NOT EXISTS (
   SELECT 1 FROM public."Users" u
    WHERE lower(regexp_replace(trim(COALESCE(u."Deal Owner Name",u."Username")),'\s+',' ','g')) = l.owner_key
 )
 ORDER BY l.team, l.ad;


-- ════════════════════════════════════════════════════════════
-- DOGRULAMA — Moutaharrik takiminda kimler var?
-- ════════════════════════════════════════════════════════════
-- SELECT "Username", "Deal Owner Name", "Role", "Takim Adi"
--   FROM public."Users" WHERE "Takim Adi" = 'Moutaharrik Team - Morocco'
--  ORDER BY "Role", "Deal Owner Name";
