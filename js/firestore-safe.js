/* ══════════════════════════════════════════
   js/firestore-safe.js — طبقة قراءة آمنة للعمل بدون إنترنت
   ══════════════════════════════════════════
   المشكلة: getDoc / getDocs الأصليين من Firebase بيحاولوا يوصلوا
   للسيرفر أولاً، ولو الجهاز أوفلاين (خصوصاً وقت فتح التطبيق من جديد
   وهو مقفول عليه فعلاً/TWA) بيفشلوا برسالة خطأ بدل ما يرجعوا فورًا
   للنسخة المخزّنة محليًا في الكاش (IndexedDB) — رغم إن الكاش
   (persistentLocalCache) مفعّل ومتوفر فيه البيانات فعلاً.
   النتيجة: محتوى بيختفي/يبقى غير مستقر وقت انقطاع النت.

   الحل: هذا الملف بيعيد تصدير (re-export) كل حاجة من firebase-firestore
   زي ما هي بالظبط، ما عدا getDoc و getDocs اللي بيستبدلهم بنسخة "آمنة":
   تحاول من السيرفر، ولو فشلت بترجع تلقائيًا للكاش المحلي بدل ما توقف.

   الاستخدام: بدّل مصدر الاستيراد من رابط فايربيز المباشر لهذا الملف —
   باقي الكود (doc/collection/query/...) هيفضل شغال زي ما هو بدون
   أي تعديل تاني.
══════════════════════════════════════════ */

export * from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  getDoc as _rawGetDoc,
  getDocs as _rawGetDocs,
  getDocFromCache,
  getDocsFromCache,
  addDoc as _rawAddDoc,
  setDoc as _rawSetDoc,
  updateDoc as _rawUpdateDoc,
  deleteDoc as _rawDeleteDoc,
  writeBatch as _rawWriteBatch,
  runTransaction as _rawRunTransaction
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export async function getDoc(ref) {
  try {
    return await _rawGetDoc(ref);
  } catch (e) {
    // فشل الوصول للسيرفر (غالبًا بسبب انقطاع النت) — نرجع للكاش المحلي
    try {
      return await getDocFromCache(ref);
    } catch (_e2) {
      throw e; // لا يوجد كاش أيضاً — نرفع الخطأ الأصلي
    }
  }
}

export async function getDocs(q) {
  try {
    return await _rawGetDocs(q);
  } catch (e) {
    try {
      return await getDocsFromCache(q);
    } catch (_e2) {
      throw e;
    }
  }
}

/* ══════════════════════════════════════════
   بوابة شارات المنتدى (forum-badges.js): بعد أي كتابة ناجحة بنبلّغ window.__forumGate
   بالمسار فقط، وهو اللي يقرر لو المجموعة مسجّلة كارت منتدى ويكتب البصمة في forumMeta.
   الأغلفة دي ما بتغيّر أي سلوك: نفس المعاملات ونفس القيمة المرجوعة، وأي خطأ في التبليغ
   بيتبلع (الكتابة الأصلية ما بتتأثرش أبدًا).
══════════════════════════════════════════ */
function _gate(op, ref, data, opts) {
  try {
    const g = globalThis.__forumGate;
    if (g && ref && typeof ref.path === "string") g.touch(op, ref.path, data, opts);
  } catch (_e) { /* تجاهل */ }
}

function _fieldsObj(args) {
  const a = args[0];
  if (a && typeof a === "object" && !Array.isArray(a) && typeof a.isEqual !== "function") return a;
  if (typeof a === "string") return { [a]: args[1] };
  return null;
}

export async function addDoc(ref, data) {
  const r = await _rawAddDoc(ref, data);
  _gate("add", ref, data);
  return r;
}

export async function setDoc(ref, data, opts) {
  const r = await _rawSetDoc(ref, data, opts);
  _gate("set", ref, data, opts);
  return r;
}

export async function updateDoc(ref, ...args) {
  const r = await _rawUpdateDoc(ref, ...args);
  _gate("update", ref, _fieldsObj(args));
  return r;
}

export async function deleteDoc(ref) {
  const r = await _rawDeleteDoc(ref);
  _gate("delete", ref);
  return r;
}

export function writeBatch(db) {
  const b = _rawWriteBatch(db);
  const log = [];
  const w = {
    set(ref, data, opts) { b.set(ref, data, opts); log.push(["set", ref, data, opts]); return w; },
    update(ref, ...args) { b.update(ref, ...args); log.push(["update", ref, _fieldsObj(args)]); return w; },
    delete(ref) { b.delete(ref); log.push(["delete", ref]); return w; },
    async commit() {
      const r = await b.commit();
      log.forEach((l) => _gate(l[0], l[1], l[2], l[3]));
      return r;
    }
  };
  return w;
}

export async function runTransaction(db, updateFn, options) {
  let log = [];
  const result = await _rawRunTransaction(db, (tx) => {
    log = [];
    const w = {
      get: (ref) => tx.get(ref),
      set(ref, data, opts) { tx.set(ref, data, opts); log.push(["set", ref, data, opts]); return w; },
      update(ref, ...args) { tx.update(ref, ...args); log.push(["update", ref, _fieldsObj(args)]); return w; },
      delete(ref) { tx.delete(ref); log.push(["delete", ref]); return w; }
    };
    return updateFn(w);
  }, options);
  log.forEach((l) => _gate(l[0], l[1], l[2], l[3]));
  return result;
}
