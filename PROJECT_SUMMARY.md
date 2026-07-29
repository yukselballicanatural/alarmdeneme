# Natural Clinic — Past Data CRM / Alarm Takip Sistemi — Proje Özeti

> Bu doküman başka bir Claude Code sohbetine yapıştırılmak üzere hazırlanmıştır.
> Amaç: yeni bir oturumun bu projeyi sıfırdan keşfetmeden, mimariyi, veri
> kaynaklarını, güvenlik durumunu ve bilinen tuzakları tam olarak anlaması.
> Son güncelleme: 2026-07-22.

---

## 1. PROJE ÖZETİ (İş / Ürün Bakışı) — NEDEN YAPILDI

**Ne işe yarıyor:** Natural Clinic (medikal turizm / estetik klinik) satış
ekibi, potansiyel hasta/deal kayıtlarını **Zoho CRM**'de tutuyor. Zoho'nun
kendi arayüzü satış danışmanlarının günlük "bu hastayı aradım, sonuç şuydu"
takibi için hem yavaş hem de rol bazlı kısıtlama/kilit mekanizması sunmuyordu.
Bu proje, Zoho'dan senkronlanan veriyi **Supabase**'e alıp üzerine:

1. **Rol bazlı, kilitli bir "sonuç kodu girme" iş akışı** (agent bir hastayı
   arar, sonucu + notu girer, kayıt kilitlenir, değiştirmek için TL/Admin
   onayı gerekir),
2. **Otomatik bir alarm/hatırlatma motoru** (ödeme eksik, varış/ziyaret
   tarihi yaklaşıyor, hasta gelmedi, tarih eksik vb. durumları tespit edip
   Team Leader'lara gösterir),
3. **TR/EN iki dilli, hızlı, rol bazlı 4 panel** (Agent / Team Leader /
   Regional Manager / Admin)

inşa eden bağımsız bir istemci uygulamasıdır. **Zoho→Supabase senkronizasyonu
bu reponun DIŞINDA** başka bir yerde (muhtemelen ayrı bir entegrasyon/cron)
çalışıyor — bu repoda senkron kodu YOK, sadece `deals.synced_at`, `deals.raw`
gibi senkrondan kalma sütun/izler var. Supabase burada hem "Zoho'nun salt-okunur
aynası" hem de "bu uygulamanın kendi iş akışı verisinin (sonuç kodu, alarm,
log) tutulduğu birincil veritabanı" — ikisi aynı `deals` tablosunda iç içe.

**Orijinal vizyon dokümanı** (`projetanitim.md`) çok daha basit, UUID tabanlı
`profiles`/`teams`/`logs` şeması öngörüyordu (3 rol: Agent/TL/Admin). **Gerçek
implementasyon bunun çok ötesine geçti** — 4. rol (Regional Manager) eklendi,
tablo isimleri/tipleri tamamen değişti, tam bir alarm motoru eklendi. O
dosyayı SADECE tarihsel niyet/motivasyon olarak oku, güncel şema için ASLA
referans alma — Bölüm 3 tek doğru kaynak.

**Roller ve ne gördükleri:**
- **Agent** (Satış Danışmanı, ~150 kişi, `agent.html`) — sadece kendi
  danışmanlık yaptığı dealleri görür. Bir deal'e "Sonuç Gir" ile sonuç kodu +
  not girer → kart kilitlenir → tekrar açmak için "Unlock" talebi gönderir.
- **Team Leader (TL)** (~12 kişi, `team-leader.html`) — kendi takımının tüm
  deal/alarm/iptal/won verisi, agent'ların unlock taleplerini onaylar.
- **Regional Manager (RM)** (`admin.html`, Users/Logs sayfaları gizli) —
  kendi bölgesindeki (Istanbul veya Morocco) TÜM takımların verisi, salt bölge
  bazlı kısıtlı admin görünümü.
- **Admin / Super Admin** (`admin.html`) — sistemin tamamı: tüm bölgeler, tüm
  takımlar, Users yönetimi (kullanıcı ekle/sil/rol değiştir), System Logs.

---

## 2. TEKNOLOJİ YIĞINI

- **Frontend:** Saf HTML + vanilla JavaScript (framework YOK — React/Vue/Angular
  kullanılmıyor). Tailwind CSS **CDN üzerinden** (`<script src="https://cdn.tailwindcss.com">`)
  admin.html ve agent.html'de; team-leader.html'de elle yazılmış CSS. Build
  adımı yok — dosyalar doğrudan tarayıcıda çalışır, `npm run build` gibi bir
  şey yok, Vercel statik dosyaları olduğu gibi servis eder.
- **Backend/Veritabanı:** **Supabase** (yönetilen PostgreSQL + otomatik REST
  API'si "PostgREST"). Gerçek Supabase Auth KULLANILMIYOR — kimlik doğrulama
  bu proje için özel yazılmış (bkz. Bölüm 5).
- **Sunucu tarafı (minimal):** Sadece **3 küçük Vercel serverless function**
  (`api/config.js`, `api/login.js`, `api/admin-users.js`) — geri kalan HER ŞEY
  (deal listeleme, filtreleme, alarm hesaplama, sonuç kodu kaydetme vb.)
  tarayıcıdan DOĞRUDAN Supabase'in REST API'sine gidiyor, aradan sunucu kodu
  geçmiyor.
- **Hosting:** Vercel (proje adı: `nc-pastdata-crm`, canlı URL:
  `https://nc-pastdata-crm.vercel.app`).
- **Excel export:** `xlsx` npm paketi (admin.html'deki "Excel'e Aktar" özelliği için).
- **Şifreleme:** `bcryptjs` (şifre hash'leme, `api/login.js` içinde).
- **Paket yöneticisi:** npm, ama sadece 2 bağımlılık var (`bcryptjs`, `xlsx`) —
  proje kasıtlı olarak "npm'siz de çalışabilsin" diye tasarlanmış (statik
  dosyalar `index.html`'e çift tıklayarak da açılabilir, sadece API endpoint'leri
  için Vercel/Node gerekir).

---

## 3. DOSYA HARİTASI

```
index.html          — Login sayfası. Kullanıcı adı/şifre alır, rol tespiti yapar,
                       agent.html / team-leader.html / admin.html'e yönlendirir.
agent.html           — Agent paneli: kendi dealleri, "Sonuç Gir" modalı, Unlock talebi.
team-leader.html     — Team Leader paneli: Deal Listesi, Alarmlar, Bugün Gelecekler,
                       No-show, İptal Edilenler, Won Alarmı, Aktivite (Aksiyon Geçmişi).
                       RM rolü BU SAYFAYA HİÇ ULAŞMAZ — kendi init()'i içinde,
                       role==='regional-manager' ise admin.html'e yönlendirir
                       (index.html'in kendi yönlendirmesi zaten RM'yi admin.html'e
                       gönderiyor ama bu ikinci bir güvenlik/tutarlılık katmanı).
admin.html           — Admin + Super Admin + Regional Manager paneli — TEK dosya,
                       ~385K, projenin en büyük dosyası. RM burada window.isRM
                       bayrağıyla kısıtlanır (bkz. Bölüm 6).
i18n.js              — TR/EN çeviri sistemi, 4 sayfada da ortak <script> ile yüklenir
                       (bkz. Bölüm 8 — DİKKAT: mimari bir tuzağı var, mutlaka oku).
team-map.js          — deals.team kolonundaki yazım varyantlarını kanonik takım
                       adına ve bölgeye (Istanbul/Morocco) eşler (bkz. Bölüm 7).
alarm-engine.js      — İstemci tarafında (tarayıcıda) çalışan alarm üretim motoru
                       (bkz. Bölüm 9).
api/config.js        — Supabase URL + anon (publishable) key'i tarayıcıya JSON olarak verir.
api/login.js         — Kullanıcı adı/şifre doğrulama; service_role ile Users tablosuna
                       erişir; admin/super-admin için imzalı token üretir.
api/admin-users.js   — Users tablosu CRUD'u (admin panelindeki "Users" sayfası) —
                       service_role KULLANIR, Authorization: Bearer <token> ZORUNLU.
api/_auth.js         — HMAC token imzalama/doğrulama (signToken/verifyToken) +
                       rol normalize etme (normalizeRole) — login.js ve admin-users.js
                       arasında paylaşılan ortak modül.
vercel.json          — /api/config, /api/login, /api/admin-users için "uzantısız URL"
                       rewrite kuralları (örn. /api/login → api/login.js) + cleanUrls
                       (bu yüzden team-leader.html canlıda /team-leader olarak da açılır,
                       308 redirect ile).
package.json         — SADECE bcryptjs + xlsx bağımlılığı.
*.sql (repo kökü)     — Supabase şema/migration dosyaları — bkz. Bölüm 4, KRİTİK KISITLAMA.
```

**Kullanılmayan / eski dosyalar (referans yok, canlıda hiç çağrılmıyor):**
- `app.js` (39K) — hiçbir HTML'den `<script src="app.js">` ile çağrılmıyor.
- `deal_dashboard_kapsamli (1).html` (2.9MB) — eski bir prototip/tek seferlik export gibi duruyor.
- `supabase_schema.sql` — orijinal/ilk taslak şema, güncel `deals` tablosunun
  gerçek yapısıyla ARTIK UYUŞMUYOR (bkz. Bölüm 4). Sadece tarihsel referans.
- `CLAUDE.md` — repo kökünde var ama tamamen BOŞ (0 byte).
- `PROJECT_SUMMARY.md` (bu dosya) — sohbetler arası bağlam aktarımı için elle oluşturuldu, uygulamanın parçası değil.

---

## 4. SUPABASE ŞEMASI — GERÇEK, CANLI VERİDEN DOĞRULANMIŞ HALİ

**Supabase proje ref'i:** `aztxfncqanrodbttywrb` (proje adı: `natural-clinic-past-data-crm`)
Dashboard: `https://supabase.com/dashboard/project/aztxfncqanrodbttywrb`
SQL Editor: `https://supabase.com/dashboard/project/aztxfncqanrodbttywrb/sql`

**Erişim iki katmanlı:**
1. **Anon/publishable key** (`sb_publishable_IkbCNelsIjBPW6Tqkq4Egw_djjzvTXL`) —
   4 panelin HTML kaynağında da gömülü duruyor (herkes tarayıcıdan görebilir,
   bu NORMAL/beklenen — bu tip anahtarlar zaten "public" olarak tasarlanır),
   `api/config.js` üzerinden de servis edilir. Supabase'in **RLS (Row Level
   Security)** politikalarına tabi — asıl güvenlik sınırı burası.
2. **Service role key** (`SUPABASE_SERVICE_ROLE_KEY`, SADECE Vercel ortam
   değişkeni, tarayıcı asla görmez) — SADECE `api/login.js` ve
   `api/admin-users.js` içinde kullanılır, RLS'i tamamen bypass eder (yani bu
   iki endpoint, RLS ne derse desin Users tablosuna her zaman erişebilir).

### 4.1 Tablo: `deals` (ana veri, ~49.000+ satır, Zoho'dan senkron + bu app'in kendi kolonları)

| Kolon | Tip / Anlamı |
|---|---|
| `id` | Zoho'nun uzun sayısal ID'si (örn. `645008001075043552`), **text olarak saklanıyor** ama sayısal görünüyor — JS'de `Number.MAX_SAFE_INTEGER` (2^53) sınırını AŞIYOR, JSON'a çevirirken dikkat (bkz. Bölüm 11). |
| `deal_id` | Kısa, insan-okunur ID (örn. `"0626-52581"`) — ekranda "Deal ID" olarak gösterilen bu. |
| `deal_name`, `deal_owner`, `team`, `stage` | Düz metin, en sık filtrelenen alanlar. `stage` = Zoho pipeline aşaması (`"Reservation Pending"`, `"Cancelled"`, `"Won"` vb. — `projetanitim.md`'deki SON_STATULAR listesiyle örtüşüyor). |
| `amount`, `total_paid_amount`, `remaining_amount` | Sayısal, € cinsinden tutarlar. |
| `arrival_date`, `visit_date_1/2/3`, `consultation_date`, `last_activity_time` | Tarihler — alarm motorunun (Bölüm 9) temel girdisi. |
| `created_time`, `modified_time`, `synced_at` | Zoho senkron zaman damgaları (senkron mekanizması bu repoda yok). |
| `payment_or_flight_ticket` | `'Payment'` / `'Flight Ticket'` — deal'in ödeme mi uçak bileti mi takibi gerektirdiğini ayırır. |
| `is_deleted`, `deleted_at` | Zoho'da silinen dealler için soft-delete izi. |
| `result_codes` | **Zoho kaynaklı, ÇOĞUL** bir alan — bu app'in kendi `result_code` (tekil) alanıyla KARIŞTIRILMAMALI, farklı iki kolon. |
| `result_code`, `sub_code`, `agent_note`, `deal_status`, `lock_approval_requested` | **Bu uygulamanın kendi eklediği** agent iş akışı kolonları — `deals_agent_workflow_columns.sql` ile sonradan eklendi. Agent'ın "Sonuç Gir" modalı SADECE bunları yazar (`result_code` format: `"8. Cancelled"` gibi `"<kod>. <etiket>"`), Zoho'nun senkronladığı hiçbir alanı DEĞİŞTİRMEZ. `deal_status`: `'pending'` (varsayılan) → sonuç girilince `'locked'` (ya da not-reached ise `'not_reached'`). |
| `raw` | **Zoho'nun ham JSONB'si**, ~169 alan (`Owner`, `Stage`, `Amount`, `Payment_Or_Flight_Ticket`, `Visit_Date`/`Visit_Date1`/`Visit_Date2`, `Last_Activity_Time`, `Result_Codes`, `Team`, vb. — Zoho'nun kendi alan adlandırması, PascalCase/underscore karışık). TOAST'lanmış (ayrı diskte saklanan) büyük bir alan — sorgularda bilinçli olarak kaçınılıyor (bkz. RPC notları), sadece `alarm-engine.js` ve deal detay modalı buradan okuyor. |

⚠️ **KRİTİK GOTCHA:** `result_codes` (Zoho'dan gelen, ÇOĞUL) ile `result_code`
(bu app'in kendi yazdığı, TEKİL) İKİ FARKLI KOLON — kod yazarken/sorgu
kurarken karıştırma, birbirinin yerine geçmez.

### 4.2 Tablo: `alarms` (`alarms_table.sql`)
| Kolon | Anlamı |
|---|---|
| `id` | uuid, primary key. |
| `deal_id`, `deal_name`, `deal_owner`, `team`, `region`, `payment_or_flight_ticket` | Deal'den kopyalanmış bilgiler (JOIN yapmadan hızlı okumak için — `deals` tablosuna FK değil, gevşek bağlı text `deal_id`). |
| `alarm_type` | `arrival_approaching` \| `visit_approaching` \| `arrival_missing` \| `today_patient` \| `payment_tracking` \| `flight_ticket_tracking` \| `no_show` |
| `reference_field` | Hangi tarih alanından üretildiğini gösterir: `arrival_date` \| `visit_date_1/2/3` \| `last_activity_time` |
| `reference_date`, `threshold_days`, `days_remaining` | Alarmın tetiklendiği tarih ve eşik/kalan gün bilgisi. |
| `status` | `open` \| `seen` \| `in_progress` \| `arrived` \| `examined` \| `processing` \| `no_show` \| `closed` \| `escalated` \| `cancelled` — **DİKKAT:** bu, deal'in Zoho `stage`'inden TAMAMEN BAĞIMSIZ bir yaşam döngüsü (bkz. Bölüm 4.6, İptal Edilenler gotcha'sı). |
| `assigned_to` | Sorumlu Team Leader'ın username'i. |
| `note`, `close_reason` | TL'nin serbest metin notu / kapanış sebebi. |
| `dedup_key` | UNIQUE kısıt — `{deal_id}_{reference_field}_{threshold_days}_{reference_date}` formatında, mükerrer alarm oluşmasını DB seviyesinde engeller. |

### 4.3 Tablo: `alarm_logs` — alarm aksiyon denetim izi
`alarm_id`, `deal_id`, `action_type` (`status_change`\|`note`\|`closed`\|`reopened`\|`created`\|`auto_closed`),
`old_status`, `new_status`, `note`, `action_by`, `action_role`. Bu tablo iyi
tasarlanmış/parametreli — "Aksiyon Geçmişi" / "Aktivite" sayfaları bunu
render ederken `action_type`'ı DISPLAY ANINDA `I18N.t()` ile çeviriyor (doğru
mimari, bkz. Bölüm 8).

### 4.4 Tablo: `app_settings` — key/value sistem parametreleri
Varsayılan satırlar: `alarm_thresholds` = `'45,30,15,7,3'`, `missing_repeat_days` = `'3'`.
Admin panelinden değiştirilebilir, `alarm-engine.js` her çalıştığında bunu okur.

### 4.5 Tablo: `Users` (dikkat: BÜYÜK HARFLE başlıyor, PostgREST'te `"Users"` tırnaklı yazılmalı)
`id` (bigint identity — **JS precision sınırını aşıyor**, bkz. Bölüm 11),
`"Deal Owner Name"`, `"Username"`, `"Password"` (bcrypt hash — eski düz metin
kayıtlar ilk başarılı girişte "lazy migration" ile otomatik hashlenir),
`"Role"` (serbest metin: `"Admin"`, `"Team Leader"`, `"Regional Manager"` vb.
— `normalizeRole()` ile normalize edilir), `"Takim Adi"`.
**Anon key ile ARTIK HİÇ erişilemiyor** — bkz. Bölüm 5, güvenlik.

### 4.6 Tablo: `Logs` (denetim/aktivite logu, büyük harfle, GENEL AMAÇLI serbest metin)
`username`, `full_name`, `role`, `team`, `page`, `action_type`, `details`
(SERBEST METİN — bkz. Bölüm 8, i18n mimarisindeki tuzak), `deal_id`,
`deal_name`, `old_values`, `created_at`. `addLog()` fonksiyonu (her 3 panelde
de ayrı ayrı tanımlı, aynı isimle) her önemli aksiyonda buraya satır ekler.

⚠️ **İptal Edilenler / İptal Alarmları gotcha'sı (2026-07-22'de bulundu ve
düzeltildi):** "İptal Edilenler" (TL) / "İptal Alarmları" (admin/RM) sayfası
ve sol menüdeki bildirim rozeti, **deals.stage'in Zoho'da "Cancelled" olması**
VEYA **agent'ın result_code'u "8. Cancelled" girmesi** VEYA **bağlı bir
alarmın status'ünün "cancelled" olması** — ÜÇ FARKLI, birbirinden bağımsız
sinyalin BİRLEŞİMİNE bakıyor (`or=(stage.ilike.*cancel*,result_code.ilike.8.*)`
sorgusu + ayrıca `alarms.status='cancelled'` olan alarmların deal_id'leri
ayrıca çekilip merge ediliyor). Bu üçü BİRBİRİNİ GÜNCELLEMEZ — bir alarmı
"İptal / Geçersiz" yapmak `deals.stage`'i değiştirmez, `deals.stage`'in
Cancelled olması bir alarm oluşturmaz. Bu üç sinyalin merge edilme mantığı
`team-leader.html::loadCancelledDeals()` ve `admin.html::loadAdminCancelledDeals()`
içinde — ileride bu sayfayla ilgili bir "sayı tutmuyor" şikayeti gelirse ilk
bakılacak yer burası.

### 4.7 Tablo: `admin_cache`
Sadece `admin_language_breakdown()` RPC'sinin önbelleği (key-value, jsonb).
Yazma yetkisi YOK anon/authenticated için — sadece `security definer`
fonksiyonlar (RLS'i bypass ederek) yazabiliyor.

### 4.8 RPC Fonksiyonları (`admin_summary_rpc.sql`)
- **`admin_deal_summary(p_teams, p_date_from, p_date_to, p_created_from, p_created_to)`**
  — Admin panelinin TÜM KPI/rozet/Analytics rakamlarının kaynağı. 49K satırı
  tarayıcıya indirip JS'te toplamak yerine, Postgres'te tek geçişte
  (`materialized` CTE, `raw` kolonuna HİÇ dokunmadan) hesaplayıp birkaç KB'lık
  JSON döndürür. Parametresiz çağrı = ana panel özeti; Analytics'teki
  filtreler aynı fonksiyonu parametreli çağırır.
- **`admin_language_breakdown()`** / **`admin_refresh_language_breakdown()`**
  — Dil dağılımı `raw->>'Language'` üzerinden hesaplanır (TOAST detoast
  gerektirdiği için ~10sn sürüyor), bu yüzden `admin_cache`'te önbelleklenir;
  okuma anlık (<50ms), yenileme arka planda seyrek (saatte bir) tetiklenir.
- `admin_deal_summary_debug()` — sadece teşhis amaçlı, kalıcı bir özellik değil.

**Cutoff tarihi:** `2026-06-15` — badge hesaplamalarında hem RPC'de hem
`admin.html`'deki `isBeforeCutoff`'ta hardcoded, ikisi BİRLİKTE güncellenmeli.

---

## 5. GÜVENLİK MİMARİSİ VE TAMAMLANAN SERTLEŞTİRME (2026-07-22 itibarıyla TAM KAPALI)

Bu proje başlangıçta (muhtemelen hızlı prototipleme için) **tüm Supabase
tablolarında "herkes her şeyi yapabilir" (`FOR ALL USING (true) WITH CHECK
(true)`) politikasıyla** kuruldu — yani anon/publishable key'i bilen HERKES
(bu key zaten HTML kaynağında herkese açık) tüm tabloları okuyup
yazabiliyor, HATTA SİLEBİLİYORDU. Bu, kapsamlı bir güvenlik denetiminde
tespit edilip TAMAMEN kapatıldı. Güncel durum:

### 5.1 Kimlik doğrulama (gerçek Supabase Auth YOK, özel sistem)
- `index.html` → `POST /api/login` → `api/login.js` **service_role** ile
  `Users` tablosunda `Username` eşleşmesi arar, `bcrypt.compare` ile şifre
  doğrular. Eski düz metin şifreler ilk başarılı girişte otomatik bcrypt'e
  taşınır ("lazy migration" — ayrı toplu migrasyon scripti gerekmiyor).
- **Timing-attack / username-enumeration önlemi:** kullanıcı bulunamasa bile
  sahte bir bcrypt hash ile karşılaştırma yapılır (yanıt süresi sabit kalsın
  diye), hata mesajı her zaman aynı genel metin (`"Kullanıcı adı veya şifre
  hatalı."`).
- Başarılı giriş → `sessionStorage.nc_current_user` içine
  `{username, fullName, role, team, token?}` yazılır. `role`,
  `normalizeRole()` ile (`admin`/`super-admin`/`regional-manager`/`team-leader`/`agent`)
  NORMALİZE edilmiş hâliyle saklanır — `Users."Role"`'daki ham serbest metin değil.
- **Sadece admin/super-admin** için `api/login.js`, `api/_auth.js::signToken`
  ile **HMAC-SHA256 imzalı, 8 saat geçerli bir token** üretir
  (`AUTH_TOKEN_SECRET` env var, SADECE sunucuda, tarayıcı hiç görmez — token'ın
  kendisi `base64url(payload).base64url(hmac)` formatında tarayıcıya döner).
  Bu token, `api/admin-users.js`'in TÜM metodlarında (`GET/POST/PATCH/DELETE`)
  `Authorization: Bearer <token>` olarak ZORUNLU — yoksa/geçersizse/süresi
  dolmuşsa `401 {"error":"Yetkisiz erişim."}`.
  **ÖNEMLİ TARİHÇE:** Bu endpoint eskiden (bu güvenlik denetiminden ÖNCE)
  SIFIR kimlik doğrulama gerektiriyordu — internetteki HERKES bu URL'ye istek
  atarak Users tablosunda tam CRUD (şifre değiştirme/kullanıcı silme dahil)
  yapabilirdi. Canlı curl ile kanıtlanıp kapatıldı.
- **Regional Manager (RM) özel yönlendirmesi:** `admin.html`'de login olur
  (hem `index.html`'in hem `team-leader.html`'in kendi içindeki yönlendirme
  mantığı RM'yi admin.html'e gönderir — çift katmanlı güvence).
  `window.isRM = true` olunca:
  - Users/Logs nav linkleri gizlenir (`_applyRmUi()`).
  - Bölge (`_rmGetRegion()` — isimden veya takım adından Istanbul/Morocco
    tahmini) TÜM veri sorgularına (`deals`, `alarms`, `cancelled`, `won`,
    analytics) SUNUCU TARAFINDA `team=in.(...)` filtresi olarak eklenir
    (`TeamMap.aliasesForRegion()` ile o bölgedeki TÜM takım adı varyantları).
  - Cache anahtarları bölgeye göre ayrı tutulur (`_dealsCacheKey()` vb.
    `_rm_<region>` eki alır) — bir RM'nin cache'i diğer bölgeye/admin'e karışmaz.

### 5.2 Row Level Security (RLS) — Supabase tablo düzeyinde erişim kontrolü
**TÜM tablolarda RLS artık AÇIK ve doğru şekilde kısıtlı.** Kontrol için:
```sql
select relname, relrowsecurity from pg_class
where relname in ('Users','deals','alarms','Logs','alarm_logs','app_settings');
-- hepsi 'true' dönmeli
select tablename, policyname, cmd from pg_policies
where tablename in ('deals','alarms','Logs','alarm_logs','app_settings')
order by tablename, cmd;
-- 'ALL' veya 'DELETE' cmd'li HİÇBİR satır olmamalı
```
Güncel, doğru policy seti (uygulamanın kod taramasıyla doğrulanmış GERÇEK
kullanımına birebir denk):
- `deals`: SELECT + UPDATE (INSERT/DELETE YOK — Zoho'dan senkronlanıyor, uygulama hiç insert/delete etmiyor)
- `alarms`: SELECT + INSERT + UPDATE (DELETE YOK — kapatma zaten UPDATE ile status değişimi)
- `Logs`, `alarm_logs`: SELECT + INSERT (UPDATE/DELETE YOK — denetim kaydı, tamper-proof olması amaçlanıyor)
- `app_settings`: SELECT + INSERT + UPDATE
- `Users`: RLS açık ve **HİÇ policy yok** — yani anon/authenticated için TAMAMEN KAPALI, sadece `service_role` (yani `api/login.js`/`api/admin-users.js`) erişebiliyor.

⚠️ **BÜYÜK, TEKRAR TEKRAR DÜŞÜLEN TUZAK — ileride RLS/policy işine girişirsen
mutlaka oku:**
1. **RLS enable ≠ policy silmek.** `Users` tablosunda `drop policy "Public
   Access Policy"` çalıştırıldığında hiçbir şey değişmemişti — çünkü RLS'in
   KENDİSİ o tabloda hiç açık (`enable row level security`) değilmiş. Policy
   olsa da olmasa da RLS kapalıyken tablo herkese açık kalır. Her zaman ÖNCE
   `pg_class.relrowsecurity`'i kontrol et.
2. **"Herkese açık" policy'nin ADI tablodan tabloya FARKLI olabiliyor.**
   `deals` ve `Users`'da `"Public Access Policy"`, ama `alarms`/`alarm_logs`/
   `app_settings`'te sadece `"Public Access"` (sonunda "Policy" yok) —
   muhtemelen farklı zamanlarda farklı `.sql` dosyalarıyla oluşturuldukları
   için. `drop policy if exists "Public Access Policy" on X` çalıştırıp
   "başardım" sanmak YANLIŞ olabilir — gerçek adı `pg_policies`'ten
   DOĞRULAMADAN asla "kapandı" deme.
3. **DELETE'i "yok" gibi test etmek yanıltıcı.** Var olmayan bir ID'ye
   `DELETE ...?id=eq.NONEXISTENT` göndermek, RLS TARAFINDAN ENGELLENMİŞ olsun
   ya da olmasın AYNI `204`/0-satır sonucunu döner (çünkü zaten eşleşen satır
   yok). Gerçek DELETE korumasını doğrulamanın TEK güvenilir (ve veri
   silmeyen) yolu `pg_policies` çıktısında `cmd='DELETE'` (veya `cmd='ALL'`)
   olan HİÇBİR satır olmadığını görmek — gerçek bir satırı silerek test ETME.
4. **Ben (Claude) hiçbir DDL/SQL çalıştıramam** — sadece anon/publishable key
   ile REST erişimim var. Her RLS/policy/şema değişikliği kullanıcının
   Supabase SQL Editor'de MANUEL çalıştırmasını gerektiriyor (bkz. Bölüm 12).

### 5.3 Stored XSS koruması (`fmt()` / `_escHtml()`)
`fmt()` — deal adı, danışman notu, iptal sebebi gibi HEMEN HER YERDE
kullanılan biçimlendirme fonksiyonu — ÖNCEDEN hiç HTML escape yapmıyordu.
Birinin (veya bozuk bir Zoho senkron kaydının) bir deal adına
`<script>...</script>` yazması durumunda, o kaydı gören HERKESİN
tarayıcısında bu kod ÇALIŞIRDI. Artık `_escHtml()` (`&`,`<`,`>`,`"`,`'`
karakterlerini kaçırıyor) üzerinden geçiyor — `admin.html`, `team-leader.html`,
`agent.html`'in ÜÇÜNDE de kaynağında düzeltildi + durum/tip etiketi
fallback'leri, takım adı dropdown'ları, onclick içine gömülen isimler gibi
~40 ek nokta ayrıca kapatıldı.

### 5.4 Kabul edilmiş, bilinçli olarak kapsam dışı bırakılmış sınırlamalar
("sistemi bozma, sadece güvenlik açıklarını kapat" talimatı gereği):
- **Gerçek satır-bazlı RLS izolasyonu** (her TL/agent SADECE kendi
  takımının/kendi verisini Postgres seviyesinde görsün) — şu an TÜM rol/takım
  filtrelemesi UYGULAMA KATMANINDA (JS'te `team=in.(...)` sorgu parametreleri
  ile) yapılıyor, Postgres seviyesinde değil. Bu, gerçek Supabase Auth'a
  (her kullanıcı için gerçek bir `auth.uid()`) geçişle mümkün — büyük bir
  mimari değişiklik, mevcut "yama, bozma" kapsamının kesinlikle dışında.
- **CORS `Access-Control-Allow-Origin: '*'`** tüm 3 API endpoint'inde — düşük
  risk olarak değerlendirildi çünkü cookie-tabanlı ambient auth yok, her
  istek açıkça kimlik bilgisini (token/şifre) body/header'da taşımak zorunda.
- Sayısal id'lerin bazı `onclick` attribute'larına escape'lenmeden gömülmesi
  — PK'lar kullanıcı girdisi olmadığı için ihmal edilebilir risk olarak işaretlendi.

---

## 6. TAKIM / BÖLGE EŞLEME (`team-map.js`)

Zoho'daki `deals.team` alanı **aynı takım için birden çok yazım varyantı**
içeriyor (örn. `"Askif Team"` vs `"Team Leader - Abdulrahman Ziad Askif"` —
muhtemelen Zoho'da zaman içinde takım adları değiştirilmiş ama eski dealler
eski adla kalmış). `team-map.js`, her KANONİK takım için
`{label, leader, region, aliases[]}` tanımlar ve `ALIAS_INDEX` ile hızlı
normalize/lookup sağlar.

**14 takım, 2 bölge (Istanbul, Morocco):** Arij Team, Askif Team, Touma Team,
Mihoubi Team, Ahmed Anwar Team, Ghazal Team, Ali Omer Team, Aamir Ali Team,
Joel Team, SM-Mert Team, **Connor West Team** (`"Sales Master - Amin Connor
West"`, eski adı `"SM Amin Connor - Team"` — bu takım/TL 2026-07-21'de
sisteme eklendi), Farah Team, Sara Team, Selma Team, Ramadan Team (son 4'ü
Morocco bölgesi, geri kalanı Istanbul).

**Kritik kural:** Yeni bir takım/TL eklendiğinde `team-map.js`'e MUTLAKA yeni
bir entry eklenmesi gerekiyor — aksi halde o takımın dealleri hiçbir role
bazlı filtreye (TL kendi takımı, RM kendi bölgesi) düşmez, sanki hiç
yokmuş gibi davranır (veri kaybı değil, GÖRÜNMEZLİK sorunu).

---

## 7. ALARM MOTORU (`alarm-engine.js`)

**İstemci tarafında (tarayıcıda) çalışan** bir motor (`window.AlarmEngine`) —
sunucuda/cron'da çalışan bir background job DEĞİL, admin/TL paneli açıldığında
JS içinde tetikleniyor. `deals` + `app_settings`'ten (eşik parametreleri)
okuyup `alarms` tablosuna yazıyor.

- Sadece **aktif stage'lerdeki** dealler için alarm üretir (`ACTIVE_STAGES`:
  `Waiting appointment`, `Reservation Pending`, `Approval`, `Appointment
  confirmed`, `Waiting next visit`, `Waiting hotel confirmation`, `On Hold`,
  `Check in completed` — kapalı/Won/Cancelled dealler hariç).
- **Ödeme takibi** (`payment_tracking`) — `amount ≠ total_paid_amount` olan
  HER aktif deal (pft tipinden bağımsız; önceden sadece "Payment" tipi + eşik
  penceresine giren dealler taranıyordu, sonradan "hiçbir ödemesi eksik
  hasta kaçmasın" diye genişletildi).
- **Varış/ziyaret tarihi yaklaşıyor** — eşik pencereleri (45/30/15/7/3 gün,
  `app_settings.alarm_thresholds`'tan okunur, admin panelden değiştirilebilir)
  `visit_date_1/2/3` / `arrival_date` üzerinden hesaplanır.
- **Eksik tarih** (`arrival_missing`) — `missing_repeat_days` (varsayılan 3)
  parametresine göre her N günde bir yeniden tetiklenir (aynı deal için sürekli
  yeni alarm açmasın diye).
- **No-show**, **bugün gelecek hasta** (`today_patient`) gibi diğer tipler.
- **Mükerrer alarm engelleme:** `dedup_key` UNIQUE kısıtı —
  `{deal_id}_{reference_field}_{threshold_days}_{reference_date}` formatında
  (eksik tarih için: `{deal_id}_arrival_missing`). Motor her çalıştığında
  ayrıca kopya/geçersiz alarmları otomatik kapatır.
- Alarmın `alarms.status` alanı (open/seen/closed/cancelled/vb.), bağlı
  olduğu `deals.stage`'den **TAMAMEN BAĞIMSIZ** yaşıyor — bu ayrım Bölüm
  4.6'daki "İptal Edilenler" gotcha'sının kök nedeni.

---

## 8. i18n (TR/EN) SİSTEMİ (`i18n.js`) — MİMARİ VE TUZAKLARI

- `DICT`: Türkçe metin → İngilizce çeviri sözlüğü (~700 satır, sürekli
  büyüyor). Anahtar bulunamazsa orijinal metin AYNEN kullanılır (sessiz
  fallback — çeviri eksikse hata vermez, sadece Türkçe kalır).
- **Statik metin çevirisi:** Sayfa yüklenince `translateDOM()`, DOM'daki TÜM
  text node'ları (`NodeFilter.SHOW_TEXT` ile TreeWalker) + `placeholder`/`title`
  attribute'larını sözlükle TRIM edilmiş TAM EŞLEŞME ile değiştirir. Kısmi
  string eşleşmesi YAPMAZ — bir text node'un TAMAMI (baştaki/sondaki boşluk
  hariç) DICT'te birebir yoksa çevrilmez.
- **Dinamik metin** (JS'te üretilen etiket/rozet/bildirim): ilgili kodda
  `I18N.t('Türkçe metin')` ile sarmalanır. `t()` fonksiyonu ayrıca "sabit
  önek + dinamik değer" kalıbını da destekler — DICT'te `:` veya `: ` ile
  biten bir anahtar, çağrılan string'in BAŞINDA eşleşirse, o kısmı çevirip
  gerisini (dinamik veriyi) olduğu gibi ekler (örn. `I18N.t('Not: ')+not`).
- **Dil değişimi = TAM SAYFA RELOAD** (`I18N.toggle()` /
  `I18N.setLangAndReload()` → `localStorage.setItem('nc_lang', 'tr'|'en')`
  sonra `location.reload()`). Yani dil değişince TÜM JS state (allDeals,
  cache'ler, dealFinanceMap vb.) sıfırdan yüklenir — dile bağlı bir "bug"
  raporu geldiğinde, önce gerçekten dile mi bağlı yoksa sadece reload'un
  tetiklediği BAĞIMSIZ bir state/timing sorunu mu olduğunu ayırt et.
- Tercih `localStorage.nc_lang` içinde saklanır (`'tr'` varsayılan, key yoksa).

### 8.1 ⚠️ MİMARİ TUZAK (2026-07-22'de bulunup düzeltildi): "yazma anında çeviri"
Bu projede kritik bir kural: **veritabanına YAZILAN hiçbir metin `I18N.t()`
ile sarmalanmamalı.** `I18N.t()` SADECE görüntüleme (render) anında
çağrılmalı, YAZMA anında DEĞİL. Sebep: `I18N.t()` o ANKİ dile göre çeviri
yapar; sonucu DB'ye (örn. `Logs.details`, `alarms.close_reason`) YAZARSAN, o
kayıt SONSUZA KADAR o anki dilde donar. Kullanıcı diller arasında (TR↔EN)
gidip geldikçe, geçmiş kayıtlar KARIŞIK dilde birikir — "sistem yarı
İngilizce yarı Türkçe gösteriyor" şikayetinin kök nedeni buydu.

**Bulunan ve düzeltilen örnekler:**
- `agent.html`'de 3 yerde `addLog(..., \`${I18N.t('...')}...\`, ...)` şeklinde
  yazma-anında-çeviri vardı (`VIEW_DEAL`, `UNLOCK_REQUEST`, `LOGIN` logları) —
  admin.html/team-leader.html'deki addLog çağrıları hep düz Türkçe yazıyordu,
  agent.html tutarsızdı. Hepsi kanonik (sabit) Türkçe yazacak şekilde düzeltildi.
- `team-leader.html`'de otomatik ödeme-tamamlanınca-alarm-kapatma kuralı,
  `close_reason` alanına `I18N.t('Ödeme %100 ve deal Won — otomatik kapatıldı')`
  YAZIYORDU (write-time). Artık kanonik Türkçe yazılıyor, GÖRÜNTÜLENİRKEN
  (`fmt(I18N.t(a.close_reason))`) o anki dile çevriliyor.
- `admin.html`'deki "Aktivite" sayfasının `actionLabels` objesi (Durum
  Değişti/Kapatıldı/Yeniden Açıldı/vb.) HİÇ `I18N.t()` ile sarmalanmamıştı
  (team-leader.html'deki aynı obje doğru sarmalanmıştı, admin.html'de
  unutulmuştu) — eklendi.

**Kural özeti:** `Logs.details`, `alarms.close_reason`, `alarms.note` gibi
DB'ye yazılan HER free-text alan → yazarken SABİT TÜRKÇE, gösterirken
`I18N.t(deger)` (DICT'te birebir eşleşen kanonik cümleler için) veya yapılandırılmış
alanlarda (`action_type` gibi) render-anında etiket haritası. Yeni bir
`addLog()`/log-yazma noktası eklerken bu kurala uyulmazsa aynı bug geri gelir.

---

## 9. DEPLOYMENT / ALTYAPI

- **Vercel projesi:** `nc-pastdata-crm`, canlı URL: `https://nc-pastdata-crm.vercel.app`
- **Statik dosyalar** (`*.html`, `*.js`, `*.png`) doğrudan Vercel tarafından
  servis edilir — build adımı yok, tek klasör, teorik olarak Node/NPM
  olmadan `index.html`'e çift tıklayarak da açılabilir (orijinal tasarım
  hedefi — Supabase'e CORS ile doğrudan bağlanıyor).
- **`api/` klasörü** Vercel serverless functions olarak deploy olur (ES module
  `import`/`export` syntax'ı — `package.json`'da `"type":"module"` OLMASA DA
  Vercel'in Node runtime'ı bunu dosya bazında otomatik algılıyor).
- **`vercel.json`**: `cleanUrls: true` (yani `team-leader.html` canlıda hem
  `/team-leader.html` hem `/team-leader` olarak açılır, ikincisi birincisine
  308 redirect atar) + `/api/config`, `/api/login`, `/api/admin-users` için
  uzantısız rewrite kuralları.
- **Vercel ortam değişkenleri (production):** `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY` (GİZLİ, sadece server), `AUTH_TOKEN_SECRET`
  (GİZLİ, sadece server, admin token imzalama için).
- **Deploy komutu:** `npx vercel --prod --yes` — CI/CD pipeline YOK, her
  deploy manuel olarak terminalden tetikleniyor (GitHub push otomatik deploy
  TETİKLEMİYOR, en azından bu oturumda hep manuel `vercel --prod` kullanıldı).

---

## 10. STİL / TASARIM NOTLARI

- Karanlık tema (`#020617`/`#080b11` arka plan), Tailwind (admin/agent) +
  elle CSS (team-leader). Font: Outfit (başlıklar) + Inter (gövde metni).
- **Tüm tablolardaki sütun başlıkları (`<th>`) artık KIRMIZI** (`#f87171`) —
  her 3 panel dosyasının `<style>` bloğuna eklenen tek bir
  `th { color: #f87171 !important; }` kuralıyla, hangi tablo hangi CSS
  sınıfını/inline stilini kullanırsa kullansın (bilinçli kullanıcı isteği,
  2026-07-22).
- **Alarm tablolarındaki "Durum" (Status) rozetlerinin metin/arkaplan rengi
  de artık TEK TİP KIRMIZI** (`color:#f87171`, `bg:#450a0a`) — önceden her
  status (open/seen/closed/escalated/vb.) farklı bir renkteydi (amber, mavi,
  yeşil, turuncu...), artık hepsi kırmızı, sadece ETİKET METNİ farklı
  (bilinçli kullanıcı isteği, 2026-07-22). Bu, `team-leader.html::statusMeta()`
  ve `admin.html::_amStatusMeta()` fonksiyonlarında merkezi olarak tanımlı —
  tüm alarm tabloları (Alarmlar, Bugün Gelecekler, No-show vb.) buradan besleniyor.

---

## 11. BİLİNEN TEKNİK BORÇ / DİKKAT EDİLECEK NOKTALAR (ÖZET LİSTE)

- **JS `Number.MAX_SAFE_INTEGER` (2^53) sınırı:** `Users.id` ve `deals.id`
  gibi Zoho tarzı ~18 haneli sayısal ID'ler bu sınırı aşıyor. JSON üzerinden
  geçerken sessizce yuvarlanabilir → `id=eq.<değer>` filtreleri SIFIR satır
  eşleştirebilir (PostgREST bunu HATA vermeden, sessizce 2xx ile onaylar).
  **Kural: `Users` tablosuna `api/admin-users.js` üzerinden yazarken her
  zaman `username` (text) ile hedefle, `id` ile DEĞİL.**
- **`result_codes` (Zoho, çoğul) ≠ `result_code` (bu app, tekil)** — bkz. Bölüm 4.1.
- **`supabase_schema.sql` güncel DEĞİL** — gerçek `deals` şemasını
  yansıtmıyor, sadece ilk taslak. Güncel şema için Bölüm 4'e güven, bu dosyayı okuma.
- **Dil değişimi = tam reload**, bkz. Bölüm 8 — dile bağlı görünen bir "bug"
  raporunu araştırırken önce gerçek nedeni ayırt et.
- **"Yazma anında çeviri" tuzağı**, bkz. Bölüm 8.1 — yeni bir DB'ye
  yazma/log noktası eklerken tekrar düşülebilir.
- **RLS policy adlandırma tutarsızlığı**, bkz. Bölüm 5.2 — `pg_policies`'ten
  doğrulamadan "kapandı" deme.
- **"İptal Edilenler" üç-sinyal birleşimi**, bkz. Bölüm 4.6 — stage/result_code/alarm.status birbirini güncellemiyor.
- Yeni bir takım/TL eklendiğinde `team-map.js`'e MUTLAKA eklenmeli (Bölüm 6).
- Ben (Claude) hiçbir DDL/SQL/migration çalıştıramam — HER şema/RLS
  değişikliği kullanıcının Supabase SQL Editor'de manuel çalıştırmasını
  gerektiriyor (Bölüm 12).

---

## 12. SQL MİGRASYON DOSYALARININ ÇALIŞTIRILMA DURUMU (2026-07-22 itibarıyla)

Bu projede **hiçbir DDL/SQL çalıştırma kanalı yok** — sadece REST-seviyesi
tablo erişimi (anon key) + 2 sunucu endpoint'i (service_role, ama sadece
belirli işlemler için). Repo kökündeki HER `.sql` dosyası, **kullanıcının
kendisi tarafından Supabase SQL Editor'de manuel çalıştırılması gereken bir
"hazır reçete"**dir. Yeni bir oturumda "column does not exist" (Postgres kod
`42703`) gibi bir 400 hatası görürsen, önce **repodaki `.sql` dosyalarına
bak** — muhtemelen ilgili migration hazır ama henüz çalıştırılmamıştır.

| Dosya | Durum |
|---|---|
| `supabase_schema.sql` | Çalıştırılmış (eski/ilk taslak şema — artık gerçek `deals` yapısını yansıtmıyor, bkz. Bölüm 11) |
| `alarms_table.sql`, `alarm_logs_and_settings.sql` | Çalıştırılmış (tablolar mevcut, aktif kullanımda) |
| `deals_agent_workflow_columns.sql` | Çalıştırılmış (`result_code` vb. kolonlar canlıda doğrulandı) |
| `admin_summary_rpc.sql` | Çalıştırılmış (RPC canlıda çalışıyor, admin.html kullanıyor) |
| `alarm_dedup_cleanup.sql` / `_v2.sql` | Muhtemelen çalıştırılmış (tek seferlik temizlik scriptleri) — kesin teyit edilmedi |
| `users_rls_lockdown.sql` | ✅ Çalıştırıldı — asıl etkiyi dosyada YAZILI OLMAYAN, ek olarak verilen `alter table public."Users" enable row level security;` sağladı (RLS hiç açık değilmiş). |
| `rls_hardening.sql` | ✅ **Çalıştırıldı ve TAM olarak doğrulandı (2026-07-22)** — `deals`/`alarms`/`Logs`/`alarm_logs`/`app_settings`'te artık `ALL`/`DELETE` policy YOK, sadece uygulamanın gerçekten kullandığı SELECT/INSERT/UPDATE var. Dosyanın kendi DROP komutları `alarms`/`alarm_logs`/`app_settings`'teki gerçek policy adını (`"Public Access"`, dosyadaki `"Public Access Policy"` değil) YAKALAYAMADIĞI için ilk denemede eksik kaldı, ikinci bir `drop policy if exists "Public Access" on ...` turuyla tamamlandı. Bkz. Bölüm 5.2, tuzak #2. |

**Şu an bilinen, bekleyen hiçbir kritik güvenlik migration'ı YOK.** Yeni bir
tablo/kolon eklenirse aynı disiplin izlenmeli: SQL dosyası yaz → kullanıcıya
SQL Editor'de çalıştırt → `pg_policies`/`pg_class.relrowsecurity` ile
DOĞRULA → canlı regresyon testi (login, temel CRUD) yap.

---

## 13. KRONOLOJİ — BU SÜRECE KADAR YAPILAN BAŞLICA İŞLER (yaklaşık sıra)

1. Turkish→English çeviri boşlukları (gün filtresi chip'leri, pager/totals
   satırları) admin.html + team-leader.html'de kapatıldı.
2. İptal Edilenler akışında HTTP 400 (eksik `deals_agent_workflow_columns.sql`
   migration'ı) teşhis edilip kullanıcı tarafından SQL Editor'de çalıştırıldı.
3. Sonuç kodu kaydedilince kart içinde aksiyon olarak görünmesi + "Sonuç
   Kodunu Sil" özelliği (not silme ile aynı desen) eklendi.
4. Connor West takımı/TL'si keşfedilip `team-map.js`'e eklendi, `Users`
   tablosunda hesabı açıldı (Zoho'da eski/duplicate bir kayıtla karışıklık
   yaşanıp düzeltildi).
5. **Kapsamlı güvenlik + performans denetimi:**
   - `api/admin-users.js` sıfır-auth açığı → token zorunluluğu getirildi.
   - Site geneli stored-XSS (`fmt()`) kapatıldı.
   - 17 arama kutusuna debounce eklendi (donma/kasma fix).
   - `Users` tablosu RLS kilidi (RLS hiç açık değilmiş, açıldı).
6. RM'nin "All Deals" sayfasındaki pager/totals şikayeti araştırıldı — kod
   incelemesinde bug bulunamadı, kullanıcı sonradan "hata yokmuş" dedi.
7. Çok detaylı bir `PROJECT_SUMMARY.md` ilk kez oluşturuldu (bu dosyanın önceki sürümü).
8. **i18n mimari tuzağı bulundu ve düzeltildi:** yazma-anında-çeviri
   (agent.html'in 3 addLog çağrısı, team-leader.html'in auto-close
   close_reason'ı) + admin.html'in Aktivite sayfasındaki eksik `I18N.t()`
   sarmalaması.
9. **"İptal Edilenler" bildirim sayısı güncellenmiyor" şikayeti** araştırıldı,
   3 aşamada çözüldü: (a) result_code=Cancelled olan ama stage'i hâlâ eski
   olan dealler sorguya eklendi, (b) alarm.status='cancelled' olan ama
   deal.stage'i değişmeyen dealler de merge edildi, (c) bir alarm "İptal /
   Geçersiz" yapılınca liste/rozet ANINDA (sayfa değiştirmeden) yenilenecek
   şekilde tetikleyici eklendi.
10. Tüm tablolardaki "Durum" (Status) rozetleri tek tip kırmızıya çevrildi,
    ardından tüm tablo başlıkları (`<th>`) da kırmızıya çevrildi (kullanıcı isteği, stil).
11. **`rls_hardening.sql` sonunda tam olarak çalıştırıldı** — `deals`/`alarms`/
    `Logs`/`alarm_logs`/`app_settings`'te DELETE/ALL policy tamamen kapatıldı,
    policy-adı-uyuşmazlığı tuzağı (bkz. Bölüm 5.2) bu süreçte keşfedildi.
    **Bu, projenin bilinen SON kritik güvenlik açığıydı — artık kapalı.**
12. Bu dosya (`PROJECT_SUMMARY.md`), tüm bu süreci yansıtacak şekilde
    kapsamlı olarak güncellendi (2026-07-22).

**Şu an bilinen açık/bekleyen bir güvenlik ya da kritik fonksiyonel iş YOK.**
