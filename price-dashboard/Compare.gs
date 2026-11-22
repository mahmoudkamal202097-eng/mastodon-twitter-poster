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

  const ovBy = {};
  (inp.overrides || []).forEach(o => { ovBy[String(o.SKU)] = o; });
  const matchBy = {}, priceBy = {};
  inp.matches.forEach(m => { matchBy[m.SKU + '|' + m.Competitor] = m; });
  inp.prices.forEach(p => { priceBy[p.SKU + '|' + p.Competitor] = p; });

  const catCount = {};
  let lastChecked = 0;
  inp.prices.forEach(p => { const t = new Date(p.Checked_At).getTime(); if (t > lastChecked) lastChecked = t; });

  const products = inp.products.filter(p => !(ovBy[String(p.SKU)] && bool_(ovBy[String(p.SKU)].Hidden))).map(p => {
    const sku = String(p.SKU);
    const ov = ovBy[sku];
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
      sku: sku, n: String((ov && ov.Display_Name) || p.Name), orig: String(p.Name), renamed: !!(ov && ov.Display_Name), cat: String(p.Category), top: top, brand: String(p.Brand || ''), img: String(p.Image_URL || ''),
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
    byCategory: Object.keys(byCat).map(k => byCat[k]).sort((a, b) => (b.pricier + b.cheaper + b.same + b.only_us + b.other) - (a.pricier + a.cheaper + a.same + a.only_us + a.other)),
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
