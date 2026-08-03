// Users."Takim Adi" ← deals.team senkronu (Zoho gerçeği tek kaynak).
//
// NEDEN
// Bir danışman Zoho'da takım değiştirdiğinde bu değişiklik yalnızca deals
// tablosuna yansıyordu; Users."Takim Adi" elle bakımlı olduğu için kişi ESKİ
// liderinin altında görünmeye devam ediyordu (ör. Adam Naciri Moutaharrik
// Team'e geçtiği hâlde Sara/Giulia takımında, Edward Blake Joel Team'e geçtiği
// hâlde Ali Omer Team'de). "Takımımdaki Kişiler", Günlük Ekip Girişi ve takım
// lideri veri kapsamı hep bu alandan besleniyor.
//
// KURAL: kişinin EN SON deal'inin takımı = güncel takımı.
// Bu kural canlı veriyle doğrulandı (49.937 deal / 337 deal sahibi):
//   - 334 sahip tek takımda, hiç geçiş yok
//   - 2 sahipte geçiş var ve TEMİZ/kronolojik (Marco Rahimi: Moutaharrik 2024 →
//     Farah 2025+; Edward Blake: Ali Omer → Joel, Tem 2026) — yani deals.team
//     "o andaki takım"ı doğru tutuyor, en son kayıt güncel takımı veriyor
//   - 1 sahip (Arij Mahjoubi) kendi takımı ile 'Executive Board - CEO' arasında
//     gidip geliyor; satış takımı olmayan birimler aşağıda ELENDİĞİ için sorun
//     değil, son 83 deal'i tutarlı
//
// GÜVENLİK: Users."Takim Adi" bir takım liderinin HANGİ takımın verisini
// gördüğünü belirliyor. Bu yüzden yalnızca TeamMap'te TANINAN satış takımları
// yazılabilir — Profclinic, Finance, VIP Team, Executive Board, Aftercare gibi
// birimler ya da hiç tanınmayan bir ad asla Users'a yazılmaz.
import { verifyToken, bearerToken } from './_auth.js';

const FALLBACK_URL = 'https://aztxfncqanrodbttywrb.supabase.co';

// team-map.js'deki kanonik takım → alias eşlemesinin sunucu tarafı kopyası.
// deals.team bu aliasların herhangi biri olabilir; hepsi kanonik ada indirilir.
const TEAM_ALIASES = {
  'Arij  Team': ['Arij  Team', 'Arij Team', 'Team Leader-Arij Mahjoubi'],
  'Askif Team': ['Askif Team', 'Team Leader - Abdulrahman Ziad Askif'],
  'Touma Team': ['Touma Team', 'Team Leader- Abdulkader Touma', 'Toumi Team'],
  'Mihoubi Team': ['Mihoubi Team', 'Team Leader - Mihoubi'],
  'Ahmed Anwar Team': ['Ahmed Anwar Team', 'Team Leader-Ahmed Anwar'],
  'Ghazal Team': ['Ghazal Team', 'Team Leader - Ahmad Ghazal'],
  'Ali Omer Team': ['Ali Omer Team', 'Team Leader - Ali Omer'],
  'Aamir Ali Team': ['Aamir Ali Team', 'Team Leader - Aamir Ali'],
  'Joel Team': ['Joel Team', 'Team Leader - Joel'],
  'SM- Mert Team': ['SM- Mert Team', 'Mert Jospeh - Sales Master'],
  'Sales Master - Amin Connor West': ['Sales Master - Amin Connor West', 'SM Amin Connor - Team'],
  'Farah Team - Morocco': ['Farah Team - Morocco', 'Team Leader - Farah'],
  'Sara Team - Morocco': ['Sara Team - Morocco', 'Team Leader - Sara'],
  'Selma Team - Morocco': ['Selma Team - Morocco', 'Team Leader - Selma'],
  'Ramadan Team - Morocco': ['Ramadan Team - Morocco', 'Team Leader - Abdelatif Ramadan'],
  'Moutaharrik Team - Morocco': ['Moutaharrik Team - Morocco', 'Team Leader - Moutaharrik Marco'],
};

// Karşılaştırma anahtarı — team-map.js'deki key() ile AYNI olmalı
// ("Arij  Team" gibi çift boşluklu varyantlar eşleşsin).
function tkey(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

const ALIAS_INDEX = {};
for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
  for (const a of aliases) ALIAS_INDEX[tkey(a)] = canonical;
}

// deals.team → kanonik satış takımı; tanınmıyorsa null (yazılmaz).
function normalizeTeam(t) { return ALIAS_INDEX[tkey(t)] || null; }

function nameKey(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

// Takım lideri / bölge yöneticisi / admin rollerinin takımı, sahip oldukları
// deallerden TÜRETİLEMEZ — göreve göre atanır ve elle yönetilir.
//
// Somut vaka: Marco Rahimi, Farah Team'de danışmanken Moutaharrik Team'in
// lideri oldu. En son deal'i (May 2026) hâlâ "Farah Team - Morocco" diyor;
// "en son deal kazanır" kuralı onu Moutaharrik liderliğinden alıp Farah'a
// geri atardı ve kendi takımının verisini göremez, Farah'ın verisini görürdü.
// Bu yüzden yönetici rolleri senkronun DIŞINDA.
// (Regex, admin.html / team-leader.html'deki _isBoss ile aynı.)
const BOSS_ROLE_RE = /leader|lider|manager|müdür|mudur|admin|yönetici|yonetici|\btl\b|\brm\b/i;
function isBossRole(role) { return BOSS_ROLE_RE.test(String(role || '')); }

// Zoho'ya göre işten ayrılmış mı?
// DİKKAT: `status` tek başına YETMİYOR — canlı veride exit_date'i geçmişte olan
// 5 kişi hâlâ status='active' görünüyor (Max Halit 30.07, Tyler Karim 24.07,
// Amury Blanchet 30.07, Zoe Lane 01.06, Nicholas Parker 06.05). Bu yüzden
// exit_date asıl ölçüt, status ikincil.
function isLeaver(z) {
  if (String(z.status || '').toLowerCase() !== 'active') return true;
  if (z.exit_date) {
    const d = new Date(z.exit_date);
    if (!isNaN(d) && d <= new Date()) return true;
  }
  return false;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const SUPABASE_URL = process.env.SUPABASE_URL || FALLBACK_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_KEY) {
    res.status(500).json({ error: 'Sunucu yapılandırma hatası: SUPABASE_SERVICE_ROLE_KEY eksik.' });
    return;
  }
  const AUTH_SECRET = process.env.AUTH_TOKEN_SECRET;
  if (!AUTH_SECRET) {
    res.status(500).json({ error: 'Sunucu yapılandırma hatası: AUTH_TOKEN_SECRET eksik.' });
    return;
  }
  // Users."Takim Adi" yetkilendirme kapsamını belirlediği için bu uç yalnızca
  // admin/super-admin'e açık.
  const claims = verifyToken(bearerToken(req), AUTH_SECRET);
  if (!claims || !['admin', 'super-admin'].includes(claims.r)) {
    res.status(401).json({ error: 'Yetkisiz erişim.' });
    return;
  }

  const H  = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY };
  const HJ = { ...H, 'Content-Type': 'application/json; charset=utf-8' };

  // PostgREST yanıtları 1000 satırda KESİLİYOR (db-max-rows) — "limit=2000"
  // yazmak bunu değiştirmiyor, fazlası sessizce düşer. Bu yüzden sayfalı çek.
  async function fetchAllPaged(path) {
    const out = [];
    let offset = 0;
    while (true) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}&limit=1000&offset=${offset}`, { headers: H });
      if (!r.ok) return { ok: false, rows: out };
      const batch = await r.json();
      if (!Array.isArray(batch) || !batch.length) break;
      out.push(...batch);
      if (batch.length < 1000) break;
      offset += 1000;
    }
    return { ok: true, rows: out };
  }

  try {
    // ── 0. Zoho kullanıcı aynası (varsa BİRİNCİL kaynak) ──────────────
    // zoho_users, Zoho'nun Users modülünün aynası (bkz. zoho_users_sync.sql):
    // takımı DOĞRUDAN söyler ve aktif/pasif durumu taşır — "en son deal'in
    // takımı" ise yalnızca bir VEKİL göstergeydi (deal sahibi olmayanları hiç
    // görmez, ayrılanları anlamaz). Tablo henüz kurulmadıysa (404) sessizce
    // eski vekil kurala düşülür.
    // NOT: takım bilgisi `role` alanında — Zoho'da ayrı bir "team" alanı yok.
    // Üyelerde kanonik ad ("Farah Team - Morocco"), takım liderlerinde alias
    // ("Team Leader - Farah") geliyor; ikisi de normalizeTeam ile aynı kanonik
    // ada iniyor. Bu sayede liderin takımı da doğru çıkıyor ve deals tabanlı
    // vekil kuralda gereken "yönetici rolünü atla" istisnası burada GEREKMİYOR.
    const zoho = new Map();      // nameKey → zoho_users satırı
    {
      const zr = await fetchAllPaged(
        'zoho_users?select=id,full_name,original_agent_name,email,role,region,status,exit_date,phone,mobile&order=id.asc');
      if (zr.ok) {
        for (const z of zr.rows) {
          const k = nameKey(z.full_name);
          if (k) zoho.set(k, z);
        }
      }
    }
    // DİKKAT: "ayna kullanılabilir" ölçütü tablonun VARLIĞI değil, DOLU olması.
    // Tablo oluşturulup dış senkron henüz yazmamışsa (boş tablo) sorgu 200
    // dönüyor; yalnızca varlığa bakılsaydı deal taraması atlanır ve takım
    // eşitlemesi sessizce hiçbir şey önermez hâle gelirdi.
    const zohoAvailable = zoho.size > 0;

    // ── 1. Vekil kural: her deal sahibinin EN SON deal'indeki takım ──────
    // Yalnızca zoho_users YOKSA gerekli — ayna varsa takımı doğrudan biliyoruz,
    // 50 bin satırı taramanın anlamı yok (Vercel fonksiyon süresini yakardı).
    //
    // AZALAN sırada gidip her sahibi İLK görüldüğünde kaydediyoruz: azalan
    // sırada bir sahibin ilk kaydı = en son deal'i. Böylece tüm tabloyu
    // taramaya gerek kalmıyor, sayfa sayısı üstten sınırlı.
    const latest = new Map();   // nameKey → { team, date, count }
    let scannedDeals = 0, scanTruncated = false;
    if (!zohoAvailable) {
      const PAGE = 1000;
      const MAX_PAGES = 12;          // ~12k deal — pratikte son ~1.5 yılı kapsıyor
      const DEADLINE = Date.now() + 8000;   // sn cinsinden bütçe: fonksiyon zaman aşımına düşmesin
      for (let page = 0; page < MAX_PAGES; page++) {
        if (Date.now() > DEADLINE) { scanTruncated = true; break; }
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/deals?select=deal_owner,team,created_time` +
          `&order=created_time.desc.nullslast&limit=${PAGE}&offset=${page * PAGE}`,
          { headers: H }
        );
        if (!r.ok) { res.status(502).json({ error: 'Veritabanı hatası (deals).' }); return; }
        const batch = await r.json();
        if (!Array.isArray(batch) || !batch.length) break;
        scannedDeals += batch.length;
        for (const row of batch) {
          const k = nameKey(row.deal_owner);
          if (!k) continue;
          const canonical = normalizeTeam(row.team);
          if (!canonical) continue;        // satış dışı birim / tanınmayan ad → yok say
          const prev = latest.get(k);
          if (prev) { prev.count++; continue; }   // ilk görülen (= en son) kalır
          latest.set(k, { team: canonical, date: row.created_time || null, count: 1 });
        }
        if (batch.length < PAGE) break;
        if (page === MAX_PAGES - 1) scanTruncated = true;
      }
    }

    // ── 2. Users ile karşılaştır ──
    const uRes = await fetchAllPaged('Users?select=*&order=id.asc');
    if (!uRes.ok) { res.status(502).json({ error: 'Veritabanı hatası (Users).' }); return; }
    const users = uRes.rows;

    const changes = [];     // takım değişiklikleri
    const leavers = [];     // Zoho'da artık aktif olmayanlar
    let skippedBoss = 0;
    for (const u of users) {
      const ownerName = u['Deal Owner Name'] || u['Username'] || '';
      const z = zoho.get(nameKey(ownerName));

      // ── Ayrılanlar ──
      // Kayıt silinmiyor, yalnızca is_active=false (geçmiş veriye bağlı).
      // Yönetici rolleri de dahil: ayrılan bir takım lideri de girmemeli.
      if (z && isLeaver(z) && u['is_active'] !== false) {
        leavers.push({
          username: u['Username'] || '',
          fullName: ownerName,
          role: u['Role'] || '',
          team: String(u['Takim Adi'] || '').trim(),
          zohoStatus: z.exit_date
            ? `exit_date ${String(z.exit_date).slice(0, 10)}`
            : (z.status || '(bilinmiyor)'),
          // Panelde "neden aktif değil" sorusunu cevaplayabilmek için ham
          // alanlar da gidiyor: exit_date ve status BAĞIMSIZ iki gerekçe
          // (isLeaver notuna bakınız — exit_date geçmişte olup status hâlâ
          // 'active' görünen kişiler var). Tek bir birleşik metin bunları
          // ayırt edilemez hâle getiriyordu.
          exitDate: z.exit_date ? String(z.exit_date).slice(0, 10) : null,
          zohoStatusRaw: z.status || null,
          zohoRole: z.role || '',
          email: z.email || '',
        });
        continue;   // ayrılan biri için takım güncellemesi anlamsız
      }

      // ── Takım ──
      // Kaynak tercihi: zoho_users.role (doğrudan bilgi) > en son deal (vekil).
      let target = null, source = null, dealCount = null, lastDealDate = null;
      const zTeam = z && normalizeTeam(z.role);
      if (zTeam) {
        // Zoho doğrudan söylüyor — yönetici rolü istisnasına GEREK YOK, çünkü
        // liderin role'ü de ("Team Leader - X") kendi takımına iniyor.
        target = zTeam;
        source = 'zoho_users';
      } else {
        // Vekil kural: burada yönetici rolleri ATLANIR. Somut vaka — Marco
        // Rahimi Farah Team'de danışmanken Moutaharrik lideri oldu; en son
        // deal'i hâlâ "Farah Team" diyor, bu koruma olmasa liderliğinden
        // alınıp Farah'a geri atılırdı.
        if (isBossRole(u['Role'])) { skippedBoss++; continue; }
        const info = latest.get(nameKey(ownerName));
        if (!info) continue;                                 // hiç sinyal yok
        target = info.team;
        source = 'latest_deal';
        dealCount = info.count;
        lastDealDate = info.date;
      }

      const current = String(u['Takim Adi'] || '').trim();
      // Users'taki mevcut değeri de kanonize et — yalnızca yazım varyantı
      // farkıysa (ör. "Arij Team" ↔ "Arij  Team") gereksiz yazma yapmayalım.
      if ((normalizeTeam(current) || current) === target) continue;
      changes.push({
        username: u['Username'] || '',
        fullName: ownerName,
        role: u['Role'] || '',
        from: current,
        to: target,
        source,
        dealCount,
        lastDealDate,
      });
    }

    if (req.method === 'GET') {
      res.status(200).json({
        scanned: users.length,
        owners: latest.size,
        zohoAvailable,          // false → zoho_users kurulmamış, vekil kural kullanılıyor
        zohoUsers: zoho.size,
        scannedDeals,
        // true → deal taraması sınıra/süreye takıldı; uzun süre deal'i olmayan
        // kişiler için sinyal alınamamış olabilir (yanlış öneri DEĞİL, eksik öneri).
        scanTruncated,
        skippedBoss,
        changes,
        leavers,
      });
      return;
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      // Belirli kullanıcı(lar) istenirse yalnızca onlar uygulanır; verilmezse tümü.
      const only = Array.isArray(body?.usernames) ? new Set(body.usernames.map(String)) : null;
      // Ayrılanların girişini kapatmak AYRI ve açık bir onay gerektiriyor —
      // takım güncellemesiyle birlikte sessizce olmasın.
      const doDeactivate = body?.deactivateLeavers === true;

      // Users.id bigint JS safe-integer sınırını aşabiliyor — Username ile
      // hedefle (bkz. api/team-members.js'deki aynı not).
      async function patchUser(username, payload) {
        return fetch(
          `${SUPABASE_URL}/rest/v1/Users?Username=eq.${encodeURIComponent(username)}`,
          { method: 'PATCH', headers: { ...HJ, Prefer: 'return=minimal' }, body: JSON.stringify(payload) }
        );
      }

      const applied = [], failed = [];
      for (const c of (only ? changes.filter(x => only.has(x.username)) : changes)) {
        if (!c.username) { failed.push({ ...c, error: 'Username boş' }); continue; }
        const pR = await patchUser(c.username, { 'Takim Adi': c.to, updated_at: new Date().toISOString() });
        if (pR.ok) applied.push(c);
        else failed.push({ ...c, error: 'HTTP ' + pR.status });
      }

      const deactivated = [];
      if (doDeactivate) {
        for (const l of (only ? leavers.filter(x => only.has(x.username)) : leavers)) {
          if (!l.username) { failed.push({ ...l, error: 'Username boş' }); continue; }
          const pR = await patchUser(l.username, {
            is_active: false,
            deactivated_at: new Date().toISOString(),
            deactivation_reason: `Zoho status: ${l.zohoStatus}`,
            updated_at: new Date().toISOString(),
          });
          if (pR.ok) deactivated.push(l);
          else failed.push({ ...l, error: 'HTTP ' + pR.status });
        }
      }

      res.status(200).json({
        applied, deactivated, failed,
        appliedCount: applied.length,
        deactivatedCount: deactivated.length,
        failedCount: failed.length,
      });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: 'Sunucu hatası: ' + e.message });
  }
}
