#!/usr/bin/env python3
"""Print the deployment paths and modes for a component."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--component', required=True, choices=['hearth', 'kick', 'vk-speed', 'vpn', 'system', 'all'])
args = p.parse_args()
entries = json.loads((ROOT / 'inventory/deploy-map.json').read_text())
for entry in entries:
    if args.component not in ('all', entry['component']):
        continue
    if entry.get('type') == 'symlink':
        print('SYMLINK', entry['target'], '->', entry['linkTarget'])
    else:
        print(entry['mode'], entry['file'], '->', entry['target'])
print('\nPLAN ONLY. Read docs/INSTALL.md before installing components.')
