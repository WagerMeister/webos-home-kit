#!/usr/bin/env python3
"""Refresh component hashes and checksums for non-ignored project resources."""
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
entries = json.loads((ROOT / 'inventory/deploy-map.json').read_text())
for entry in entries:
    if entry.get('type') != 'symlink':
        entry['sha256'] = hashlib.sha256((ROOT / entry['file']).read_bytes()).hexdigest()
(ROOT / 'inventory/deploy-map.json').write_text(
    json.dumps(entries, ensure_ascii=False, indent=2) + '\n')
listing = subprocess.check_output(
    ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=ROOT)
files = sorted({name.decode() for name in listing.split(b'\0') if name and
                name.decode() != 'inventory/files.sha256' and (ROOT / name.decode()).is_file()})
(ROOT / 'inventory/files.sha256').write_text(''.join(
    hashlib.sha256((ROOT / name).read_bytes()).hexdigest() + '  ' + name + '\n'
    for name in files))
print('Updated deployment hashes and', len(files), 'resource checksums')
