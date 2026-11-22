/**
 * PriceRadar — Config.gs
 * الثوابت + أسماء الشيتات + الهيدرز + الإعدادات الافتراضية + أدوات الشيت المشتركة.
 * أي إعداد قابل للتغيير موجود في شيت Settings (مش هنا).
 */

const APP = {
  NAME: 'Sales Navigator',
  TZ: 'Africa/Cairo',
  MIN_PRICE: 500,            // أي سعر أقل من كده = placeholder (زي "1 ج") ويتتجاهل
  BUDGET_MS: 270 * 1000,     // ميزانية الوقت لكل تشغيل (حد Apps Script = 6 دقايق)
  CONTINUE_AFTER_MIN: 2,     // استكمال الدفعات بعد كام دقيقة
  CACHE_KEY: 'pr_dash_v1',
  CACHE_TTL: 300,
  GEEKS: 'GEEKS',            // اسم صفوفنا في Price_History
  LOCK_WAIT_MS: 20000
};

/** الشيت اللي اتجهّز لك — الكود بيشتغل عليه مباشرة (لو فاضي بيدوّر على Script Property أو بينشئ شيت جديد) */
const SHEET_ID = '17qR_ERAIW101L5Z7wF0LFDjBOi8D2GA_hp3TsF20mF8';

const SHEET = {
  PRODUCTS: 'Products', COMPETITORS: 'Competitors', MATCHES: 'Matches', PRICES: 'Prices',
  HISTORY: 'Price_History', ALERTS: 'Alerts', SETTINGS: 'Settings', LOGS: 'Logs', OVERRIDES: 'Overrides'
};

const HEADERS = {
  Products:      ['SKU', 'Name', 'Category', 'Our_Price', 'Stock_Status', 'Image_URL', 'Product_URL', 'Last_Synced', 'Brand', 'Product_ID', 'Discovered_At'],
  Competitors:   ['Competitor_Name', 'Website', 'Categories', 'Platform_Type', 'Active'],
  Matches:       ['SKU', 'Competitor', 'Competitor_URL', 'Match_Type', 'Match_Confidence', 'Note', 'Last_Checked', 'Checked_URL'],
  Prices:        ['SKU', 'Competitor', 'Price', 'In_Stock', 'Checked_At'],
  Price_History: ['Date', 'SKU', 'Competitor', 'Price', 'In_Stock'],
  Alerts:        ['Timestamp', 'Type', 'SKU', 'Competitor', 'Old', 'New', 'Gap_%', 'Read'],
  Settings:      ['Key', 'Value', 'Description'],
  Logs:          ['Timestamp', 'Level', 'Function', 'Message'],
  Overrides:     ['SKU', 'Display_Name', 'Hidden', 'Note']
};

/** [المفتاح, القيمة الافتراضية, الوصف] */
const DEFAULT_SETTINGS = [
  ['our_store_source_type', 'woocommerce', 'مصدر منتجاتنا: woocommerce | shopify | csv'],
  ['our_store_source_url', 'https://geeksstoreeg.com', 'رابط المتجر (أو رابط CSV لو النوع csv)'],
  ['same_price_threshold_pct', '0.5', 'الفرق ضمن ±النسبة دي = Same price'],
  ['alert_gap_pct', '3', 'ينبّه لما منافس يبقى أرخص مننا بالنسبة دي أو أكتر'],
  ['alert_change_pct', '2', 'ينبّه على تغيّر سعر المنافس بالنسبة دي أو أكتر'],
  ['refresh_hours', '9,14,20', 'ساعات الفحص اليومي (توقيت القاهرة) مفصولة بفاصلة'],
  ['product_sync_every_hours', '6', 'مزامنة منتجاتنا كل كام ساعة (0 = معطّل)'],
  ['check_interval_minutes', '2', 'الفاصل قبل استكمال الدفعة التالية لو الوقت خلص'],
  ['batch_size', '12', 'عدد الطلبات المتوازية في الدفعة'],
  ['batch_sleep_ms', '500', 'تأخير بين الدفعات (مللي ثانية)'],
  ['match_min_confidence', '0.8', 'أقل ثقة لقبول مطابقة تلقائية (أقل منها = Exact match needed)'],
  ['rediscover_days', '7', 'نعيد البحث التلقائي عن منتج مالوش مطابقات بعد كام يوم'],
  ['history_keep_days', '180', 'مدة الاحتفاظ بـ Price_History'],
  ['firecrawl_api_key', '', 'مفتاح Firecrawl (اختياري) — بيقرأ المواقع اللي بتحجب Google أو بتعرض الأسعار بـ JavaScript'],
  ['firecrawl_max_per_run', '80', 'أقصى عدد صفحات عبر Firecrawl في التشغيل الواحد (بيتحكم في التكلفة)'],
  ['wearables_keywords', 'whoop,fitbit,pixel watch', 'منتجات بتتحط في كاتيجوري لوحدها (كلمات في الاسم أو البراند، مفصولة بفاصلة)'],
  ['wearables_label', 'WHOOP & Fitbit', 'اسم الكاتيجوري بتاعة الـ Wearables'],
  ['label_only_us', "Only we have it", 'اسم الحالة في الداشبورد'],
  ['label_same', 'Same price', 'اسم الحالة في الداشبورد'],
  ['label_cheaper', "We're cheaper", 'اسم الحالة في الداشبورد'],
  ['label_pricier', "We're pricier", 'اسم الحالة في الداشبورد'],
  ['label_not_checked', 'Not checked yet', 'اسم الحالة في الداشبورد'],
  ['label_needs_help', 'Needs your help', 'اسم الحالة في الداشبورد'],
  ['email_digest_to', '', 'إيميل الملخص اليومي (فاضي = معطّل)'],
  ['digest_hour', '9', 'ساعة إرسال الملخص (توقيت القاهرة)']
];

/* ======================= Settings ======================= */

let _settingsCache = null;
function getSettings_() {
  if (_settingsCache) return _settingsCache;
  const o = {};
  DEFAULT_SETTINGS.forEach(r => o[r[0]] = String(r[1]));
  try {
    const sh = SpreadsheetApp.openById(ssId_()).getSheetByName(SHEET.SETTINGS);
    if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => { if (r[0] !== '') o[String(r[0]).trim()] = String(r[1]); });
  } catch (e) {}
  return (_settingsCache = o);
}
function getSetting_(k) { return getSettings_()[k]; }
function getNum_(k, def) { const v = parseFloat(getSetting_(k)); return isFinite(v) ? v : def; }
function resetSettingsCache_() { _settingsCache = null; }

/* ======================= Spreadsheet helpers ======================= */

function ssId_() {
  if (SHEET_ID) return SHEET_ID;
  const p = PropertiesService.getScriptProperties();
  let id = p.getProperty('SSID');
  if (id) return id;
  let s = null;
  try { s = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  if (!s) s = SpreadsheetApp.create('Sales Navigator — Geeks Store');
  id = s.getId();
  p.setProperty('SSID', id);
  return id;
}
function ss_() { return SpreadsheetApp.openById(ssId_()); }

/** يرجّع الشيت (وينشئه بالهيدر لو مش موجود) */
function sh_(name) {
  const s = ss_();
  let sh = s.getSheetByName(name);
  if (!sh) {
    sh = s.insertSheet(name);
    const h = HEADERS[name];
    sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#1f2a14').setFontColor('#d7f56a');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** يقرأ الشيت كـ array of objects (+ _row) */
function readRows_(name) {
  const sh = sh_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const head = HEADERS[name];
  const vals = sh.getRange(2, 1, last - 1, head.length).getValues();
  return vals.map((r, i) => {
    const o = { _row: i + 2 };
    head.forEach((h, c) => o[h] = r[c]);
    return o;
  });
}

/** يكتب مصفوفة صفوف كاملة بدل محتوى الشيت (من الصف 2) */
function writeAll_(name, rows) {
  const sh = sh_(name);
  const w = HEADERS[name].length;
  rows = rows.map(r => padRow_(r, w));
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, w).clearContent();
  if (rows.length) {
    if (sh.getMaxRows() < rows.length + 1) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
    sh.getRange(2, 1, rows.length, w).setValues(rows);
  }
}

function padRow_(r, w) { r = r.slice(0, w); while (r.length < w) r.push(''); return r; }

function appendRows_(name, rows) {
  if (!rows.length) return;
  const sh = sh_(name);
  const w = HEADERS[name].length;
  rows = rows.map(r => padRow_(r, w));
  const start = sh.getLastRow() + 1;
  if (sh.getMaxRows() < start + rows.length - 1) sh.insertRowsAfter(sh.getMaxRows(), start + rows.length - sh.getMaxRows());
  sh.getRange(start, 1, rows.length, w).setValues(rows);
}

/* ======================= Logs / cache / misc ======================= */

function log_(level, fn, msg) {
  try { appendRows_(SHEET.LOGS, [[new Date(), level, fn, String(msg).slice(0, 500)]]); } catch (e) {}
}

function today_() { return Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd'); }

function bool_(v) { return v === true || String(v).toUpperCase() === 'TRUE' || String(v) === '1' || String(v).toLowerCase() === 'yes'; }

function decodeHtml_(s) {
  return String(s == null ? '' : s).replace(/&amp;/g, '&').replace(/&#8243;|&#8221;/g, '″').replace(/&#8217;|&#8216;/g, "'")
    .replace(/&quot;/g, '"').replace(/&#038;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(d));
}
function titleCase_(s) { return String(s || '').replace(/\b([a-z])/g, c => c.toUpperCase()); }

/** كاش مقسّم (CacheService حد القيمة 100KB) */
function cachePut_(key, obj, ttl) {
  try {
    const c = CacheService.getScriptCache();
    const s = JSON.stringify(obj);
    const size = 90000, n = Math.ceil(s.length / size);
    const m = { [key + '_n']: String(n) };
    for (let i = 0; i < n; i++) m[key + '_' + i] = s.substr(i * size, size);
    c.putAll(m, ttl || APP.CACHE_TTL);
  } catch (e) {}
}
function cacheGet_(key) {
  try {
    const c = CacheService.getScriptCache();
    const n = Number(c.get(key + '_n'));
    if (!n) return null;
    const keys = []; for (let i = 0; i < n; i++) keys.push(key + '_' + i);
    const got = c.getAll(keys);
    let s = '';
    for (let i = 0; i < n; i++) { if (got[key + '_' + i] == null) return null; s += got[key + '_' + i]; }
    return JSON.parse(s);
  } catch (e) { return null; }
}
function clearCache_() {
  try {
    const c = CacheService.getScriptCache();
    const n = Number(c.get(APP.CACHE_KEY + '_n')) || 0;
    const keys = [APP.CACHE_KEY + '_n']; for (let i = 0; i < n; i++) keys.push(APP.CACHE_KEY + '_' + i);
    c.removeAll(keys);
  } catch (e) {}
}
