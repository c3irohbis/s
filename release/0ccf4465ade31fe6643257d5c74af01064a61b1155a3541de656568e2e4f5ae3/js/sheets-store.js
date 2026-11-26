/* Reuses News transport contract. No Firebase fallback in SQL mode. */
(function(){'use strict';const sql=()=>window.__BLISS_SHEETS_MODE!=='firebase';
const norm=s=>({...s,worldId:s.world_id,createdAt:s.created_at,createdBy:s.created_by,sheetsCount:s.sheets_count,activeSheetsCount:s.active_count,archivedAt:s.archived_at,subjectId:s.subject_id,order:s.ordinal,dueDate:s.due_date});
async function listOnce(subject){const world=window.activeWorldContext?.(),uid=window.currentUser?.uid;let cursor=null,rows=[],ticket=null,sub=null;
 for(let page=0;page<100;page++){const j=await SheetsAPI.request('list',{world,subject,cursor});if(uid!==window.currentUser?.uid||world!==window.activeWorldContext?.())throw Error('sheets-account-changed');rows.push(...j.items.map(norm));ticket=j.viewToken;sub=j.subject?norm(j.subject):sub;cursor=j.nextCursor;if(!cursor)return{rows,ticket,subject:sub};}
 throw Error('sheets-page-limit');
}
async function list(subject){try{return await listOnce(subject)}catch(e){if(e.status!==409)throw e;return listOnce(subject)}}
async function mutate(kind,action,id,data,revision,requestId){const world=window.activeWorldContext?.();const r=await SheetsAPI.request('mutate',{method:'POST',body:{world,kind,action,id,data,expectedRevision:revision??null,requestId}});void window.SheetsBadge?.refresh();return r;}
window.SheetsStore={sql,list,mutate,complete:(id,completed)=>SheetsAPI.request('completion',{method:'POST',body:{world:window.activeWorldContext?.(),id,completed}}),read:ticket=>SheetsAPI.request('read',{method:'POST',body:{world:window.activeWorldContext?.(),viewToken:ticket}})};
})();
