-- ============================================================
-- MOUTAHARRIK TEAM (MOROCCO) — TAKIM LİDERİ GİRİŞİ
-- Supabase SQL Editor'e yapıştır ve çalıştır.
-- ============================================================
--
-- DURUM
-- Moutaharrik Team - Morocco, Morocco bölgesinin takımlarından biri ama
-- sistemde takım lideri girişi yoktu. Takımın Zoho'daki mevcut üyeleri:
-- Adam Naciri, Rim El Amrani, Malak Fadili.
--
-- ÖNEMLİ: Marco Rahimi için YENİ kullanıcı OLUŞTURULMUYOR — Users tablosunda
-- zaten var (Username = 'Marco.Rahimi', Farah Team'de danışman olarak; 28.07
-- Farah günlük ekip girişinde de bu adla görünüyor). Bu yüzden aşağıdaki işlem
-- bir INSERT değil, mevcut kaydın takım liderine YÜKSELTİLMESİ:
--
--   Role      : (danışman)            -> 'Team Leader'
--   Takim Adi : Farah Team - Morocco  -> 'Moutaharrik Team - Morocco'
--   Password  : (bilinmiyor)          -> aşağıdaki bcrypt hash
--
-- Role değeri 'Team Leader' seçildi: api/_auth.js normalizeRole() 'leader'
-- gördüğünde 'team-leader' döndürüyor, panellerdeki _isBoss regex'i de aynı
-- kelimeyle eşleşiyor (Günlük Ekip Girişi listesinde yönetici görünmemeli).
--
-- ŞİFRE: Moutaharrik!2026
-- Aşağıdaki değer bunun bcrypt (cost 10) hash'i — düz metin şifre veritabanına
-- hiç yazılmıyor. api/login.js hash'i /^\$2[aby]\$/ ile tanıyıp bcrypt.compare
-- ile doğruluyor.
--
-- UYARI: Marco Rahimi'nin danışman olarak kullandığı ESKİ şifresi bu işlemle
-- geçersiz olur (mevcut hash okunamadığı için korunamıyor). Yeni şifreyi ona
-- iletmen gerekiyor; ilk girişten sonra kendisi değiştirebilir.

UPDATE public."Users"
   SET "Role"      = 'Team Leader',
       "Takim Adi" = 'Moutaharrik Team - Morocco',
       "Password"  = '$2a$10$/jx.u6XPgt9yaUBeW6Cg/ekUMgD0R.aqZdh6/FqcKHbl6D5zRWLae'
 WHERE "Username" = 'Marco.Rahimi';

-- Beklenen: UPDATE 1
-- "UPDATE 0" dönerse kullanıcı adı farklı yazılmış olabilir; şununla ara:
--   SELECT id, "Username", "Deal Owner Name", "Role", "Takim Adi"
--     FROM public."Users" WHERE "Deal Owner Name" ILIKE '%rahimi%';

-- ── Doğrulama ──────────────────────────────────────────────
SELECT "Username", "Deal Owner Name", "Role", "Takim Adi",
       left("Password", 4) AS pw_prefix   -- '$2a$' görmelisin (hash yazıldı)
  FROM public."Users"
 WHERE "Username" = 'Marco.Rahimi';

-- ── Takımın diğer üyeleri ──────────────────────────────────
-- Adam Naciri / Rim El Amrani / Malak Fadili'nin Users."Takim Adi" değeri de
-- muhtemelen eski takımlarında kalmış. Bunları ELLE düzeltmene gerek yok:
-- api/sync-user-teams.js (admin panelindeki "Tümünü Zoho'ya Göre Eşitle")
-- her danışmanı en son deal'inin takımına çekiyor.
--
-- NOT: O senkron yönetici rollerine (leader/manager/admin) KASITLI olarak
-- dokunmuyor — Marco Rahimi'nin en son deal'i hâlâ "Farah Team" dediği için,
-- bu koruma olmasa senkron onu yeni liderliğinden alıp Farah'a geri atardı.
-- Yani yukarıdaki UPDATE'i senkron bozmaz.
