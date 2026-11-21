/**
 * ══════════════════════════════════════════
 *   LOST & FOUND MODULE — راحت فين؟
 *   feed.js — تبويب "المفقودات" (منشورات published) + البحث + تفاصيل المنشور
 * ══════════════════════════════════════════
 *
 *  مسؤوليته فقط:
 *   - realtime listener على lostFound حيث status == "published"
 *   - بناء كروت المنشورات + الفلترة المحلية عند البحث
 *   - فتح مودال "تفاصيل المنشور" ويستدعي comments.render() جواه
 *
 *  ما لا يفعله عمدًا:
 *   - لا يكتب أي شيء في Firestore (قراءة فقط)
 *   - لا يغيّر حالة المنشور لـ found — بيفوّض لـ found.markAsFound()
 *   - لا يبني أي منطق تعليقات — بيفوّض لـ comments.render()
 */

(function () {
  "use strict";

  window.__LF = window.__LF || {};
  const core = window.__LF.core;

  const PAGE_SIZE = 30;
  let _generation = 0, _ctx = null, _containerEl = null;
  let _allDocs = [], _browseDocs = [], _searchDocs = null, _searchTerm = "";
  let _cursor = null, _more = true, _loading = false, _searchPending = null, _searchOffline = false;
  let _countObserver = null;
  const _countCache = new Map();
  function stop() { ++_generation; _ctx = null; _countObserver?.disconnect(); _countObserver=null; }
  core.registerUnsubscribe(stop);
  const current = ctx => !!ctx && ctx === _ctx && ctx.generation === _generation && ctx.uid === window.currentUser?.uid && ctx.world === (window.activeWorldContext?.() || null);

  function render(container) {
    stop(); _containerEl=container; _browseDocs=[]; _allDocs=[]; _searchDocs=null;
    _cursor=null; _more=true; _loading=false; _searchPending=null; _searchOffline=false; _countCache.clear();
    _ctx={generation:_generation,uid:window.currentUser?.uid,world:window.activeWorldContext?.() || null,local:new Map()};
    if (_searchTerm) loadSearch(_ctx); else loadNext(_ctx);
  }

  async function loadNext(ctx) {
    if (!current(ctx) || _loading || !_more) return;
    _loading=true; renderList();
    try {
      const {db,collection,query,where,orderBy,startAfter,limit,getDocs}=await core.getFS();
      if (!current(ctx)) return;
      const clauses=[where("status","==","published"),orderBy("createdAt","desc")];
      if (_cursor) clauses.push(startAfter(_cursor));
      const snap=await getDocs(query(collection(db,"lostFound"),...clauses,limit(PAGE_SIZE)));
      if (!current(ctx)) return;
      const merged=new Map(_browseDocs.map(p=>[p.id,p]));
      snap.docs.forEach(d=>{if(!ctx.local.has(d.id))merged.set(d.id,{...d.data(),id:d.id});});
      ctx.local.forEach((p,id)=>{if(p)merged.set(id,p);else merged.delete(id);});
      _browseDocs=[...merged.values()];
      if(snap.docs.length)_cursor=snap.docs[snap.docs.length-1];
      _more=!!snap.metadata?.fromCache || snap.docs.length===PAGE_SIZE;
    } catch(e) {if(current(ctx))window.toast?.("تعذر تحميل المنشورات، حاول مرة أخرى","error");}
    finally {if(current(ctx)){_loading=false;renderList();}}
  }

  async function loadSearch(ctx) {
    if (!current(ctx)) return;
    if (_searchDocs) {renderList();return;}
    if (_searchPending) return _searchPending;
    const pending=Promise.resolve().then(async()=>{
      renderList();
      try {
        const {db,collection,query,where,orderBy,getDocs}=await core.getFS();
        if (!current(ctx)) return;
        const snap=await getDocs(query(collection(db,"lostFound"),where("status","==","published"),orderBy("createdAt","desc")));
        if (!current(ctx)) return;
        const merged=new Map(snap.docs.map(d=>[d.id,{...d.data(),id:d.id}]));ctx.local.forEach((p,id)=>{if(p)merged.set(id,p);else merged.delete(id);});
        _searchDocs=[...merged.values()];_searchOffline=!!snap.metadata?.fromCache;
      }catch(e){if(current(ctx))window.toast?.("تعذر البحث الشامل، اضغط تحديث للمحاولة","error");}
      finally{if(current(ctx)){_searchPending=null;renderList();}}
    });
    _searchPending=pending;return pending;
  }

  function onSearchInput(term) {
    _searchTerm=(term || "").trim().toLowerCase();
    if(_searchTerm)loadSearch(_ctx);else renderList();
  }

  function renderList() {
    if (!_containerEl || !current(_ctx)) return;
    _countObserver?.disconnect();_countObserver=null;
    _allDocs=_searchTerm ? (_searchDocs || []) : _browseDocs;
    const docs=_searchTerm ? _allDocs.filter(p=>(p.title || "").toLowerCase().includes(_searchTerm)||(p.description || "").toLowerCase().includes(_searchTerm)) : _allDocs;
    const waiting=!!_searchTerm && !_searchDocs;
    _containerEl.innerHTML=`<div class="lf-found-toolbar"><span>${_searchTerm ? (_searchOffline?"نتائج محفوظة قد تكون غير مكتملة":"البحث يشمل كل المنشورات المنشورة") : "منشورات الصفحات المحملة، حسب آخر تحديث"}</span><button type="button" class="lf-found-refresh">تحديث</button></div>` +
      (waiting ? `<div class="lf-empty">${_searchPending?"جارٍ البحث الشامل...":"اضغط تحديث لإعادة البحث الشامل"}</div>` : docs.length ? `<div class="lf-feed-list">${docs.map(renderPostCard).join("")}</div>` : `<div class="lf-empty"><i class="fa-solid fa-box-open"></i><p>${_searchTerm?"مفيش نتائج مطابقة":_more?"اضغط تحميل المزيد للتحقق من المنشورات":"لسه مفيش منشورات"}</p></div>`) +
      (!_searchTerm && _more ? `<button type="button" class="lf-found-more" ${_loading?"disabled":""}>${_loading?"جارٍ التحميل...":"تحميل المزيد من المنشورات"}</button>` : "");
    _containerEl.querySelector(".lf-found-refresh")?.addEventListener("click",()=>render(_containerEl));
    _containerEl.querySelector(".lf-found-more")?.addEventListener("click",()=>loadNext(_ctx));
    wireCardEvents(); loadCommentCounts(docs);
  }

  async function loadCommentCounts(docs) {
    const ctx=_ctx;
    const load=async post=>{
      if(!current(ctx))return;
      let pending=_countCache.get(post.id);
      if(!pending){pending=(async()=>{const {db,collection,getCountFromServer}=await core.getFS();return(await getCountFromServer(collection(db,"lostFound",post.id,"comments"))).data().count;})();_countCache.set(post.id,pending);}
      try{const count=await pending;if(!current(ctx))return;const el=_containerEl.querySelector(`.lf-comments-count[data-post-id="${post.id}"]`);if(el)el.textContent=`${count} تعليق`;}
      catch(e){if(_countCache.get(post.id)===pending)_countCache.delete(post.id);}
    };
    if(typeof IntersectionObserver!=="function"){docs.slice(0,30).forEach(load);return;}
    const byId=new Map(docs.map(p=>[p.id,p]));
    _countObserver=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){_countObserver?.unobserve(e.target);const post=byId.get(e.target.dataset.postId);if(post)load(post);}}),{root:core.state.root?.querySelector(".lf-content") || null});
    _containerEl.querySelectorAll(".lf-post-card").forEach(el=>_countObserver.observe(el));
  }

  function removeLocal(id,actorUid=window.currentUser?.uid) {
    if(!current(_ctx)||actorUid!==_ctx.uid)return;
    _ctx.local.set(id,null);
    _browseDocs=_browseDocs.filter(p=>p.id!==id);if(_searchDocs)_searchDocs=_searchDocs.filter(p=>p.id!==id);_countCache.delete(id);renderList();
  }
  function upsertLocal(post,actorUid=window.currentUser?.uid) {
    if(!current(_ctx)||actorUid!==_ctx.uid)return;
    if(post.status!=="published"){removeLocal(post.id,actorUid);return;}
    _ctx.local.set(post.id,post);
    const update=list=>[post,...list.filter(p=>p.id!==post.id)];
    _browseDocs=update(_browseDocs);if(_searchDocs)_searchDocs=update(_searchDocs);renderList();
  }
  function invalidateCount(id) {_countCache.delete(id);if(current(_ctx))renderList();}

  function renderPostCard(post) {
    const typeLabel = post.type === "lost" ? "مفقود" : "موجود";
    const typeClass = post.type === "lost" ? "lf-badge-lost" : "lf-badge-found";
    const img =
      post.images && post.images[0]
        ? `<div class="lf-post-image"><img src="${core.escapeHtml(post.images[0])}" loading="lazy" alt=""></div>`
        : "";

    return `
      <article class="lf-post-card" data-post-id="${post.id}">
        <div class="lf-post-header">
          ${core.getUserBadge(post.createdByName, post.createdByPhoto)}
          <span class="lf-post-time">${core.formatRelativeTime(post.createdAt)}</span>
        </div>

        <span class="lf-badge ${typeClass}">${typeLabel}</span>
        <h3 class="lf-post-title">${core.escapeHtml(post.title)}</h3>

        ${img}

        <p class="lf-post-desc">${core.escapeHtml(post.description)}</p>

        <div class="lf-post-footer">
          <button class="lf-post-comments-btn" type="button">
            <i class="fa-regular fa-comment"></i>
            <span class="lf-comments-count" data-post-id="${post.id}">…</span>
          </button>
        </div>
      </article>
    `;
  }

  function wireCardEvents() {
    _containerEl.querySelectorAll(".lf-post-card").forEach((card) => {
      card.addEventListener("click", () => openPostDetail(card.dataset.postId));
    });
  }

  /* ─────────────────────────────────────────
     تفاصيل المنشور (مودال) + تحميل التعليقات
  ───────────────────────────────────────── */
  function openPostDetail(postId) {
    const post = _allDocs.find((p) => p.id === postId);
    if (!post) return;

    const typeLabel = post.type === "lost" ? "مفقود" : "موجود";
    const typeClass = post.type === "lost" ? "lf-badge-lost" : "lf-badge-found";
    const img =
      post.images && post.images[0]
        ? `<div class="lf-post-image lf-post-image--full"><img src="${core.escapeHtml(post.images[0])}" alt=""></div>`
        : "";

    const uid = core.state.currentUser && core.state.currentUser.uid;
    const isOwner = uid && uid === post.createdBy;
    const canMarkFound = isOwner || core.state.isAdmin;

    core.openModal(`
      <div class="lf-modal lf-post-detail">
        <button class="lf-modal-close" type="button" aria-label="إغلاق">
          <i class="fa-solid fa-xmark"></i>
        </button>

        <div class="lf-post-header">
          ${core.getUserBadge(post.createdByName, post.createdByPhoto)}
          <span class="lf-post-time">${core.formatRelativeTime(post.createdAt)}</span>
        </div>

        <span class="lf-badge ${typeClass}">${typeLabel}</span>
        <h3 class="lf-post-title">${core.escapeHtml(post.title)}</h3>
        ${post.location ? `<div class="lf-post-location"><i class="fa-solid fa-location-dot"></i> ${core.escapeHtml(post.location)}</div>` : ""}

        ${img}

        <p class="lf-post-desc">${core.escapeHtml(post.description)}</p>

        ${canMarkFound ? `
          <button class="lf-mark-found-btn" type="button" data-post-id="${post.id}">
            <i class="fa-solid fa-circle-check"></i> لقيتها
          </button>` : ""}

        ${canMarkFound ? `
          <button class="lf-delete-post-btn" type="button" data-post-id="${post.id}" data-created-by="${core.escapeHtml(post.createdBy)}">
            <i class="fa-solid fa-trash"></i> حذف المنشور
          </button>` : ""}

        <div class="lf-comments-mount" data-post-id="${post.id}"></div>
      </div>
    `);

    const layer = core.state.root.querySelector(".lf-modal-layer");
    layer.querySelector(".lf-modal-close")?.addEventListener("click", () => core.closeModal());

    layer.querySelector(".lf-mark-found-btn")?.addEventListener("click", (e) => {
      // ملاحظة: إخفاء الزرار هنا (isOwner/isAdmin) واجهة مستخدم بس وليس حماية.
      // التحقق الفعلي من الصلاحية إجباري داخل found.markAsFound() نفسها قبل أي updateDoc،
      // والـ Firestore Rules هي خط الدفاع النهائي بغض النظر عن حالة الزرار هنا.
      const id = e.currentTarget.dataset.postId;
      if (window.__LF.found) window.__LF.found.markAsFound(id);
    });

    layer.querySelector(".lf-delete-post-btn")?.addEventListener("click", (e) => {
      const id = e.currentTarget.dataset.postId;
      const createdBy = e.currentTarget.dataset.createdBy;
      if (window.__LF.post) window.__LF.post.confirmDeletePost(id, createdBy, "published");
    });

    const commentsMount = layer.querySelector(".lf-comments-mount");
    if (commentsMount && window.__LF.comments) {
      window.__LF.comments.render(post.id, commentsMount);
    }
  }

  function renderError(msg) {
    if (!_containerEl) return;
    _containerEl.innerHTML = `
      <div class="lf-error">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <p>${core.escapeHtml(msg)}</p>
      </div>`;
  }

  window.__LF.feed = { stop, render, onSearchInput, removeLocal, upsertLocal, invalidateCount };
})();
