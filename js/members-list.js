import {collection,doc,getDoc,getDocs,query,where,orderBy,documentId,startAfter,limit} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ══════════════════════════════════════════
   MEMBERS LIST — Browse all users & open DM directly
   Owner → Admin → Members, with realtime search
   منقول من index.html — راجع BIS-split-log.md لتفاصيل الاستلاف
══════════════════════════════════════════ */
let _membersSearchDebounce = null;
let _membersRenderGeneration = 0;
let _memberPages = null;
const MEMBER_PAGE_SIZE = 30;
async function _browseMembers(more = false) {
  const uid = window.currentUser?.uid, world = window.activeWorldContext?.() || null;
  if (!uid) throw new Error("Directory requires sign-in");
  const key = JSON.stringify([uid,world]);
  if (!_memberPages || _memberPages.key !== key || (!more && Date.now()-_memberPages.ts >= 300000)) {
    _memberPages = {key,ts:Date.now(),docs:[],cursor:null,more:true,loaded:false,pending:null};
  }
  const state = _memberPages;
  if (state.pending) return state.pending;
  if (state.loaded && (!more || !state.more)) return state;
  const current = () => _memberPages === state && uid === window.currentUser?.uid && world === (window.activeWorldContext?.() || null);
  state.pending = (async()=>{
    const clauses = [where("worldId","==",world),orderBy(documentId(),"asc")];
    if (state.cursor) clauses.push(startAfter(state.cursor));
    const [snap,owner] = await Promise.all([
      world ? getDocs(query(collection(window.db,"users"),...clauses,limit(MEMBER_PAGE_SIZE))) : null,
      !state.loaded ? getDoc(doc(window.db,"users",window.OWNER_UID)) : null
    ]);
    if (!current()) throw new Error("Directory context changed");
    const users = new Map(state.docs.map(u=>[u.uid,u]));
    [...(snap?.docs || []),...(owner?.exists() ? [owner] : [])].forEach(d=>users.set(d.id,{...d.data(),id:d.id,uid:d.id}));
    state.docs = [...users.values()];
    if (snap?.docs.length) state.cursor = snap.docs[snap.docs.length-1];
    state.more = !!snap && (!!snap.metadata?.fromCache || snap.docs.length === MEMBER_PAGE_SIZE);
    state.loaded = true;
    return state;
  })().finally(()=>{state.pending=null;});
  return state.pending;
}

// ── بحث الأعضاء داخل صفحة الدردشات (#page-dms) ──
document.getElementById("dmsSearchInp")?.addEventListener("input", e => {
  const activePanel = document.querySelector("#page-dms .dms-panel.active")?.id.replace("dmspanel-", "");
  if (activePanel !== "members") return;
  const q = e.target.value.trim();
  clearTimeout(_membersSearchDebounce);
  _membersSearchDebounce = setTimeout(() => renderMembersList(q, "dmsMembersList"), 300);
});

async function renderMembersList(q = "", containerId = "dmsMembersList", more = false) {
  q = String(q).trim();
  const generation = ++_membersRenderGeneration;
  const uidAtStart = window.currentUser?.uid;
  const worldAtStart = window.activeWorldContext?.();
  const el = document.getElementById(containerId);
  if (!el) return;

  el.innerHTML = (window._buildMemberSkeletons ? window._buildMemberSkeletons(7) : `<div class="spinner" style="margin:30px auto;"></div>`);

  try {
    if (!window._getWorldUsers) throw new Error("Scoped directory unavailable");
    const page = q ? null : await _browseMembers(more);
    const all = q ? await window._getWorldUsers() : page.docs;
    if (generation !== _membersRenderGeneration || uidAtStart !== window.currentUser?.uid || worldAtStart !== window.activeWorldContext?.()) return;

    // ✅ World Isolation: أعضاء العالم الحالي فقط + الـOwner (Global) يظهر دائمًا
    const _w = window.activeWorldContext?.();
    const scoped = all.filter(u => {
      const _uid = u.uid || u.id;
      return _uid === window.OWNER_UID || (!!_w && u.worldId === _w);
    });

    const lower = q.toLowerCase();
    // هل الاستعلام رقمي؟ → بحث مباشر بـ publicId
    const isNumericId = /^\d{5,6}$/.test(q.trim());

    const filtered = scoped.filter(u => {
      const uid = u.uid || u.id;
      if (uid === window.currentUser.uid) return false;
      if (!q) return true;
      const nameMatch    = (u.name||"").toLowerCase().includes(lower);
      const emailMatch   = window.isOwner() ? (u.email||"").toLowerCase().includes(lower) : false;
      const publicIdMatch = isNumericId ? (u.publicId||"") === q.trim() : false;
      return nameMatch || emailMatch || publicIdMatch;
    });

    // إذا كان البحث برقم معرف → نرتب بحيث المطابق أولاً
    if (isNumericId) {
      filtered.sort((a, b) => {
        const aMatch = (a.publicId||"") === q.trim() ? -1 : 0;
        const bMatch = (b.publicId||"") === q.trim() ? -1 : 0;
        return aMatch - bMatch;
      });
    }

    // Sort: owner → admin → user
    const roleOrder = { owner: 0, admin: 1, user: 2 };
    filtered.sort((a, b) => (roleOrder[a.role]||2) - (roleOrder[b.role]||2));

    el.innerHTML = "";

    const addBrowseControls = () => {
      if (q) return;
      const note = document.createElement("div");
      note.className = "members-page-note";
      note.style.cssText = "padding:10px 14px;font-size:12px;color:var(--muted);text-align:center;";
      note.textContent = `المعروض ${filtered.length} عضو من الصفحات المحملة. البحث يشمل كل أعضاء العالم.`;
      el.prepend(note);
      if (page.more) {
        const button = document.createElement("button");
        button.type = "button"; button.className = "btn ghost";
        button.textContent = "تحميل المزيد من الأعضاء";
        button.style.cssText = "display:block;margin:12px auto;padding:12px 20px;";
        button.addEventListener("click",()=>renderMembersList("",containerId,true));
        el.appendChild(button);
      }
    };
    if (!filtered.length) {
      el.innerHTML = `<div class="dm-empty">${q ? `لا نتائج لـ "${window.esc(q)}"` : "لا يوجد أعضاء"}</div>`;
      addBrowseControls();
      return;
    }

    // Group headers
    const groups = [
      { key: "owner", label: "المالك",   icon: "fa-crown",       color: "var(--gold)" },
      { key: "admin", label: "الإدارة",  icon: "fa-gear",        color: "var(--orange)" },
      { key: "user",  label: "الأعضاء",  icon: "fa-circle-user", color: "var(--blue)" }
    ];

    groups.forEach(g => {
      const groupUsers = filtered.filter(u => (u.role || "user") === g.key);
      if (!groupUsers.length) return;

      // Group header
      const hdr = document.createElement("div");
      hdr.style.cssText = `font-size:10px;font-weight:800;color:${g.color};padding:10px 14px 4px;letter-spacing:.5px;text-transform:uppercase;display:flex;align-items:center;gap:6px;`;
      hdr.innerHTML = `<i class="fa-solid ${g.icon}"></i> ${g.label} (${groupUsers.length})`;
      el.appendChild(hdr);

    groupUsers.forEach(u => {
        const uid = u.uid || u.id;

        // ── ضمان وجود publicId لكل مستخدم — ينشئه بصمت إن لم يكن موجوداً ──
        if (!u.publicId && uid) {
          window._ensurePublicId(uid).catch(() => {});
        }

        const alreadyOpen = !!window._acceptedPeers[uid];

        const roleLabel = g.key==="owner" ? "مالك" : g.key==="admin" ? "مشرف" : "عضو";

        const item = document.createElement("div");
        item.className = "dm-item";
        item.id = `dms-member-${uid}`;
        item.dataset.memberUid = uid;
        item.style.cssText = "cursor:pointer;";
        item.innerHTML = `
          <div class="dm-avatar-wrap">
            <div class="dm-avatar" style="${g.key==="owner"?"background:linear-gradient(135deg,var(--gold),var(--goldL));color:#060d1a;":g.key==="admin"?"background:linear-gradient(135deg,var(--orange),#fb923c);color:#fff;":""}">
              ${u.photo ? `<img src="${window.esc(u.photo)}" alt="">` : window._defaultAvatarHTML(u.gender, 46)}
            </div>
          </div>
          <div class="dm-info">
            <div class="dm-top-row">
              <div class="dm-name">${window.renderUserDisplay(u.name||"مستخدم", u)} <span class="dm-role-inline">— ${roleLabel}</span></div>
              ${alreadyOpen ? `<div class="dm-time" style="color:var(--success);font-size:10px;"><i class="fa-solid fa-comments"></i></div>` : ""}
            </div>
            <div class="dm-bottom-row">
              <div class="dm-preview">${window.isOwner() && u.email ? window.esc(u.email) : (g.key==="owner"?"مؤسس النظام":"")}</div>
            </div>
          </div>
        `;
        item.addEventListener("click", (e) => { e.stopPropagation(); window._showUserContextMenu(uid, e.clientX, e.clientY, u); });
        el.appendChild(item);
      });
    });

    addBrowseControls();
  } catch(e) {
    if (generation !== _membersRenderGeneration) return;
    el.innerHTML = `<div class="dm-empty">خطأ في التحميل</div>`;
    const retry = document.createElement("button");
    retry.type = "button"; retry.className = "btn ghost"; retry.textContent = "إعادة المحاولة";
    retry.style.cssText = "display:block;margin:12px auto;padding:12px 20px;";
    retry.addEventListener("click",()=>renderMembersList(q,containerId,more));
    el.appendChild(retry);
    console.error(e);
  }
}
window.renderMembersList = renderMembersList;
