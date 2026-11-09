#!/usr/bin/python
"""Prepare only Kick's native jail. No boot hook, role grant or LG file edit."""
from __future__ import print_function
import os
import stat
import subprocess

APP_ID = 'org.local.vkspeed.player'
APP = '/media/developer/apps/usr/palm/applications/' + APP_ID
JAIL = '/var/palm/jail/' + APP_ID
SOURCE = '/media/system/apps/usr/palm/applications/com.webos.app.browser'
IMAGE = '/media/system/apps/usr/palm/data/images/com.webos.app.browser/data.img'
ENGINE_MOUNT = '/var/lib/webosbrew/vk-speed/engine'
ENGINE_RELATIVE = '/usr/palm/applications/com.webos.app.browser'
DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def anchor(fd):
    return '/proc/self/fd/' + str(fd)


def checked_directory(parent, name, create=False, harden=False):
    name_path = anchor(parent) + '/' + name
    if create:
        try:
            os.mkdir(name_path, 0755)
        except OSError:
            if not os.path.lexists(name_path):
                raise
    fd = os.open(name_path, DIRECTORY)
    info = os.fstat(fd)
    if harden:
        # Only synthetic jail directories, never a mounted shared filesystem.
        os.fchown(fd, 0, 0)
        os.fchmod(fd, 0555)
    elif info.st_uid != 0 or info.st_mode & 0022:
        os.close(fd)
        raise RuntimeError('Unsafe jail directory: ' + name)
    return fd


def engine_source():
    # Updated LG native apps are squashfs images. SAM mounts the browser image
    # only when the LG browser is launched; its metadata-only directory also
    # exists after a reboot. Never mistake that directory for a usable engine.
    # Mount the installed image in our own root-private tree, not over LG's app.
    parent = os.open('/var/lib/webosbrew/vk-speed', DIRECTORY)
    info = os.fstat(parent)
    if info.st_uid != 0 or info.st_mode & 0022:
        raise RuntimeError('Unsafe private engine parent')
    try:
        os.mkdir(anchor(parent) + '/engine', 0700)
    except OSError:
        if not os.path.lexists(anchor(parent) + '/engine'):
            raise
    target = os.open(anchor(parent) + '/engine', DIRECTORY)
    info = os.fstat(target)
    # Squashfs preserves the package's directory mode, which can contain group
    # write bits. Its read-only mount, checked below, is the write boundary.
    if info.st_uid != 0 or (not os.path.ismount(ENGINE_MOUNT) and info.st_mode & 0022):
        raise RuntimeError('Unsafe private engine mount')
    image = os.open(IMAGE, os.O_RDONLY | os.O_NOFOLLOW)
    info = os.fstat(image)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0022 or not 1048576 <= info.st_size <= 268435456:
        raise RuntimeError('Unsafe installed browser image')
    if os.read(image, 4) != 'hsqs':
        raise RuntimeError('Expected installed squashfs browser image')
    if not os.path.ismount(ENGINE_MOUNT):
        # The image FD pins the actual root-owned file across mount/loop setup.
        subprocess.check_call(['/bin/mount', '-t', 'squashfs', '-o', 'loop,ro',
                               anchor(image), ENGINE_MOUNT])
    os.close(image)
    os.close(target)
    os.close(parent)
    if not os.path.ismount(ENGINE_MOUNT) or not os.statvfs(ENGINE_MOUNT).f_flag & 1:
        raise RuntimeError('Private browser image must be read-only')
    source = ENGINE_MOUNT + ENGINE_RELATIVE
    for name in ['chrome', 'lib/libcbe.so', 'crow_resources.pak', 'share/crow_config.json']:
        fd = os.open(source + '/' + name, os.O_RDONLY | os.O_NOFOLLOW)
        info = os.fstat(fd)
        os.close(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_size == 0:
            raise RuntimeError('Incomplete browser engine: ' + name)
    return source


def code_link(directory, name, target, resource=None):
    path = anchor(directory) + '/' + name
    if os.path.lexists(path):
        if not os.path.islink(path) or os.readlink(path) != target:
            raise RuntimeError('Unexpected native resource: ' + name)
    elif os.path.exists(resource or target):
        os.symlink(target, path)


def main():
    # Zero-copy engine resources. Never package or modify LG's library/profile.
    source = engine_source()
    app = os.open(APP, DIRECTORY)
    os.fchown(app, 0, 0)
    os.fchmod(app, 0755)
    for name in ['chrome', 'libvkobserver.so', 'appinfo.json']:
        fd = os.open(anchor(app) + '/' + name, os.O_RDONLY | os.O_NOFOLLOW)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise RuntimeError('Unsafe native application file: ' + name)
        os.fchown(fd, 0, 0)
        os.fchmod(fd, 0555 if name != 'appinfo.json' else 0644)
        os.close(fd)
    for name in ['lib', 'etc', 'locales', 'nssdb', 'assets', 'crow_resources.pak', 'drm.nfz']:
        code_link(app, name, SOURCE + '/' + name, source + '/' + name)
    share = checked_directory(app, 'share', create=True, harden=True)
    config = os.open(anchor(share) + '/crow_config.json', os.O_RDONLY | os.O_NOFOLLOW)
    if not stat.S_ISREG(os.fstat(config).st_mode):
        raise RuntimeError('Unsafe native player config')
    os.fchown(config, 0, 0)
    os.fchmod(config, 0644)
    os.close(config)
    for name in ['ads_block_list.json', 'b8_1zx.png', 'browser_version',
                 'default_history_list.json', 'extra_conf_example.json', 'fonts',
                 'im', 'open_api_script', 'phish.txt', 'prepop',
                 'recommended_sites_list.json', 'search_engines_list.json', 'spoof_urls_list.json']:
        code_link(share, name, SOURCE + '/share/' + name, source + '/share/' + name)
    os.close(share)
    os.close(app)
    # Standard jail bootstrap, deliberately no failed GUI launch beforehand.
    subprocess.check_call(['/usr/bin/jailer', '-S', '-t', 'native_builtin',
                           '-p', APP, '-i', APP_ID, '/bin/true'], stdout=open(os.devnull, 'w'))
    try:
        subprocess.check_call(['/usr/bin/python', os.path.join(os.path.dirname(__file__), 'native-mount-cleanup.py')],
                              stdout=open(os.devnull, 'w'))
    except (OSError, subprocess.CalledProcessError):
        # Resource cleanup must never make an otherwise usable player fail.
        pass
    parent = os.open('/var/palm/jail', DIRECTORY)
    jail = os.open(anchor(parent) + '/' + APP_ID, DIRECTORY)
    native_uid = os.fstat(jail).st_uid
    if native_uid <= 0:
        raise RuntimeError('Expected unprivileged native jail')
    # Pin the native-owned jail before descending. Its media subtree is made
    # root-owned; subsequent operations use FDs even if its ancestor is renamed.
    media = checked_directory(jail, 'media', harden=True)
    current = media
    held = [parent, jail, media]
    for name in ['system', 'apps', 'usr', 'palm', 'applications']:
        current = checked_directory(current, name, create=True, harden=True)
        held.append(current)
    target = anchor(current) + '/com.webos.app.browser'
    try:
        os.mkdir(target, 0555)
    except OSError:
        if not os.path.lexists(target):
            raise
    target_fd = os.open(target, DIRECTORY)
    source_fd = os.open(source, DIRECTORY)
    expected = os.fstat(source_fd)
    actual = os.fstat(target_fd)
    if (expected.st_dev, expected.st_ino) != (actual.st_dev, actual.st_ino):
        # Pin both endpoints. No attacker-controlled argument reaches mount.
        subprocess.check_call(['/bin/mount', '--bind', anchor(source_fd), anchor(target_fd)])
    os.close(target_fd)
    target_fd = os.open(target, DIRECTORY)
    actual = os.fstat(target_fd)
    if (expected.st_dev, expected.st_ino) != (actual.st_dev, actual.st_ino):
        raise RuntimeError('Incorrect engine bind')
    # The source is an LG overlay and may be rw. Make only our bind read-only.
    subprocess.check_call(['/bin/mount', '-o', 'remount,bind,ro', anchor(target_fd)])
    # Linux ST_RDONLY=1; Python2.7 on the TV does not expose os.ST_RDONLY.
    if not os.statvfs(anchor(target_fd)).f_flag & 1:
        raise RuntimeError('Engine bind is not read-only')
    tmp = os.open(anchor(jail) + '/tmp', DIRECTORY)
    tmp_info = os.fstat(tmp)
    if tmp_info.st_uid != 0 or not tmp_info.st_mode & stat.S_ISVTX:
        raise RuntimeError('Unsafe temporary directory')
    profile = anchor(tmp) + '/vkspeed-native-profile'
    try:
        os.mkdir(profile, 0700)
        os.chown(profile, native_uid, 5000)
    except OSError:
        info = os.lstat(profile)
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != native_uid or info.st_mode & 0077:
            raise RuntimeError('Unsafe native player profile')
    for fd in held + [target_fd, source_fd, tmp]:
        os.close(fd)
    print('NATIVE_PLAYER_READY')


if __name__ == '__main__':
    main()
