/**
 * ══════════════════════════════════════════
 *   LOST & FOUND MODULE — راحت فين؟
 *   found.js — أرشيف "لقيتها" + الإحصائيات + كل كتابة لحالة found
 * ══════════════════════════════════════════
 *
 *  مسؤوليته فقط:
 *   - عرض أرشيف المنشورات status=="found" (بدون تعليقات ولا تفاعل)
 *   - إحصائيات حقيقية من Firestore عبر getCountFromServer() (مش رقم ثابت)
 *   - الكتابة الوحيدة لتحويل الحالة published → found (markAsFound)
 *   - تصحيح found → published، Admin/Owner فقط (correctBack)
 *
 *  ما لا يفعله عمدًا:
 *   - لا تعليقات ولا إعجابات في الأرشيف (الأرشيف توثيقي بس)
 *   - لا يكتب أي حاجة تانية غير status/resolvedBy/resolvedAt (وresetها عند التصحيح)
 *   - إخفاء الأزرار هنا مش بديل عن التحقق — كل دالة كتابة بتتحقق بنفسها الأول
 *
 *  ⚠️ ملاحظة: الإحصائيات بتتحسب مرة واحدة عند فتح التاب (getCountFromServer قراءة
 *  لحظية، مش onSnapshot — Firestore مبيدعمش استماع مباشر لنتيجة count). قائمة
 *  الأرشيف بتتحمل بصفحات عند الطلب مع زر تحديث صريح.
 */

(function () {
  "use strict";

  window.__LF = window.__LF || {};
  const core = window.__LF.core;

  const PAGE_SIZE = 30;
  let _generation = 0, _container = null, _docs = [], _cursor = null;
  let _hasMore = true, _loading = false;
  function stop() { ++_generation; _loading = false; _container = null; }
  core.registerUnsubscribe(stop);

  /* ─────────────────────────────────────────
     الدخول من core.switchView("found")
  ───────────────────────────────────────── */
  function render(container) {
    stop(); _container = container; _docs = []; _cursor = null; _hasMore = true;
    container.innerHTML = `
      <div class="lf-found-toolbar"><span>الأرشيف حسب آخر تحديث</span> <button type="button" class="lf-found-refresh">تحديث</button></div>
      <div class="lf-found-stats">
        <div class="lf-stat"><span class="lf-stat-num">—</span><span class="lf-stat-label">تم العثور عليها</span></div>
      </div>
      <div class="lf-found-list"><div class="lf-loading"><i class="fa-solid fa-spinner fa-spin"></i></div></div>
    `;

    container.querySelector(".lf-found-refresh").addEventListener("click", () => render(container));
    renderStats(container.querySelector(".lf-found-stats"));
    loadNext();
  }

  /* ─────────────────────────────────────────
     الإحصائية — رقم "تم العثور عليها" بس، من غير أي عد لمنشورات لسه مفتوحة (published)
     عشان صفحة الأرشيف تفضل توثيقية 100% لحاجات اتلقت، مفيهاش أي إشارة لحاجات لسه بتتدور عليها
  ───────────────────────────────────────── */
  async function renderStats(statsEl) {
    if (!statsEl) return;
    const generation = _generation, uid = window.currentUser?.uid;
    try {
      const fs = await core.getFS();
      if (generation !== _generation || uid !== window.currentUser?.uid) return;
      const { db, collection, query, where, getCountFromServer } = fs;

      const foundQ = query(collection(db, "lostFound"), where("status", "==", "found"));
      const foundSnap = await getCountFromServer(foundQ);

      if (generation !== _generation || uid !== window.currentUser?.uid) return;
      const nums = statsEl.querySelectorAll(".lf-stat-num");
      if (nums[0]) nums[0].textContent = foundSnap.data().count;
    } catch (e) {
      console.error("[LostFound:found] فشل تحميل الإحصائيات", e);
      // فشل الإحصائيات لا يمنع عرض الأرشيف نفسه — قسم اختياري
    }
  }

  /* ─────────────────────────────────────────
     قائمة الأرشيف — صفحات بالمؤشر وتحديث صريح
  ───────────────────────────────────────── */
  async function loadNext() {
    if (_loading || !_hasMore || !_container) return;
    const generation = _generation, container = _container;
    const uid = window.currentUser?.uid;
    const current = () => generation === _generation && container === _container && uid === window.currentUser?.uid;
    _loading = true;
    const button = container.querySelector(".lf-found-more");
    if (button) button.disabled = true;
    try {
      const {db,collection,query,where,orderBy,startAfter,limit,getDocs} = await core.getFS();
      if (!current()) return;
      const clauses = [where("status", "==", "found"),orderBy("resolvedAt", "desc")];
      if (_cursor) clauses.push(startAfter(_cursor));
      const snap = await getDocs(query(collection(db,"lostFound"),...clauses,limit(PAGE_SIZE)));
      if (!current()) return;
      const seen = new Set(_docs.map(d=>d.id));
      snap.docs.forEach(d=>{if(!seen.has(d.id)) _docs.push({id:d.id,...d.data()});});
      if (snap.docs.length) _cursor = snap.docs[snap.docs.length-1];
      _hasMore = !!snap.metadata?.fromCache || snap.docs.length === PAGE_SIZE;
      renderList(container.querySelector(".lf-found-list"),_docs);
    } catch(e) {
      if (!current()) return;
      if (!_docs.length) renderError(container.querySelector(".lf-found-list"),"تعذر تحميل الأرشيف، اضغط تحديث للمحاولة");
      else window.toast?.("تعذر تحميل الصفحة التالية، حاول مرة أخرى", "error");
    } finally {
      if (current()) {
        _loading = false;
        const more = container.querySelector(".lf-found-more");
        if (more) more.disabled = false;
      }
    }
  }

  function removeLocal(postId) {
    if (!_container || !_docs.some(d=>d.id===postId)) return;
    _docs = _docs.filter(d=>d.id!==postId);
    renderList(_container.querySelector(".lf-found-list"),_docs);
    const count = _container.querySelector(".lf-stat-num");
    if (count && Number.isFinite(Number(count.textContent))) count.textContent = Math.max(0,Number(count.textContent)-1);
  }

  function renderList(listEl, docs) {
    if (!listEl) return;

    const more = _hasMore ? `<button type="button" class="lf-found-more">تحميل المزيد من الأرشيف</button>` : "";
    if (docs.length === 0) {
      listEl.innerHTML = `
        <div class="lf-empty">
          <i class="fa-solid fa-box-open"></i>
          <p>${_hasMore ? "لا توجد نتائج مؤكدة، اتصل بالإنترنت وحاول مجددًا" : "لسه مفيش حاجة اتلقيت"}</p>
        </div>` + more;
      listEl.querySelector(".lf-found-more")?.addEventListener("click",loadNext);
      return;
    }

    listEl.innerHTML = docs.map(renderArchiveItem).join("") + more;
    listEl.querySelector(".lf-found-more")?.addEventListener("click",loadNext);

    // زرار التصحيح (found → published) للأدمن/الأونر بس — تحقق واجهة، والدالة نفسها بتتحقق تاني
    if (core.state.isAdmin) {
      listEl.querySelectorAll(".lf-correct-back-btn").forEach((btn) => {
        btn.addEventListener("click", () => correctBack(btn.dataset.postId));
      });
      // الحذف من الأرشيف للأدمن/الأونر بس (صاحب المنشور ممنوع يحذف حاجة اتلقت — الـ Rule بتتأكد كمان)
      listEl.querySelectorAll(".lf-delete-post-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.postId;
          const createdBy = btn.dataset.createdBy;
          if (window.__LF.post) window.__LF.post.confirmDeletePost(id, createdBy, "found");
        });
      });
    }
  }

  function renderArchiveItem(post) {
    const typeLabel = post.type === "lost" ? "مفقود" : "موجود";
    return `
      <div class="lf-archive-item" data-post-id="${post.id}">
        <span class="lf-badge lf-badge-done"><i class="fa-solid fa-circle-check"></i></span>
        <div class="lf-archive-info">
          <span class="lf-archive-title">${core.escapeHtml(post.title)}</span>
          <span class="lf-archive-meta">${typeLabel} · تم العثور عليها ${core.formatRelativeTime(post.resolvedAt)}</span>
        </div>
        ${core.state.isAdmin ? `
          <button type="button" class="lf-correct-back-btn" data-post-id="${post.id}" title="تراجع عن الحالة">تراجع</button>
          <button type="button" class="lf-delete-post-btn" data-post-id="${post.id}" data-created-by="${core.escapeHtml(post.createdBy)}" title="حذف نهائي" aria-label="حذف">
            <i class="fa-solid fa-trash"></i>
          </button>` : ""}
      </div>
    `;
  }

  function renderError(listEl, msg) {
    if (!listEl) return;
    listEl.innerHTML = `
      <div class="lf-error">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <p>${core.escapeHtml(msg)}</p>
      </div>`;
  }

  /* ─────────────────────────────────────────
     الكتابة الوحيدة لـ published → found
     تحقق فعلي قبل الكتابة (مش بس إخفاء زرار) — لكن الـ Rules تظل الحماية النهائية
  ───────────────────────────────────────── */
  async function markAsFound(postId) {
    const currentUser = window.currentUser;
    if (!currentUser?.uid) {
      window.toast?.("يجب تسجيل الدخول أولاً", "warn");
      return;
    }

    try {
      const fs = await core.getFS();
      const { db, doc, getDoc, updateDoc, serverTimestamp } = fs;
      const postRef = doc(db, "lostFound", postId);

      const snap = await getDoc(postRef);
      if (!snap.exists()) {
        window.toast?.("المنشور غير موجود", "error");
        return;
      }
      const post = snap.data();

      if (post.status !== "published") {
        window.toast?.("تم التعامل مع هذا المنشور بالفعل", "warn");
        return;
      }

      const isOwner = currentUser.uid === post.createdBy;
      if (!isOwner && !core.state.isAdmin) {
        window.toast?.("غير مسموح لك بهذا الإجراء", "warn");
        return;
      }

      await updateDoc(postRef, {
        status: "found",
        resolvedBy: currentUser.uid,
        resolvedAt: serverTimestamp(),
      });

      window.toast?.("تم تسجيلها كـ (لقيتها) ✓");
      core.closeModal(); // كانت مفتوحة من تفاصيل المنشور في feed.js
    } catch (e) {
      console.error("[LostFound:found] فشل markAsFound", e);
      window.toast?.("تعذر إتمام العملية", "error");
    }
  }

  /* ─────────────────────────────────────────
     التصحيح — Admin/Owner فقط (وليس صاحب المنشور)، زي ما اتفقنا
     ⚠️ لسه ما اتأكدناش إن الـ Rules الحالية بتسمح بالانتقال ده فعليًا (found → published).
     هذا الافتراض غير مؤكد بعد — التأكيد النهائي في خطوة مراجعة Firestore Rules القادمة.
     لو محتاج صلاحية إضافية تتعارض مع "ممنوع تعديل Rule موجودة"، هنوقف ونراجعها قبل أي حل.
  ───────────────────────────────────────── */
  async function correctBack(postId) {
    if (!core.state.isAdmin) {
      window.toast?.("غير مسموح لك بهذا الإجراء", "warn");
      return;
    }

    try {
      const fs = await core.getFS();
      const { db, doc, updateDoc } = fs;

      await updateDoc(doc(db, "lostFound", postId), {
        status: "published",
        resolvedBy: null,
        resolvedAt: null,
      });

      removeLocal(postId);
      window.toast?.("تم التراجع، رجع للمنشورات ✓");
    } catch (e) {
      console.error("[LostFound:found] فشل correctBack", e);
      window.toast?.("تعذر التراجع عن الحالة", "error");
    }
  }

  window.__LF.found = { stop, render, markAsFound, correctBack, removeLocal };
})();
