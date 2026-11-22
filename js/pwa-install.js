/* Shared PWA install state for the login entry, forum card and promotion. */
(function () {
  "use strict";
  window.__pwaInstallEvt = null;
  var busy = false;
  var accepted = false;
  var lastOutcome = "";

  function isApp() {
    try {
      if (["standalone", "fullscreen", "minimal-ui"].some(function (mode) {
        return window.matchMedia && window.matchMedia("(display-mode: " + mode + ")").matches;
      })) return true;
      return window.navigator.standalone === true || !!window.__pwaInstalled ||
        (document.referrer || "").indexOf("android-app://") === 0 ||
        sessionStorage.getItem("__bariqApp") === "1";
    } catch (_) { return !!window.__pwaInstalled; }
  }

  window.getPWAInstallState = function () {
    if (isApp()) return "installed";
    if (busy) return "prompting";
    if (accepted) return "installing";
    if (window.__pwaInstallEvt) return "available";
    return "BeforeInstallPromptEvent" in window ? "waiting" : "unavailable";
  };

  function message(state) {
    if (state === "installed") return "التطبيق مثبت على جهازك";
    if (state === "available") return "ثبّت التطبيق على جهازك بدون تسجيل الدخول";
    if (state === "prompting") return "أكمل اختيارك في نافذة التثبيت";
    if (state === "installing") return "في انتظار تأكيد اكتمال التثبيت";
    if (lastOutcome === "dismissed") return "أُلغيت نافذة التثبيت. يمكنك المحاولة لاحقًا من قائمة المتصفح.";
    if (lastOutcome === "error") return "تعذر فتح التثبيت. جرّب خيارات التثبيت في قائمة المتصفح.";
    if (state === "waiting") return "التثبيت ليس جاهزًا هنا بعد. افتح قائمة المتصفح لعرض خيارات التثبيت.";
    return "التثبيت المباشر غير متاح هنا. افتح الموقع في Chrome على Android، أو استخدم المشاركة ثم إضافة إلى الشاشة الرئيسية على iPhone.";
  }

  function render() {
    var state = window.getPWAInstallState();
    document.querySelectorAll("[data-pwa-install-entry], [data-pwa-install-action]").forEach(function (el) {
      el.hidden = state === "installed";
      el.style.display = el.hidden ? "none" : "";
    });
    document.querySelectorAll("[data-pwa-install-action]").forEach(function (button) {
      button.disabled = state === "prompting" || state === "installing";
      button.textContent = state === "available" ? "تثبيت التطبيق" : "خيارات تثبيت التطبيق";
      button.title = message(state);
    });
    document.querySelectorAll("[data-pwa-install-status]").forEach(function (el) { el.textContent = message(state); });
    var sub = document.getElementById("pwaInstallCardSub");
    if (sub) sub.textContent = message(state);
    var card = document.getElementById("pwaInstallCard");
    if (card) {
      card.style.display = state === "installed" ? "none" : "";
      card.setAttribute("aria-disabled", String(state === "prompting" || state === "installing"));
    }
  }

  function changed() {
    render();
    window.dispatchEvent(new CustomEvent("pwa-install-statechange", { detail: { state: window.getPWAInstallState() } }));
  }

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    window.__pwaInstallEvt = isApp() ? null : event;
    accepted = false;
    lastOutcome = "";
    changed();
  });
  window.addEventListener("appinstalled", function () {
    window.__pwaInstallEvt = null;
    window.__pwaInstalled = true;
    busy = false;
    accepted = false;
    changed();
  });

  window.installPWAFromCard = async function () {
    var state = window.getPWAInstallState();
    if (state !== "available") {
      if (state !== "prompting" && state !== "installing") window.toast && window.toast(message(state), "info");
      return { outcome: state };
    }
    var event = window.__pwaInstallEvt;
    window.__pwaInstallEvt = null;
    busy = true;
    lastOutcome = "";
    changed();
    try {
      await event.prompt();
      var choice = await event.userChoice;
      lastOutcome = choice && choice.outcome === "accepted" ? "accepted" : "dismissed";
      accepted = lastOutcome === "accepted" && !isApp();
      return { outcome: lastOutcome };
    } catch (_) {
      lastOutcome = "error";
      window.toast && window.toast(message("waiting"), "error");
      return { outcome: "error" };
    } finally {
      busy = false;
      changed();
    }
  };

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-pwa-install-action]").forEach(function (button) {
      button.addEventListener("click", function () { window.installPWAFromCard(); });
    });
    render();
  });
})();
