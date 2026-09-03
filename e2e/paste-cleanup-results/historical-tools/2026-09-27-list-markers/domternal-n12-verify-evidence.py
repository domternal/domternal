#!/usr/bin/env python3
"""Verify frozen list-marker browser evidence without running any application."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

ROOT = Path('$HOME/Documents/Domternal/domternal')
SCRATCH = Path('/private/tmp')
PRIOR = ROOT / 'e2e/paste-cleanup-results/2026-09-27-styled-breaks.json'
SNAPSHOT = SCRATCH / 'domternal-n12-free-frozen-inputs.json'
BROWSERS = ('chromium', 'firefox', 'webkit')
FRAMEWORKS = ('vanilla', 'react', 'vue', 'angular')
NEW_TITLES = (
    'preserve keeps reconstructed Office decimals and bullet classes at depth',
    'adapt keeps reconstructed Office decimals and bullet classes at depth',
    'a legacy marker schema retains visible Office labels instead of reconstructing lossy lists',
    'preserve keeps all marker enums, HTML type and CSS precedence',
    'adapt keeps all marker enums, HTML type and CSS precedence',
    'null cycles with actual theme support while explicit decimal remains fixed',
    'partial internal copy preserves marker context through an ordered range replacement',
    'SmartPaste preserves square bullets while replacing a disc list range',
    'Tab creates a fresh nested wrapper with the original explicit marker',
    'Tab retains a conflicting existing nested list and creates its own marker wrapper',
    'Shift-Tab preserves a conflicting explicit marker and the outer remainder ordinal',
    'Shift-Tab preserves explicitly enabled bold for subsequent typing',
    'Shift-Tab preserves explicitly disabled bold for subsequent typing',
    'Backspace removes an empty separator without merging conflicting markers',
    'Delete removes a separator then refuses a direct conflicting-wrapper merge without history',
    'a schema without marker attributes warns but still performs the paste',
    'task checked state and absent marker policy remain independent',
)
LEGACY = {'nested-lists.spec.ts': 11, 'list-audit-fixes.spec.ts': 12,
          'notion-list-cursor-context.spec.ts': 6, 'list-join-on-insert.spec.ts': 1}
SKIP_TITLE = 'Chromium native clipboard preserves an editor copy through cleanup'
SKIP_REASON = 'Native clipboard permissions are exercised in Chromium.'


def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def artifact(path, role):
    data = path.read_bytes()
    return {'role': role, 'localPath': str(path), 'bytes': len(data), 'sha256': digest(data)}


def key(row):
    return row['project'], row['file'], row['describe'], row['title']


def flatten(report):
    rows = []
    def visit(suite, parents=()):
        names = parents + (suite['title'],)
        for spec in suite.get('specs', []):
            for test in spec['tests']:
                rows.append({'project': test['projectName'], 'file': spec['file'],
                             'describe': ' › '.join(names[1:]), 'title': spec['title'],
                             'id': spec['id'], 'test': test, 'ok': spec['ok']})
        for child in suite.get('suites', []):
            visit(child, names)
    for suite in report['suites']:
        visit(suite)
    keys = [key(row) for row in rows]
    assert len(keys) == len(set(keys)), 'Duplicate project/file/describe/title'
    ids = [row['id'] for row in rows]
    assert len(ids) == len(set(ids)), 'Duplicate Playwright ID'
    return sorted(rows, key=key)


def expected(kind):
    path = SCRATCH / f'domternal-n12-{kind}-list-inventory.json'
    report = json.loads(path.read_text())
    assert report['errors'] == []
    rows = flatten(report)
    assert all(not row['test']['results'] for row in rows), 'Inventory unexpectedly ran tests'
    keys = {key(row) for row in rows}
    if kind == 'paste':
        prior = json.loads(PRIOR.read_text())
        old = {key(row) for row in prior['cases']}
        new = {(browser, 'paste-list-markers.browser.ts', f'{framework}: explicit list markers', title)
               for browser in BROWSERS for framework in FRAMEWORKS for title in NEW_TITLES}
        assert len(old) == 1128 and len(new) == 204
        assert keys == old | new and not old & new, 'Old or authored new case inventory differs'
        assert Counter(row['project'] for row in rows) == {browser: 444 for browser in BROWSERS}
    else:
        assert len(keys) == 360
        for browser in BROWSERS:
            for framework in FRAMEWORKS:
                project = f'{framework}-{browser}'
                subset = [row for row in rows if row['project'] == project]
                assert len(subset) == 30
                assert Counter(Path(row['file']).name for row in subset) == LEGACY
                assert all(row['file'].startswith(f'../apps/demo-{framework}/e2e/') for row in subset)
    return report, rows


def verify_config(actual, listed, kind):
    for field in ['configFile', 'rootDir', 'forbidOnly', 'fullyParallel', 'globalSetup', 'globalTeardown',
                  'globalTimeout', 'grep', 'grepInvert', 'maxFailures', 'quiet', 'shard', 'tags',
                  'version', 'workers', 'webServer']:
        assert actual.get(field) == listed.get(field), f'Changed configuration: {field}'
    assert actual['reporter'] == [['list'], ['json']], 'Unexpected runtime reporter configuration'
    expected_output = str(SCRATCH / ('domternal-n12-free-matrix-traces' if kind == 'paste' else 'domternal-n12-list-editing-traces'))
    expected_projects = [project | {'outputDir': expected_output, 'metadata': project.get('metadata', {}) | {'actualWorkers': actual['workers']}} for project in listed['projects']]
    assert actual['projects'] == expected_projects, 'Project/filter/retry/repeat/output configuration changed'


def verify_run(kind, report_path, log_path):
    listing, planned = expected(kind)
    report = json.loads(report_path.read_text())
    assert report['errors'] == [], 'Run-level error'
    verify_config(report['config'], listing['config'], kind)
    rows = flatten(report)
    assert [(key(row), row['id']) for row in rows] == [(key(row), row['id']) for row in planned]
    result_rows = []
    for row in rows:
        test = row['test']
        skip = kind == 'paste' and row['project'] in ('firefox', 'webkit') and row['title'] == SKIP_TITLE
        status = 'skipped' if skip else 'passed'
        assert row['ok'] is True and test['expectedStatus'] == status
        assert test['status'] == ('skipped' if skip else 'expected')
        assert test['projectId'] == test['projectName']
        assert len(test['results']) == 1, 'Missing attempt or retry'
        result = test['results'][0]
        assert result['status'] == status and result['retry'] == 0
        assert not result.get('error') and result.get('errors', []) == []
        assert isinstance(result['duration'], (int, float)) and result['duration'] >= 0
        annotations = test.get('annotations', [])
        assert all(item['type'] == 'skip' for item in annotations), 'Unexpected annotation'
        if skip:
            assert len(annotations) == 1 and annotations[0]['description'] == SKIP_REASON
        else:
            assert not annotations
        result_rows.append({k: row[k] for k in ('project', 'file', 'describe', 'title')} |
                           {'status': status, 'durationMs': result['duration'], 'attempts': 1})
    total = 1332 if kind == 'paste' else 360
    skips = 2 if kind == 'paste' else 0
    stats = report['stats']
    for field, value in [('expected', total - skips), ('skipped', skips), ('unexpected', 0), ('flaky', 0)]:
        assert stats[field] == value, f'Unexpected {field} statistic'
    assert isinstance(stats['duration'], (int, float)) and stats['duration'] > 0
    datetime.fromisoformat(stats['startTime'].replace('Z', '+00:00'))
    log = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', log_path.read_text())
    assert len(re.findall(rf'^Running {total} tests using {report["config"]["workers"]} workers?$', log, re.M)) == 1
    lines = re.findall(r'^\s*([✓✘×-])\s+\d+\s+.*$', log, re.M)
    assert Counter(lines) == ({'✓': total - skips, '-': skips} if skips else {'✓': total}), 'Raw result counts'
    assert re.search(rf'^\s*{total - skips} passed\b', log, re.M)
    assert not re.search(r'^\s*\d+ (failed|flaky)\b', log, re.M)
    if skips:
        assert re.search(r'^\s*2 skipped\b', log, re.M)
    return {'startTime': stats['startTime'], 'durationMs': stats['duration'], 'total': total,
            'passed': total - skips, 'skipped': skips, 'failed': 0, 'flaky': 0,
            'workers': report['config']['workers'], 'retries': 0, 'playwrightVersion': report['config']['version'],
            'cases': result_rows,
            'caseInventorySha256': digest(canonical([list(key(row)) for row in rows]))}


def verify_snapshot():
    snapshot = json.loads(SNAPSHOT.read_text())
    rows = snapshot['inventory']
    assert len(rows) == len({row['path'] for row in rows})
    assert digest(canonical(rows)) == snapshot['inventorySha256']
    for row in rows:
        path = ROOT / row['path']
        assert path.is_relative_to(ROOT) and '..' not in Path(row['path']).parts
        data = path.read_bytes()
        assert len(data) == row['bytes'] and digest(data) == row['sha256'], f'Changed input: {row["path"]}'
    # Independently reconstruct the categories of the parent's explicit inventory.
    wanted = {ROOT / row for row in [
        'e2e/paste-cleanup.config.ts', 'e2e/paste-list-markers.browser.ts',
        'packages/extension-paste-cleanup/README.md', 'e2e/fixtures.ts', 'e2e/fixtures/vite.config.mjs',
        'e2e/list-editing.config.ts', 'e2e/playwright.config.ts', 'e2e/targets.ts',
        'e2e/paste-cleanup-fixture/entry.mjs', 'e2e/paste-cleanup-fixture/index.html',
        'e2e/paste-cleanup-fixture/vite.config.mjs', 'e2e/tsconfig.json',
        'README.md', 'tests/package-artifacts/policy.json', 'packages/extension-paste-cleanup/tsconfig.json',
        'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']}
    wanted.update(ROOT / 'e2e' / f'paste-{name}.browser.ts' for name in
                  ('cleanup', 'feedback', 'assets', 'resolver', 'destination', 'breaks', 'list-markers'))
    wanted.update((ROOT / 'packages').glob('*/package.json'))
    wanted.update(path for path in (ROOT / 'packages').glob('*/dist/**/*') if path.is_file())
    for package in ('core', 'extension-block-controls', 'extension-paste-cleanup'):
        wanted.update(path for path in (ROOT / 'packages' / package / 'src').rglob('*') if path.is_file())
    for framework in FRAMEWORKS:
        app = ROOT / 'apps' / f'demo-{framework}'
        wanted.update(path for path in (app / 'src').rglob('*') if path.is_file())
        wanted.update(path for path in app.iterdir() if path.is_file() and path.suffix in ('.json', '.ts', '.html') and not path.name.startswith('.'))
        wanted.update(app / 'e2e' / filename for filename in ('fixtures.ts', *LEGACY))
    assert {str(path.relative_to(ROOT)) for path in wanted} == {row['path'] for row in rows}
    return snapshot


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['inventory', 'verify'])
    parser.add_argument('--paste-report', type=Path)
    parser.add_argument('--paste-log', type=Path)
    parser.add_argument('--legacy-report', type=Path)
    parser.add_argument('--legacy-log', type=Path)
    parser.add_argument('--output', type=Path, default=SCRATCH / 'domternal-n12-verified-browser-data.json')
    args = parser.parse_args()
    if args.mode == 'inventory':
        for kind in ('paste', 'legacy'):
            _, rows = expected(kind)
            print(json.dumps({'kind': kind, 'uniqueCases': len(rows),
                              'caseInventorySha256': digest(canonical([list(key(row)) for row in rows]))}))
        return
    assert all([args.paste_report, args.paste_log, args.legacy_report, args.legacy_log])
    snapshot = verify_snapshot()
    runs = {kind: verify_run(kind, report, log) for kind, report, log in (
        ('paste', args.paste_report, args.paste_log), ('legacy', args.legacy_report, args.legacy_log))}
    artifacts = [artifact(path, role) for path, role in (
        (args.paste_report, 'Final paste browser report'), (args.paste_log, 'Final paste raw log'),
        (args.legacy_report, 'Final legacy list browser report'), (args.legacy_log, 'Final legacy list raw log'),
        (SNAPSHOT, 'Pre-run source and build input snapshot'),
        (SCRATCH / 'domternal-n12-paste-list-inventory.json', 'Pre-run paste discovery, no browser execution'),
        (SCRATCH / 'domternal-n12-legacy-list-inventory.json', 'Pre-run legacy discovery, no browser execution'),
        (Path(__file__), 'Read-only evidence verifier'))]
    result = {'kind': 'domternal-free-list-markers-browser-verification', 'version': 1,
              'verifiedAt': datetime.now(timezone.utc).isoformat(), 'runs': runs,
              'frozenInputs': snapshot, 'artifacts': artifacts}
    with args.output.open('x') as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    print(json.dumps({'verified': True, 'inputFiles': len(snapshot['inventory']),
                      'inventorySha256': snapshot['inventorySha256'], 'cases': 1692,
                      'passed': 1690, 'skipped': 2, 'outputSha256': digest(args.output.read_bytes())}))


if __name__ == '__main__':
    main()
