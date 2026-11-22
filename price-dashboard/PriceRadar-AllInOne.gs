/**
 * PriceRadar — نسخة الملف الواحد (All-in-one)
 * الصق الملف ده كله في Code.gs (Ctrl+A ثم Ctrl+V). الداشبورد جواه، والشيت متربط.
 */
// ═══════════════ Config.gs ═══════════════
/**
 * PriceRadar — Config.gs
 * الثوابت + أسماء الشيتات + الهيدرز + الإعدادات الافتراضية + أدوات الشيت المشتركة.
 * أي إعداد قابل للتغيير موجود في شيت Settings (مش هنا).
 */

const APP = {
  NAME: 'PriceRadar',
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
  HISTORY: 'Price_History', ALERTS: 'Alerts', SETTINGS: 'Settings', LOGS: 'Logs'
};

const HEADERS = {
  Products:      ['SKU', 'Name', 'Category', 'Our_Price', 'Stock_Status', 'Image_URL', 'Product_URL', 'Last_Synced', 'Brand', 'Product_ID', 'Discovered_At'],
  Competitors:   ['Competitor_Name', 'Website', 'Categories', 'Platform_Type', 'Active'],
  Matches:       ['SKU', 'Competitor', 'Competitor_URL', 'Match_Type', 'Match_Confidence', 'Note', 'Last_Checked'],
  Prices:        ['SKU', 'Competitor', 'Price', 'In_Stock', 'Checked_At'],
  Price_History: ['Date', 'SKU', 'Competitor', 'Price', 'In_Stock'],
  Alerts:        ['Timestamp', 'Type', 'SKU', 'Competitor', 'Old', 'New', 'Gap_%', 'Read'],
  Settings:      ['Key', 'Value', 'Description'],
  Logs:          ['Timestamp', 'Level', 'Function', 'Message']
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
  if (!s) s = SpreadsheetApp.create('PriceRadar — Geeks Store');
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
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, w).clearContent();
  if (rows.length) {
    if (sh.getMaxRows() < rows.length + 1) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
    sh.getRange(2, 1, rows.length, w).setValues(rows);
  }
}

function appendRows_(name, rows) {
  if (!rows.length) return;
  const sh = sh_(name);
  const w = HEADERS[name].length;
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

// ═══════════════ Setup.gs ═══════════════
/**
 * PriceRadar — Setup.gs
 * setup(): ينشئ الشيتات بالهيدرز (مجمّدة) + الإعدادات + المنافسين + الروابط اليدوية الأولية
 *          ثم يجلب منتجاتنا ويربط الروابط بالـ SKU ويكتشف نوع منصة كل منافس.
 * بعدها شغّل installTriggers() مرة واحدة.
 */

/** الصيغة: الموديل | tokens الربط بمنتجنا (بديل1/بديل2) | مفتاح المنافس | اللينك
 *  المفاتيح: C=Compumarts S=Sigma B=El Badr G=Games World Y=Elyamama T=B.TECH R=Raya J=Jumia A=Amazon.eg
 *  دي روابط مسح 18 نوفمبر 2026 — بتتسجل كـ manual (محمية من أي تحديث تلقائي). */
const SEED_KEYS = { C: 'Compumarts', S: 'Sigma Computer', B: 'El Badr Group', G: 'Games World Egypt', Y: 'Elyamama Store', T: 'B.TECH', R: 'Raya Shop', J: 'Jumia', A: 'Amazon.eg' };

const SEED_TEXT = `
XG27ACDNG|XG27ACDNG|C|https://www.compumarts.com/products/asus-rog-strix-oled-xg27acdng-27-inch-360hz-0-03ms-qhd-oled-gaming-monitor
XG27ACDNG|XG27ACDNG|S|https://www.sigma-computer.com/en/item?id=asus-rog-strix-oled-xg27acdng-265-ojyzf7odd963
XG27ACDNG|XG27ACDNG|B|https://elbadrgroupeg.store/asus-rog-strix-oled-xg27acdng-27-1440p-qd-oled-gaming-monitor
XG27ACDNG|XG27ACDNG|A|https://www.amazon.eg/dp/B08HLRSNS3
PA279CV|PA279CV|B|https://elbadrgroupeg.store/asus-proart-display-pa279cv-27-4k-hdr-uhd-3840-x-2160-ips-monitor
PA279CV|PA279CV|C|https://www.compumarts.com/products/monitor-asus-proart-display-pa279cv-27-inch-ips-4k-uhd
PA279CV|PA279CV|S|https://www.sigma-computer.com/en/item?id=monitor-asus-proart-pa279cv-27-4k-ips-monitor-100-srgb-hdr10-de2-usb-c-65w-hdmi-displayport-5ms-60hz-built-in-speakers-height-adjustable-qlteuvo6r4ne
PA27JCV|PA27JCV|C|https://www.compumarts.com/products/asus-proart-pa27jcv-27-5k-monitor
PA27JCV|PA27JCV|B|https://elbadrgroupeg.store/asus-proart-display-5k-pa27jcv
PA27JCV|PA27JCV|S|https://www.sigma-computer.com/en/item?id=asus-proart-display-pa27jcv-27-5k-5120x2880-ips-monitor-99-dci-p3-de2-calman-verified-usb-c-96w-pd-hdr500-auto-kvm-light-sync-ergonomic-stand-byfhwmfvv4zf
PA32QCV|PA32QCV|C|https://www.compumarts.com/products/asus-proart-pa32qcv-6k-monitor
PA32QCV|PA32QCV|B|https://elbadrgroupeg.store/asus-proart-display-6k-pa32qcv-31-5-inch-professional-monitor
PA32QCV|PA32QCV|A|https://www.amazon.eg/dp/B0FG8DB71B
PG27AQWP-W|PG27AQWP-W|B|https://elbadrgroupeg.store/asus-rog-swift-oled-pg27aqwp-w-27-inch-540hz
PG27AQWP-W|PG27AQWP-W|C|https://www.compumarts.com/products/rog-swift-oled-pg27aqwp-w-27-inch-720hz-gaming-monitor-egypt
PG27AQWP-W|PG27AQWP-W|G|https://www.gamesworldegypt.com/asus-rog-swift-oled-pg27aqwp-w-gaming-monitor,-27-woled-display,-dualqhd-resolution,-540hz-refresh-rate,-0.02ns-%28gtg%29-response-time,-freesync-premium-pro-g-sync-compatible-pg27aqwp-w
PA27UCX-K|PA27UCX-K|C|https://www.compumarts.com/products/asus-proart-pa27ucx-k-27-miniled-4k-monitor
PA27UCX-K|PA27UCX-K|B|https://elbadrgroupeg.store/asus-proart-display-pa27ucx-k-27-inch-4k-hdr-mini-led-monitor
VY249HF-W|VY249HF-W|B|https://elbadrgroupeg.store/asus-vy249hf-w-23-8-inch-fhd-ips-100hz-eye-care-monitor
VY249HF-W|VY249HF-W|C|https://www.compumarts.com/products/asus-vy249hf-w-23-8-eye-care-monitor
PA32UCDM|PA32UCDM|B|https://elbadrgroupeg.store/asus-proart-oled-pa32ucdm-32-4k-qd-oled-professional-monitor
PA32UCDM|PA32UCDM|C|https://www.compumarts.com/products/asus-proart-display-oled-pa32ucdm-professional-monitor-32-inch-31-5-inch-viewable-4k-uhd-3840-x-2160-qd-oled-ultra-slim-240hz-0-1ms
PA278QGV|PA278QGV/PA278QV|C|https://www.compumarts.com/products/asus-proart-pa278qgv-27-qhd-ips-120hz-professional-monitor
PA278QGV|PA278QGV/PA278QV|S|https://www.sigma-computer.com/en/item?id=asus-proart-display-pa278qgv-gen2-27-qhd-ips-professional-monitor-120hz-95-dci-p3-light-sync-ergonomic-stand-vesa-mediasync-green-sustainability-grey-6szq3c5ot0n4
PA278QGV|PA278QGV/PA278QV|B|https://elbadrgroupeg.store/asus-proart-display-pa278qgv-27-inch-qhd-ips-120hz-professional-monitor
PA278QGV|PA278QGV/PA278QV|G|https://www.gamesworldegypt.com/asus-proart-pa278qgv-gen2-27-qhd-ips-professional-monitor
PA278QGV|PA278QGV/PA278QV|A|https://www.amazon.eg/dp/B0G1TK5G72
PA278QGV|PA278QGV/PA278QV|T|https://btech.com/en/p/asus-proart-display-gen2-27-inch-qhd-monitor-120-hertz-silver-pa278qgv
PA24ACRV|PA24ACRV|C|https://www.compumarts.com/products/products-asus-proart-pa24acrv-24-qhd-ips-professional-monitor-egypt
PG27AQWP-G|PG27AQWP-G|C|https://www.compumarts.com/products/asus-rog-swift-oled-pg27aqwp-g-edition-20-2560x1440-540hz-woled-gaming-monitor
PG27AQWP-G|PG27AQWP-G|S|https://www.sigma-computer.com/en/item?id=asus-pg27aqwp-g-27-inch-1440p-540hz-tandem-oled-gaming-monitor-dual-mode-fhd-720hz-trueblack-glossy-neo-proximity-sensor-002ms-g-sync-compatible-displayport-21-for-ps5-and-xbox-uhs7tsac23do
PG27AQWP-G|PG27AQWP-G|B|https://elbadrgroupeg.store/asus-rog-swift-oled-pg27aqwp-g-edition-20-26-5-qhd-woled-gaming-monitor-540hz-0-02ms-gtg
PG27AQWP-G|PG27AQWP-G|A|https://www.amazon.eg/dp/B0H3Z2PZNF
PG27AQWP-G|PG27AQWP-G|G|https://www.gamesworldegypt.com/asus-rog-swift-oled-pg27aqwp-g-edition-20-27-qhd-540hz-hd-720hz-dual-mode-tandem-oled-gaming-monitor-black
VG32VQM5B|VG32VQM5B|C|https://www.compumarts.com/products/products-asus-tuf-vg32vqm5b-31-5-inch-curved-full-hd-250hz-0-5ms-elmb-sync-freesync-premium-gaming-monitor
VG32VQM5B|VG32VQM5B|G|https://www.gamesworldegypt.com/asus-tuf-gaming-series-5-vg32vqm5b-31.5-curved-fhd-250hz-gaming-monitor-black-90lm0bi1-b01171
VG32VQM5B|VG32VQM5B|A|https://www.amazon.eg/dp/B0FBXB1K3G
XG27UCGR|XG27UCGR|C|https://www.compumarts.com/products/products-asus-rog-strix-xg27ucg-gen2-xg27ucgr-27-inch-3840x2160-162hz-fast-ips-monitor
XG27UCGR|XG27UCGR|B|https://elbadrgroupeg.store/asus-rog-strix-xg27ucgr-27-inch-4k-dual-mode-gaming-monitor
XG27UCGR|XG27UCGR|Y|https://elyamamastore.com/products/asus-rog-strix-xg27ucgr-27-inch-dual-mode-gaming-monitor
XG27UCGR|XG27UCGR|A|https://www.amazon.eg/dp/B0G31Y923T
XG27UCGR|XG27UCGR|G|https://www.gamesworldegypt.com/asus-rog-strix-xg27ucg-gen2-%28xg27ucgr%29-27-4k-162hz-fhd-485hz-dual-mode-gaming-monitor-black-90lm0cs0-b01371
VG27UQEL5A|VG27UQEL5A|C|https://www.compumarts.com/products/products-asus-tuf-gaming-vg27uqel5a-27-4k-80hz-fhd-310hz-fast-ips-elmb-0-3ms-gtg-gaming-monitor
VG27UQEL5A|VG27UQEL5A|B|https://elbadrgroupeg.store/asus-tuf-gaming-vg27uqel5a-27-inch-4k-uhd-80hz-monitor
XG27ACMS|XG27ACMS|C|https://www.compumarts.com/products/products-asus-rog-strix-xg27acms-320hz-1440p-fast-ips-gaming-monitor
XG27ACMS|XG27ACMS|B|https://elbadrgroupeg.store/asus-rog-strix-xg27acms-27-inch-qhd-320hz-gaming-monitor
XG27ACMS|XG27ACMS|G|https://www.gamesworldegypt.com/asus-rog-strix-xg27acms-27-qhd-320hz-fast-ips-gaming-monitor-black-90lm0be0-b01171
VY279HG2|VY279HG2|C|https://www.compumarts.com/products/asus-vy279hg2-27-fhd-144hz-ips-gaming-monitor-egypt
VY279HG2|VY279HG2|R|https://www.rayashop.com/en/asus-eye-care-vy279hg2-27-inch-fhd-led-gaming-monitor-144hz-90lm06d3-b01971-4
VY279HG2|VY279HG2|J|https://www.jumia.com.eg/asus-eye-care-gaming-monitor-vy279hg2-27-full-hd-ips-144hz-1ms-mprt-amd-freesync-frameless-eye-care-plus-antibacterial-black-135427477.html
VY279HG2|VY279HG2|T|https://btech.com/en/p/asus-eye-care-27-inch-fhd-gaming-monitor-144-hertz-1-millisecond-black-vy279hg2
VY279HG2|VY279HG2|B|https://elbadrgroupeg.store/asus-vy279hg2-27-inch-144hz-ips-eye-care-monitor
VG279Q5A|VG279Q5A|S|https://www.sigma-computer.com/en/item?id=asus-27-tuf-gaming-27-1080p-monitor-vg279q5a-full-hd-1920x1080-200hz-03ms-fast-ips-g-sync-compatible-extreme-low-motion-blur-sync-99-srgb-displaywidget-0ynmtaziipxi
VG279Q5A|VG279Q5A|C|https://www.compumarts.com/products/tuf-vg279q5a-27-fhd-200hz-gaming-monitor
VG259QMRL5A|VG259QMRL5A|C|https://www.compumarts.com/products/products-asus-tuf-gaming-vg259qmrl5a-310hz-monitor-egypt
VG259QMRL5A|VG259QMRL5A|B|https://elbadrgroupeg.store/asus-tuf-vg259qmrl5a-24-5-inch-310hz-gaming-monitor
VG259QL5A|VG259QL5A|C|https://www.compumarts.com/products/products-asus-vg259ql5a-200hz-fast-ips-full-hd-gaming-monitor
PA279CDV|PA279CDV|C|https://www.compumarts.com/products/asus-proart-oled-pa279cdv-4k-monitor-egypt
PA278CGRV|PA278CGRV|C|https://www.compumarts.com/products/asus-proart-display-pa278cgrv-27-inch-qhd-144hz-ips-professional-monitor
VG27AQML5F|VG27AQML5F|B|https://elbadrgroupeg.store/asus-tuf-gaming-vg27aqml5f-27-inch-qhd-320hz-monitor
VG27AQML5F|VG27AQML5F|C|https://www.compumarts.com/products/asus-tuf-gaming-vg27aqml5f-27-inch-qhd-320hz-gaming-monitor-egypt
VG27AQML5F|VG27AQML5F|T|https://btech.com/en/p/asus-tuf-gaming-series-5-27-inch-qhd-gaming-monitor-320-hertz-0-3-millisecond-black-vg27aqml5f
VG27AQ5F|VG27AQ5F|C|https://www.compumarts.com/products/products-asus-tuf-gaming-vg27aq5f-27inch-qhd-220hz-fast-ips-gaming-monitor
VG27AQ5F|VG27AQ5F|B|https://elbadrgroupeg.store/asus-tuf-gaming-vg27aq5f-27-inch-qhd-220hz-monitor
XG27UQDMS|XG27UQDMS|C|https://www.compumarts.com/products/products-asus-rog-strix-xg27uqdms-4k-240hz-qd-oled-gaming-monitor
XG27UCMG|XG27UCMG|S|https://www.sigma-computer.com/en/item?id=asus-rog-strix-xg27ucmg-27-inch-4k-uhd-fast-ips-gaming-monitor-3840x2160-240hz-1ms-gtg-03ms-min-95-dci-p3-hdr10-displayport-14-dsc-hdmi-21-usb-c-kvm-switch-aura-sync-wxc6ods70ndx
XG27UCMG|XG27UCMG|B|https://elbadrgroupeg.store/asus-rog-strix-xg27ucmg-27-inch-4k-240hz-triple-mode-gaming-monitor
XG27UCMG|XG27UCMG|C|https://www.compumarts.com/products/asus-rog-strix-xg27ucmg-27-inch-4k-uhd-fast-ips-240hz-gaming-monitor-egypt
`;

/** منافسين افتراضيين — Categories = نطاق الفئات (ممنوع مقارنة منافس بفئة مش بيبيعها). All = كل الفئات */
const SEED_COMPETITORS = [
  // PC / Monitors / Gaming (من غير ماك: علامة ! = استثناء)
  ['Compumarts', 'https://www.compumarts.com', 'Monitors, Laptops, Gaming, Accessories, Creators, !Macbook, !Apple Products', 'jsonld', true],
  ['Sigma Computer', 'https://www.sigma-computer.com', 'Monitors, Laptops, Gaming, Accessories, Creators, !Macbook, !Apple Products', 'jsonld', true],
  ['El Badr Group', 'https://elbadrgroupeg.store', 'Monitors, Laptops, Gaming, Accessories, Creators, !Macbook, !Apple Products', 'jsonld', true],
  ['Games World Egypt', 'https://www.gamesworldegypt.com', 'Monitors, Gaming, Accessories', 'jsonld', true],
  ['Elyamama Store', 'https://elyamamastore.com', 'Monitors, Laptops, Gaming, Accessories, !Macbook, !Apple Products', 'shopify', true],
  // Marketplaces: كل الفئات
  ['B.TECH', 'https://btech.com', 'All', 'jsonld', true],
  ['Raya Shop', 'https://www.rayashop.com', 'All', 'jsonld', true],
  ['Jumia', 'https://www.jumia.com.eg', 'All', 'jsonld', true],
  ['Amazon.eg', 'https://www.amazon.eg', 'All', 'custom', true],
  // MacBook / Apple
  ['Tradeline Egypt', 'https://tradelinestores.com', 'Macbook, Apple Products, Laptops, Gaming', '', true],
  ['Gadedly', 'https://gadedly.com', 'Macbook, Apple Products', '', true],
  ['Switch Plus', 'https://switchpluseg.com', 'Macbook, Apple Products', '', true],
  ['Ennap', 'https://ennap.com', 'Macbook, Apple Products', '', true],
  ['Digital Egypt', 'https://digital.com.eg', 'Macbook, Apple Products, Laptops', '', true],
  // MacBook + Windows laptops
  ['Egypt Laptop', 'https://egyptlaptop.com', 'Laptops, Macbook, Apple Products', '', true],
  ['2B', 'https://2b.com.eg', 'Laptops, Macbook, Apple Products', '', true],
  ['Noon Egypt', 'https://www.noon.com/egypt-en', 'Laptops, Macbook, Apple Products, Gaming', 'custom', true],
  // Windows laptops (من غير ماك)
  ['Dream 2000', 'https://dream2000.com.eg', 'Laptops, Gaming, Monitors, !Macbook, !Apple Products', '', true],
  ['Trojan Store', 'https://trojanstoreeg.com', 'Laptops, Gaming, !Macbook, !Apple Products', '', true],
  ['Albetar Store', 'https://albetarstore.com', 'Laptops, Gaming, !Macbook, !Apple Products', '', true],
  ['Elghazawy', 'https://elghazawy.com', 'Laptops, Gaming, !Macbook, !Apple Products', '', true]
];

function setup() {
  Object.keys(SHEET).forEach(k => sh_(SHEET[k]));
  seedSettings_();
  if (readRows_(SHEET.COMPETITORS).length === 0) appendRows_(SHEET.COMPETITORS, SEED_COMPETITORS);
  const sync = syncOurProducts();
  const linked = seedMatches_();
  const detected = detectAllPlatforms_();
  clearCache_();
  const url = ss_().getUrl();
  log_('INFO', 'setup', 'منتجات: ' + sync.monitored + ' • روابط اتربطت: ' + linked + ' • منصات: ' + JSON.stringify(detected));
  return url;
}

function seedSettings_() {
  const sh = sh_(SHEET.SETTINGS);
  if (sh.getLastRow() > 1) return;
  sh.getRange(2, 1, DEFAULT_SETTINGS.length, 3).setValues(DEFAULT_SETTINGS);
  sh.setColumnWidth(1, 220); sh.setColumnWidth(2, 260); sh.setColumnWidth(3, 480);
}

/** يحوّل SEED_TEXT لصفوف Matches (manual) بعد ربط الموديل بـ SKU بتاع منتجنا */
function seedMatches_() {
  if (readRows_(SHEET.MATCHES).length > 0) return 0;
  const products = readRows_(SHEET.PRODUCTS);
  const joined = products.map(p => normWords_(p.Name + ' ' + p.SKU).join(' '));
  const rows = [], unresolved = {};
  SEED_TEXT.split('\n').map(l => l.trim()).filter(Boolean).forEach(l => {
    const p = l.split('|');
    const toks = p[1].split('/');
    let best = -1, score = 0;
    joined.forEach((j, i) => { let s = 0; toks.forEach(t => { if (hasToken_(j, t)) s++; }); if (s > score) { score = s; best = i; } });
    if (best < 0) { unresolved[p[0]] = 1; return; }
    rows.push([String(products[best].SKU), SEED_KEYS[p[2]], p[3], 'manual', 1, 'seed — مسح 18 نوفمبر 2026', '']);
  });
  appendRows_(SHEET.MATCHES, rows);
  const miss = Object.keys(unresolved);
  if (miss.length) log_('WARN', 'seedMatches_', 'موديلات مالهاش منتج متوفر عندنا دلوقتي (طبيعي لو نفذت): ' + miss.join(', '));
  return rows.length;
}

/** يكتشف Platform_Type لكل منافس نوعه فاضي */
function detectAllPlatforms_() {
  const sh = sh_(SHEET.COMPETITORS);
  const out = {};
  readRows_(SHEET.COMPETITORS).forEach(c => {
    if (c.Platform_Type) { out[c.Competitor_Name] = c.Platform_Type; return; }
    const t = detectPlatform_(c.Website);
    sh.getRange(c._row, 4).setValue(t);
    out[c.Competitor_Name] = t;
  });
  return out;
}

// ═══════════════ OurProducts.gs ═══════════════
/**
 * PriceRadar — OurProducts.gs
 * جلب منتجاتنا وتحديث تاب Products.
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │  مصدر منتجاتنا = تاب Settings:                                │
 * │    our_store_source_type : woocommerce | shopify | csv        │
 * │    our_store_source_url  : رابط المتجر (أو رابط CSV)           │
 * │  ولو عايز مصدر تاني، عدّل fetchOurItems_() تحت — مكان واحد.    │
 * └──────────────────────────────────────────────────────────────┘
 *
 * القاعدة: بنراقب بس المنتجات (in_stock / preorder). أي منتج نفد عندنا
 * بيتشال من Products ولا بيتراقب، وبيرجع تلقائيًا لما يتوفر.
 */

const OUR_UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'ar,en;q=0.8'
};

/** نقطة التبديل الوحيدة للمصدر — بترجّع [{sku,id,name,category,brand,price,stock,image,url}] */
function fetchOurItems_() {
  const type = String(getSetting_('our_store_source_type') || 'woocommerce').toLowerCase();
  const url = String(getSetting_('our_store_source_url') || '').replace(/\/$/, '');
  if (!url) throw new Error('our_store_source_url فاضي في Settings');
  if (type === 'shopify') return fetchShopifyItems_(url);
  if (type === 'csv') return fetchCsvItems_(url);
  return fetchWooItems_(url);
}

/** مزامنة منتجاتنا — بتتنادى من الـ Trigger ومن زرار "Update our products" */
function syncOurProducts() {
  const items = fetchOurItems_();
  const old = {};
  readRows_(SHEET.PRODUCTS).forEach(r => old[String(r.SKU)] = r);

  const now = new Date();
  const seen = {};
  const rows = [];
  items.forEach(it => {
    if (it.stock !== 'in_stock' && it.stock !== 'preorder') return;   // Out of stock = مش بيتراقب
    if (!(it.price > 0)) return;
    const sku = String(it.sku || ('P' + it.id));
    if (seen[sku]) return; seen[sku] = 1;
    const o = old[sku];
    rows.push([sku, it.name, it.category, it.price, it.stock, it.image || '', it.url, now, it.brand || '', it.id, o ? o.Discovered_At : '']);
  });
  if (!rows.length) throw new Error('المصدر رجّع صفر منتجات متوفرة — مش هكتب فوق Products');

  const removed = Object.keys(old).filter(k => !seen[k]).length;
  writeAll_(SHEET.PRODUCTS, rows);
  upsertHistory_(rows.map(r => [r[0], APP.GEEKS, r[3], r[4] === 'in_stock' || r[4] === 'preorder']));
  clearCache_();
  log_('INFO', 'syncOurProducts', 'متراقب: ' + rows.length + ' — اتشال/اتجاهل: ' + removed);
  return { monitored: rows.length, removed: removed };
}

/* ---------- WooCommerce (Store API) ---------- */
function fetchWooItems_(base) {
  const out = [];
  let page = 1, total = 1;
  while (page <= total) {
    const res = UrlFetchApp.fetch(base + '/wp-json/wc/store/v1/products?per_page=100&page=' + page, { muteHttpExceptions: true, headers: OUR_UA });
    if (res.getResponseCode() !== 200) throw new Error('Woo Store API رجّع HTTP ' + res.getResponseCode());
    const h = res.getHeaders();
    total = Number(h['X-WP-TotalPages'] || h['x-wp-totalpages'] || 1);
    JSON.parse(res.getContentText()).forEach(p => {
      const pr = p.prices || {};
      const minor = Number(pr.currency_minor_unit || 0);
      const price = pr.price ? Number(pr.price) / Math.pow(10, minor) : 0;
      const cats = (p.categories || []).map(c => decodeHtml_(c.name)).filter(n => !/^uncategorized$/i.test(n));
      out.push({
        id: p.id, sku: p.sku || '', name: decodeHtml_(p.name), category: cats.join(' / '),
        brand: titleCase_(p.brands && p.brands[0] ? decodeHtml_(p.brands[0].name) : ''),
        price: price, stock: p.is_on_backorder ? 'preorder' : (p.is_in_stock ? 'in_stock' : 'out'),
        image: (p.images && p.images[0] && (p.images[0].thumbnail || p.images[0].src)) || '', url: p.permalink
      });
    });
    page++;
  }
  return out;
}

/* ---------- Shopify (/products.json) ---------- */
function fetchShopifyItems_(base) {
  const out = [];
  for (let page = 1; page <= 40; page++) {
    const res = UrlFetchApp.fetch(base + '/products.json?limit=250&page=' + page, { muteHttpExceptions: true, headers: OUR_UA });
    if (res.getResponseCode() !== 200) throw new Error('Shopify products.json رجّع HTTP ' + res.getResponseCode());
    const list = JSON.parse(res.getContentText()).products || [];
    if (!list.length) break;
    list.forEach(p => {
      const vs = p.variants || [];
      const v = vs[0] || {};
      const avail = vs.some(x => x.available);
      out.push({
        id: p.id, sku: v.sku || '', name: p.title, category: p.product_type || '', brand: p.vendor || '',
        price: parseFloat(v.price) || 0, stock: avail ? 'in_stock' : 'out',
        image: (p.images && p.images[0] && p.images[0].src) || '', url: base + '/products/' + p.handle
      });
    });
    if (list.length < 250) break;
  }
  return out;
}

/* ---------- CSV: SKU,Name,Category,Price,Stock,Image,URL ---------- */
function fetchCsvItems_(url) {
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('CSV رجّع HTTP ' + res.getResponseCode());
  const rows = Utilities.parseCsv(res.getContentText());
  return rows.slice(1).filter(r => r[1]).map((r, i) => ({
    id: i + 1, sku: r[0], name: r[1], category: r[2] || '', brand: '', price: parseFloat(String(r[3]).replace(/[^\d.]/g, '')) || 0,
    stock: /out|نفذ|0/i.test(String(r[4])) ? 'out' : (/pre/i.test(String(r[4])) ? 'preorder' : 'in_stock'),
    image: r[5] || '', url: r[6] || ''
  }));
}

/* ---------- Price_History: سطر واحد لكل يوم لكل (SKU, منافس) ---------- */
/**
 * entries: [[sku, competitor, price, inStock]]
 * بيكتب/يحدّث صفوف النهارده بس (آخر كتلة في الشيت) بدون تكرار.
 */
function upsertHistory_(entries) {
  if (!entries.length) return;
  const sh = sh_(SHEET.HISTORY);
  const day = today_();
  const last = sh.getLastRow();
  // نلاقي بداية كتلة النهارده (الصفوف مرتبة بالتاريخ بالإضافة)
  let start = last + 1;
  const tail = Math.min(last - 1, 20000);
  let existing = [];
  if (tail > 0) {
    const from = last - tail + 1;
    const vals = sh.getRange(from, 1, tail, 5).getValues();
    let i = vals.length - 1;
    while (i >= 0 && fmtDay_(vals[i][0]) === day) i--;
    start = from + i + 1;
    existing = vals.slice(i + 1);
  }
  const map = {}, order = [];
  existing.forEach(r => { const k = r[1] + '|' + r[2]; map[k] = [day, r[1], r[2], r[3], r[4]]; order.push(k); });
  entries.forEach(e => {
    const k = e[0] + '|' + e[1];
    if (!map[k]) order.push(k);
    map[k] = [day, e[0], e[1], e[2], e[3]];
  });
  const rows = order.map(k => map[k]);
  const w = 5;
  if (existing.length) sh.getRange(start, 1, existing.length, w).clearContent();
  if (sh.getMaxRows() < start + rows.length - 1) sh.insertRowsAfter(sh.getMaxRows(), start + rows.length - sh.getMaxRows());
  sh.getRange(start, 1, rows.length, 1).setNumberFormat('@');   // التاريخ نص ثابت
  sh.getRange(start, 1, rows.length, w).setValues(rows);
}
function fmtDay_(d) {
  if (d instanceof Date) return Utilities.formatDate(d, APP.TZ, 'yyyy-MM-dd');
  return String(d).slice(0, 10);
}

function pruneHistory_() {
  const sh = sh_(SHEET.HISTORY);
  const last = sh.getLastRow();
  if (last < 2) return;
  const keep = getNum_('history_keep_days', 180);
  const cutoff = Utilities.formatDate(new Date(Date.now() - keep * 864e5), APP.TZ, 'yyyy-MM-dd');
  const ds = sh.getRange(2, 1, last - 1, 1).getValues();
  let n = 0;
  while (n < ds.length && fmtDay_(ds[n][0]) < cutoff) n++;
  if (n > 0) sh.deleteRows(2, n);
}

// ═══════════════ Scraper.gs ═══════════════
/**
 * PriceRadar — Scraper.gs
 * قراءة سعر/توفر المنتج من صفحة المنافس.
 * الاستراتيجيات بالترتيب (حسب Platform_Type):
 *   shopify     → /products/{handle}.js
 *   woocommerce → Store API ?slug=
 *   jsonld      → JSON-LD (schema.org Product/Offer)   [الافتراضي لـ custom]
 *   fallback    → meta tags ثم Regex (Amazon.eg وغيره)
 * لو الاستراتيجية الأولى فشلت بنرجع للصفحة نفسها (JSON-LD/Regex).
 */

const SCRAPE_UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'ar,en;q=0.8',
  'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8'
};

/* ======================= طبقة الشبكة ======================= */

/** fetchAll على دفعة واحدة مع Retry (exponential backoff) للأخطاء المؤقتة — بيرجّع array بنفس الترتيب (ممكن null) */
function fetchBatch_(reqs) {
  const out = new Array(reqs.length).fill(null);
  let pending = reqs.map((r, i) => i);
  for (let attempt = 0; attempt < 3 && pending.length; attempt++) {
    if (attempt) Utilities.sleep(500 * Math.pow(2, attempt));
    let rs;
    try {
      rs = UrlFetchApp.fetchAll(pending.map(i => reqs[i]));
    } catch (e) {
      rs = pending.map(i => { try { return UrlFetchApp.fetch(reqs[i].url, reqs[i]); } catch (e2) { return null; } });
    }
    const next = [];
    rs.forEach((r, k) => {
      const i = pending[k];
      const code = r ? r.getResponseCode() : 0;
      const transient = !r || code === 429 || code >= 500;
      if (!transient || attempt === 2) out[i] = r; else next.push(i);
    });
    pending = next;
  }
  return out;
}

function req_(url) { return { url: url, muteHttpExceptions: true, followRedirects: true, headers: SCRAPE_UA }; }

/* ======================= الاستراتيجيات ======================= */

function originOf_(url) { const m = /^(https?:\/\/[^\/]+)/i.exec(url); return m ? m[1] : ''; }
function lastSegment_(url) {
  const p = String(url).split('#')[0].split('?')[0].replace(/\/+$/, '').split('/');
  return decodeURIComponent(p[p.length - 1] || '');
}

/** يبني الطلب الأول للـ match حسب نوع المنصة */
function buildRequest_(url, platform) {
  const u = String(url).split('#')[0];
  if (platform === 'shopify' && /\/products\//.test(u)) return { kind: 'shopify', req: req_(u.split('?')[0].replace(/\/+$/, '') + '.js') };
  if (platform === 'woocommerce') return { kind: 'woo', req: req_(originOf_(u) + '/wp-json/wc/store/v1/products?slug=' + encodeURIComponent(lastSegment_(u))) };
  return { kind: 'page', req: req_(u) };
}

/** يحلل رد الاستراتيجية → {price, inStock, source} أو null */
function parseResponse_(kind, resp, pageUrl) {
  if (!resp) return null;
  const code = resp.getResponseCode();
  if (code !== 200) return null;
  const body = resp.getContentText();
  try {
    if (kind === 'shopify') {
      const j = JSON.parse(body);
      const vs = j.variants || [];
      const live = vs.filter(v => v.available);
      const pick = live.length ? live.reduce((a, b) => (a.price <= b.price ? a : b)) : (vs[0] || {});
      // Shopify .js بيرجّع السعر بالقروش (integer) → نقسم على 100
      const price = Number(pick.price != null ? pick.price : j.price) / 100;
      return finalizePrice_(price, !!(j.available || live.length), 'shopify');
    }
    if (kind === 'woo') {
      const arr = JSON.parse(body);
      const p = Array.isArray(arr) ? arr[0] : null;
      if (!p) return null;
      const pr = p.prices || {};
      const price = Number(pr.price) / Math.pow(10, Number(pr.currency_minor_unit || 0));
      return finalizePrice_(price, !!p.is_in_stock, 'woocommerce');
    }
  } catch (e) { return null; }
  return parsePage_(body, pageUrl);
}

/** JSON-LD ← meta ← Amazon ← regex نصي */
function parsePage_(html, url) {
  let best = null;
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let j;
    try { j = JSON.parse(m[1].trim()); } catch (e) { continue; }
    walk_(j, node => {
      if (!isProduct_(node) || !node.offers) return;
      const o = offerFrom_(node.offers);
      if (o && (!best || (best.price == null && o.price != null))) best = o;
    });
  }
  if (best) return finalizePrice_(best.price, best.inStock, 'jsonld', best.hasAvail);
  const mp = metaContent_(html, ['product:price:amount', 'og:price:amount']);
  if (mp) {
    const av = metaContent_(html, ['product:availability', 'og:availability']);
    const inStock = av ? /in\s?stock|instock|available/i.test(av) && !/out/i.test(av) : !outOfStockText_(html);
    return finalizePrice_(parseFloat(String(mp).replace(/[^\d.]/g, '')), inStock, 'meta', !!av);
  }
  if (/amazon\./i.test(url)) return amazonFallback_(html);
  return null;
}

function outOfStockText_(html) {
  return /out of stock|sold out|currently unavailable|نفذت الكمية|نفد المخزون|غير متوفر|نفذ المنتج/i.test(html);
}

function walk_(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => walk_(n, fn)); return; }
  fn(node);
  Object.keys(node).forEach(k => { if (node[k] && typeof node[k] === 'object') walk_(node[k], fn); });
}
function isProduct_(n) {
  const t = n['@type'];
  return !!t && (Array.isArray(t) ? (t.indexOf('Product') > -1 || t.indexOf('ProductGroup') > -1) : (t === 'Product' || t === 'ProductGroup'));
}
function offerFrom_(offers) {
  const list = Array.isArray(offers) ? offers : [offers];
  let pick = null;
  list.forEach(o => {
    if (!o) return;
    const price = o.price != null ? o.price : (o.lowPrice != null ? o.lowPrice : (o.priceSpecification && o.priceSpecification.price));
    const av = String(o.availability || '');
    const inStock = /instock|limited|onlineonly/i.test(av);
    const cand = { price: price, inStock: inStock, hasAvail: !!av };
    if (!pick || (inStock && !pick.inStock)) pick = cand;
  });
  return pick;
}
function metaContent_(html, names) {
  for (let i = 0; i < names.length; i++) {
    const re = new RegExp('<meta[^>]+(?:property|name)=["\']' + names[i].replace(/[:.]/g, '\\$&') + '["\'][^>]*content=["\']([^"\']+)["\']', 'i');
    const m = re.exec(html);
    if (m) return m[1];
  }
  return '';
}
function amazonFallback_(html) {
  // السعر الحقيقي جوه بلوك priceToPay / corePrice — مش أول a-offscreen في الصفحة (دي بتبقى إعلانات منتجات تانية)
  let m = /class="a-price[^"]*priceToPay[^"]*"[\s\S]{0,400}?a-price-whole">\s*([\d,]+)/i.exec(html);
  if (!m) {
    const c = html.indexOf('id="corePrice_feature_div"');
    const seg = c > -1 ? html.substr(c, 4000) : '';
    m = /a-offscreen">\s*(?:EGP|ج\.م\.?)?(?:&nbsp;|\s)*([\d,]+(?:\.\d+)?)/i.exec(seg);
  }
  const avBlock = (/id="availability"[\s\S]{0,700}/i.exec(html) || [''])[0].replace(/<[^>]+>/g, ' ');
  const unavailable = /Currently unavailable|غير متوفر حاليًا|غير متوفر حاليا/i.test(avBlock);
  if (!m) return unavailable ? { price: null, inStock: false, source: 'amazon', hasAvail: true } : null;
  const hasButton = /id="add-to-cart-button"/.test(html);
  const preorder = /pre-?order|طلب مسبق/i.test(avBlock) && !hasButton;
  return finalizePrice_(parseFloat(m[1].replace(/,/g, '')), !(unavailable || preorder), 'amazon', true);
}

/** يتأكد من السعر (placeholder/عملة) ويرجّع الشكل الموحد */
function finalizePrice_(rawPrice, inStock, source, hasAvail) {
  let price = parseFloat(String(rawPrice == null ? '' : rawPrice).replace(/[^\d.]/g, ''));
  if (!isFinite(price) || price < APP.MIN_PRICE) price = null;
  return { price: price, inStock: !!inStock, source: source, hasAvail: hasAvail !== false };
}

/* ======================= Firecrawl (للمواقع اللي بتحجب Google) ======================= */

var _fcUsed = 0;
/** يبني طلب Firecrawl لصفحة محجوبة. محتاج firecrawl_api_key في Settings. */
function firecrawlRequest_(url) {
  return {
    url: 'https://api.firecrawl.dev/v1/scrape', method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + String(getSetting_('firecrawl_api_key')).trim() },
    payload: JSON.stringify({ url: url, formats: ['rawHtml'], waitFor: 1500, timeout: 45000 })
  };
}
function firecrawlHtml_(resp) {
  if (!resp || resp.getResponseCode() !== 200) return null;
  try { const j = JSON.parse(resp.getContentText()); return (j.data && j.data.rawHtml) || null; } catch (e) { return null; }
}
function firecrawlEnabled_() { return String(getSetting_('firecrawl_api_key') || '').trim().length > 10; }

/* ======================= فحص مجموعة Matches ======================= */

/**
 * matches: [{sku, competitor, url, platform, row}]
 * بيرجّع [{match, result|null, error}] — النتيجة فيها price/inStock.
 * ممنوع نكتب أي حاجة للشيت من هنا (الكتابة في Triggers.gs).
 */
function checkMatches_(matches) {
  const out = [];
  const size = Math.max(1, Math.round(getNum_('batch_size', 12)));
  const sleep = getNum_('batch_sleep_ms', 500);
  for (let i = 0; i < matches.length; i += size) {
    const chunk = matches.slice(i, i + size);
    const plan = chunk.map(m => buildRequest_(m.url, m.platform));
    const resps = fetchBatch_(plan.map(p => p.req));
    const second = [];       // اللي فشل بالاستراتيجية الأولى نجرّب صفحته
    const results = chunk.map((m, k) => {
      const r = parseResponse_(plan[k].kind, resps[k], m.url);
      if (r && r.price) return { match: m, result: r };
      if (plan[k].kind !== 'page') { second.push(k); return { match: m, result: null }; }
      return { match: m, result: r, error: errorOf_(resps[k], r) };
    });
    if (second.length) {
      const rs2 = fetchBatch_(second.map(k => req_(chunk[k].url)));
      second.forEach((k, j) => {
        const r = parseResponse_('page', rs2[j], chunk[k].url);
        results[k] = { match: chunk[k], result: r, error: (r && r.price) ? '' : errorOf_(rs2[j], r) };
      });
    }
    // اللي لسه من غير سعر (محجوب/JS) → Firecrawl لو متفعّل (بحد أقصى لكل تشغيل)
    if (firecrawlEnabled_()) {
      const cap = Math.round(getNum_('firecrawl_max_per_run', 80));
      const need = [];
      results.forEach((x, k) => { if (!(x.result && x.result.price) && !(x.result && x.result.hasAvail && x.result.inStock === false && x.result.price == null) && _fcUsed + need.length < cap) need.push(k); });
      if (need.length) {
        const rs3 = fetchBatch_(need.map(k => firecrawlRequest_(chunk[k].url)));
        need.forEach((k, j) => {
          _fcUsed++;
          const html = firecrawlHtml_(rs3[j]);
          const r = html ? parsePage_(html, chunk[k].url) : null;
          if (r && r.price) results[k] = { match: chunk[k], result: r, error: '' };
          else results[k].error = (results[k].error || '') + ' + firecrawl ' + (html ? 'no price' : 'failed');
        });
      }
    }
    results.forEach(x => out.push(x));
    if (i + size < matches.length) Utilities.sleep(sleep);
  }
  return out;
}

function errorOf_(resp, parsed) {
  if (!resp) return 'no response';
  const c = resp.getResponseCode();
  if (c !== 200) return 'HTTP ' + c;
  if (!parsed) return 'no price data on page';
  if (parsed.price == null) return 'placeholder/empty price';
  return '';
}

/* ======================= اكتشاف نوع المنصة ======================= */

/** shopify | woocommerce | jsonld | custom */
function detectPlatform_(website) {
  const base = String(website).replace(/\/+$/, '');
  const probes = [
    { t: 'shopify', u: base + '/search/suggest.json?q=asus&resources[type]=product&resources[limit]=1', ok: b => /"resources"/.test(b) },
    { t: 'woocommerce', u: base + '/wp-json/wc/store/v1/products?per_page=1', ok: b => /^\s*\[/.test(b) }
  ];
  const rs = fetchBatch_(probes.map(p => req_(p.u)));
  for (let i = 0; i < probes.length; i++) {
    if (rs[i] && rs[i].getResponseCode() === 200 && probes[i].ok(rs[i].getContentText())) return probes[i].t;
  }
  const home = fetchBatch_([req_(base + '/')])[0];
  if (!home || home.getResponseCode() >= 400) return 'custom';
  const b = home.getContentText();
  if (/cdn\.shopify\.com|Shopify\.theme/i.test(b)) return 'shopify';
  return /application\/ld\+json/i.test(b) ? 'jsonld' : 'custom';
}

// ═══════════════ Matcher.gs ═══════════════
/**
 * PriceRadar — Matcher.gs
 * مطابقة منتجاتنا بمنتجات المنافسين:
 *   1) نطاق الفئات: المنافس بيتقارن بس مع فئاته (Categories في تاب Competitors)
 *   2) بحث بالـ SKU/Model number أولاً
 *   3) تشابه الاسم (Normalization + token similarity) بحد أدنى ثقة
 *   ثقة أقل من الحد → "Exact match needed" (صف في Matches بنفس الرابط المرشّح، من غير سعر)
 */

const STOP_WORDS = { ASUS: 1, MONITOR: 1, GAMING: 1, INCH: 1, THE: 1, WITH: 1, AND: 1, FOR: 1, SCREEN: 1, DISPLAY: 1, NEW: 1, EGYPT: 1, WARRANTY: 1 };

/** كلمات منظّمة: uppercase + حروف/أرقام بس */
function normWords_(s) {
  return String(s || '').toUpperCase().replace(/″|"|'|’/g, ' ').replace(/[^A-Z0-9؀-ۿ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

/** الـ token موجود كـ "كلمة كاملة" جوه النص؟ (بيتحمّل الشرطات: PG27AQWP-G) */
function hasToken_(joined, tok) {
  const t = normWords_(tok).join(' ');
  return !!t && (' ' + joined + ' ').indexOf(' ' + t + ' ') > -1;
}

/** أفضل model token للمنتج: SKU أولاً، وبعدين أول كلمة فيها حروف+أرقام */
function modelToken_(name, sku) {
  const bad = /^\d+(HZ|GB|TB|W|MM|INCH|MS|MP|AH|MAH|CM|KG|K)$/;
  const fromSku = String(sku || '').trim();
  if (fromSku.length >= 4) return fromSku.toUpperCase();
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
  const j = jaccard_(tokenSet_(ourName), tokenSet_(candTitle));
  const hit = ourToken && hasToken_(normWords_(candTitle).join(' '), ourToken);
  if (hit) {
    // لو العنوان فيه لاحقة موديل مختلفة (XG27UCG ≠ XG27UCG-W) نخصم
    const T = normWords_(ourToken).join(' ');
    const ct = ' ' + normWords_(candTitle).join(' ') + ' ';
    const after = new RegExp(' ' + T + ' ([A-Z]{1,2}) ').exec(ct);
    const ourN = ' ' + normWords_(ourName).join(' ') + ' ';
    const penal = after && ourN.indexOf(' ' + T + ' ' + after[1] + ' ') === -1 ? 0.2 : 0;
    return Math.max(0, Math.min(1, 0.7 + 0.3 * Math.min(1, j * 2) - penal));
  }
  return Math.min(0.79, j * 0.9);
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

// ═══════════════ Compare.gs ═══════════════
/**
 * PriceRadar — Compare.gs
 * منطق المقارنة (دوال صافية بتاخد بيانات وترجّع نتيجة — سهلة الاختبار).
 *
 * لكل منتج: أرخص منافس "متوفر في المخزون" فقط (المنافس Out of stock مش داخل في الحساب).
 *   Gap % = (سعرنا − أرخص سعر منافس) ÷ أرخص سعر منافس × 100
 * التصنيف:
 *   only_us      مفيش منافس عنده المنتج متوفر
 *   same         الفرق ضمن ±same_price_threshold_pct
 *   cheaper      سعرنا أقل
 *   pricier      منافس أرخص مننا
 *   needs_help   اتبحث ومالقيناش مطابقة موثوقة (محتاج رابط يدوي)
 *   not_checked  لسه ما اتفحصش
 */

function classify_(ours, minLive, hasAnyPrice, discovered, scopeCount, samePct) {
  if (!scopeCount) return { st: 'not_checked', gap: null };
  if (!hasAnyPrice) return { st: discovered ? 'needs_help' : 'not_checked', gap: null };
  if (minLive == null) return { st: 'only_us', gap: null };
  const gap = (ours - minLive) / minLive * 100;
  if (Math.abs(gap) <= samePct) return { st: 'same', gap: gap };
  return { st: gap < 0 ? 'cheaper' : 'pricier', gap: gap };
}

function topCategory_(cat) { return String(cat || '').split(' / ')[0] || 'Other'; }

/**
 * inp = { products, competitors, matches, prices, history, alerts, now }
 * (كلها صفوف بالأسماء بتاعة الهيدرز)
 */
function buildAggregates_(inp) {
  const samePct = inp.samePct != null ? inp.samePct : 0.5;
  const minConf = inp.minConf != null ? inp.minConf : 0.8;
  const comps = inp.competitors.filter(c => c.Competitor_Name);
  const activeComps = comps.filter(c => bool_(c.Active));

  const matchBy = {}, priceBy = {};
  inp.matches.forEach(m => { matchBy[m.SKU + '|' + m.Competitor] = m; });
  inp.prices.forEach(p => { priceBy[p.SKU + '|' + p.Competitor] = p; });

  const catCount = {};
  let lastChecked = 0;
  inp.prices.forEach(p => { const t = new Date(p.Checked_At).getTime(); if (t > lastChecked) lastChecked = t; });

  const products = inp.products.map(p => {
    const sku = String(p.SKU);
    const ours = Number(p.Our_Price);
    // نطاق الفئات + أي منافس ليه رابط يدوي (الروابط اليدوية ليها أولوية حتى برا النطاق)
    const scope = activeComps.filter(c => inScope_(p.Category, c.Categories) ||
      (matchBy[sku + '|' + c.Competitor_Name] && String(matchBy[sku + '|' + c.Competitor_Name].Match_Type) === 'manual'));
    const cells = {};
    let minLive = null, minBy = [], hasAnyPrice = false, hasOnlyOos = false, needsHelpCell = false;
    scope.forEach(c => {
      const key = sku + '|' + c.Competitor_Name;
      const m = matchBy[key], pr = priceBy[key];
      if (!m && !pr) return;
      const low = !!m && String(m.Match_Type) === 'auto' && Number(m.Match_Confidence) < minConf;
      const cell = {
        u: m ? m.Competitor_URL : '', m: m ? String(m.Match_Type) : '', cf: m ? Number(m.Match_Confidence) : null,
        note: m ? String(m.Note || '') : '', low: low, p: null, s: null, t: null
      };
      if (pr && !low) {
        cell.p = Number(pr.Price); cell.s = bool_(pr.In_Stock); cell.t = new Date(pr.Checked_At).getTime();
        hasAnyPrice = true;
        if (cell.s) {
          if (minLive == null || cell.p < minLive) { minLive = cell.p; minBy = [c.Competitor_Name]; }
          else if (cell.p === minLive) minBy.push(c.Competitor_Name);
        }
      }
      if (low) needsHelpCell = true;
      cells[c.Competitor_Name] = cell;
    });
    const k = classify_(ours, minLive, hasAnyPrice, !!p.Discovered_At || needsHelpCell, scope.length, samePct);
    // الترتيب داخل الفئة: 0 = فيه منافس متوفر، 1 = المنافس Out of stock، 2 = مفيش سعر منافس
    const grp = minLive != null ? 0 : (hasAnyPrice ? 1 : 2);
    const top = topCategory_(p.Category);
    catCount[top] = (catCount[top] || 0) + 1;
    return {
      sku: sku, n: String(p.Name), cat: String(p.Category), top: top, brand: String(p.Brand || ''), img: String(p.Image_URL || ''),
      url: String(p.Product_URL || ''), p: ours, stock: String(p.Stock_Status), st: k.st, gap: k.gap, grp: grp,
      min: minLive, minBy: minBy, cells: cells, nScope: scope.length, needs: k.st === 'needs_help'
    };
  });

  const summary = { only_us: 0, same: 0, cheaper: 0, pricier: 0, not_checked: 0, needs_help: 0, total: products.length };
  const byCat = {};
  products.forEach(p => {
    summary[p.st]++;
    const b = byCat[p.top] = byCat[p.top] || { cat: p.top, only_us: 0, same: 0, cheaper: 0, pricier: 0, other: 0 };
    if (p.st === 'not_checked' || p.st === 'needs_help') b.other++; else b[p.st]++;
  });
  const withData = products.filter(p => p.grp < 2).length;
  summary.coveragePct = products.length ? Math.round(withData / products.length * 100) : 0;
  summary.withData = withData;

  const top = products.filter(p => p.st === 'pricier')
    .sort((a, b) => b.gap - a.gap).slice(0, 10)
    .map(p => ({ sku: p.sku, n: p.n, img: p.img, comp: p.minBy[0], cp: p.min, p: p.p, gap: p.gap }));

  return {
    now: inp.now || Date.now(),
    lastChecked: lastChecked,
    lastSynced: inp.products.reduce((m, p) => Math.max(m, p.Last_Synced ? new Date(p.Last_Synced).getTime() : 0), 0),
    samePct: samePct,
    competitors: comps.map(c => ({
      name: String(c.Competitor_Name), website: String(c.Website), categories: String(c.Categories || ''), platform: String(c.Platform_Type || ''),
      active: bool_(c.Active), scopeCount: products.filter(p => p.cells[c.Competitor_Name] != null || inScope_(p.cat, c.Categories)).length
    })),
    categories: Object.keys(catCount).map(k => ({ name: k, count: catCount[k] })).sort((a, b) => b.count - a.count),
    products: products,
    summary: summary,
    byCategory: Object.keys(byCat).map(k => byCat[k]).sort((a, b) => (b.pricier + b.cheaper + b.same + b.only_us) - (a.pricier + a.cheaper + a.same + a.only_us)),
    top: top,
    trend: buildTrend_(inp.history, 30),
    unread: (inp.alerts || []).filter(a => !bool_(a.Read)).length
  };
}

/** متوسط الفجوة % يوميًا آخر N يوم (سعرنا vs أرخص منافس متوفر في نفس اليوم) */
function buildTrend_(history, days) {
  const cutoff = Utilities.formatDate ? Utilities.formatDate(new Date(Date.now() - days * 864e5), APP.TZ, 'yyyy-MM-dd') : '';
  const byDay = {};
  (history || []).forEach(h => {
    const d = fmtDay_(h.Date);
    if (d < cutoff) return;
    const day = byDay[d] = byDay[d] || {};
    const s = day[h.SKU] = day[h.SKU] || { ours: null, min: null };
    const price = Number(h.Price);
    if (h.Competitor === APP.GEEKS) s.ours = price;
    else if (bool_(h.In_Stock) && price > 0 && (s.min == null || price < s.min)) s.min = price;
  });
  return Object.keys(byDay).sort().map(d => {
    let sum = 0, n = 0;
    Object.keys(byDay[d]).forEach(sku => {
      const s = byDay[d][sku];
      if (s.ours && s.min) { sum += (s.ours - s.min) / s.min * 100; n++; }
    });
    return { d: d, avg: n ? Math.round(sum / n * 100) / 100 : null, n: n };
  }).filter(x => x.avg != null);
}

/** سلاسل تاريخ منتج واحد: {GEEKS:[{d,p,s}], Compumarts:[...]} */
function buildProductHistory_(history, sku, days) {
  const cutoff = Utilities.formatDate(new Date(Date.now() - days * 864e5), APP.TZ, 'yyyy-MM-dd');
  const out = {};
  (history || []).forEach(h => {
    if (String(h.SKU) !== String(sku)) return;
    const d = fmtDay_(h.Date);
    if (d < cutoff) return;
    (out[h.Competitor] = out[h.Competitor] || []).push({ d: d, p: Number(h.Price), s: bool_(h.In_Stock) });
  });
  Object.keys(out).forEach(k => out[k].sort((a, b) => (a.d < b.d ? -1 : 1)));
  return out;
}

// ═══════════════ Alerts.gs ═══════════════
/**
 * PriceRadar — Alerts.gs
 * التنبيهات: competitor_cheaper | price_drop | price_rise | new_match | back_in_stock
 * + ملخص يومي بالإيميل (اختياري من Settings → email_digest_to).
 */

/**
 * بيحسب التنبيهات من الفرق بين السعر القديم والجديد لمنافس واحد.
 * old = {price, inStock} | null ، nw = {price, inStock} ، ours = سعرنا
 */
function alertsFor_(sku, comp, old, nw, ours, now) {
  const out = [];
  const gapMin = getNum_('alert_gap_pct', 3), chgMin = getNum_('alert_change_pct', 2);
  const row = (type, o, n, gap) => [now, type, sku, comp, o == null ? '' : o, n == null ? '' : n, gap == null ? '' : Math.round(gap * 10) / 10, false];
  const gapOf = pr => (ours - pr) / pr * 100;

  if (!old) {
    out.push(row('new_match', '', nw.price, nw.inStock ? gapOf(nw.price) : null));
  } else {
    if (!old.inStock && nw.inStock) out.push(row('back_in_stock', old.price, nw.price, gapOf(nw.price)));
    if (old.price && nw.price && nw.inStock && old.inStock) {
      const chg = (nw.price - old.price) / old.price * 100;
      if (Math.abs(chg) >= chgMin) out.push(row(chg < 0 ? 'price_drop' : 'price_rise', old.price, nw.price, gapOf(nw.price)));
    }
  }
  // منافس أصبح أرخص مننا (يتنبه مرة عند العبور)
  if (nw.inStock && nw.price && gapOf(nw.price) >= gapMin) {
    const wasCheaper = old && old.inStock && old.price && gapOf(old.price) >= gapMin;
    if (!wasCheaper) out.push(row('competitor_cheaper', old ? old.price : '', nw.price, gapOf(nw.price)));
  }
  return out;
}

function getAlerts(filter) {
  filter = filter || {};
  const names = {};
  readRows_(SHEET.PRODUCTS).forEach(p => names[String(p.SKU)] = p.Name);
  let rows = readRows_(SHEET.ALERTS).map(a => ({
    id: a._row, t: new Date(a.Timestamp).getTime(), type: String(a.Type), sku: String(a.SKU), n: names[String(a.SKU)] || String(a.SKU),
    comp: String(a.Competitor), old: a.Old === '' ? null : Number(a.Old), nw: a.New === '' ? null : Number(a.New),
    gap: a['Gap_%'] === '' ? null : Number(a['Gap_%']), read: bool_(a.Read)
  }));
  if (filter.type) rows = rows.filter(r => r.type === filter.type);
  if (filter.unread) rows = rows.filter(r => !r.read);
  rows.sort((a, b) => b.t - a.t);
  return rows.slice(0, filter.limit || 300);
}

function markAlertsRead(ids) {
  const sh = sh_(SHEET.ALERTS);
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const col = HEADERS.Alerts.indexOf('Read') + 1;
  if (!ids || !ids.length) {
    sh.getRange(2, col, last - 1, 1).setValue(true);
  } else {
    ids.forEach(r => sh.getRange(r, col).setValue(true));
  }
  clearCache_();
  return true;
}

/** إيميل ملخص يومي: أكبر الفجوات + تغييرات آخر 24 ساعة */
function sendDailyDigest() {
  const to = String(getSetting_('email_digest_to') || '').trim();
  if (!to) return 'disabled';
  const agg = buildAggregates_(loadInputs_());
  const alerts = getAlerts({ limit: 400 }).filter(a => Date.now() - a.t < 864e5);
  const fmt = n => n == null ? '—' : Math.round(n).toLocaleString('en-US');
  let h = '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:640px">' +
    '<h2>PriceRadar — ملخص ' + today_() + '</h2>' +
    '<p>أغلى مننا: <b>' + agg.summary.pricier + '</b> • أرخص: <b>' + agg.summary.cheaper + '</b> • نفس السعر: <b>' + agg.summary.same +
    '</b> • إحنا بس: <b>' + agg.summary.only_us + '</b> • محتاج رابط: <b>' + agg.summary.needs_help + '</b></p>' +
    '<h3>أكبر الفجوات (منافس أرخص مننا)</h3><table cellpadding="6" style="border-collapse:collapse;width:100%">';
  agg.top.forEach(t => { h += '<tr style="border-bottom:1px solid #eee"><td>' + t.n + '</td><td>' + t.comp + ' ' + fmt(t.cp) + '</td><td>سعرنا ' + fmt(t.p) + '</td><td style="color:#d62839"><b>+' + t.gap.toFixed(1) + '%</b></td></tr>'; });
  h += '</table><h3>تغييرات آخر 24 ساعة (' + alerts.length + ')</h3><ul>';
  alerts.slice(0, 25).forEach(a => { h += '<li>' + a.type + ' — ' + a.n + ' — ' + a.comp + ' ' + fmt(a.old) + ' ← ' + fmt(a.nw) + '</li>'; });
  h += '</ul></div>';
  MailApp.sendEmail({ to: to, subject: 'PriceRadar — ملخص الأسعار ' + today_(), htmlBody: h });
  return 'sent';
}

// ═══════════════ Triggers.gs ═══════════════
/**
 * PriceRadar — Triggers.gs
 * الجدولة + طابور الفحص (Queue) بحالة محفوظة في PropertiesService.
 *
 *   runDailyCheck()  ← Trigger الفحص اليومي (ساعات refresh_hours)
 *   continueCheck()  ← Trigger الاستكمال (بيتجدول تلقائيًا لو الوقت قرب يخلص)
 *   syncProductsJob()← مزامنة منتجاتنا كل N ساعة
 *   startCheck()     ← زرار "Run check now" (بيبدأ في الخلفية)
 *
 * مراحل الفحص: sync → prices → discover → done
 * LockService بيمنع تشغيلين يتداخلوا. أي فشل بيتسجل في Logs بس (مفيش صفوف فاضية).
 */

const STATE_KEY = 'CHECK_STATE';

/* ======================= الحالة ======================= */

function getState_() {
  const raw = PropertiesService.getScriptProperties().getProperty(STATE_KEY);
  const base = { status: 'idle', phase: 'idle', i: 0, total: 0, done: 0, failed: 0, found: 0, dTotal: 0, dDone: 0, startedAt: 0, finishedAt: 0, error: '' };
  try { return raw ? Object.assign(base, JSON.parse(raw)) : base; } catch (e) { return base; }
}
function setState_(s) { PropertiesService.getScriptProperties().setProperty(STATE_KEY, JSON.stringify(s)); }

function getProgress() {
  const s = getState_();
  let pct = 0;
  if (s.status === 'running') {
    if (s.phase === 'sync') pct = 2;
    else if (s.phase === 'prices') pct = 5 + (s.total ? s.i / s.total : 1) * 70;
    else if (s.phase === 'discover') pct = 75 + (s.dTotal ? s.dDone / s.dTotal : 1) * 24;
  } else if (s.finishedAt) pct = 100;
  s.pct = Math.min(100, Math.round(pct));
  return s;
}

/* ======================= نقاط الدخول ======================= */

/** Trigger الفحص اليومي */
function runDailyCheck() {
  const s = getState_();
  const stale = s.status === 'running' && Date.now() - s.startedAt > 45 * 60000;
  if (s.status !== 'running' || stale) beginCheck_();
  runCheckStep_();
}

/** زرار Run check now (من الداشبورد) — بيبدأ في الخلفية ويرجّع فورًا */
function startCheck() {
  const s = getState_();
  if (s.status === 'running' && Date.now() - s.startedAt < 45 * 60000) return getProgress();
  beginCheck_();
  scheduleContinuation_(0.25);
  return getProgress();
}

/** Trigger الاستكمال */
function continueCheck() { runCheckStep_(); }

/** مزامنة منتجاتنا فقط (Trigger كل N ساعة) */
function syncProductsJob() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(APP.LOCK_WAIT_MS)) return;
  try { syncOurProducts(); } catch (e) { log_('ERROR', 'syncProductsJob', e.message); } finally { lock.releaseLock(); }
}

function digestJob() { try { sendDailyDigest(); } catch (e) { log_('ERROR', 'digestJob', e.message); } }

function beginCheck_() {
  deleteContinuations_();
  // أول فحص في التاريخ (Prices فاضي) → من غير تنبيهات عشان ما نغرقش التنبيهات
  const seed = sh_(SHEET.PRICES).getLastRow() < 2;
  setState_({ status: 'running', phase: 'sync', i: 0, total: 0, done: 0, failed: 0, found: 0, dTotal: 0, dDone: 0, startedAt: Date.now(), finishedAt: 0, error: '', seed: seed });
}

/* ======================= المحرك ======================= */

function runCheckStep_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(APP.LOCK_WAIT_MS)) return;
  const t0 = Date.now();
  const left = () => APP.BUDGET_MS - (Date.now() - t0);
  deleteContinuations_();
  let s = getState_();
  if (s.status !== 'running') { lock.releaseLock(); return; }
  try {
    if (s.phase === 'sync') {
      syncOurProducts();
      s.phase = 'prices'; s.i = 0; s.total = 0; setState_(s);
    }
    if (s.phase === 'prices') {
      s = stepPrices_(s, left);
      if (s.i >= s.total) { s.phase = 'discover'; s.dDone = 0; s.dTotal = 0; setState_(s); }
    }
    if (s.phase === 'discover' && left() > 25000) {
      s = stepDiscover_(s, left);
    }
    if (s.phase === 'finished') {
      s.status = 'idle'; s.phase = 'idle'; s.finishedAt = Date.now(); setState_(s);
      pruneHistory_(); clearCache_();
      log_('INFO', 'runCheckStep_', 'انتهى الفحص — اتقرأ ' + s.done + ' • فشل ' + s.failed + ' • مطابقات جديدة ' + s.found);
    } else {
      setState_(s); clearCache_();
      scheduleContinuation_(Math.max(1, getNum_('check_interval_minutes', APP.CONTINUE_AFTER_MIN)));
    }
  } catch (e) {
    s.error = e.message; setState_(s);
    log_('ERROR', 'runCheckStep_', e.message);
    scheduleContinuation_(5);   // نحاول تاني بعد شوية
  } finally { lock.releaseLock(); }
}

function scheduleContinuation_(minutes) {
  deleteContinuations_();
  ScriptApp.newTrigger('continueCheck').timeBased().after(Math.round(minutes * 60000)).create();
}
function deleteContinuations_() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'continueCheck') ScriptApp.deleteTrigger(t); });
}

/* ======================= سياق الكتابة المشترك ======================= */

function loadCtx_(seed) {
  const products = {}, comps = {}, priceRows = [], priceMap = {};
  readRows_(SHEET.PRODUCTS).forEach(p => products[String(p.SKU)] = p);
  readRows_(SHEET.COMPETITORS).forEach(c => { if (c.Competitor_Name) comps[c.Competitor_Name] = c; });
  readRows_(SHEET.PRICES).forEach(p => { priceRows.push([p.SKU, p.Competitor, p.Price, p.In_Stock, p.Checked_At]); priceMap[p.SKU + '|' + p.Competitor] = priceRows.length - 1; });
  return { products: products, comps: comps, priceRows: priceRows, priceMap: priceMap, seed: !!seed,
    alerts: [], hist: [], checked: {}, logs: [], done: 0, failed: 0 };
}

/** يطبّق نتائج checkMatches_ على السياق (من غير كتابة) */
function applyChecks_(ctx, results) {
  const now = new Date();
  results.forEach(x => {
    const m = x.match, r = x.result;
    const key = m.sku + '|' + m.competitor;
    const idx = ctx.priceMap[key];
    const oldRow = idx != null ? ctx.priceRows[idx] : null;
    const old = oldRow ? { price: Number(oldRow[2]), inStock: bool_(oldRow[3]) } : null;
    if (r && r.price) {
      ctx.done++;
      const row = [m.sku, m.competitor, r.price, r.inStock, now];
      if (idx != null) ctx.priceRows[idx] = row; else { ctx.priceRows.push(row); ctx.priceMap[key] = ctx.priceRows.length - 1; }
      ctx.hist.push([m.sku, m.competitor, r.price, r.inStock]);
      if (m.row) ctx.checked[m.row] = now;
      const p = ctx.products[m.sku];
      if (!ctx.seed && p) alertsFor_(m.sku, m.competitor, old, { price: r.price, inStock: r.inStock }, Number(p.Our_Price), now).forEach(a => ctx.alerts.push(a));
    } else if (r && r.price == null && !r.inStock && r.hasAvail && old) {
      // الصفحة بتقول "نفذ" ومفيش سعر ظاهر → نحتفظ بآخر سعر ونعلّم Out of stock
      ctx.done++;
      ctx.priceRows[idx] = [m.sku, m.competitor, old.price, false, now];
      ctx.hist.push([m.sku, m.competitor, old.price, false]);
      if (m.row) ctx.checked[m.row] = now;
    } else {
      ctx.failed++;
      ctx.logs.push([now, 'WARN', 'check', m.competitor + ' | ' + m.sku + ' | ' + (x.error || 'failed') + ' | ' + m.url.slice(0, 120)]);
    }
  });
}

/** يكتب كل اللي اتجمّع في السياق (Prices + History + Alerts + Last_Checked + Logs) */
function flushCtx_(ctx) {
  writeAll_(SHEET.PRICES, ctx.priceRows);
  upsertHistory_(ctx.hist); ctx.hist = [];
  appendRows_(SHEET.ALERTS, ctx.alerts); ctx.alerts = [];
  appendRows_(SHEET.LOGS, ctx.logs.slice(0, 200)); ctx.logs = [];
  const rows = Object.keys(ctx.checked);
  if (rows.length) {
    const sh = sh_(SHEET.MATCHES), col = HEADERS.Matches.indexOf('Last_Checked') + 1, last = sh.getLastRow();
    const rng = sh.getRange(2, col, last - 1, 1), vals = rng.getValues();
    rows.forEach(r => { vals[Number(r) - 2][0] = ctx.checked[r]; });
    rng.setValues(vals); ctx.checked = {};
  }
}

function validMatch_(m, minConf) {
  if (!m.Competitor_URL || !/^https?:\/\//.test(String(m.Competitor_URL))) return false;
  return String(m.Match_Type) === 'manual' || Number(m.Match_Confidence) >= minConf;
}

/* ======================= مرحلة الأسعار ======================= */

function stepPrices_(s, left) {
  const minConf = getNum_('match_min_confidence', 0.8);
  const ctx = loadCtx_(s.seed);
  const list = readRows_(SHEET.MATCHES)
    .filter(m => ctx.products[String(m.SKU)] && ctx.comps[m.Competitor] && bool_(ctx.comps[m.Competitor].Active) && validMatch_(m, minConf))
    .map(m => ({ sku: String(m.SKU), competitor: m.Competitor, url: String(m.Competitor_URL), platform: ctx.comps[m.Competitor].Platform_Type, row: m._row }));
  s.total = list.length;
  const group = Math.max(1, Math.round(getNum_('batch_size', 12))) * 3;
  while (s.i < list.length && left() > 40000) {
    const chunk = list.slice(s.i, s.i + group);
    applyChecks_(ctx, checkMatches_(chunk));
    flushCtx_(ctx);
    s.i += chunk.length; s.done += 0; setState_(s);
  }
  s.done = (s.done || 0) + ctx.done; s.failed = (s.failed || 0) + ctx.failed;
  return s;
}

/* ======================= مرحلة الاكتشاف ======================= */

function stepDiscover_(s, left) {
  const minConf = getNum_('match_min_confidence', 0.8);
  const redays = getNum_('rediscover_days', 7);
  const cutoff = Date.now() - redays * 864e5;
  const comps = readRows_(SHEET.COMPETITORS).filter(c => bool_(c.Active) && (c.Platform_Type === 'shopify' || c.Platform_Type === 'woocommerce'));
  const prodSheet = sh_(SHEET.PRODUCTS);
  const dcol = HEADERS.Products.indexOf('Discovered_At') + 1;
  const matches = readRows_(SHEET.MATCHES);
  const keys = {}; matches.forEach(m => keys[m.SKU + '|' + m.Competitor] = 1);

  const todo = readRows_(SHEET.PRODUCTS).filter(p => !p.Discovered_At || new Date(p.Discovered_At).getTime() < cutoff)
    .filter(p => comps.some(c => inScope_(p.Category, c.Categories) && !keys[p.SKU + '|' + c.Competitor_Name]));
  if (!s.dTotal) s.dTotal = todo.length + s.dDone;
  if (!comps.length || !todo.length) { s.phase = 'finished'; return s; }

  const ctx = loadCtx_(s.seed);
  const step = 8;
  for (let i = 0; i < todo.length && left() > 40000; i += step) {
    const chunk = todo.slice(i, i + step);
    const newRows = discoverForProducts_(chunk, comps, keys);
    if (newRows.length) {
      appendRows_(SHEET.MATCHES, newRows);
      s.found += newRows.length;
      // نجيب سعر المطابقات الموثوقة فورًا
      const fresh = newRows.map((r, k) => ({ r: r })).filter(x => Number(x.r[4]) >= minConf)
        .map(x => ({ sku: String(x.r[0]), competitor: x.r[1], url: x.r[2], platform: (readCompPlatform_(comps, x.r[1])), row: 0 }));
      if (fresh.length) { applyChecks_(ctx, checkMatches_(fresh)); flushCtx_(ctx); }
    }
    // علّم المنتجات دي اتبحث عنها
    const now = new Date();
    chunk.forEach(p => prodSheet.getRange(p._row, dcol).setValue(now));
    s.dDone += chunk.length; s.done += ctx.done; ctx.done = 0; setState_(s);
  }
  const remaining = readRows_(SHEET.PRODUCTS).filter(p => !p.Discovered_At || new Date(p.Discovered_At).getTime() < cutoff)
    .filter(p => comps.some(c => inScope_(p.Category, c.Categories) && !keys[p.SKU + '|' + c.Competitor_Name]));
  if (!remaining.length) s.phase = 'finished';
  return s;
}
function readCompPlatform_(comps, name) { const c = comps.filter(x => x.Competitor_Name === name)[0]; return c ? c.Platform_Type : 'jsonld'; }

/* ======================= installTriggers ======================= */

/** شغّلها مرة واحدة (أو كل ما تغيّر ساعات الفحص في Settings) */
function installTriggers() {
  resetSettingsCache_();
  const mine = ['runDailyCheck', 'continueCheck', 'syncProductsJob', 'digestJob'];
  ScriptApp.getProjectTriggers().forEach(t => { if (mine.indexOf(t.getHandlerFunction()) > -1) ScriptApp.deleteTrigger(t); });

  String(getSetting_('refresh_hours')).split(',').map(x => parseInt(x, 10)).filter(h => h >= 0 && h <= 23).forEach(h =>
    ScriptApp.newTrigger('runDailyCheck').timeBased().atHour(h).nearMinute(5).everyDays(1).inTimezone(APP.TZ).create());

  const every = Math.round(getNum_('product_sync_every_hours', 6));
  if (every > 0) ScriptApp.newTrigger('syncProductsJob').timeBased().everyHours(every).create();

  if (String(getSetting_('email_digest_to') || '').trim())
    ScriptApp.newTrigger('digestJob').timeBased().atHour(Math.round(getNum_('digest_hour', 9))).nearMinute(40).everyDays(1).inTimezone(APP.TZ).create();

  log_('INFO', 'installTriggers', 'تم ضبط الـ Triggers: فحص ' + getSetting_('refresh_hours') + ' + مزامنة كل ' + every + ' ساعة');
}

// ═══════════════ Api.gs ═══════════════
/**
 * PriceRadar — Api.gs
 * Web App + الدوال اللي الداشبورد بتناديها بـ google.script.run
 * (كلها بترجّع بيانات مجمّعة — مش الشيت كله — والـ dashboard متكاشّة CacheService).
 */

function doGet() {
  ensureReady_();
  return HtmlService.createHtmlOutput(PAGE_HTML)
    .setTitle('PriceRadar — Geeks Store')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
/**
 * أول مرة الداشبورد تتفتح: بتظبط الـ Triggers لوحدها، ولو Products فاضي بتبدأ أول فحص في الخلفية.
 * (يعني مش لازم تشغّل setup() ولا installTriggers() بإيدك.)
 */
function ensureReady_() {
  try {
    const p = PropertiesService.getScriptProperties();
    if (!p.getProperty('TRIGGERS_OK')) { installTriggers(); p.setProperty('TRIGGERS_OK', '1'); }
    // منافس جديد من غير Platform_Type → نكتشف نوع منصته تلقائيًا
    if (readRows_(SHEET.COMPETITORS).some(c => c.Competitor_Name && !c.Platform_Type)) detectAllPlatforms_();
    if (sh_(SHEET.PRODUCTS).getLastRow() < 2 && getState_().status !== 'running') startCheck();
  } catch (e) { log_('ERROR', 'ensureReady_', e.message); }
}
function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

/* ======================= قراءة ======================= */

function loadInputs_() {
  resetSettingsCache_();
  return {
    products: readRows_(SHEET.PRODUCTS), competitors: readRows_(SHEET.COMPETITORS), matches: readRows_(SHEET.MATCHES),
    prices: readRows_(SHEET.PRICES), history: readRows_(SHEET.HISTORY), alerts: readRows_(SHEET.ALERTS),
    samePct: getNum_('same_price_threshold_pct', 0.5), minConf: getNum_('match_min_confidence', 0.8), now: Date.now()
  };
}

/** كل بيانات الداشبورد في استدعاء واحد (متكاشّة 5 دقايق) */
function getDashboard(force) {
  let d = force ? null : cacheGet_(APP.CACHE_KEY);
  if (!d) {
    d = buildAggregates_(loadInputs_());
    d.history = null;
    cachePut_(APP.CACHE_KEY, d);
  }
  d.progress = getProgress();
  d.unread = readRows_(SHEET.ALERTS).filter(a => !bool_(a.Read)).length;
  d.settings = { same: getNum_('same_price_threshold_pct', 0.5), gap: getNum_('alert_gap_pct', 3), hours: getSetting_('refresh_hours') };
  return d;
}

/** تاريخ منتج واحد (للـ Drawer) */
function getProductHistory(sku) {
  return buildProductHistory_(readRows_(SHEET.HISTORY), sku, 90);
}

/* ======================= كتابة من الداشبورد ======================= */

/** إضافة/تعديل رابط يدوي + ملاحظة (Match_Type = manual — محمي من أي تحديث تلقائي) */
function saveManualMatch(sku, competitor, url, note) {
  sku = String(sku); url = String(url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('الرابط لازم يبدأ بـ http:// أو https://');
  const comp = readRows_(SHEET.COMPETITORS).filter(c => c.Competitor_Name === competitor)[0];
  if (!comp) throw new Error('المنافس مش موجود: ' + competitor);
  const sh = sh_(SHEET.MATCHES);
  const ex = readRows_(SHEET.MATCHES).filter(m => String(m.SKU) === sku && m.Competitor === competitor)[0];
  const row = [sku, competitor, url, 'manual', 1, String(note || ''), ''];
  if (ex) sh.getRange(ex._row, 1, 1, row.length).setValues([row]); else appendRows_(SHEET.MATCHES, [row]);
  // نجيب سعره فورًا
  const out = refreshSku_(sku);
  clearCache_();
  return out;
}

function deleteManualMatch(sku, competitor) {
  const ex = readRows_(SHEET.MATCHES).filter(m => String(m.SKU) === String(sku) && m.Competitor === competitor)[0];
  if (ex) sh_(SHEET.MATCHES).deleteRow(ex._row);
  const pr = readRows_(SHEET.PRICES).filter(p => String(p.SKU) === String(sku) && p.Competitor === competitor)[0];
  if (pr) sh_(SHEET.PRICES).deleteRow(pr._row);
  clearCache_();
  return true;
}

/** "Update this product": يعيد فحص كل مطابقات المنتج + يدوّر على اللي ناقص */
function updateProduct(sku) {
  const out = refreshSku_(String(sku), true);
  clearCache_();
  return out;
}

function refreshSku_(sku, discover) {
  const minConf = getNum_('match_min_confidence', 0.8);
  const ctx = loadCtx_(false);
  const p = ctx.products[sku];
  if (!p) throw new Error('المنتج مش متراقب حاليًا (غالبًا Out of stock)');
  let matches = readRows_(SHEET.MATCHES).filter(m => String(m.SKU) === sku);
  let found = 0;
  if (discover) {
    const comps = Object.keys(ctx.comps).map(k => ctx.comps[k]).filter(c => bool_(c.Active));
    const keys = {}; matches.forEach(m => keys[m.SKU + '|' + m.Competitor] = 1);
    const nr = discoverForProducts_([p], comps, keys);
    if (nr.length) { appendRows_(SHEET.MATCHES, nr); found = nr.length; }
    matches = readRows_(SHEET.MATCHES).filter(m => String(m.SKU) === sku);
    const dcol = HEADERS.Products.indexOf('Discovered_At') + 1;
    sh_(SHEET.PRODUCTS).getRange(p._row, dcol).setValue(new Date());
  }
  const list = matches.filter(m => ctx.comps[m.Competitor] && validMatch_(m, minConf))
    .map(m => ({ sku: sku, competitor: m.Competitor, url: String(m.Competitor_URL), platform: ctx.comps[m.Competitor].Platform_Type, row: m._row }));
  applyChecks_(ctx, checkMatches_(list));
  flushCtx_(ctx);
  return { checked: list.length, ok: ctx.done, failed: ctx.failed, found: found };
}

function syncNow() { const lock = LockService.getScriptLock(); if (!lock.tryLock(5000)) throw new Error('فيه فحص شغال، جرّب بعد دقيقة'); try { return syncOurProducts(); } finally { lock.releaseLock(); } }

/** التأكد من موقع منافس قبل الحفظ (بيرجّع نوع المنصة) */
function verifyCompetitor(website) {
  website = String(website || '').trim();
  if (!/^https?:\/\//i.test(website)) throw new Error('اكتب الرابط كامل (https://...)');
  const r = fetchBatch_([req_(website)])[0];
  if (!r || r.getResponseCode() >= 400) throw new Error('الموقع مش بيرد' + (r ? ' (HTTP ' + r.getResponseCode() + ')' : ''));
  return { ok: true, platform: detectPlatform_(website) };
}

function addCompetitor(name, website, categories) {
  name = String(name || '').trim();
  if (!name) throw new Error('اكتب اسم المنافس');
  const v = verifyCompetitor(website);
  if (readRows_(SHEET.COMPETITORS).some(c => String(c.Competitor_Name).toLowerCase() === name.toLowerCase())) throw new Error('المنافس موجود بالفعل');
  appendRows_(SHEET.COMPETITORS, [[name, String(website).replace(/\/+$/, ''), String(categories || 'All'), v.platform, true]]);
  clearCache_();
  return { platform: v.platform };
}

function updateCompetitor(name, categories, active) {
  const c = readRows_(SHEET.COMPETITORS).filter(x => x.Competitor_Name === name)[0];
  if (!c) throw new Error('مش موجود');
  const sh = sh_(SHEET.COMPETITORS);
  sh.getRange(c._row, 3).setValue(String(categories || 'All'));
  sh.getRange(c._row, 5).setValue(!!active);
  clearCache_();
  return true;
}

function saveSettings(obj) {
  const sh = sh_(SHEET.SETTINGS);
  const last = sh.getLastRow();
  const rows = last > 1 ? sh.getRange(2, 1, last - 1, 3).getValues() : [];
  Object.keys(obj || {}).forEach(k => {
    const r = rows.filter(x => x[0] === k)[0];
    if (r) r[1] = obj[k]; else rows.push([k, obj[k], '']);
  });
  if (rows.length) sh.getRange(2, 1, rows.length, 3).setValues(rows);
  resetSettingsCache_(); clearCache_();
  return true;
}

function runCheckNow() { return startCheck(); }
function getAlertsApi(filter) { return getAlerts(filter); }
function markAllAlertsRead(ids) { return markAlertsRead(ids); }

// ═══════════════ Dashboard (HTML) ═══════════════
var PAGE_HTML = "<!DOCTYPE html>\n<html lang=\"en\" dir=\"ltr\" data-theme=\"dark\">\n<head>\n<base target=\"_top\">\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>PriceRadar — Geeks Store</title>\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n<link href=\"https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap\" rel=\"stylesheet\">\n<style>\n:root{\n  --bg:#0a0c09; --bg2:#0f120d; --surface:#141811; --surface2:#1a1f15; --surface3:#21271a;\n  --line:#242b1d; --line2:#1b2116;\n  --text:#eef3e6; --muted:#a7b09a; --faint:#707a62;\n  --lime:#c6f432; --lime-d:#a8d21c; --lime-bg:rgba(198,244,50,.10); --on-lime:#12180a;\n  --only:#4fd6c4; --only-bg:rgba(79,214,196,.12);\n  --same:#8db4ff; --same-bg:rgba(141,180,255,.12);\n  --cheap:#9be33a; --cheap-bg:rgba(155,227,58,.12);\n  --pricey:#ff6a7a; --pricey-bg:rgba(255,106,122,.12);\n  --other:#6f7864; --other-bg:rgba(111,120,100,.18);\n  --warn:#f5b84a; --warn-bg:rgba(245,184,74,.13);\n  --shadow:0 1px 0 rgba(255,255,255,.03) inset,0 14px 30px -18px rgba(0,0,0,.8);\n  --radius:16px; --mono:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;\n}\n:root[data-theme=\"light\"]{\n  --bg:#f3f5ee; --bg2:#eceee4; --surface:#ffffff; --surface2:#f7f9f1; --surface3:#eef1e4;\n  --line:#e0e5d2; --line2:#eaeedd; --text:#151a0e; --muted:#566046; --faint:#8a947a;\n  --lime:#7fb800; --lime-d:#6aa000; --lime-bg:rgba(127,184,0,.12); --on-lime:#fff;\n  --only:#0b9b8a; --only-bg:rgba(11,155,138,.1); --same:#3b6fd8; --same-bg:rgba(59,111,216,.1);\n  --cheap:#3f9a07; --cheap-bg:rgba(63,154,7,.1); --pricey:#d62f45; --pricey-bg:rgba(214,47,69,.1);\n  --other:#7c8570; --other-bg:rgba(124,133,112,.15); --warn:#b27407; --warn-bg:rgba(178,116,7,.12);\n  --shadow:0 1px 2px rgba(20,26,10,.05),0 10px 24px -14px rgba(20,26,10,.18);\n}\n*{box-sizing:border-box}\nhtml{-webkit-text-size-adjust:100%;scroll-behavior:smooth}\nbody{margin:0;background:var(--bg);color:var(--text);font-family:'IBM Plex Sans Arabic','Cairo',system-ui,-apple-system,'Segoe UI',Tahoma,sans-serif;font-size:14.5px;line-height:1.55;\n  background-image:radial-gradient(1200px 500px at 85% -10%,rgba(198,244,50,.07),transparent 60%),radial-gradient(900px 400px at 0% 0%,rgba(79,214,196,.05),transparent 55%);background-attachment:fixed}\nbutton,input,select,textarea{font:inherit;color:inherit}\na{color:var(--lime);text-decoration:none}a:hover{text-decoration:underline}\n.num{font-family:var(--mono);font-variant-numeric:tabular-nums;direction:ltr;unicode-bidi:isolate;display:inline-block}\ndiv.num{display:block}\n:focus-visible{outline:2px solid var(--lime);outline-offset:2px;border-radius:8px}\nsvg{flex:none}\n[hidden]{display:none!important}\n\n/* ===== header ===== */\n.top{position:sticky;top:0;z-index:30;background:color-mix(in srgb,var(--bg) 80%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}\n.top-in{max-width:1560px;margin:0 auto;padding:10px 24px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}\n.logo{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;letter-spacing:-.3px}\n.logo .mark{width:36px;height:36px;border-radius:11px;background:var(--lime);display:grid;place-items:center;color:var(--on-lime);box-shadow:0 8px 22px -8px var(--lime)}\n.logo small{display:block;font-weight:500;font-size:11.5px;color:var(--faint);margin-top:-4px;letter-spacing:0}\n.nav{display:flex;gap:4px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:4px;margin-inline-start:10px}\n.nav button{background:none;border:0;border-radius:10px;padding:7px 16px;cursor:pointer;color:var(--muted);font-weight:600;display:flex;align-items:center;gap:8px;transition:.15s}\n.nav button:hover{color:var(--text)}\n.nav button[aria-selected=\"true\"]{background:var(--lime);color:var(--on-lime)}\n.badge{background:var(--pricey);color:#fff;border-radius:99px;font-size:11px;padding:0 7px;min-width:20px;text-align:center;font-weight:700;line-height:18px}\n.nav button[aria-selected=\"true\"] .badge{background:var(--on-lime);color:var(--lime)}\n.sp{flex:1}\n.btn{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);background:var(--surface);border-radius:12px;padding:8px 14px;cursor:pointer;font-weight:600;font-size:13.5px;transition:.15s;white-space:nowrap}\n.btn:hover{border-color:var(--lime);color:var(--lime)}\n.btn.primary{background:var(--lime);border-color:var(--lime);color:var(--on-lime)}\n.btn.primary:hover{filter:brightness(1.07);color:var(--on-lime)}\n.btn.ghost{background:transparent}\n.btn.sm{padding:5px 10px;font-size:12.5px;border-radius:9px}\n.btn.icon{padding:8px 10px}\n.btn[disabled]{opacity:.55;cursor:progress}\n.spin{width:14px;height:14px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:rot .7s linear infinite;display:none}\n.busy .spin{display:inline-block}\n@keyframes rot{to{transform:rotate(360deg)}}\n.pillbar{display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:6px 12px;font-size:12.5px;color:var(--muted)}\n.pillbar .bar{width:110px;height:6px;border-radius:99px;background:var(--surface3);overflow:hidden}\n.pillbar .bar i{display:block;height:100%;background:var(--lime);border-radius:99px;transition:width .6s}\n.dot{width:8px;height:8px;border-radius:50%;background:var(--lime);animation:pulse 1.8s infinite}\n@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(198,244,50,.5)}70%{box-shadow:0 0 0 8px transparent}100%{box-shadow:0 0 0 0 transparent}}\n\n/* ===== layout ===== */\nmain{max-width:1560px;margin:0 auto;padding:22px 24px 90px}\n.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow)}\n.card-h{display:flex;align-items:center;gap:10px;padding:16px 18px 8px}\n.card-h h2{margin:0;font-size:15px;font-weight:700}\n.card-h .sub{color:var(--faint);font-size:12.5px}\n.grid{display:grid;gap:16px}\n.sec-t{font-size:12.5px;font-weight:700;letter-spacing:.4px;color:var(--faint);text-transform:uppercase;margin:24px 2px 10px}\n.view[hidden]{display:none}\n\n/* ===== overview ===== */\n.g-info{grid-template-columns:repeat(5,minmax(0,1fr))}\n.info{padding:14px 16px}\n.info .k{font-size:12.5px;color:var(--faint);display:flex;align-items:center;gap:7px}\n.info .v{font-size:24px;font-weight:700;letter-spacing:-.5px;margin-top:4px;line-height:1.2}\n.info .v small{font-size:13px;color:var(--faint);font-weight:500;margin-inline-start:6px}\n.info .meter{height:6px;border-radius:99px;background:var(--surface3);margin-top:10px;overflow:hidden}\n.info .meter i{display:block;height:100%;background:var(--lime);border-radius:99px;transition:width .6s}\n.g-pos{grid-template-columns:repeat(4,minmax(0,1fr))}\n.pos{position:relative;padding:20px 20px 18px;cursor:pointer;text-align:start;overflow:hidden;border:1px solid var(--line);transition:.18s;display:block;width:100%}\n.pos:hover{transform:translateY(-3px);border-color:var(--c)}\n.pos::before{content:\"\";position:absolute;inset-inline-start:0;top:0;bottom:0;width:4px;background:var(--c)}\n.pos::after{content:\"\";position:absolute;inset-inline-end:-30px;top:-30px;width:120px;height:120px;border-radius:50%;background:var(--c);opacity:.08}\n.pos .t{font-weight:700;font-size:14px;display:flex;align-items:center;gap:8px;color:var(--c)}\n.pos .big{display:block;font-size:46px;font-weight:700;letter-spacing:-2px;line-height:1.05;margin:10px 0 4px}\n.pos .d{color:var(--muted);font-size:13px;display:block;direction:rtl;text-align:left;padding-inline-end:46px;line-height:1.5}\n.pos .pct{position:absolute;inset-inline-end:16px;top:18px;font-size:13px;color:var(--faint)}\n.g-two{grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);margin-top:16px}\n.g-two.b{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}\n.gaps{list-style:none;margin:0;padding:4px 10px 12px}\n.gap-i{display:grid;grid-template-columns:28px 44px 1fr auto;gap:12px;align-items:center;padding:9px 8px;border-radius:12px;cursor:pointer}\n.gap-i:hover{background:var(--surface2)}\n.gap-i .rk{color:var(--faint);font-size:12.5px;font-weight:700;text-align:center}\n.gap-i b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.gap-i .m{min-width:0} .gap-i .m span{font-size:12.5px;color:var(--muted)}\n.gap-i .r{text-align:end}\n.gap-pct{color:var(--pricey);font-weight:700;font-size:15px}\n.thumb{width:44px;height:44px;border-radius:11px;background:var(--surface3) center/cover no-repeat;border:1px solid var(--line);flex:none}\n.empty{padding:34px 18px;text-align:center;color:var(--faint)}\n.chart-box{padding:4px 18px 18px}\n.legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--muted);padding:0 18px 4px}\n.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-inline-end:6px;vertical-align:-1px}\n.cbar{display:grid;grid-template-columns:130px 1fr 44px;gap:10px;align-items:center;margin:9px 0;cursor:pointer}\n.cbar:hover .nm{color:var(--lime)}\n.cbar .nm{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.cbar .bar{display:flex;height:14px;border-radius:99px;overflow:hidden;background:var(--surface3);gap:2px}\n.cbar .bar span{display:block;min-width:3px}\n.cbar .ct{font-size:12.5px;color:var(--faint);text-align:end}\n\n.ar{font-family:'IBM Plex Sans Arabic','Cairo','Segoe UI',Tahoma,sans-serif;direction:rtl;unicode-bidi:isolate;display:inline-block;font-size:.97em}\n.sec-t .ar,.card-h .sub .ar{letter-spacing:0;text-transform:none}\n.empty .ar,.hint .ar,.info .ar,.pos .ar{color:var(--muted)}\n\n/* ===== pills ===== */\n.pill{display:inline-flex;align-items:center;gap:6px;border-radius:99px;padding:2px 10px;font-size:12px;font-weight:700;white-space:nowrap}\n.pill.only_us{background:var(--only-bg);color:var(--only)}\n.pill.same{background:var(--same-bg);color:var(--same)}\n.pill.cheaper{background:var(--cheap-bg);color:var(--cheap)}\n.pill.pricier{background:var(--pricey-bg);color:var(--pricey)}\n.pill.not_checked{background:var(--other-bg);color:var(--muted)}\n.pill.needs_help{background:var(--warn-bg);color:var(--warn)}\n.pill.ok{background:var(--cheap-bg);color:var(--cheap)} .pill.oos{background:var(--other-bg);color:var(--muted)}\n\n/* ===== products ===== */\n.cats{display:flex;gap:6px;flex-wrap:wrap;padding:14px 16px 0}\n.cat{border:1px solid var(--line);background:var(--surface);border-radius:99px;padding:6px 14px;cursor:pointer;font-weight:600;font-size:13px;color:var(--muted);transition:.15s}\n.cat:hover{border-color:var(--lime);color:var(--text)}\n.cat[aria-pressed=\"true\"]{background:var(--lime);border-color:var(--lime);color:var(--on-lime)}\n.cat em{font-style:normal;opacity:.7;margin-inline-start:7px;font-size:12px}\n.tool{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:14px 16px}\n.search{position:relative;flex:1;min-width:230px;max-width:440px}\n.search input{width:100%;background:var(--surface2);border:1px solid var(--line);border-radius:12px;padding:9px 38px 9px 12px;outline:none}\n[dir=\"rtl\"] .search input{padding:9px 12px 9px 38px}\n.search input:focus{border-color:var(--lime);box-shadow:0 0 0 3px var(--lime-bg)}\n.search svg{position:absolute;inset-inline-end:12px;top:50%;transform:translateY(-50%);color:var(--faint)}\n.sel{background:var(--surface2);border:1px solid var(--line);border-radius:12px;padding:8px 10px;cursor:pointer;max-width:210px}\n.sel option{background:var(--surface)}\n.chips{display:flex;gap:6px;flex-wrap:wrap;padding:0 16px 14px}\n.chip{border:1px solid var(--line);background:transparent;border-radius:99px;padding:5px 12px;cursor:pointer;font-size:13px;font-weight:600;color:var(--muted);display:inline-flex;align-items:center;gap:7px;transition:.15s}\n.chip:hover{border-color:var(--c,var(--lime))}\n.chip[aria-pressed=\"true\"]{background:color-mix(in srgb,var(--c,var(--lime)) 16%,transparent);border-color:var(--c,var(--lime));color:var(--c,var(--lime))}\n.chip em{font-style:normal;opacity:.8;font-size:12px}\n.tbl-wrap{overflow:auto;border-top:1px solid var(--line);max-height:calc(100vh - 290px);min-height:240px}\ntable.t{border-collapse:separate;border-spacing:0;width:100%;font-size:13.5px}\ntable.t th{position:sticky;top:0;z-index:3;background:var(--surface2);font-size:12px;color:var(--faint);font-weight:700;text-align:start;padding:10px 12px;border-bottom:1px solid var(--line);white-space:nowrap}\ntable.t th button{background:none;border:0;padding:0;font:inherit;color:inherit;cursor:pointer}\ntable.t th button:hover,table.t th .on{color:var(--lime)}\ntable.t td{padding:10px 12px;border-bottom:1px solid var(--line2);vertical-align:middle;white-space:nowrap}\ntable.t tr:hover td{background:var(--surface2)}\ntable.t td.c-prod,table.t th.c-prod{position:sticky;inset-inline-start:0;z-index:2;background:var(--surface);min-width:300px;max-width:340px;white-space:normal;box-shadow:inset -1px 0 0 var(--line2)}\n[dir=\"rtl\"] table.t td.c-prod,[dir=\"rtl\"] table.t th.c-prod{box-shadow:inset 1px 0 0 var(--line2)}\ntable.t th.c-prod{z-index:4;background:var(--surface2)}\ntable.t tr:hover td.c-prod{background:var(--surface2)}\n.prod{display:flex;gap:12px;align-items:center;cursor:pointer}\n.prod .tt{min-width:0}\n.prod b{display:block;font-weight:600;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}\n.prod span{font-size:12px;color:var(--faint)}\n.grp-row td{background:var(--bg2)!important;font-size:11.5px;font-weight:700;color:var(--faint);letter-spacing:.4px;padding:6px 12px;text-transform:uppercase}\n.price{font-weight:700}\n.gp{font-weight:700}\n.gp.up{color:var(--pricey)} .gp.down{color:var(--cheap)} .gp.eq{color:var(--same)}\n.cp{display:inline-flex;align-items:center;gap:5px;border-radius:8px;padding:3px 8px;font-family:var(--mono);font-weight:600;color:var(--text)}\na.cp:hover{text-decoration:none;background:var(--surface3)}\n.cp.best{background:var(--cheap-bg);color:var(--cheap);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--cheap) 40%,transparent)}\n.cp.oos{color:var(--faint);text-decoration:line-through;opacity:.75}\n.cp.low{color:var(--warn);background:var(--warn-bg);font-family:inherit;font-size:12px}\n.dash{color:var(--faint)}\n.ico{opacity:.7}\n.row-act{display:flex;gap:6px;justify-content:flex-end}\n.pager{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-top:1px solid var(--line);color:var(--muted);font-size:13px;flex-wrap:wrap}\n.pager .pn{display:flex;gap:6px;align-items:center}\n.stale{font-size:11px;color:var(--warn);margin-inline-start:6px}\n\n/* ===== drawer / modal ===== */\n.scrim{position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(3px);z-index:60;opacity:0;pointer-events:none;transition:.2s}\n.scrim.show{opacity:1;pointer-events:auto}\n.drawer{position:fixed;top:0;bottom:0;inset-inline-end:0;width:min(640px,100vw);background:var(--surface);border-inline-start:1px solid var(--line);z-index:61;transform:translateX(105%);transition:transform .28s cubic-bezier(.2,.8,.2,1);display:flex;flex-direction:column;box-shadow:-30px 0 60px -30px rgba(0,0,0,.7)}\n[dir=\"rtl\"] .drawer{transform:translateX(-105%)}\n.drawer.show{transform:none}\n.dr-h{padding:18px 20px;border-bottom:1px solid var(--line);display:flex;gap:14px;align-items:flex-start}\n.dr-h .thumb{width:64px;height:64px;border-radius:14px}\n.dr-h h3{margin:0 0 4px;font-size:16px;line-height:1.4}\n.dr-b{padding:18px 20px;overflow:auto;flex:1;display:grid;gap:16px;align-content:start}\n.box{background:var(--surface2);border:1px solid var(--line);border-radius:14px;padding:14px 16px}\n.box h4{margin:0 0 10px;font-size:12.5px;color:var(--faint);font-weight:700;letter-spacing:.3px;text-transform:uppercase}\n.kvs{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}\n.kvs div{background:var(--surface);border:1px solid var(--line2);border-radius:12px;padding:10px 12px}\n.kvs small{display:block;color:var(--faint);font-size:12px}\n.kvs b{font-size:18px}\ntable.off{width:100%;border-collapse:collapse;font-size:13.5px}\ntable.off th{font-weight:600;color:var(--faint);font-size:12px;text-align:start;padding:4px 8px}\ntable.off td{padding:9px 8px;border-top:1px solid var(--line2);vertical-align:middle}\ntable.off tr.best td{background:var(--cheap-bg)}\n.modal{position:fixed;inset-inline:0;top:8vh;margin:0 auto;width:min(520px,calc(100vw - 28px));background:var(--surface);border:1px solid var(--line);border-radius:18px;z-index:70;padding:22px;box-shadow:0 40px 80px -30px #000;opacity:0;pointer-events:none;transform:translateY(12px);transition:.2s}\n.modal.show{opacity:1;pointer-events:auto;transform:none}\n.modal h3{margin:0 0 4px;font-size:17px}\n.modal p{margin:0 0 14px;color:var(--muted);font-size:13px}\n.fld{display:block;margin-bottom:12px}\n.fld>span{display:block;font-size:12.5px;color:var(--muted);font-weight:600;margin-bottom:5px}\n.fld input,.fld select,.fld textarea{width:100%;background:var(--surface2);border:1px solid var(--line);border-radius:11px;padding:9px 12px;outline:none}\n.fld input:focus,.fld select:focus,.fld textarea:focus{border-color:var(--lime);box-shadow:0 0 0 3px var(--lime-bg)}\n.fld textarea{resize:vertical;min-height:64px}\n.mf{display:flex;gap:10px;justify-content:flex-end;margin-top:6px}\n.hint{font-size:12.5px;color:var(--muted);margin-top:-4px;margin-bottom:10px}\n.ok-t{color:var(--cheap)} .err-t{color:var(--pricey)}\n\n/* ===== alerts ===== */\n.al-list{list-style:none;margin:0;padding:6px 10px 14px}\n.al{display:grid;grid-template-columns:36px 1fr auto;gap:12px;align-items:center;padding:11px 10px;border-radius:12px;cursor:pointer;border-bottom:1px solid var(--line2)}\n.al:hover{background:var(--surface2)}\n.al.unread{background:linear-gradient(90deg,var(--lime-bg),transparent)}\n.al .ic{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font-weight:800;background:var(--surface3)}\n.al .ic.competitor_cheaper{background:var(--pricey-bg);color:var(--pricey)} .al .ic.price_drop{background:var(--cheap-bg);color:var(--cheap)}\n.al .ic.price_rise{background:var(--warn-bg);color:var(--warn)} .al .ic.new_match{background:var(--same-bg);color:var(--same)} .al .ic.back_in_stock{background:var(--only-bg);color:var(--only)}\n.al b{font-weight:600} .al .m span{font-size:12.5px;color:var(--muted)}\n.al time{font-size:12px;color:var(--faint);white-space:nowrap}\n.dotun{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--lime);margin-inline-end:6px}\n\n.toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--lime);color:var(--on-lime);padding:10px 18px;border-radius:12px;opacity:0;pointer-events:none;transition:.25s;z-index:90;font-weight:700;max-width:90vw}\n.toast.err{background:var(--pricey);color:#fff}\n.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}\n.sk{background:linear-gradient(90deg,var(--surface),var(--surface3),var(--surface));background-size:200% 100%;animation:sk 1.3s infinite;border-radius:14px}\n@keyframes sk{to{background-position:-200% 0}}\n.errbox{max-width:640px;margin:70px auto;text-align:center;padding:30px}\n.errbox code{direction:ltr;display:block;background:var(--surface2);border:1px solid var(--line);border-radius:10px;padding:10px;margin:14px 0;font-family:var(--mono);font-size:12.5px;color:var(--pricey);text-align:left;white-space:pre-wrap}\n.foot{color:var(--faint);font-size:12.5px;text-align:center;margin-top:30px}\n\n@media (max-width:1180px){\n  .g-info{grid-template-columns:repeat(3,minmax(0,1fr))}.g-pos{grid-template-columns:repeat(2,minmax(0,1fr))}\n  .g-two,.g-two.b{grid-template-columns:1fr}\n}\n@media (max-width:720px){\n  main{padding:16px 14px 80px}.top-in{padding:10px 14px}\n  .g-info{grid-template-columns:repeat(2,minmax(0,1fr))}\n  .pos .big{font-size:36px}\n  .nav{order:5;width:100%;margin:0}.nav button{flex:1;justify-content:center;padding:8px 6px}\n  .hide-s{display:none}\n  table.t td.c-prod,table.t th.c-prod{min-width:220px;max-width:240px}\n  .tbl-wrap{max-height:none}\n  .kvs{grid-template-columns:1fr 1fr}\n  .cbar{grid-template-columns:90px 1fr 36px}\n}\n@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}\n</style>\n\n<style>body{font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}</style>\n</head>\n<body>\n\n<header class=\"top\">\n  <div class=\"top-in\">\n    <div class=\"logo\">\n      <span class=\"mark\"><svg width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><circle cx=\"12\" cy=\"12\" r=\"4.5\"/><path d=\"M12 12 19 5\"/></svg></span>\n      <div>PriceRadar<small>Geeks Store · أسعار المنافسين</small></div>\n    </div>\n    <nav class=\"nav\" role=\"tablist\" aria-label=\"Sections\">\n      <button type=\"button\" role=\"tab\" data-tab=\"overview\" aria-selected=\"true\">Overview</button>\n      <button type=\"button\" role=\"tab\" data-tab=\"products\" aria-selected=\"false\">Products</button>\n      <button type=\"button\" role=\"tab\" data-tab=\"alerts\" aria-selected=\"false\">\n        <svg width=\"15\" height=\"15\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0\"/></svg>\n        Alerts <span class=\"badge\" id=\"bell\" hidden>0</span>\n      </button>\n    </nav>\n    <div class=\"sp\"></div>\n    <div class=\"pillbar\" id=\"prog\" hidden><span class=\"dot\"></span><span id=\"progTxt\">Checking…</span><span class=\"bar\"><i id=\"progBar\" style=\"width:0%\"></i></span><b class=\"num\" id=\"progPct\">0%</b></div>\n    <span class=\"pillbar hide-s\" id=\"updated\" title=\"Last time competitor prices were read\">Updated <b id=\"updatedTxt\">—</b></span>\n    <button class=\"btn primary\" id=\"btnRun\" type=\"button\"><span class=\"spin\"></span><svg width=\"15\" height=\"15\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 12a9 9 0 1 1-3-6.7\"/><path d=\"M21 3v6h-6\"/></svg><span id=\"btnRunTxt\">Run check now</span></button>\n    <button class=\"btn icon\" id=\"btnTheme\" type=\"button\" aria-label=\"Toggle light / dark\"><svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z\"/></svg></button>\n  </div>\n</header>\n\n<main id=\"app\">\n  <div class=\"grid g-info\"><div class=\"sk\" style=\"height:92px\"></div><div class=\"sk\" style=\"height:92px\"></div><div class=\"sk\" style=\"height:92px\"></div><div class=\"sk\" style=\"height:92px\"></div><div class=\"sk\" style=\"height:92px\"></div></div>\n  <div class=\"grid g-pos\" style=\"margin-top:16px\"><div class=\"sk\" style=\"height:150px\"></div><div class=\"sk\" style=\"height:150px\"></div><div class=\"sk\" style=\"height:150px\"></div><div class=\"sk\" style=\"height:150px\"></div></div>\n</main>\n\n<div class=\"scrim\" id=\"scrim\"></div>\n<aside class=\"drawer\" id=\"drawer\" aria-hidden=\"true\"></aside>\n<div class=\"modal\" id=\"modal\" role=\"dialog\" aria-modal=\"true\"></div>\n<div class=\"toast\" id=\"toast\" role=\"status\"></div>\n\n<script>\n(function () {\n'use strict';\n\n/* ============================== helpers ============================== */\nvar $ = function (s, r) { return (r || document).querySelector(s); };\nvar $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };\nvar esc = function (s) { return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c]; }); };\nvar ar = function (t) { return '<span class=\"ar\" dir=\"rtl\" lang=\"ar\">' + t + '</span>'; };\nvar fmt = function (n) { return n == null ? '—' : Math.round(n).toLocaleString('en-US'); };\nvar pct = function (n, d) { return n == null ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(d == null ? 1 : d) + '%'; };\nfunction ago(t, now) {\n  if (!t) return 'never';\n  var s = Math.max(0, ((now || Date.now()) - t) / 1000);\n  if (s < 90) return 'just now';\n  var m = Math.round(s / 60); if (m < 60) return m + ' min ago';\n  var h = Math.round(m / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');\n  var d = Math.round(h / 24); return d + (d === 1 ? ' day ago' : ' days ago');\n}\nfunction toast(msg, err) {\n  var t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');\n  clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, err ? 5200 : 3000);\n}\nfunction run(fn, args, ok, fail) {\n  if (typeof google === 'undefined' || !google.script) { (fail || function () {})({ message: 'Open this page from the Web App link.' }); return; }\n  var r = google.script.run.withSuccessHandler(ok || function () {}).withFailureHandler(fail || function (e) { toast(e && e.message || String(e), true); });\n  r[fn].apply(r, args || []);\n}\n\nvar ICON = {\n  search: '<svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"><circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"m21 21-4.3-4.3\"/></svg>',\n  ext: '<svg class=\"ico\" width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5\"/></svg>',\n  pin: '<svg width=\"11\" height=\"11\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M14 3l7 7-3 1-4 4v5l-2 2-3-6-6-3 2-2h5l4-4z\"/></svg>',\n  link: '<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1\"/></svg>',\n  refresh: '<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 12a9 9 0 1 1-3-6.7\"/><path d=\"M21 3v6h-6\"/></svg>',\n  plus: '<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.4\" stroke-linecap=\"round\"><path d=\"M12 5v14M5 12h14\"/></svg>',\n  down: '<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 3v12M7 10l5 5 5-5M5 21h14\"/></svg>',\n  close: '<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\"><path d=\"M6 6l12 12M18 6 6 18\"/></svg>'\n};\n\n/* ============================== statuses ============================== */\nvar ST = {\n  only_us:     { l: \"Only we have it\", d: 'مفيش منافس عنده المنتج متوفر', c: 'var(--only)' },\n  same:        { l: 'Same price', d: 'الفرق ضمن النسبة المسموحة', c: 'var(--same)' },\n  cheaper:     { l: \"We're cheaper\", d: 'سعرنا أقل من كل المنافسين المتوفرين', c: 'var(--cheap)' },\n  pricier:     { l: \"We're pricier\", d: 'فيه منافس متوفر أرخص مننا', c: 'var(--pricey)' },\n  not_checked: { l: 'Not checked yet', d: 'لسه ما اتفحصش', c: 'var(--other)' },\n  needs_help:  { l: 'Needs your help', d: 'محتاج رابط يدوي', c: 'var(--warn)' }\n};\nvar ST_ORDER = ['pricier', 'same', 'cheaper', 'only_us', 'needs_help', 'not_checked'];\nvar ALERT_T = {\n  competitor_cheaper: ['Competitor cheaper', '▼'], price_drop: ['Price drop', '↓'], price_rise: ['Price rise', '↑'],\n  new_match: ['New match', '+'], back_in_stock: ['Back in stock', '↺']\n};\n\n/* ============================== state ============================== */\nvar D = null;\nvar S = { tab: 'overview', cat: '', st: '', q: '', comp: '', sort: 'priority', page: 0, per: 40, aType: '', aUnread: false, alerts: null, drawer: null };\nvar pollTimer = null;\n\n/* ============================== data ============================== */\nfunction load(force) {\n  return new Promise(function (res) {\n    run('getDashboard', [!!force], function (d) {\n      D = d; prep(); render(); updateProgress(d.progress); res(d);\n    }, function (e) { showErr(e && e.message || String(e)); res(); });\n  });\n}\nfunction prep() {\n  D.byKey = {}; D.products.forEach(function (p) {\n    D.byKey[p.sku] = p;\n    p.hay = (p.n + ' ' + p.sku + ' ' + p.brand + ' ' + p.cat).toLowerCase();\n  });\n  D.active = D.competitors.filter(function (c) { return c.active; });\n}\nfunction showErr(m) {\n  $('#app').innerHTML = '<div class=\"card errbox\"><h2 style=\"margin:0 0 8px\">Couldn’t load the data</h2><div style=\"color:var(--muted)\">Make sure you ran <b>setup()</b> once from the Apps Script editor, and that the Web App is deployed.</div><code>' + esc(m) + '</code><button class=\"btn primary\" id=\"retry\" type=\"button\">Try again</button></div>';\n  $('#retry').onclick = function () { load(true); };\n}\n\n/* ============================== progress ============================== */\nfunction updateProgress(p) {\n  if (!p) return;\n  var run_ = p.status === 'running';\n  $('#prog').hidden = !run_;\n  var lbl = { sync: 'Syncing our products', prices: 'Reading competitor prices', discover: 'Finding matches' }[p.phase] || 'Checking';\n  if (run_) { $('#progTxt').textContent = lbl + (p.phase === 'prices' && p.total ? ' · ' + p.i + '/' + p.total : ''); $('#progBar').style.width = p.pct + '%'; $('#progPct').textContent = p.pct + '%'; }\n  var b = $('#btnRun'); b.disabled = run_; b.classList.toggle('busy', run_);\n  $('#btnRunTxt').textContent = run_ ? 'Checking…' : 'Run check now';\n  if (D) {\n    $('#updatedTxt').textContent = ago(D.lastChecked);\n    var bell = $('#bell'); bell.hidden = !D.unread; bell.textContent = D.unread > 99 ? '99+' : D.unread;\n  }\n  clearTimeout(pollTimer);\n  if (run_) pollTimer = setTimeout(poll, 5000);\n}\nfunction poll() {\n  run('getProgress', [], function (p) {\n    var was = D && D.progress && D.progress.status === 'running';\n    if (D) D.progress = p;\n    updateProgress(p);\n    if (p.status !== 'running' && was) { toast('Check finished · الفحص خلص'); load(true); }\n  });\n}\n\n/* ============================== charts ============================== */\nfunction stackedBars(rows) {\n  var segs = [['pricier', 'var(--pricey)'], ['same', 'var(--same)'], ['cheaper', 'var(--cheap)'], ['only_us', 'var(--only)'], ['other', 'var(--other)']];\n  var h = '<div class=\"legend\">' + segs.map(function (s) { return '<span><i style=\"background:' + s[1] + '\"></i>' + (s[0] === 'other' ? 'Not checked / needs help' : ST[s[0]].l) + '</span>'; }).join('') + '</div><div class=\"chart-box\">';\n  if (!rows.length) return h + '<div class=\"empty\">No products yet · ' + ar('لسه مفيش منتجات') + '</div></div>';\n  rows.slice(0, 9).forEach(function (r) {\n    var tot = r.pricier + r.same + r.cheaper + r.only_us + r.other;\n    h += '<div class=\"cbar\" data-cat=\"' + esc(r.cat) + '\" title=\"Open ' + esc(r.cat) + '\"><div class=\"nm\">' + esc(r.cat) + '</div><div class=\"bar\">' +\n      segs.map(function (s) { return r[s[0]] ? '<span style=\"flex:' + r[s[0]] + ';background:' + s[1] + '\" title=\"' + (s[0] === 'other' ? 'Other' : ST[s[0]].l) + ': ' + r[s[0]] + '\"></span>' : ''; }).join('') +\n      '</div><div class=\"ct num\">' + tot + '</div></div>';\n  });\n  return h + '</div>';\n}\n\nfunction trendChart(trend) {\n  if (!trend || trend.length < 2) return '<div class=\"empty\">The 30-day trend appears after a couple of days of data.<br>' + ar('الرسم هيظهر بعد يومين من البيانات') + '</div>';\n  var W = 560, H = 190, PL = 44, PR = 12, PT = 12, PB = 26, n = trend.length;\n  var vals = trend.map(function (t) { return t.avg; });\n  var mn = Math.min.apply(null, vals.concat([0])), mx = Math.max.apply(null, vals.concat([0]));\n  var pad = (mx - mn) * .15 || 1; mn -= pad; mx += pad;\n  var X = function (i) { return PL + i * (W - PL - PR) / (n - 1); }, Y = function (v) { return PT + (H - PT - PB) * (1 - (v - mn) / (mx - mn)); };\n  var d = trend.map(function (t, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(t.avg).toFixed(1); }).join('');\n  var area = d + 'L' + X(n - 1).toFixed(1) + ' ' + Y(0).toFixed(1) + 'L' + X(0).toFixed(1) + ' ' + Y(0).toFixed(1) + 'Z';\n  var g = '';\n  for (var k = 0; k <= 3; k++) { var v = mn + (mx - mn) * k / 3, y = Y(v); g += '<line x1=\"' + PL + '\" x2=\"' + (W - PR) + '\" y1=\"' + y + '\" y2=\"' + y + '\" stroke=\"var(--line2)\"/><text x=\"' + (PL - 8) + '\" y=\"' + (y + 4) + '\" text-anchor=\"end\" font-size=\"10.5\" fill=\"var(--faint)\" font-family=\"JetBrains Mono,monospace\">' + v.toFixed(1) + '%</text>'; }\n  var last = trend[n - 1];\n  return '<div class=\"chart-box\"><svg viewBox=\"0 0 ' + W + ' ' + H + '\" width=\"100%\" style=\"height:auto\" role=\"img\" aria-label=\"Average gap vs cheapest in-stock competitor, last 30 days\">' + g +\n    '<line x1=\"' + PL + '\" x2=\"' + (W - PR) + '\" y1=\"' + Y(0) + '\" y2=\"' + Y(0) + '\" stroke=\"var(--faint)\" stroke-dasharray=\"4 4\"/>' +\n    '<path d=\"' + area + '\" fill=\"var(--lime)\" opacity=\".10\"/><path d=\"' + d + '\" fill=\"none\" stroke=\"var(--lime)\" stroke-width=\"2.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>' +\n    '<circle cx=\"' + X(n - 1) + '\" cy=\"' + Y(last.avg) + '\" r=\"4.5\" fill=\"var(--lime)\" stroke=\"var(--surface)\" stroke-width=\"2\"/>' +\n    '<text x=\"' + PL + '\" y=\"' + (H - 6) + '\" font-size=\"10.5\" fill=\"var(--faint)\" font-family=\"JetBrains Mono,monospace\">' + trend[0].d.slice(5) + '</text><text x=\"' + (W - PR) + '\" y=\"' + (H - 6) + '\" text-anchor=\"end\" font-size=\"10.5\" fill=\"var(--faint)\" font-family=\"JetBrains Mono,monospace\">' + last.d.slice(5) + '</text></svg>' +\n    '<div style=\"color:var(--muted);font-size:12.5px;margin-top:6px\">Positive = we are more expensive than the cheapest in-stock competitor. Latest: <b class=\"num\" style=\"color:' + (last.avg > 0 ? 'var(--pricey)' : 'var(--cheap)') + '\">' + pct(last.avg) + '</b></div></div>';\n}\n\nvar PALETTE = ['#ff8a5b', '#8db4ff', '#4fd6c4', '#f5b84a', '#d28bff', '#7be0a0', '#ff6a9a', '#9aa7ff'];\nfunction historyChart(series, names) {\n  var dates = {}, vals = [];\n  names.forEach(function (k) { (series[k] || []).forEach(function (pt) { dates[pt.d] = 1; vals.push(pt.p); }); });\n  var ds = Object.keys(dates).sort();\n  if (ds.length < 2 || !vals.length) return '<div class=\"empty\">History builds up with every check.<br>' + ar('التاريخ بيتبني مع كل فحص — ارجع بكرة') + '</div>';\n  var W = 580, H = 210, PL = 50, PR = 12, PT = 12, PB = 26, n = ds.length;\n  var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), pad = (mx - mn) * .12 || mx * .02 || 1; mn -= pad; mx += pad;\n  var X = function (i) { return PL + i * (W - PL - PR) / (n - 1); }, Y = function (v) { return PT + (H - PT - PB) * (1 - (v - mn) / (mx - mn)); };\n  var idx = {}; ds.forEach(function (d, i) { idx[d] = i; });\n  var g = '';\n  for (var k = 0; k <= 3; k++) { var v = mn + (mx - mn) * k / 3, y = Y(v); g += '<line x1=\"' + PL + '\" x2=\"' + (W - PR) + '\" y1=\"' + y + '\" y2=\"' + y + '\" stroke=\"var(--line2)\"/><text x=\"' + (PL - 8) + '\" y=\"' + (y + 4) + '\" text-anchor=\"end\" font-size=\"10.5\" fill=\"var(--faint)\" font-family=\"JetBrains Mono,monospace\">' + fmt(v) + '</text>'; }\n  var lines = '', leg = '';\n  names.forEach(function (name, j) {\n    var s = series[name]; if (!s || !s.length) return;\n    var col = name === 'GEEKS' ? 'var(--lime)' : PALETTE[j % PALETTE.length];\n    var d = '', pen = false;\n    s.forEach(function (pt) { d += (pen ? 'L' : 'M') + X(idx[pt.d]).toFixed(1) + ' ' + Y(pt.p).toFixed(1); pen = true; });\n    var l = s[s.length - 1];\n    lines += '<path d=\"' + d + '\" fill=\"none\" stroke=\"' + col + '\" stroke-width=\"' + (name === 'GEEKS' ? 3 : 2) + '\" stroke-linecap=\"round\" stroke-linejoin=\"round\" ' + (l.s === false && name !== 'GEEKS' ? 'stroke-dasharray=\"4 4\"' : '') + '/><circle cx=\"' + X(idx[l.d]) + '\" cy=\"' + Y(l.p) + '\" r=\"3.8\" fill=\"' + col + '\" stroke=\"var(--surface2)\" stroke-width=\"2\"/>';\n    leg += '<span><i style=\"background:' + col + '\"></i>' + (name === 'GEEKS' ? 'Geeks (us)' : esc(name)) + '</span>';\n  });\n  return '<div class=\"legend\" style=\"padding:0 0 8px\">' + leg + '</div><svg viewBox=\"0 0 ' + W + ' ' + H + '\" width=\"100%\" style=\"height:auto\" role=\"img\" aria-label=\"Price history\">' + g + lines +\n    '<text x=\"' + PL + '\" y=\"' + (H - 6) + '\" font-size=\"10.5\" fill=\"var(--faint)\" font-family=\"JetBrains Mono,monospace\">' + ds[0].slice(5) + '</text><text x=\"' + (W - PR) + '\" y=\"' + (H - 6) + '\" text-anchor=\"end\" font-size=\"10.5\" fill=\"var(--faint)\" font-family=\"JetBrains Mono,monospace\">' + ds[n - 1].slice(5) + '</text></svg>';\n}\n\n/* ============================== render: shell ============================== */\nfunction render() {\n  var views = '<section class=\"view\" id=\"v-overview\"></section><section class=\"view\" id=\"v-products\"></section><section class=\"view\" id=\"v-alerts\"></section>';\n  if (!$('#v-overview')) $('#app').innerHTML = views;\n  $$('.view').forEach(function (v) { v.hidden = v.id !== 'v-' + S.tab; });\n  $$('.nav button').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.tab === S.tab ? 'true' : 'false'); });\n  renderOverview(); renderProducts();\n  if (S.tab === 'alerts') renderAlerts();\n}\nfunction go(tab) { S.tab = tab; if (tab === 'alerts') S.alerts = null; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }\n\n/* ============================== overview ============================== */\nfunction renderOverview() {\n  var s = D.summary, tot = s.total || 1;\n  var needs = s.needs_help + s.not_checked;\n  var p = D.progress || {};\n  var h = '<div class=\"grid g-info\">' +\n    info('Last update', ago(D.lastChecked), 'Products synced ' + ago(D.lastSynced) + ' · ' + ar('آخر مزامنة'), '') +\n    info('Products monitored', '<span class=\"num\">' + s.total + '</span>', 'In stock / pre-order ' + ar('بس'), '') +\n    info('Coverage', '<span class=\"num\">' + s.coveragePct + '%</span>', '<span class=\"num\">' + s.withData + '/' + s.total + '</span> ' + ar('ليهم سعر منافس'), '<div class=\"meter\"><i style=\"width:' + s.coveragePct + '%\"></i></div>') +\n    info('Need a link', '<span class=\"num\" style=\"color:' + (s.needs_help ? 'var(--warn)' : 'inherit') + '\">' + s.needs_help + '</span>', '<span class=\"num\">' + s.not_checked + '</span> ' + ar('لسه ما اتفحصوش'), '') +\n    info('Check status', p.status === 'running' ? 'Running' : 'Idle', p.status === 'running' ? (p.pct + '% — ' + ({ sync: 'syncing', prices: 'reading prices', discover: 'finding matches' }[p.phase] || '')) : ar('التحديث الجاي') + ' <span class=\"num\">' + esc(D.settings.hours) + '</span> ' + ar('بتوقيت القاهرة'), p.status === 'running' ? '<div class=\"meter\"><i style=\"width:' + p.pct + '%\"></i></div>' : '') +\n    '</div>';\n\n  h += '<div class=\"sec-t\">Price position summary · ' + ar('موقفنا السعري') + '</div><div class=\"grid g-pos\">';\n  [['only_us', 'M12 2l3 7h7l-5.5 4.2L18 21l-6-4.5L6 21l1.5-7.8L2 9h7z'], ['same', 'M5 9h14M5 15h14'], ['cheaper', 'M12 5v14M6 13l6 6 6-6'], ['pricier', 'M12 19V5M6 11l6-6 6 6']].forEach(function (x) {\n    var k = x[0], m = ST[k];\n    h += '<button type=\"button\" class=\"card pos\" data-st=\"' + k + '\" style=\"--c:' + m.c + '\"><div class=\"t\"><svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"' + x[1] + '\"/></svg>' + m.l + '</div><div class=\"big num\">' + s[k] + '</div><div class=\"d ar\" dir=\"rtl\">' + (k === 'same' ? 'الفرق ضمن ±' + D.settings.same + '% من أرخص سعر' : m.d) + '</div><div class=\"pct num\">' + Math.round(s[k] / tot * 100) + '%</div></button>';\n  });\n  h += '</div>';\n\n  h += '<div class=\"grid g-two\"><section class=\"card\"><div class=\"card-h\"><h2>Biggest gaps — competitors cheaper than us</h2><span class=\"sub\">Top 10 · ' + ar('أكبر الفجوات') + '</span></div><ul class=\"gaps\">';\n  if (!D.top.length) h += '<li class=\"empty\">No competitor is cheaper than us right now 👌<br>' + ar('مفيش منافس أرخص مننا حاليًا') + '</li>';\n  D.top.forEach(function (t, i) {\n    h += '<li class=\"gap-i\" data-open=\"' + esc(t.sku) + '\"><span class=\"rk num\">' + (i + 1) + '</span><div class=\"thumb\" style=\"background-image:url(' + esc(t.img) + ')\"></div><div class=\"m\"><b title=\"' + esc(t.n) + '\">' + esc(t.n) + '</b><span>' + esc(t.comp) + ' · <span class=\"num\">' + fmt(t.cp) + '</span> vs us <span class=\"num\">' + fmt(t.p) + '</span></span></div><div class=\"r\"><div class=\"gap-pct num\">' + pct(t.gap) + '</div><div class=\"num\" style=\"font-size:12px;color:var(--faint)\">+' + fmt(t.p - t.cp) + ' EGP</div></div></li>';\n  });\n  h += '</ul></section><div class=\"grid\" style=\"align-content:start\">' +\n    '<section class=\"card\"><div class=\"card-h\"><h2>Price position by category</h2><span class=\"sub\">' + ar('اضغط على الفئة لفتحها') + '</span></div>' + stackedBars(D.byCategory) + '</section></div></div>';\n  h += '<section class=\"card\" style=\"margin-top:16px\"><div class=\"card-h\"><h2>Average gap — last 30 days</h2><span class=\"sub\">vs cheapest in-stock · ' + ar('متوسط الفجوة آخر 30 يوم') + '</span></div>' + trendChart(D.trend) + '</section>';\n  $('#v-overview').innerHTML = h;\n}\nfunction info(k, v, sub, extra) { return '<div class=\"card info\"><div class=\"k\">' + k + '</div><div class=\"v\">' + v + '</div><div style=\"font-size:12.5px;color:var(--faint);margin-top:2px\">' + sub + '</div>' + extra + '</div>'; }\n\n/* ============================== products ============================== */\nfunction filtered() {\n  var q = S.q.trim().toLowerCase(), words = q ? q.split(/\\s+/) : [];\n  var rows = D.products.filter(function (p) {\n    if (S.cat && p.top !== S.cat) return false;\n    if (S.st && p.st !== S.st) return false;\n    if (S.comp) { var c = p.cells[S.comp]; if (!c || c.p == null) return false; }\n    if (words.length) { for (var i = 0; i < words.length; i++) if (p.hay.indexOf(words[i]) < 0) return false; }\n    return true;\n  });\n  var nm = function (a, b) { return a.n.localeCompare(b.n); };\n  var cmp = {\n    priority: function (a, b) { return a.grp - b.grp || (a.grp === 0 ? (b.gap - a.gap) : 0) || nm(a, b); },\n    gap: function (a, b) { return (b.gap == null ? -1e9 : b.gap) - (a.gap == null ? -1e9 : a.gap) || nm(a, b); },\n    price: function (a, b) { return b.p - a.p; },\n    name: nm\n  }[S.sort];\n  return rows.sort(cmp);\n}\n\nfunction renderProducts() {\n  var counts = {}; D.products.forEach(function (p) { counts[p.st] = (counts[p.st] || 0) + 1; });\n  var h = '<section class=\"card\" style=\"overflow:hidden\"><div class=\"cats\">' +\n    '<button type=\"button\" class=\"cat\" data-cat=\"\" aria-pressed=\"' + (!S.cat) + '\">All<em class=\"num\">' + D.products.length + '</em></button>' +\n    D.categories.slice(0, 10).map(function (c) { return '<button type=\"button\" class=\"cat\" data-cat=\"' + esc(c.name) + '\" aria-pressed=\"' + (S.cat === c.name) + '\">' + esc(c.name) + '<em class=\"num\">' + c.count + '</em></button>'; }).join('') + '</div>' +\n    '<div class=\"tool\"><div class=\"search\">' + ICON.search + '<input id=\"q\" type=\"search\" placeholder=\"Search SKU or name…  ( / )\" title=\"بحث بالاسم أو الـ SKU\" value=\"' + esc(S.q) + '\" autocomplete=\"off\"></div>' +\n    '<select class=\"sel\" id=\"fComp\" aria-label=\"Competitor\"><option value=\"\">All competitors</option>' + D.active.map(function (c) { return '<option' + (S.comp === c.name ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select>' +\n    '<select class=\"sel\" id=\"fSort\" aria-label=\"Sort\"><option value=\"priority\"' + (S.sort === 'priority' ? ' selected' : '') + '>Sort: Priority</option><option value=\"gap\"' + (S.sort === 'gap' ? ' selected' : '') + '>Sort: Biggest gap</option><option value=\"price\"' + (S.sort === 'price' ? ' selected' : '') + '>Sort: Our price</option><option value=\"name\"' + (S.sort === 'name' ? ' selected' : '') + '>Sort: Name</option></select>' +\n    '<span class=\"sp\"></span>' +\n    '<button class=\"btn\" id=\"btnSync\" type=\"button\"><span class=\"spin\"></span>' + ICON.refresh + 'Update our products</button>' +\n    '<button class=\"btn\" id=\"btnAddComp\" type=\"button\">' + ICON.plus + 'Add competitor</button>' +\n    '<button class=\"btn\" id=\"btnCsv\" type=\"button\">' + ICON.down + 'Export CSV</button></div>' +\n    '<div class=\"chips\">' + ['', 'pricier', 'same', 'cheaper', 'only_us', 'needs_help', 'not_checked'].map(function (k) {\n      var m = k ? ST[k] : { l: 'All statuses', c: 'var(--lime)' };\n      return '<button type=\"button\" class=\"chip\" data-st=\"' + k + '\" style=\"--c:' + m.c + '\" aria-pressed=\"' + (S.st === k) + '\">' + m.l + (k ? '<em class=\"num\">' + (counts[k] || 0) + '</em>' : '') + '</button>';\n    }).join('') + '</div><div id=\"tbl\"></div></section>';\n  $('#v-products').innerHTML = h;\n  renderTable();\n}\n\nfunction renderTable() {\n  var rows = filtered(), per = S.per, pages = Math.max(1, Math.ceil(rows.length / per));\n  if (S.page >= pages) S.page = pages - 1;\n  var slice = rows.slice(S.page * per, S.page * per + per);\n  var comps = D.active;\n  var h = '<div class=\"tbl-wrap\"><table class=\"t\"><thead><tr><th class=\"c-prod\">Product</th><th>Our price</th><th>Gap</th><th>Status</th>' +\n    comps.map(function (c) { return '<th title=\"' + esc(c.categories) + '\">' + esc(c.name) + '</th>'; }).join('') + '<th></th></tr></thead><tbody>';\n  if (!slice.length) h += '<tr><td colspan=\"' + (5 + comps.length) + '\" class=\"empty\">No products match these filters · ' + ar('مفيش منتجات مطابقة') + '</td></tr>';\n  var lastGrp = -1, GL = ['Competitor in stock · منافس متوفر', 'Competitors out of stock · المنافس نافد', 'No competitor price yet · لسه مفيش سعر منافس'];\n  slice.forEach(function (p) {\n    if (S.sort === 'priority' && p.grp !== lastGrp) { h += '<tr class=\"grp-row\"><td colspan=\"' + (5 + comps.length) + '\">' + GL[p.grp] + '</td></tr>'; lastGrp = p.grp; }\n    var gcls = p.gap == null ? '' : (p.st === 'same' ? 'eq' : (p.gap > 0 ? 'up' : 'down'));\n    h += '<tr data-sku=\"' + esc(p.sku) + '\"><td class=\"c-prod\"><div class=\"prod\" data-open=\"' + esc(p.sku) + '\"><div class=\"thumb\" style=\"background-image:url(' + esc(p.img) + ')\"></div><div class=\"tt\"><b title=\"' + esc(p.n) + '\">' + esc(p.n) + '</b><span>' + esc(p.sku) + (p.stock === 'preorder' ? ' · Pre-order' : '') + '</span></div></div></td>' +\n      '<td><span class=\"price num\">' + fmt(p.p) + '</span></td>' +\n      '<td>' + (p.gap == null ? '<span class=\"dash\">—</span>' : '<span class=\"gp num ' + gcls + '\">' + pct(p.gap) + '</span>') + '</td>' +\n      '<td><span class=\"pill ' + p.st + '\">' + ST[p.st].l + '</span></td>';\n    comps.forEach(function (c) { h += '<td>' + cell(p, c) + '</td>'; });\n    h += '<td><div class=\"row-act\"><button class=\"btn sm ghost\" data-link=\"' + esc(p.sku) + '\" title=\"Add / edit link & note — ضيف أو عدّل لينك وملاحظة\">' + ICON.link + '<span class=\"hide-s\">Link</span></button><button class=\"btn sm ghost\" data-upd=\"' + esc(p.sku) + '\" title=\"Re-check now — افحص المنتج ده دلوقتي\"><span class=\"spin\"></span>' + ICON.refresh + '</button></div></td></tr>';\n  });\n  h += '</tbody></table></div><div class=\"pager\"><span><b class=\"num\">' + rows.length + '</b> products</span><div class=\"pn\"><button class=\"btn sm\" id=\"pPrev\" type=\"button\"' + (S.page === 0 ? ' disabled' : '') + '>‹ Prev</button><span class=\"num\">' + (S.page + 1) + ' / ' + pages + '</span><button class=\"btn sm\" id=\"pNext\" type=\"button\"' + (S.page >= pages - 1 ? ' disabled' : '') + '>Next ›</button></div></div>';\n  $('#tbl').innerHTML = h;\n}\n\nfunction cell(p, c) {\n  var x = p.cells[c.name];\n  if (!x) return '<span class=\"dash\">—</span>';\n  var pin = x.m === 'manual' ? ' ' + ICON.pin : '';\n  if (x.low) return '<a class=\"cp low\" href=\"' + esc(x.u) + '\" target=\"_blank\" rel=\"noopener\" title=\"Exact match needed — راجع اللينك\">⚠ Review</a>';\n  if (x.p == null) return x.u ? '<a class=\"cp oos\" href=\"' + esc(x.u) + '\" target=\"_blank\" rel=\"noopener\" title=\"Not read yet\">…</a>' : '<span class=\"dash\">—</span>';\n  var best = x.s && p.min != null && x.p === p.min, cls = best ? 'best' : (x.s ? '' : 'oos');\n  var stale = x.t && (D.now - x.t) > 36 * 3600e3 ? '<span class=\"stale\" title=\"مااتحدّثش من أكتر من 36 ساعة\">●</span>' : '';\n  return '<a class=\"cp ' + cls + '\" href=\"' + esc(x.u) + '\" target=\"_blank\" rel=\"noopener\" title=\"' + esc(c.name + (x.s ? '' : ' — out of stock') + (x.note ? ' — ' + x.note : '') + ' · checked ' + ago(x.t, D.now)) + '\">' + fmt(x.p) + pin + '</a>' + stale;\n}\n\n/* ============================== drawer ============================== */\nfunction openDrawer(sku) {\n  var p = D.byKey[sku]; if (!p) return;\n  S.drawer = sku;\n  var offs = Object.keys(p.cells).map(function (k) { var c = p.cells[k]; c.name = k; return c; }).sort(function (a, b) {\n    var la = a.p != null && a.s, lb = b.p != null && b.s;\n    if (la !== lb) return la ? -1 : 1; return (a.p == null ? 1e12 : a.p) - (b.p == null ? 1e12 : b.p);\n  });\n  var h = '<div class=\"dr-h\"><div class=\"thumb\" style=\"background-image:url(' + esc(p.img) + ')\"></div><div style=\"flex:1;min-width:0\"><h3>' + esc(p.n) + '</h3><div style=\"color:var(--faint);font-size:12.5px;margin-bottom:8px\">' + esc(p.sku) + ' · ' + esc(p.cat) + '</div><span class=\"pill ' + p.st + '\">' + ST[p.st].l + '</span></div><button class=\"btn icon ghost\" id=\"drClose\" type=\"button\" aria-label=\"Close\">' + ICON.close + '</button></div><div class=\"dr-b\">' +\n    '<div class=\"kvs\"><div><small>Our price</small><b class=\"num\">' + fmt(p.p) + '</b></div><div><small>Cheapest in stock</small><b class=\"num\">' + fmt(p.min) + '</b>' + (p.minBy.length ? '<small>' + esc(p.minBy.join(', ')) + '</small>' : '') + '</div><div><small>Gap</small><b class=\"num\" style=\"color:' + (p.gap == null ? 'inherit' : p.gap > 0 ? 'var(--pricey)' : 'var(--cheap)') + '\">' + pct(p.gap) + '</b></div></div>' +\n    '<div class=\"box\"><h4>Competitors</h4><table class=\"off\"><thead><tr><th>Competitor</th><th>Price</th><th>vs us</th><th>Stock</th><th>Checked</th><th></th></tr></thead><tbody>';\n  if (!offs.length) h += '<tr><td colspan=\"6\" class=\"empty\" style=\"padding:18px\">No competitor links for this product yet. Add one below.<br>' + ar('ضيف لينك يدوي أو استنى الـ match run الجاي') + '</td></tr>';\n  offs.forEach(function (o) {\n    var d = o.p != null ? o.p - p.p : null, best = o.s && p.min != null && o.p === p.min;\n    h += '<tr' + (best ? ' class=\"best\"' : '') + '><td><b>' + esc(o.name) + '</b>' + (o.m === 'manual' ? ' <span title=\"Manual link — never overwritten\">' + ICON.pin + '</span>' : (o.cf != null ? ' <span style=\"color:var(--faint);font-size:11.5px\">auto ' + Math.round(o.cf * 100) + '%</span>' : '')) + (o.note ? '<div style=\"font-size:12px;color:var(--muted)\">' + esc(o.note) + '</div>' : '') + '</td>' +\n      '<td><span class=\"num price\" style=\"' + (o.s === false ? 'opacity:.55;text-decoration:line-through' : '') + '\">' + fmt(o.p) + '</span></td>' +\n      '<td>' + (d == null ? '—' : '<span class=\"num gp ' + (d < 0 ? 'up' : d > 0 ? 'down' : 'eq') + '\">' + (d > 0 ? '+' : d < 0 ? '−' : '') + fmt(Math.abs(d)) + '</span>') + '</td>' +\n      '<td>' + (o.low ? '<span class=\"pill needs_help\">Review</span>' : o.p == null ? '<span class=\"pill not_checked\">Pending</span>' : o.s ? '<span class=\"pill ok\">In stock</span>' : '<span class=\"pill oos\">Out of stock</span>') + '</td>' +\n      '<td style=\"color:var(--faint);font-size:12.5px;white-space:nowrap\">' + (o.t ? ago(o.t, D.now) : '—') + '</td>' +\n      '<td style=\"white-space:nowrap\"><a href=\"' + esc(o.u) + '\" target=\"_blank\" rel=\"noopener\">' + ICON.ext + '</a> <button class=\"btn sm ghost\" data-link=\"' + esc(sku) + '\" data-comp=\"' + esc(o.name) + '\">Edit</button></td></tr>';\n  });\n  h += '</tbody></table><div style=\"display:flex;gap:8px;margin-top:12px;flex-wrap:wrap\"><button class=\"btn sm\" data-link=\"' + esc(sku) + '\" type=\"button\">' + ICON.plus + 'Add link & note</button><button class=\"btn sm\" data-upd=\"' + esc(sku) + '\" type=\"button\"><span class=\"spin\"></span>' + ICON.refresh + 'Update this product</button>' + (p.url ? '<a class=\"btn sm ghost\" href=\"' + esc(p.url) + '\" target=\"_blank\" rel=\"noopener\">Open on our store ' + ICON.ext + '</a>' : '') + '</div></div>' +\n    '<div class=\"box\"><h4>Price history</h4><div id=\"drHist\" class=\"empty\">Loading…</div></div></div>';\n  $('#drawer').innerHTML = h; $('#drawer').classList.add('show'); $('#drawer').setAttribute('aria-hidden', 'false'); $('#scrim').classList.add('show');\n  run('getProductHistory', [sku], function (series) {\n    if (S.drawer !== sku) return;\n    var names = ['GEEKS'].concat(Object.keys(series).filter(function (k) { return k !== 'GEEKS'; }));\n    var el = $('#drHist'); if (el) { el.className = ''; el.innerHTML = historyChart(series, names); }\n  }, function () { var el = $('#drHist'); if (el) el.textContent = 'Could not load history.'; });\n}\nfunction closeAll() {\n  S.drawer = null; $('#drawer').classList.remove('show'); $('#drawer').setAttribute('aria-hidden', 'true');\n  $('#modal').classList.remove('show'); $('#scrim').classList.remove('show');\n}\n\n/* ============================== modals ============================== */\nfunction openLinkModal(sku, comp) {\n  var p = D.byKey[sku]; if (!p) return;\n  var ex = comp && p.cells[comp] ? p.cells[comp] : null;\n  var opts = D.active.map(function (c) { return '<option' + (c.name === comp ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('');\n  $('#modal').innerHTML = '<h3>Add link & note</h3><p>' + esc(p.n) + '<br>' + ar('ضيف أو عدّل رابط المنتج عند المنافس، واكتب أي ملاحظة (زي باندل أو لون مختلف)') + '</p>' +\n    '<label class=\"fld\"><span>Competitor</span><select id=\"mComp\">' + opts + '</select></label>' +\n    '<label class=\"fld\"><span>Product URL at the competitor</span><input id=\"mUrl\" type=\"url\" placeholder=\"https://…\" value=\"' + esc(ex ? ex.u : '') + '\"></label>' +\n    '<label class=\"fld\"><span>Note (optional)</span><textarea id=\"mNote\" placeholder=\"e.g. bundle with mouse, different color…\">' + esc(ex ? ex.note : '') + '</textarea></label>' +\n    '<div class=\"hint\">Manual links always win · ' + ar('الرابط اليدوي ليه أولوية، وما بيتمسح ولا بيتغير من أي تحديث تلقائي') + '</div><div class=\"mf\"><button class=\"btn\" id=\"mCancel\" type=\"button\">Cancel</button><button class=\"btn primary\" id=\"mSave\" type=\"button\"><span class=\"spin\"></span>Save & read price</button></div>';\n  openModal();\n  $('#mCancel').onclick = closeModal;\n  $('#mSave').onclick = function () {\n    var b = this; b.disabled = true; b.classList.add('busy');\n    run('saveManualMatch', [sku, $('#mComp').value, $('#mUrl').value, $('#mNote').value], function (r) {\n      toast(r && r.ok ? 'Saved — price read · اتحفظ واتقرأ السعر' : 'Saved · اتحفظ، والسعر لسه ما اتقراش'); closeModal(); load(true).then(function () { if (S.drawer) openDrawer(S.drawer); });\n    }, function (e) { b.disabled = false; b.classList.remove('busy'); toast(e.message, true); });\n  };\n}\nfunction openCompModal() {\n  $('#modal').innerHTML = '<h3>Add competitor</h3><p>We’ll check the site and detect its platform before saving.<br>' + ar('هنتأكد من الموقع ونحدد نوع المنصة قبل الحفظ') + '</p>' +\n    '<label class=\"fld\"><span>Name</span><input id=\"cName\" placeholder=\"e.g. Trojan Store\"></label>' +\n    '<label class=\"fld\"><span>Website</span><input id=\"cSite\" type=\"url\" placeholder=\"https://…\"></label>' +\n    '<label class=\"fld\"><span>Categories they sell (comma separated, or All)</span><input id=\"cCats\" list=\"catList\" placeholder=\"Monitors, Laptops\"></label><datalist id=\"catList\">' + D.categories.map(function (c) { return '<option value=\"' + esc(c.name) + '\">'; }).join('') + '</datalist>' +\n    '<div class=\"hint\">' + ar('كل منافس بيتقارن بالفئات اللي هنا بس') + '</div><div id=\"cMsg\" class=\"hint\"></div>' +\n    '<div class=\"mf\"><button class=\"btn\" id=\"mCancel\" type=\"button\">Cancel</button><button class=\"btn primary\" id=\"mSave\" type=\"button\"><span class=\"spin\"></span>Verify & save</button></div>';\n  openModal();\n  $('#mCancel').onclick = closeModal;\n  $('#mSave').onclick = function () {\n    var b = this; b.disabled = true; b.classList.add('busy'); $('#cMsg').textContent = 'Checking the site…'; $('#cMsg').className = 'hint';\n    run('addCompetitor', [$('#cName').value, $('#cSite').value, $('#cCats').value], function (r) {\n      toast('Competitor added · اتضاف — platform: ' + r.platform); closeModal(); load(true);\n    }, function (e) { b.disabled = false; b.classList.remove('busy'); $('#cMsg').textContent = e.message; $('#cMsg').className = 'hint err-t'; });\n  };\n}\nfunction openModal() { $('#modal').classList.add('show'); $('#scrim').classList.add('show'); var i = $('#modal input,#modal select'); if (i) setTimeout(function () { i.focus(); }, 60); }\nfunction closeModal() { $('#modal').classList.remove('show'); if (!S.drawer) $('#scrim').classList.remove('show'); }\n\n/* ============================== alerts ============================== */\nfunction renderAlerts() {\n  var box = $('#v-alerts');\n  if (S.alerts == null) {\n    box.innerHTML = '<div class=\"grid\"><div class=\"sk\" style=\"height:300px\"></div></div>';\n    run('getAlertsApi', [{}], function (rows) { S.alerts = rows; renderAlerts(); });\n    return;\n  }\n  var rows = S.alerts.filter(function (a) { return (!S.aType || a.type === S.aType) && (!S.aUnread || !a.read); });\n  var types = ['', 'competitor_cheaper', 'price_drop', 'price_rise', 'new_match', 'back_in_stock'];\n  var h = '<section class=\"card\"><div class=\"card-h\"><h2>Alerts</h2><span class=\"sub\">' + S.alerts.filter(function (a) { return !a.read; }).length + ' unread</span><span class=\"sp\"></span><label class=\"chip\" style=\"cursor:pointer\"><input type=\"checkbox\" id=\"aUnread\"' + (S.aUnread ? ' checked' : '') + ' style=\"accent-color:var(--lime)\"> Unread only</label><button class=\"btn sm\" id=\"aReadAll\" type=\"button\">Mark all read</button></div>' +\n    '<div class=\"chips\" style=\"padding-top:6px\">' + types.map(function (t) { return '<button type=\"button\" class=\"chip\" data-at=\"' + t + '\" aria-pressed=\"' + (S.aType === t) + '\">' + (t ? ALERT_T[t][0] : 'All types') + '</button>'; }).join('') + '</div><ul class=\"al-list\">';\n  if (!rows.length) h += '<li class=\"empty\">Nothing here — you’re all caught up · ' + ar('مفيش تنبيهات') + '</li>';\n  rows.slice(0, 200).forEach(function (a) {\n    var T = ALERT_T[a.type] || [a.type, '•'];\n    var detail;\n    if (a.type === 'new_match') detail = esc(a.comp) + ' · first price <b class=\"num\">' + fmt(a.nw) + '</b>';\n    else if (a.type === 'back_in_stock') detail = esc(a.comp) + ' is back in stock at <b class=\"num\">' + fmt(a.nw) + '</b>';\n    else detail = esc(a.comp) + ' · <span class=\"num\">' + fmt(a.old) + '</span> → <b class=\"num\">' + fmt(a.nw) + '</b>';\n    h += '<li class=\"al' + (a.read ? '' : ' unread') + '\" data-open=\"' + esc(a.sku) + '\"><div class=\"ic ' + a.type + '\">' + T[1] + '</div><div class=\"m\"><b>' + (a.read ? '' : '<span class=\"dotun\"></span>') + esc(a.n) + '</b><br><span>' + T[0] + ' — ' + detail + (a.gap != null ? ' · gap <b class=\"num\">' + pct(a.gap) + '</b>' : '') + '</span></div><time>' + ago(a.t) + '</time></li>';\n  });\n  box.innerHTML = h + '</ul></section>';\n}\n\n/* ============================== CSV ============================== */\nfunction exportCsv() {\n  var rows = filtered(), comps = D.active;\n  var q = function (v) { v = String(v == null ? '' : v); return /[\",\\n]/.test(v) ? '\"' + v.replace(/\"/g, '\"\"') + '\"' : v; };\n  var lines = [['SKU', 'Name', 'Category', 'Our price', 'Status', 'Gap %', 'Cheapest in stock', 'Cheapest competitor'].concat(comps.map(function (c) { return c.name; })).map(q).join(',')];\n  rows.forEach(function (p) {\n    lines.push([p.sku, p.n, p.cat, p.p, ST[p.st].l, p.gap == null ? '' : p.gap.toFixed(1), p.min == null ? '' : p.min, p.minBy.join(' / ')].concat(comps.map(function (c) {\n      var x = p.cells[c.name]; return !x || x.p == null ? '' : x.p + (x.s ? '' : ' (OOS)');\n    })).map(q).join(','));\n  });\n  var blob = new Blob(['﻿' + lines.join('\\n')], { type: 'text/csv;charset=utf-8' });\n  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'priceradar-' + new Date().toISOString().slice(0, 10) + '.csv';\n  document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);\n  toast('Exported ' + rows.length + ' products · اتصدّر');\n}\n\n/* ============================== events ============================== */\ndocument.addEventListener('click', function (e) {\n  var t;\n  if ((t = e.target.closest('.nav button'))) return go(t.dataset.tab);\n  if (e.target.closest('#drClose') || e.target.id === 'scrim') return closeAll();\n  if ((t = e.target.closest('[data-link]'))) { e.stopPropagation(); return openLinkModal(t.dataset.link, t.dataset.comp || ''); }\n  if ((t = e.target.closest('[data-upd]'))) {\n    var b = t, sku = b.dataset.upd; b.disabled = true; b.classList.add('busy');\n    run('updateProduct', [sku], function (r) { toast('Checked ' + r.checked + ' link(s) · ' + r.ok + ' read' + (r.found ? ' · ' + r.found + ' new match(es)' : '')); load(true).then(function () { if (S.drawer) openDrawer(S.drawer); }); },\n      function (er) { b.disabled = false; b.classList.remove('busy'); toast(er.message, true); });\n    return;\n  }\n  if ((t = e.target.closest('[data-open]'))) return openDrawer(t.dataset.open);\n  if ((t = e.target.closest('.pos'))) { S.st = t.dataset.st; S.cat = ''; S.q = ''; S.comp = ''; S.page = 0; go('products'); return; }\n  if ((t = e.target.closest('.cbar'))) { S.cat = t.dataset.cat; S.st = ''; S.page = 0; go('products'); return; }\n  if ((t = e.target.closest('.cat'))) { S.cat = t.dataset.cat; S.page = 0; renderProducts(); return; }\n  if ((t = e.target.closest('.chip[data-st]'))) { S.st = t.dataset.st; S.page = 0; renderProducts(); return; }\n  if ((t = e.target.closest('.chip[data-at]'))) { S.aType = t.dataset.at; renderAlerts(); return; }\n  if (e.target.id === 'aReadAll') { run('markAllAlertsRead', [], function () { toast('All alerts marked read · كله اتعلّم مقروء'); S.alerts = null; load(true); }); return; }\n  if (e.target.id === 'pPrev') { S.page--; renderTable(); $('#tbl').scrollIntoView({ block: 'start' }); return; }\n  if (e.target.id === 'pNext') { S.page++; renderTable(); $('#tbl').scrollIntoView({ block: 'start' }); return; }\n  if (e.target.closest('#btnAddComp')) return openCompModal();\n  if (e.target.closest('#btnCsv')) return exportCsv();\n  if ((t = e.target.closest('#btnSync'))) {\n    t.disabled = true; t.classList.add('busy');\n    run('syncNow', [], function (r) { toast('Synced · اتحدّث — ' + r.monitored + ' products'); load(true); }, function (er) { t.disabled = false; t.classList.remove('busy'); toast(er.message, true); });\n    return;\n  }\n});\ndocument.addEventListener('change', function (e) {\n  if (e.target.id === 'fComp') { S.comp = e.target.value; S.page = 0; renderTable(); }\n  if (e.target.id === 'fSort') { S.sort = e.target.value; S.page = 0; renderTable(); }\n  if (e.target.id === 'aUnread') { S.aUnread = e.target.checked; renderAlerts(); }\n});\ndocument.addEventListener('input', function (e) {\n  if (e.target.id === 'q') { clearTimeout(e.target._t); var v = e.target.value; e.target._t = setTimeout(function () { S.q = v; S.page = 0; renderTable(); }, 120); }\n});\ndocument.addEventListener('keydown', function (e) {\n  if (e.key === 'Escape') closeAll();\n  if (e.key === '/' && !/input|select|textarea/i.test(document.activeElement.tagName)) { if (S.tab !== 'products') go('products'); var q = $('#q'); if (q) { e.preventDefault(); q.focus(); } }\n});\n\n$('#btnRun').onclick = function () {\n  var b = this; if (b.disabled) return;\n  b.disabled = true; b.classList.add('busy');\n  run('runCheckNow', [], function (p) { if (D) D.progress = p; updateProgress(p); toast('Check started · الفحص شغال في الخلفية، تقدر تقفل الصفحة'); },\n    function (e) { b.disabled = false; b.classList.remove('busy'); toast(e.message, true); });\n};\n\n/* theme */\n(function () {\n  var saved = null; try { saved = localStorage.getItem('pr-theme'); } catch (e) {}\n  var theme = saved || 'dark';\n  function apply() { document.documentElement.setAttribute('data-theme', theme); }\n  apply();\n  $('#btnTheme').onclick = function () { theme = theme === 'dark' ? 'light' : 'dark'; apply(); try { localStorage.setItem('pr-theme', theme); } catch (e) {} };\n})();\n\nload();\nsetInterval(function () { if (!document.hidden && (!D || !D.progress || D.progress.status !== 'running')) load(); }, 10 * 60 * 1000);\n})();\n</script>\n\n</body>\n</html>\n";
