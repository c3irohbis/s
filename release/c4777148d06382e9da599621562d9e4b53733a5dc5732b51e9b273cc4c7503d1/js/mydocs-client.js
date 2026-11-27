/* My Documents SQL transport: authenticated request/response, no Firestore dependency. */
(function(){'use strict';if(window.MyDocsSQL)return;
const ROOT='https://bliss-gateway.cairohbis.workers.dev/v1/mydocs/';
const enabled=()=>window.__BLISS_MYDOCS_MODE==='supabase';
const WORLD=/^(is|lt|th|ba)_[1-4]$/;
async function request(op,{method='GET',body,query}={}){
 const user=window.currentUser;if(!user)throw Error('mydocs-signed-out');const uid=user.uid,world=window.activeWorldContext?.(),token=await user.getIdToken(),url=new URL(ROOT+op);
 if(!WORLD.test(world||''))throw Error('mydocs-context');
 if(window.currentUser?.uid!==uid||window.activeWorldContext?.()!==world)throw Error('mydocs-account-changed');
 if(method==='GET'){url.searchParams.set('world',world);for(const[k,v]of Object.entries(query||{}))if(v!=null)url.searchParams.set(k,String(v))}
 const r=await fetch(url,{method,cache:'no-store',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify({...body,world})}:{})});const j=await r.json().catch(()=>({}));
 if(window.currentUser?.uid!==uid||window.activeWorldContext?.()!==world)throw Error('mydocs-account-changed');
 if(!r.ok)throw Object.assign(Error('mydocs-http'),{status:r.status,code:j.error});
 if(j.source!=='supabase'||j.complete!==true||!j.data)throw Error('mydocs-invalid-payload');return j.data;
}
const ts=v=>v?{toMillis:()=>Date.parse(v)}:null;
function subject(x){return{id:x.id,worldId:x.world_id,name:x.name,code:x.code,status:x.status,itemsCount:Number(x.items_count),activeItemsCount:Number(x.active_items_count),createdAt:ts(x.created_at),archivedAt:ts(x.archived_at),createdBy:x.created_by,__revision:x.revision}}
function item(x){return{id:x.id,subjectId:x.subject_id,worldId:x.world_id,order:Number(x.ordinal),type:x.type,url:x.url,text:x.text,fileName:x.file_name,duration:x.duration==null?null:Number(x.duration),createdAt:ts(x.created_at),createdBy:x.created_by,__revision:x.revision}}
async function listSubjects(){const d=await request('list');if(!Array.isArray(d.subjects)||d.subjects.length>500)throw Error('mydocs-response');return d.subjects.map(subject)}
async function listItems(subjectId,filter,after){const d=await request('list',{query:{subject:subjectId,filter,after}});if(!Array.isArray(d.items)||d.items.length>30)throw Error('mydocs-response');return{items:d.items.map(item),subject:d.subject?subject(d.subject):null,pageSize:d.pageSize}}
const rid=()=>crypto.randomUUID();const nid=()=>crypto.randomUUID().replace(/-/g,'');
const mutate=(kind,action,id,data,revision)=>request('mutate',{method:'POST',body:{kind,action,id,data:data??{},expectedRevision:revision??null,requestId:rid()}});
const createSubject=data=>{const id=nid();return mutate('subject','create',id,data).then(r=>({...r,id}))};
const updateSubject=(id,data,revision)=>mutate('subject','update',id,data,revision);
const archiveSubject=(id,revision)=>mutate('subject','archive',id,{},revision);
const reopenSubject=(id,revision)=>mutate('subject','reopen',id,{},revision);
const createItem=data=>mutate('item','create',nid(),data);
const deleteItem=(id,revision)=>mutate('item','delete',id,{},revision);
window.MyDocsSQL={enabled,listSubjects,listItems,createSubject,updateSubject,archiveSubject,reopenSubject,createItem,deleteItem};
})();
