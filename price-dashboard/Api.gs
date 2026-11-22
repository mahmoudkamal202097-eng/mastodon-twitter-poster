/**
 * PriceRadar — Api.gs
 * Web App + الدوال اللي الداشبورد بتناديها بـ google.script.run
 * (كلها بترجّع بيانات مجمّعة — مش الشيت كله — والـ dashboard متكاشّة CacheService).
 */

function doGet() {
  ensureReady_();
  return HtmlService.createTemplateFromFile('Dashboard').evaluate()
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
