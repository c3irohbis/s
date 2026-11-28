#!/usr/bin/env python3
"""Build an immutable Google popup-fallback release from last shipped immutable source."""
from pathlib import Path
import hashlib,json,shutil,subprocess,re
root=Path(__file__).resolve().parent.parent
sha=lambda b:hashlib.sha256(b).hexdigest()
parent='7899938ea6f0d1c05aa70687a08b49dcbb2a438867850f354c0aef2f61cec043'
patches=['js/auth-bridge.js']
identity={'kind':'google-popup-no-redirect-fallback','parent':parent,'patches':{p:sha((root/p).read_bytes())for p in patches}}
generation=sha(json.dumps(identity,sort_keys=True).encode())
dest=root/'release'/generation
expected={p.relative_to(root/'release'/parent):p.read_bytes()for p in (root/'release'/parent).rglob('*')if p.is_file()}
expected.update({Path(p):(root/p).read_bytes()for p in patches})
if dest.exists():
 actual={p.relative_to(dest):p.read_bytes()for p in dest.rglob('*')if p.is_file()}
 if actual!=expected:raise RuntimeError('Existing immutable generation failed integrity check')
else:
 dest.mkdir(parents=True)
 for p,data in expected.items():
  q=dest/p;q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(data)
manifest=json.loads((root/'manifests'/f'{parent}.json').read_text())
manifest.update(generation=generation,derivedInput=identity)
for r in manifest['resources']:
 r['backing']=r['backing'].replace('/'+parent+'/', '/'+generation+'/')
 p=root/r['backing'];r.update(size=p.stat().st_size,sha256=sha(p.read_bytes()))
raw=(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode();(root/'manifests'/f'{generation}.json').write_bytes(raw)
channel=json.loads((root/'release-channel.json').read_text());channel.update(epoch=39,generation=generation,manifest=f'manifests/{generation}.json',manifestSHA256=sha(raw),rollback=False);(root/'release-channel.json').write_text(json.dumps(channel,indent=2)+'\n')
for name in ['forum-feed.js','notification-permission.js']:
 p=root/name;s=p.read_text();s=re.sub(r'/s/release/[a-f0-9]{64}/', '/s/release/'+generation+'/',s);p.write_text(s)
subprocess.run(['python3',str(root/'scripts/build-direct.py')],check=True,cwd=root)
assert not any('dnbvvfita' in p.read_text(errors='ignore')for p in dest.rglob('*.js'))
print(json.dumps({'generation':generation,'patches':patches,'resources':len(manifest['resources'])}))
