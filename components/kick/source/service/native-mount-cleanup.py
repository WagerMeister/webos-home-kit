#!/usr/bin/python
"""Collapse identical Developer Mode bind layers in Kick's jail only."""
from __future__ import print_function
import fcntl
import os
import stat
import subprocess

ROOT = '/var/lib/webosbrew/kick-replay-player'
JAIL = '/var/palm/jail/com.jakubjirak.player'
REL = 'media/cryptofs/apps/usr/palm/services/com.palmdts.devmode.service/binaries-armv71/opt'
SOURCE = '/media/cryptofs/apps/usr/palm/services/com.palmdts.devmode.service/binaries-armv71/opt'
FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW

def layers(point):
    found = []
    for line in open('/proc/self/mountinfo'):
        left, right = line.strip().split(' - ', 1)
        a, b = left.split(), right.split()
        if a[4] == point:
            found.append({'id': int(a[0]), 'parent': int(a[1]),
                          'device': a[2], 'root': a[3], 'options': a[5],
                          'fstype': b[0], 'source': b[1]})
    return found

def cleanup():
    parent = os.open(JAIL, FLAGS)
    try:
        for name in REL.split('/'):
            new = os.open('/proc/self/fd/%d/%s' % (parent, name), FLAGS)
            os.close(parent)
            parent = new
        for name in ['openssh', 'devmode']:
            point = JAIL + '/' + REL + '/' + name
            anchored = '/proc/self/fd/%d/%s' % (parent, name)
            while True:
                entries = layers(point)
                if len(entries) <= 1:
                    break
                first = entries[0]
                signature = (first['device'], first['root'], first['fstype'], first['source'])
                if any((e['device'], e['root'], e['fstype'], e['source']) != signature or
                       'ro' not in e['options'].split(',') for e in entries):
                    raise RuntimeError('Unexpected mount layers: ' + name)
                ids = set(e['id'] for e in entries)
                if sum(e['parent'] not in ids for e in entries) != 1:
                    raise RuntimeError('Unexpected mount stack: ' + name)
                src = os.stat(SOURCE + '/' + name)
                target = os.stat(anchored)
                if (src.st_dev, src.st_ino) != (target.st_dev, target.st_ino):
                    raise RuntimeError('Unexpected bind source: ' + name)
                if not stat.S_ISDIR(target.st_mode):
                    raise RuntimeError('Unexpected bind target: ' + name)
                # Anchor every lookup to an open jail directory, never a
                # user-replaceable ancestor. Keep the original layer intact.
                subprocess.check_call(['/bin/umount', anchored])
                if len(layers(point)) != len(entries) - 1:
                    raise RuntimeError('Mount stack changed concurrently: ' + name)
    finally:
        os.close(parent)

def main():
    lock = os.open(ROOT + '/mount-cleanup.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0600)
    try:
        info = os.fstat(lock)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0077:
            raise RuntimeError('Unsafe cleanup lock')
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            cleanup()
        except OSError as error:
            if error.errno != 2:
                raise
    finally:
        os.close(lock)
    print('KICK_MOUNT_CLEANUP_DONE')

if __name__ == '__main__':
    main()
