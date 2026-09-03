#!/usr/bin/env python3
"""Persist only independently verified completed Free N12 qualification evidence."""
import collections
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import runpy
import subprocess

ROOT = Path('$HOME/Documents/Domternal/domternal')
TMP = Path('/private/tmp')
api = runpy.run_path(str(TMP / 'domternal-n12-verify-evidence.py'))
artifact = api['artifact']
canonical = api['canonical']
digest = api['digest']
verify = api['verify_run']
flatten = api['flatten']


def verify_preflight():
    path = TMP / 'domternal-n12-markers-preflight.json'
    report = json.loads(path.read_text())
    rows = flatten(report)
    assert len(rows) == 204 and report['errors'] == []
    assert report['stats']['expected'] == 126 and report['stats']['unexpected'] == 78
    assert report['stats']['skipped'] == 0 and report['stats']['flaky'] == 0
    failures = collections.Counter()
    for row in rows:
        assert len(row['test']['results']) == 1
        result = row['test']['results'][0]
        assert result['retry'] == 0
        if result['status'] == 'failed':
            message = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', result['error']['message'])
            if 'element(s) not found' in message:
                assert row['describe'].startswith('vanilla:')
                failures['vanilla-fixture-mount-class'] += 1
            elif 'Expected substring: "listStyleType"' in message:
                assert row['title'] == 'partial internal copy preserves marker context through an ordered range replacement'
                assert 'list-style-type: upper-roman' in message
                failures['internal-copy-selection-did-not-exercise-context'] += 1
            elif 'Received: null' in message and 'subsequent typing' in row['title']:
                failures['unique-id-explicit-typing-marks'] += 1
            else:
                raise AssertionError('Unclassified preflight failure')
        else:
            assert result['status'] == 'passed'
    assert failures == {'vanilla-fixture-mount-class': 51, 'internal-copy-selection-did-not-exercise-context': 9,
                        'unique-id-explicit-typing-marks': 18}
    raw = (TMP / 'domternal-n12-markers-preflight.log').read_text()
    assert re.search(r'^\s*78 failed\b', raw, re.M) and re.search(r'^\s*126 passed\b', raw, re.M)
    return {'total': 204, 'passed': 126, 'failed': 78, 'skipped': 0, 'flaky': 0,
            'failureGroups': [
                {'cases': 51, 'kind': 'fixture', 'reason': 'The vanilla mount lacked the dm-editor class required by the newly enabled production theme and test selector. The fixture now declares the same class explicitly.'},
                {'cases': 9, 'kind': 'fixture-selection', 'reason': 'The initial selection copied the actual ordered-list wrapper with data-pm-slice="3 3 []", so it did not exercise marker attributes in the internal slice context. The corrected fixture contains one SOURCEA item and selects its text range 0 through 7. The assertion still requires listStyleType and upper-roman in the serialized slice context; it was not relaxed to a CSS-only check.'},
                {'cases': 18, 'kind': 'production', 'reason': 'UniqueID ID-only appended steps cleared explicit stored typing marks after list lift. The fix restores the prior explicit marks, including an empty set, after those steps.'}],
            'traceDirectory': '/private/tmp/domternal-n12-markers-preflight-traces',
            'traceFilesCopiedIntoRepository': False}


def main():
    snapshot = api['verify_snapshot']()
    assert len(snapshot['inventory']) == 784
    prior = ROOT / 'e2e/paste-cleanup-results/2026-09-27-styled-breaks.json'
    assert prior.read_bytes() == subprocess.check_output(['git', 'show', snapshot['gitHead'] + ':' + str(prior.relative_to(ROOT))], cwd=ROOT)
    runs = {kind: verify(kind, TMP / f'{prefix}.json', TMP / f'{prefix}.log')
            for kind, prefix in [('paste', 'domternal-n12-free-matrix'), ('legacy', 'domternal-n12-list-editing')]}
    for prefix in ['domternal-n12-free-matrix', 'domternal-n12-list-editing', 'domternal-n12-markers-final']:
        assert (TMP / f'{prefix}.done').read_text().strip() == '0', f'{prefix} exit status'
    focus = json.loads((TMP / 'domternal-n12-markers-final.json').read_text())
    focused_rows = flatten(focus)
    expected_focus = [row for row in api['expected']('paste')[1] if row['file'] == 'paste-list-markers.browser.ts']
    assert [(api['key'](r), r['id']) for r in focused_rows] == [(api['key'](r), r['id']) for r in expected_focus]
    listed = api['expected']('paste')[0]['config']
    focus_expected = dict(listed)
    focus_expected['projects'] = [project | {'outputDir': '/private/tmp/domternal-n12-markers-final-traces', 'metadata': project.get('metadata', {}) | {'actualWorkers': 1}} for project in listed['projects']]
    for field in ['workers', 'projects', 'retries', 'repeatEach', 'forbidOnly', 'shard', 'grep', 'grepInvert']:
        assert focus['config'].get(field) == focus_expected.get(field)
    assert focus['errors'] == [] and focus['stats']['expected'] == 204
    assert all(focus['stats'][key] == 0 for key in ['unexpected', 'skipped', 'flaky'])
    for row in focused_rows:
        t = row['test']; assert row['ok'] and t['expectedStatus'] == 'passed' and t['status'] == 'expected'
        assert len(t['results']) == 1 and t['results'][0]['status'] == 'passed' and t['results'][0]['retry'] == 0
        assert not t['results'][0].get('error') and not t['results'][0].get('errors')
    focuslog = (TMP / 'domternal-n12-markers-final.log').read_text()
    assert re.search(r'^\s*204 passed\b', focuslog, re.M)
    initial = verify_preflight()
    # These checks were executed against the final frozen build without rebuilding it.
    gate_paths = [('Final bundle-size gate', 'domternal-n12-free-bundle-size-release.log'),
                  ('Final E2E TypeScript', 'domternal-n12-free-e2e-types-release.log'),
                  ('Final changed E2E ESLint', 'domternal-n12-free-e2e-lint-release.log')]
    assert '[bundle-size] OK' in (TMP / gate_paths[0][1]).read_text()
    assert not (TMP / gate_paths[2][1]).read_text().strip()
    for name in ['core', 'block', 'paste']:
        assert 'All good!' in (TMP / f'domternal-n12-{name}-publint.log').read_text()
        assert 'No problems found' in (TMP / f'domternal-n12-{name}-attw.log').read_text()
        for tool in ['publint', 'attw', 'release-pack']:
            gate_paths.append((f'Final {name} {tool}', f'domternal-n12-{name}-{tool}.log'))
    gates = [{'name': name, 'exitCode': 0, 'execution': 'Observed by the independent verification agent; no build or download.'}
             for name in ['bundle-size', 'E2E TypeScript', 'changed E2E ESLint',
                          'Core publint strict', 'Core ATTW strict', 'BlockControls publint strict',
                          'BlockControls ATTW strict', 'PasteCleanup publint strict', 'PasteCleanup ATTW strict']]
    artifacts = [artifact(TMP / f'{prefix}.{suffix}', role)
                 for prefix, role_prefix in [('domternal-n12-free-matrix', 'Final full paste'),
                                            ('domternal-n12-list-editing', 'Final legacy list'),
                                            ('domternal-n12-markers-final', 'Final focused marker'),
                                            ('domternal-n12-markers-preflight', 'Initial focused marker failures')]
                 for suffix, role in [('json', f'{role_prefix} JSON report'), ('log', f'{role_prefix} raw log')]]
    artifacts += [artifact(TMP / filename, role) for role, filename in gate_paths]
    artifacts += [artifact(TMP / filename, role) for filename, role in [
        ('domternal-n12-free-gates.json', 'Parent initial release gate outcomes, including documented failures'),
        ('domternal-n12-free-gates-test-bundle-size.log', 'Initial bundle gate README claim mismatch'),
        ('domternal-n12-free-gates-test-package-artifacts.log', 'Initial packed-size budget failure'),
        ('domternal-n12-free-package-artifacts-final.log', 'Reviewed package-artifact policy rerun'),
        ('domternal-n12-free-build-final.log', 'Parent final full workspace build'),
        ('domternal-n12-free-typecheck-final.log', 'Parent final actual pnpm workspace typecheck'),
        ('domternal-n12-free-workspace-coverage.log', 'Parent full workspace coverage before the final UniqueID correction'),
        ('domternal-n12-free-coverage-reports.log', 'Parent check that all required coverage reports exist')]]
    artifacts += [artifact(TMP / filename, role) for filename, role in [
        ('domternal-n12-free-frozen-inputs.json', 'Pre-run source and built-artifact snapshot'),
        ('domternal-n12-paste-list-inventory.json', 'Read-only paste discovery'),
        ('domternal-n12-legacy-list-inventory.json', 'Read-only legacy discovery'),
        ('domternal-n12-verify-evidence.py', 'Independent report and snapshot verifier'),
        ('domternal-n12-assemble-evidence.py', 'Independent evidence assembler')]]
    artifacts.append(artifact(prior, 'Unchanged historical styled-breaks evidence used for prior case identities'))
    for path in sorted((TMP / 'domternal-n12-free-release-pack').glob('*.tgz')):
        artifacts.append(artifact(path, 'Locally packed frozen build checked by publint and ATTW'))
    for kind, run in runs.items():
        prefix = 'domternal-n12-free-matrix' if kind == 'paste' else 'domternal-n12-list-editing'
        config = 'e2e/paste-cleanup.config.ts' if kind == 'paste' else 'e2e/list-editing.config.ts'
        run['command'] = f'PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH PLAYWRIGHT_JSON_OUTPUT_NAME=/private/tmp/{prefix}.json pnpm exec playwright test --config {config} --reporter=list,json --output=/private/tmp/{prefix}-traces > /private/tmp/{prefix}.log 2>&1'
        run['commandedNode'] = {'path': '$HOME/.nvm/versions/node/v22.23.2/bin/node', 'version': 'v22.23.2',
                                'provenance': 'Parent-recorded executable selected by PATH; not reported independently by Playwright.'}
        run['projects'] = [{'project': project, **{status: sum(row['project'] == project and row['status'] == status for row in run['cases'])
                                                    for status in ['passed', 'skipped']}}
                           for project in sorted({row['project'] for row in run['cases']})]
        run['suites'] = [{'file': file, 'total': count} for file, count in sorted(collections.Counter(row['file'] for row in run['cases']).items())]
    result = {'kind': 'domternal-free-list-markers-qualification', 'version': 1,
              'verifiedAt': datetime.now(timezone.utc).isoformat(),
              'qualification': {
                  'scope': 'Built Free Core, BlockControls and PasteCleanup with real vanilla, React, Vue and Angular wrappers in Chromium, Firefox and WebKit.',
                  'newMarkerCases': 204, 'existingPasteRegressionCases': 1128, 'legacyListEditingCases': 360,
                  'nativeOfficeCapture': False, 'newClipboardCasesUseSyntheticClipboardEvents': True,
                  'claims': ['Explicit ordered and bullet marker semantics survive preserve/adapt cleanup and HTML reload.',
                             'Office-style list reconstruction retains admitted decimal and bullet classes or preserves visible markers when the destination schema cannot represent them.',
                             'Marker-conflicting list operations preserve boundaries, authored document JSON, caret positions and exact document/selection Undo and Redo snapshots.',
                             'Default-null markers keep theme depth styling; explicit markers remain fixed. Task checked state remains independent.',
                             'The final build passes the unchanged discovered legacy list case set in all four wrappers and three browsers.'],
                  'limitations': ['No Word, Google Docs or LibreOffice clipboard capture or native Office fidelity claim.',
                                  'The one preexisting Chromium OS-clipboard case copies synthetic editor content; Firefox and WebKit intentionally skip that case.',
                                  'Browser versions were not queried by this matrix; engine names come from the Playwright projects.',
                                  'No performance or Pro DOCX converter/worker qualification is established by these browser results.',
                                  'The list-marker query enables the production theme. Other shared fixture modes retain their existing styling.',
                                  'Canonical document assertions remove generated IDs and sort mark order; Undo/Redo compares complete operation snapshots.',
                                  'The frozen inventory is an explicit source/build selection, not a complete dependency graph or operating-system snapshot.']},
              'runs': {kind: {k:v for k,v in run.items() if k != 'cases'} for kind,run in runs.items()},
              'preflight': {'initialFocusedBrowser': initial,
                            'releasePolicyCorrections': {
                                'bundleClaims': 'The initial bundle-size gate rejected stale Core README size claims. The updated reproducible claims are about 64 KiB own code and 145 KiB total; the final actual gate reports 65141 and 148198 gzip bytes.',
                                'artifactBudget': 'PasteCleanup packed size 767675 exceeded the old 730000 ceiling. Independent tarball and source-map audit found only expected production files and no new dependency or test/planning leak. The reviewed ceiling is 845000 with the existing 8000 additional-locale allowance; the final package artifact check passed.',
                                'buildWarnings': 'Final demo builds retained Angular initial-bundle and Vite large-chunk warnings; build/typecheck exited successfully. No zero-warning claim is made.'},
                            'finalFocusedBrowser': {'total': 204, 'passed': 204, 'failed': 0, 'flaky': 0, 'retries': 0,
                                                    'startTime': focus['stats']['startTime'], 'durationMs': focus['stats']['duration']}},
              'releaseChecks': gates,
              'verification': {'snapshotTiming': 'Parent froze source and builds before the final focused and complete matrices; independently rechecked after completion.',
                               'checks': ['Exact unique project/file/describe/title identities and matching Playwright IDs against read-only discovery.',
                                          'Previous 1128 paste identities preserved, plus 204 independently named new marker cases and 360 legacy list cases.',
                                          'Exactly one attempt per case, no retries, unexpected results, flaky results, result errors or run errors.',
                                          'Exactly the two declared native clipboard skips, no new skip or fixme annotations.',
                                          'Unchanged project/filter/repeat/retry configuration and declared trace-only output directory overrides.',
                                          'All 784 source/build input hashes and independently reconstructed membership.',
                                          'Raw log counts and final process exit statuses agree with each completed JSON report.',
                                          'Initial 78 failures retained and separated into 51 mount-fixture, 9 selection-fixture and 18 production failures.']},
              'frozenInputs': snapshot, 'artifacts': artifacts,
              'cases': [row | {'run': kind} for kind,run in runs.items() for row in run['cases']]}
    output = ROOT / 'e2e/paste-cleanup-results/2026-09-27-list-markers.json'
    with output.open('x') as f: json.dump(result, f, ensure_ascii=False, indent=2); f.write('\n')
    jsonhash = digest(output.read_bytes())
    md = f'''# Free list-marker qualification\n\nThe final frozen build passed 1,690 of 1,692 browser cases. The two intentional skips are the preexisting Firefox and WebKit OS-clipboard permission controls. The final paste matrix covers 1,332 cases, including 204 new list-marker cases; a separate matrix covers 360 legacy list-editing cases. All four wrappers run in Chromium, Firefox and WebKit with zero retries, failures or flaky results.\n\nThe new cases cover explicit decimal/alpha/Roman and disc/circle/square markers, null versus explicit defaults with the production theme, Office-style reconstruction, legacy schema fallback, internal partial copy, marker-conflicting paste and list commands, explicit typing marks, task-state separation and exact history restoration. Manually authored caret checks include 20/19 after paste, 8/15 after Tab, 10 after Shift-Tab and 9/10 before/after typing. Generated IDs are excluded only from canonical semantic document comparisons; history comparisons retain the complete snapshots.\n\nThese are synthetic documents and clipboard events. This is not a native Word, Google Docs or LibreOffice capture, a visual-fidelity claim, a performance result or Pro import-worker evidence. The existing Chromium OS-clipboard case copies synthetic editor content. Browser version strings were not collected by this suite. Node v22.23.2 is the parent-recorded command runtime; Playwright reports version {{runs['paste']['playwrightVersion']}}.\n\n## Initial failures and corrections\n\nThe initial focused run completed all 204 cases: 126 passed and 78 failed. Fifty-one failures came from the vanilla fixture's missing `dm-editor` mount class. Nine failures exposed a fixture selection that copied the actual ordered-list wrapper with `data-pm-slice="3 3 []"`, rather than exercising marker attributes in the internal slice context. The corrected seed contains one `SOURCEA` item and selects its text range 0 through 7. The assertion still requires `listStyleType` and `upper-roman` in that context; it was not relaxed to a CSS-only check. Eighteen failures exposed a production issue: UniqueID ID-only appended steps cleared explicit stored typing marks, including an explicitly empty set. The fixture/assertion corrections and narrow UniqueID fix are included in the frozen final build. The focused rerun passed all 204 cases before the full qualification. Raw failed reports and trace locations remain recorded; traces are not copied into this repository.\n\n## Verification and release checks\n\nIndependent verification checked exact case identities, one attempt per case, configured retries and projects, raw log counts, process exit statuses, both expected skip reasons and all 784 selected source/build hashes. Inventory membership includes package source and built files, framework demos, test fixtures, lockfiles, README claims, package artifact policy and cleanup TypeScript config. This is an explicit inventory, not a full dependency or OS snapshot.\n\nThe final frozen tarballs of Core, BlockControls and PasteCleanup pass installed publint and ATTW strict checks. Final bundle-size, E2E TypeScript and scoped changed-file ESLint checks also pass without rebuilding. The archive checks are local and publish nothing. The earlier stale Core README size claims were corrected to the measured 64/145 KiB scale. A separate tarball audit justified the reviewed PasteCleanup packed-size ceiling of 845000 bytes for an actual 767675 byte archive, with the fixed additional-locale allowance unchanged. Final demo builds still report nonfatal bundle/chunk-size warnings. Broader parent-run unit/build/release results remain separately logged and are not inferred from this browser matrix.\n\n[Detailed evidence](./2026-09-27-list-markers.json) records every case, selected input hash, report/raw-log digest and local artifact path.\n\n- JSON SHA256: `{jsonhash}`\n- Frozen inventory SHA256: `{snapshot['inventorySha256']}`\n- Paste case inventory SHA256: `{runs['paste']['caseInventorySha256']}`\n- Legacy case inventory SHA256: `{runs['legacy']['caseInventorySha256']}`\n'''
    md = md.replace("{runs['paste']['playwrightVersion']}", runs['paste']['playwrightVersion'])
    mdpath=output.with_suffix('.md'); mdpath.write_text(md)
    print(json.dumps({'jsonSha256': jsonhash, 'mdSha256': digest(mdpath.read_bytes()),
                      'frozenInputFiles':len(snapshot['inventory']), 'cases':1692, 'passed':1690,'skipped':2},indent=2))

if __name__ == '__main__': main()
