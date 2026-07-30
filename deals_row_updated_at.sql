-- ============================================================
-- deals TABLOSU İÇİN "SATIR SON DEĞİŞİM ZAMANI" (change-feed watermark)
-- Supabase SQL Editor'e yapıştır ve çalıştır.
-- ============================================================
--
-- NEDEN GEREKLİ
-- Paneller (agent.html / team-leader.html / admin.html) deals tablosunu
-- sayfa açılışında bir kez çekiyordu; Zoho senkronu bir deal'i güncellediğinde
-- (stage, tutar, Result_Codes, tarih alanları) ya da başka bir kullanıcı panel
-- içinden sonuç kodu yazdığında, açık duran sekme bunu görmüyordu.
--
-- deals-live.js bu boşluğu "ne değişti?" sorgusuyla kapatıyor: her turda
-- yalnızca son bilinen damgadan SONRA değişmiş satırları çekiyor. Bunun için
-- HER TÜRLÜ yazmada güncellenen tek bir zaman damgası kolonu gerekiyor:
--
--   * synced_at       → yalnızca Zoho senkronu yazıyor, panel içi yazmaları kaçırır
--   * modified_time   → Zoho'nun kendi alanı, panel içi yazmaları kaçırır
--   * row_updated_at  → aşağıdaki trigger ile HER INSERT/UPDATE'te tazelenir ✓
--
-- Bu betik çalıştırılmadan da paneller çalışır: deals-live.js kolonu bulamazsa
-- sessizce synced_at'e düşer (yalnız Zoho kaynaklı değişiklikleri yakalar).
-- Betiği çalıştırdıktan sonra panel içi değişiklikler de anında yayılır.

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS row_updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.deals_touch_row_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.row_updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deals_touch_row_updated_at ON public.deals;
CREATE TRIGGER trg_deals_touch_row_updated_at
  BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.deals_touch_row_updated_at();

-- Change-feed sorgusu her turda "row_updated_at >= X" ile filtreliyor —
-- 49K+ satırda index olmadan her tur full scan olurdu.
CREATE INDEX IF NOT EXISTS deals_row_updated_at_idx
  ON public.deals(row_updated_at DESC);

-- Change-feed sorgusu takıma göre de daraltılıyor (TL/RM kapsamı).
CREATE INDEX IF NOT EXISTS deals_team_row_updated_at_idx
  ON public.deals(team, row_updated_at DESC);

-- Agent paneli kendi dealleri için daraltıyor.
CREATE INDEX IF NOT EXISTS deals_owner_row_updated_at_idx
  ON public.deals(deal_owner, row_updated_at DESC);

-- NOT: Mevcut satırlar geriye dönük doldurulmuyor — ADD COLUMN ... DEFAULT now()
-- hepsine betiğin çalıştığı anı yazar. Bu bir sorun değil, çünkü deals-live.js
-- ilk damgayı max(row_updated_at) ile alıp SONRASINI izliyor; geçmiş değerlerin
-- doğruluğu change-feed'i etkilemiyor. (Geriye dönük UPDATE denemek zaten
-- işe yaramaz: yukarıdaki trigger BEFORE UPDATE'te değeri tekrar now() yapar.)

-- Doğrulama
-- SELECT max(row_updated_at) FROM public.deals;
