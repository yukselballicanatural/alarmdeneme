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

    if (req.method === 'GET') {
      if (claims.r === 'team-leader' && !myTeam) { res.status(200).json({ team: '', members: [] }); return; }
      const r = await fetch(`${SUPABASE_URL}/rest/v1/Users?select=*&order=id.asc&limit=2000`, { headers: H });
      if (!r.ok) { res.status(502).json({ error: 'Veritabanı hatası.' }); return; }
      const rows = await r.json();
      const { rows: scoped, scopeLabel } = scopeRows(rows);
      const members = scoped
        .map(u => ({
          username: u['Username'] || '',
          fullName: u['Deal Owner Name'] || u['Username'] || '',
          role: u['Role'] || '',
          team: String(u['Takim Adi'] || '').trim(),
          phone: u['Phone'] || '',
          email: u['Email'] || '',
        }))
        .sort((a, b) => (a.team || '').localeCompare(b.team || '') || a.fullName.localeCompare(b.fullName));
      res.status(200).json({ team: scopeLabel, members });
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
