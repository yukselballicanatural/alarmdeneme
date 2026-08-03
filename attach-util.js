// attach-util.js — Alarm notuna görsel eki: attach ikonu + küçük resim
// listesi + yükleme/silme. admin.html ve team-leader.html arasında paylaşılır
// (bkz. api/alarm-files.js — depolama sunucu tarafında, kova private).
//
// Bu dosya panele bağımlı değil: hangi bearer token'ın kullanılacağını ve
// bildirim fonksiyonunu çağıran taraf enjekte eder (bkz. init()).
window.NCAttach = (function () {
  'use strict';

  // Sunucudaki (api/alarm-files.js) sınırla aynı olmalı — orada Vercel'in
  // istek gövdesi tavanı yüzünden 3 MB'a düşürüldü, burada da düşürüldü.
  const MAX_BYTES = 3 * 1024 * 1024;
  const MAX_FILES = 6;
  const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp';

  let _getToken = () => '';
  let _notify = (msg) => alert(msg);
  let _t = s => s; // I18N.t yoksa aynen döner

  function init(opts) {
    if (opts.getToken) _getToken = opts.getToken;
    if (opts.notify) _notify = opts.notify;
    if (opts.t) _t = opts.t;
  }

  function _headers() {
    return { Authorization: 'Bearer ' + (_getToken() || '') };
  }

  // Mevcut ekleri listeler ve mountId'ye bağlı önizleme şeridini çizer.
  async function load(alarmId, mountId) {
    const mount = document.getElementById(mountId);
    if (!mount) return;
    mount.innerHTML = `<span style="font-size:10px;color:#475569">${_t('Ekler yükleniyor...')}</span>`;
    try {
      const fetchFn = window.NCNet ? NCNet.fetch : fetch;
      const r = await fetchFn(`/api/alarm-files?alarm_id=${encodeURIComponent(alarmId)}`, { headers: _headers() });
      const data = await r.json().catch(() => ({}));
      _render(mountId, alarmId, Array.isArray(data.files) ? data.files : []);
    } catch (e) {
      mount.innerHTML = `<span style="font-size:10px;color:#f87171">${_t('Ekler yüklenemedi.')}</span>`;
    }
  }

  function _render(mountId, alarmId, files) {
    const mount = document.getElementById(mountId);
    if (!mount) return;
    if (!files.length) { mount.innerHTML = ''; return; }
    mount.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">` +
      files.map(f => `
        <div class="nc-attach-thumb" style="position:relative;width:64px;height:64px;border-radius:8px;overflow:hidden;border:1px solid #334155;background:#0d1526">
          <a href="${f.url}" target="_blank" rel="noopener">
            <img src="${f.url}" style="width:100%;height:100%;object-fit:cover;display:block" loading="lazy">
          </a>
          <button onclick="NCAttach.remove('${_escAttr(alarmId)}','${_escAttr(f.name)}','${mountId}')"
            title="${_t('Sil')}"
            style="position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:9999px;background:rgba(0,0,0,.65);border:none;color:#f87171;font-size:11px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center">×</button>
        </div>`).join('') +
      `</div>`;
  }

  function _escAttr(v) { return String(v == null ? '' : v).replace(/'/g, "\\'"); }

  // input[type=file] değişimini işler: her seçilen dosyayı sırayla yükler
  // (paralel değil — aynı klasöre çok sayıda eşzamanlı POST, Storage'da
  // gereksiz yarış koşuluna gerek bırakmasın diye).
  async function handleFiles(alarmId, mountId, fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    // Kaç ek zaten var — sınırı burada da kontrol ediyoruz (sunucu da
    // reddedebilir ama kullanıcıya erken söylemek daha iyi).
    const existing = document.querySelectorAll(`#${mountId} .nc-attach-thumb`).length;
    if (existing + files.length > MAX_FILES) {
      _notify(_t('En fazla {n} görsel eklenebilir.').replace('{n}', MAX_FILES));
      return;
    }

    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        _notify(_t('Yalnızca görsel dosyaları eklenebilir.'));
        continue;
      }
      if (file.size > MAX_BYTES) {
        _notify(_t('{name} çok büyük (en fazla 3 MB).').replace('{name}', file.name));
        continue;
      }
      try {
        const b64 = await _readAsDataUrl(file);
        const fetchFn = window.NCNet ? NCNet.fetch : fetch;
        const r = await fetchFn('/api/alarm-files', {
          method: 'POST',
          headers: { ..._headers(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ alarm_id: alarmId, filename: file.name, data: b64 }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) { _notify((data.error || ('HTTP ' + r.status))); continue; }
      } catch (e) {
        _notify(_t('Yükleme başarısız: ') + e.message);
      }
    }
    await load(alarmId, mountId);
  }

  function _readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('Dosya okunamadı.'));
      fr.readAsDataURL(file);
    });
  }

  async function remove(alarmId, name, mountId) {
    try {
      const fetchFn = window.NCNet ? NCNet.fetch : fetch;
      const r = await fetchFn('/api/alarm-files', {
        method: 'DELETE',
        headers: { ..._headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ alarm_id: alarmId, name }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); _notify(d.error || 'Silinemedi.'); return; }
      await load(alarmId, mountId);
    } catch (e) { _notify(_t('Silme başarısız: ') + e.message); }
  }

  // Attach ikonu + gizli input[type=file] + önizleme mount'unu birlikte
  // üretir. Çağıran taraf bunu not alanının hemen altına yerleştirir.
  function renderWidget(alarmIdExpr, inputId, mountId) {
    return `
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
        <label for="${inputId}" style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:#1e293b;border:1px solid #334155;border-radius:8px;color:#94a3b8;font-size:11px;font-weight:700;cursor:pointer" onmouseover="this.style.background='#1e3a5f';this.style.color='#60a5fa'" onmouseout="this.style.background='#1e293b';this.style.color='#94a3b8'">
          <svg style="width:13px;height:13px" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
          ${_t('Görsel Ekle')}
        </label>
        <input type="file" id="${inputId}" accept="${ACCEPT}" multiple style="display:none"
          onchange="NCAttach.handleFiles(${alarmIdExpr}, '${mountId}', this.files); this.value='';">
        <span style="font-size:10px;color:#475569">${_t('JPG/PNG/GIF/WebP, en fazla 3 MB')}</span>
      </div>
      <div id="${mountId}"></div>`;
  }

  return { init, load, handleFiles, remove, renderWidget };
})();
