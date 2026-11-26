// لقطة محتوى كروت بريق: تُبنى مرة واحدة لكل عالم وتُخزَّن في KV وتتشاركها كل الطلبة.
// بيانات كروت عامة فقط (عناوين وتواريخ منشورة من الإدارة) — لا بيانات طالب، ولا درجات، ولا مفقودات، ولا محتوى ملفات.
// التكلفة وقت السؤال: صفر قراءات Supabase وصفر قراءات Firestore — قراءة KV واحدة (مشمولة بلا حد عملي في خطة العمال المجانية)،
// وعليها كاش ذاكرة داخل النسخة 5 دقائق. البناء يحدث مرة عند أول سؤال بعد الإبطال أو انتهاء TTL، وهو الذي يقرأ قاعدة البيانات.
// التحديث: إبطال فوري بعد أي تعديل ناجح على كارت عام (/v1/<card>/mutate) + TTL احتياطي 24 ساعة.
//
// حدود الصدق الموثقة:
// - كاش الذاكرة محلي النسخة: نسخة أخرى قد تقدم لقطة أقدم حتى 5 دقائق بعد التعديل (نافذة ركود مقبولة وموثقة).
// - منع بعث اللقطة القديمة: جيل (generation) دائم في KV يُقرأ قبل البناء وقبل النشر؛ تغيّره يلغي النشر (B2).
// - لا تُنشر لقطة ناقصة أبدًا: الباني يعيد نصًا فاضيًا عند فشل أي كارت، والفارغ لا يُنشر ولا يمسح لقطة صالحة سابقة (B3).
const SNAP_KV_TTL_MS = 24 * 60 * 60 * 1000; // صلاحية اللقطة في KV (فحص الطابع الزمني داخل السجل هو الحكم)
const SNAP_KV_EXPIRE_S = 86400; // مطابق لـ SNAP_KV_TTL_MS (24 ساعة)
const SNAP_MEM_MS = 5 * 60 * 1000; // كاش ذاكرة النسخة (أفضل جهد، موثق — نافذة الركود العابرة للنسخ)
const SNAP_MAX_CHARS = 6000;
const SNAP_MAX_FIELD = 80;
const MAP_LIMIT = 50;

const _mem = new Map(); // world -> { at, got, text }
const _locks = new Map(); // world -> Promise — تسلسل البناء داخل النسخة، مع تنظيف المدخلات المكتملة (B4)

// تنظيف أي نص قادم من قاعدة البيانات قبل دخوله البرومبت: يكسر محارف التحكم والتغليف والاتجاه
export function cleanSnapshotField(s, n) {
  return String(s == null ? "" : s)
    .replace(/[\r\n\t<>«»`\\{}\[\]\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n || SNAP_MAX_FIELD);
}

export function snapshotKey(world) { return "ai:snapshot:" + world; }
function genKey(world) { return "ai:snapgen:" + world; }
const GLOBAL_GEN_KEY = "ai:snapgen"; // يُرفع عند كل إبطال حتى لو لم توجد لقطة بعد — يمنع نشر بناء قديم بدأ قبل التعديل

async function readGen(env, world) {
  try {
    const g = await env.FLAGS.get(GLOBAL_GEN_KEY);
    const w = await env.FLAGS.get(genKey(world));
    return (g || "0") + "|" + (w || "0");
  } catch (_) { return null; } // KV متعطل: لا نشر ولا قراءة — فشل مفتوح
}

// قراءة اللقطة مع التحقق من الجيل: سجل بجيل قديم (حذف فاشل بعد تعديل) يُعامل كأنه غير موجود.
// تكلفة السؤال: قراءتا KV متوازيتان (الجيل + اللقطة) — لا Supabase ولا Firestore.
// حد الصدق: KV متسق نهائيًا عبر المناطق؛ نافذة الانتشار النموذجية ≤ 60 ثانية موثقة كحد ركود إضافي أقصى،
// يضاف لكاش الذاكرة 5 دقائق داخل النسخة. الإبطال الفاشل يُسجَّل console.warn ولا يكسر رد التعديل الأصلي.
async function kvSnapshot(env, world) {
  try {
    const [gen, rec] = await Promise.all([readGen(env, world), env.FLAGS.get(snapshotKey(world), { type: "json" })]);
    if (gen === null) return null;
    if (rec && typeof rec.text === "string" && typeof rec.at === "number" && Date.now() - rec.at < SNAP_KV_TTL_MS && rec.gen === gen) return rec;
  } catch (_) {}
  return null;
}

export async function invalidateAISnapshot(env, world) {
  _mem.delete(world);
  if (!env.FLAGS) return;
  const tok = crypto.randomUUID();
  try { await env.FLAGS.put(genKey(world), tok); } catch (e) { console.warn("ai-snapshot-invalidate-failed", e); }
  try { await env.FLAGS.put(GLOBAL_GEN_KEY, tok); } catch (e) { console.warn("ai-snapshot-invalidate-failed", e); }
  try { await env.FLAGS.delete(snapshotKey(world)); } catch (e) { console.warn("ai-snapshot-invalidate-failed", e); }
}

// إبطال كل العوالم بعد أي تعديل ناجح على كارت عام — مع ترقيم صفحات قائمة KV (B6)
export async function invalidateAllAISnapshots(env) {
  _mem.clear();
  if (!env.FLAGS) return;
  try { await env.FLAGS.put(GLOBAL_GEN_KEY, crypto.randomUUID()); } catch (e) { console.warn("ai-snapshot-invalidate-failed", e); }
  try {
    let cursor;
    for (let page = 0; page < 5; page++) { // سقف 5 صفحات (~5000 مفتاح) — موثق؛ نشر عوالم أكثر يستلزم رفعه
      const list = await env.FLAGS.list(cursor ? { prefix: "ai:snapshot:", cursor } : { prefix: "ai:snapshot:" });
      for (const k of (list && list.keys) || []) {
        try { await env.FLAGS.delete(k.name); } catch (e) { console.warn("ai-snapshot-invalidate-failed", e); }
        const world = k.name.slice("ai:snapshot:".length);
        if (world) { try { await env.FLAGS.put(genKey(world), crypto.randomUUID()); } catch (e) { console.warn("ai-snapshot-invalidate-failed", e); } }
      }
      cursor = list && list.cursor;
      if (!cursor || (list && list.list_complete)) break;
    }
  } catch (e) { console.warn("ai-snapshot-invalidate-failed", e); }
}

// world يحدده الخادم (عالم مالك اللقطة) ولا يأتي من العميل. build تبني النص أو تعيد "" عند أي فشل (لا نشر لناقص).
// يعيد { text, at } أو null.
export async function getAISnapshot(env, world, build) {
  if (!env.FLAGS || typeof world !== "string" || !world) return null;
  const m = _mem.get(world);
  if (m && Date.now() - m.got < SNAP_MEM_MS) return { text: m.text, at: m.at };

  let rec = await kvSnapshot(env, world);
  if (!rec && typeof build === "function") {
    const existing = _locks.get(world);
    if (!existing && _locks.size >= MAP_LIMIT) return null; // فحص السعة قبل إنشاء أي وعد: البناء المرفوض لا يُجدول أبدًا (B11)
    const prev = existing || Promise.resolve(null);
    const next = prev.then(async () => {
      const again = await kvSnapshot(env, world); // إعادة فحص داخل القفل: طلب متزامن قد بناها للتو
      if (again) return again;
      const g0 = await readGen(env, world);
      if (g0 === null) return null;
      let built = "";
      try { built = String((await build()) || "").slice(0, SNAP_MAX_CHARS); } catch (_) { built = ""; }
      if (!built) return null; // باني فاشل/ناقص: لا نشر ولا مسح للصالح السابق
      const g1 = await readGen(env, world);
      if (g1 === null || g0 !== g1) return null; // تعديل حدث أثناء البناء: لا نشر لبيانات قديمة
      const out = { at: Date.now(), gen: g0, text: built };
      try { await env.FLAGS.put(snapshotKey(world), JSON.stringify(out), { expirationTtl: SNAP_KV_EXPIRE_S }); } catch (_) { return null; }
      return out;
    });
    const lock = next.catch(() => null);
    _locks.set(world, lock);
    try { rec = await next; }
    finally { if (_locks.get(world) === lock) _locks.delete(world); } // تنظيف المدخلات المكتملة بهوية دقيقة
  }
  if (rec && rec.text) {
    _mem.set(world, { at: rec.at, got: Date.now(), text: rec.text });
    if (_mem.size > MAP_LIMIT) _mem.clear(); // حد ذاكرة: يعيد بناء الكاش (أفضل جهد، موثق)
    return { text: rec.text, at: rec.at };
  }
  return null;
}
