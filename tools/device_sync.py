#!/usr/bin/env python3
"""Compare or explicitly apply the managed manifest over authenticated SSH.

No credentials, preferences, client state or proprietary prerequisites are copied.
Runtime stop/start and the local preference migration are separate operations.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import shlex
import subprocess

ROOT = Path(__file__).resolve().parents[1]
REMOTE = r'''
import os,sys,json,hashlib,base64,stat
p=json.load(sys.stdin)
def digest(path):
 try:
  if not stat.S_ISREG(os.lstat(path).st_mode): return None
  return hashlib.sha256(open(path,'rb').read()).hexdigest()
 except OSError: return None
def inspect_parent(path):
 s=os.lstat(path)
 if not stat.S_ISDIR(s.st_mode): return False
 if path.startswith('/var/lib/webosbrew') or path in ['/var','/var/lib']:
  return s.st_uid==0 and not (stat.S_IMODE(s.st_mode)&022)
 return True
def parents(path):
 if path != '/': parents(os.path.dirname(path))
 if os.path.lexists(path):
  if not inspect_parent(path): raise ValueError('Unsafe parent')
  return
 os.mkdir(path,0700 if path.startswith('/var/lib/webosbrew') else 0755)
def matches(x):
 t=x['target']
 if x.get('type')=='symlink':
  return os.path.islink(t) and os.readlink(t)==x['linkTarget'] and os.lstat(t).st_uid==0
 try:
  s=os.lstat(t)
  return digest(t)==x['sha256'] and stat.S_IMODE(s.st_mode)==int(x['mode'],8) and (not t.startswith('/var/lib/webosbrew/') or s.st_uid==0)
 except OSError: return False
changes=[]
unsafe=set()
for entry in p['entries']:
 directory=os.path.dirname(entry['target'])
 while directory != '/':
  if os.path.lexists(directory) and not inspect_parent(directory): unsafe.add(directory)
  directory=os.path.dirname(directory)
if unsafe and p['apply']: raise ValueError('Unsafe deployment ancestors')
for x in p['entries']:
 t=x['target']
 if not t.startswith(('/var/lib/webosbrew/','/media/developer/')) or '..' in t.split('/'):
  raise ValueError('Unsafe target')
 if matches(x): continue
 changes.append(t)
 if not p['apply']: continue
 parents(os.path.dirname(t))
 temp=t+'.home-kit-new'
 if os.path.lexists(temp): raise ValueError('Existing staging file')
 if x.get('type')=='symlink': os.symlink(x['linkTarget'],temp)
 else:
  data=base64.b64decode(p['files'][x['file']])
  if hashlib.sha256(data).hexdigest()!=x['sha256']: raise ValueError('Hash mismatch')
  fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0600)
  try:
   f=os.fdopen(fd,'wb'); f.write(data); f.flush(); os.fsync(f.fileno()); f.close()
   os.chmod(temp,int(x['mode'],8)); os.chown(temp,0,0)
  except:
   os.unlink(temp); raise
 os.rename(temp,t)
if p['apply']:
 marker='/var/lib/webosbrew/home-kit/deployment.json'; parents(os.path.dirname(marker))
 fd=os.open(marker+'.new',os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0600)
 f=os.fdopen(fd,'w'); json.dump({'version':1,'manifest':p['manifest']},f);f.close()
 os.rename(marker+'.new',marker)
print(json.dumps({'returnValue':True,'applied':p['apply'],'changes':changes,'unsafeParents':sorted(unsafe),'entries':len(p['entries']),'manifest':p['manifest']}))
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', required=True)
    parser.add_argument('--identity', required=True, type=Path)
    parser.add_argument('--known-hosts', required=True, type=Path)
    parser.add_argument('--proxy-command')
    parser.add_argument('--apply', action='store_true', help='Write changed managed files; compare only by default')
    args = parser.parse_args()
    if args.host.startswith('-') or any(c.isspace() for c in args.host):
        parser.error('Invalid host')
    data = (ROOT / 'inventory/deploy-map.json').read_bytes()
    entries = json.loads(data)
    files = {}
    if args.apply:
        for entry in entries:
            if entry.get('type') == 'symlink':
                continue
            path = ROOT / entry['file']
            contents = path.read_bytes()
            if hashlib.sha256(contents).hexdigest() != entry['sha256']:
                raise SystemExit('Refresh the manifest before deployment')
            files[entry['file']] = base64.b64encode(contents).decode()
    payload = {'entries': entries, 'files': files, 'apply': args.apply,
               'manifest': hashlib.sha256(data).hexdigest()}
    command = ['ssh', '-T', '-i', str(args.identity), '-o', 'BatchMode=yes',
               '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
               '-o', 'UserKnownHostsFile=' + str(args.known_hosts),
               '-o', 'HostKeyAlgorithms=+ssh-rsa', '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa']
    if args.proxy_command:
        command += ['-o', 'ProxyCommand=' + args.proxy_command]
    command += ['root@' + args.host, '/usr/bin/python -c ' + shlex.quote(REMOTE)]
    result = subprocess.run(command, input=json.dumps(payload).encode(), capture_output=True, timeout=90)
    if result.returncode:
        raise SystemExit('Device synchronization failed; inspect local SSH/device diagnostics')
    print(result.stdout.decode().strip())


if __name__ == '__main__':
    main()
