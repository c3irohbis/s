/* split from js/app-main.js (block H_avatars) — verbatim code; cross-module state writes go through __set_* helpers */
import { esc } from "./v-profile-cards-picctx.js";
/* ══════════════════════════════════════════
   DEFAULT AVATAR SVGs
══════════════════════════════════════════ */
function _maleSVG(size) {
  // Premium Male Avatar — Deep blue theme with gold accent
  return `<svg width="${size}" height="${size}" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" style="border-radius:50%;display:block;">
    <defs>
      <radialGradient id="mgBg${size}" cx="40%" cy="35%" r="65%">
        <stop offset="0%" stop-color="#0f2044"/>
        <stop offset="100%" stop-color="#060d1a"/>
      </radialGradient>
      <radialGradient id="mgSkin${size}" cx="45%" cy="35%" r="60%">
        <stop offset="0%" stop-color="#e8c97a"/>
        <stop offset="100%" stop-color="#c9a557"/>
      </radialGradient>
      <linearGradient id="mgShirt${size}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#1d4ed8"/>
        <stop offset="100%" stop-color="#1e3a8a"/>
      </linearGradient>
      <radialGradient id="mgGlow${size}" cx="50%" cy="45%" r="50%">
        <stop offset="0%" stop-color="rgba(59,130,246,0.18)"/>
        <stop offset="100%" stop-color="transparent"/>
      </radialGradient>
    </defs>
    <!-- Background -->
    <circle cx="40" cy="40" r="40" fill="url(#mgBg${size})"/>
    <circle cx="40" cy="40" r="40" fill="url(#mgGlow${size})"/>
    <!-- Body / Shirt -->
    <path d="M13 80 Q14 54 40 50 Q66 54 67 80Z" fill="url(#mgShirt${size})"/>
    <!-- Collar & tie detail -->
    <path d="M34 51 L40 56 L46 51 L42 51 L40 53 L38 51Z" fill="#93c5fd"/>
    <path d="M38.5 53 L40 70 L41.5 53 L40 56Z" fill="#bfdbfe" opacity="0.6"/>
    <!-- Neck -->
    <rect x="35" y="43" width="10" height="10" rx="4" fill="url(#mgSkin${size})"/>
    <!-- Head -->
    <ellipse cx="40" cy="30" rx="14" ry="15" fill="url(#mgSkin${size})"/>
    <!-- Hair — short masculine -->
    <path d="M26 29 Q26 14 40 13 Q54 14 54 29 Q52 20 40 19 Q28 20 26 29Z" fill="#2d1810"/>
    <!-- Ear left -->
    <ellipse cx="26.5" cy="30" rx="2" ry="3" fill="#c9a557"/>
    <!-- Ear right -->
    <ellipse cx="53.5" cy="30" rx="2" ry="3" fill="#c9a557"/>
    <!-- Eye Left -->
    <ellipse cx="34.5" cy="29" rx="2.2" ry="2" fill="#1a0e00"/>
    <circle cx="35" cy="28.5" r=".7" fill="white" opacity=".5"/>
    <!-- Eye Right -->
    <ellipse cx="45.5" cy="29" rx="2.2" ry="2" fill="#1a0e00"/>
    <circle cx="46" cy="28.5" r=".7" fill="white" opacity=".5"/>
    <!-- Eyebrows -->
    <path d="M32 26 Q34.5 24.8 37 26" stroke="#2d1810" stroke-width="1.2" stroke-linecap="round" fill="none"/>
    <path d="M43 26 Q45.5 24.8 48 26" stroke="#2d1810" stroke-width="1.2" stroke-linecap="round" fill="none"/>
    <!-- Nose -->
    <path d="M39 31 Q38.5 35 39.5 36 Q40.5 36 41.5 35 Q42.5 34 40 31" stroke="#b8883d" stroke-width=".8" fill="none" opacity=".6"/>
    <!-- Smile -->
    <path d="M35.5 38 Q40 41.5 44.5 38" stroke="#8b5e24" stroke-width="1.3" stroke-linecap="round" fill="none"/>
    <!-- Cheek blush -->
    <circle cx="30" cy="35" r="3.5" fill="rgba(255,200,100,0.15)"/>
    <circle cx="50" cy="35" r="3.5" fill="rgba(255,200,100,0.15)"/>
  </svg>`;
}

function _femaleSVG(size) {
  // Premium Female Avatar — Rose-navy theme with warm pink accent
  return `<svg width="${size}" height="${size}" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" style="border-radius:50%;display:block;">
    <defs>
      <radialGradient id="fgBg${size}" cx="40%" cy="35%" r="65%">
        <stop offset="0%" stop-color="#1a0a2e"/>
        <stop offset="100%" stop-color="#0d0618"/>
      </radialGradient>
      <radialGradient id="fgSkin${size}" cx="45%" cy="35%" r="60%">
        <stop offset="0%" stop-color="#f0c987"/>
        <stop offset="100%" stop-color="#d4a055"/>
      </radialGradient>
      <linearGradient id="fgShirt${size}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#be185d"/>
        <stop offset="100%" stop-color="#831843"/>
      </linearGradient>
      <radialGradient id="fgGlow${size}" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="rgba(236,72,153,0.14)"/>
        <stop offset="100%" stop-color="transparent"/>
      </radialGradient>
      <radialGradient id="fgHair${size}" cx="50%" cy="20%" r="70%">
        <stop offset="0%" stop-color="#3d1a1a"/>
        <stop offset="100%" stop-color="#1a0a0a"/>
      </radialGradient>
    </defs>
    <!-- Background -->
    <circle cx="40" cy="40" r="40" fill="url(#fgBg${size})"/>
    <circle cx="40" cy="40" r="40" fill="url(#fgGlow${size})"/>
    <!-- Body -->
    <path d="M11 80 Q13 52 40 49 Q67 52 69 80Z" fill="url(#fgShirt${size})"/>
    <!-- Neckline detail -->
    <path d="M33 50 Q40 53 47 50 Q43 55 40 55 Q37 55 33 50Z" fill="#fb7185" opacity=".6"/>
    <!-- Neck -->
    <rect x="35.5" y="43" width="9" height="9" rx="4" fill="url(#fgSkin${size})"/>
    <!-- Long hair behind (back layer) -->
    <path d="M22 30 Q21 48 26 62 Q30 70 35 72 Q38 73 40 73 Q42 73 45 72 Q50 70 54 62 Q59 48 58 30 Q55 40 40 41 Q25 40 22 30Z" fill="url(#fgHair${size})"/>
    <!-- Head -->
    <ellipse cx="40" cy="28" rx="13.5" ry="14.5" fill="url(#fgSkin${size})"/>
    <!-- Hair top -->
    <path d="M27 27 Q27 13 40 12 Q53 13 53 27 Q51 18 40 17 Q29 18 27 27Z" fill="url(#fgHair${size})"/>
    <!-- Hair side sweeps -->
    <path d="M26.5 25 Q24 30 25 38 Q27 26 29 24Z" fill="url(#fgHair${size})"/>
    <path d="M53.5 25 Q56 30 55 38 Q53 26 51 24Z" fill="url(#fgHair${size})"/>
    <!-- Small curls / fringe -->
    <path d="M28 20 Q30 15 33 17" stroke="#3d1a1a" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M47 17 Q50 15 52 20" stroke="#3d1a1a" stroke-width="2" fill="none" stroke-linecap="round"/>
    <!-- Ears -->
    <ellipse cx="26.5" cy="28.5" rx="2.2" ry="2.8" fill="#d4a055"/>
    <ellipse cx="53.5" cy="28.5" rx="2.2" ry="2.8" fill="#d4a055"/>
    <!-- Ear rings -->
    <circle cx="26.5" cy="31" r="1.2" fill="#f9a8d4" opacity=".9"/>
    <circle cx="53.5" cy="31" r="1.2" fill="#f9a8d4" opacity=".9"/>
    <!-- Eye Left -->
    <ellipse cx="34" cy="27.5" rx="2.5" ry="2.2" fill="#1a0e00"/>
    <circle cx="34.6" cy="27" r=".8" fill="white" opacity=".5"/>
    <!-- Eye Right -->
    <ellipse cx="46" cy="27.5" rx="2.5" ry="2.2" fill="#1a0e00"/>
    <circle cx="46.6" cy="27" r=".8" fill="white" opacity=".5"/>
    <!-- Lashes upper left -->
    <path d="M31.5 25.5 Q34 24 36.5 25.5" stroke="#1a0e00" stroke-width="1.2" stroke-linecap="round" fill="none"/>
    <!-- Lashes upper right -->
    <path d="M43.5 25.5 Q46 24 48.5 25.5" stroke="#1a0e00" stroke-width="1.2" stroke-linecap="round" fill="none"/>
    <!-- Eyebrow Left (arched) -->
    <path d="M31 23.5 Q34 21.5 37 23.5" stroke="#3d1a1a" stroke-width="1.3" stroke-linecap="round" fill="none"/>
    <!-- Eyebrow Right (arched) -->
    <path d="M43 23.5 Q46 21.5 49 23.5" stroke="#3d1a1a" stroke-width="1.3" stroke-linecap="round" fill="none"/>
    <!-- Nose -->
    <path d="M39 31 Q38.5 34 39.5 35 Q40.5 35.2 41.5 34 Q42.5 33 40 31" stroke="#b8883d" stroke-width=".8" fill="none" opacity=".5"/>
    <!-- Smile with lipstick -->
    <path d="M35.5 37.5 Q40 41 44.5 37.5" stroke="#c2185b" stroke-width="1.8" stroke-linecap="round" fill="none"/>
    <path d="M35.5 37.5 Q40 38.5 44.5 37.5" stroke="#e91e8c" stroke-width=".6" fill="none" opacity=".4"/>
    <!-- Cheek blush -->
    <ellipse cx="29" cy="33" rx="4" ry="2.5" fill="rgba(236,72,153,0.2)"/>
    <ellipse cx="51" cy="33" rx="4" ry="2.5" fill="rgba(236,72,153,0.2)"/>
  </svg>`;
}

// Get default avatar HTML based on gender — صورة الطالب/الطالبة الحقيقية (نظام واحد موحّد للمشروع بالكامل)
function _defaultAvatarHTML(gender, size) {
  const src = gender === "female" ? "images/default-student-female.png" : "images/default-student-male.png";
  return `<img src="${src}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
}
// تعريض الدالة فقط لأن js/dms-page.js و js/mention.js يعملان كموديولات منفصلة (نفس نمط window._chatListBadgesHTML الموجود)
window._defaultAvatarHTML = _defaultAvatarHTML;

/* ══════════════════════════════════════════
   AVATAR HELPERS
══════════════════════════════════════════ */
function setAvatarUI(src, isUrl, gender) {
  // isUrl=null means SVG content directly
  ["avatar","profileAvatar","navProfileAvatar"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (isUrl === null) {
      el.innerHTML = src; // raw SVG
    } else {
      el.innerHTML = isUrl ? `<img src="${src}" alt="">` : src;
    }
    // Apply gender glow class to profile avatar
    if (id === "profileAvatar") {
      el.classList.remove("gender-male","gender-female","gender-none");
      if (gender === "male")   el.classList.add("gender-male");
      else if (gender === "female") el.classList.add("gender-female");
      else el.classList.add("gender-none");
    }
  });
}

function avatarHTML(photo, name, size=38, gender) {
  if (photo) return `<img src="${esc(photo)}" alt="" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:50%;">`;
  return _defaultAvatarHTML(gender, size);
}

export { _defaultAvatarHTML, setAvatarUI };
