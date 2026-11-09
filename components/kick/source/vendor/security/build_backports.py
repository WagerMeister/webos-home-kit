"""Rebuild local security backports from checksum-pinned public sources."""
import base64
import gzip
import hashlib
import io
import json
import tarfile
import urllib.request
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit


def download(url):
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or parsed.hostname not in {'registry.npmjs.org', 'raw.githubusercontent.com'}:
        raise RuntimeError('Unexpected source URL')
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read(2 * 1024 * 1024 + 1)


def pack(files):
    output = io.BytesIO()
    with gzip.GzipFile(fileobj=output, mode='wb', filename='', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w', format=tarfile.PAX_FORMAT) as archive:
            for name, data in sorted(files.items()):
                entry = tarfile.TarInfo(name)
                entry.size = len(data)
                entry.mode = 0o644
                archive.addfile(entry, io.BytesIO(data))
    return output.getvalue()


def build(pin):
    source = download(pin['registry_url'])
    digest = base64.b64encode(hashlib.sha512(source).digest()).decode()
    if 'sha512-' + digest != pin['registry_integrity']:
        raise RuntimeError('Registry integrity mismatch')
    files = {}
    with tarfile.open(fileobj=io.BytesIO(source), mode='r:gz') as archive:
        for member in archive:
            name = PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts or name.parts[0] != 'package':
                raise RuntimeError('Unsafe source archive path')
            if member.isfile():
                files[str(name)] = archive.extractfile(member).read()
            elif not member.isdir():
                raise RuntimeError('Non-regular archive entry')
    for name, patch in pin['files'].items():
        data = download(patch['url'])
        if hashlib.sha256(data).hexdigest() != patch['sha256']:
            raise RuntimeError('Patch checksum mismatch: ' + name)
        files['package/' + name] = data
    metadata = json.loads(files['package/package.json'])
    metadata['version'] = pin['local_version']
    files['package/package.json'] = (json.dumps(metadata, indent=2) + '\n').encode()
    return pack(files)


if __name__ == '__main__':
    directory = Path(__file__).resolve().parent
    for pin in json.loads((directory / 'provenance.json').read_text()):
        data = build(pin)
        if hashlib.sha256(data).hexdigest() != pin['artifact_sha256']:
            raise RuntimeError('Backport is not byte reproducible')
        target = directory / (pin['package'] + '-' + pin['local_version'] + '.tgz')
        target.write_bytes(data)
        print('Verified ' + target.name)
