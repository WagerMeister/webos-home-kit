#!/usr/bin/python
"""Scope exit-node reverse-path compatibility to the physical WAN interface."""
from __future__ import print_function
import json
import os
import re
import stat
import subprocess
import sys

STATE='/var/lib/webosbrew/tv-vpn/state'
RECORD=STATE+'/routing-compat.json'
BOOT=open('/proc/sys/kernel/random/boot_id').read().strip()

def value(interface):
    return int(open('/proc/sys/net/ipv4/conf/'+interface+'/rp_filter').read().strip())

def write(interface, setting):
    f=open('/proc/sys/net/ipv4/conf/'+interface+'/rp_filter','w')
    try:f.write(str(setting)+'\n')
    finally:f.close()
    if value(interface)!=setting:raise RuntimeError('Reverse-path setting not applied')

def load():
    d=os.lstat(STATE)
    if not stat.S_ISDIR(d.st_mode) or d.st_uid!=0 or d.st_mode&0077:raise RuntimeError('Unsafe private state')
    try:
        fd=os.open(RECORD,os.O_RDONLY|os.O_NOFOLLOW)
    except OSError as e:
        if e.errno==2:return {'boot':BOOT,'interfaces':{}}
        raise
    f=os.fdopen(fd)
    try:
        info=os.fstat(f.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode&0077 or info.st_size>4096:raise RuntimeError('Unsafe restore record')
        data=json.load(f)
    finally:f.close()
    if data.get('boot')!=BOOT:return {'boot':BOOT,'interfaces':{}}
    for name,setting in data.get('interfaces',{}).items():
        if not re.match(r'^(wlan[0-9]+|eth[0-9]+)$',name) or setting not in (0,1,2):raise RuntimeError('Invalid restore record')
    return data

def save(data):
    tmp=RECORD+'.tmp-'+str(os.getpid())
    fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0600)
    try:os.write(fd,json.dumps(data));os.fsync(fd)
    finally:os.close(fd)
    os.rename(tmp,RECORD)

def main():
    if os.getuid()!=0 or len(sys.argv)!=2 or sys.argv[1] not in ('enable','restore'):raise RuntimeError('Invalid operation')
    data=load()
    if sys.argv[1]=='enable':
        routes=subprocess.check_output(['/sbin/ip','-4','route','show','table','main','default'])
        match=re.search(r'\bdev (wlan[0-9]+|eth[0-9]+)\b',routes)
        if not match:raise RuntimeError('No supported physical default interface')
        name=match.group(1);original=value(name)
        if original not in (0,1,2):raise RuntimeError('Unexpected reverse-path setting')
        if original!=2:
            if name not in data['interfaces']:data['interfaces'][name]=original;save(data)
            write(name,2)
        print('VPN_ROUTING_COMPAT_READY')
    else:
        for name,original in data.get('interfaces',{}).items():
            try:
                if value(name)==2:write(name,original)
            except IOError as e:
                if e.errno!=2:raise
        try:os.unlink(RECORD)
        except OSError as e:
            if e.errno!=2:raise
        print('VPN_ROUTING_COMPAT_RESTORED')

if __name__=='__main__':main()
