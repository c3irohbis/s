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
window.AttendanceSQL={enabled,getConfig,setSettings,saveSchedules,deleteDays};
})();
