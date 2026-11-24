/* split from js/app-main.js (block E_toast_confirm) — verbatim code; cross-module state writes go through __set_* helpers */
/* ══════════════════════════════════════════
   TOAST
══════════════════════════════════════════ */
window.toast = function(msg, type = "success") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 3000);
};

/* ══════════════════════════════════════════
   CONFIRMATION MODAL
══════════════════════════════════════════ */
function confirm(title, body) {
  return new Promise(resolve => {
    document.getElementById("modalTitle").textContent = title;
    document.getElementById("modalBody").textContent  = body;
    document.getElementById("modalBackdrop").classList.add("show");

    // Clone buttons to remove ALL previous listeners in one shot
    const oldOk  = document.getElementById("modalConfirm");
    const oldCan = document.getElementById("modalCancel");
    const newOk  = oldOk.cloneNode(true);
    const newCan = oldCan.cloneNode(true);
    oldOk.replaceWith(newOk);
    oldCan.replaceWith(newCan);

    function cleanup(result) {
      document.getElementById("modalBackdrop").classList.remove("show");
      resolve(result);
    }
    newOk.addEventListener("click",  () => cleanup(true),  { once: true });
    newCan.addEventListener("click", () => cleanup(false), { once: true });
  });
}
document.getElementById("modalCancel").addEventListener("click", () => {
  document.getElementById("modalBackdrop").classList.remove("show");
});
// تعريض باسم آمن (مش window.confirm) عشان محدش يتصادم مع confirm() الأصلية بتاعة المتصفح
window._appConfirm = confirm;

export { confirm };
