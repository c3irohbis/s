/* split from js/app-main.js (block F_nav_chatpage) — verbatim code; cross-module state writes go through __set_* helpers */
import { loadExams, loadNews, loadSections } from "./p-content-loaders-forum.js";
import { loadAdminUsers, loadOwnerStats } from "./r-owner-admin-panels.js";
import { renderOwnerRoomsList } from "./u-rooms.js";
/* ══════════════════════════════════════════
   PAGE / TAB NAVIGATION
══════════════════════════════════════════ */

window.showPage = (id) => {
  const _prevPageEl = document.querySelector(".page.active");
  const _prevPageId = _prevPageEl ? _prevPageEl.id : null;
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.dispatchEvent(new Event("uniAppReady")); // يقفل شاشة التحميل الحديثة بمجرد ظهور أول صفحة فعلية
  const _bn = document.querySelector(".bottom-nav");
  if (_bn) {
    _bn.style.display = (id === "page-home" || id === "page-dms") ? "" : "none";
    _bn.classList.toggle("dms-mode", id === "page-dms");
  }
  if (id === "page-owner") {
    loadOwnerStats();
    renderOwnerRoomsList();
    // Phase 1 / 5.1 — Owner activeWorld: عرض الاختيار الحالي عند فتح اللوحة
    const _aws = document.getElementById("activeWorldSelect");
    if (_aws && window._activeWorld) _aws.value = window._activeWorld;
  }
  if (id === "page-admin") { loadAdminUsers(); }
  if (_prevPageId && _prevPageId !== id) {
    window._navPush?.(`page:${id}`, () => window.showPage(_prevPageId));
  }
  if (id !== "page-chat") {
    window._stopChatListener?.();
    window._cleanupPollListeners?.();
  } else queueMicrotask(() => window._resumeVisibleChat?.());
  window._forumLiveSync?.();   // قوائم المنتدى: اربط/افصل المستمع حسب ظهور القسم
};

function goTab(tabId) {
  const _prevTabEl = document.querySelector(".tab-content.active");
  const _prevTabId = _prevTabEl ? _prevTabEl.id : null;
  document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
  document.getElementById(tabId)?.classList.add("active");
  document.querySelectorAll(".tab").forEach(t =>
    t.classList.toggle("active", t.dataset.tab === tabId));
  document.querySelectorAll(".nav-item[data-nav]").forEach(n =>
    n.classList.toggle("active", n.dataset.nav === tabId));
  // When entering forum tab, show landing grid
  if (tabId === "tab-forum") {
    document.getElementById("forum-landing").style.display = "";
    ["tab-news-content","tab-lectures-content","tab-exams-content","tab-sections-content","tab-attendance-content"]
      .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = "none"; });
  }
  if (_prevTabId && _prevTabId !== tabId) {
    window._navPush?.(`tab:${tabId}`, () => goTab(_prevTabId));
  }
  window._forumLiveSync?.();   // قوائم المنتدى: اربط/افصل المستمع حسب ظهور القسم
}
window.goTab = goTab;

// Forum section open/close
window.openForumSection = function(sectionKey, contentId) {
  const _el = document.getElementById(contentId);
  const _alreadyOpen = _el && _el.style.display !== "none";
  document.getElementById("forum-landing").style.display = "none";
  ["tab-news-content","tab-lectures-content","tab-exams-content","tab-sections-content","tab-attendance-content"]
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = "none"; });
  const el = document.getElementById(contentId);
  if (el) el.style.display = "";
  // trigger data load via existing load functions
  const loaders = {
    "tab-news-content":     () => loadNews(),
    "tab-lectures-content": () => window.loadLectures(),
    "tab-exams-content":    () => loadExams(),
    "tab-sections-content": () => loadSections(),
    "tab-attendance-content": () => window.loadAttendanceHistory?.(),
  };
  try { loaders[contentId]?.(); } catch(e) {}
  if (!_alreadyOpen) {
    window._navPush?.(`forum:${contentId}`, () => window.closeForumSection(contentId));
  }
  window._forumLiveSync?.();   // ضمان: المستمع شغّال للقسم الظاهر (idempotent)
};
window.closeForumSection = function(contentId) {
  if (window._navGoBackIfMatches?.(`forum:${contentId}`)) return;
  const el = document.getElementById(contentId);
  if (el) el.style.display = "none";
  document.getElementById("forum-landing").style.display = "";
  window._forumLiveSync?.();   // القسم اتقفل → افصل المستمع
};

// Official portal URL — change this value to update the link
const PORTAL_URL = "https://chi-eg.net/student_portal/?fbclid=Iwb21leAPq43hjbGNrA-rjRGV4dG4DYWVtAjExAHNydGMGYXBwX2lkDDM1MDY4NTUzMTcyOAABHkpCDRA8xSs7nItW3grqTxplTvYLsx1bYQSIosAjaza3rlBAtxE3395goFLL_aem_NpaEu8Nx7ixJG1fj_aGTdw";
window.openPortal = function() { window.open(PORTAL_URL, "_blank", "noopener,noreferrer"); };

document.querySelectorAll(".tab").forEach(t =>
  t.addEventListener("click", () => goTab(t.dataset.tab)));
document.querySelectorAll(".nav-item[data-nav]").forEach(n =>
  n.addEventListener("click", () => {
    if (!document.getElementById("page-home")?.classList.contains("active")) showPage("page-home");
    goTab(n.dataset.nav);
  }));

document.getElementById("topbarLeft").addEventListener("click", () => goTab("tab-profile"));
document.getElementById("ownerBackBtn").addEventListener("click", () => {
  if (!window._navGoBackIfMatches?.("page:page-owner")) showPage("page-home");
});
document.getElementById("adminBackBtn").addEventListener("click", () => {
  if (!window._navGoBackIfMatches?.("page:page-admin")) showPage("page-home");
});

/* ══════════════════════════════════════════
   CHAT PAGE OPEN / CLOSE
══════════════════════════════════════════ */
window.openChatPage = function() {
  showPage("page-chat");
  selectChat("public", "الشات العام", "");
};
window.closeChatPage = function() {
  if (window._navGoBackIfMatches?.("page:page-chat")) return;
  showPage("page-home");
};
window.closeArchivePage = function() {
  if (window._navGoBackIfMatches?.("page:page-dms-archive")) return;
  showPage("page-dms");
};
window.closeAiChatPage = function() {
  if (window._navGoBackIfMatches?.("page:page-ai-chat")) return;
  showPage("page-dms");
};


window.openDmsPanel = function() {
  showPage("page-dms");
  window._dmsPageInit?.();
};

export { goTab };
