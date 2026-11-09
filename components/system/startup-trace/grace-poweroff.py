#!/usr/bin/python
"""Bounded post-success grace; only native Active -> Power Off is clean."""
from __future__ import print_function
import json
import os
import select
import stat
import subprocess
import sys
import time

GUARD = '/var/luna/preferences/webosbrew_failsafe'
LOG = '/var/lib/webosbrew/startup-trace/phases.log'
UPTIME = '/proc/uptime'
BOOT_ID = '/proc/sys/kernel/random/boot_id'
DURATION = 10.0


def uptime():
    with open(UPTIME) as source:
        return float(source.read().split()[0])


def boot_id():
    with open(BOOT_ID) as source:
        return source.read().strip()


def identity():
    value = os.lstat(GUARD)
    if not stat.S_ISREG(value.st_mode):
        raise ValueError('guard is not a regular file')
    return value.st_dev, value.st_ino


def record(phase, detail):
    try:
        line = ('v=1 boot=%s uptime=%.2f pid=%s ppid=%s phase=%s flag=%s detail=%s\n'
                % (boot_id(), uptime(), os.getpid(), os.getppid(), phase,
                   'present' if os.path.exists(GUARD) else 'absent', detail))
        with open(LOG, 'a') as out:
            out.write(line)
            out.flush()
            os.fsync(out.fileno())
    except Exception:
        pass


def clear_owned_guard(initial_identity, initial_boot, initial_parent):
    """The parent holds the bootstrap lock and waits for this process."""
    directory = os.open(os.path.dirname(GUARD), os.O_RDONLY)
    removed = False
    try:
        # Check directory fsync support before changing the marker.
        os.fsync(directory)
        if (initial_parent <= 1 or os.getppid() != initial_parent
                or boot_id() != initial_boot or identity() != initial_identity):
            return False
        os.unlink(GUARD)
        removed = True
        os.fsync(directory)
        return True
    except Exception:
        # If persistence fails after unlink, restore the original guard intent.
        # Report the storage failure, not a successful clean shutdown.
        if removed:
            try:
                fd = os.open(GUARD, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
                try:
                    os.fsync(fd)
                finally:
                    os.close(fd)
                os.fsync(directory)
            except Exception:
                pass
        raise
    finally:
        os.close(directory)


def stop_child(process):
    if process is None:
        return
    try:
        if process.poll() is None:
            process.terminate()
            for unused in range(20):
                if process.poll() is not None:
                    break
                time.sleep(0.01)
        if process.poll() is None:
            process.kill()
            for unused in range(20):
                if process.poll() is not None:
                    break
                time.sleep(0.01)
        if process.stdin:
            process.stdin.close()
        if process.stdout:
            process.stdout.close()
    except Exception:
        pass


def run():
    # This helper is invoked only by the rc=0 post-hooks branch. Refuse direct
    # accidental calls lacking that explicit contract.
    if sys.argv[1:] != ['--hooks-ok']:
        return 2
    start = uptime()
    initial_boot = boot_id()
    initial_parent = os.getppid()
    process = None
    null = None
    seen_active = False
    failed = False
    try:
        initial_identity = identity()
        null = open('/dev/null', 'wb')
        process = subprocess.Popen(
            ['/usr/bin/luna-send', '-i',
             'luna://com.webos.service.tvpower/power/getPowerState',
             '{"subscribe":true}'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=null,
            close_fds=True)
        pending = b''
        while uptime() - start < DURATION:
            remaining = max(0.0, DURATION - (uptime() - start))
            ready, unused, unused2 = select.select([process.stdout], [], [], remaining)
            if not ready:
                continue
            data = os.read(process.stdout.fileno(), 16384)
            if not data:
                failed = True
                break
            pending += data
            if len(pending) > 65536:
                failed = True
                break
            while b'\n' in pending:
                line, pending = pending.split(b'\n', 1)
                try:
                    item = json.loads(line.decode('utf-8'))
                except (ValueError, UnicodeError):
                    continue
                if not isinstance(item, dict) or item.get('returnValue') is not True:
                    continue
                if item.get('state') == 'Active':
                    seen_active = True
                # 'processing: Prepare Power Off', Suspend, Screen Off, errors,
                # or a standalone initial Power Off never qualify.
                elif (item.get('state') == 'Power Off' and seen_active
                      and 'processing' not in item):
                    if clear_owned_guard(initial_identity, initial_boot, initial_parent):
                        record('grace_clean_poweroff', 'native_final_state')
                        return 0
    except Exception:
        failed = True
        record('grace_watch_error', 'guard_not_confirmed_clean')
    finally:
        stop_child(process)
        if null is not None:
            null.close()
    # Even a failed/closed subscription must not shorten the original grace.
    while uptime() - start < DURATION:
        time.sleep(min(0.1, max(0.0, DURATION - (uptime() - start))))
    return 2 if failed else 0


if __name__ == '__main__':
    sys.exit(run())
