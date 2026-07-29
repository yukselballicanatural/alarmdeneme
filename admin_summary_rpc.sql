-- ============================================================
-- ADMIN PANELİ — SUNUCU TARAFLI ÖZET (AGGREGATE) FONKSİYONU
-- Supabase SQL Editor'e yapıştır ve BİR KEZ çalıştır:
--   https://supabase.com/dashboard/project/aztxfncqanrodbttywrb/sql
--
-- Amaç: admin paneli 49K+ deal satırının tamamını tarayıcıya indirip
-- toplamları JavaScript'te hesaplıyordu (yavaş + rakamlar sonradan gelip
-- "0"dan zıplıyordu). Bu fonksiyon tüm toplamları Postgres'te hesaplayıp
-- sadece birkaç KB'lık özet döndürür. Yeni deal geldiğinde otomatik yansır —
-- bakım/trigger gerektirmez, drift olmaz.
--
-- v5: Dil dağılımı artık gerçek anlamda Supabase'de "hazır tutuluyor" —
-- admin_cache tablosunda cache'leniyor. admin_language_breakdown() okuması
-- artık anında (<50ms); yavaş hesaplama sadece admin_refresh_language_breakdown()
-- çağrıldığında (admin.html arka planda, saatlerde bir, otomatik tetikler).
--
-- v4: Analytics sayfası için isteğe bağlı filtre parametreleri eklendi
-- (p_teams, p_date_from, p_date_to). Parametresiz çağrı (admin.html'deki
-- ana KPI/rozet paneli) eskisiyle birebir aynı davranır — filtre YOKSA hiç
-- WHERE koşulu eklenmez. Analytics'teki Bölge/Takım Lideri/Tarih filtreleri
-- bu parametreleri doldurup AYNI fonksiyonu çağırır.
--
-- v3: `raw->>'Language'` alan ayıklaması ANA fonksiyondan çıkarıldı. Sebep:
-- `raw` her satırda ~169 alanlı büyük bir JSONB (TOAST'lanmış, ayrı diskte
-- saklanıyor); sadece "Language" almak için bile Postgres'in 49K satırın
-- TAMAMINI diskten açıp (detoast) parse etmesi gerekiyordu — bu tek başına
-- ~10-15 saniye sürüyordu. Language dağılımı ayrı, tembel-çağrılan bir
-- fonksiyona (admin_language_breakdown) taşındı; Analytics sekmesi açılınca
-- bir kez çekilir, ana KPI/rozet rakamlarını bloklamaz.
--
-- Not: Cutoff tarihi (2026-06-15) admin.html'deki isBeforeCutoff ile birebir
-- aynıdır. Değiştirirsen iki yeri birlikte güncelle.
-- ============================================================

-- Önceki sürümleri düşür — parametre listesi değiştiği için "create or
-- replace" aynı isimde YENİ bir overload yaratır ve PostgREST
-- "ambiguous function" hatası verir. Önce eskilerini temizlemek gerekiyor.
drop function if exists public.admin_deal_summary();
drop function if exists public.admin_deal_summary(text[], date, date);

-- v6: Created Time filtresi de RPC'ye eklendi (p_created_from/p_created_to).
-- Önceden Analytics'te Created Time filtresi seçilince RPC hiç
-- desteklemediği için istemci tamamen client-side hesaplamaya (49K satırın
-- tamamı tarayıcıda, 8-9 ayrı reduce/filter geçişi) düşüyordu — bu da
-- "filtre uygulayınca çok yavaş" hissine yol açıyordu. Artık Created Time
-- filtresi de sunucuda (created_time::date üzerinden) hesaplanıyor, RPC
-- her zaman anında dönüyor.
create or replace function public.admin_deal_summary(
  p_teams        text[] default null,   -- doluysa: sadece bu takım adı varyantlarına (deals.team) sahip dealler
  p_date_from    date   default null,   -- doluysa: arrival_date >= bu tarih
  p_date_to      date   default null,   -- doluysa: arrival_date <= bu tarih
  p_created_from date   default null,   -- doluysa: created_time::date >= bu tarih
  p_created_to   date   default null    -- doluysa: created_time::date <= bu tarih
)
returns jsonb
language sql
stable
security definer
set search_path = public
set statement_timeout to '15000'
as $$
  -- 'materialized' → deals tablosu SADECE BİR KEZ taranır (aksi halde CTE
  -- inline edilip her alt-sorguda tekrar taranır ve timeout'a düşer).
  -- `raw` kolonuna HİÇ dokunulmuyor — TOAST detoast maliyeti yok.
  with flags as materialized (
    select
      coalesce(amount, 0)::numeric             as amount,
      coalesce(total_paid_amount, 0)::numeric  as paid,
      coalesce(remaining_amount, 0)::numeric   as unpaid,
      coalesce(stage, '')                      as stage,
      coalesce(team, '')                       as team,
      coalesce(deal_owner, '')                 as owner,
      arrival_date                             as arrival,
      visit_date_1                             as v1,
      visit_date_2                             as v2,
      visit_date_3                             as v3,
      created_time::date                       as created_d,
      nullif(result_codes, '')                 as rc,
      (lower(coalesce(stage,'')) like '%won%')    as is_won,
      (lower(coalesce(stage,'')) like '%cancel%') as is_cancel,
      case
        when coalesce(total_paid_amount,0) <= 0 then 'Unpaid'
        when coalesce(amount,0) > 0 and coalesce(total_paid_amount,0) >= coalesce(amount,0) then 'Paid'
        else 'Partial'
      end as pay_status,
      (visit_date_1 is not null or visit_date_2 is not null or visit_date_3 is not null) as visited
    from public.deals
    where (p_teams is null or team = any(p_teams))
      and (p_date_from is null or arrival_date >= p_date_from)
      and (p_date_to   is null or arrival_date <= p_date_to)
      and (p_created_from is null or created_time::date >= p_created_from)
      and (p_created_to   is null or created_time::date <= p_created_to)
  ),
  scalars as (
    select
      count(*)                                                    as total,
      coalesce(sum(amount),0)                                     as sum_amount,
      coalesce(sum(paid),0)                                       as sum_paid,
      coalesce(sum(unpaid),0)                                     as sum_unpaid,
      count(*) filter (where is_won)                              as won,
      count(*) filter (where is_cancel)                           as cancel,
      count(*) filter (where rc is null)                          as no_result,
      count(*) filter (where visited)                             as visited,
      count(*) filter (where not is_won and not is_cancel and arrival < date '2026-06-15') as badge_arrival,
      count(*) filter (where not is_won and not is_cancel and v1 < date '2026-06-15')      as badge_v1,
      count(*) filter (where not is_won and not is_cancel and v2 < date '2026-06-15')      as badge_v2,
      count(*) filter (where not is_won and not is_cancel and v3 < date '2026-06-15')      as badge_v3,
      count(*) filter (where not is_won and is_cancel and (
                 arrival < date '2026-06-15' or
                 v1 < date '2026-06-15' or
                 v2 < date '2026-06-15' or
                 v3 < date '2026-06-15' or
                 created_d < date '2026-06-15'
               ))                                                 as badge_cancelled
    from flags
  )
  select jsonb_build_object(
    'total',            sc.total,
    'sum_amount',       sc.sum_amount,
    'sum_paid',         sc.sum_paid,
    'sum_unpaid',       sc.sum_unpaid,
    'won',              sc.won,
    'cancel',           sc.cancel,
    'no_result',        sc.no_result,
    'visited',          sc.visited,
    'unlock_requested', 0,  -- deals tablosunda lock_approval_requested kolonu yok (mevcut davranışla aynı: 0)
    'badge_arrival',    sc.badge_arrival,
    'badge_v1',         sc.badge_v1,
    'badge_v2',         sc.badge_v2,
    'badge_v3',         sc.badge_v3,
    'badge_cancelled',  sc.badge_cancelled,

    'by_stage',   (select coalesce(jsonb_agg(jsonb_build_object('stage',stage,'cnt',cnt) order by cnt desc),'[]'::jsonb)
                     from (select stage, count(*) cnt from flags group by stage) a),
    'by_payment', (select coalesce(jsonb_agg(jsonb_build_object('status',pay_status,'cnt',cnt) order by cnt desc),'[]'::jsonb)
                     from (select pay_status, count(*) cnt from flags group by pay_status) a),
    'by_month',   (select coalesce(jsonb_agg(jsonb_build_object('ym',ym,'cnt',cnt,'amount',amt) order by ym),'[]'::jsonb)
                     from (select to_char(arrival,'YYYY-MM') ym, count(*) cnt, sum(amount) amt
                             from flags where arrival is not null group by to_char(arrival,'YYYY-MM')) a),
    'by_result',  (select coalesce(jsonb_agg(jsonb_build_object('code',rc,'cnt',cnt,'agents',agents) order by cnt desc),'[]'::jsonb)
                     from (select rc, count(*) cnt, count(distinct owner) agents
                             from flags where rc is not null group by rc) a),
    'by_team',    (select coalesce(jsonb_agg(jsonb_build_object('team',team,'deals',deals,'paid',paid,'unpaid',unpaid,'won',won,'results',results) order by deals desc),'[]'::jsonb)
                     from (select team, count(*) deals, sum(paid) paid, sum(unpaid) unpaid,
                                  count(*) filter (where is_won) won,
                                  count(*) filter (where rc is not null) results
                             from flags group by team) a),
    'by_owner',   (select coalesce(jsonb_agg(jsonb_build_object('owner',owner,'deals',deals,'paid',paid,'unpaid',unpaid,'won',won,'results',results,'won_paid',won_paid) order by deals desc),'[]'::jsonb)
                     from (select owner, count(*) deals, sum(paid) paid, sum(unpaid) unpaid,
                                  count(*) filter (where is_won) won,
                                  count(*) filter (where rc is not null) results,
                                  -- won_paid: stage Won VE odeme %100+ (tamamlanan) deal sayisi (G3)
                                  count(*) filter (where is_won and amount > 0 and paid >= amount) won_paid
                             from flags group by owner) a)
  )
  from scalars sc;
$$;

grant execute on function public.admin_deal_summary(text[], date, date, date, date) to anon, authenticated;

-- ============================================================
-- DİL DAĞILIMI — Supabase'de HAZIR TUTULAN (cache'lenmiş) sonuç
-- ============================================================
-- `raw->>'Language'` her satırda büyük bir JSONB'yi (TOAST) açmayı
-- gerektirdiği için bu sorgu tek başına ~10 saniye sürüyor. Her admin
-- Analytics'i her açtığında bu hesabı BAŞTAN yapmak yerine, sonucu küçük bir
-- tabloda (admin_cache) saklıyoruz: okuma anında (<50ms), hesaplama sadece
-- arka planda, seyrek olarak (admin.html'den saatlerde bir tetiklenir) çalışır.
create table if not exists public.admin_cache (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.admin_cache enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'admin_cache' and policyname = 'admin_cache_read'
  ) then
    create policy admin_cache_read on public.admin_cache for select using (true);
  end if;
end $$;
-- Not: kasıtlı olarak insert/update policy YOK — anon/authenticated rolleri
-- tabloya doğrudan yazamaz, sadece aşağıdaki security definer fonksiyon
-- (tablo sahibi olarak RLS'i bypass eder) yazabilir.

-- Gerçek (yavaş) hesaplamayı yapıp admin_cache'e yazan fonksiyon.
create or replace function public.admin_refresh_language_breakdown()
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout to '20000'
as $$
declare
  result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('lang', lang, 'cnt', cnt) order by cnt desc), '[]'::jsonb)
  into result
  from (
    select coalesce(nullif(raw->>'Language',''), 'Unknown') as lang, count(*) as cnt
    from public.deals
    group by 1
  ) a;

  insert into public.admin_cache(key, value, updated_at)
  values ('language_breakdown', result, now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  return result;
end;
$$;

grant execute on function public.admin_refresh_language_breakdown() to anon, authenticated;

-- Frontend'in çağırdığı fonksiyon (isim/imza AYNI kaldı, admin.html'de
-- değişiklik gerekmiyor). Cache'te veri varsa ANINDA döner; hiç yoksa
-- (ilk kurulum) bu seferlik yavaş hesaplayıp cache'i doldurur.
-- 'set statement_timeout' burada da (admin_refresh_language_breakdown içindeki
-- ile aynı) gerekiyor: PostgREST çağrısının GERÇEK giriş noktası bu fonksiyon,
-- anon rolünün varsayılan (kısa) zaman aşımı önce buraya uygulanıyor — içerideki
-- nested fonksiyonun kendi SET'i bu dıştaki sınırı geçersiz kılmaya yetmiyordu,
-- bu yüzden cache hiç dolmadan (57014) kesiliyordu.
create or replace function public.admin_language_breakdown()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set statement_timeout to '25000'
as $$
declare
  cached jsonb;
begin
  select value into cached from public.admin_cache where key = 'language_breakdown';
  if cached is not null then
    return cached;
  end if;
  return public.admin_refresh_language_breakdown();
end;
$$;

grant execute on function public.admin_language_breakdown() to anon, authenticated;

-- ============================================================
-- TEŞHİS FONKSİYONU — sorunun nerede olduğunu ölçer (tablo taraması mı yoksa
-- bizim sorgu mantığımız mı yavaş). Kalıcı değil, sorun çözülünce silinebilir:
--   drop function if exists public.admin_deal_summary_debug();
-- ============================================================
create or replace function public.admin_deal_summary_debug()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set statement_timeout to '30000'
as $$
declare
  t0 timestamptz; t1 timestamptz; t2 timestamptz; t3 timestamptz;
  n_total bigint; n_scan bigint;
begin
  t0 := clock_timestamp();
  select count(*) into n_total from public.deals;                 -- çıplak seq scan + count
  t1 := clock_timestamp();
  select count(*) into n_scan from public.deals where amount is not null or amount is null; -- kolonlara dokun, hepsini oku
  t2 := clock_timestamp();
  perform public.admin_deal_summary();                            -- gerçek özet fonksiyonu (filtresiz)
  t3 := clock_timestamp();
  return jsonb_build_object(
    'row_count',            n_total,
    'ms_bare_count',        round(extract(epoch from (t1-t0))*1000)::int,
    'ms_touch_all_columns', round(extract(epoch from (t2-t1))*1000)::int,
    'ms_full_summary_rpc',  round(extract(epoch from (t3-t2))*1000)::int
  );
end;
$$;

grant execute on function public.admin_deal_summary_debug() to anon, authenticated;
 
-- Test:
-- select public.admin_deal_summary();
-- select public.admin_deal_summary(array['Askif Team'], '2026-01-01', '2026-12-31');
-- select public.admin_language_breakdown();          -- cache'ten anında döner
-- select public.admin_refresh_language_breakdown();  -- yavaş, cache'i tazeler
-- select public.admin_deal_summary_debug();
-- select * from public.admin_cache;
