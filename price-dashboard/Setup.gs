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
  ['Compumarts', 'https://www.compumarts.com', 'Monitors, Laptops, Gaming, PC', '', true],
  ['Sigma Computer', 'https://www.sigma-computer.com', 'Monitors, Laptops, Gaming, PC', 'custom', true],
  ['El Badr Group', 'https://elbadrgroupeg.store', 'Monitors, Laptops, Gaming, PC', '', true],
  ['Games World Egypt', 'https://www.gamesworldegypt.com', 'Monitors, Gaming', '', true],
  ['Elyamama Store', 'https://elyamamastore.com', 'Monitors, Laptops, Gaming', '', true],
  ['B.TECH', 'https://btech.com', 'All', 'custom', true],
  ['Raya Shop', 'https://www.rayashop.com', 'All', 'custom', true],
  ['Jumia', 'https://www.jumia.com.eg', 'All', 'custom', true],
  ['Amazon.eg', 'https://www.amazon.eg', 'All', 'custom', true]
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
