/* split from js/app-main.js (block O_profile_save) — verbatim code; cross-module state writes go through __set_* helpers */
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./a-init-config.js";
import { uploadToCloudinary } from "./b-fcm-notif.js";
import { __set_currentName, __set_currentPhoto, currentName, currentPhoto, currentUser } from "./d-state-roles-email.js";
import { _defaultAvatarHTML, setAvatarUI } from "./h-avatars.js";
import { renderUserDisplay } from "./s-badges-display.js";
/* ══════════════════════════════════════════
   PROFILE SAVE
══════════════════════════════════════════ */
document.getElementById("saveProfile").addEventListener("click", async () => {
  if (!currentUser) return;
  const name = document.getElementById("editName").value.trim();
  const bio  = document.getElementById("editBio").value.trim();
  if (!name) return toast("اكتب اسمك أولاً", "error");

  const _aaOldName = currentName, _aaOldBio = document.getElementById("profileBioText")?.textContent || "";
  try {
    await updateDoc(doc(db, "users", currentUser.uid), { name, bio });
    if (name !== _aaOldName) window.AccountArchive?.log(currentUser.uid, "name", _aaOldName, name);
    if (bio  !== _aaOldBio)  window.AccountArchive?.log(currentUser.uid, "bio",  _aaOldBio,  bio);
    __set_currentName(name);
    // ✅ تحديث الاسم في _currentUserData قبل إعادة الرسم
    if (window._currentUserData) window._currentUserData.name = name;
    // ✅ استخدام innerHTML + renderUserDisplay لضمان ظهور الـ badges
    document.getElementById("welcomeText").innerHTML    = renderUserDisplay(name, window._currentUserData, currentUser.uid);
    document.getElementById("profileName").innerHTML    = renderUserDisplay(name, window._currentUserData, currentUser.uid);
    document.getElementById("profileBioText").textContent = bio;
    const av = document.getElementById("avatar");
    if (!av.querySelector("img")) setAvatarUI(_defaultAvatarHTML(window._currentUserData?.gender, 96), false, window._currentUserData?.gender);
    toast("تم حفظ التعديلات");
  } catch(e) { toast("فشل الحفظ", "error"); console.error(e); }
});

/* ══════════════════════════════════════════
   CHANGE PASSWORD — منقول بالكامل لـ js/change-password.js
══════════════════════════════════════════ */

document.getElementById("uploadBtn").addEventListener("click", async () => {
  const file = document.getElementById("imageInput").files[0];
  if (!file || !currentUser) return toast("اختر صورة أولاً", "error");
  if (file.size > 3 * 1024 * 1024) return toast("حجم الصورة كبير (max 3MB)", "error");
  toast("جاري الرفع...", "warn");
  try {
    const url = await uploadToCloudinary(file);
    const _aaOldPhoto = currentPhoto;
    await updateDoc(doc(db, "users", currentUser.uid), { photo: url });
    window.AccountArchive?.log(currentUser.uid, "photo", _aaOldPhoto, url);
    __set_currentPhoto(url);
    setAvatarUI(url, true, window._currentUserData?.gender);
    toast("تم رفع الصورة");
  } catch(e) { toast("فشل رفع الصورة", "error"); }
});

// Also trigger upload from profile avatar click
document.getElementById("profileAvatar").addEventListener("click", () =>
  document.getElementById("imageInput").click()
);
document.getElementById("imageInput").addEventListener("change", () => {
  document.getElementById("uploadBtn").click();
});
