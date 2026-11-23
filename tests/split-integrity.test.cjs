const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const main=fs.readFileSync(path.join(root,'js/app-main.js'),'utf8');
const sw=fs.readFileSync(path.join(root,'firebase-messaging-sw.js'),'utf8');
const strip=u=>u.split('?')[0].split('#')[0];

test('every local script/link target in index.html exists',()=>{
 const urls=[...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"]+)"/g)].map(m=>m[1]).filter(u=>!/^(https?:|data:|#)/.test(u));
 assert.ok(urls.length>80);
 for(const u of urls)assert.ok(fs.existsSync(path.join(root,strip(u))),'missing '+u);
});
test('no inline module script remains; inline scripts are only the allowed ones',()=>{
 const inl=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(m=>!/\bsrc=/.test(m[1]));
 const kinds=inl.map(m=>/importmap/.test(m[1])?'importmap':/function ownerToggleSection/.test(m[2])?'ownerToggle':/serviceWorker/.test(m[2])?'swRegister':'OTHER');
 assert.deepEqual(kinds.sort(),['importmap','ownerToggle','swRegister']);
});
test('main module keeps its place in the load order',()=>{
 const pos=s=>{const i=html.indexOf(s);assert.ok(i>0,s);return i};
 assert.ok(pos('js/chat-select.js')<pos('js/pin-message.js'));
 assert.ok(pos('js/pin-message.js')<pos('js/chat-backgrounds.js'));
 assert.ok(pos('js/chat-backgrounds.js')<pos('js/world-model.js'));
 assert.ok(pos('js/world-model.js')<pos('<script type="module" src="js/app-main.js'));
 assert.ok(pos('<script type="module" src="js/app-main.js')<pos('<script type="module" src="js/auth-bridge.js"'));
 assert.ok(pos('js/newchat-ui.js')<pos('js/chat-newdesign-wiring.js'));
 assert.ok(pos('js/newchat-ui.js')>pos('js/mascot-override.js'));
 assert.ok(!/<script type="module" src="js\/app-main\.js[^>]*(defer|async)/.test(html));
});
test('importmap is still the first script that can load modules',()=>{
 assert.ok(html.indexOf('type="importmap"')<html.indexOf('type="module"'));
 assert.ok(html.indexOf('type="importmap"')<html.indexOf('rel="modulepreload"'));
});
test('app-main relative imports resolve',()=>{
 for(const m of main.matchAll(/from\s+"(\.[^"]+)"/g))assert.ok(fs.existsSync(path.join(root,'js',strip(m[1]))),m[1]);
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
 // known pre-existing gap, tracked as a separate card (users manager refresh button)
 const known=new Set(['loadOwnerUsers','loadOwnerStats','confirm','stopPropagation']);
 assert.deepEqual(missing.filter(n=>!known.has(n)),[]);
});
test('service worker precaches app-main and cache version is moved forward',()=>{
 assert.ok(/'js\/app-main\.js'/.test(sw));
 const v=Number(/CACHE_VERSION = 'v(\d+)'/.exec(sw)[1]);
 assert.ok(v>=25);
 for(const m of sw.matchAll(/'((?:js|css|images)\/[^']+)'/g))assert.ok(fs.existsSync(path.join(root,m[1])),'precache missing '+m[1]);
});
test('window bridges of the main module are preserved',()=>{
 for(const n of ['showPage','goTab','openChatPage','openUsersManager','closeUsersManager','selectRoomIcon','openForumSection','closeForumSection','toggleProfSection','setActiveWorld','openPortal','openDmsPanel','copyMyPublicId','closeArchivePage','closeAiChatPage'])assert.ok(new RegExp('window\\.'+n+'\\s*=').test(main),n);
 assert.equal((main.match(/Object\.defineProperty\(window,/g)||[]).length,14);
});
