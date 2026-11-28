(function() {
  const EMOJI_DATA = {
    "🕐 Recent": [],
    "😀 Smileys": ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩","😘","😗","😚","😙","🥲","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🤐","🤨","😐","😑","😶","😏","😒","🙄","😬","🤥","😌","😔","😪","🤤","😴","😷","🤒","🤕","🤢","🤮","🤧","🥵","🥶","🥴","😵","💫","🤯","🤠","🥳","🥸","😎","🤓","🧐","😕","😟","🙁","☹️","😮","😯","😲","😳","🥺","😦","😧","😨","😰","😥","😢","😭","😱","😖","😣","😞","😓","😩","😫","🥱","😤","😡","😠","🤬","😈","👿","💀","☠️","💩","🤡","👹","👺","👻","👽","👾","🤖","😺","😸","😹","😻","😼","😽","🙀","😿","😾"],
    "👋 People": ["👋","🤚","🖐️","✋","🖖","👌","🤌","🤏","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","🖕","👇","☝️","👍","👎","✊","👊","🤛","🤜","👏","🙌","👐","🤲","🤝","🙏","✍️","💅","🤳","💪","🦾","🦿","🦵","🦶","👂","🦻","👃","🫀","🫁","🧠","🦷","🦴","👀","👁️","👅","👄","💋","🫦","👶","🧒","👦","👧","🧑","👱","👨","🧔","👩","🧓","👴","👵","🙍","🙎","🙅","🙆","💁","🙋","🧏","🙇","🤦","🤷","👮","🕵️","💂","🥷","👷","🫅","🤴","👸","👳","👲","🧕","🤵","👰","🤰","🤱","👼","🎅","🤶","🦸","🦹","🧙","🧚","🧛","🧜","🧝","🧞","🧟","🧌","💆","💇","🚶","🧍","🧎","🏃","💃","🕺","🕴️","👫","👬","👭","💑","👨‍👩‍👦","👨‍👩‍👧","👨‍👩‍👧‍👦","👩‍👦","👩‍👧","👨‍👦","👨‍👧"],
    "🐶 Animals": ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🙈","🙉","🙊","🐔","🐧","🐦","🐤","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝","🪱","🐛","🦋","🐌","🐞","🐜","🪲","🦟","🦗","🪳","🕷️","🦂","🐢","🐍","🦎","🦕","🦖","🐙","🦑","🦐","🦞","🦀","🐡","🐠","🐟","🐬","🐳","🐋","🦈","🦭","🐊","🐅","🐆","🦓","🦍","🦧","🦣","🐘","🦛","🦏","🐪","🐫","🦒","🦘","🦬","🐃","🐂","🐄","🐎","🐖","🐏","🐑","🦙","🐐","🦌","🐕","🐩","🦮","🐈","🐓","🦃","🦤","🦚","🦜","🦢","🦩","🕊️","🐇","🦝","🦨","🦡","🦫","🦦","🦥","🐁","🐀","🐿️","🦔","🐾","🐉","🐲","🌵","🎄","🌲","🌳","🌴","🪵","🌱","🌿","☘️","🍀","🎍","🎋","🍃","🍂","🍁","🪺","🪹","🍄","🌾","💐","🌷","🌹","🥀","🌺","🌸","🌼","🌻","🌞","🌝","🍇","🍈","🍉","🍊","🍋","🍌","🍍","🥭","🍎","🍏","🍐","🍑","🍒","🍓","🫐","🥝","🍅","🫒","🥥"],
    "🍕 Food": ["🍕","🍔","🌭","🍟","🍿","🧂","🥓","🥚","🍳","🧇","🥞","🧈","🍞","🥐","🥖","🫓","🥨","🥯","🧀","🥗","🥙","🥪","🌮","🌯","🫔","🥫","🍝","🍜","🍲","🍛","🍣","🍱","🥟","🦪","🍤","🍙","🍚","🍘","🍥","🥮","🍢","🧆","🥚","🍡","🧁","🍰","🎂","🍮","🍭","🍬","🍫","🍿","🍩","🍪","🌰","🥜","🍯","🧃","🥤","🧋","🍵","☕","🫖","🍺","🍻","🥂","🍷","🥃","🍸","🍹","🧉","🍾","🧊","🥄","🍴","🍽️","🫙","🥢","🧊"],
    "⚽ Activities": ["⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉","🥏","🎱","🪀","🏓","🏸","🏒","🏑","🥍","🏏","🪃","🥅","⛳","🪁","🎣","🤿","🎽","🎿","🛷","🥌","🎯","🪃","🎱","🔫","🎮","🕹️","🎲","🧩","🧸","🪆","♟️","🎭","🎨","🎬","🎤","🎧","🎼","🎹","🥁","🪘","🎷","🎺","🪗","🎸","🎻","🎤","🎙","🎚","🎛","📻","🎞","📽","🎦","📺","🎠","🎡","🎢","🎪","🤹","🎭","🩰","🏋️","🤼","🤸","🏊","🚴","🧘","🏇","🧗","🤺","🤾","🏌","🏄","🚣","🧜","🤽","🏂","🪂","🏋️","🤼","🤸","⛹️","🏊","🚴","🧘","🤺","🤾"],
    "✈️ Travel": ["✈️","🚀","🛸","🚁","🛶","⛵","🚤","🛥","🛳","⛴","🚢","🚂","🚃","🚄","🚅","🚆","🚇","🚈","🚉","🚊","🚝","🚞","🚋","🚌","🚍","🚎","🚐","🚑","🚒","🚓","🚔","🚕","🚖","🚗","🚘","🚙","🚚","🚛","🚜","🏎","🏍","🛵","🦽","🦼","🛺","🚲","🛴","🛹","🛼","🚏","🛣","🛤","⛽","🚨","🚥","🚦","🛑","🚧","⚓","🛟","⛵","🗺","🧭","🏔","⛰","🌋","🗻","🏕","🏖","🏜","🏝","🏞","🏟","🏛","🏗","🏘","🏚","🏠","??","🏢","🏣","🏤","🏥","🏦","🏨","🏩","🏪","🏫","🏬","🏭","🏯","🏰","💒","🗼","🗽","⛪","🕌","🛕","🕍","⛩","🕋","⛲","⛺","🌁","🌃","🌄","🌅","🌆","🌇","🌉","♾","🎠","🎡","🎢","🎪","🌐","🗾","🧭","🌍","🌎","🌏"],
    "💡 Objects": ["💡","🔦","🕯","🪔","🧱","🪞","🪟","🛋","🚪","🧴","🧷","🧹","🧺","🧻","🧼","🫧","🪣","🧽","🪒","🧴","💊","💉","🩸","🩹","🩺","🩻","🚑","🔬","🔭","🩺","📡","🛰","💊","🩴","👑","💍","💎","📿","🔮","🧿","🪬","💈","🔱","🪄","🎩","🧢","👒","🎓","⛑","🪖","💄","👡","👠","👢","🥾","👞","👟","🩰","🧣","🧤","🧥","👔","👕","👖","🩱","👗","👘","🥻","🩲","🩳","👙","👚","🪭","🎒","💼","👜","👝","👛","💰","💳","💸","🪙","💵","💴","💶","💷","💎","🔑","🗝","🔐","🔒","🔓","🔨","🪓","⛏","🔧","🔩","⚙️","🗜","🔫","🧲","🪛","🔬","📱","💻","🖥","🖨","⌨️","🖱","🖲","💾","💿","📀","📷","📸","📹","🎥","📽","🎞","📞","☎️","📟","📠","📺","📻","🎙","🎚","🎛","🧭","⏱","⏰","🕰","⌛","⏳","📡","🔋","🪫","🔌","💡","🔦","🕯","🪔"],
    "💯 Symbols": ["💯","🔞","📵","🚫","❌","⭕","🛑","⛔","📛","🔰","♻️","✅","💠","♾️","🔱","📛","🔰","✳️","❇️","🆚","🆘","🈹","🈴","🈺","🈷️","🈶","🈵","🈚","🈸","🈲","🅰️","🅱️","🆎","🆑","🅾️","🆘","🔴","🟠","🟡","🟢","🔵","🟣","⚫","⚪","🟤","🔶","🔷","🔸","🔹","🔺","🔻","💠","🔘","🔲","🔳","▪️","▫️","◾","◽","◼️","◻️","🟥","🟧","🟨","🟩","🟦","🟪","⬛","⬜","🟫","🔈","🔉","🔊","📢","📣","🔔","🔕","🎵","🎶","💬","💭","🗯","♠️","♣️","♥️","♦️","🃏","🀄","🎴","🎭","🎨","🖼","🎪","🎠","🎡","🎢","🎪","🎤","🎧","🎼","🎹","🥁","🪘","🎷","🎺","🎸","🎻","⚡","🌈","☁️","🌤","⛅","🌥","☔","❄️","⛄","🌊","💧","🔥","🌪","🌀","🌂","☂️","☀️","🌙","⭐","🌟","💫","⚡","🌈","🌊","🌋","🌌","⛰","🌅","🌄"],
    "🚩 Flags": ["🏁","🚩","🎌","🏴","🏳️","🏳️‍🌈","🏳️‍⚧️","🏴‍☠️","🇦🇫","🇦🇱","🇩🇿","🇦🇩","🇦🇴","🇦🇷","🇦🇲","🇦🇺","🇦🇹","🇦🇿","🇧🇸","🇧🇭","🇧🇩","🇧🇧","🇧🇾","🇧🇪","🇧🇿","🇧🇯","🇧🇹","🇧🇴","🇧🇦","🇧🇼","🇧🇷","🇧🇳","🇧🇬","🇧🇫","🇧🇮","🇨🇻","🇨🇲","🇨🇦","🇨🇫","🇹🇩","🇨🇱","🇨🇳","🇨🇴","🇰🇲","🇨🇬","🇨🇷","🇭🇷","🇨🇺","🇨🇾","🇨🇿","🇩🇰","🇩🇯","🇩🇲","🇩🇴","🇪🇨","🇪🇬","🇸🇻","🇬🇶","🇪🇷","🇪🇪","🇸🇿","🇪🇹","🇫🇯","🇫🇮","🇫🇷","🇬🇦","🇬🇲","🇬🇪","🇩🇪","🇬🇭","🇬🇷","🇬🇩","🇬🇹","🇬🇳","🇬🇼","🇬🇾","🇭🇹","🇭🇳","🇭🇺","🇮🇸","🇮🇳","🇮🇩","🇮🇷","🇮🇶","🇮🇪","🇮🇱","🇮🇹","🇯🇲","🇯🇵","🇯🇴","🇰🇿","🇰🇪","🇰🇮","🇰🇼","🇰🇬","🇱🇦","🇱🇻","🇱🇧","🇱🇸","🇱🇷","🇱🇾","🇱🇮","🇱🇹","🇱🇺","🇲🇬","🇲🇼","🇲🇾","🇲🇻","🇲🇱","🇲🇹","🇲🇭","🇲🇷","🇲🇺","🇲🇽","🇫🇲","🇲🇩","🇲🇨","🇲🇳","🇲🇪","🇲🇦","🇲🇿","🇲🇲","🇳🇦","🇳🇷","🇳🇵","🇳🇱","🇳🇿","🇳🇮","🇳🇪","🇳🇬","🇳🇴","🇴🇲","🇵🇰","🇵🇼","🇵🇦","🇵🇬","🇵🇾","🇵🇪","🇵🇭","🇵🇱","🇵🇹","🇶🇦","🇷🇴","🇷🇺","🇷🇼","🇸🇦","🇸🇳","🇷🇸","🇸🇱","🇸🇬","🇸🇰","🇸🇮","🇸🇧","🇸🇴","🇿🇦","🇸🇸","🇪🇸","🇱🇰","🇸🇩","🇸🇷","🇸🇪","🇨🇭","🇸🇾","🇹🇼","🇹🇯","🇹🇿","🇹🇭","🇹🇱","🇹🇬","🇹🇴","🇹🇹","🇹🇳","🇹🇷","🇹🇲","🇺🇬","🇺🇦","🇦🇪","🇬🇧","🇺🇸","🇺🇾","🇺🇿","🇻🇺","🇻🇪","🇻🇳","🇾🇪","🇿🇲","🇿🇼"]
  };

  const CAT_ICONS = ["🕐","😀","👋","🐶","🍕","⚽","✈️","💡","💯","🚩"];
  const RECENT_KEY = "_epRecents";
  const MAX_RECENT = 32;

  function _getRecents() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch(e){ return []; }
  }
  function _addRecent(emoji) {
    let r = _getRecents().filter(e => e !== emoji);
    r.unshift(emoji);
    if (r.length > MAX_RECENT) r = r.slice(0, MAX_RECENT);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch(e){}
  }

  const wrap = document.getElementById("emojiPickerWrap");
  const btn  = document.querySelector(".newchat-shell .emoji-icon");
  const _inp = () => document.getElementById("chatInput");
  let _open  = false;
  let _currentCat = 0; // index into categories

  // Build picker HTML once
  const categories = Object.keys(EMOJI_DATA);

  function _buildPicker() {
    wrap.innerHTML = `
      <div class="ep-search-wrap">
        <input class="ep-search" id="epSearch" placeholder="🔍 بحث عن إيموجي..." autocomplete="off" spellcheck="false">
      </div>
      <div class="ep-cats" id="epCats">
        ${CAT_ICONS.map((ic,i) => `<button class="ep-cat-btn${i===0?' active':''}" data-cat="${i}" title="${categories[i]}">${ic}</button>`).join("")}
      </div>
      <div class="ep-body" id="epBody"></div>
    `;
    _renderCat(0);
    document.getElementById("epSearch").addEventListener("input", _onSearch);
    document.getElementById("epCats").addEventListener("click", e => {
      const b = e.target.closest(".ep-cat-btn");
      if (!b) return;
      const i = +b.dataset.cat;
      document.querySelectorAll(".ep-cat-btn").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      _currentCat = i;
      document.getElementById("epSearch").value = "";
      _renderCat(i);
    });
    document.getElementById("epBody").addEventListener("click", e => {
      const b = e.target.closest(".ep-emoji-btn");
      if (!b) return;
      _insertEmoji(b.dataset.emoji);
    });
  }

  function _renderCat(catIdx) {
    const body = document.getElementById("epBody");
    if (!body) return;
    const catName = categories[catIdx];
    let emojis = catIdx === 0 ? _getRecents() : EMOJI_DATA[catName];
    if (!emojis || emojis.length === 0) {
      body.innerHTML = `<div class="ep-no-results">${catIdx === 0 ? "لا يوجد إيموجي مستخدم بعد" : "لا يوجد إيموجي"}</div>`;
      return;
    }
    body.innerHTML = `<div class="ep-section-label">${catName}</div><div class="ep-grid">${emojis.map(e=>`<button class="ep-emoji-btn" data-emoji="${e}" title="${e}">${e}</button>`).join("")}</div>`;
    body.scrollTop = 0;
  }

  function _onSearch(e) {
    const q = e.target.value.trim().toLowerCase();
    const body = document.getElementById("epBody");
    if (!body) return;
    if (!q) { _renderCat(_currentCat); return; }
    // Search across all categories except Recent
    const all = [];
    categories.slice(1).forEach(cat => { all.push(...EMOJI_DATA[cat]); });
    // Simple: filter by unicode name lookup — just show all that include query char or filter first 200
    // Since we don't have name DB, return all and let user scroll — search by emoji char match
    const matched = all.filter(em => em.includes(q) || [...em].some(c => c.codePointAt(0)?.toString(16).includes(q)));
    if (matched.length === 0) { body.innerHTML = `<div class="ep-no-results">لا توجد نتائج لـ "${q}"</div>`; return; }
    body.innerHTML = `<div class="ep-section-label">نتائج البحث</div><div class="ep-grid">${matched.slice(0,80).map(em=>`<button class="ep-emoji-btn" data-emoji="${em}" title="${em}">${em}</button>`).join("")}</div>`;
    body.scrollTop = 0;
  }

  function _insertEmoji(emoji) {
    if (!emoji) return;
    _addRecent(emoji);
    const inp = _inp();
    if (!inp) return;
    const start = inp.selectionStart ?? inp.value.length;
    const end   = inp.selectionEnd   ?? inp.value.length;
    inp.value = inp.value.slice(0, start) + emoji + inp.value.slice(end);
    const pos = start + [...emoji].length;
    inp.focus();
    try { inp.setSelectionRange(pos, pos); } catch(e){}
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    if (window.innerWidth < 600) _close();
  }

  function _positionPicker() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const pw = 320, ph = 420;
    const bR = btn.getBoundingClientRect();
    // إذا الزر مخفي أو خارج الشاشة (width=0 أو top=0 بسبب display:none في parent)
    const btnVisible = bR.width > 0 && bR.height > 0 && bR.bottom > 0;
    let top, left;
    if (btnVisible) {
      top  = bR.top - ph - 8;
      left = bR.left + bR.width / 2 - pw / 2;
      if (top < 8) top = bR.bottom + 8;
    } else {
      // fallback: ركن أسفل الشاشة
      top  = vh - ph - 8;
      left = vw / 2 - pw / 2;
    }
    if (top + ph > vh - 8) top = vh - ph - 8;
    if (top < 8) top = 8;
    if (left + pw > vw - 8) left = vw - pw - 8;
    if (left < 8) left = 8;
    wrap.style.top  = top  + "px";
    wrap.style.left = left + "px";
    wrap.style.width = Math.min(pw, vw - 16) + "px";
  }

  function _open2() {
    _open = true;
    if (_currentCat === 0) _renderCat(0);
    _positionPicker();
    wrap.classList.add("ep-open");
    requestAnimationFrame(() => { const s = document.getElementById("epSearch"); if(s) s.focus(); });
  }

  function _close() {
    _open = false;
    wrap.classList.remove("ep-open");
  }

  // Build once
  _buildPicker();

  btn.addEventListener("click", e => {
    e.stopPropagation();
    _open ? _close() : _open2();
  });

  document.addEventListener("click", e => {
    if (_open && !wrap.contains(e.target) && e.target !== btn) _close();
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && _open) _close();
  });

  window.addEventListener("resize", () => { if (_open) _positionPicker(); });
})();
