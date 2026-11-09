#!/usr/bin/env python3
"""Extra device-specific credential screening, including text inside IPK/TGZ archives.

Only paths/rule names are printed. This supplements gitleaks, not a proof that
all potentially sensitive data or third-party redistribution issues are absent.
"""
import io
import re
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN = {'id_rsa', 'root_id_rsa', 'id_ed25519', 'authorized_keys', 'client.json', 'tailscaled.state'}
RULES = {
    'private-key-material': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\s]{80,}'),
    'tailscale-auth-key': re.compile(r'\btskey-(?:auth|api|client)-[A-Za-z0-9_-]{15,}'),
    'ssh-key-material': re.compile(r'\bssh-(?:rsa|ed25519)\s+[A-Za-z0-9+/=]{70,}'),
    'real-login-url': re.compile(r'https://login\.tailscale\.com/a/(?!TESTONLY\b|EXAMPLE\b)[A-Za-z0-9_-]{8,}'),
    'signed-media-url': re.compile(r'https?://[^\s\x22\x27]*\b(?:vkuser\.net|okcdn\.ru)[^\s\x22\x27]*\?(?=[^\s\x22\x27]*(?:sig|sign|token|expire|extra)=)[^\s\x22\x27]+', re.I),
}
findings = []

def inspect(name, data):
    if Path(name).name in FORBIDDEN:
        findings.append((name, 'forbidden-auth-file'))
    if b'\0' in data[:2048]:
        return
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        return
    for rule, pattern in RULES.items():
        if pattern.search(text):
            findings.append((name, rule))

def tar_members(name, data):
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:*') as archive:
        for member in archive:
            if member.isfile() and member.size <= 80000000:
                f = archive.extractfile(member)
                if f:
                    inspect(name + ':' + member.name, f.read())

def ipk_members(name, data):
    if not data.startswith(b'!<arch>\n'):
        raise ValueError('Unsupported IPK format: ' + name)
    offset = 8
    while offset + 60 <= len(data):
        header = data[offset:offset + 60]
        length = int(header[48:58].strip())
        member_name = header[:16].decode().strip().rstrip('/')
        payload = data[offset + 60:offset + 60 + length]
        if member_name.endswith(('.tar.gz', '.tar.xz', '.tar')):
            tar_members(name + ':' + member_name, payload)
        offset += 60 + length + length % 2

for path in ROOT.rglob('*'):
    if not path.is_file() or '.git' in path.relative_to(ROOT).parts:
        continue
    name = str(path.relative_to(ROOT))
    data = path.read_bytes()
    if path.suffix == '.ipk':
        ipk_members(name, data)
    elif path.suffix == '.tgz':
        tar_members(name, data)
    elif path.suffix not in ('.png', '.jpg', '.jpeg', '.so'):
        inspect(name, data)

if findings:
    for name, rule in findings:
        print(rule + ': ' + name)
    raise SystemExit(1)
print('PASS: no device credential patterns or forbidden authentication files, including packaged text')
