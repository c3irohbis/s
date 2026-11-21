/**
 * ══════════════════════════════════════════
 *   LOST & FOUND MODULE — راحت فين؟
 *   comments.js — تعليقات وردود على منشور published فقط
 * ══════════════════════════════════════════
 *
 *  مسؤوليته فقط:
 *   - صفحات تعليقات وردود محدودة مع تحديث صريح
 *   - إضافة تعليق/رد (مستوى واحد) + حذف تعليق — addDoc/deleteDoc بسيطين
 *
 *  ملاحظة: مفيش أي عداد commentsCount مخزّن هنا ولا في lostFound نفسها.
 *  عدد التعليقات المعروض في كارت الفيد بيتحسب live عبر getCountFromServer()
 *  في feed.js مباشرة من الـ subcollection — نفس تقنية إحصائيات found.js.
 *  ده تم اعتماده بدل تخزين عداد لأن حمايته من التلاعب كانت محتاجة إما حقول
 *  إضافية على مستند البوست أو Cloud Functions، والاتنين خارج نطاق "إضافة Rule".
 *
 *  ما لا يفعله عمدًا:
 *   - لا يعرف شيئًا عن حالة المنشور نفسه (pending/published/found)
 *   - لا يسمح بأكتر من مستوى رد واحد (تعليق → رد، مش رد على رد)
 *   - إخفاء زرار الحذف هنا واجهة بس، الحماية الحقيقية في الـ Rules
 */

(function () {
  "use strict";

  window.__LF = window.__LF || {};
  const core = window.__LF.core;

  const PAGE_SIZE = 30;
  let _generation = 0, _state = null;
  function stop() { ++_generation; _state = null; }
  core.registerUnsubscribe(stop);
  const world = () => window.activeWorldContext?.() || null;
  const current = state => !!state && _state === state && state.generation === _generation && state.uid === window.currentUser?.uid && state.world === world();
  const record = d => ({...d.data(),id:d.id});
  const time = c => c.createdAt?.toMillis?.() || new Date(c.createdAt || 0).getTime() || 0;
  const chronological = (a,b) => time(a)-time(b) || a.id.localeCompare(b.id);

  function render(postId, container) {
    stop();
    const state = _state = {postId,container,generation:_generation,uid:window.currentUser?.uid,world:world(),docs:new Map(),cursor:null,more:true,loading:false,threads:new Map(),local:new Map()};
    container.innerHTML = `
      <div class="lf-comments">
        <div class="lf-found-toolbar"><span>التعليقات حسب آخر تحديث</span><button type="button" class="lf-comments-refresh">تحديث</button></div>
        <div class="lf-comments-list"><div class="lf-loading"><i class="fa-solid fa-spinner fa-spin"></i></div></div>
        <div class="lf-comments-pages"></div>
        <form class="lf-comment-form lf-comment-form--main">
          <input type="text" class="lf-comment-input" placeholder="اكتب تعليق..." maxlength="300">
          <button type="submit" class="lf-comment-send-btn" aria-label="إرسال"><i class="fa-solid fa-paper-plane"></i></button>
        </form>
      </div>`;
    container.querySelector(".lf-comments-refresh").addEventListener("click",()=>render(postId,container));
    wireSingleCommentForm(container.querySelector(".lf-comment-form--main"),postId,null);
    loadPage(state);
  }

  async function mergePage(state, fs, records) {
    const next = new Map(state.docs);
    records.forEach(c=>next.set(c.id,c));
    const missing = [...new Set(records.filter(c=>c.parentId && !next.has(c.parentId)).map(c=>c.parentId))];
    const parents = await Promise.all(missing.map(async id=>{
      const snap = await fs.getDoc(fs.doc(fs.db,"lostFound",state.postId,"comments",id));
      return snap.exists() ? record(snap) : {id,text:snap.metadata?.fromCache ? "التعليق الأصلي غير متاح حاليًا" : "التعليق الأصلي محذوف",createdByName:"التعليق الأصلي",_missing:true};
    }));
    if (!current(state)) return false;
    const merged = new Map(state.docs);
    [...records,...parents].forEach(c=>{if(!state.local.has(c.id))merged.set(c.id,c);});
    state.local.forEach((c,id)=>{if(c)merged.set(id,c);else merged.delete(id);});
    [...merged.values()].filter(c=>c.parentId && !merged.has(c.parentId)).forEach(c=>merged.set(c.parentId,{id:c.parentId,text:"التعليق الأصلي محذوف",createdByName:"تعليق محذوف",_missing:true}));
    state.docs = merged;
    return true;
  }

  async function loadPage(state, parentId = null) {
    if (!current(state)) return;
    let page = state;
    if (parentId) {
      if (!state.threads.has(parentId)) state.threads.set(parentId,{cursor:null,more:true,loading:false});
      page = state.threads.get(parentId);
    }
    if (page.loading || !page.more) return;
    page.loading = true;
    renderList(state.container,state.postId,[...state.docs.values()]);
    try {
      const fs = await core.getFS();
      if (!current(state)) return;
      const {db,collection,query,where,orderBy,startAfter,limit,getDocs} = fs;
      const clauses = [orderBy("createdAt","asc")];
      if (parentId) clauses.unshift(where("parentId","==",parentId));
      if (page.cursor) clauses.push(startAfter(page.cursor));
      const snap = await getDocs(query(collection(db,"lostFound",state.postId,"comments"),...clauses,limit(PAGE_SIZE)));
      if (!current(state) || !await mergePage(state,fs,snap.docs.map(record))) return;
      if (snap.docs.length) page.cursor = snap.docs[snap.docs.length-1];
      page.more = !!snap.metadata?.fromCache || snap.docs.length === PAGE_SIZE;
    } catch(e) {
      if (current(state)) window.toast?.("تعذر تحميل التعليقات، حاول مرة أخرى", "error");
    } finally {
      if (current(state)) {page.loading=false;renderList(state.container,state.postId,[...state.docs.values()]);}
    }
  }

  function renderList(container, postId, all) {
    const state = _state;
    if (!state || !current(state) || container !== state.container) return;
    const listEl = container.querySelector(".lf-comments-list");
    if (!listEl) return;
    const topLevel = all.filter(c=>!c.parentId).sort(chronological);
    const repliesByParent = {};
    all.filter(c=>c.parentId).sort(chronological).forEach(c=>(repliesByParent[c.parentId] ||= []).push(c));
    listEl.innerHTML = topLevel.length ? topLevel.map(c=>renderComment(c,repliesByParent[c.id] || [])).join("") : `<p class="lf-no-comments">${state.more ? "اضغط تحميل المزيد للتحقق من التعليقات" : "لسه مفيش تعليقات"}</p>`;
    wireListEvents(listEl,container,postId);
    const pages = container.querySelector(".lf-comments-pages");
    pages.innerHTML = state.more ? `<button type="button" class="lf-comments-more" ${state.loading?"disabled":""}>${state.loading?"جارٍ التحميل...":"تحميل المزيد من التعليقات والردود"}</button>` : "";
    pages.querySelector(".lf-comments-more")?.addEventListener("click",()=>loadPage(state));
  }

  function renderComment(comment, replies) {
    return `
      <div class="lf-comment" data-comment-id="${comment.id}">
        <div class="lf-comment-header">
          ${core.getUserBadge(comment.createdByName, comment.createdByPhoto)}
          <span class="lf-comment-time">${core.formatRelativeTime(comment.createdAt)}</span>
        </div>
        <p class="lf-comment-text">${core.escapeHtml(comment.text)}</p>
        <div class="lf-comment-actions">
          ${!comment._missing ? `<button type="button" class="lf-reply-btn" data-parent-id="${comment.id}">رد</button>` : ""}
          ${canDeleteComment(comment) ? `<button type="button" class="lf-delete-comment-btn" data-comment-id="${comment.id}">حذف</button>` : ""}
        </div>
        <div class="lf-reply-form-mount" data-parent-id="${comment.id}" hidden></div>
        ${replies.length ? `<div class="lf-replies">${replies.map(renderReply).join("")}</div>` : ""}
        ${_state.more && _state.threads.get(comment.id)?.more !== false ? `<button type="button" class="lf-replies-more" data-parent-id="${comment.id}" ${_state.threads.get(comment.id)?.loading ? "disabled" : ""}>تحميل المزيد من الردود</button>` : ""}
      </div>
    `;
  }

  function renderReply(reply) {
    return `
      <div class="lf-comment lf-reply" data-comment-id="${reply.id}">
        <div class="lf-comment-header">
          ${core.getUserBadge(reply.createdByName, reply.createdByPhoto)}
          <span class="lf-comment-time">${core.formatRelativeTime(reply.createdAt)}</span>
        </div>
        <p class="lf-comment-text">${core.escapeHtml(reply.text)}</p>
        ${canDeleteComment(reply) ? `<div class="lf-comment-actions"><button type="button" class="lf-delete-comment-btn" data-comment-id="${reply.id}">حذف</button></div>` : ""}
      </div>
    `;
  }

  // واجهة فقط — الحماية الحقيقية دايمًا في الـ Rules (isAdmin() || uid == createdBy)
  function canDeleteComment(comment) {
    if (comment._missing) return false;
    const uid = window.currentUser?.uid;
    return !!core.state.isAdmin || (!!uid && uid === comment.createdBy);
  }

  function wireListEvents(listEl, container, postId) {
    listEl.querySelectorAll(".lf-replies-more").forEach(btn=>btn.addEventListener("click",()=>loadPage(_state,btn.dataset.parentId)));
    listEl.querySelectorAll(".lf-reply-btn").forEach((btn) => {
      btn.addEventListener("click", () => toggleReplyBox(container, postId, btn.dataset.parentId));
    });
    listEl.querySelectorAll(".lf-delete-comment-btn").forEach((btn) => {
      btn.addEventListener("click", () => deleteComment(postId, btn.dataset.commentId));
    });
  }

  function toggleReplyBox(container, postId, parentId) {
    const mount = container.querySelector(`.lf-reply-form-mount[data-parent-id="${parentId}"]`);
    if (!mount) return;

    if (!mount.hidden) {
      mount.hidden = true;
      mount.innerHTML = "";
      return;
    }

    mount.hidden = false;
    mount.innerHTML = `
      <form class="lf-comment-form lf-reply-inline-form">
        <input type="text" class="lf-comment-input" placeholder="اكتب ردك..." maxlength="300">
        <button type="submit" class="lf-comment-send-btn" aria-label="إرسال">
          <i class="fa-solid fa-paper-plane"></i>
        </button>
      </form>
    `;
    const replyForm = mount.querySelector(".lf-reply-inline-form");
    wireSingleCommentForm(replyForm, postId, parentId, () => {
      mount.hidden = true;
      mount.innerHTML = "";
    });
  }

  function wireSingleCommentForm(formEl, postId, parentId, onSent) {
    if (!formEl) return;
    formEl.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = formEl.querySelector(".lf-comment-input");
      const text = input.value.trim();
      if (!text) return;

      const btn = formEl.querySelector(".lf-comment-send-btn");
      if (btn) btn.disabled = true;

      const ok = await addComment(postId, text, parentId);

      if (btn) btn.disabled = false;
      if (ok) {
        input.value = "";
        if (onSent) onSent();
      }
    });
  }

  /* ─────────────────────────────────────────
     الإضافة — addDoc بسيط، مفيش عداد مخزّن نحميه (عدد التعليقات بيتحسب live في feed.js)
  ───────────────────────────────────────── */
  async function addComment(postId, text, parentId) {
    const currentUser = window.currentUser;
    if (!currentUser?.uid) {
      window.toast?.("يجب تسجيل الدخول أولاً", "warn");
      return false;
    }

    try {
      const fs = await core.getFS();
      const { db, collection, addDoc, serverTimestamp } = fs;

      if (window.currentUser?.uid !== currentUser.uid) return false;
      const payload = {
        text,
        createdBy: currentUser.uid,
        createdByName: window.getCurrentName?.() || "مستخدم",
        createdByPhoto: window.currentPhoto || "",
        parentId: parentId || null,
        createdAt: serverTimestamp(),
      };
      const added = await addDoc(collection(db,"lostFound",postId,"comments"),payload);
      const state = _state;
      if (state && current(state) && state.postId === postId && state.uid === currentUser.uid) {
        const local = {...payload,id:added.id,createdAt:new Date()};
        state.local.set(added.id,local); state.docs.set(added.id,local);
        renderList(state.container,postId,[...state.docs.values()]);
      }
      return true;
    } catch (e) {
      console.error("[LostFound:comments] فشل إضافة تعليق", e);
      window.toast?.("تعذر إرسال التعليق", "error");
      return false;
    }
  }

  /* ─────────────────────────────────────────
     الحذف — deleteDoc بسيط، مفيش عداد نحدّثه
  ───────────────────────────────────────── */
  async function deleteComment(postId, commentId) {
    const uid = window.currentUser?.uid;
    try {
      const fs = await core.getFS();
      const { db, doc, deleteDoc } = fs;

      if (!uid || uid !== window.currentUser?.uid) return;
      await deleteDoc(doc(db, "lostFound", postId, "comments", commentId));
      const state = _state;
      if (state && current(state) && state.postId === postId && state.uid === uid) {
        const hasReplies = [...state.docs.values()].some(c=>c.parentId===commentId);
        if (hasReplies) state.docs.set(commentId,{id:commentId,text:"التعليق الأصلي محذوف",createdByName:"تعليق محذوف",_missing:true});
        else state.docs.delete(commentId);
        state.local.set(commentId,state.docs.get(commentId) || null);
        renderList(state.container,postId,[...state.docs.values()]);
      }
    } catch (e) {
      console.error("[LostFound:comments] فشل حذف التعليق", e);
      window.toast?.("تعذر حذف التعليق", "error");
    }
  }

  function renderError(container, msg) {
    const listEl = container.querySelector(".lf-comments-list") || container;
    listEl.innerHTML = `
      <div class="lf-error">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <p>${core.escapeHtml(msg)}</p>
      </div>`;
  }

  window.__LF.comments = { stop, render };
})();
