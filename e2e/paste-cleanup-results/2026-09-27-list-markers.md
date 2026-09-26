# Free list-marker qualification

The final frozen build passed 1,690 of 1,692 browser cases. The two intentional skips are the preexisting Firefox and WebKit OS-clipboard permission controls. The final paste matrix covers 1,332 cases, including 204 new list-marker cases; a separate matrix covers 360 legacy list-editing cases. All four wrappers run in Chromium, Firefox and WebKit with zero retries, failures or flaky results.

The new cases cover explicit decimal/alpha/Roman and disc/circle/square markers, null versus explicit defaults with the production theme, Office-style reconstruction, legacy schema fallback, internal partial copy, marker-conflicting paste and list commands, explicit typing marks, task-state separation and exact history restoration. Manually authored caret checks include 20/19 after paste, 8/15 after Tab, 10 after Shift-Tab and 9/10 before/after typing. Generated IDs are excluded only from canonical semantic document comparisons; history comparisons retain the complete snapshots.

These are synthetic documents and clipboard events. This is not a native Word, Google Docs or LibreOffice capture, a visual-fidelity claim, a performance result or Pro import-worker evidence. The existing Chromium OS-clipboard case copies synthetic editor content. Browser version strings were not collected by this suite. Node v22.23.2 is the parent-recorded command runtime; Playwright reports version 1.58.2.

## Initial failures and corrections

The initial focused run completed all 204 cases: 126 passed and 78 failed. Fifty-one failures came from the vanilla fixture's missing `dm-editor` mount class. Nine failures exposed a fixture selection that copied the actual ordered-list wrapper with `data-pm-slice="3 3 []"`, rather than exercising marker attributes in the internal slice context. The corrected seed contains one `SOURCEA` item and selects its text range 0 through 7. The assertion still requires `listStyleType` and `upper-roman` in that context; it was not relaxed to a CSS-only check. Eighteen failures exposed a production issue: UniqueID ID-only appended steps cleared explicit stored typing marks, including an explicitly empty set. The fixture/assertion corrections and narrow UniqueID fix are included in the frozen final build. The focused rerun passed all 204 cases before the full qualification. Raw failed reports and trace locations remain recorded; traces are not copied into this repository.

## Verification and release checks

Independent verification checked exact case identities, one attempt per case, configured retries and projects, raw log counts, process exit statuses, both expected skip reasons and all 784 selected source/build hashes. Inventory membership includes package source and built files, framework demos, test fixtures, lockfiles, README claims, package artifact policy and cleanup TypeScript config. This is an explicit inventory, not a full dependency or OS snapshot.

The final frozen tarballs of Core, BlockControls and PasteCleanup pass installed publint and ATTW strict checks. Final bundle-size, E2E TypeScript and scoped changed-file ESLint checks also pass without rebuilding. The archive checks are local and publish nothing. The earlier stale Core README size claims were corrected to the measured 64/145 KiB scale. A separate tarball audit justified the reviewed PasteCleanup packed-size ceiling of 845000 bytes for an actual 767675 byte archive, with the fixed additional-locale allowance unchanged. Final demo builds still report nonfatal bundle/chunk-size warnings. Broader parent-run unit/build/release results remain separately logged and are not inferred from this browser matrix.

[Detailed evidence](./2026-09-27-list-markers.json) records every case, selected input hash, report/raw-log digest and local artifact path.

- JSON SHA256: `4e28ceeee274e59cebf84512b28b3d685dcf925d6ce05f52e164cfeba54eda86`
- Frozen inventory SHA256: `a35be4e53c73d26ca722cbf12681c3bb4e7df98fe8956c764c4068a17f7e1248`
- Paste case inventory SHA256: `f6e0a2cfaacc5a46870aeca3a789fec4477ec53d6a14d2ed3ffc9ab38dcce70e`
- Legacy case inventory SHA256: `54ada46008598eecb9a2a640bbcb004fc884d4172603dfb24153900c8cb5d851`
