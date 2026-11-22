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
