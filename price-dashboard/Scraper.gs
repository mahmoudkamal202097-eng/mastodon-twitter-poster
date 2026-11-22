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
