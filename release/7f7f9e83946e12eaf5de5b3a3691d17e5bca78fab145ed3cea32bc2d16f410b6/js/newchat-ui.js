/* ══════════════════════════════════════════════════════════════
   NEW CHAT UI — سكريبت واجهة الشات الجديد (مرحلة 1: واجهة فقط)
   ▸ الاستعلامات الأربعة الأصلية كانت document.querySelector بدون
     نطاق محدد؛ اتحصرت هنا جوه .newchat-shell فقط (تعديل دفاعي،
     صفر تغيير في السلوك أو الشكل)
   ▸ ممنوع هذا الملف يلمس Firebase أو selectChat() أو
     chat-listener.js — مرحلة 1 واجهة فقط
   ══════════════════════════════════════════════════════════════ */

(function(){
  const shell = document.querySelector('.newchat-shell');
  if (!shell) return;

  const input   = shell.querySelector('.placeholder-text');
  const messages= shell.querySelector('.messages');
  const barMain = shell.querySelector('.bar-main');
  const sendBtn = shell.querySelector('#chatSendBtn');

  const cameraSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
  const sendSvg = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M3 20l18-8L3 4v6l12 2-12 2z"/></svg>';

  function updateBarState(){
    const hasText = input.value.trim().length > 0;
    barMain.classList.toggle('typing', hasText);
    sendBtn.innerHTML = hasText ? sendSvg : cameraSvg;
  }

  function sendMessage(){
    const text = input.value.trim();
    if(!text) return;
    const now = new Date();
    const time = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');

    const row = document.createElement('div');
    row.className = 'row out';
    row.innerHTML = `
      <div class="bubble out">
        <div></div>
        <div class="bubble-meta"><span>${time}</span><span class="ticks"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M2 12l4 4L14 8"/><path d="M9 12l4 4L21 8"/></svg></span></div>
      </div>`;
    row.querySelector('.bubble.out div').textContent = text;

    messages.appendChild(row);
    input.value = '';
    updateBarState();
    messages.scrollTop = messages.scrollHeight;
  }

  input.addEventListener('input', updateBarState);
  // ✅ إصلاح: أُزيل مستمع Enter المحلي من هنا — كان بيرسم فقاعة وهمية
  // في حاوية غير #chatMessages ويُفضّي input.value قبل ما المستمع
  // الحقيقي (index.html ~4559، بينادي sendChatMsg() الفعلية) ياخد
  // فرصته، فيمنع إرسال الرسالة لـ Firestore فعليًا عند استخدام Enter.
  // sendMessage() هنا بقت بلا أي استدعاء (كانت بلا استدعاء أصلاً غير
  // هذا المستمع المحذوف)، فضلت معرّفة ومصدّرة تحسبًا لأي اعتماد خارجي.

  window.sendMessage = sendMessage;
  window.updateBarState = updateBarState;
})();
