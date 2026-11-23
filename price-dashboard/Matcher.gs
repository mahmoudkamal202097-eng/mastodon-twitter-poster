/**
 * PriceRadar — Matcher.gs
 * مطابقة منتجاتنا بمنتجات المنافسين:
 *   1) نطاق الفئات: المنافس بيتقارن بس مع فئاته (Categories في تاب Competitors)
 *   2) بحث بالـ SKU/Model number أولاً
 *   3) تشابه الاسم (Normalization + token similarity) بحد أدنى ثقة
 *   ثقة أقل من الحد → "Exact match needed" (صف في Matches بنفس الرابط المرشّح، من غير سعر)
 */

const STOP_WORDS = { ASUS: 1, MONITOR: 1, GAMING: 1, INCH: 1, THE: 1, WITH: 1, AND: 1, FOR: 1, SCREEN: 1, DISPLAY: 1, NEW: 1, EGYPT: 1, WARRANTY: 1 };

/**
 * توحيد نص المواصفات قبل المقارنة (مواقع مصرية بتكتب بالعربي):
 *   أرقام هندية → لاتيني، الألوان/الكيبورد/بوصة بالعربي → إنجليزي،
 *   "512/16" أو "1T/24" أو "512/16GB" (تخزين/رام) → "512GB 16GB".
 */
const AR_TEXT_MAP = [
  [/منتصف الليل/g, ' MIDNIGHT '], [/ضوء النجوم/g, ' STARLIGHT '], [/(أسود|اسود) فلكي/g, ' SPACE BLACK '],
  [/رمادي فلكي/g, ' SPACE GRAY '], [/(أزرق|ازرق) سماوي/g, ' SKY BLUE '], [/فضة|فضي/g, ' SILVER '],
  [/ذهبي/g, ' GOLD '], [/(أسود|اسود)/g, ' BLACK '], [/(أبيض|ابيض)/g, ' WHITE '], [/وردي/g, ' PINK '],
  [/(إنجليزي|انجليزي|إنجليزية|انجليزية)/g, ' ENGLISH '], [/عربي/g, ' ARABIC '], [/بوصة|انش|إنش/g, ' INCH '],
  [/\bBLUSCH\b/gi, ' BLUSH '], [/ماك بوك/g, ' MACBOOK '], [/ماك ستوديو/g, ' MAC STUDIO '], [/ماك ميني/g, ' MAC MINI '],
  [/(^|\s)(ابل|آبل|أبل)(?=\s|$)/g, ' APPLE '], [/(^|\s)(اير|إير|آير)(?=\s|$)/g, ' AIR '], [/(^|\s)برو(?=\s|$)/g, ' PRO '],
  [/(^|\s)نيو(?=\s|$)/g, ' NEO '], [/(^|\s)ماكس(?=\s|$)/g, ' MAX '], [/(^|\s)ستوديو(?=\s|$)/g, ' STUDIO '], [/شريحة/g, ' CHIP '], [/معالج/g, ' '],
  [/مستعمل|متجدد/g, ' RENEWED ']
];
function enText_(s) {
  let t = String(s == null ? '' : s).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  AR_TEXT_MAP.forEach(p => { t = t.replace(p[0], p[1]); });
  t = t.replace(/(\d{3,4}|\b[1-8]\s?TB?)\s*(?:GB|SSD)?\s*\/\s*(\d{1,3})\s*(?:GB|SSD)?(?![\d])/gi, (m, a, b) => {
    const st = /T/i.test(a) ? parseInt(a, 10) + 'TB' : a + 'GB';
    return ' ' + st + ' ' + b + 'GB ';
  });
  return t;
}

/** كلمات منظّمة: uppercase + حروف/أرقام بس */
function normWords_(s) {
  s = enText_(s);
  return String(s || '').toUpperCase().replace(/″|"|'|’/g, ' ').replace(/[^A-Z0-9؀-ۿ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

/** الـ token موجود كـ "كلمة كاملة" جوه النص؟ (بيتحمّل الشرطات: PG27AQWP-G) */
function hasToken_(joined, tok) {
  const t = normWords_(tok).join(' ');
  return !!t && (' ' + joined + ' ').indexOf(' ' + t + ' ') > -1;
}

/** كود آبل (MC6T4LL/A أو MC6T4AB/A) → أول 5 حروف (MC6T4) عشان يتطابق مع أي منطقة */
function appleCode_(sku) {
  const m = /^([A-Z0-9]{5})[A-Z]{1,2}\/[A-Z]$/i.exec(String(sku || '').trim());
  return m ? m[1].toUpperCase() : '';
}
/** مواصفات الرام/التخزين في النص: 16GB, 512GB, 1TB */
function memSpecs_(s) {
  const o = {};
  (String(enText_(s) || '').toUpperCase().match(/\b\d+\s?(GB|TB)\b/g) || []).forEach(x => o[x.replace(/\s/g, '')] = 1);
  return Object.keys(o).sort().join(',');
}

/** شريحة آبل: M5 / M5 PRO / M5 MAX / A18 PRO (لمنع خلط M4 بـ M5) */
function chip_(s) {
  const j = normWords_(s).join(' ').replace(/\bM([1-9]) CHIP\b/g, 'M$1');
  const a = /\bM[1-9]\b(?: (?:PRO|MAX|ULTRA))?/.exec(j) || /\bA\d{2} PRO\b/.exec(j);
  return a ? a[0] : '';
}

/** أفضل model token للمنتج: SKU أولاً، وبعدين أول كلمة فيها حروف+أرقام */
function modelToken_(name, sku) {
  const ac = appleCode_(sku);
  if (ac) return ac;
  const bad = /^\d+(HZ|GB|TB|W|MM|INCH|MS|MP|AH|MAH|CM|KG|K)$/;
  const fromSku = String(sku || '').trim();
  // SKU أرقام بس (زي 955-13-012-036-031 بتاع WHOOP) = كود داخلي، المنافس مش هيلاقيه → ندوّر بالاسم
  if (fromSku.length >= 4 && /[A-Z]/i.test(fromSku) && /\d/.test(fromSku)) return fromSku.toUpperCase();
  const cand = String(name || '').toUpperCase().split(/[\s,()\/]+/)
    .map(w => w.replace(/[^A-Z0-9\-]/g, '')).filter(w => w.length >= 5 && /[A-Z]/.test(w) && /\d/.test(w) && !bad.test(w));
  return cand[0] || '';
}

function tokenSet_(s) {
  const o = {};
  normWords_(s).forEach(w => { if (!STOP_WORDS[w] && w.length > 1) o[w] = 1; });
  return o;
}
function jaccard_(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b);
  if (!ka.length || !kb.length) return 0;
  let inter = 0; ka.forEach(k => { if (b[k]) inter++; });
  return inter / (ka.length + kb.length - inter);
}

/** ثقة المطابقة 0..1 بين منتجنا وعنوان مرشّح */
function matchConfidence_(ourName, ourToken, candTitle) {
  // أجهزة آبل: مطابقة بالخصائص (أدق من تشابه الكلمات)
  const ac = appleConfidence_(appleFeatures_(ourName), appleFeatures_(candTitle));
  if (ac != null) return ac;
  const j = jaccard_(tokenSet_(ourName), tokenSet_(candTitle));
  const candJoined = normWords_(candTitle).join(' ');
  let hit = ourToken && hasToken_(candJoined, ourToken);
  // كود آبل: المنافس بيكتبه بلاحقة منطقة (MC6T4AB/A) → نقبل الكلمة اللي بتبدأ بالكود
  if (!hit && ourToken && /^[A-Z0-9]{5}$/.test(ourToken) && /\d/.test(ourToken) && /[A-Z]/.test(ourToken)) hit = candJoined.split(' ').some(w => w.indexOf(ourToken) === 0 && w.length <= 8);
  // مواصفات مختلفة (رام/تخزين) = جهاز تاني
  const so = memSpecs_(ourName), sc = memSpecs_(candTitle);
  const chipO = chip_(ourName), chipC = chip_(candTitle);
  const specPenal = (so && sc && so !== sc ? 0.3 : 0) + (chipO && chipC && chipO !== chipC ? 0.4 : 0);
  if (hit) {
    // لو العنوان فيه لاحقة موديل مختلفة (XG27UCG ≠ XG27UCG-W) نخصم
    const T = normWords_(ourToken).join(' ');
    const ct = ' ' + normWords_(candTitle).join(' ') + ' ';
    const after = new RegExp(' ' + T + ' ([A-Z]{1,2}) ').exec(ct);
    const ourN = ' ' + normWords_(ourName).join(' ') + ' ';
    const penal = after && ourN.indexOf(' ' + T + ' ' + after[1] + ' ') === -1 ? 0.2 : 0;
    return Math.max(0, Math.min(1, 0.7 + 0.3 * Math.min(1, j * 2) - penal - specPenal));
  }
  // من غير كود موديل: نقبل لو الرام/التخزين اتطابقوا بالظبط والشريحة واحدة والاسم قريب
  if (so && so === sc && specPenal === 0 && j >= 0.6) return Math.min(0.9, 0.55 + j * 0.5);
  // منتجات من غير رام/تخزين (WHOOP bands، إكسسوارات): الاسم لازم يكون قريب جدًا
  if (!so && !sc && specPenal === 0 && j >= 0.75) return 0.85;
  return Math.max(0, Math.min(0.79, j * 0.9 - specPenal));
}


/* ======================= مطابقة آبل بالخصائص ======================= */

const APPLE_COLORS = ['SPACE BLACK', 'SPACE GRAY', 'SKY BLUE', 'MIDNIGHT', 'STARLIGHT', 'SILVER', 'CITRUS', 'BLUSH', 'INDIGO', 'GOLD'];

/** خصائص جهاز آبل من أي عنوان: العائلة / الشريحة / المقاس / التخزين / الرام / اللون */
function appleFeatures_(s) {
  const full = String(s || '');
  const label = full.split(' — ').slice(1).join(' ');          // مواصفات منتجنا بعد " — " ليها الأولوية
  const t = ' ' + normWords_(full).join(' ') + ' ';
  const tl = ' ' + normWords_(label).join(' ') + ' ';
  let fam = '';
  if (/ MACBOOK /.test(t) || / MAC STUDIO | IMAC | MAC MINI /.test(t)) {
    if (/ NEO /.test(t)) fam = 'NEO';
    else if (/ STUDIO /.test(t)) fam = 'STUDIO';
    else if (/ MINI /.test(t)) fam = 'MINI';
    else if (/ IMAC /.test(t)) fam = 'IMAC';
    else if (/ AIR /.test(t)) fam = 'AIR';
    else if (/ MACBOOK PRO /.test(t) || / PRO /.test(t)) fam = 'PRO';
  }
  if (!fam) return {};
  const chip = chip_(label) || chip_(full);
  const size = ((/ (1[3-6]) /.exec(tl) || / (1[3-6]) (INCH )?/.exec(t)) || [])[1] || '';
  const gb = (enText_(label || full).toUpperCase().match(/\b\d+\s?(GB|TB)\b/g) || [])
    .map(x => /TB/.test(x) ? parseInt(x, 10) * 1024 : parseInt(x, 10));
  const storage = gb.filter(n => n >= 256).sort((a, b) => b - a)[0] || null;
  const ram = gb.filter(n => n <= 128).sort((a, b) => a - b)[0] || null;
  const color = APPLE_COLORS.filter(c => (tl.length > 2 ? tl : t).indexOf(' ' + c + ' ') > -1)[0] || '';
  const oled = / PROLED | OLED | XDR /.test(t);                         // MacBook Pro PROLED XDR = خط منتجات مختلف
  const renewed = / RENEWED | REFURBISHED | REFURB | USED /.test(t);
  return { fam: fam, chip: chip, size: size, storage: storage, ram: ram, color: color, oled: oled ? 'Y' : 'N', renewed: renewed ? 'Y' : 'N' };
}

/** ثقة مطابقة جهازين آبل: أي خاصية متعارضة = رفض، والأساسيات لازم تتطابق */
function appleConfidence_(a, b) {
  if (!a.fam || !b.fam) return null;
  const keys = ['fam', 'chip', 'size', 'storage', 'ram', 'color', 'oled', 'renewed'];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (a[k] && b[k] && String(a[k]) !== String(b[k])) return 0.1;     // تعارض صريح (Air ≠ Pro، 256 ≠ 512، Silver ≠ Midnight...)
  }
  if (!(a.chip && b.chip && a.storage && b.storage)) return 0.5;        // ناقص الشريحة أو التخزين → مراجعة
  let c = 0.85;
  if (a.ram && b.ram) c += 0.05;
  if (a.color && b.color) c += 0.05;
  if (a.size && b.size) c += 0.03;
  return Math.min(0.98, c);
}

/* ======================= نطاق الفئات ======================= */

/**
 * هل المنتج جوه نطاق فئات المنافس؟
 *   "Monitors, Laptops"                  → أي فئة منهم
 *   "All"                                → كل الفئات
 *   "Laptops, !Macbook, !Apple Products" → لابتوبات بس ما عدا الماك (علامة ! = استثناء)
 */
function inScope_(productCategory, competitorCategories) {
  const toks = String(competitorCategories || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const pc = String(productCategory || '').toLowerCase();
  const neg = toks.filter(t => t.charAt(0) === '!').map(t => t.slice(1).trim()).filter(Boolean);
  if (neg.some(n => pc.indexOf(n) > -1)) return false;
  const pos = toks.filter(t => t.charAt(0) !== '!');
  if (!pos.length || pos.indexOf('all') > -1 || pos.indexOf('*') > -1) return true;
  return pos.some(c => pc.indexOf(c) > -1);
}

/* ======================= البحث التلقائي ======================= */

/** استعلام البحث: الـ model token لو موجود وإلا أول 5 كلمات مميزة من الاسم */
function searchQuery_(name, token) {
  if (token) return token;
  return normWords_(name).filter(w => !STOP_WORDS[w]).slice(0, 5).join(' ');
}

function buildSearchRequest_(comp, query) {
  const base = String(comp.Website).replace(/\/+$/, '');
  const q = encodeURIComponent(query);
  if (comp.Platform_Type === 'shopify') return { kind: 'shopify', req: req_(base + '/search/suggest.json?q=' + q + '&resources[type]=product&resources[limit]=6') };
  if (comp.Platform_Type === 'woocommerce') return { kind: 'woo', req: req_(base + '/wp-json/wc/store/v1/products?search=' + q + '&per_page=6') };
  return null;   // jsonld/custom: مفيش بحث تلقائي — بيحتاج رابط يدوي
}

function parseSearch_(kind, resp, comp) {
  if (!resp || resp.getResponseCode() !== 200) return [];
  const base = String(comp.Website).replace(/\/+$/, '');
  try {
    const j = JSON.parse(resp.getContentText());
    if (kind === 'shopify') {
      const list = (j.resources && j.resources.results && j.resources.results.products) || [];
      return list.map(x => ({ title: x.title, url: base + String(x.url).split('?')[0] }));
    }
    return (Array.isArray(j) ? j : []).map(x => ({ title: decodeHtml_(x.name), url: x.permalink }));
  } catch (e) { return []; }
}

/**
 * يدوّر على منتجات (products: صفوف Products) عند المنافسين اللي في نطاقهم ومالهمش Match.
 * بيرجّع صفوف Matches جديدة (الثقة العالية = auto، المتوسطة = Exact match needed).
 */
function discoverForProducts_(products, competitors, existingKeys) {
  const minConf = getNum_('match_min_confidence', 0.8);
  const newRows = [];
  const jobs = [];
  products.forEach(p => {
    const tok = modelToken_(p.Name, p.SKU);
    competitors.forEach(c => {
      if (existingKeys[p.SKU + '|' + c.Competitor_Name]) return;
      if (!inScope_(p.Category, c.Categories)) return;
      const s = buildSearchRequest_(c, searchQuery_(p.Name, tok));
      if (s) jobs.push({ p: p, c: c, tok: tok, s: s });
    });
  });
  const size = Math.max(1, Math.round(getNum_('batch_size', 12)));
  for (let i = 0; i < jobs.length; i += size) {
    const chunk = jobs.slice(i, i + size);
    const rs = fetchBatch_(chunk.map(j => j.s.req));
    chunk.forEach((j, k) => {
      const cands = parseSearch_(j.s.kind, rs[k], j.c);
      let best = null;
      cands.forEach(cd => {
        const conf = matchConfidence_(j.p.Name, j.tok, cd.title);
        if (!best || conf > best.conf) best = { conf: conf, url: cd.url, title: cd.title };
      });
      if (!best || best.conf < 0.5) return;
      const key = j.p.SKU + '|' + j.c.Competitor_Name;
      if (existingKeys[key]) return;
      existingKeys[key] = 1;
      const ok = best.conf >= minConf;
      newRows.push([j.p.SKU, j.c.Competitor_Name, best.url, 'auto', Math.round(best.conf * 100) / 100,
        ok ? '' : 'Exact match needed — ' + best.title, '']);
    });
    if (i + size < jobs.length) Utilities.sleep(getNum_('batch_sleep_ms', 500));
  }
  return newRows;
}
