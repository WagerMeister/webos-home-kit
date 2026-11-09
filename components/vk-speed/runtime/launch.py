#!/usr/bin/python
"""Fixed-command launcher: never accepts a URL, path, or shell input."""
from __future__ import print_function
import json
import os
import signal
import subprocess
import time
import urllib2
import binascii

ROOT='/var/lib/webosbrew/vk-speed'
STATE='/tmp/vk-speed-state'
def diagnostic(stage, detail=None):
    try:
        fd=os.open(STATE+'/launch-diag.json',os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0600)
        os.write(fd,json.dumps({'stage':stage,'detail':detail}));os.close(fd)
    except Exception:pass
def luna(uri,payload):
    return json.loads(subprocess.check_output(['/usr/bin/luna-send','-w','2500','-n','1','luna://'+uri,json.dumps(payload)]))
def main():
    diagnostic('started')
    if luna('com.webos.applicationManager/getForegroundAppInfo',{}).get('appId')!='org.local.vkspeed':
        diagnostic('not-foreground');print('VK_SPEED_NOT_FOREGROUND');return
    directory=os.lstat(STATE)
    if not os.path.isdir(STATE) or os.path.islink(STATE) or directory.st_uid!=0 or directory.st_mode&0077:return
    nonce=binascii.hexlify(os.urandom(16));ready=STATE+'/ready-'+nonce
    null=open(os.devnull,'w')
    proc=subprocess.Popen(['/usr/bin/setsid','/usr/bin/node',ROOT+'/runtime/server.js',nonce],stdin=open(os.devnull),stdout=null,stderr=null,close_fds=True)
    ok=False;launched_ok=False;last_error=None
    try:
        deadline=time.time()+10
        while time.time()<deadline:
            if proc.poll() is not None:
                last_error='server-exit-%s'%proc.returncode;break
            if os.path.isfile(ready):
                try:
                    response=urllib2.urlopen('http://127.0.0.1:18447/'+nonce+'/ready',timeout=1)
                    if response.code==200:ok=True;break
                except Exception as e:last_error=type(e).__name__
            time.sleep(.2)
        if not ok:diagnostic('no-session',last_error);print('VK_SPEED_NO_SESSION');return
        if luna('com.webos.applicationManager/getForegroundAppInfo',{}).get('appId')!='org.local.vkspeed':return
        target='http://127.0.0.1:18447/'+nonce+'/index.html'
        launched=luna('com.webos.applicationManager/launch',{'id':'org.local.vkspeed.player','params':{'target':target}})
        if not launched.get('returnValue'):diagnostic('native-rejected',launched.get('errorCode'));return
        launched_ok=True
        diagnostic('launched')
        print('VK_SPEED_LAUNCHED')
    finally:
        try:os.unlink(ready)
        except OSError:pass
        if not launched_ok and proc.poll() is None:
            try:os.kill(proc.pid,signal.SIGTERM)
            except OSError:pass
if __name__=='__main__':main()
