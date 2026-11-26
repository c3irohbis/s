import { collection, query, where, onSnapshot, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// A complete server snapshot may be reused while its live subscription remains
// active. No guessed cache completeness, persisted TTL, or cross-account reuse.
const entries = new Map();
function entryFor(db, world, uid) {
  if (!db || !world || !uid) throw new Error('Schedule context unavailable');
  const key = JSON.stringify([uid, world]);
  let entry = entries.get(key);
  if (!entry || entry.db !== db) {
    entry = {key,db,world,uid,listeners:new Set(),stop:null,snapshot:null,pending:null};
    entries.set(key,entry);
  }
  return entry;
}
const scheduleQuery = e => query(collection(e.db,'studySchedule'),where('worldId','==',e.world));
export function subscribeSchedule(db, world, uid, next, error) {
  if (window.__BLISS_STUDYSCHEDULE_MODE !== 'firebase') return window.StudyScheduleSQL.subscribe(world, uid, next, error);
  const e = entryFor(db,world,uid), listener = {next,error};
  e.listeners.add(listener);
  if (!e.stop) {
    e.stop = onSnapshot(scheduleQuery(e), {includeMetadataChanges:true}, snap => {
      if (!e.listeners.size) return;
      e.snapshot = !snap.metadata?.fromCache && !snap.metadata?.hasPendingWrites ? snap : null;
      for (const l of e.listeners) l.next(snap);
    }, err => {
      e.snapshot = null;
      for (const l of e.listeners) l.error?.(err);
    });
  } else if(e.snapshot) next(e.snapshot);
  return () => {
    e.listeners.delete(listener);
    if (!e.listeners.size) {
      e.stop?.(); e.stop=null; e.snapshot=null;
      if (entries.get(e.key) === e) entries.delete(e.key);
    }
  };
}
export async function getSchedule(db, world, uid = globalThis.currentUser?.uid) {
  if (window.__BLISS_STUDYSCHEDULE_MODE !== 'firebase') return window.StudyScheduleSQL.list(world, uid);
  const e = entryFor(db,world,uid);
  if (e.stop && e.snapshot) return e.snapshot;
  if (e.pending) return e.pending;
  e.pending = getDocs(scheduleQuery(e)).finally(() => {
    e.pending = null;
    if (!e.listeners.size && entries.get(e.key) === e) entries.delete(e.key);
  });
  return e.pending;
}
