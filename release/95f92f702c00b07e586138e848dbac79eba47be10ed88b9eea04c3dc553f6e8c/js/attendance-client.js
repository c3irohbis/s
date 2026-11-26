/* Attendance SQL transport: authenticated request/response, no Firestore dependency. */
(function(){'use strict';if(window.AttendanceSQL)return;
const ROOT='https://bliss-gateway.cairohbis.workers.dev/v1/attendance/';
const enabled=()=>window.__BLISS_ATTENDANCE_MODE==='supabase';
const WORLD=/^(is|lt|th|ba)_[1-4]$/;
async function request(op,{method='GET',body,query}={}){
 const user=window.currentUser;if(!user)throw Error('attendance-signed-out');const uid=user.uid,world=window.activeWorldContext?.(),token=await user.getIdToken(),url=new URL(ROOT+op);
 if(!WORLD.test(world||''))throw Error('attendance-context');
 if(window.currentUser?.uid!==uid||window.activeWorldContext?.()!==world)throw Error('attendance-account-changed');
 if(method==='GET'){url.searchParams.set('world',world);for(const[k,v]of Object.entries(query||{}))if(v!=null)url.searchParams.set(k,String(v))}
 const r=await fetch(url,{method,cache:'no-store',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify({...body,world})}:{})});const j=await r.json().catch(()=>({}));
 if(window.currentUser?.uid!==uid||window.activeWorldContext?.()!==world)throw Error('attendance-account-changed');
 if(!r.ok)throw Object.assign(Error('attendance-http'),{status:r.status,code:j.error});
 if(j.source!=='supabase'||j.complete!==true||!j.data)throw Error('attendance-invalid-payload');return j.data;
}
const DAYS=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
function shape(d){if(!d||typeof d!=='object'||typeof d.schedules!=='object'||d.schedules===null||Array.isArray(d.schedules))throw Error('attendance-response');const schedules={};for(const k of DAYS)schedules[k]=d.schedules[k]&&typeof d.schedules[k]==='object'?d.schedules[k]:null;return{settings:d.settings&&typeof d.settings==='object'?d.settings:null,schedules}}
const getConfig=async()=>shape(await request('config'));
const mutate=async(action,data)=>shape(await request('mutate',{method:'POST',body:{action,data,requestId:crypto.randomUUID()}}));
const setSettings=patch=>mutate('settings',patch);
const saveSchedules=days=>mutate('schedules',{days});
const deleteDays=days=>mutate('delete',{days});
const DAY_RE=/^\d{4}-\d{2}-\d{2}$/;
function isRealDate(s){
 if(!DAY_RE.test(s))return false;
 const[y,m,d]=s.split('-').map(Number);
 const t=new Date(Date.UTC(y,m-1,d));
 return t.getUTCFullYear()===y&&t.getUTCMonth()===m-1&&t.getUTCDate()===d;
}
const REC_KEYS=['status','totalSubjects','presentSubjects','absentSubjects','subjects','completedAt'];
const REC_STATUS=new Set(['present','partial','absent']);
const SUB_STATUS=new Set(['present','absent']);
function shapeSubjects(v){
 if(!Array.isArray(v)||v.length<1||v.length>12)throw Error('attendance-response');
 return v.map(s=>{
  if(!s||typeof s!=='object'||Array.isArray(s))throw Error('attendance-response');
  if(Object.keys(s).length!==2||typeof s.name!=='string'||!s.name.trim()||s.name.length>200||!SUB_STATUS.has(s.status))throw Error('attendance-response');
  return{name:s.name,status:s.status};
 });
}
function shapeRecord(r){
 if(!r||typeof r!=='object'||Array.isArray(r))throw Error('attendance-response');
 if(Object.keys(r).length!==REC_KEYS.length||REC_KEYS.some(k=>!(k in r)))throw Error('attendance-response');
 const{status,totalSubjects,presentSubjects,absentSubjects,subjects,completedAt}=r;
 if(!REC_STATUS.has(status)||!Number.isInteger(totalSubjects)||!Number.isInteger(presentSubjects)||!Number.isInteger(absentSubjects)||totalSubjects<1||totalSubjects>12||presentSubjects+absentSubjects!==totalSubjects||typeof completedAt!=='string')throw Error('attendance-response');
 const subs=shapeSubjects(subjects);
 if(subs.length!==totalSubjects)throw Error('attendance-response');
 if(status==='present'&&(absentSubjects!==0||presentSubjects!==totalSubjects))throw Error('attendance-response');
 if(status==='absent'&&(presentSubjects!==0||absentSubjects!==totalSubjects))throw Error('attendance-response');
 if(status==='partial'&&(presentSubjects<1||absentSubjects<1))throw Error('attendance-response');
 if(subs.filter(s=>s.status==='present').length!==presentSubjects)throw Error('attendance-response');
 return{status,totalSubjects,presentSubjects,absentSubjects,subjects:subs,completedAt};
}
const listRecords=async(from,to,target)=>{
 if(!isRealDate(from)||(to!=null&&!isRealDate(to))||(target!=null&&!/^[A-Za-z0-9_-]{1,128}$/.test(target)))throw Error('attendance-input');
 const rows=await request('records',{query:{from,to,target}});
 if(!Array.isArray(rows)||rows.length>400)throw Error('attendance-response');
 const out={};
 for(const r of rows){
  if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).length!==7||!isRealDate(r.day))throw Error('attendance-response');
  if(Object.prototype.hasOwnProperty.call(out,r.day))throw Error('attendance-response');
  const{day,...rec}=r;
  out[day]=shapeRecord(rec);
 }
 return out;
};
const saveRecord=async(day,record)=>{
 if(!isRealDate(day))throw Error('attendance-input');
 const ack=await request('record-save',{method:'POST',body:{day,record:shapeRecord(record)}});
 if(!ack||ack.day!==day||ack.saved!==true)throw Error('attendance-response');
 return true;
};
const recordStats=async(target)=>{
 if(target!=null&&!/^[A-Za-z0-9_-]{1,128}$/.test(target))throw Error('attendance-input');
 const s=await request('record-stats',{query:{target}});
 if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).length!==3||!Number.isInteger(s.present)||!Number.isInteger(s.absent)||!Number.isInteger(s.total)||s.present<0||s.absent<0||s.total<0||s.present+s.absent!==s.total)throw Error('attendance-response');
 return{present:s.present,absent:s.absent,total:s.total};
};
window.AttendanceSQL={enabled,getConfig,setSettings,saveSchedules,deleteDays,listRecords,saveRecord,recordStats};
})();
