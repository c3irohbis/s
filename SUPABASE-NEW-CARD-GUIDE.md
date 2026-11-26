# دليل إضافة كارت أو ميزة جديدة على Supabase

> اقرأ الملف ده **قبل** ما تبدأ أي كارت أو ميزة جديدة تشتغل على Supabase زي الكروت المنقولة
> (الأخبار، المحاضرات، الامتحانات، السكاشن، شيتاتي، الجدول الدراسي، العسكرية، المصاريف، مستنداتي، الحضور، التعليمات).
> الهدف: أي إضافة جديدة تمشي بنفس النمط بالظبط، من غير إعادة تصميم، ومن غير ما الموقع يقع.
> دليل كروت المنتدى (الشكل والشارات) في `FORUM-NEW-CARD-GUIDE.md`. ده دليل الربط بالسيرفر.

---

## 0) الفكرة في 8 أسطر

1. البيانات بتعيش في جداول Supabase (Postgres). ممنوع أي قراءة أو كتابة مباشرة على الجداول من المتصفح.
2. كل عملية بتعدي على **دالة RPC** في قاعدة البيانات، والدالة هي اللي بتتحقق من صلاحية المستخدم من جدول `public.app_authority`.
3. المتصفح مبيكلمش Supabase مباشرة (إلا إشارة ثابتة للتحديث اللحظي). المتصفح بيكلم **الـWorker** (`worker/bliss-gateway.js`) على مسار `/v1/<card>/...` بتوكن Firebase.
4. الـWorker بيتحقق من التوكن، وبعدين بينادي الـRPC بمفتاح الخدمة (السرّي مبيتكتبش في المتصفح أبدًا).
5. لكل كارت **مفتاح وضع** (flag): `firebase` أو `supabase`. المفتاح موجود في مكانين: عند الـWorker (KV اسمه `FLAGS`) وعند المتصفح (`js/<card>-config.js`). لو المفتاح `firebase` الكود القديم بيشتغل، ولو `supabase` المسار الجديد بيشتغل. ده خط الرجوع.
6. أي مسار جديد **لازم يفشل مقفول**: لو حاجة ناقصة أو غلط، يرجّع خطأ، ميرجعش يستخدم Firestore ولا يكمّل ببيانات ناقصة.
7. قواعد Firestore بتتحطّم للكارت المنقول (قراءة محفوظة + كتابة مقفولة) عشان مفيش كود قديم يكتب في مكانين.
8. مفيش نشر من غير مراجعة خارجية 9.5/10 أو أكتر، واختبارات، وتجربة حية على الموقع.

---

## 1) قاعدة البيانات: `worker/<card>.sql`

اعمل ملف SQL جديد بنفس نمط الموجود (أمثلة كاملة: `worker/news.sql` للكروت العامة، `worker/attendance.sql` و`worker/attendance-records.sql` لكارت فيه جدولين، `worker/military.sql` للمحتوى المشترك).

القواعد الثابتة في أي ملف SQL:

- **اسماء الجداول** بادئة الكارت: `<card>_items` أو `<card>_records`... إلخ.
- **عزل العوالم إجباري**: كل صف فيه `world_id` بصيغة `(is|lt|th|ba)_[1-4]`، مع `check` على العمود. مفيش صف من غير عالم.
- **تحقق صارم على الأعمدة**: `check(length(...))` على النصوص، و`check` على الصيغ (زي `id ~ '^[A-Za-z0-9_-]{1,128}$'`).
- **قفل RLS على كل جدول**:
  ```sql
  alter table public.<card>_items enable row level security;
  revoke all on public.<card>_items from public, anon, authenticated, service_role;
  ```
  (الوصول كله عن طريق الـRPCs بس، مش بصلاحيات الجدول.)
- **دوال RPC** باسم `<card>_list` و`<card>_mutate` وغيرها حسب الحاجة. كل دالة:
  - أول سطر منطقي: تجيب دور المستخدم من `public.app_authority` بالـ `p_uid` اللي جاي من الـWorker، وترفض لو مفيش صلاحية (`raise exception 'authority-denied'`).
  - التحقق من كل المدخلات جوه الدالة، مش في الـWorker بس.
  - الكتابة بتسجّل في جدول تدقيق `<card>_audit` (مين عمل إيه وإمتى).
- **الصلاحيات في آخر الملف**:
  ```sql
  revoke all on function public.<card>_list(...) from public, anon, authenticated;
  grant execute on function public.<card>_list(...) to service_role;
  ```
- **إشارة التحديث اللحظي** (لو الكارت محتاج تحديث فوري): جدول ثابت بسطر واحد زي `news_signal`:
  ```sql
  create table if not exists public.<card>_signal(id integer primary key check(id=1));
  ```
  الـRPC بيعمل `update` للسطر ده بعد أي تغيير. **ممنوع تحط أي بيانات حقيقية في جدول الإشارة** — هو مجرد "حصل تغيير" وخلاص.

تنفيذ الملف: الصقه في محرر SQL بتاع Supabase (اللوحة) وشغّله مرة واحدة. مفيش أداة ترحيل تلقائية في الريبو.

---

## 2) مسارات الـWorker: `worker/<card>-routes.js` + التوصيل في `bliss-gateway.js`

### (أ) ملف المسارات

انسخ نمط `worker/news-routes.js` (أبسط مثال كامل). الثوابت:

- التوقيع: `export async function handle<Card>(request, env, user, {rpc, enabled})`.
- **الهوية من الـWorker بس**: `user.sub` هو الـuid المتحقق منه من توكن Firebase. ممنوع تثق في أي uid جاي في جسم الطلب.
- **افشل مقفول**: أول حاجة `if(!enabled) return reply(503, {error:'<card>-disabled'});`
- قراءة جسم الطلب بحد أقصى للحجم (64KB في الأخبار) وبمهلة، ورفض أي JSON مش كائن.
- كل عملية بتنادي RPC واحد: `await rpc('<card>_list', {p_uid: user.sub, p_world: world, ...})`.
- ترجمة الأخطاء ثابتة: `authority-denied` → 403، `invalid` → 400، `conflict` → 409، غير كده → 503. الرد الناجح لازم يكون `{source:'supabase', complete:true, data:...}` (العميل بيتحقق من العلامتين دول).

### (ب) التوصيل في `worker/bliss-gateway.js`

1. ضيف الاستيراد في أول الملف:
   ```js
   import {handle<Card>} from './<card>-routes.js';
   ```
2. ضيف مفتاح الكارت في قائمة `CARD_KEYS` (سطر 38 تقريبًا):
   ```js
   const CARD_KEYS = ["news","lectures",...,"attendance","<card>"];
   ```
   من غير الخطوة دي المفتاح هيفضل `firebase` مهما كتبت في KV.
3. ضيف توجيه المسار في مكان الإخوة (حوالي سطر 1169-1206):
   ```js
   if(url.pathname.startsWith('/v1/<card>/')){
     const response=await handle<Card>(request,env,user,{enabled:(await readFlags(env)).<card>==='supabase',rpc:async(name,body)=>{const r=await sb(env,'/rpc/'+name,{method:'POST',body});if(!r.ok)throw Error(typeof r.data?.message==='string'?r.data.message:'<card>-backend');return r.data;}});
     if(response)return response;
   }
   ```
4. انشر الـWorker (ارفع `bliss-gateway.js` والملفات الجديدة على Cloudflare).

---

## 3) مفاتيح الأوضاع (خط الرجوع)

- **عند الـWorker**: KV binding اسمه `FLAGS` فيه مفتاح `flags` بصيغة JSON: `{"<card>":"firebase"|"shadow"|"gateway"|"supabase"}`. القيم المقبولة في `VALID_MODES`. لو KV مش موجود بيستخدم المتغير `FLAGS_DEFAULT`، ولو الاتنين مش موجودين بيقع على `firebase` (مش بيهنج).
- **عند المتصفح**: ملف `js/<card>-config.js`:
  ```js
  window.__BLISS_<CARD>_MODE='supabase';
  window.__BLISS_<CARD>_ANON_KEY="<المفتاح العام بتاع Supabase>";
  ```
  المفتاح ده **عام ومقصود يتنشر** (صلاحيته قراءة الإشارة الثابتة بس، كل الجداول مقفولة عليه). بس متكتبش أي مفتاح خدمة أو سر في أي ملف متصفح.
- التدرج متاح: فيه وضع `gateway-owner` بيجرّب المسار الجديد للمالك بس قبل باقي الناس.

---

## 4) ملفات المتصفح

بالترتيب (أمثلة حية بين القوسين):

1. `js/<card>-config.js` — المفتاح + المفتاح العام (فوق).
2. `js/<card>-client.js` — غلاف النقل (انسخ `js/news-client.js`). الثوابت:
   - جذر الرابط: `https://bliss-gateway.cairohbis.workers.dev/v1/<card>/`.
   - كل طلب بيبعت توكن Firebase في الهيدر `Authorization`، وبيرفض لو الحساب اتبدل نص الطلب (`news-account-changed`).
   - **تحقق صارم من الرد**: `if(j.source!=='supabase'||j.complete!==true||!j.data)throw ...` — ممنوع تكمّل برد ناقص.
   - التحديث اللحظي: WebSocket على قناة Realtime مشترك على UPDATE في `<card>_signal` بس، مع فصل عند إخفاء التبويب وإعادة اتصال.
   - في الآخر: `window.<Card>API={request,subscribe,enabled:()=>window.__BLISS_<CARD>_MODE==='supabase'};`
3. `js/<card>-feed.js` (اختياري) — العرض والمزامنة زي `js/news-feed.js` و`js/exams-feed.js`.
4. `js/<card>-notifications.js` (اختياري) — إشعارات الكارت زي `js/news-notifications.js`.
5. **التوصيل في `index.html`**: سطور `<script>` للملفات الجديدة بجوار أخواتها (كل ملف ليه سطر منفصل وسطر preload لو لازم). لو القسم بيتفتح عند الطلب، ضيف مجموعته في `lazy-sections.js` (نفس نمط `StudyScheduleModule`/`SheetatyModule`).
6. لو الكارت بيستبدل وحدة قديمة من `js/app/`، استخدم الـimport map في `index.html` لتحويل المسار القديم لحزمة جديدة (نمط `p-content-loaders-forum.js` ← `forum-feed.js`).
7. لو فيه إضافة محتوى من لوحة المالك، ضيف التحويلة الشرطية في `js/app/q-add-content.js` (نفس نمط سطر 24: لو المفتاح `supabase` استخدم `<Card>Feed.add` وإلا المسار القديم).
8. لو الكارت ليه شارة غير مقروء أو إعدادات إشعارات: سجّله في `js/forum-badges.js` (قائمة `SOURCES` + سطور التخطي الشرطية) وفي `js/notif-settings.js` (مفاتيح التفضيلات) بنفس نمط الموجود.

---

## 5) سياج قواعد Firestore

القواعد مش في الريبو — بتتعدل في **Firebase Console** وتتنشر من هناك (نسخة مرجعية قديمة في `docs/firestore-rules-reference.txt`، والمصدر دايمًا هو المنشور فعليًا). لكل مجموعة قديمة اتنقلت:

1. خلّي القراءة زي ما هي (عشان أي كود قديم لسه شغال ما يقعش).
2. اقفل الكتابة: `allow write: if false;` على المجموعة.
3. **مهم**: ضيف اسم المجموعة لقوائم الاستبعاد في صناديق الوايلدكارد بتاعة المالك/الأدمن، وإلا الوايلدكارد بيفتح الكتابة من ورا السياج (دي غلطة حصلت فعلًا واتصححت — السياج الأولاني كان فيه ثغرة وايلدكارد على `users/{uid}/{sub}` واتقفلت بإضافة "attendance" لقائمة الاستبعاد).
4. انشر القواعد وخزّن رقم الـruleset عشان التراجع.

---

## 6) الاختبارات والمراجعة (قبل النشر)

1. **اختبارات وحدة**: ملف `tests/<card>.test.cjs` بنمط `tests/attendance-records.test.cjs` (node:test + صندوق vm بمحاكاة window/fetch). شغّلها بـ`node --test tests/`.
2. **مراجعة خارجية إجبارية**: ابعت الكود للمراجع الخارجي، والحد الأدنى للقبول **9.5/10** قبل أي نقل أو تقليب مفاتيح. لو رجّع ملاحظة، صحّحها أو ناقشها بسطر الكود بالظبط.
3. **تجربة حية بعد النشر**: سجّل دخول طالب ومالك على الموقع المنشور، وراقب الشبكة: لازم كل طلبات الكارت تروح `/v1/<card>/...` و**صفر** طلبات Firestore لمجموعات الكارت. جرّب الحفظ والقراءة والإحصائيات وقراءة المالك عبر الطلاب.

---

## 7) البناء والنشر (نسخة ثابتة + قناتين)

الموقع بينشر **نسخ ثابتة غير قابلة للتعديل**: كل نشر = مجلد `release/<generation>` (الـgeneration = بصمة sha256 للمدخلات) + ملف `manifests/<generation>.json` + تحديث `release-channel.json` (epoch + generation).

1. **صلّح المصدر أولًا** واعمل PR عادي لملفات `js/` و`worker/` و`tests/` (ممنوع نشر شجرة قديمة كاملة — النسخة بتتبني من أب نظيف).
2. **ابني النسخة بسكربت ناشر** بنمط `scripts/build-instructions-release.py`:
   - حدّد `parent` (جيل النسخة الحالية) و`patches` (الملفات اللي اتغيرت بس).
   - السكربت بيحسب الـgeneration، بيبني `release/<generation>` من الأب + الباتشات، بيحدّث الـmanifest و`release-channel.json`، بيحدّث روابط `/s/release/<gen>/` في الحزم، وبيشغّل `scripts/build-direct.py` في الآخر.
3. **PR تاني للنسخة** (مجلد الإصدار + القناة) وادمجه. الموقع والـservice worker بيلتقطوا الجيل الجديد من القناة.
4. الملفات دي مرجعية في الجذر (زي الدليل ده) مش بتتنشر على الموقع — PR المصدر كفاية ليها.

---

## 8) التراجع (الرجوع لـFirebase)

لو المسار الجديد بوظ:

1. **المتصفح**: بدّل `window.__BLISS_<CARD>_MODE` في `js/<card>-config.js` لـ`'firebase'` وانشر (أو ارجع لنسخة قديمة كاملة — القناة فيها تاريخ الأجيال).
2. **الـWorker**: حطّ `"<card>":"firebase"` في مفتاح `flags` في KV (أو في `FLAGS_DEFAULT`). المسارات هترجع 503 والكود القديم هيتجاهلها.
3. **القواعد**: ارجع للـruleset السابق في Firebase Console (برقمه اللي خزّنته في الخطوة 5.4) عشان الكتابة ترجع مفتوحة.
4. البيانات اللي اتكتبت في Supabase مش بتتمسح بالتراجع — التراجع بس بيوقف استخدامها. قرار المسح قرار لوحده.

---

## 9) أخطاء متكررة (متعملهاش)

- كتابة أو قراءة Supabase من المتصفح مباشرة على جدول — الوصول كله عبر الـWorker والـRPC.
- نسيان الكارت في `CARD_KEYS` فالمفتاح يفضل `firebase` بصمت.
- كود عميل بيكمّل برد ناقص أو بيقع على Firestore لما SQL يفشل — المسار الجديد يفشل مقفول دايمًا.
- نسيان استبعاد المجموعة من وايلدكارد المالك في القواعد — بيفتح الكتابة من ورا السياج.
- بيانات حقيقية في جدول الإشارة `<card>_signal` — الإشارة سطر ثابت بس.
- نشر شجرة ملفات قديمة كاملة بدل البناء من أب نظيف بالناشر.
- تقليب المفاتيح قبل مراجعة 9.5+ وتجربة حية.
- أسرار (مفتاح خدمة، توكنات، uid مالك) في ملفات المتصفح أو في أي ملف متابع في git.
