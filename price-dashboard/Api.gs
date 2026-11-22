/**
 * PriceRadar — Api.gs
 * Web App + الدوال اللي الداشبورد بتناديها بـ google.script.run
 * (كلها بترجّع بيانات مجمّعة — مش الشيت كله — والـ dashboard متكاشّة CacheService).
 */

function doGet() {
  ensureReady_();
  return HtmlService.createTemplateFromFile('Dashboard').evaluate()
    .setTitle('Sales Navigator — Geeks Store')
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
    prices: readRows_(SHEET.PRICES), history: readRowsTail_(SHEET.HISTORY, 45000), alerts: readRows_(SHEET.ALERTS), overrides: readRows_(SHEET.OVERRIDES),
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
  try { d.sheetUrl = ss_().getUrl(); } catch (e) { d.sheetUrl = ''; }
  d.unread = readRows_(SHEET.ALERTS).filter(a => !bool_(a.Read)).length;
  resetSettingsCache_();
  d.settings = {
    same: getNum_('same_price_threshold_pct', 0.5), gap: getNum_('alert_gap_pct', 3), change: getNum_('alert_change_pct', 2),
    hours: getSetting_('refresh_hours'), syncEvery: getNum_('product_sync_every_hours', 6), fcSet: String(getSetting_('firecrawl_api_key') || '').trim().length > 10,
    email: getSetting_('email_digest_to') || ''
  };
  d.labels = {};
  ['only_us', 'same', 'cheaper', 'pricier', 'not_checked', 'needs_help'].forEach(k => d.labels[k] = getSetting_('label_' + k));
  return d;
}

/** تاريخ منتج واحد (للـ Drawer) */
function getProductHistory(sku) {
  return buildProductHistory_(readRowsTail_(SHEET.HISTORY, 80000), sku, 90);
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
    .map(m => ({ sku: sku, competitor: m.Competitor, url: String(m.Competitor_URL), platform: ctx.comps[m.Competitor].Platform_Type, row: m._row, spec: String(p.Name) }));
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
  if (obj && (obj.refresh_hours != null || obj.product_sync_every_hours != null || obj.email_digest_to != null || obj.digest_hour != null)) installTriggers();
  return true;
}

function runCheckNow() { return startCheck(); }
function getAlertsApi(filter) { return getAlerts(filter); }
function markAllAlertsRead(ids) { return markAlertsRead(ids); }


/* ======================= تعديل من جوه الداشبورد ======================= */

/** اسم عرض مخصص للمنتج (أو إخفاؤه) — بيتحفظ في تاب Overrides ومابيتمسحش مع المزامنة */
function renameProduct(sku, name, hidden) {
  sku = String(sku);
  const sh = sh_(SHEET.OVERRIDES);
  const ex = readRows_(SHEET.OVERRIDES).filter(o => String(o.SKU) === sku)[0];
  const row = [sku, String(name || '').trim(), !!hidden, ex ? ex.Note : ''];
  if (ex) sh.getRange(ex._row, 1, 1, 4).setValues([row]); else appendRows_(SHEET.OVERRIDES, [row]);
  clearCache_();
  return true;
}

/** تعديل منافس: الاسم/الموقع/الفئات/تفعيل — لو الاسم اتغيّر بيتحدّث في كل الشيتات */
function saveCompetitor(oldName, name, website, categories, active) {
  const c = readRows_(SHEET.COMPETITORS).filter(x => x.Competitor_Name === oldName)[0];
  if (!c) throw new Error('المنافس مش موجود');
  name = String(name || '').trim(); if (!name) throw new Error('اكتب اسم المنافس');
  if (name !== oldName && readRows_(SHEET.COMPETITORS).some(x => String(x.Competitor_Name).toLowerCase() === name.toLowerCase())) throw new Error('فيه منافس بنفس الاسم');
  const sh = sh_(SHEET.COMPETITORS);
  const siteChanged = String(website).replace(/\/+$/, '') !== String(c.Website).replace(/\/+$/, '');
  sh.getRange(c._row, 1, 1, 5).setValues([[name, String(website || c.Website).replace(/\/+$/, ''), String(categories || 'All'), siteChanged ? '' : c.Platform_Type, !!active]]);
  if (name !== oldName) {
    replaceColumn_(SHEET.MATCHES, 2, oldName, name); replaceColumn_(SHEET.PRICES, 2, oldName, name);
    replaceColumn_(SHEET.HISTORY, 3, oldName, name); replaceColumn_(SHEET.ALERTS, 4, oldName, name);
  }
  clearCache_();
  return true;
}
function replaceColumn_(sheetName, col, from, to) {
  const sh = sh_(sheetName), last = sh.getLastRow();
  if (last < 2) return;
  const rng = sh.getRange(2, col, last - 1, 1), v = rng.getValues();
  let n = 0; v.forEach(r => { if (r[0] === from) { r[0] = to; n++; } });
  if (n) rng.setValues(v);
}

/**
 * لصق لينكات بالجملة. كل سطر: المنتج (SKU أو جزء من الاسم) | المنافس | اللينك | ملاحظة (اختياري)
 * الفاصل: Tab أو ; أو | أو فاصلة. اللينكات بتتسجل manual (محمية) وبتتفحص فورًا.
 */
function parseBulkLines_(text) {
  return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map((l, i) => {
    let parts = l.split('\t');
    if (parts.length < 3) parts = l.split(/\s*[;|]\s*/);
    if (parts.length < 3) parts = l.split(/\s*,\s*(?=(?:https?:|[^,]*,\s*https?:))/);
    return { n: i + 1, raw: l, product: (parts[0] || '').trim(), competitor: (parts[1] || '').trim(), url: (parts[2] || '').trim(), note: (parts.slice(3).join(' ') || '').trim() };
  });
}

function bulkImportLinks(text) {
  const lines = parseBulkLines_(text);
  if (!lines.length) throw new Error('الصق سطر واحد على الأقل');
  const products = readRows_(SHEET.PRODUCTS), comps = readRows_(SHEET.COMPETITORS);
  const matches = readRows_(SHEET.MATCHES);
  const mIdx = {}; matches.forEach(m => mIdx[String(m.SKU) + '|' + m.Competitor] = m);
  const sh = sh_(SHEET.MATCHES);
  const report = { added: 0, updated: 0, errors: [] }, add = [];
  lines.forEach(L => {
    if (!/^https?:\/\//i.test(L.url)) { report.errors.push('سطر ' + L.n + ': اللينك لازم يبدأ بـ http'); return; }
    const comp = comps.filter(c => String(c.Competitor_Name).toLowerCase() === L.competitor.toLowerCase())[0];
    if (!comp) { report.errors.push('سطر ' + L.n + ': المنافس "' + L.competitor + '" مش موجود'); return; }
    const q = L.product.toLowerCase();
    let hit = products.filter(p => String(p.SKU).toLowerCase() === q);
    if (!hit.length) {
      const words = q.split(/\s+/).filter(Boolean);
      hit = products.filter(p => { const h = (String(p.Name) + ' ' + p.SKU).toLowerCase(); return words.every(w => h.indexOf(w) > -1); });
    }
    if (hit.length !== 1) { report.errors.push('سطر ' + L.n + ': ' + (hit.length ? hit.length + ' منتجات مطابقة — اكتب SKU أدق' : 'مفيش منتج مطابق لـ "' + L.product + '"')); return; }
    const key = String(hit[0].SKU) + '|' + comp.Competitor_Name, ex = mIdx[key];
    const row = [String(hit[0].SKU), comp.Competitor_Name, L.url, 'manual', 1, L.note || (ex ? ex.Note : ''), '', ''];
    if (ex) { sh.getRange(ex._row, 1, 1, 8).setValues([row]); report.updated++; }
    else { add.push(row); mIdx[key] = { _row: -1 }; report.added++; }
  });
  if (add.length) appendRows_(SHEET.MATCHES, add);
  clearCache_();
  report.check = checkNewLinks_(40);
  return report;
}

/** اللينكات اللي اتضافت/اتعدّلت (Competitor_URL ≠ Checked_URL) تتفحص دلوقتي (حد أقصى cap) */
function checkNewLinks_(cap) {
  const minConf = getNum_('match_min_confidence', 0.8);
  const ctx = loadCtx_(false);
  const pending = readRows_(SHEET.MATCHES).filter(m => ctx.products[String(m.SKU)] && ctx.comps[m.Competitor] && bool_(ctx.comps[m.Competitor].Active) &&
    validMatch_(m, minConf) && String(m.Competitor_URL).trim() !== String(m.Checked_URL).trim());
  const list = pending.slice(0, cap).map(m => ({ sku: String(m.SKU), competitor: m.Competitor, url: String(m.Competitor_URL).trim(), platform: ctx.comps[m.Competitor].Platform_Type, row: m._row, spec: String(ctx.products[String(m.SKU)].Name) }));
  if (list.length) { applyChecks_(ctx, checkMatches_(list)); flushCtx_(ctx); }
  return { pending: pending.length, checked: list.length, ok: ctx.done, failed: ctx.failed, remaining: Math.max(0, pending.length - list.length) };
}

/** زرار "Sync sheet": لو عدّلت لينكات/منافسين/أسماء في الشيت نفسه → ده بيقراهم فورًا ويفحص الجديد */
function syncSheetChanges() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) throw new Error('فيه فحص شغال دلوقتي، جرّب بعد دقيقة');
  try {
    resetSettingsCache_(); clearCache_();
    const r = checkNewLinks_(40);
    clearCache_();
    return r;
  } finally { lock.releaseLock(); }
}
