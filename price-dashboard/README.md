# PriceRadar — Geeks Store

أداة مراقبة أسعار المنافسين: Google Apps Script + Google Sheets (قاعدة البيانات) + داشبورد Web App.

## الملفات

| ملف | وظيفته |
|---|---|
| `Config.gs` | الثوابت، أسماء الشيتات، الإعدادات الافتراضية، helpers للشيت والكاش |
| `Setup.gs` | `setup()` ينشئ الشيتات + المنافسين + الروابط الأولية (68 رابط من مسح 18 نوفمبر) |
| `OurProducts.gs` | `syncOurProducts()` — **مصدر منتجاتنا من تاب Settings** (أو عدّل `fetchOurItems_()`) |
| `Scraper.gs` | قراءة السعر/التوفر: Shopify `.js` → Woo Store API → JSON-LD → meta/regex، مع `fetchAll` + retry |
| `Matcher.gs` | المطابقة (SKU/Model ثم تشابه الاسم) + نطاق الفئات لكل منافس |
| `Compare.gs` | منطق المقارنة والتصنيف والـ Gap % (دوال صافية) |
| `Alerts.gs` | التنبيهات + الملخص اليومي بالإيميل |
| `Triggers.gs` | الجدولة + الـ Queue (cursor في PropertiesService + LockService) |
| `Api.gs` | `doGet` + كل دوال الداشبورد |
| `Dashboard.html` / `Style.html` / `Script.html` | الداشبورد |
| `PriceRadar-AllInOne.gs` | **كل ده في ملف واحد** للصق السريع |

## النشر (10 دقايق)

1. افتح <https://script.new> وسمّي المشروع **PriceRadar**.
2. **أسهل طريقة:** امسح محتوى `Code.gs` والصق `PriceRadar-AllInOne.gs` كله.
   (أو أنشئ الملفات واحد واحد بنفس الأسماء: الـ `.gs` كـ Script، والـ `.html` كـ HTML.)
3. من ⚙️ Project Settings فعّل **Show "appsscript.json"** والصق محتوى `appsscript.json`.
4. اختار الدالة **`setup`** ← Run ← وافق على الصلاحيات (Sheets / External requests / Triggers / Mail).
   - بتنشئ Google Sheet جديد (اللينك في Executions → Logs أو في تاب Logs).
   - بتجيب منتجاتنا، وتربط الروابط الأولية، وتكتشف نوع منصة كل منافس.
5. شغّل **`installTriggers`** مرة واحدة (فحص 9 / 14 / 20 بتوقيت القاهرة + مزامنة كل 6 ساعات).
6. **Deploy ← New deployment ← Web app** → Execute as: *Me* → Who has access: *Only myself* → Deploy. افتح الرابط.
7. من الداشبورد اضغط **Run check now** — الفحص بيشتغل في الخلفية وتقدر تقفل الصفحة.

> أي تعديل في `Settings` (ساعات الفحص مثلًا) → شغّل `installTriggers()` تاني.

## القواعد المطبّقة

- بنراقب المنتجات **In stock / Pre-order فقط**؛ اللي ينفد عندنا بيتشال من Products ويرجع تلقائيًا.
- كل منافس بيتقارن **بفئاته بس** (عمود `Categories` في تاب Competitors، `All` = كل الفئات). عدّلها بما يطابق أسماء فئات متجرك.
- مفيش صفوف فاضية/فاشلة في `Prices`؛ الفشل بيتسجل في `Logs` بس.
- الروابط **manual** ليها أولوية وما بتتمسح ولا بتتكتب فوقها أبدًا.
- المقارنة بتحسب المنافسين **المتوفرين فقط**؛ الـ Out of stock رمادي وخارج الحساب.
- سعر أقل من 500 ج = placeholder ويتتجاهل.
- ثقة المطابقة التلقائية < `match_min_confidence` (0.8) ← **Needs your help** (لينك مرشّح بدون سعر لحد ما تأكده).

## حدود لازم تعرفها

- **اتبنى واتختبر منطقه بالـ unit tests على أمثلة (JSON-LD / Shopify `.js` / Woo / Amazon / المطابقة / التصنيف / التنبيهات)، بس ما اتجربش على Apps Script الحقيقي ولا على مواقع المنافسين** (بيئتي ما بتوصلش لها). أول تشغيل هو الاختبار الحقيقي — راجع تاب `Logs`.
- **Amazon.eg / Jumia / Noon / B.TECH** ممكن يحجبوا طلبات Google أو يعرضوا الأسعار بـ JavaScript؛ هتلاقي أخطائهم في `Logs` (HTTP 403/503 أو no price data).
- **البحث التلقائي** شغال بس مع Shopify و WooCommerce. المواقع الـ custom (Sigma وB.TECH مثلًا) بتحتاج رابط يدوي (زرار **Link** في الجدول).
- مطابقة بالاسم من غير SKU/Model (زي MacBook) محافظة عن قصد → غالبًا هتظهر Needs your help لحد ما تأكد اللينك.
- حد 6 دقايق: الفحص بيكمل على دفعات (Trigger استكمال كل دقيقتين) والداشبورد بتعرض الـ progress.

## الأمان

- الـ Web App `Only myself`. لو هتشاركه مع حد غيّر الـ access من Deploy ← Manage deployments.
- مفتاح Google Custom Search القديم ظاهر نصًا في شيت `market_research_geeks` — **اعمل له Restrict أو Rotate** من Google Cloud Console (الأداة الجديدة مش بتستخدمه).
