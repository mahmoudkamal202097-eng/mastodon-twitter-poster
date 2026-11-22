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
