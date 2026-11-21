const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
test('direct wrapper imports and Firebase imports share one canonical module; inner SDK import stays raw',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');const map=JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
 const sdk='https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';const canonical=map.imports[sdk];
 assert.equal(map.imports['./js/firestore-safe.js'],canonical);
 assert.equal(map.scopes[canonical][sdk],sdk);
});
