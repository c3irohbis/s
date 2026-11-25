const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
function walk(p){return fs.readdirSync(p,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(path.join(p,d.name)):[path.join(p,d.name)]);}
test('active immutable release contains no legacy Cloudinary binding or unsigned direct upload',()=>{
 const channel=JSON.parse(fs.readFileSync(path.join(root,'release-channel.json')));
 const active=path.join(root,'release',channel.generation);
 for(const p of walk(active).filter(p=>/\.(?:js|html)$/.test(p))){
  const s=fs.readFileSync(p,'utf8');
  assert.doesNotMatch(s,/dnbvvfita|university_upload|api\.cloudinary\.com|upload_preset/,path.relative(root,p));
 }
 const paths=['js/upload-engine.js','js/app/b-fcm-notif.js','js/military.js','js/instructions.js'];
 for(const name of paths){const s=fs.readFileSync(path.join(active,name),'utf8');assert.match(s,/BisMediaUpload|uploadMedia/,name);}
 const worker=fs.readFileSync(path.join(root,'worker/bliss-gateway.js'),'utf8');
 assert.ok(/const MEDIA_CLOUD\s*=\s*'h198yuha'/.test(worker),'Worker uses only the new cloud');
});
