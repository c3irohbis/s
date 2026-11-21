const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = p => fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const flush = () => new Promise(r => setImmediate(r));

test('lost-found modules register stable stop functions',()=>{for(const name of ['feed','found','admin','comments']){const callbacks=[];const ctx={console,window:{__LF:{core:{registerUnsubscribe:f=>callbacks.push(f)}}}};vm.createContext(ctx);vm.runInContext(source(`lost-found/js/lost-found-${name}.js`),ctx);assert.equal(callbacks.length,1);assert.equal(typeof ctx.window.__LF[name].stop,'function');}});
