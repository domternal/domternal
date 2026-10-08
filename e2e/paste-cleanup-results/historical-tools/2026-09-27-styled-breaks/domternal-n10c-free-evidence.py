#!/usr/bin/env python3
"""Freeze and later verify the local Free styled-breaks qualification inputs."""
import argparse
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('$HOME/Documents/Domternal/domternal')
SNAPSHOT = Path('/private/tmp/domternal-n10c-free-frozen-inputs.json')
CHANGED = [
    'e2e/paste-cleanup.config.ts',
    'packages/extension-paste-cleanup/README.md',
    'packages/extension-paste-cleanup/src/html/destinationDemand.test.ts',
    'packages/extension-paste-cleanup/src/html/destinationDemand.ts',
    'packages/extension-paste-cleanup/src/html/inheritance.test.ts',
    'packages/extension-paste-cleanup/src/html/inheritance.ts',
    'e2e/paste-breaks.browser.ts',
    'packages/extension-paste-cleanup/src/PasteCleanup.breaks.test.ts',
]
SUITES = [f'e2e/paste-{name}.browser.ts' for name in
          ['cleanup', 'feedback', 'assets', 'resolver', 'destination', 'breaks']]
FIXED = CHANGED + SUITES + [
    'e2e/fixtures.ts', 'e2e/fixtures/vite.config.mjs',
    'e2e/paste-cleanup-fixture/entry.mjs', 'e2e/paste-cleanup-fixture/index.html',
    'e2e/paste-cleanup-fixture/vite.config.mjs', 'e2e/tsconfig.json',
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
    'apps/demo-react/package.json', 'apps/demo-vue/package.json',
    'apps/demo-angular/package.json',
]

def digest(data):
    return hashlib.sha256(data).hexdigest()

def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode()

def record(path):
    data = path.read_bytes()
    return {'path': str(path.relative_to(ROOT)), 'bytes': len(data), 'sha256': digest(data)}

def selected():
    paths = {ROOT / name for name in FIXED}
    paths.update((ROOT / 'packages').glob('*/package.json'))
    paths.update(path for path in (ROOT / 'packages').glob('*/dist/**/*') if path.is_file())
    paths.update(path for path in (ROOT / 'packages/extension-paste-cleanup/src').rglob('*') if path.is_file())
    return sorted(paths, key=lambda path: str(path.relative_to(ROOT)))

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT).decode().strip()

def freeze():
    if SNAPSHOT.exists():
        raise RuntimeError('Refusing to replace the initial frozen snapshot')
    records = [record(path) for path in selected()]
    result = {
        'kind': 'domternal-free-styled-breaks-input-snapshot',
        'version': 1,
        'createdAt': datetime.now(timezone.utc).isoformat(),
        'gitHead': git('rev-parse', 'HEAD'),
        'gitBranch': git('branch', '--show-current'),
        'gitStatus': git('status', '--short').splitlines(),
        'selection': {
            'rules': [
                'All source files in packages/extension-paste-cleanup/src.',
                'All existing files under packages/*/dist, since the fixture constructs public aliases from every package manifest.',
                'Every packages/*/package.json plus root lock/workspace manifests and framework app manifests.',
                'The six configured paste browser suites, shared test fixture, Vite configs, fixture entry/HTML and E2E TypeScript config.',
                'The eight explicitly changed implementation, test, config and documentation files.',
            ],
            'limitations': [
                'This is an explicit repository and built-artifact snapshot, not an esbuild or Vite dependency graph.',
                'Vendor dependency bytes and generated Vite optimizer caches are not included; the lockfile records dependency resolution.',
                'Browser binaries, OS state, mutable logs and trace/report artifacts are recorded separately, not frozen as source inputs.',
            ],
            'changedFiles': CHANGED,
        },
        'inventory': records,
        'inventorySha256': digest(canonical(records)),
    }
    SNAPSHOT.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'snapshot': str(SNAPSHOT), 'files': len(records),
                      'bytes': sum(row['bytes'] for row in records),
                      'inventorySha256': result['inventorySha256'],
                      'snapshotSha256': digest(SNAPSHOT.read_bytes())}, indent=2))

def verify_snapshot():
    data = json.loads(SNAPSHOT.read_text())
    assert digest(canonical(data['inventory'])) == data['inventorySha256']
    actual = [record(ROOT / row['path']) for row in data['inventory']]
    assert actual == data['inventory'], 'Captured repository or built-artifact bytes changed'
    assert {row['path'] for row in actual} == {str(p.relative_to(ROOT)) for p in selected()}, 'Selected inventory membership changed'
    print(json.dumps({'snapshotVerified': True, 'files': len(actual), 'inventorySha256': data['inventorySha256']}))
    return data

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['freeze', 'verify-snapshot'])
    args = parser.parse_args()
    if args.action == 'freeze':
        freeze()
    else:
        verify_snapshot()
