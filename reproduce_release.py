from pathlib import Path,PurePosixPath
import os,sys,json,hashlib,subprocess,zipfile
BASE='31dd3ee4a7c429a3a543121bcbfb90789a54e844'
GEN='e177c6008e3358beef5563e43f0fb432a8bbda80bc22d982a8ecba0cbf7fb47c'
R0='108f5031228282d3525db135373dbce5d27eb6551facc0cf259b8454594cacb2'
G4={'css/instructions.css','js/app/g-auth-profile-logout.js','js/app/i-authstate.js','js/instructions.js'}
SCRIPTS={'README.md','app-bridge.js','bootstrap-bridge.js','bootstrap.py','build.py','gateway-shell.css','prepare_rollback.py','scan-js.cjs','shell_assets.py','shell_identity.py'}
INPUTS=G4|{'firebase-messaging-sw.js'}|{'scripts/release/'+n for n in SCRIPTS}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def pairs(rows):
 result={}
 for k,v in rows:
  assert k not in result,'duplicate JSON key';result[k]=v
 return result
def load(p):return json.loads(p.read_text(),object_pairs_hook=pairs)
def run(*a):subprocess.run(a,check=True)
def valid(n):return isinstance(n,str) and not n.startswith('/') and '\\' not in n and '\x00' not in n and '..' not in PurePosixPath(n).parts and str(PurePosixPath(n))==n
if __name__=='__main__':
 inputs=Path(sys.argv[1]).resolve();record=Path(sys.argv[2]).resolve();apply=Path(sys.argv[3]).resolve()
 for p,k in [(inputs,'SOURCE_SHA256'),(record,'RECORD_SHA256'),(apply,'APPLY_SHA256')]:assert p.is_file() and not p.is_symlink() and sha(p)==os.environ[k]
 assert record.stat().st_size==72527
 assert all(p.read_bytes().endswith(b'\n') and not p.read_bytes().endswith(b'\n\n') for p in [inputs,record])
 src=load(inputs);info=load(record)
 assert inputs.stat().st_size==155473 and set(src)==INPUTS and all(valid(n) and isinstance(v,str) for n,v in src.items())
 assert set(info)=={'files','generation','r0','base'} and info['base']==BASE and info['generation']==GEN and info['r0']==R0 and len(info['files'])==427
 assert all(valid(n) and isinstance(h,str) and len(h)==64 and all(c in '0123456789abcdef' for c in h) for n,h in info['files'].items())
 source=Path('repro-source').resolve();primary=Path('repro-primary').resolve();rollback=Path('repro-r0').resolve()
 assert not any(p.exists() for p in [source,primary,rollback])
 run('git','worktree','add','--detach',str(source),BASE)
 assert not any(p.is_symlink() for p in source.rglob('*') if '.git' not in p.parts)
 def overlay(names):
  for n in names:
   p=source/n
   assert not p.is_symlink();p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(src[n].encode('utf-8'))
 overlay(set(src)-G4)
 run(sys.executable,str(source/'scripts/release/prepare_rollback.py'),'--source',str(source),'--output',str(rollback),'--known-epochs','4')
 overlay(G4)
 run(sys.executable,str(source/'scripts/release/bootstrap.py'),'--source',str(source),'--output',str(primary),'--epoch','4')
 def artifact(n):
  if n.startswith('release/'+R0+'/') or n=='manifests/'+R0+'.json':return rollback/n
  if n=='.github/gateway-staging/rollback-channel.json':return rollback/'rollback-channel.json'
  return primary/n
 # Verify full approved content before creating the temporary internal transport.
 for n,h in info['files'].items():
  p=artifact(n);assert p.is_file() and not p.is_symlink() and sha(p)==h,n
 payload=Path('reproduced-internal.zip').resolve();assert not payload.exists()
 with zipfile.ZipFile(payload,'w',zipfile.ZIP_DEFLATED) as z:
  for n in sorted(info['files']):z.writestr(n,artifact(n).read_bytes())
  z.writestr('deployment-record.json',record.read_bytes())
 print(json.dumps({'reproducedFiles':len(info['files']),'allSHA256Matched':True,'totalBytes':sum(artifact(n).stat().st_size for n in info['files']),'generation':GEN,'r0':R0}),flush=True)
 if os.environ.get('PROOF_ONLY')!='1':
  env=dict(os.environ,PAYLOAD_SHA256=sha(payload));subprocess.run([sys.executable,str(apply),str(payload)],env=env,check=True)
