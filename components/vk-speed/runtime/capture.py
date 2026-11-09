#!/usr/bin/python
"""Read only VK's foreground media state; never control the original app."""
from __future__ import print_function
import fcntl
import json
import os
import signal
import subprocess
import sys
import time
import urlparse
import urllib2

ROOT = '/var/lib/webosbrew/vk-speed'
STATE = '/tmp/vk-speed-state'
LATEST = STATE + '/latest.json'
MAX_JSON = 524288

def uptime():
    return float(open('/proc/uptime').read().split()[0])

def alarm_handler(signum, frame):
    raise RuntimeError('Luna request timeout')

def luna(uri, payload):
    p = subprocess.Popen(['/usr/bin/luna-send', '-w', '1200', '-n', '1', 'luna://' + uri,
                          json.dumps(payload)], stdout=subprocess.PIPE, stderr=open(os.devnull, 'w'))
    try:
        signal.alarm(3)
        out = p.communicate()[0]
    except Exception:
        p.kill()
        p.communicate()
        raise
    finally:
        signal.alarm(0)
    if p.returncode or len(out) > MAX_JSON:
        raise RuntimeError('Luna request failed')
    return json.loads(out)

def allowed_source(url):
    if not isinstance(url, basestring) or len(url) > 8192:
        return False
    u = urlparse.urlsplit(url)
    host = (u.hostname or '').lower()
    return (u.scheme in ('http', 'https') and not u.username and not u.password and
            (host == 'okcdn.ru' or host.endswith('.okcdn.ru') or
             host == 'vkuser.net' or host.endswith('.vkuser.net') or
             host == 'vkvideo.ru' or host.endswith('.vkvideo.ru')))

class NoRedirect(urllib2.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def source_format(url):
    if not allowed_source(url): return None
    if urlparse.urlsplit(url).path.lower().endswith('.m3u8'): return 'hls'
    # Some VK MP4 URLs have no extension. Verify bytes and media type using a
    # tiny range; never follow redirects or retain/log the signed address.
    req = urllib2.Request(url, headers={'Range': 'bytes=0-127', 'User-Agent': 'Mozilla/5.0'})
    try:
        signal.alarm(6)
        reply = urllib2.build_opener(NoRedirect()).open(req, timeout=5)
        data = reply.read(32)
        media_type = reply.headers.get('Content-Type', '').split(';')[0].lower()
        reply.close()
        if media_type == 'video/mp4' and len(data) >= 12 and data[4:8] == 'ftyp': return 'mp4'
    except Exception:
        return None
    finally:
        signal.alarm(0)
    return None

def forget():
    try: os.unlink(LATEST)
    except OSError: pass

def save(value):
    tmp = STATE + '/capture-%d.tmp' % os.getpid()
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0600)
    try:
        os.write(fd, json.dumps(value))
        os.fsync(fd)
    finally:
        os.close(fd)
    os.rename(tmp, LATEST)

def main():
    signal.signal(signal.SIGALRM, alarm_handler)
    try: os.mkdir(STATE, 0700)
    except OSError:
        if not os.path.lexists(STATE): raise
    directory = os.open(STATE, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    info = os.fstat(directory)
    if info.st_uid != 0 or info.st_mode & 0077: raise RuntimeError('Unsafe state directory')
    os.close(directory)
    fd = os.open(STATE + '/capture.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0600)
    try:
        try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except IOError: return
        forget()
        previous = None
        previous_uri = None
        previous_format = None
        while True:
            delay = 5
            try:
                fg = luna('com.webos.applicationManager/getForegroundAppInfo', {}).get('appId')
                if fg == 'vkvideo':
                    delay = 2
                    pipes = [p for p in luna('com.webos.media/getActivePipelines', [])
                             if p.get('appId') == 'vkvideo' and p.get('type') == 'media']
                    if len(pipes) != 1 or pipes[0].get('mediaState') != 'play':
                        # webOS can stop VK's pipeline before switching foreground
                        # on Home. Keep the last verified snapshot for its short
                        # TTL, but never carry it across a different pipeline.
                        if len(pipes) > 1 or (len(pipes) == 1 and pipes[0].get('id') != previous):
                            forget(); previous = None; previous_uri = None; previous_format = None
                        else:
                            try:
                                saved = json.load(open(LATEST))
                                age = uptime() - saved.get('uptime', 0)
                                if age < 0 or age > 20: forget()
                            except (IOError, ValueError, TypeError): pass
                    else:
                        mid = pipes[0]['id']
                        reply = luna('com.webos.media/getPipelineState', {'mediaId': mid})
                        d = json.loads(reply.get('data', '{}'))
                        args = d.get('args') or []
                        uri = args[0] if args else None
                        options = args[1] if len(args) > 1 else {}
                        opttext = json.dumps(options).lower()
                        position = d.get('currentTime', {}).get('currentTime')
                        if previous != mid or previous_uri != uri:
                            previous_format = source_format(uri) if allowed_source(uri) else None
                            previous_uri = uri
                            previous = None
                        # Cache unsupported formats until the source changes so
                        # the range probe is not repeated every two seconds.
                        if previous_format not in ('hls', 'mp4'):
                            forget(); previous = mid
                        elif (d.get('media_state') != 'play' or
                                'drm' in opttext or 'license' in opttext or
                                not isinstance(position, (int, long, float)) or position < 0 or position > 86400000):
                            forget(); previous = None; previous_uri = None; previous_format = None
                        elif previous == mid:
                            save({'uptime': uptime(), 'source': uri, 'format': previous_format, 'position': position / 1000.0})
                        else:
                            forget(); previous = mid
                else:
                    previous = None; previous_uri = None; previous_format = None
                    try:
                        saved = json.load(open(LATEST))
                        age = uptime() - saved.get('uptime', 0)
                        if age < 0 or age > 20: forget()
                    except (IOError, ValueError, TypeError):
                        pass
            except Exception:
                # Never stop or alter VK on read failure. Expiry prevents stale playback.
                previous = None; previous_uri = None; previous_format = None
            time.sleep(delay)
    finally:
        os.close(fd)

if __name__ == '__main__':
    main()
