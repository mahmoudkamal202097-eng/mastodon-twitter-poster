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
    alerts: [], hist: [], checked: {}, checkedUrl: {}, logs: [], done: 0, failed: 0 };
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
      if (m.row) { ctx.checked[m.row] = now; ctx.checkedUrl[m.row] = m.url; }
      const p = ctx.products[m.sku];
      if (!ctx.seed && p) alertsFor_(m.sku, m.competitor, old, { price: r.price, inStock: r.inStock }, Number(p.Our_Price), now).forEach(a => ctx.alerts.push(a));
    } else if (r && r.price == null && !r.inStock && r.hasAvail && old) {
      // الصفحة بتقول "نفذ" ومفيش سعر ظاهر → نحتفظ بآخر سعر ونعلّم Out of stock
      ctx.done++;
      ctx.priceRows[idx] = [m.sku, m.competitor, old.price, false, now];
      ctx.hist.push([m.sku, m.competitor, old.price, false]);
      if (m.row) { ctx.checked[m.row] = now; ctx.checkedUrl[m.row] = m.url; }
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
    const rng = sh.getRange(2, col, last - 1, 2), vals = rng.getValues();   // Last_Checked + Checked_URL
    rows.forEach(r => { vals[Number(r) - 2][0] = ctx.checked[r]; vals[Number(r) - 2][1] = ctx.checkedUrl[r] || ''; });
    rng.setValues(vals); ctx.checked = {}; ctx.checkedUrl = {};
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
  // دفعة كبيرة بتتفحص بالتوازي، والكتابة في الشيت (الأبطأ) مرة كل ~4 دفعات مش كل دفعة
  const group = Math.max(1, Math.round(getNum_('batch_size', 25))) * 2;
  let sinceFlush = 0;
  while (s.i < list.length && left() > 40000) {
    const chunk = list.slice(s.i, s.i + group);
    applyChecks_(ctx, checkMatches_(chunk));
    s.i += chunk.length; sinceFlush++;
    if (sinceFlush >= 4 || s.i >= list.length) { flushCtx_(ctx); sinceFlush = 0; setState_(s); }
  }
  if (sinceFlush) flushCtx_(ctx);
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
