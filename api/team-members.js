// "Takımımdaki Kişiler" sayfasının (team-leader.html + admin.html) Users
// tablosu erişimi buradan geçer — service_role key ile, sunucu tarafında.
// Users tablosu anon key'e tamamen kapalı (bkz. users_rls_lockdown.sql /
// rls_hardening.sql), bu yüzden tarayıcı bu tabloya asla doğrudan dokunmuyor.
//
// Auth: çağıranın api/login.js'te üretilen, süresi dolmamış ve
// team-leader/regional-manager/admin/super-admin rolüne ait bir token'ı
// Authorization: Bearer başlığında göndermesi ZORUNLU.
//
// Kapsam GÜVENLİĞİ (rol bazlı, İSTEMCİDEN GELEN parametreye değil, token'daki
// kullanıcı adıyla Users tablosunda TEKRAR sorgulanan güncel role/takıma göre):
//   - team-leader: sadece KENDİ takımının üyeleri.
//   - regional-manager: KENDİ bölgesindeki (Istanbul/Morocco) tüm takımların üyeleri.
//   - admin / super-admin: TÜM takımların TÜM üyeleri.
import { verifyToken, bearerToken } from './_auth.js';

const FALLBACK_URL = 'https://aztxfncqanrodbttywrb.supabase.co';

// team-map.js'deki (tarayıcı tarafı) bölge eşlemesinin sunucu tarafı kopyası —
// Users."Takim Adi" değeri zaten kanonik geldiği için burada sadece
// kanonik ad → bölge eşlemesi yeterli (alias çözümlemeye gerek yok).
const REGION_BY_TEAM = {
  'Arij  Team': 'Istanbul',
  'Askif Team': 'Istanbul',
  'Touma Team': 'Istanbul',
  'Mihoubi Team': 'Istanbul',
  'Ahmed Anwar Team': 'Istanbul',
  'Ghazal Team': 'Istanbul',
  'Ali Omer Team': 'Istanbul',
  'Aamir Ali Team': 'Istanbul',
  'Joel Team': 'Istanbul',
  'SM- Mert Team': 'Istanbul',
  'Sales Master - Amin Connor West': 'Istanbul',
  'Farah Team - Morocco': 'Morocco',
  'Sara Team - Morocco': 'Morocco',
  'Selma Team - Morocco': 'Morocco',
  'Ramadan Team - Morocco': 'Morocco',
  'Moutaharrik Team - Morocco': 'Morocco',
};

function regionForTeam(team) {
  const t = String(team || '').trim();
  if (REGION_BY_TEAM[t]) return REGION_BY_TEAM[t];
  return t.toLowerCase().includes('morocco') ? 'Morocco' : 'Istanbul';
}

// ── zoho_users desteği ────────────────────────────────────────────────
// Kadro artık Zoho'nun Users modülünden geliyor. Orada takım bilgisi `role`
// alanında duruyor ve deals.team ile AYNI yazım uzayında: üyelerde kanonik ad
// ("Farah Team - Morocco"), takım liderlerinde alias ("Team Leader - Farah").
// İkisi de aşağıdaki harita ile aynı kanonik ada indiriliyor.
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
function nameKey(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

const ALIAS_INDEX = {};
for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
  for (const a of aliases) ALIAS_INDEX[nameKey(a)] = canonical;
}

// Tanınan satış takımına indir; satış dışı birim / bilinmeyen ad → null.
function normalizeTeam(t) { return ALIAS_INDEX[nameKey(t)] || null; }

// İşten ayrılmış mı?
// DİKKAT: `status` tek başına yetmiyor — canlı veride exit_date'i geçmişte olan
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

// Danışmanlar panele GİRMİYOR — onlara login açılmıyor. Ama Günlük Ekip Girişi
// kayıtları daily_performance'ta (entry_date, username) benzersiz kısıtıyla
// tutuluyor, yani her kişi için kararlı bir anahtar şart.
//
// Users satırı varsa onun Username'i kullanılır (geçmiş kayıtlar bağlı kalsın).
// Yoksa Zoho görünen adından türetilir: mevcut Users kayıtları da tam olarak bu
// düzende ("Adam Naciri" → "Adam.Naciri", "Marco Rahimi" → "Marco.Rahimi"),
// dolayısıyla biri sonradan Users'a eklenirse anahtar değişmez ve geçmiş bölünmez.
function derivedUsername(fullName) {
  return String(fullName || '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .join('.');
}

// admin.html'deki _rmGetRegion ile aynı mantık: bazı RM hesapları adına göre
// sabitlenmiş, diğerleri kendi "Takim Adi" alanından türetilir.
function regionForRm(me) {
  const n = String(me['Deal Owner Name'] || me['Username'] || '').toLowerCase();
  if (n.includes('benmamar') || n.includes('abderrahim')) return 'Istanbul';
  if (n.includes('gazzini') || n.includes('yassin')) return 'Morocco';
  return regionForTeam(me['Takim Adi'] || '');
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
  const claims = verifyToken(bearerToken(req), AUTH_SECRET);
  if (!claims || !['team-leader', 'regional-manager', 'admin', 'super-admin'].includes(claims.r)) {
    res.status(401).json({ error: 'Yetkisiz erişim.' });
    return;
  }

  const H  = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY };
  const HJ = { ...H, 'Content-Type': 'application/json; charset=utf-8' };

  try {
    // Çağıranın GÜNCEL satırını kendi Username'inden çek — client'tan gelen
    // hiçbir "team" parametresine güvenilmez.
    const meR = await fetch(`${SUPABASE_URL}/rest/v1/Users?Username=eq.${encodeURIComponent(claims.u)}&select=*`, { headers: H });
    if (!meR.ok) { res.status(502).json({ error: 'Veritabanı hatası.' }); return; }
    const meRows = await meR.json();
    const me = meRows[0];
    if (!me) { res.status(401).json({ error: 'Kullanıcı bulunamadı.' }); return; }
    const myTeam = String(me['Takim Adi'] || '').trim();

    function scopeRows(rows) {
      if (claims.r === 'team-leader') {
        return { rows: rows.filter(u => String(u['Takim Adi'] || '').trim() === myTeam), scopeLabel: myTeam };
      }
      if (claims.r === 'regional-manager') {
        const region = regionForRm(me);
        return { rows: rows.filter(u => regionForTeam(u['Takim Adi']) === region), scopeLabel: region };
      }
      // admin / super-admin — tüm takımlar
      return { rows, scopeLabel: 'Tümü' };
    }

    // zoho_users satırları için aynı rol bazlı kapsam. Takım, `role` alanından
    // kanonikleştirilerek belirlenir (üyede kanonik ad, liderde alias).
    // GÜVENLİK: kapsam yine İSTEMCİDEN GELEN parametreye değil, token'daki
    // kullanıcı adıyla Users'ta tekrar sorgulanan güncel role/takıma göre.
    function scopeZoho(rows) {
      if (claims.r === 'team-leader') {
        return {
          rows: rows.filter(z => normalizeTeam(z.role) === (normalizeTeam(myTeam) || myTeam)),
          scopeLabel: myTeam,
        };
      }
      if (claims.r === 'regional-manager') {
        const region = regionForRm(me);
        return {
          rows: rows.filter(z => {
            const t = normalizeTeam(z.role);
            // Satış takımı olmayan birimler (Finance, Profclinic, Executive
            // Board...) bölge listesine girmesin — RM yalnızca kendi satış
            // takımlarını yönetiyor.
            if (!t) return false;
            return regionForTeam(t) === region;
          }),
          scopeLabel: region,
        };
      }
      // admin / super-admin — tüm kadro (satış dışı birimler dahil)
      return { rows, scopeLabel: 'Tümü' };
    }

    if (req.method === 'GET') {
      if (claims.r === 'team-leader' && !myTeam) { res.status(200).json({ team: '', members: [] }); return; }

      const [uR, zR] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/Users?select=*&order=id.asc&limit=2000`, { headers: H }),
        // zoho_users: Zoho org kullanıcılarının aynası. Tablo yoksa (404) eski
        // davranışa (yalnız Users) düşülür.
        fetch(`${SUPABASE_URL}/rest/v1/zoho_users?select=*&limit=2000`, { headers: H }),
      ]);
      if (!uR.ok) { res.status(502).json({ error: 'Veritabanı hatası.' }); return; }
      const userRows = await uR.json();
      const zohoRows = zR.ok ? await zR.json() : [];

      // Users tarafını isimle indeksle — Users."Deal Owner Name" ile
      // zoho_users.full_name aynı değer uzayında (Zoho görünen adı).
      const usersByName = new Map();
      for (const u of userRows) {
        const k = nameKey(u['Deal Owner Name'] || u['Username']);
        if (k && !usersByName.has(k)) usersByName.set(k, u);
      }

      // ── Kadro kaynağı: zoho_users (varsa) ─────────────────────────────
      // Önceden liste Users tablosundan geliyordu; Users yalnızca GİRİŞİ OLAN
      // kişileri tutuyor, dolayısıyla Zoho'da takımda olup henüz hesabı
      // açılmamış kişiler hiç görünmüyordu (Moutaharrik: Zoho'da 10 kişi,
      // Users'ta 1). Artık kadro Zoho'dan, giriş bilgisi Users'tan geliyor.
      let members;
      let scopeLabel;
      if (zohoRows.length) {
        const scoped = scopeZoho(zohoRows);
        scopeLabel = scoped.scopeLabel;
        members = scoped.rows
          .filter(z => !isLeaver(z))
          .map(z => {
            const u = usersByName.get(nameKey(z.full_name)) || null;
            const team = normalizeTeam(z.role) || String(z.role || '').trim();
            // Telefon: elle girilen Users.Phone ÖNCELİKLİ (düzeltme amaçlı
            // girilmiş olabilir), yoksa Zoho phone, yoksa Zoho mobile.
            const phone = (u && u['Phone']) || z.phone || z.mobile || '';
            return {
              // Users satırı varsa gerçek Username, yoksa Zoho adından türetilmiş
              // kararlı anahtar (bkz. derivedUsername notu). Günlük Ekip Girişi
              // bu alanı kullanıyor; hasLogin ise gerçekten hesabı var mı der.
              username:   (u && u['Username']) || derivedUsername(z.full_name),
              fullName:   z.full_name || '',
              realName:   z.original_agent_name || '',
              role:       u ? (u['Role'] || '') : '',
              zohoRole:   z.role || '',
              team,
              region:     z.region || regionForTeam(team),
              phone,
              email:      z.email || (u && u['Email']) || '',
              seniority:  z.seniority_level || '',
              hasLogin:   !!(u && u['Username']),
              zohoUserId: z.id || '',
            };
          });
      } else {
        // zoho_users yok — eski davranış (yalnız Users tablosu)
        const scoped = scopeRows(userRows.filter(u => u['is_active'] !== false));
        scopeLabel = scoped.scopeLabel;
        members = scoped.rows.map(u => ({
          username: u['Username'] || '',
          fullName: u['Deal Owner Name'] || u['Username'] || '',
          realName: '',
          role:     u['Role'] || '',
          zohoRole: '',
          team:     String(u['Takim Adi'] || '').trim(),
          region:   regionForTeam(String(u['Takim Adi'] || '')),
          phone:    u['Phone'] || '',
          email:    u['Email'] || '',
          seniority: '',
          hasLogin: true,
          zohoUserId: '',
        }));
      }

      members.sort((a, b) =>
        (a.team || '').localeCompare(b.team || '') || a.fullName.localeCompare(b.fullName));
      res.status(200).json({ team: scopeLabel, members, source: zohoRows.length ? 'zoho_users' : 'Users' });
      return;
    }

    if (req.method === 'PATCH') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const targetUsername = String(body?.username || '').trim();
      const phone = String(body?.phone || '').trim();
      const email = String(body?.email || '').trim();
      if (!targetUsername) { res.status(400).json({ error: 'Kullanıcı adı gerekli.' }); return; }

      // Hedef kullanıcı GERÇEKTEN çağıranın izinli kapsamında mı — server-side doğrula.
      const targetR = await fetch(`${SUPABASE_URL}/rest/v1/Users?Username=eq.${encodeURIComponent(targetUsername)}&select=*`, { headers: H });
      if (!targetR.ok) { res.status(502).json({ error: 'Veritabanı hatası.' }); return; }
      const targetRows = await targetR.json();
      const target = targetRows[0];
      if (!target) { res.status(404).json({ error: 'Kullanıcı bulunamadı.' }); return; }

      const targetTeam = String(target['Takim Adi'] || '').trim();
      let allowed = false;
      if (claims.r === 'team-leader') allowed = targetTeam === myTeam;
      else if (claims.r === 'regional-manager') allowed = regionForTeam(targetTeam) === regionForRm(me);
      else allowed = true; // admin / super-admin

      if (!allowed) { res.status(403).json({ error: 'Bu kullanıcı senin yetki alanında değil.' }); return; }

      // Users.id bigint JS safe-integer sınırını aşabiliyor — id yerine
      // Username (text) ile hedefle (bkz. proje hafızası: users_table_security_gap).
      const patchR = await fetch(`${SUPABASE_URL}/rest/v1/Users?Username=eq.${encodeURIComponent(targetUsername)}`, {
        method: 'PATCH',
        headers: { ...HJ, Prefer: 'return=minimal' },
        body: JSON.stringify({ Phone: phone || null, Email: email || null }),
      });
      if (!patchR.ok) { res.status(502).json({ error: 'Veritabanı hatası.' }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: 'Sunucu hatası: ' + e.message });
  }
}
