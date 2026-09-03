"""Independent fixed test inventory, authored from the frozen six suite declarations."""
FRAMEWORKS = ('vanilla', 'react', 'vue', 'angular')
PROJECTS = ('chromium', 'firefox', 'webkit')
NATIVE_TITLE = 'Chromium native clipboard preserves an editor copy through cleanup'

def expected_cases():
    cases = []
    def group(file, suffix, titles):
        for framework in FRAMEWORKS:
            for title in titles:
                cases.append((file, framework + ': ' + suffix, title))
    group('paste-cleanup.browser.ts', 'paste cleanup', [
        *[f'synthetic Office formatting uses {policy} policy and retains table geometry' for policy in ('preserve', 'adapt')],
        *[f'synthetic inherited typography uses {policy} policy with true mark resets' for policy in ('preserve', 'adapt')],
        'synthetic Office list metadata reconstructs a numbered start, nested bullet and restart',
        'synthetic Office numbering retains source start seven after an existing list starting at ten',
        'synthetic Office restarts remain sibling lists after an existing numbered item',
        'a schema without list nodes retains visible synthetic Office markers and reports the unsupported list',
        'standalone normalization and paste do not execute markup or request its resources',
        *[f'rejects excess {name} without changing the document or selection' for name in
          ('input length', 'plain-text complexity', 'HTML nesting', 'expanded table geometry')],
        'serialized internal copy preserves styles, regenerates copied IDs and supports undo',
        'mixed HTML and image File preserve text and insert one bounded data image',
        'plain text, Markdown and code-block paste retain their existing routing',
    ])
    cases.append(('paste-cleanup.browser.ts', '', NATIVE_TITLE))
    group('paste-feedback.browser.ts', 'paste feedback', [
        'correlates one accepted operation with normalization and presents a nonmodal warning',
        'blocks oversized content without inserting or reporting an applied operation',
        'preserves the selected content when cleaning removes every source node',
        'does not emit host updates or accepted receipts for a transaction veto',
        'reports committed content when a host observer throws after installation',
        'retains applied status if an earlier plugin destroys the editor before feedback observes it',
        'does not attribute a nested intercepted paste to a consumed outer operation',
        'clears the outer operation before a nested empty paste skips normalization',
        'maps public references around outside edits and expires them after interior edits',
        'repaints the existing notice with the official German catalog without changing focus or content',
        'supports application-owned feedback and keeps standalone HTML normalization free of editor effects',
    ])
    group('paste-assets.browser.ts', 'clipboard image preparation', [
        *[f'{route}: resolves explicit file placement once with exact Undo and Redo' for route in ('native', 'programmatic')],
        'keeps repeated explicit placements while reading one file',
        'pastes image-only clipboard files without invoking upload handlers',
        'does not append clipboard files already represented by a data image',
        'cancels pending work without placeholders, history entries or late insertion',
        *[f'rejects a stale target after {mutation}' for mutation in ('document-undo', 'selection-restore', 'read-only', 'image-policy')],
        'lets a newer plain paste win over a pending image paste',
        'rejects unknown image associations without reading or losing selected content',
        'reports an explicitly permitted image omission while inserting the text',
        'honors earlier HTML transformations once during prepared replay',
    ])
    for title in [
        'updates pending translations and keeps cancellation distinct from dismissal',
        *[f'rejects {policy} image destination before file reads' for policy in ('missing', 'no-base64')],
        'enforces the configured byte allowance before reading a file',
        'rejects a misleading image MIME type after inspecting its bytes',
        *[f'keeps an honest receipt when a host uses {lifecycle}' for lifecycle in ('veto', 'throw-update')],
    ]:
        cases.append(('paste-assets.browser.ts', 'clipboard image preparation boundaries', title))
    group('paste-resolver.browser.ts', 'persistent clipboard resolver', [
        *[f'{route}: applies {outcome} images once with exact Undo and Redo' for outcome in ('created', 'existing') for route in ('native', 'programmatic')],
        *[f'deduplicates {files} identical File source(s) while preserving repeated placements' for files in (1, 2)],
        'resolves image-only files without the legacy upload handler',
        *[f'compensates {outcome} before any content or history is applied' for outcome in ('forbidden', 'partial-failure')],
        *[f'cancels {stage} promptly and compensates only after actual adapter settlement' for stage in ('before-creation', 'after-creation')],
        'delivers cleanup recovery after destruction without delaying the terminal paste result',
        *[f'rejects a stale {mutation} target and compensates the late creation' for mutation in ('document-undo', 'image-policy')],
        'keeps the newer paste when an older resolver finishes late',
        'retains uncertain resources when a host inserts an untagged image and throws',
        *[f'retains accepted resources after {observer}' for observer in ('throw-update', 'destroy-throw')],
        'retains uncertain resources after a filter veto without changing history',
        *[f'preserves text when source data images are forbidden, diagnostic budget {diagnostics}' for diagnostics in ('default', 'one')],
        *[f'{route}: resolves inline raster bytes without a File or public matching reference' for route in ('native', 'programmatic')],
        'leaves an unmatched duplicate File unread when inline bytes identify the image',
        'deduplicates repeated inline encodings while preserving placement alternatives and geometry',
        'deduplicates inline bytes with an explicitly matched CID File without exposing the inline source',
        *[f'enforces the {allowance} shared inline and File byte allowance before binary reads' for allowance in ('exact', 'exceeded')],
        *[f'saves and reloads resolved inline images through {format} using only their persistent HTTP source' for format in ('JSON', 'HTML')],
        'cancels an inline source after registration and releases only after the resolver settles',
        'compensates cancellation from a recovery observer before exposing HTML',
    ])
    group('paste-destination.browser.ts', 'paste destination capabilities', [
        *[f'missing bold produces a truthful warning and readable text through {transport}' for transport in ('synthetic-event', 'programmatic')],
        'default heading levels warn for level five while retaining its text',
        'the full destination preserves level five without a warning',
        'the full destination retains supported formatting, list structure and table headers',
        'adapt removes intentional typography with information only on a minimal destination',
        *[f'unsupported tables preserve document, selection and history through {transport}' for transport in ('synthetic-event', 'programmatic')],
        'a full diagnostic allowance cannot hide the independent table refusal',
    ])
    group('paste-breaks.browser.ts', 'formatted paste breaks', [
        *[f'{formatting}: {name}' for formatting in ('preserve', 'adapt') for name in (
            'leading consecutive and trailing breaks carry all marks and inherited typography',
            'break-only runs retain distinct semantic marks without character text',
            'direct break styles reset bold and italic while retaining the ancestor script box',
            'baseline on the script owner resets that mark without changing its sibling',
        )],
        'internal clipboard bypass preserves styled breaks under adapt policy',
        'a break-only unsupported script mark warns through the real destination',
    ])
    assert len(cases) == len(set(cases)) == 376
    assert sum(row[0] == 'paste-breaks.browser.ts' for row in cases) == 40
    return {(project, *row) for project in PROJECTS for row in cases}

if __name__ == '__main__':
    from collections import Counter
    cases = expected_cases()
    print(len(cases), dict(sorted(Counter(row[1] for row in cases).items())))
