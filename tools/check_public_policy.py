#!/usr/bin/env python3
"""Check tracked publication inputs; never prints credential contents."""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    listing = subprocess.run(['git', 'ls-files', '-z'], cwd=ROOT,
                             capture_output=True, check=True).stdout
    files = [ROOT / name.decode() for name in listing.split(b'\0') if name]
    if not files:
        raise SystemExit('FAIL: empty Git index; stage the intended public inputs first')
    forbidden = re.compile(
        r'(^|/)(?:private|secrets|\.ssh|\.gnupg)(/|$)|'
        r'(^|/)(?:authorized_keys[^/]*|known_hosts[^/]*|client\.json|config\.json|'
        r'id_rsa[^/]*|id_ed25519[^/]*|root_id_[^/]*|chrome)$|'
        r'\.(?:ipk|pem|key|state|sqlite3?|db|har|pcap|log)$'
    )
    errors = []
    for file in files:
        name = file.relative_to(ROOT).as_posix()
        if forbidden.search(name):
            errors.append('forbidden tracked path: ' + name)
        if file.is_symlink():
            errors.append('unexpected repository symlink: ' + name)
    config = json.loads((ROOT / 'components/vpn/config.example.json').read_text())
    config = config.get('providerConfig', config)
    if (config.get('exitNodeIP'), config.get('exitNodeName'), config.get('hostname')) != (
            '100.64.0.10', 'example-exit-node', 'lg-webos-tv'):
        errors.append('Connection example must retain fictitious identity values')
    if errors:
        raise SystemExit('\n'.join(errors))
    print('PASS: public tracked-path policy and example connection identities')


if __name__ == '__main__':
    main()
