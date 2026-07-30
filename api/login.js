// Kimlik doğrulama sunucu tarafında yapılır — service_role key (gizli,
// sadece burada/Vercel env'de) ile Users tablosuna erişir. Tarayıcı hiçbir
// zaman Users tablosuna veya Password alanına doğrudan dokunmaz.
//
// Geriye dönük uyumluluk: eski kayıtlarda şifre düz metin duruyor olabilir.
// Böyle bir kayıtla ilk başarılı giriş yapıldığında şifre otomatik olarak
// bcrypt ile hashlenip veritabanına yazılır ("lazy migration") — ayrı bir
// toplu migrasyon script'i gerekmez, her kullanıcı ilk girişinde kendiliğinden
// güvenli hale gelir.
import bcrypt from 'bcryptjs';
import { signToken, normalizeRole } from './_auth.js';

const FALLBACK_URL = 'https://aztxfncqanrodbttywrb.supabase.co';
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 saat — bir mesai günü

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const SUPABASE_URL   = process.env.SUPABASE_URL || FALLBACK_URL;
  const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_KEY) {
    res.status(500).json({ error: 'Sunucu yapılandırma hatası: SUPABASE_SERVICE_ROLE_KEY eksik.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const username = String(body?.username || '').trim();
  const password = String(body?.password || '');
  if (!username || !password) { res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli.' }); return; }

  const H = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY };

  // Kullanıcı adı/şifre hataları AYNI genel mesajı döner — saldırganın "bu
  // kullanıcı var mı" bilgisini (username enumeration) sızdırmamak için.
  const GENERIC = 'Kullanıcı adı veya şifre hatalı.';
  // Kullanıcı bulunamayınca da bir bcrypt.compare çalıştırılır: aksi halde
  // "kullanıcı yok" yolu hiç hash karşılaştırmadan anında dönüp, cevap
  // süresinden hangi kullanıcıların var olduğu anlaşılabilirdi (timing oracle).
  // Geçerli bir bcrypt hash (herkese açık kanonik test vektörü — gizli değil).
  // Amaç: compare her zaman false döner ama tam bcrypt maliyetini harcar,
  // böylece "kullanıcı yok" yolu da "şifre yanlış" yoluyla aynı sürede döner.
  const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/Users?Username=eq.${encodeURIComponent(username)}&select=*`, { headers: H });
    if (!r.ok) { res.status(502).json({ error: 'Veritabanı hatası.' }); return; }
    const rows = await r.json();
    if (!rows.length) {
      await bcrypt.compare(password, DUMMY_HASH); // zamanlamayı eşitle
      res.status(401).json({ error: GENERIC });
      return;
    }

    const user = rows[0];
    const stored = String(user['Password'] || '');
    const isHashed = /^\$2[aby]\$/.test(stored);

    let ok = false;
    if (isHashed) {
      ok = await bcrypt.compare(password, stored);
    } else {
      ok = stored.trim() === password.trim();
      if (ok) {
        // Başarılı giriş — şifreyi hashleyip yaz, bir daha düz metin olarak kalmasın
        const newHash = await bcrypt.hash(password, 10);
        fetch(`${SUPABASE_URL}/rest/v1/Users?id=eq.${user.id}`, {
          method: 'PATCH',
          headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ Password: newHash })
        }).catch(() => {});
      }
    }

    if (!ok) { res.status(401).json({ error: GENERIC }); return; }

    // İşten ayrılanların girişi kapatılır. Kayıt SİLİNMİYOR (daily_performance,
    // alarm_logs ve audit geçmişi bu satıra bağlı) — yalnızca giriş reddedilir.
    // is_active kolonu zoho_users_sync.sql ile eklenir ve VARSAYILANI true'dur;
    // kolon henüz yoksa `undefined === false` olmadığı için bu kontrol hiçbir
    // mevcut kullanıcıyı etkilemez.
    //
    // Şifre doğrulandıktan SONRA kontrol ediliyor: aksi halde "şifre yanlış" ile
    // "hesap kapalı" cevapları ayrışır ve doğru şifre bilinmeden hesabın
    // durumu öğrenilebilirdi. Ayrıca bu sayede yanlış şifre girene, hesabın
    // varlığını ima eden bir mesaj gitmiyor.
    if (user['is_active'] === false) {
      res.status(403).json({ error: 'Bu hesap devre dışı bırakılmış. Yöneticinizle görüşün.' });
      return;
    }

    delete user.Password; // Client'a asla şifre/hash dönmez

    // admin/super-admin ise, Users sayfasının service_role gerektiren
    // uçlarını (api/admin-users.js) çağırabilmesi için imzalı bir token
    // ekle. team-leader/regional-manager için de (api/team-members.js —
    // "Takımımdaki Kişiler" sayfası) aynı token gerekiyor. Agent için
    // gereksiz — token yine de üretilse zararsız olurdu ama sadece
    // ihtiyacı olana veriliyor.
    const AUTH_SECRET = process.env.AUTH_TOKEN_SECRET;
    const role = normalizeRole(user['Role']);
    if (AUTH_SECRET && ['admin', 'super-admin', 'team-leader', 'regional-manager'].includes(role)) {
      user.token = signToken({ u: user['Username'], r: role, exp: Date.now() + TOKEN_TTL_MS }, AUTH_SECRET);
    }

    res.status(200).json({ ok: true, user });
  } catch (e) {
    res.status(500).json({ error: 'Sunucu hatası: ' + e.message });
  }
}
