/* split from js/app-main.js (block R_owner_admin_panels) — verbatim code; cross-module state writes go through __set_* helpers */
import { collection, doc, getCountFromServer, getDocs, query, updateDoc, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ROLES, db } from "./a-init-config.js";
import { AUDIT_ACTIONS, writeAuditLog } from "./c-upload-audit-stub.js";
import { canModifyUser, canSetRole, currentRole, currentUser, displayEmail, isOwner } from "./d-state-roles-email.js";
import { confirm } from "./e-toast-confirm.js";
import { toggleChatBan } from "./n-admin-ban-unban.js";
import { renderUserDisplay } from "./s-badges-display.js";
import { esc } from "./v-profile-cards-picctx.js";
/* ══════════════════════════════════════════
   OWNER PANEL — Stats & User Management
══════════════════════════════════════════ */
/* ══════════════════════════════════════════
   USERS MANAGER MODAL — open / close
══════════════════════════════════════════ */
function openUsersManager() {
  if (!isOwner()) return;
  const modal = document.getElementById("usersManagerModal");
  if (!modal) return;
  modal.style.display = "block";
  // تحميل المستخدمين عند الفتح
  loadOwnerUsers();
  loadOwnerStats();
}

function closeUsersManager() {
  const modal = document.getElementById("usersManagerModal");
  if (modal) {
    modal.style.animation = "um-slide-out .22s cubic-bezier(.4,0,.2,1) forwards";
    setTimeout(() => {
      modal.style.display = "none";
      modal.style.animation = "";
    }, 220);
  }
}
window.openUsersManager  = openUsersManager;
window.closeUsersManager = closeUsersManager;

let _ownerStatsPending = null;
async function loadOwnerStats() {
  if (_ownerStatsPending) return _ownerStatsPending;
  _ownerStatsPending = (async () => {
    try {
      const usersRef = collection(db, "users");
      const counts = await Promise.all([
        getCountFromServer(usersRef),
        getCountFromServer(query(usersRef, where("role", "==", ROLES.ADMIN))),
        getCountFromServer(query(usersRef, where("isBanned", "==", true))),
        getCountFromServer(query(usersRef, where("role", "==", ROLES.USER)))
      ]);
      const [total, admins, banned, users] = counts.map(snap => snap.data().count);
      document.getElementById("statTotal").textContent = total;
      document.getElementById("statAdmins").textContent = admins;
      document.getElementById("statBanned").textContent = banned;
      document.getElementById("statUsers").textContent = users;
      const subEl = document.getElementById("umHeaderSub");
      if (subEl) subEl.textContent = `${total} مستخدم · ${admins} أدمن · ${banned} محظور`;
    } catch(e) { console.error("owner counts:", e); }
  })().finally(() => { _ownerStatsPending = null; });
  return _ownerStatsPending;
}


let _allOwnerUsers = [];
async function loadOwnerUsers() {
  const list = document.getElementById("ownerUsersList");
  list.innerHTML = `<div class="spinner"></div>`;
  try {
    const snap = await getDocs(collection(db, "users"));
    _allOwnerUsers = [];
    snap.forEach(docu => _allOwnerUsers.push({ id: docu.id, ...docu.data() }));
    renderOwnerUsers(_allOwnerUsers);
  } catch(e) {
    list.innerHTML = `<div class="empty-state">خطأ في تحميل المستخدمين</div>`;
    console.error(e);
  }
}

function renderOwnerUsers(users) {
  const list = document.getElementById("ownerUsersList");
  if (!list) return;
  list.innerHTML = "";
  if (!users.length) { list.innerHTML = `<div class="empty-state">لا توجد نتائج</div>`; return; }

  users.forEach(u => {
    const uid        = u.uid || u.id;
    const uRole      = u.role || ROLES.USER;
    const isSelf     = uid === currentUser?.uid;
    const isOwnerDoc = uRole === ROLES.OWNER;

    const roleBadges = {
      owner: `<span class="badge badge-owner"><i class="fa-solid fa-crown"></i> Owner</span>`,
      admin: `<span class="badge badge-admin"><i class="fa-solid fa-gear"></i> Admin</span>`,
      user:  `<span class="badge badge-user"><i class="fa-solid fa-circle-user"></i> User</span>`
    };
    const bannedBadge    = u.isBanned     ? `<span class="badge badge-banned">محظور</span>` : "";
    const chatBanBadge   = u.isChatBanned ? `<span class="badge badge-chatban"><i class="fa-solid fa-ban"></i> شات</span>` : "";

    const div = document.createElement("div");
    div.className = "user-card";
    div.innerHTML = `
      <div class="user-info">
        <div class="u-name">${renderUserDisplay(u.name||"—", u)} ${isSelf ? '<span style="font-size:10px;color:var(--muted)">(أنت)</span>' : ""}</div>
        <div class="u-email">${esc(displayEmail(u.email))}</div>
        <div class="u-badges">${roleBadges[uRole]||""} ${bannedBadge} ${chatBanBadge}</div>
      </div>
      <div class="user-actions" id="oactions-${uid}"></div>
    `;

    const actionsEl = div.querySelector(`#oactions-${uid}`);

    if (!isSelf && !isOwnerDoc && canModifyUser(currentRole, uRole)) {

      // Ban / Unban (account)
      const banBtn = document.createElement("button");
      banBtn.className = `act-btn ${u.isBanned ? "unban" : "ban"}`;
      banBtn.innerHTML = u.isBanned ? '<i class="fa-solid fa-check"></i> رفع الحظر' : '<i class="fa-solid fa-ban"></i> حظر الحساب';
      banBtn.addEventListener("click", async () => {
        const ok = await confirm(u.isBanned ? "رفع الحظر" : "حظر المستخدم",
          `${u.isBanned ? "هل تريد رفع الحظر عن" : "هل تريد حظر"} "${esc(u.name||"هذا المستخدم")}"؟`);
        if (!ok) return;
        banBtn.disabled = true; banBtn.textContent = "جاري...";
        try {
          await updateDoc(doc(db, "users", uid), { isBanned: !u.isBanned });
          window.AccountArchive?.log(uid, "ban", u.isBanned ? "banned" : "unbanned", u.isBanned ? "unbanned" : "banned");
          // ── Audit Log ──
          await writeAuditLog(
            u.isBanned ? AUDIT_ACTIONS.UNBAN_USER : AUDIT_ACTIONS.BAN_USER,
            { method: 'account_ban' },
            uid,
            u.name || '—'
          );
          toast(u.isBanned ? "تم رفع الحظر" : "تم الحظر");
          loadOwnerUsers(); loadOwnerStats();
        } catch(e) { toast("فشل التحديث","error"); banBtn.disabled=false; }
      });
      actionsEl.appendChild(banBtn);

      // ── حظر الشات / رفعه — Owner يملك الصلاحيتين ──
      const chatBanBtn = document.createElement("button");
      chatBanBtn.className   = `act-btn ${u.isChatBanned ? "chatunban" : "chatban"}`;
      chatBanBtn.innerHTML = u.isChatBanned ? '<i class="fa-solid fa-comments"></i> رفع حظر الشات' : '<i class="fa-solid fa-volume-xmark"></i> حظر الشات';
      chatBanBtn.addEventListener("click", () => {
        // قراءة الحالة الحية من الـ class (بعد أي toggle سابق)
        const nowBanned = chatBanBtn.classList.contains("chatunban");
        toggleChatBan(uid, u.name || "هذا المستخدم", nowBanned, chatBanBtn, (newBannedState) => {
          // تحديث الـ cache المحلي للـ search/filter
          const cached = _allOwnerUsers.find(x => (x.uid || x.id) === uid);
          if (cached) cached.isChatBanned = newBannedState;
          // تحديث الـ badge داخل الكارت مباشرة
          const badgesEl = div.querySelector(".u-badges");
          if (badgesEl) {
            const oldBadge = badgesEl.querySelector(".badge-chatban");
            if (newBannedState && !oldBadge) {
              const s = document.createElement("span");
              s.className = "badge badge-chatban"; s.innerHTML = "<i class=\"fa-solid fa-ban\"></i> شات";
              badgesEl.appendChild(s);
            } else if (!newBannedState && oldBadge) { oldBadge.remove(); }
          }
        });
      });
      actionsEl.appendChild(chatBanBtn);

      // Promote / Demote — Owner only
      if (isOwner() && canSetRole(currentRole, uRole, uRole === ROLES.ADMIN ? ROLES.USER : ROLES.ADMIN)) {
        const roleBtn = document.createElement("button");
        const isCurrentlyAdmin = uRole === ROLES.ADMIN;
        roleBtn.className   = `act-btn ${isCurrentlyAdmin ? "demote" : "promote"}`;
        roleBtn.innerHTML = isCurrentlyAdmin ? '<i class="fa-solid fa-chevron-down"></i> إزالة أدمن' : '<i class="fa-solid fa-chevron-up"></i> ترقية أدمن';
        roleBtn.addEventListener("click", async () => {
          const newRole = isCurrentlyAdmin ? ROLES.USER : ROLES.ADMIN;
          const label   = isCurrentlyAdmin ? "مستخدم عادي" : "أدمن";
          const ok = await confirm("تغيير الصلاحية",
            `هل تريد تغيير صلاحية "${esc(u.name||"هذا المستخدم")}" إلى "${label}"؟`);
          if (!ok) return;
          roleBtn.disabled = true; roleBtn.textContent = "جاري...";
          try {
            await updateDoc(doc(db, "users", uid), { role: newRole });
            window.AccountArchive?.log(uid, "role", uRole, newRole);
            // ── Audit Log ──
            await writeAuditLog(
              isCurrentlyAdmin ? AUDIT_ACTIONS.DEMOTE_ADMIN : AUDIT_ACTIONS.PROMOTE_ADMIN,
              { oldRole: uRole, newRole },
              uid,
              u.name || '—'
            );
            toast(`تم تغيير الصلاحية إلى "${label}"`);
            loadOwnerUsers(); loadOwnerStats();
          } catch(e) { toast("فشل تغيير الصلاحية","error"); roleBtn.disabled=false; }
        });
        actionsEl.appendChild(roleBtn);
      }

    } else if (isOwnerDoc) {
      const prot = document.createElement("span");
      prot.style.cssText = "font-size:10px;color:var(--gold);font-weight:700;text-align:center;padding:4px 8px;display:block;";
      prot.innerHTML = '<i class="fa-solid fa-lock"></i> محمي';
      actionsEl.appendChild(prot);
    } else if (isSelf) {
      const self = document.createElement("span");
      self.style.cssText = "font-size:10px;color:var(--muted);padding:4px 8px;display:block;";
      self.textContent = "—";
      actionsEl.appendChild(self);
    }

    list.appendChild(div);
  });
}

/* ══════════════════════════════════════════
   ADMIN PANEL — User List
   Admin: ban/unban users only (NOT other admins, NOT owner)
   Admin: can ban from chat but CANNOT unban chat
══════════════════════════════════════════ */
let _allAdminUsers = [];

async function loadAdminUsers() {
  const list = document.getElementById("adminUsersList");
  if (!list) return;
  list.innerHTML = `<div class="spinner"></div>`;
  try {
    const snap = await getDocs(collection(db, "users"));
    const _allFetched = [];
    snap.forEach(docu => _allFetched.push({ id: docu.id, ...docu.data() }));
    // ✅ Admin Isolation: الأونر يبقى Global بلا فلترة — الأدمن العادي يرى فقط
    // المستخدمين اللي user.worldId بتاعهم يطابق currentUserWorldId(). مستخدم
    // بلا worldId لا يُعامَل كأنه تابع لعالم الأدمن.
    const _myWorld = (typeof window.currentUserWorldId === "function") ? window.currentUserWorldId() : null;
    _allAdminUsers = isOwner() ? _allFetched : _allFetched.filter(u => u.worldId === _myWorld);
    renderAdminUsers(_allAdminUsers);
  } catch(e) {
    list.innerHTML = `<div class="empty-state">خطأ في التحميل</div>`;
    console.error(e);
  }
}

function renderAdminUsers(users) {
  const list = document.getElementById("adminUsersList");
  if (!list) return;
  list.innerHTML = "";
  if (!users.length) { list.innerHTML = `<div class="empty-state">لا توجد نتائج</div>`; return; }

  users.forEach(u => {
    const uid        = u.uid || u.id;
    const uRole      = u.role || ROLES.USER;
    const isSelf     = uid === currentUser?.uid;
    const isOwnerDoc = uRole === ROLES.OWNER;

    if (isOwnerDoc) return; // Admin cannot see/touch owner

    const roleBadges = {
      admin: `<span class="badge badge-admin"><i class="fa-solid fa-gear"></i> Admin</span>`,
      user:  `<span class="badge badge-user"><i class="fa-solid fa-circle-user"></i> User</span>`
    };
    const bannedBadge  = u.isBanned     ? `<span class="badge badge-banned">محظور</span>` : "";
    const chatBanBadge = u.isChatBanned ? `<span class="badge badge-chatban"><i class="fa-solid fa-ban"></i> شات</span>` : "";

    const div = document.createElement("div");
    div.className = "user-card";
    div.innerHTML = `
      <div class="user-info">
        <div class="u-name">${renderUserDisplay(u.name||"—", u)} ${isSelf ? '<span style="font-size:10px;color:var(--muted)">(أنت)</span>' : ""}</div>
        <div class="u-email">${esc(displayEmail(u.email))}</div>
        <div class="u-badges">${roleBadges[uRole]||""} ${bannedBadge} ${chatBanBadge}</div>
      </div>
      <div class="user-actions"></div>
    `;

    const actionsEl = div.querySelector(".user-actions");

    if (!isSelf && uRole !== ROLES.ADMIN) {
      // Account ban (users only)
      const banBtn = document.createElement("button");
      banBtn.className   = `act-btn ${u.isBanned ? "unban" : "ban"}`;
      banBtn.innerHTML = u.isBanned ? '<i class="fa-solid fa-check"></i> رفع الحظر' : '<i class="fa-solid fa-ban"></i> حظر الحساب';
      banBtn.addEventListener("click", async () => {
        // ✅ Admin Isolation: تحقق مباشر وقت التنفيذ (وليس فقط اعتمادًا على
        // أن المستخدم ظهر في قائمة مفلترة) — الأونر يتجاوز هذا التحقق.
        if (!isOwner()) {
          const _myWorld = (typeof window.currentUserWorldId === "function") ? window.currentUserWorldId() : null;
          if (!u.worldId || u.worldId !== _myWorld) { toast("غير مصرح — هذا المستخدم لا يتبع عالمك", "error"); return; }
        }
        const ok = await confirm(u.isBanned ? "رفع الحظر" : "حظر المستخدم",
          `${u.isBanned ? "هل تريد رفع الحظر عن" : "هل تريد حظر"} "${esc(u.name||"هذا المستخدم")}"؟`);
        if (!ok) return;
        banBtn.disabled = true; banBtn.textContent = "جاري...";
        try {
          await updateDoc(doc(db, "users", uid), { isBanned: !u.isBanned });
          window.AccountArchive?.log(uid, "ban", u.isBanned ? "banned" : "unbanned", u.isBanned ? "unbanned" : "banned");
          // ── Audit Log ──
          await writeAuditLog(
            u.isBanned ? AUDIT_ACTIONS.UNBAN_USER : AUDIT_ACTIONS.BAN_USER,
            { method: 'account_ban', byRole: 'admin' },
            uid,
            u.name || '—'
          );
          toast(u.isBanned ? "تم رفع الحظر" : "تم الحظر");
          loadAdminUsers();
        } catch(e) {
          toast("فشل التحديث","error");
          banBtn.disabled=false;
          banBtn.innerHTML = u.isBanned ? '<i class="fa-solid fa-check"></i> رفع الحظر' : '<i class="fa-solid fa-ban"></i> حظر الحساب';
        }
      });
      actionsEl.appendChild(banBtn);

      // ── حظر الشات — Admin: حظر فقط / Owner: يستخدم لوحته الخاصة ──
      if (!u.isChatBanned) {
        const chatBanBtn = document.createElement("button");
        chatBanBtn.className   = "act-btn chatban";
        chatBanBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i> حظر الشات';
        chatBanBtn.addEventListener("click", () => {
          // ✅ Admin Isolation: تحقق مباشر وقت التنفيذ — الأونر يتجاوز هذا التحقق.
          if (!isOwner()) {
            const _myWorld = (typeof window.currentUserWorldId === "function") ? window.currentUserWorldId() : null;
            if (!u.worldId || u.worldId !== _myWorld) { toast("غير مصرح — هذا المستخدم لا يتبع عالمك", "error"); return; }
          }
          toggleChatBan(uid, u.name || "هذا المستخدم", false, chatBanBtn, (newBannedState) => {
            // تحديث cache محلي
            const cached = _allAdminUsers.find(x => (x.uid || x.id) === uid);
            if (cached) cached.isChatBanned = newBannedState;
            // تحديث badge في كارت المستخدم
            const badgesEl = div.querySelector(".u-badges");
            if (badgesEl && newBannedState) {
              const s = document.createElement("span");
              s.className = "badge badge-chatban"; s.innerHTML = "<i class=\"fa-solid fa-ban\"></i> شات";
              badgesEl.appendChild(s);
            }
            // Admin لا يستطيع رفع الحظر — استبدال الزر بـ note
            if (newBannedState) {
              setTimeout(() => {
                chatBanBtn.replaceWith(buildChatBannedNote());
              }, 400);
            }
          });
        });
        actionsEl.appendChild(chatBanBtn);
      } else {
        actionsEl.appendChild(buildChatBannedNote());
      }

      function buildChatBannedNote() {
        const note = document.createElement("span");
        note.className = "chatban-locked-note";
        note.title = "فقط الأونر يستطيع رفع حظر الشات";
        note.innerHTML = `<i class="fa-solid fa-volume-xmark"></i> محظور الشات <span style="color:var(--muted);font-size:9px;">(الأونر فقط يرفع)</span>`;
        return note;
      }
    }

    list.appendChild(div);
  });
}

// Search filters
document.getElementById("adminSearchInput")?.addEventListener("input", e => {
  const q = e.target.value.trim();
  if (!q) { renderAdminUsers(_allAdminUsers); return; }
  const lower = q.toLowerCase();
  const isNumericId = /^\d{5,6}$/.test(q);
  renderAdminUsers(_allAdminUsers.filter(u =>
    (u.name||"").toLowerCase().includes(lower) ||
    (u.email||"").toLowerCase().includes(lower) ||
    (isNumericId && (u.publicId||"") === q)
  ));
});

document.getElementById("ownerSearchInput")?.addEventListener("input", e => {
  const q = e.target.value.trim();
  if (!q) { renderOwnerUsers(_allOwnerUsers); return; }
  const lower = q.toLowerCase();
  const isNumericId = /^\d{5,6}$/.test(q);
  renderOwnerUsers(_allOwnerUsers.filter(u =>
    (u.name||"").toLowerCase().includes(lower) ||
    (u.email||"").toLowerCase().includes(lower) ||
    (isNumericId && (u.publicId||"") === q)
  ));
});

// index.html (users manager refresh button) calls these from an inline onclick, so they must be on window
window.loadOwnerUsers = loadOwnerUsers;
window.loadOwnerStats = loadOwnerStats;

export { loadAdminUsers, loadOwnerStats };
