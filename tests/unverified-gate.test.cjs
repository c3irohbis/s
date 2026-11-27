const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const st=fs.readFileSync(path.join(__dirname,'../js/app/i-authstate.js'),'utf8');
const br=fs.readFileSync(path.join(__dirname,'../js/auth-bridge.js'),'utf8');
test('authstate gates unverified password users before showing the home page',()=>{
  const gate=st.indexOf('!user.emailVerified');
  const home=st.indexOf('showPage("page-home")');
  const hold=st.indexOf('window._authHold?.(user)');
  assert.ok(hold>-1&&gate>hold,'gate comes after the sign-up hold');
  assert.ok(gate>-1&&gate<home,'gate before page-home');
  const block=st.slice(gate-300,home);
  assert.match(block,/providerId === "password"/);
  assert.match(block,/_myGen !== _verifyGen \|\| auth\.currentUser\?\.uid !== user\.uid/);
  assert.match(st,/const _myGen = \+\+_verifyGen/);
  assert.doesNotMatch(block,/google\.com/);
  assert.match(block,/signOut\(auth\)/);
  assert.match(block,/return;/);
});
test('authstate refreshes stale local state before judging',()=>{
  assert.match(st,/await user\.reload\(\); await user\.getIdToken\(true\)/);
});
test('loginEmail refuses unverified password user and signs out',()=>{
  const i=br.indexOf('B.loginEmail');
  const blk=br.slice(i,i+900);
  assert.match(blk,/emailVerified/);
  assert.match(blk,/try \{ await signOut\(auth\(\)\); \} catch/);
  assert.match(blk,/busy = false/);
  assert.match(blk,/cleanup = false/);
  assert.ok(blk.indexOf('emailVerified')<blk.indexOf('afterSignIn(cred.user'));
});
