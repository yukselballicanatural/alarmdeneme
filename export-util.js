// export-util.js — Natural Clinic CRM ortak "Export" (CSV/XLSX/PDF/HTML) modülü
// Tüm panellerde (team-leader, admin) ortak kullanılır. Sayfa başına bir
// "Export" butonu + açılır menü (CSV/XLSX/PDF/HTML), tıklanınca ilgili
// sayfanın o anki (filtrelenmiş) verisini header+row listesi olarak alır.
window.NCExport = (function () {
  'use strict';

  function _escHtml(v) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _p(n) { return String(n).padStart(2, '0'); }

  function _downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // Aktif dile göre çevirir (I18N yüklenmemişse veya dil tr ise metin aynen kalır) —
  // export'un dili her zaman o an ekranda seçili dille (TR/EN) eşleşsin diye.
  function _t(s) {
    return (typeof I18N !== 'undefined' && I18N.t) ? I18N.t(s) : s;
  }

  // headers: string[] (Türkçe kanonik başlıklar — DICT'te karşılığı varsa
  // EN modda otomatik çevrilir); rows: array of arrays (aynı sırada, header
  // sayısı kadar hücre); filenameBase: indirilen dosyanın adı (sabit, dilden
  // etkilenmez); titleKey: PDF/HTML içindeki başlık için Türkçe kanonik metin
  // (verilmezse filenameBase'den türetilir).
  function download(format, headers, rows, filenameBase, titleKey) {
    const ts = new Date().toISOString().slice(0, 10);
    const filename = `${filenameBase}_${ts}`;
    const trHeaders = headers.map(h => _t(h));
    const title = _t(titleKey || filenameBase.replace(/_/g, ' '));
    const safeRows = rows.map(r => headers.map((h, i) => r[i] ?? ''));

    if (format === 'csv') {
      const csvRows = [trHeaders, ...safeRows].map(r =>
        r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')
      );
      // BOM — Excel'de Türkçe karakterlerin bozuk görünmesini engeller
      _downloadBlob('﻿' + csvRows.join('\r\n'), `${filename}.csv`, 'text/csv;charset=utf-8;');
      return;
    }

    if (format === 'xlsx') {
      if (typeof XLSX === 'undefined') { alert('XLSX kütüphanesi yüklenemedi. İnternet bağlantınızı kontrol edin.'); return; }
      const ws = XLSX.utils.aoa_to_sheet([trHeaders, ...safeRows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      XLSX.writeFile(wb, `${filename}.xlsx`);
      return;
    }

    if (format === 'pdf') {
      if (typeof jspdf === 'undefined') { alert('PDF kütüphanesi yüklenemedi. İnternet bağlantınızı kontrol edin.'); return; }
      const doc = new jspdf.jsPDF({ orientation: headers.length > 6 ? 'landscape' : 'portrait', unit: 'pt' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const M = 28;                       // sayfa kenar boşluğu
      const now = new Date();
      const genStr = _t('Oluşturulma') + ': ' +
        `${_p(now.getDate())}.${_p(now.getMonth() + 1)}.${now.getFullYear()} ${_p(now.getHours())}:${_p(now.getMinutes())}`;

      doc.autoTable({
        head: [trHeaders],
        body: safeRows,
        startY: 84,                        // başlık bandının altından başla
        theme: 'grid',
        styles: { fontSize: 7.5, cellPadding: 4, lineColor: [226, 232, 240], lineWidth: 0.5, textColor: [30, 41, 59], overflow: 'linebreak', valign: 'middle' },
        headStyles: { fillColor: [13, 148, 136], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8, halign: 'left', cellPadding: 5 },
        alternateRowStyles: { fillColor: [240, 249, 248] },
        margin: { left: M, right: M, top: 84 },
        didDrawPage: function (data) {
          // ── Üst başlık bandı ──
          doc.setFillColor(15, 23, 42);
          doc.rect(0, 0, pageW, 60, 'F');
          doc.setFillColor(13, 148, 136);
          doc.rect(0, 60, pageW, 3, 'F');   // teal alt çizgi
          doc.setTextColor(255, 255, 255);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(15);
          doc.text('NATURAL CLINIC', M, 26);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          doc.setTextColor(148, 163, 184);
          doc.text(title, M, 44);
          doc.setFontSize(8);
          doc.setTextColor(148, 163, 184);
          doc.text(genStr, pageW - M, 26, { align: 'right' });
          doc.text(`${safeRows.length} ${_t('kayıt')}`, pageW - M, 40, { align: 'right' });
          // ── Alt bilgi (sayfa no) ──
          const pageCount = doc.internal.getNumberOfPages();
          const pageCur = data.pageNumber;
          doc.setFontSize(7.5);
          doc.setTextColor(148, 163, 184);
          doc.text('Natural Clinic — Daily Performance System', M, pageH - 14);
          doc.text(`${pageCur} / ${pageCount}`, pageW - M, pageH - 14, { align: 'right' });
        },
      });
      doc.save(`${filename}.pdf`);
      return;
    }

    if (format === 'html') {
      const now = new Date();
      const genStr = _t('Oluşturulma') + ': ' +
        `${_p(now.getDate())}.${_p(now.getMonth() + 1)}.${now.getFullYear()} ${_p(now.getHours())}:${_p(now.getMinutes())}`;
      const html = `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${_escHtml(title)}</title>
        <style>
          *{box-sizing:border-box}
          body{font-family:'Segoe UI',Arial,sans-serif;margin:0;padding:0;background:#f1f5f9;color:#0f172a}
          .wrap{max-width:1200px;margin:0 auto;padding:28px 20px 40px}
          .card{background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 10px 40px -12px rgba(15,23,42,0.2)}
          .hdr{background:linear-gradient(120deg,#0f172a,#134e4a);color:#fff;padding:22px 26px;display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:12px;border-bottom:3px solid #0d9488}
          .hdr .brand{font-size:19px;font-weight:800;letter-spacing:.02em}
          .hdr .sub{font-size:12px;color:#94a3b8;margin-top:4px}
          .hdr .meta{font-size:11px;color:#94a3b8;text-align:right;line-height:1.7}
          table{border-collapse:collapse;width:100%;font-size:12.5px}
          thead th{background:#0d9488;color:#fff;padding:11px 14px;text-align:left;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}
          tbody td{padding:9px 14px;border-bottom:1px solid #e2e8f0;color:#1e293b}
          tbody tr:nth-child(even){background:#f0f9f8}
          tbody tr:hover{background:#e6fffa}
          .foot{padding:14px 26px;font-size:11px;color:#64748b;background:#f8fafc;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
          @media print{body{background:#fff}.card{box-shadow:none}.wrap{padding:0}}
        </style></head><body>
        <div class="wrap"><div class="card">
          <div class="hdr">
            <div><div class="brand">NATURAL CLINIC</div><div class="sub">${_escHtml(title)}</div></div>
            <div class="meta">${_escHtml(genStr)}<br>${safeRows.length} ${_escHtml(_t('kayıt'))}</div>
          </div>
          <div style="overflow-x:auto">
          <table><thead><tr>${trHeaders.map(h => `<th>${_escHtml(h)}</th>`).join('')}</tr></thead>
          <tbody>${safeRows.map(r => `<tr>${r.map(c => `<td>${_escHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>
          </table></div>
          <div class="foot"><span>Natural Clinic — Daily Performance System</span><span>${_escHtml(title)}</span></div>
        </div></div></body></html>`;
      _downloadBlob(html, `${filename}.html`, 'text/html;charset=utf-8;');
      return;
    }
  }

  // ── Açılır menü (dropdown) yönetimi ──────────────────────────────
  let _openMenuId = null;
  function toggleMenu(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const willOpen = el.style.display !== 'block';
    closeAllMenus();
    if (willOpen) { el.style.display = 'block'; _openMenuId = id; }
  }
  function closeAllMenus() {
    document.querySelectorAll('.nc-export-menu').forEach(m => { m.style.display = 'none'; });
    _openMenuId = null;
  }
  document.addEventListener('click', function (e) {
    if (!_openMenuId) return;
    const wrap = e.target.closest('.nc-export-wrap');
    if (!wrap) closeAllMenus();
  });

  // Ortak "Export" butonu + menü HTML'i — her sayfa kendi menuId'sini ve
  // export fonksiyon adını verir (fnName('csv'|'xlsx'|'pdf'|'html') şeklinde çağrılır).
  //
  // label: aynı ekranda birden fazla export butonu varsa hepsi "Export" yazınca
  // hangisinin neyi indirdiği anlaşılmıyor (Alarm İzleme'de TL Performans ve
  // Bölge Performans yan yana). Verilmezse "Export" kalır.
  //
  // align: menü varsayılan olarak butonun SAĞINA hizalı açılır; sol kenara yakın
  // butonlarda (tablo başlığındaki gibi) bu menüyü kartın dışına taşırabiliyor,
  // 'left' ile sola hizalanır.
  function renderButton(menuId, fnName, label, align) {
    const side = align === 'left' ? 'left:0' : 'right:0';
    return `<div class="nc-export-wrap" style="position:relative;display:inline-block">
      <button onclick="NCExport.toggleMenu('${menuId}')" style="padding:8px 14px;background:#1e293b;border:1px solid #334155;border-radius:10px;color:#94a3b8;font-size:11px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;transition:all 0.15s" onmouseover="this.style.background='#1e3a5f';this.style.borderColor='#1e40af';this.style.color='#60a5fa'" onmouseout="this.style.background='#1e293b';this.style.borderColor='#334155';this.style.color='#94a3b8'">
        <svg style="width:13px;height:13px" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"/></svg>
        ${_escHtml(label ? _t(label) : _t('Export'))}
        <svg style="width:10px;height:10px" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
      </button>
      <div id="${menuId}" class="nc-export-menu" style="display:none;position:absolute;top:calc(100% + 4px);${side};z-index:500;background:#0f172a;border:1px solid #334155;border-radius:10px;padding:6px;min-width:120px;box-shadow:0 12px 30px rgba(0,0,0,0.5)">
        <button onclick="NCExport.closeAllMenus();${fnName}('csv')" style="width:100%;text-align:left;padding:8px 10px;background:none;border:none;border-radius:7px;color:#cbd5e1;font-size:11.5px;font-weight:600;cursor:pointer" onmouseover="this.style.background='#1e293b'" onmouseout="this.style.background='none'">CSV</button>
        <button onclick="NCExport.closeAllMenus();${fnName}('xlsx')" style="width:100%;text-align:left;padding:8px 10px;background:none;border:none;border-radius:7px;color:#cbd5e1;font-size:11.5px;font-weight:600;cursor:pointer" onmouseover="this.style.background='#1e293b'" onmouseout="this.style.background='none'">XLSX</button>
        <button onclick="NCExport.closeAllMenus();${fnName}('pdf')" style="width:100%;text-align:left;padding:8px 10px;background:none;border:none;border-radius:7px;color:#cbd5e1;font-size:11.5px;font-weight:600;cursor:pointer" onmouseover="this.style.background='#1e293b'" onmouseout="this.style.background='none'">PDF</button>
        <button onclick="NCExport.closeAllMenus();${fnName}('html')" style="width:100%;text-align:left;padding:8px 10px;background:none;border:none;border-radius:7px;color:#cbd5e1;font-size:11.5px;font-weight:600;cursor:pointer" onmouseover="this.style.background='#1e293b'" onmouseout="this.style.background='none'">HTML</button>
      </div>
    </div>`;
  }

  return { download, toggleMenu, closeAllMenus, renderButton };
})();
