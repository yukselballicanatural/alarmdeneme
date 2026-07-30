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

  try {
    // ── 1. Her deal sahibinin EN SON (tanınan takımdaki) deal'ini bul ──
    // created_time'a göre ARTAN gidiyoruz; aynı sahip için sonraki kayıt
    // öncekini eziyor, böylece döngü sonunda elimizde en son takım kalıyor.
    const latest = new Map();   // nameKey → { team, date, count }
    let offset = 0;
    const PAGE = 1000;
    while (true) {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/deals?select=deal_owner,team,created_time` +
        `&order=created_time.asc&limit=${PAGE}&offset=${offset}`,
        { headers: H }
      );
      if (!r.ok) { res.status(502).json({ error: 'Veritabanı hatası (deals).' }); return; }
      const batch = await r.json();
      if (!Array.isArray(batch) || !batch.length) break;
      for (const row of batch) {
        const k = nameKey(row.deal_owner);
        if (!k) continue;
        const canonical = normalizeTeam(row.team);
        if (!canonical) continue;          // satış dışı birim / tanınmayan ad → yok say
        const prev = latest.get(k);
        latest.set(k, {
          team: canonical,
          date: row.created_time || (prev && prev.date) || null,
          count: (prev ? prev.count : 0) + 1,
        });
      }
      if (batch.length < PAGE) break;
      offset += PAGE;
      if (offset > 200000) break;          // emniyet supabı
    }

    // ── 2. Users ile karşılaştır ──
    const uR = await fetch(`${SUPABASE_URL}/rest/v1/Users?select=*&order=id.asc&limit=2000`, { headers: H });
    if (!uR.ok) { res.status(502).json({ error: 'Veritabanı hatası (Users).' }); return; }
    const users = await uR.json();

    const changes = [];
    for (const u of users) {
      const ownerName = u['Deal Owner Name'] || u['Username'] || '';
      const info = latest.get(nameKey(ownerName));
      if (!info) continue;                                   // hiç tanınan deal'i yok
      const current = String(u['Takim Adi'] || '').trim();
      // Users'taki mevcut değeri de kanonize et — yalnızca yazım varyantı
      // farkıysa (ör. "Arij Team" ↔ "Arij  Team") gereksiz yazma yapmayalım.
      if ((normalizeTeam(current) || current) === info.team) continue;
      changes.push({
        username: u['Username'] || '',
        fullName: ownerName,
        role: u['Role'] || '',
        from: current,
        to: info.team,
        dealCount: info.count,
        lastDealDate: info.date,
      });
    }

    if (req.method === 'GET') {
      res.status(200).json({ scanned: users.length, owners: latest.size, changes });
      return;
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      // Belirli kullanıcı(lar) istenirse yalnızca onlar uygulanır; verilmezse tümü.
      const only = Array.isArray(body?.usernames) ? new Set(body.usernames.map(String)) : null;
      const target = only ? changes.filter(c => only.has(c.username)) : changes;

      const applied = [];
      const failed  = [];
      for (const c of target) {
        if (!c.username) { failed.push({ ...c, error: 'Username boş' }); continue; }
        // Users.id bigint JS safe-integer sınırını aşabiliyor — Username ile
        // hedefle (bkz. api/team-members.js'deki aynı not).
        const pR = await fetch(
          `${SUPABASE_URL}/rest/v1/Users?Username=eq.${encodeURIComponent(c.username)}`,
          { method: 'PATCH', headers: { ...HJ, Prefer: 'return=minimal' }, body: JSON.stringify({ 'Takim Adi': c.to }) }
        );
        if (pR.ok) applied.push(c);
        else failed.push({ ...c, error: 'HTTP ' + pR.status });
      }
      res.status(200).json({ applied, failed, appliedCount: applied.length, failedCount: failed.length });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: 'Sunucu hatası: ' + e.message });
  }
}
