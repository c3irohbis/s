from pathlib import Path
import hashlib,json,zipfile,shutil,subprocess,sys,os,stat
from pathlib import PurePosixPath
BASE='31dd3ee4a7c429a3a543121bcbfb90789a54e844'
GEN='e177c6008e3358beef5563e43f0fb432a8bbda80bc22d982a8ecba0cbf7fb47c'
R0='108f5031228282d3525db135373dbce5d27eb6551facc0cf259b8454594cacb2'
PREFIX='68782cf1903788d4e9def68834eeca901e646f1287f79f4e49727f54488c2324'
def digest(data):return hashlib.sha256(data).hexdigest()
def run(*args):return subprocess.check_output(args,text=True).strip()
def verify(zpath,tree):
 z=zipfile.ZipFile(zpath);names=z.namelist();assert len(names)==len(set(names))
 assert all(not n.startswith('/') and '\\' not in n and '\x00' not in n and str(PurePosixPath(n))==n and '..' not in Path(n).parts and not stat.S_ISLNK(i.external_attr>>16) for n,i in zip(names,z.infolist()))
 info=json.loads(z.read('deployment-record.json'));assert set(info)=={'files','generation','r0','base'}
 assert info['generation']==GEN and info['r0']==R0 and info['base']==BASE
 assert set(names)==set(info['files'])|{'deployment-record.json'}
 assert len(names)<700 and sum(i.file_size for i in z.infolist())<40000000
 allowed={'index.html','bootstrap-bridge.js','gateway-shell.css','manifest.json','firebase-messaging-sw.js','images/app-icon.png','images/app-icon-maskable.png','release-channel.json','version-manifest.json','version-manifest.sha256','.github/gateway-staging/rollback-channel.json'}
 for name,h in info['files'].items():
  assert name in allowed or name.startswith('release/'+GEN+'/') or name.startswith('release/'+R0+'/') or name in {'manifests/'+GEN+'.json','manifests/'+R0+'.json'}
  assert digest(z.read(name))==h
 expected_files=set(allowed)|{'manifests/'+GEN+'.json','manifests/'+R0+'.json'}
 for gen in [GEN,R0]:
  raw=z.read('manifests/'+gen+'.json');m=json.loads(raw);assert m['generation']==gen and len(m['resources'])==267
  for r in m['resources']:
   assert r['backing'].startswith('release/'+gen+'/')
   expected_files.add(r['backing'])
   body=z.read(r['backing']);assert digest(body)==r['sha256'] and len(body)==r['size']
  assert not any('tests/' in r['requestKey'] for r in m['resources'])
 assert set(info['files'])==expected_files
 for name in ['firebase-messaging-sw.js','index.html','manifest.json']:
  live=subprocess.check_output(['git','-C',str(tree),'show',BASE+':'+name]);assert (tree/name).read_bytes()==live
 assert digest(z.read('firebase-messaging-sw.js')[:2772])==PREFIX
 assert z.read('firebase-messaging-sw.js')[:2772]==(tree/'firebase-messaging-sw.js').read_bytes()[:2772]
 assert json.loads(z.read('manifest.json'))['id']==json.loads((tree/'manifest.json').read_text())['id']
 pointer=json.loads(z.read('release-channel.json'));assert pointer['epoch']==4 and pointer['generation']==GEN and not pointer['rollback']
 assert pointer['manifestSHA256']==digest(z.read(pointer['manifest']))
 rb=json.loads(z.read('.github/gateway-staging/rollback-channel.json'));assert rb['epoch']==5 and rb['generation']==R0 and rb['rollback']
 assert rb['manifestSHA256']==digest(z.read(rb['manifest']))
 return z,info
if __name__=='__main__':
 expected=os.environ['EXPECTED_MAIN'];assert len(expected)==40 and all(c in '0123456789abcdef' for c in expected)
 payload=Path(sys.argv[1]).resolve();assert digest(payload.read_bytes())==os.environ['PAYLOAD_SHA256']
 tree=Path('target').resolve();assert run('git','ls-remote','origin','refs/heads/main').split()[0]==expected
 subprocess.run(['git','worktree','add','--detach',str(tree),expected],check=True)
 subprocess.run(['git','merge-base','--is-ancestor',BASE,expected],check=True)
 assert run('git','diff','--name-only',BASE,expected).splitlines()==['.github/workflows/prepare-gateway.yml']
 assert subprocess.check_output(['git','show',expected+':.github/workflows/prepare-gateway.yml'])==Path('.github/workflows/prepare-gateway.yml').read_bytes()
 assert not run('git','-C',str(tree),'status','--porcelain')
 z,info=verify(payload,tree)
 for name in info['files']:
  assert not tree.is_symlink()
  p=tree/name
  for parent in reversed(p.parents):
   if parent==tree or tree in parent.parents:
    assert not parent.is_symlink() and (not parent.exists() or parent.is_dir())
  assert not p.is_symlink() and (not p.exists() or p.is_file())
  p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(z.read(name))
 for name,h in info['files'].items():assert digest((tree/name).read_bytes())==h
 subprocess.run(['git','-C',str(tree),'add','--',*info['files']],check=True)
 changed=run('git','-C',str(tree),'diff','--cached','--name-only').splitlines();assert set(changed)<=set(info['files'])
 assert not run('git','-C',str(tree),'ls-files','--others','--exclude-standard')
 assert not run('git','-C',str(tree),'diff','--name-only')
 assert all(not l.startswith('D\t') for l in run('git','-C',str(tree),'diff','--cached','--name-status').splitlines())
 assert run('git','ls-remote','origin','refs/heads/main').split()[0]==expected
 branch='gateway-g4-reviewed-release'
 assert not run('git','ls-remote','origin','refs/heads/'+branch)
 subprocess.run(['git','-C',str(tree),'config','user.name','c3irohbis'],check=True)
 subprocess.run(['git','-C',str(tree),'config','user.email','c3irohbis@users.noreply.github.com'],check=True)
 subprocess.run(['git','-C',str(tree),'commit','-m','Stage verified gateway and G4 release with retained R0'],check=True)
 subprocess.run(['git','-C',str(tree),'push','origin','HEAD:refs/heads/'+branch],check=True)
 print(json.dumps({'branch':branch,'commit':run('git','-C',str(tree),'rev-parse','HEAD'),'files':len(changed),'generation':GEN,'mainUnchanged':run('git','ls-remote','origin','refs/heads/main').split()[0]==expected}))
