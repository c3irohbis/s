const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const files=['js/mention.js','js/dms-page.js','js/attendance.js'];
const grab=src=>{const i=src.indexOf('const _escHtml =');assert.ok(i>=0,'_escHtml missing');const j=src.indexOf('\n',i);const ctx={};vm.createContext(ctx);return vm.runInContext(src.slice(i,j)+'\n_escHtml;',ctx);};

test('_escHtml escapes all HTML-critical chars in every patched file',()=>{
  for(const f of files){
    const esc=grab(read(f));
    assert.equal(esc('<img src=x onerror=alert(1)>'),'&lt;img src=x onerror=alert(1)&gt;',f);
    assert.equal(esc('"><script>alert(1)</script>'),'&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;',f);
    assert.equal(esc("a'b&c"),'a&#39;b&amp;c',f);
    assert.equal(esc(null),'',f);assert.equal(esc(undefined),'',f);assert.equal(esc(42),'42',f);
  }
});

test('user-controlled fields in mention dropdown are escaped',()=>{
  const s=read('js/mention.js');
  assert.ok(s.includes('data-name="${_escHtml(u.name)}"'),'data-name');
  assert.ok(s.includes('src="${_escHtml(u.photo)}"'),'avatar src');
  assert.ok(s.includes('<div class="mention-name">${_escHtml(u.name)}</div>'),'name text');
  assert.ok(s.includes('#${_escHtml(u.publicId)}'),'publicId');
  assert.ok(s.includes('value="${_escHtml(_mentionQuery)}"'),'search box value');
});

test('peer name and last message in DM list are escaped',()=>{
  const s=read('js/dms-page.js');
  assert.ok(s.includes('${_escHtml(item.name||"مستخدم")}'),'conv name');
  assert.ok(s.includes('${_escHtml(item.lastMsg||"ابدأ المحادثة")}'),'last msg');
  assert.ok(s.includes('src="${_escHtml(photo)}"'),'avatar src');
  assert.ok(s.includes('>${_escHtml((name||"?").charAt(0).toUpperCase())}<'),'letter avatar');
});

test('subject and student names in attendance templates are escaped',()=>{
  const s=read('js/attendance.js');
  assert.ok(s.includes('data-name="${_escHtml(s.name)}"'),'data-name');
  assert.ok(s.includes('<span class="att-subj-name">${_escHtml(s.name)}</span>'),'subject text');
  assert.ok(s.includes('</i> ${_escHtml(s.name)}'),'day-detail name');
});

test('raw user-data interpolations do not come back',()=>{
  assert.ok(!read('js/mention.js').includes('<div class="mention-name">${u.name}</div>'));
  assert.ok(!read('js/dms-page.js').includes('<span class="dms-conv-name">${item.name'));
  assert.ok(!read('js/dms-page.js').includes('<span class="dms-conv-last">${item.lastMsg'));
});
