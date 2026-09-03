#!/usr/bin/env python3
"""Verify the completed Free browser matrix without executing application code."""
import importlib.util
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

BASE = Path('/private/tmp')
ROOT = Path('$HOME/Documents/Domternal/domternal')
REPORT = BASE / 'domternal-n10c-free-matrix.json'
LOG = BASE / 'domternal-n10c-free-matrix.log'

def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

frozen = load_module('frozen_inputs', BASE / 'domternal-n10c-free-evidence.py')
inventory = load_module('fixed_cases', BASE / 'domternal-n10c-free-cases.py')

def artifact(path, role):
    data = path.read_bytes()
    return {'role': role, 'localPath': str(path), 'bytes': len(data), 'sha256': frozen.digest(data)}

def flatten(suites, ancestry=()):
    for suite in suites:
        path = (*ancestry, suite['title'])
        for spec in suite.get('specs', []):
            assert spec['ok'] is True, ('Spec not successful', spec['title'])
            assert path[0] == spec['file']
            describe = ' / '.join(path[1:])
            for test in spec['tests']:
                key = (test['projectName'], spec['file'], describe, spec['title'])
                yield key, test
        yield from flatten(suite.get('suites', []), path)

def verify_report(report):
    assert report['errors'] == [], 'Run-level errors'
    config = report['config']
    assert config['forbidOnly'] is True
    assert config['workers'] == 1
    assert config['shard'] is None
    assert config['grep'] == {} and config['grepInvert'] is None
    assert config['fullyParallel'] is False
    assert {p['name'] for p in config['projects']} == set(inventory.PROJECTS)
    wanted_suites = {path.removeprefix('e2e/') for path in frozen.SUITES}
    for project in config['projects']:
        assert project['repeatEach'] == 1 and project['retries'] == 0
        assert set(project['testMatch']) == wanted_suites
    stats = report['stats']
    assert (stats['expected'], stats['skipped'], stats['unexpected'], stats['flaky']) == (1126, 2, 0, 0)
    rows = list(flatten(report['suites']))
    keys = [key for key, _ in rows]
    assert len(keys) == len(set(keys)) == 1128
    expected = inventory.expected_cases()
    missing, extra = sorted(expected - set(keys)), sorted(set(keys) - expected)
    assert not missing and not extra, {'missing': missing, 'extra': extra}
    outputs = []
    for key, test in rows:
        project, file, describe, title = key
        skipped = file == 'paste-cleanup.browser.ts' and title == inventory.NATIVE_TITLE and project != 'chromium'
        wanted = 'skipped' if skipped else 'passed'
        assert test['expectedStatus'] == wanted, (key, 'unexpected expectedStatus')
        assert test['status'] == ('skipped' if skipped else 'expected'), (key, 'unexpected test outcome')
        assert len(test['results']) == 1, (key, 'missing result or retry')
        result = test['results'][0]
        assert result['status'] == wanted and result['retry'] == 0, (key, 'result failed or retried')
        assert result['errors'] == [], (key, 'result errors')
        assert not result.get('error'), (key, 'result error')
        if skipped:
            descriptions = [a.get('description') for a in [*test['annotations'], *result.get('annotations', [])] if a.get('type') == 'skip']
            assert 'Native clipboard permissions are exercised in Chromium.' in descriptions
        outputs.append({'project': project, 'file': file, 'describe': describe, 'title': title,
                        'status': wanted, 'durationMs': result['duration'], 'attempts': 1})
    return sorted(outputs, key=lambda row: (row['project'], row['file'], row['describe'], row['title']))

def verify_logs(report):
    raw = LOG.read_text()
    assert 'Running 1128 tests using 1 worker' in raw
    assert re.search(r'^\s*1126 passed \(', raw, re.M)
    assert re.search(r'^\s*2 skipped\s*$', raw, re.M)
    lines = re.findall(r'^\s+(✓|✘|-)\s+(\d+)\s+\[(chromium|firefox|webkit)\]', raw, re.M)
    assert len(lines) == 1128
    assert Counter(symbol for symbol, _, _ in lines) == {'✓': 1126, '-': 2}
    assert len({number for _, number, _ in lines}) == 1128
    assert Counter(browser for _, _, browser in lines) == {'chromium': 376, 'firefox': 376, 'webkit': 376}
    initial = (BASE / 'domternal-n10c-free-breaks-browser.log').read_text()
    assert 'Running 96 tests using 1 worker' in initial
    assert re.search(r'^\s*24 failed\s*$', initial, re.M)
    assert re.search(r'^\s*72 passed \(', initial, re.M)
    initial_failures = re.findall(r'^\s+✘\s+\d+\s+\[(chromium|firefox|webkit)\].*$', initial, re.M)
    assert Counter(initial_failures) == {'chromium': 8, 'firefox': 8, 'webkit': 8}
    for line in re.findall(r'^\s+✘\s+\d+\s+\[(?:chromium|firefox|webkit)\].*$', initial, re.M):
        assert 'direct break styles reset inherited bold italic and vertical position' in line
    coverage = (BASE / 'domternal-n10c-free-coverage.log').read_text()
    assert re.search(r'Test Files\s+36 passed \(36\)', coverage)
    assert re.search(r'Tests\s+1253 passed \(1253\)', coverage)
    for line in ['Statements   : 93.76% ( 3697/3943 )', 'Branches     : 90.92% ( 3046/3350 )',
                 'Functions    : 97.92% ( 378/386 )', 'Lines        : 98.8% ( 2900/2935 )']:
        assert line in coverage
    initial_types = (BASE / 'domternal-n10c-free-types.log').read_text()
    assert initial_types.count('error TS2322:') == 3
    assert 'JSONMark' in initial_types and 'JSONAttribute' in initial_types
    for path in ['domternal-n10c-free-types-final.log', 'domternal-n10c-free-lint.log',
                 'domternal-n10c-e2e-types-verified.log', 'domternal-n10c-e2e-lint-final.log']:
        assert (BASE / path).read_text() == '', (path, 'expected clean recorded log')
    api = (BASE / 'domternal-n10c-free-api.log').read_text()
    assert '# pass 33' in api and '# fail 0' in api
    assert '29 entries match committed snapshots' in api
    ssr = (BASE / 'domternal-n10c-free-ssr.log').read_text()
    assert '74 module loads across 39 entries evaluate cleanly in Node' in ssr
    build = (BASE / 'domternal-n10c-free-build.log').read_text()
    for kind in ('CJS', 'ESM', 'DTS'):
        assert re.search(kind + r'.*Build success', build)
    return {
        'initialBrowser': {'total': 96, 'passed': 72, 'failed': 24,
            'reason': 'The test expected a descendant vertical-align:baseline to remove an ancestor superscript box. The corrected expectation retains that ancestor; a separate same-owner baseline scenario was added.',
            'finalNewCases': 120, 'newOwnerBaselineCases': 24,
            'preservedTraceDirectory': '/private/tmp/domternal-n10c-free-breaks-first-traces',
            'traceArchiveCopiedIntoRepository': False},
        'initialTypes': {'errors': 3, 'code': 'TS2322',
            'reason': 'The integration test helper used Record<string, unknown> instead of the public JSONMark and JSONAttribute types.',
            'finalRecordedLogEmpty': True},
        'unit': {'files': 36, 'passed': 1253,
            'coverage': {'statements': 93.76, 'branches': 90.92, 'functions': 97.92, 'lines': 98.8}},
        'finalChecks': {'packageTypes': 'parent-reported-exit-0-and-empty-log',
            'packageLint': 'parent-reported-exit-0-and-empty-log',
            'e2eTypes': 'parent-reported-exit-0-and-empty-log',
            'e2eLint': 'parent-reported-exit-0-and-empty-log',
            'packageBuild': 'CJS, ESM and DTS success recorded',
            'apiSurface': '33 tests; 29 snapshot entries and 10 locale entries',
            'ssr': '74 module loads across 39 entries'},
    }

def verify_all():
    snapshot = frozen.verify_snapshot()
    report = json.loads(REPORT.read_text())
    for path in [*frozen.SUITES[:-1], 'e2e/paste-cleanup-fixture/entry.mjs',
                 'e2e/paste-cleanup-fixture/index.html', 'e2e/paste-cleanup-fixture/vite.config.mjs', 'e2e/fixtures.ts', 'e2e/fixtures/vite.config.mjs']:
        from subprocess import check_output
        assert check_output(['git', 'show', snapshot['gitHead'] + ':' + path], cwd=ROOT) == (ROOT / path).read_bytes(), ('Existing fixture or suite changed', path)
    outcomes = verify_report(report)
    preflight = verify_logs(report)
    artifacts = [artifact(REPORT, 'Final Playwright JSON report'), artifact(LOG, 'Final raw browser log')]
    for name, role in [
        ('domternal-n10c-free-breaks-browser.log', 'Initial browser assertion failures'),
        ('domternal-n10c-free-coverage.log', 'Final package unit coverage'),
        ('domternal-n10c-free-types.log', 'Initial test helper TypeScript errors'),
        ('domternal-n10c-free-types-final.log', 'Final package TypeScript'),
        ('domternal-n10c-free-lint.log', 'Final package ESLint'),
        ('domternal-n10c-free-build.log', 'Final cleanup package build'),
        ('domternal-n10c-free-api.log', 'Public API surface gate'),
        ('domternal-n10c-free-ssr.log', 'SSR import gate'),
        ('domternal-n10c-e2e-types-verified.log', 'Final E2E TypeScript'),
        ('domternal-n10c-e2e-lint-final.log', 'Final E2E ESLint'),
    ]:
        artifacts.append(artifact(BASE / name, role))
    return {
        'kind': 'domternal-free-styled-breaks-qualification', 'version': 1,
        'verifiedAt': datetime.now(timezone.utc).isoformat(),
        'qualification': {
            'scope': 'Built Free cleanup and real vanilla, React, Vue and Angular wrapper integration on Chromium, Firefox and WebKit.',
            'newStyledBreakCases': 120, 'existingRegressionCases': 1008,
            'newCasesUseSyntheticClipboardEvents': True, 'nativeOfficeCapture': False,
            'legacyNativeClipboardCase': {'scope': 'Chromium copies and pastes synthetic content within the editor.', 'passed': 1, 'skipped': 2},
            'claims': ['Full expected semantic document after paste, exact document and selection Undo/Redo, and serialized HTML reload.',
                'Preserve and adapt policies, textless styled breaks, inherited typography, direct bold/italic reset, ancestor script retention and same-owner script reset.',
                'Internal clipboard bypass and visible unsupported-destination feedback for break-only source.'],
            'limitations': ['No Word, Google Docs or LibreOffice source capture or source fidelity claim.',
                'No performance, screenshot/layout, Pro DOCX converter or worker qualification.',
                'Browser version strings were not queried during this matrix; project names identify the browser engines.',
                'The fixture uses its own minimal CSS, not the full production theme stylesheet.',
                'Canonical document comparison removes generated block IDs and sorts mark order; Undo/Redo compares the full original snapshots.',
                'Existing tests named native in the image suites use synthetic ClipboardEvents, not the operating-system clipboard.'],
        },
        'run': {'startTime': report['stats']['startTime'], 'durationMs': report['stats']['duration'],
            'total': 1128, 'passed': 1126, 'skipped': 2, 'failed': 0, 'flaky': 0, 'retries': 0,
            'workers': 1, 'playwrightVersion': report['config']['version'],
            'commandedNode': {'path': '$HOME/.nvm/versions/node/v22.23.2/bin/node', 'version': 'v22.23.2',
                'provenance': 'Parent recorded the executable selected by the command PATH; the Playwright report does not itself record the Node version.'},
            'command': 'PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH PLAYWRIGHT_JSON_OUTPUT_NAME=/private/tmp/domternal-n10c-free-matrix.json pnpm exec playwright test --config e2e/paste-cleanup.config.ts --reporter=list,json',
            'projects': [{ 'project': project, 'total': 376,
                'passed': sum(row['project'] == project and row['status'] == 'passed' for row in outcomes),
                'skipped': sum(row['project'] == project and row['status'] == 'skipped' for row in outcomes),
                'newStyledBreakCases': 40 } for project in inventory.PROJECTS],
            'suites': [{'file': file, 'total': count} for file, count in sorted(Counter(row['file'] for row in outcomes).items())]},
        'preflight': preflight,
        'verification': {'expectedCaseInventory': 'Independently authored from the frozen six suite declarations before the final report existed.',
            'caseInventorySha256': frozen.digest(frozen.canonical(sorted(inventory.expected_cases()))),
            'sourceSnapshotTiming': 'Captured while the full matrix was running and the parent held the source and built-artifact freeze. Rechecked against disk after completion.',
            'checks': ['Exact 1128 unique project/file/describe/title keys.', 'Exactly one attempt for each test and no run-level or result errors.',
                'Exactly the two declared native-clipboard permission skips, in Firefox and WebKit.',
                'Project configuration, repeat count, retry policy, suite inventory and raw result counts.',
                'All five preexisting suites and shared fixture inputs are byte-equal to the captured Git HEAD.',
                'All 321 selected repository and built-artifact SHA256 hashes and inventory membership.',
                'Final package coverage, public API and SSR log summaries, plus retained initial failures.']},
        'frozenInputs': snapshot, 'artifacts': artifacts, 'cases': outcomes,
    }

if __name__ == '__main__':
    evidence = verify_all()
    destination = BASE / 'domternal-n10c-free-verified-evidence.json'
    destination.write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps({'verified': True, 'total': evidence['run']['total'],
        'passed': evidence['run']['passed'], 'skipped': evidence['run']['skipped'],
        'files': len(evidence['frozenInputs']['inventory']),
        'inventorySha256': evidence['frozenInputs']['inventorySha256'],
        'reportSha256': evidence['artifacts'][0]['sha256'],
        'scratchEvidence': str(destination)}, indent=2))
