import { collection, doc, getDocs, limit, onSnapshot, orderBy, query,
         startAfter, updateDoc, where, writeBatch }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const PAGE_SIZE = 40;
let _oldestDoc = null;
let _allLoaded = false;
let _loadingMore = false;
let _activeChatId = null;
let _chatGeneration = 0;
let _messageStore = new Map();
let _pendingTimes = new Map();
let _renderDate = null, _renderSender = null;
let _historyObserver = null;
const _historyStops = new Map();
const _historyRows = new Map();
window._chatLiveIds = new Set();
const _chatIsVisible = () => !document.hidden &&
  !!document.getElementById("page-chat")?.classList.contains("active");
const _stamp = d => {
  const stamp=d.data().createdAt?.toMillis?.() ?? d.data().createdAt?.getTime?.();
  if(stamp != null) return stamp;
  if(!_pendingTimes.has(d.id)) _pendingTimes.set(d.id,Date.now());
  return _pendingTimes.get(d.id);
};
const _compareDocs = (a,b) => _stamp(a)-_stamp(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const _isCurrent = (chatId, generation) => generation === _chatGeneration &&
  chatId === _activeChatId && _chatIsVisible();

function _drawMessages(chatId, initial = false) {
  const container = document.getElementById("chatMessages");
  const nearBottom = initial || container.scrollHeight-container.scrollTop-container.clientHeight < 100;
  // Preserve the first visible message, including when images or older pages
  // change the layout. Do not mistake live-window eviction for message deletion.
  const top = container.getBoundingClientRect().top;
  const anchor = [...container.querySelectorAll('[id^="msg-"]')].find(el => el.getBoundingClientRect().bottom > top);
  const anchorId = anchor?.id;
  const anchorTop = anchor?.getBoundingClientRect().top;
  window._cleanupPollListeners?.();
  container.innerHTML = "";
  _renderDate = null; _renderSender = null;
  const docs = [..._messageStore.values()].sort(_compareDocs);
  if (!docs.length) container.innerHTML = '<div class="empty-state" style="margin:auto;">لا توجد رسائل بعد</div>';
  if (!_allLoaded) _insertLoadMoreBtn(container, chatId);
  docs.forEach(d => _appendStoredMessage(container,d));
  const behavior = container.style.scrollBehavior;
  container.style.scrollBehavior = "auto";
  if (nearBottom) container.scrollTop = container.scrollHeight;
  else if (anchorId) {
    const next = document.getElementById(anchorId);
    if (next) container.scrollTop += next.getBoundingClientRect().top-anchorTop;
  }
  container.style.scrollBehavior = behavior;
  _syncVisibleHistory(chatId);
}

function _appendStoredMessage(container,d) {
  appendChatMsg(container,d.id,d.data(),_renderDate,v=>_renderDate=v,_renderSender,v=>_renderSender=v);
}

function _refreshLoadedMessage(d) {
  const data=d.data(), row=document.getElementById('msg-'+d.id);
  if(!row) return;
  if(data.deleted) {
    const bubble=row.querySelector('.bubble-text, .bubble-image, .poll-card');
    if(bubble) {bubble.className='bubble-text';bubble.textContent='🗑 تم حذف هذه الرسالة';}
    return;
  }
  _refreshMsgTick(d.id,data);
  if(data.edited && !data.image && !data.audio && !data.pdf && !data.file) {
    const text=row.querySelector('.bubble-text');
    if(text) text.textContent=data.text || '';
    const meta=row.querySelector('.bubble-time-in');
    if(meta && !meta.querySelector('.edited-label')) {
      const label=document.createElement('span');label.className='edited-label';
      label.textContent='تم التعديل';meta.appendChild(label);
    }
  }
  if(typeof _updateReactionChips==='function') _updateReactionChips(row,d.id,data.reactions || {});
  if(data.poll) window._refreshPollCard?.(d.id,data.poll);
  if(typeof _ctxDocId!=='undefined' && _ctxDocId===d.id && typeof _ctxData!=='undefined') {
    _ctxData={..._ctxData,...data};
    document.querySelectorAll('#ctxReactionBar .reaction-btn').forEach(btn=>{
      btn.classList.toggle('my-pick',(data.reactions?.[btn.dataset.emoji] || []).includes(currentUser?.uid));
    });
  }
}

// Only older messages actually on screen need document listeners. The latest
// forty, including their polls/reactions, are already covered by the head.
function _syncVisibleHistory(chatId) {
  if(!_historyObserver || !_chatIsVisible()) return;
  const live=window._chatLiveIds;
  for(const [id,row] of _historyRows) {
    if(live.has(id) || !row.isConnected) {
      _historyObserver.unobserve(row);_historyRows.delete(id);
      _historyStops.get(id)?.();_historyStops.delete(id);
    }
  }
  for(const id of _messageStore.keys()) {
    if(live.has(id) || _historyRows.has(id)) continue;
    const row=document.getElementById('msg-'+id);
    if(row) {_historyRows.set(id,row);_historyObserver.observe(row);}
  }
}

async function startChatListener(chatId) {
  if (!_chatIsVisible()) return;
  window._stopChatListener();
  const generation = _chatGeneration;
  _activeChatId = chatId;
  window._chatOwnsMessageUpdates = true;
  if(typeof IntersectionObserver!=='undefined') _historyObserver=new IntersectionObserver(entries=>{
    if(!_isCurrent(chatId,generation)) return;
    for(const entry of entries) {
      const id=entry.target.id.slice(4);
      if(_historyRows.get(id)!==entry.target) continue;
      if(!entry.isIntersecting || window._chatLiveIds.has(id)) {
        _historyStops.get(id)?.();_historyStops.delete(id);continue;
      }
      if(_historyStops.has(id)) continue;
      const stop=onSnapshot(doc(db,chatColPath(chatId),id),snap=>{
        if(!_isCurrent(chatId,generation)) return;
        if(snap.exists()) {_messageStore.set(id,snap);_refreshLoadedMessage(snap);}
        else {_messageStore.delete(id);document.getElementById('msg-'+id)?.remove();}
      },err=>console.warn('visible history:',err.code));
      _historyStops.set(id,stop);
    }
  },{root:document.getElementById('chatMessages')});
  _messageStore = new Map();
  _pendingTimes = new Map();
  _oldestDoc = null; _allLoaded = false; _loadingMore = false;
  const container = document.getElementById("chatMessages");
  updateChatBannedState();
  container.innerHTML = window._buildMsgSkeletons?.(10) || '<div class="spinner"></div>';
  const worldId = chatId === "public" ? window.activeWorldContext?.() : null;
  if (chatId === "public" && (!worldId || !window.isValidWorldId?.(worldId))) {
    container.innerHTML = '<div class="empty-state">لا يوجد عالم نشط حاليًا</div>';
    _allLoaded = true;
    return;
  }
  const isPrivate = chatId !== "public" && !chatId.startsWith("room:");
  const headQuery = query(collection(db,chatColPath(chatId)),
    ...(chatId === "public" ? [where("worldId","==",worldId)] : []),
    orderBy("createdAt","desc"),limit(PAGE_SIZE));
  let first = true;
  msgUnsub = onSnapshot(headQuery,snap=>{
    if (!_isCurrent(chatId,generation)) return;
    const previousIds = window._chatLiveIds;
    window._chatLiveIds = new Set(snap.docs.map(d=>d.id));
    // A disjoint head after a long offline period can hide a gap. Restart the
    // backward cursor at this head, rather than skipping the missing interval.
    const gap = !first && snap.size === PAGE_SIZE &&
      !snap.docs.some(d=>previousIds.has(d.id));
    if (first || gap) {
      _oldestDoc = snap.docs.at(-1) || null;
      _allLoaded = snap.size < PAGE_SIZE;
    }
    const oldest = snap.docs.at(-1);
    const previousNewest=[..._messageStore.values()].sort(_compareDocs).at(-1);
    const added=[];
    let redraw=first || gap;
    for (const change of snap.docChanges()) {
      if (change.type === "removed") {
        // Limited-query removals normally mean the window advanced. Only a
        // removal still inside its new bounds (or a non-full head) is deletion.
        if (snap.size < PAGE_SIZE || (oldest && _compareDocs(change.doc,oldest) >= 0))
          { _messageStore.delete(change.doc.id);redraw=true; }
      } else {
        if(!_messageStore.has(change.doc.id)) added.push(change.doc);
        else {
          if(_stamp(_messageStore.get(change.doc.id))!==_stamp(change.doc)) redraw=true;
          _refreshLoadedMessage(change.doc);
        }
        _messageStore.set(change.doc.id,change.doc);
      }
    }
    // A fresh snapshot may report all documents as added; ID-keyed storage
    // prevents duplicates on reconnect and while the history cursor overlaps.
    snap.docs.forEach(d=>_messageStore.set(d.id,d));
    if(added.some(d=>previousNewest && _compareDocs(d,previousNewest)<0)) redraw=true;
    if(redraw) _drawMessages(chatId,first);
    else {
      const nearBottom=container.scrollHeight-container.scrollTop-container.clientHeight<100;
      container.querySelector('.empty-state')?.remove();
      added.sort(_compareDocs).forEach(d=>_appendStoredMessage(container,d));
      if(nearBottom && added.length) container.scrollTop=container.scrollHeight;
      _syncVisibleHistory(chatId);
    }
    if (isPrivate && first) _markMessagesSeenAsync(chatId);
    else if (isPrivate) snap.docChanges().forEach(c=>{
      if(c.type === "added" && c.doc.data().uid !== currentUser.uid && !c.doc.data().seen)
        _markOneMsgSeen(chatId,c.doc.id);
    });
    first = false;
  },err=>{
    if (!_isCurrent(chatId,generation)) return;
    if (isPrivate && err.code === "permission-denied") {
      window._dmNeedsRelisten = chatId;
      _allLoaded = true;
      _drawMessages(chatId,true);
    } else {
      console.error("chat head:",err);
      container.innerHTML = '<div class="empty-state">تعذر تحميل الرسائل. أعد فتح المحادثة للمحاولة.</div>';
    }
  });
  container.onscroll = () => {
    if(container.scrollTop < 80 && !_loadingMore && !_allLoaded) _loadOlderMessages(chatId);
  };
}

function _insertLoadMoreBtn(container,chatId) {
  if(container.querySelector('.load-more-btn')) return;
  const btn=document.createElement('button');
  btn.className='load-more-btn';
  btn.textContent='تحميل رسائل أقدم';
  btn.onclick=()=>_loadOlderMessages(chatId);
  container.prepend(btn);
}

async function _loadOlderMessages(chatId) {
  const generation=_chatGeneration;
  if(!_isCurrent(chatId,generation) || _loadingMore || _allLoaded || !_oldestDoc) return;
  _loadingMore=true;
  const container=document.getElementById('chatMessages');
  const btn=container.querySelector('.load-more-btn');
  if(btn) {btn.disabled=true;btn.textContent='جاري التحميل...';}
  try {
    const worldId=chatId==='public'?window.activeWorldContext?.():null;
    if(chatId==='public' && (!worldId || !window.isValidWorldId?.(worldId))) return;
    const snap=await getDocs(query(collection(db,chatColPath(chatId)),
      ...(chatId==='public'?[where('worldId','==',worldId)]:[]),
      orderBy('createdAt','desc'),startAfter(_oldestDoc),limit(PAGE_SIZE)));
    if(!_isCurrent(chatId,generation)) return;
    snap.docs.forEach(d=>_messageStore.set(d.id,d));
    if(snap.size < PAGE_SIZE) _allLoaded=true;
    if(snap.docs.length) _oldestDoc=snap.docs.at(-1);
    _drawMessages(chatId);
  } catch(e) {
    if(_isCurrent(chatId,generation)) {
      console.error('loadOlder:',e);
      if(btn) {btn.disabled=false;btn.textContent='تعذر التحميل. اضغط للمحاولة';}
    }
  } finally {
    if(generation===_chatGeneration) _loadingMore=false;
  }
}
window.startChatListener=startChatListener;
/* ══════════════════════════════════════════
   SEEN / DELIVERED HELPERS
══════════════════════════════════════════ */
// تحديد جميع الرسائل غير المقروءة كـ "seen" (batch) عند فتح المحادثة
async function _markMessagesSeenAsync(otherUid) {
  if (!_chatIsVisible() || _activeChatId !== otherUid) return;
  const generation = _chatGeneration;
  // ✅ Privacy: إذا أوقف المستخدم إيصالات القراءة لا نُرسلها
  if (typeof _privPrefs !== "undefined" && _privPrefs.readReceipts === false) return;
  try {
    const roomId = privateChatId(otherUid);
    const q = query(
      collection(db, `privateChats/${roomId}/messages`),
      where("seen", "==", false),
      limit(50)
    );
    const snap = await getDocs(q);
    if (snap.empty || generation !== _chatGeneration || !_chatIsVisible()) return;
    const batch = writeBatch(db);
    // علّم فقط رسائل الطرف الآخر
    snap.forEach(d => {
      if (d.data().uid !== currentUser.uid) {
        batch.update(d.ref, { seen: true, delivered: true });
      }
    });
    await batch.commit();
  } catch(e) {
    // غير حرجة — تجاهل أخطاء الـ index أو الـ permission
    if (e.code !== "permission-denied") console.warn("markSeen:", e.code);
  }
}

// Mark a single newly-arrived message as seen
async function _markOneMsgSeen(otherUid, msgId) {
  if (!_chatIsVisible() || _activeChatId !== otherUid) return;
  // ✅ Privacy: إذا أوقف المستخدم إيصالات القراءة لا نُرسلها
  if (typeof _privPrefs !== "undefined" && _privPrefs.readReceipts === false) return;
  try {
    const roomId = privateChatId(otherUid);
    await updateDoc(
      doc(db, `privateChats/${roomId}/messages`, msgId),
      { delivered: true, seen: true }
    );
  } catch(e) { /* non-critical */ }
}

// Refresh the ✓✓ tick on an already-rendered message bubble
function _refreshMsgTick(msgId, data) {
  const row = document.getElementById(`msg-${msgId}`);
  if (!row) return;
  const tickEl = row.querySelector(".bubble-status");
  if (!tickEl) return;
  const _checkSvg2 = `<svg width="14" height="10" viewBox="0 0 16 10" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 5l3 3 5-7"/><path d="M6 5l3 3 6-7"/></svg>`;
  const _checkSvg1 = `<svg width="12" height="10" viewBox="0 0 16 10" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 5l3 3 8-9"/></svg>`;
  if (data.seen)           { tickEl.innerHTML = _checkSvg2; tickEl.classList.add("seen"); }
  else if (data.delivered) { tickEl.innerHTML = _checkSvg2; tickEl.classList.remove("seen"); }
  else                      { tickEl.innerHTML = _checkSvg1; tickEl.classList.remove("seen"); }
}


window._markMessagesSeenAsync = _markMessagesSeenAsync;
window._markOneMsgSeen = _markOneMsgSeen;
window._refreshMsgTick = _refreshMsgTick;
window._loadOlderMessages = _loadOlderMessages;
window._insertLoadMoreBtn = _insertLoadMoreBtn;
window._stopChatListener = () => {
  ++_chatGeneration;
  _activeChatId=null;
  if(msgUnsub) {try{msgUnsub();}catch(e){}msgUnsub=null;}
  window._chatLiveIds=new Set();
  window._chatOwnsMessageUpdates=false;
  _historyObserver?.disconnect();_historyObserver=null;
  _historyStops.forEach(stop=>stop());_historyStops.clear();_historyRows.clear();
  window._cleanupPollListeners?.();
  const container=document.getElementById('chatMessages');
  if(container) container.onscroll=null;
};
window._resumeVisibleChat=()=>{
  if(_chatIsVisible() && !_activeChatId && window.currentUser?.uid)
    startChatListener(window._currentChatId);
};
document.addEventListener('visibilitychange',()=>{
  if(document.hidden) window._stopChatListener();
  else window._resumeVisibleChat();
});
