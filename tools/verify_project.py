#!/usr/bin/env python3
"""Verify component manifests and local resource integrity."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def main():
    errors = []
    entries = json.loads((ROOT / 'inventory/deploy-map.json').read_text())
    for entry in entries:
        if entry.get('type') == 'symlink':
            if not entry['linkTarget'].startswith(('/var/lib/webosbrew/', '/media/developer/')):
                errors.append('Unexpected symlink target: ' + entry['target'])
            continue
        path = ROOT / entry['file']
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != entry['sha256']:
            errors.append('Deployment file differs: ' + entry['file'])
    provenance = json.loads((ROOT / 'packages/tailscale-provenance.json').read_text())
    archive = ROOT / 'packages/tailscale_1.104.5_arm.tgz'
    if archive.exists() and hashlib.sha256(archive.read_bytes()).hexdigest() != provenance['sha256']:
        errors.append('Tailscale archive differs from verified official SHA256')
    checksum_file = ROOT / 'inventory/files.sha256'
    if checksum_file.exists():
        for line in checksum_file.read_text().splitlines():
            expected, name = line.split('  ', 1)
            path = ROOT / name
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                errors.append('Resource checksum differs: ' + name)
    if errors:
        raise SystemExit('\n'.join(errors))
    print('PASS: deployment manifest and resource checksums; optional Tailscale archive ' +
          ('verified' if archive.exists() else 'not distributed (URL/SHA256 recorded)'))

if __name__ == '__main__':
    main()
