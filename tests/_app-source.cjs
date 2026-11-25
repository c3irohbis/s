// Returns the source of the main app: js/app-main.js (entry) followed by every js/app/*.js module in entry import order.
const fs=require('node:fs');const path=require('node:path');
const repo=path.join(__dirname,'..');
const served=fs.readFileSync(path.join(repo,'index.html'),'utf8');
const raw=/<base\b[^>]*href=["']([^"']+)["']/i.exec(served);
if(!raw)throw Error('served entry must declare its immutable base');
const base=new URL(raw[1],'https://test/s/');
if(base.origin!=='https://test'||!/^\/s\/release\/[a-f0-9]{64}\/$/.test(base.pathname))throw Error('invalid served base');
const root=path.join(repo,base.pathname.slice(3));
const entry=fs.readFileSync(path.join(root,'js/app-main.js'),'utf8');
const mods=[...entry.matchAll(/import\s+"\.\/(app\/[^"]+)"/g)].map(m=>m[1].split('?')[0]);
const parts={ 'js/app-main.js':entry };
for(const m of mods)parts['js/'+m]=fs.readFileSync(path.join(root,'js',m),'utf8');
module.exports={source:Object.values(parts).join('\n'),parts,mods,root};
