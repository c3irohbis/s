const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const app=require('./_app-source.cjs');const main=app.source;
const sw=fs.readFileSync(path.join(root,'firebase-messaging-sw.js'),'utf8');
const strip=u=>u.split('?')[0].split('#')[0];

test('every local script/link target in index.html exists',()=>{
 const urls=[...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"]+)"/g)].map(m=>m[1]).filter(u=>!/^(https?:|data:|#)/.test(u));
 assert.ok(urls.length>80);
 for(const u of urls){const base=/<base\s+href="([^"]+)"/.exec(html)?.[1]||'/s/';const resolved=new URL(u,'https://test'+base);assert.ok(resolved.pathname.startsWith('/s/'));assert.ok(fs.existsSync(path.join(root,decodeURIComponent(resolved.pathname.slice(3)))),'missing '+u);}
});
test('no inline module script remains; inline scripts are only the allowed ones',()=>{
 const inl=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(m=>!/\bsrc=/.test(m[1]));
 assert.ok(!inl.some(m=>/\btype=["']module["']/.test(m[1])),'no inline modules');
 const kinds=inl.map(m=>/importmap/.test(m[1])?'importmap':/function ownerToggleSection/.test(m[2])?'ownerToggle':/serviceWorker/.test(m[2])?'swRegister':'OTHER');
 assert.deepEqual(kinds.sort(),['importmap','ownerToggle']);
});
test('main module keeps its place in the load order',()=>{
 const scripts=[...html.replace(/<!--[\s\S]*?-->/g,'').matchAll(/<script\b([^>]*)>/g)].map(m=>({attrs:m[1],src:/\bsrc=["']([^"']+)/.exec(m[1])?.[1]||''}));
 const pos=s=>{const i=scripts.findIndex(x=>x.src.split('?')[0]===s);assert.ok(i>=0,s);return i};
 assert.ok(pos('js/chat-select.js')<pos('js/pin-message.js'));
 assert.ok(pos('js/pin-message.js')<pos('js/chat-backgrounds.js'));
 assert.ok(pos('js/chat-backgrounds.js')<pos('js/world-model.js'));
 assert.ok(pos('js/world-model.js')<pos('js/app-main.js'));
 assert.ok(pos('js/app-main.js')<pos('js/auth-bridge.js'));
 assert.ok(pos('js/newchat-ui.js')<pos('js/chat-newdesign-wiring.js'));
 assert.ok(pos('js/newchat-ui.js')>pos('js/mascot-override.js'));
 const main=scripts[pos('js/app-main.js')];assert.ok(/\btype="module"/.test(main.attrs));assert.ok(!/\b(?:defer|async)\b/.test(main.attrs));
});
test('importmap is still the first script that can load modules',()=>{
 assert.ok(html.indexOf('type="importmap"')<html.indexOf('type="module"'));
 assert.ok(html.indexOf('type="importmap"')<html.indexOf('rel="modulepreload"'));
});
test('app-main and app modules: relative imports resolve',()=>{
 for(const [f,src] of Object.entries(app.parts))for(const m of src.matchAll(/from\s+"(\.[^"]+)"/g))assert.ok(fs.existsSync(path.join(root,path.dirname(f),strip(m[1]))),f+' -> '+m[1]);
 assert.ok(app.mods.length>=20);
});
test('every name a module imports from a sibling is exported by it',()=>{
 for(const [f,src] of Object.entries(app.parts))for(const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s+"\.\/([^"]+)"/g)){
  const target=app.parts['js/app/'+m[2]];assert.ok(target,f+' -> '+m[2]);
  const ex=new Set();for(const e of target.matchAll(/export\s*\{([^}]*)\}/g))e[1].split(',').forEach(x=>ex.add(x.trim()));
  for(const e of target.matchAll(/export\s+(?:async\s+)?function\s+([\w$]+)/g))ex.add(e[1]);
  for(const n of m[1].split(',').map(x=>x.trim()).filter(Boolean))assert.ok(ex.has(n),f+' imports '+n+' not exported by '+m[2]);
 }
});
test('every use of confirm( in app modules imports the local confirm (it shadows window.confirm)',()=>{
 for(const [f,src] of Object.entries(app.parts)){
  if(f==='js/app-main.js')continue;
  const code=src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/.*$/gm,'$1');
  const uses=/(?<![\w$.])confirm\s*\(/.test(code);
  const defines=/function\s+confirm\s*\(/.test(code);
  const imports=/import\s*\{[^}]*\bconfirm\b[^}]*\}\s*from\s+"\.\/e-toast-confirm\.js"/.test(src);
  if(uses&&!defines)assert.ok(imports,f+' uses confirm( without importing it');
 }
});
test('the 12 non-exported names are each defined once in a module',()=>{
 for(const n of ['AUDIT_ACTIONS','_buildUploadCard','_draftClear','_draftRestore','_draftSave','_femaleSVG','_maleSVG','_formatSize','_getFileCategory','_getUser','writeAuditLog','uploadToCloudinaryWithProgress','storage']){
  const defs=Object.entries(app.parts).filter(([f,s])=>new RegExp('(?:^|\\n)\\s*(?:export\\s+)?(?:async\\s+)?(?:function\\s+'+n+'\\b|(?:const|let|var)\\s+'+n+'\\b)').test(s));
  assert.equal(defs.length,1,n+' defined in '+defs.map(d=>d[0]).join(','));
 }
});
test('no module assigns to an imported binding (state writes go through __set_/__inc_ helpers)',()=>{
 for(const [f,src] of Object.entries(app.parts)){
  const imported=new Set();for(const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s+"\.\/[^"]+"/g))m[1].split(',').forEach(x=>imported.add(x.trim()));
  for(const n of imported){if(!n||n.startsWith('__'))continue;assert.ok(!new RegExp('(?<![\\w$.])'+n.replace(/\$/g,'\\$')+'\\s*(?:=(?!=)|\\+=|-=|\\+\\+|--)').test(src.replace(/import[^;]*;/g,'')),f+' assigns imported '+n);}
 }
});
test('every inline handler function is defined somewhere',()=>{
 const names=new Set();
 for(const m of html.matchAll(/\son[a-z]+="([^"]*)"/g))for(const f of m[1].matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g))names.add(f[1]);
 const skip=new Set(['if','function','return','catch','for','while','switch']);
 const files=[];const walk=d=>{for(const f of fs.readdirSync(d,{withFileTypes:true})){if(f.name==='node_modules'||f.name==='.git'||f.name==='tests')continue;const p=path.join(d,f.name);f.isDirectory()?walk(p):/\.js$/.test(f.name)&&files.push(p)}};walk(root);
 const corpus=files.map(f=>fs.readFileSync(f,'utf8')).join('\n')+html;
 const missing=[];
 for(const n of names){if(skip.has(n))continue;
  const re=new RegExp('(function\\s+'+n.replace(/\$/g,'\\$')+'\\b|window\\.'+n.replace(/\$/g,'\\$')+'\\s*=|window\\[[\'"]'+n+'[\'"]\\]\\s*=|\\b'+n.replace(/\$/g,'\\$')+'\\s*[:=]\\s*(async\\s*)?(function|\\())');
  if(!re.test(corpus))missing.push(n)}
 // loadOwnerUsers/loadOwnerStats are now exported to window (users manager refresh fix)
 const known=new Set(['confirm','stopPropagation']);
 assert.deepEqual(missing.filter(n=>!known.has(n)),[]);
});
test('service worker embeds verified resource hashes including app-main',()=>{
 const match=/const DIRECT_RELEASE = (.*);\n/.exec(sw);assert.ok(match);const m=JSON.parse(match[1]);const crypto=require('node:crypto');
 assert.equal(m.entry.sha256,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex'));
 assert.ok(m.resources.some(r=>r.url.split('?')[0].endsWith('/js/app-main.js')));
 const required=[...html.replace(/<!--[\s\S]*?-->/g,'').matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"]+)"/g)].map(x=>new URL(x[1],new URL(/<base\s+href="([^"]+)/.exec(html)[1],'https://test'))).filter(u=>u.origin==='https://test'&&/\.(?:js|css)$/.test(u.pathname));
 for(const u of required)assert.ok(m.resources.some(r=>r.url===u.pathname.slice(3)+u.search),'manifest required '+u.href);
 for(const r of m.resources){const bytes=fs.readFileSync(path.join(root,r.url.split('?')[0]));assert.equal(bytes.length,r.size);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),r.sha256);}
 assert.ok(!sw.includes('self.skipWaiting('));assert.ok(!sw.includes('clients.claim('));
});
test('window bridges of the main module are preserved',()=>{
 for(const n of ['showPage','goTab','openChatPage','openUsersManager','closeUsersManager','selectRoomIcon','openForumSection','closeForumSection','toggleProfSection','setActiveWorld','openPortal','openDmsPanel','copyMyPublicId','closeArchivePage','closeAiChatPage'])assert.ok(new RegExp('window\\.'+n+'\\s*=').test(main),n);
 const bridges=[...main.matchAll(/Object\.defineProperty\(window,\s*['"]([^'"]+)/g)].map(m=>m[1]).sort();
 assert.deepEqual(bridges,['_lastSendTime','currentName','currentPhoto','msgUnsub','_isChatBanned','_acceptedPeers','_userCache','_currentChatId','_currentChatName','_currentChatPhoto','_isSending','_replyData','_ctxData','_ctxDocId','__insCaptureAuth'].sort());
});
