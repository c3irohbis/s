/**
 * ══════════════════════════════════════════
 *   LOST & FOUND MODULE — راحت فين؟
 *   admin.js — طلبات المراجعة (يظهر بس لو isAdmin())
 * ══════════════════════════════════════════
 *
 *  مسؤوليته فقط:
 *   - عرض طلبات pending/rejected كاملة (وصف + صور + بيانات صاحب الطلب)
 *   - الموافقة / الرفض (بسبب) / طلب استكمال بيانات (بملاحظة)
 *   - تفويض "نشر مباشر" لـ post.openCreateForm({directPublish:true})
 *   - هو المكان الوحيد اللي بيكتب approvedBy/rejectedBy/adminNote
 *
 *  ما لا يفعله عمدًا:
 *   - لا يبني فورم نشر من جديد (نشر مباشر = post.js نفسه بـ flag)
 *   - لا يلمس حالة found (مسؤولية found.js فقط)
 *   - كل دالة كتابة بتتحقق isAdmin() بنفسها أولًا، دفاع إضافي رغم إن الملف
 *     أصلًا مش بيتحمّل غير للأدمن (loader في lost-found.js)
 */

(function () {
  "use strict";

  window.__LF = window.__LF || {};
  const core = window.__LF.core;

  const PAGE_SIZE=30;
  let _generation=0,_container=null,_docs=[],_cursor=null,_more=true,_loading=false,_mode="pending",_ctx=null;
  function stop(){++_generation;_container=null;_ctx=null;}
  core.registerUnsubscribe(stop);
  const current=ctx=>!!ctx&&ctx===_ctx&&ctx.generation===_generation&&ctx.uid===window.currentUser?.uid&&ctx.world===(window.activeWorldContext?.()||null);
  function render(container,mode="pending"){
    stop();_container=container;_mode=mode==="rejected"?"rejected":"pending";_docs=[];_cursor=null;_more=true;_loading=false;
    _ctx={generation:_generation,uid:window.currentUser?.uid,world:window.activeWorldContext?.()||null,local:new Map()};
    container.innerHTML=`<div class="lf-admin-toolbar"><button type="button" class="lf-direct-publish-btn">نشر مباشر</button><button type="button" class="lf-admin-refresh lf-found-refresh">تحديث</button></div><div class="lf-tabs"><button type="button" class="lf-tab ${_mode==="pending"?"active":""}" data-queue="pending">قيد المراجعة</button><button type="button" class="lf-tab ${_mode==="rejected"?"active":""}" data-queue="rejected">المرفوضات</button></div><div class="lf-found-toolbar">الطلبات حسب آخر تحديث، تحميل 30 في كل صفحة</div><div class="lf-admin-queue"></div>`;
    container.querySelector(".lf-direct-publish-btn")?.addEventListener("click",()=>window.__LF.post?.openCreateForm({directPublish:true}));
    container.querySelector(".lf-admin-refresh")?.addEventListener("click",()=>render(container,_mode));
    container.querySelectorAll("[data-queue]").forEach(btn=>btn.addEventListener("click",()=>render(container,btn.dataset.queue)));
    loadNext(_ctx);
  }
  async function loadNext(ctx){
    if(!current(ctx)||_loading||!_more)return;_loading=true;renderQueue(_container.querySelector(".lf-admin-queue"),_docs);
    try{
      const {db,collection,query,where,orderBy,startAfter,limit,getDocs}=await core.getFS();if(!current(ctx))return;
      const clauses=[where("status","==",_mode),orderBy("createdAt","desc")];if(_cursor)clauses.push(startAfter(_cursor));
      const snap=await getDocs(query(collection(db,"lostFound"),...clauses,limit(PAGE_SIZE)));if(!current(ctx))return;
      const merged=new Map(_docs.map(p=>[p.id,p]));snap.docs.forEach(d=>{if(!ctx.local.has(d.id))merged.set(d.id,{...d.data(),id:d.id});});ctx.local.forEach((p,id)=>{if(p)merged.set(id,p);else merged.delete(id);});_docs=[...merged.values()];
      if(snap.docs.length)_cursor=snap.docs[snap.docs.length-1];_more=!!snap.metadata?.fromCache||snap.docs.length===PAGE_SIZE;
    }catch(e){if(current(ctx))window.toast?.("تعذر تحميل الطلبات، حاول مرة أخرى","error");}
    finally{if(current(ctx)){_loading=false;renderQueue(_container.querySelector(".lf-admin-queue"),_docs);}}
  }
  function renderQueue(listEl,docs){
    if(!listEl)return;
    listEl.innerHTML=docs.length?docs.map(renderRequestCard).join(""):`<div class="lf-empty"><i class="fa-solid fa-inbox"></i><p>${_more?"اضغط تحميل المزيد للتحقق من الطلبات":_mode==="pending"?"مفيش طلبات محتاجة مراجعة دلوقتي":"لا توجد طلبات مرفوضة"}</p></div>`;
    if(_more)listEl.innerHTML+=`<button type="button" class="lf-admin-more lf-found-more" ${_loading?"disabled":""}>${_loading?"جارٍ التحميل...":"تحميل المزيد من الطلبات"}</button>`;
    listEl.querySelector(".lf-admin-more")?.addEventListener("click",()=>loadNext(_ctx));wireQueueEvents(listEl);
  }
  function removeLocal(id,actorUid=window.currentUser?.uid){if(!current(_ctx)||actorUid!==_ctx.uid)return;_ctx.local.set(id,null);_docs=_docs.filter(p=>p.id!==id);renderQueue(_container.querySelector(".lf-admin-queue"),_docs);}
  function upsertLocal(post,actorUid=window.currentUser?.uid){if(!current(_ctx)||actorUid!==_ctx.uid)return;if(post.status!==_mode){removeLocal(post.id,actorUid);return;}_ctx.local.set(post.id,post);_docs=[post,..._docs.filter(p=>p.id!==post.id)];renderQueue(_container.querySelector(".lf-admin-queue"),_docs);}

  function renderRequestCard(post) {
    const typeLabel = post.type === "lost" ? "مفقود" : "موجود";
    const isPending = post.status === "pending";
    const img =
      post.images && post.images[0]
        ? `<div class="lf-post-image"><img src="${core.escapeHtml(post.images[0])}" loading="lazy" alt=""></div>`
        : "";

    return `
      <article class="lf-admin-card" data-post-id="${post.id}">
        <div class="lf-post-header">
          ${core.getUserBadge(post.createdByName, post.createdByPhoto)}
          <span class="lf-post-time">${core.formatRelativeTime(post.createdAt)}</span>
        </div>

        <span class="lf-badge ${post.type === "lost" ? "lf-badge-lost" : "lf-badge-found"}">${typeLabel}</span>
        <span class="lf-status-chip ${isPending ? "lf-status-pending" : "lf-status-rejected"}">
          ${isPending ? "قيد المراجعة" : "مرفوض"}
        </span>

        <h3 class="lf-post-title">${core.escapeHtml(post.title)}</h3>
        ${post.location ? `<div class="lf-post-location"><i class="fa-solid fa-location-dot"></i> ${core.escapeHtml(post.location)}</div>` : ""}
        ${img}
        <p class="lf-post-desc">${core.escapeHtml(post.description)}</p>

        ${post.adminNote ? `<p class="lf-admin-note"><i class="fa-solid fa-circle-info"></i> ${core.escapeHtml(post.adminNote)}</p>` : ""}
        ${!isPending && post.rejectionReason ? `<p class="lf-rejection-reason"><i class="fa-solid fa-circle-exclamation"></i> ${core.escapeHtml(post.rejectionReason)}</p>` : ""}

        ${isPending ? `
          <div class="lf-admin-actions">
            <button type="button" class="lf-approve-btn" data-post-id="${post.id}">
              <i class="fa-solid fa-check"></i> موافقة
            </button>
            <button type="button" class="lf-request-edit-btn" data-post-id="${post.id}">
              <i class="fa-solid fa-pen"></i> طلب استكمال
            </button>
            <button type="button" class="lf-reject-btn" data-post-id="${post.id}">
              <i class="fa-solid fa-xmark"></i> رفض
            </button>
          </div>` : ""}

        <button type="button" class="lf-delete-post-btn" data-post-id="${post.id}" data-created-by="${core.escapeHtml(post.createdBy)}" data-status="${post.status}">
          <i class="fa-solid fa-trash"></i> حذف نهائي
        </button>
      </article>
    `;
  }

  function wireQueueEvents(listEl) {
    listEl.querySelectorAll(".lf-approve-btn").forEach((btn) => {
      btn.addEventListener("click", () => approve(btn.dataset.postId));
    });
    listEl.querySelectorAll(".lf-reject-btn").forEach((btn) => {
      btn.addEventListener("click", () => openReasonModal(btn.dataset.postId, "reject"));
    });
    listEl.querySelectorAll(".lf-request-edit-btn").forEach((btn) => {
      btn.addEventListener("click", () => openReasonModal(btn.dataset.postId, "requestEdit"));
    });
    listEl.querySelectorAll(".lf-delete-post-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.postId;
        const createdBy = btn.dataset.createdBy;
        const status = btn.dataset.status;
        if (window.__LF.post) window.__LF.post.confirmDeletePost(id, createdBy, status);
      });
    });
  }

  /* ─────────────────────────────────────────
     مودال السبب/الملاحظة (رفض أو طلب استكمال) — نفس lf-modal-layer المشتركة
  ───────────────────────────────────────── */
  function openReasonModal(postId, action) {
    const isReject = action === "reject";
    core.openModal(`
      <div class="lf-modal lf-reason-modal">
        <button class="lf-modal-close" type="button" aria-label="إغلاق">
          <i class="fa-solid fa-xmark"></i>
        </button>
        <h3>${isReject ? "سبب الرفض" : "ملاحظة استكمال البيانات"}</h3>
        <form class="lf-reason-form">
          <textarea class="lf-reason-input" placeholder="${isReject ? "اكتب سبب الرفض..." : "وضّح للطالب المطلوب استكماله..."}" maxlength="300" required></textarea>
          <button type="submit" class="lf-reason-submit-btn">${isReject ? "تأكيد الرفض" : "إرسال الملاحظة"}</button>
        </form>
      </div>
    `);

    const layer = core.state.root.querySelector(".lf-modal-layer");
    layer.querySelector(".lf-modal-close")?.addEventListener("click", () => core.closeModal());
    layer.querySelector(".lf-reason-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = layer.querySelector(".lf-reason-input").value.trim();
      if (!text) return;

      const btn = layer.querySelector(".lf-reason-submit-btn");
      if (btn) btn.disabled = true;

      if (isReject) await reject(postId, text);
      else await requestEdit(postId, text);

      core.closeModal();
    });
  }

  /* ─────────────────────────────────────────
     الكتابات — كل دالة بتتحقق isAdmin() بنفسها أولًا (دفاع إضافي)
  ───────────────────────────────────────── */
  async function approve(postId) {
    const actorUid=window.currentUser?.uid, localPost=_docs.find(p=>p.id===postId);
    if (!core.state.isAdmin) { window.toast?.("غير مسموح", "warn"); return; }
    try {
      const fs = await core.getFS();
      const { db, doc, updateDoc, serverTimestamp } = fs;
      if (!actorUid || actorUid !== window.currentUser?.uid) return;
      await updateDoc(doc(db, "lostFound", postId), {
        status: "published",
        approvedBy: actorUid,
        approvedAt: serverTimestamp(),
      });
      removeLocal(postId,actorUid);
      window.toast?.("تم النشر ✓");
    } catch (e) {
      console.error("[LostFound:admin] فشل approve", e);
      window.toast?.("تعذر تنفيذ الموافقة", "error");
    }
  }

  async function reject(postId, reason) {
    const actorUid=window.currentUser?.uid, localPost=_docs.find(p=>p.id===postId);
    if (!core.state.isAdmin) { window.toast?.("غير مسموح", "warn"); return; }
    try {
      const fs = await core.getFS();
      const { db, doc, updateDoc, serverTimestamp } = fs;
      if (!actorUid || actorUid !== window.currentUser?.uid) return;
      await updateDoc(doc(db, "lostFound", postId), {
        status: "rejected",
        rejectedBy: actorUid,
        rejectedAt: serverTimestamp(),
        rejectionReason: reason,
      });
      if(localPost)upsertLocal({...localPost,status:"rejected",rejectionReason:reason},actorUid);else removeLocal(postId,actorUid);
      window.toast?.("تم رفض الطلب");
    } catch (e) {
      console.error("[LostFound:admin] فشل reject", e);
      window.toast?.("تعذر تنفيذ الرفض", "error");
    }
  }

  async function requestEdit(postId, note) {
    const actorUid=window.currentUser?.uid, localPost=_docs.find(p=>p.id===postId);
    if (!core.state.isAdmin) { window.toast?.("غير مسموح", "warn"); return; }
    try {
      const fs = await core.getFS();
      const { db, doc, updateDoc } = fs;
      // الحالة تفضل pending — بس بملاحظة توضح للطالب المطلوب تعديله في "طلباتك السابقة"
      if (!actorUid || actorUid !== window.currentUser?.uid) return;
      await updateDoc(doc(db, "lostFound", postId), { adminNote: note });
      if(localPost)upsertLocal({...localPost,adminNote:note},actorUid);
      window.toast?.("تم إرسال الملاحظة ✓");
    } catch (e) {
      console.error("[LostFound:admin] فشل requestEdit", e);
      window.toast?.("تعذر إرسال الملاحظة", "error");
    }
  }

  function renderError(listEl, msg) {
    if (!listEl) return;
    listEl.innerHTML = `
      <div class="lf-error">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <p>${core.escapeHtml(msg)}</p>
      </div>`;
  }

  window.__LF.admin = { stop, render, removeLocal, upsertLocal };
})();
