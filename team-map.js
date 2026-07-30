// team-map.js — Natural Clinic Takım / Bölge Eşleme Haritası
// deals.team kolonundaki farklı yazım varyantlarını kanonik takım adına bağlar.
// Kanonik ad = Users tablosundaki "Takim Adi" değeri (login'de currentUser.team olarak gelir).
window.TeamMap = (function () {
  'use strict';

  // canonical (Users."Takim Adi") → { label, leader, region, aliases[] }
  // aliases: deals.team kolonunda geçen TÜM yazım varyantları (kanonik dahil)
  const TEAMS = {
    'Arij  Team': { // dikkat: çift boşluk — Users tablosunda böyle
      label: 'Arij Team', leader: 'Arij Mahjoubi', region: 'Istanbul',
      aliases: ['Arij  Team', 'Arij Team', 'Team Leader-Arij Mahjoubi'],
    },
    'Askif Team': {
      label: 'Askif Team', leader: 'Abdulrahman Ziad', region: 'Istanbul',
      aliases: ['Askif Team', 'Team Leader - Abdulrahman Ziad Askif'],
    },
    'Touma Team': {
      label: 'Touma Team', leader: 'Abdulkader Touma', region: 'Istanbul',
      aliases: ['Touma Team', 'Team Leader- Abdulkader Touma', 'Toumi Team'],
    },
    'Mihoubi Team': {
      label: 'Mihoubi Team', leader: 'Abdellah Mihoubi', region: 'Istanbul',
      aliases: ['Mihoubi Team', 'Team Leader - Mihoubi'],
    },
    'Ahmed Anwar Team': {
      label: 'Ahmed Anwar Team', leader: 'Ahmed Anwar', region: 'Istanbul',
      aliases: ['Ahmed Anwar Team', 'Team Leader-Ahmed Anwar'],
    },
    'Ghazal Team': {
      label: 'Ghazal Team', leader: 'Ahmed Ghazal', region: 'Istanbul',
      aliases: ['Ghazal Team', 'Team Leader - Ahmad Ghazal'],
    },
    'Ali Omer Team': {
      label: 'Ali Omer Team', leader: 'Ali Ömer', region: 'Istanbul',
      aliases: ['Ali Omer Team', 'Team Leader - Ali Omer'],
    },
    'Aamir Ali Team': {
      label: 'Aamir Ali Team', leader: 'Aamir Ali', region: 'Istanbul',
      aliases: ['Aamir Ali Team', 'Team Leader - Aamir Ali'],
    },
    'Joel Team': {
      label: 'Joel Team', leader: 'Joel Awudu', region: 'Istanbul',
      aliases: ['Joel Team', 'Team Leader - Joel'],
    },
    'SM- Mert Team': {
      label: 'SM - Mert Team', leader: 'Joseph Stone', region: 'Istanbul',
      aliases: ['SM- Mert Team', 'Mert Jospeh - Sales Master'],
    },
    'Sales Master - Amin Connor West': { // eski deallarda "SM Amin Connor - Team" olarak geçiyor
      label: 'Connor West Team', leader: 'Connor West', region: 'Istanbul',
      aliases: ['Sales Master - Amin Connor West', 'SM Amin Connor - Team'],
    },
    'Farah Team - Morocco': {
      label: 'Farah Team', leader: 'Farah El Moujahed', region: 'Morocco',
      aliases: ['Farah Team - Morocco', 'Team Leader - Farah'],
    },
    'Sara Team - Morocco': {
      label: 'Sara Team', leader: 'Giulia Bianchi', region: 'Morocco',
      aliases: ['Sara Team - Morocco', 'Team Leader - Sara'],
    },
    'Selma Team - Morocco': {
      label: 'Selma Team', leader: 'Selma Bennani', region: 'Morocco',
      aliases: ['Selma Team - Morocco', 'Team Leader - Selma'],
    },
    'Ramadan Team - Morocco': {
      label: 'Ramadan Team', leader: 'Ramadane Abdellatif', region: 'Morocco',
      aliases: ['Ramadan Team - Morocco', 'Team Leader - Abdelatif Ramadan'],
    },
    // Yeni Morocco takımı — bu haritada HİÇ yoktu. Sonucu: aliasesForRegion
    // ('Morocco') bu takımı döndürmediği için Morocco bölge yöneticisinin
    // panelinde (Dealler, İptal, Won, KPI'lar — hepsi team=in.(...) ile
    // filtreli) bu takımın dealleri TAMAMEN görünmüyordu; normalize() de null
    // döndüğü için takım adı ham hâliyle kalıyordu.
    'Moutaharrik Team - Morocco': {
      label: 'Moutaharrik Team', leader: 'Marco Rahimi', region: 'Morocco',
      aliases: ['Moutaharrik Team - Morocco', 'Team Leader - Moutaharrik Marco'],
    },
  };

  // Karşılaştırma anahtarı: lowercase + tüm boşluk dizilerini tek boşluğa indir
  // ("Arij  Team", "Team Leader -  Aamir Ali" gibi varyantlar eşleşsin)
  function key(s) {
    return String(s).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // alias → canonical hızlı arama tablosu
  const ALIAS_INDEX = {};
  for (const [canonical, def] of Object.entries(TEAMS)) {
    for (const alias of def.aliases) {
      ALIAS_INDEX[key(alias)] = canonical;
    }
  }

  // deals.team değerini kanonik takım adına çevir; eşleşmezse null
  function normalize(dealTeam) {
    if (!dealTeam) return null;
    return ALIAS_INDEX[key(dealTeam)] || null;
  }

  // Kanonik ad veya alias için alias listesini döndür (filtre sorgularında kullan)
  function aliasesFor(team) {
    const canonical = TEAMS[team] ? team : normalize(team);
    if (!canonical) return team ? [team] : [];
    return TEAMS[canonical].aliases.slice();
  }

  // Bölgedeki kanonik takım listesi
  function teamsForRegion(region) {
    return Object.entries(TEAMS)
      .filter(([, d]) => d.region === region)
      .map(([canonical, d]) => ({ canonical, ...d }));
  }

  // Takım (kanonik/alias) → bölge; eşleşmezse isimden tahmin
  function regionForTeam(team) {
    const canonical = TEAMS[team] ? team : normalize(team);
    if (canonical) return TEAMS[canonical].region;
    return String(team || '').toLowerCase().includes('morocco') ? 'Morocco' : 'Istanbul';
  }

  // Bölgedeki tüm takımların tüm aliasları (RM sorguları için)
  function aliasesForRegion(region) {
    const out = [];
    for (const def of Object.values(TEAMS)) {
      if (def.region === region) out.push(...def.aliases);
    }
    return out;
  }

  // PostgREST in.() filtre parametresi üret: team=in.("a","b",...) — encode edilmiş
  function inFilter(values) {
    if (!values || !values.length) return null;
    return encodeURIComponent('in.(' + values.map(v => '"' + v + '"').join(',') + ')');
  }

  return { TEAMS, normalize, aliasesFor, teamsForRegion, regionForTeam, aliasesForRegion, inFilter };
})();
