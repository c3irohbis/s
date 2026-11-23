// Returns the source of the main app: js/app-main.js (entry) followed by every js/app/*.js module in entry import order.
const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..');
const entry=fs.readFileSync(path.join(root,'js/app-main.js'),'utf8');
const mods=[...entry.matchAll(/import\s+"\.\/(app\/[^"]+)"/g)].map(m=>m[1]);
const parts={ 'js/app-main.js':entry };
for(const m of mods)parts['js/'+m]=fs.readFileSync(path.join(root,'js',m),'utf8');
module.exports={source:Object.values(parts).join('\n'),parts,mods,root};
