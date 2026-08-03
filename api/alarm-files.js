// Alarm notlarına görsel eki — yükleme / listeleme / silme.
//
// NEDEN SUNUCU TARAFI
// Yükleme doğrudan tarayıcıdan Supabase Storage'a yapılabilirdi ama o zaman
// kova (bucket) anon key'e açık olmak zorundaydı: elinde panelin public key'i
// olan herkes hasta görseli okuyabilir/yazabilirdi. Kova PRIVATE kalıyor,
// tüm erişim buradan geçiyor ve rol kontrolüne tabi.
//
// KOVA KENDİLİĞİNDEN OLUŞUYOR
// Kasıtlı olarak elle SQL/dashboard adımı YOK. Bu depoda daha önce eklenen
// zoho_users_sync.sql hiç çalıştırılmadığı için ona bağlı özellik ölü kaldı;
// aynı hatayı tekrarlamamak için kova ilk yüklemede kod tarafından açılıyor.
//
// AYRI METADATA TABLOSU DA YOK
// Dosyalar `alarm/<alarm_id>/` ön eki altında duruyor; listeleme Storage'ın
// kendi list ucuyla yapılıyor. Böylece yeni tablo (= yeni migrasyon adımı)
// gerekmiyor. Kim yükledi bilgisi dosya adına gömülü.
import { verifyToken, bearerToken } from './_auth.js';

const FALLBACK_URL = 'https://aztxfncqanrodbttywrb.supabase.co';
const BUCKET = 'alarm-attachments';
// Vercel serverless fonksiyonlarının varsayılan istek gövdesi sınırı ~4.5 MB.
// Dosya base64 olarak gönderiliyor (JSON içinde) — base64 ham boyutu ~%33
// büyütür, yani 4 MB'lık bir görsel ~5.3 MB'lık gövde demek ve kod hiç
// çalışmadan 413'e düşerdi. Sınır bu yüzden 3 MB: base64'te ~4 MB, JSON
// zarfıyla birlikte Vercel limitinin altında kalıyor.
const MAX_BYTES = 3 * 1024 * 1024;
const SIGN_TTL = 60 * 60;               // imzalı bağlantı 1 saat geçerli

// İzin verilen türler. İSTEMCİNİN BEYAN ETTİĞİ mime'a güvenilmiyor; aşağıda
// dosyanın ilk baytlarına (magic bytes) bakılıyor. Aksi halde .jpg diye
// gönderilen bir HTML dosyası imzalı bağlantıyla açıldığında tarayıcıda
// çalışabilirdi (depolanmış XSS).
const SNIFFERS = [
  { mime: 'image/jpeg', ext: 'jpg',  test: b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  { mime: 'image/png',  ext: 'png',  test: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 },
  { mime: 'image/gif',  ext: 'gif',  test: b => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  { mime: 'image/webp', ext: 'webp', test: b => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
];

function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  return SNIFFERS.find(s => s.test(buf)) || null;
}

// alarm_id yol parçası olarak kullanılıyor — sadece güvenli karakterler.
// ".." veya "/" geçirilmesi başka alarmın klasörüne yazmayı mümkün kılardı.
function safeId(v) {
  const s = String(v == null ? '' : v).trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : null;
}

// Görünen ad — dosya adında yol ayırıcı ya da kontrol karakteri kalmasın.
function safeLabel(v) {
  return String(v || 'gorsel')
    .replace(/[^\w.\-() ]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 60) || 'gorsel';
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
  // Alarm görselleri hasta verisi — giriş yapmış personel dışında kimse
  // görmemeli. Agent rolü alarm ekranını kullanmıyor, bu yüzden kapsam dışı.
  const claims = verifyToken(bearerToken(req), AUTH_SECRET);
  if (!claims || !['team-leader', 'regional-manager', 'admin', 'super-admin'].includes(claims.r)) {
    res.status(401).json({ error: 'Yetkisiz erişim.' });
    return;
  }

  const H = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY };
  const HJ = { ...H, 'Content-Type': 'application/json' };

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  // Kova yoksa oluştur. Zaten varsa Storage 400/409 döner — bu bir hata değil,
  // yutuluyor. `public:false` KRİTİK: kovanın adı tahmin edilebilir, açık
  // olsaydı tüm görseller bağlantıyı bilen herkese açık olurdu.
  async function ensureBucket() {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: 'POST',
      headers: HJ,
      body: JSON.stringify({
        id: BUCKET,
        name: BUCKET,
        public: false,
        file_size_limit: MAX_BYTES,
        allowed_mime_types: SNIFFERS.map(s => s.mime),
      }),
    });
    if (r.ok) return true;
    // 400/409 = zaten var. Diğer durumlar gerçek hata.
    return r.status === 400 || r.status === 409;
  }

  try {
    // ── Listele ──────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const id = safeId(req.query?.alarm_id);
      if (!id) { res.status(400).json({ error: 'Geçersiz alarm_id.' }); return; }
      const lr = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
        method: 'POST',
        headers: HJ,
        body: JSON.stringify({
          prefix: `alarm/${id}`, limit: 50, offset: 0,
          sortBy: { column: 'created_at', order: 'asc' },
        }),
      });
      // Kova henüz hiç oluşmadıysa (ilk kullanım) 404 gelir — bu "ek yok"
      // demektir, hata değil.
      if (!lr.ok) { res.status(200).json({ files: [] }); return; }
      const rows = await lr.json();
      const list = Array.isArray(rows) ? rows.filter(o => o && o.name && o.id) : [];

      // Her dosya için kısa ömürlü imzalı bağlantı — kova private olduğu için
      // düz URL çalışmaz.
      const files = [];
      for (const o of list) {
        const path = `alarm/${id}/${o.name}`;
        const sr = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
          method: 'POST', headers: HJ, body: JSON.stringify({ expiresIn: SIGN_TTL }),
        });
        if (!sr.ok) continue;
        const sj = await sr.json();
        files.push({
          name: o.name,
          url: `${SUPABASE_URL}/storage/v1${sj.signedURL || sj.signedUrl || ''}`,
          size: o.metadata?.size || 0,
          mime: o.metadata?.mimetype || '',
          createdAt: o.created_at || null,
        });
      }
      res.status(200).json({ files });
      return;
    }

    // ── Yükle ────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const id = safeId(body.alarm_id);
      if (!id) { res.status(400).json({ error: 'Geçersiz alarm_id.' }); return; }
      const b64 = String(body.data || '').replace(/^data:[^;]+;base64,/, '');
      if (!b64) { res.status(400).json({ error: 'Dosya verisi boş.' }); return; }

      let buf;
      try { buf = Buffer.from(b64, 'base64'); } catch (e) { buf = null; }
      if (!buf || !buf.length) { res.status(400).json({ error: 'Dosya okunamadı.' }); return; }
      if (buf.length > MAX_BYTES) {
        res.status(413).json({ error: 'Dosya çok büyük (en fazla 3 MB).' });
        return;
      }

      // Türü BAYTLARDAN belirle — istemcinin beyanına güvenilmiyor.
      const kind = sniff(buf);
      if (!kind) {
        res.status(415).json({ error: 'Yalnızca görsel yüklenebilir (JPG, PNG, GIF, WebP).' });
        return;
      }

      if (!(await ensureBucket())) {
        res.status(502).json({ error: 'Depolama alanı hazırlanamadı.' });
        return;
      }

      // Dosya adı: sıralanabilir zaman + rastgele + yükleyen + görünen ad.
      // İstemciden gelen ad YOL olarak kullanılmıyor, yalnızca etiket.
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rand = Math.random().toString(36).slice(2, 8);
      const who = safeLabel(claims.u).slice(0, 24);
      const name = `${stamp}_${rand}_${who}_${safeLabel(body.filename)}`.replace(/\.[^.]*$/, '') + '.' + kind.ext;
      const path = `alarm/${id}/${name}`;

      const ur = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': kind.mime, 'x-upsert': 'false' },
        body: buf,
      });
      if (!ur.ok) {
        res.status(502).json({ error: 'Yükleme başarısız: ' + (await ur.text()).slice(0, 200) });
        return;
      }

      const sr = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
        method: 'POST', headers: HJ, body: JSON.stringify({ expiresIn: SIGN_TTL }),
      });
      const sj = sr.ok ? await sr.json() : {};
      res.status(200).json({
        ok: true,
        file: {
          name,
          url: sj.signedURL || sj.signedUrl ? `${SUPABASE_URL}/storage/v1${sj.signedURL || sj.signedUrl}` : '',
          size: buf.length,
          mime: kind.mime,
          createdAt: new Date().toISOString(),
        },
      });
      return;
    }

    // ── Sil ──────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const id = safeId(body.alarm_id);
      // Silinecek dosya adı da doğrulanıyor: "../" ile başka klasöre çıkılmasın.
      const name = String(body.name || '');
      if (!id || !name || name.includes('/') || name.includes('..')) {
        res.status(400).json({ error: 'Geçersiz istek.' });
        return;
      }
      const dr = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
        method: 'DELETE', headers: HJ,
        body: JSON.stringify({ prefixes: [`alarm/${id}/${name}`] }),
      });
      if (!dr.ok) { res.status(502).json({ error: 'Silinemedi.' }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: 'Sunucu hatası: ' + e.message });
  }
}
