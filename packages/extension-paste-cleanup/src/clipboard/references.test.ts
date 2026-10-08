// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { Schema } from '@domternal/pm/model';
import { captureClipboard } from './capture.js';
import type { ClipboardSnapshot } from './capture.js';
import { createClipboardImageDestination } from './destination.js';
import type { ClipboardImageDestination } from './destination.js';
import { resolveClipboardImageBindings } from './references.js';
import type { ClipboardImageBinding, ClipboardImageReference, ClipboardReferenceLimits } from './references.js';

const limits: ClipboardReferenceLimits = {
  maxItems: 16, maxStringLength: 512, maxMetadataLength: 128, maxTextBytes: 1024,
  maxFileBytes: 1024, maxTotalFileBytes: 2048, maxClipboardBytes: 4096,
  maxPlacements: 16, maxBindings: 32, maxDiagnostics: 16,
  maxReferenceLength: 1024, maxDescriptionLength: 512, maxDimension: 10_000,
};

const target = new Schema({ nodes: {
  doc: { content: 'block+' }, text: { group: 'inline' }, paragraph: { group: 'block', content: 'inline*' },
  image: { group: 'block', attrs: { src: { default: null } } },
} });

function destination(overrides: { allowedMimeTypes?: readonly string[]; maxFileBytes?: number; allowEmbedded?: boolean } = {}): ClipboardImageDestination {
  const result = createClipboardImageDestination(target, {
    nodeTypeName: 'image', sourceAttribute: 'src', inline: false, allowEmbedded: true,
    allowedMimeTypes: ['image/png', 'image/jpeg'], maxFileBytes: 1024, policyVersion: 'test:1', ...overrides,
  }, { maxMetadataLength: 128, maxMimeTypes: 16, maxFileBytes: 1024 });
  if (result.status !== 'available') throw new Error('Expected destination');
  return result.destination;
}

function file(type = 'image/png', data = 'abc'): File {
  return new File([data], 'same-name.png', { type });
}

function capture(
  entries: readonly { kind: string; type: string; file?: File | null }[] = [{ kind: 'file', type: 'image/png', file: file() }],
  captureLimits: ClipboardReferenceLimits = limits,
): ClipboardSnapshot {
  const result = captureClipboard({
    items: entries.map(entry => ({ kind: entry.kind, type: entry.type, getAsFile: () => entry.file ?? null })),
    getData: (format: string) => format === 'text/html' ? '<p>' + 'x'.repeat(100) + '</p>' : '',
  } as unknown as DataTransfer, captureLimits);
  if (result.status !== 'captured') throw new Error('Expected captured clipboard');
  return result.snapshot;
}

function reference(placementId = 'a', rawReference = 'cid:0', options: Partial<ClipboardImageReference> = {}): ClipboardImageReference {
  return { placementId, rawReference, sourceOffset: 4, ...options };
}

function binding(placementId = 'a', itemIndex = 0): ClipboardImageBinding {
  return { placementId, itemIndex, evidence: { kind: 'host', matcherId: 'application:1' } };
}

function check(
  snapshot = capture(),
  references: readonly ClipboardImageReference[] = [reference()],
  bindings: readonly ClipboardImageBinding[] = [binding()],
  policy = destination(),
  cap = limits,
): ReturnType<typeof resolveClipboardImageBindings> {
  return resolveClipboardImageBindings(snapshot, references, bindings, policy, cap);
}

describe('explicit clipboard image bindings', () => {
  it('resolves only the explicit original item index and preserves private placement attributes', () => {
    const image = file();
    const snapshot = capture([{ kind: 'string', type: 'text/html' }, { kind: 'file', type: 'image/png', file: image }]);
    const source = reference('a', 'file:///private/word/image001.png', { alt: 'Description', width: 20.5, height: 40 });
    const result = check(snapshot, [source], [binding('a', 1)]);
    expect(result.status).toBe('checked');
    expect(result.diagnostics).toEqual([]);
    expect(result.matches).toEqual([{ reference: source, itemIndex: 1, file: image, fileSize: 3, mimeType: 'image/png' }]);
    expect(result.matches[0]?.reference).not.toBe(source);
  });

  it.each(['cid:0', 'cid:1', 'cid:photo@example.test', 'file:///same-name.png', 'same-name.png', ''])('does not infer a binding from %s', rawReference => {
    const result = check(capture(), [reference('a', rawReference)], []);
    expect(result.matches).toEqual([]);
    expect(result.diagnostics).toEqual([{ code: 'unbound-reference', placementId: 'a', offset: 4 }]);
  });

  it('does not let a verified profile label invent an item index or resolve another placement', () => {
    const snapshot = capture();
    const explicit: ClipboardImageBinding = { placementId: 'a', itemIndex: 0, evidence: { kind: 'verified-profile', profileId: 'synthetic-label-not-native-evidence' } };
    const result = check(snapshot, [reference('a'), reference('b', 'cid:0')], [explicit]);
    expect(result.matches.map(match => match.reference.placementId)).toEqual(['a']);
    expect(result.diagnostics).toEqual([{ code: 'unbound-reference', placementId: 'b', offset: 4 }]);
    expect(check(snapshot, [reference()], [{ ...explicit, itemIndex: 3 }]).matches).toEqual([]);
  });

  it('never uses names, file order, dimensions or one-to-one cardinality as evidence', () => {
    const first = file('image/png', 'first');
    const second = file('image/png', 'second');
    const snapshot = capture([{ kind: 'file', type: 'image/png', file: first }, { kind: 'file', type: 'image/png', file: second }]);
    const refs = [reference('a', 'same-name.png', { width: 1, height: 1 }), reference('b', 'same-name.png', { width: 1, height: 1 })];
    expect(check(snapshot, refs, []).matches).toEqual([]);
    const swapped = check(snapshot, refs, [binding('b', 0), binding('a', 1)]);
    expect(swapped.matches.map(match => match.file)).toEqual([second, first]);
  });

  it('keeps separate placements of one resource, coalesces identical bindings and never appends an unmatched file', () => {
    const image = file();
    const unused = file('image/jpeg');
    const snapshot = capture([{ kind: 'file', type: 'image/png', file: image }, { kind: 'file', type: 'image/jpeg', file: unused }]);
    const refs = [reference('a', 'one', { alt: 'First', width: 10 }), reference('b', 'one', { alt: 'Second', width: 20 })];
    const result = check(snapshot, refs, [binding('a'), binding('b'), binding('a')]);
    expect(result.matches).toHaveLength(2);
    expect(result.matches.map(match => [match.file, match.reference.alt, match.reference.width])).toEqual([
      [image, 'First', 10], [image, 'Second', 20],
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('rejects conflicting bindings for a placement independent of their order', () => {
    const snapshot = capture([{ kind: 'file', type: 'image/png', file: file() }, { kind: 'file', type: 'image/png', file: file() }]);
    for (const bindings of [[binding('a', 0), binding('a', 1)], [binding('a', 1), binding('a', 0)]]) {
      const result = check(snapshot, [reference()], bindings);
      expect(result.matches).toEqual([]);
      expect(result.diagnostics).toEqual([{ code: 'conflicting-binding', placementId: 'a', offset: 4 }]);
    }
  });

  it('does not choose a valid binding when another explicit binding for that placement is invalid', () => {
    for (const bindings of [[binding('a', 0), binding('a', 99)], [binding('a', 99), binding('a', 0)]]) {
      const result = check(capture(), [reference()], bindings);
      expect(result.matches).toEqual([]);
      expect(result.diagnostics).toEqual([{ code: 'invalid-binding', placementId: 'a', offset: 4 }]);
    }
  });

  it.each([-1, 0.5, Infinity, NaN, 1, Number.MAX_SAFE_INTEGER + 1])('diagnoses invalid item index %s', index => {
    const result = check(capture(), [reference()], [binding('a', index)]);
    expect(result.matches).toEqual([]);
    expect(result.diagnostics).toEqual([{ code: 'invalid-binding', placementId: 'a', offset: 4 }]);
  });

  it('keeps a missing file or a string item unresolved instead of selecting another file', () => {
    const snapshot = capture([{ kind: 'file', type: 'image/png', file: null }, { kind: 'string', type: 'text/html' }, { kind: 'file', type: 'image/png', file: file() }]);
    for (const index of [0, 1]) {
      const result = check(snapshot, [reference()], [binding('a', index)]);
      expect(result.matches).toEqual([]);
      expect(result.diagnostics).toEqual([{ code: 'file-unavailable', placementId: 'a', offset: 4 }]);
    }
  });

  it.each([
    ['image/png', 'image/jpeg', 'image-type-mismatch'],
    ['image/svg+xml', 'image/svg+xml', 'unsupported-image-type'],
    ['image/png', '', 'unsupported-image-type'],
    ['', 'image/png', 'unsupported-image-type'],
    ['image/jpg', 'image/jpeg', 'unsupported-image-type'],
    ['application/octet-stream', 'image/png', 'unsupported-image-type'],
    ['image/png;foo=bar', 'image/png', 'unsupported-image-type'],
  ] as const)('checks item MIME %s against File MIME %s', (type, fileType, code) => {
    const result = check(capture([{ kind: 'file', type, file: file(fileType) }]));
    expect(result.matches).toEqual([]);
    expect(result.diagnostics).toEqual([{ code, placementId: 'a', offset: 4 }]);
  });

  it('compares MIME tokens case-insensitively but does not inspect raster bytes', () => {
    const image = file('image/png', 'not a raster');
    const result = check(capture([{ kind: 'file', type: 'IMAGE/PNG', file: image }]));
    expect(result.matches[0]?.mimeType).toBe('image/png');
    expect(result.matches[0]?.file).toBe(image);
  });

  it('applies destination MIME and byte restrictions while leaving embedding decisions to the later session', () => {
    const snapshot = capture();
    expect(check(snapshot, [reference()], [binding()], destination({ allowedMimeTypes: ['image/jpeg'] })).diagnostics[0]?.code).toBe('unsupported-image-type');
    expect(check(snapshot, [reference()], [binding()], destination({ maxFileBytes: 2 })).diagnostics[0]?.code).toBe('image-size-limit');
    expect(check(snapshot, [reference()], [binding()], destination({ maxFileBytes: 3, allowEmbedded: false })).matches).toHaveLength(1);
  });

  it('never rereads File metadata, filenames or content after A1 capture', () => {
    const image = file();
    const snapshot = capture([{ kind: 'file', type: 'image/png', file: image }]);
    const fail = vi.fn(() => { throw new Error('File must not be reread'); });
    for (const name of ['name', 'type', 'size', 'arrayBuffer', 'stream', 'text', 'slice']) Object.defineProperty(image, name, { get: fail });
    const result = check(snapshot);
    expect(result.matches[0]?.file).toBe(image);
    expect(fail).not.toHaveBeenCalled();
  });

  it('revalidates captured aggregate and per-file ceilings before resolving placements', () => {
    const image = file();
    const snapshot = capture([{ kind: 'file', type: 'image/png', file: image }, { kind: 'file', type: 'image/png', file: image }]);
    for (const override of [
      { maxItems: 1 }, { maxStringLength: 2 }, { maxTextBytes: snapshot.textBytes - 1 },
      { maxFileBytes: 2 }, { maxTotalFileBytes: 5 }, { maxClipboardBytes: snapshot.textBytes + 5 },
      { maxMetadataLength: 3 },
    ]) {
      const result = check(snapshot, [reference()], [binding()], destination(), { ...limits, ...override });
      expect(result.status).toBe('rejected');
      expect(result.matches).toEqual([]);
      expect(result.diagnostics[0]?.code).toBe('input-limit');
    }
    expect(check(snapshot, [reference()], [binding()], destination(), { ...limits, maxClipboardBytes: snapshot.textBytes + 6 }).status).toBe('checked');
  });

  it('rejects a binding to a File the capture left out over its budgets, instead of reporting it unavailable', () => {
    const large = file('image/png', 'x'.repeat(40));
    const small = file();
    const snapshot = capture([{ kind: 'file', type: 'image/png', file: large }, { kind: 'file', type: 'image/png', file: small }], { ...limits, maxFileBytes: 16 });
    expect(snapshot.items[0]).toMatchObject({ file: null, fileSize: 40, overLimit: true });
    const result = check(snapshot, [reference('a'), reference('b')], [binding('a', 0), binding('b', 1)]);
    expect(result).toMatchObject({ status: 'rejected', reason: 'input-limit', matches: [] });
    expect(result.diagnostics).toEqual([{ code: 'input-limit' }]);
  });

  it('rejects a binding to an item past the item bound, and keeps an index past the clipboard invalid', () => {
    const entries = [{ kind: 'file', type: 'image/png', file: file() }, ...Array.from({ length: 4 }, () => ({ kind: 'string', type: 'text/plain' }))];
    const snapshot = capture(entries, { ...limits, maxItems: 2 });
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.itemCount).toBe(5);
    expect(check(snapshot, [reference()], [binding('a', 4)])).toMatchObject({ status: 'rejected', reason: 'input-limit' });
    const outside = check(snapshot, [reference()], [binding('a', 5)]);
    expect(outside.status).toBe('checked');
    expect(outside.hasInvalidBindings).toBe(true);
  });

  it('resolves the bound File while left-out items that no binding uses change nothing', () => {
    const image = file();
    const entries = [
      { kind: 'file', type: 'image/png', file: image },
      { kind: 'file', type: 'application/pdf', file: file('application/pdf', 'x'.repeat(40)) },
      ...Array.from({ length: 4 }, () => ({ kind: 'string', type: 'text/plain' })),
    ];
    const snapshot = capture(entries, { ...limits, maxItems: 3, maxFileBytes: 16 });
    expect(snapshot.items.map(entry => entry.overLimit)).toEqual([false, true, false]);
    const result = check(snapshot, [reference()], [binding('a', 0)]);
    expect(result.status).toBe('checked');
    expect(result.matches).toEqual([{ reference: reference(), itemIndex: 0, file: image, fileSize: 3, mimeType: 'image/png' }]);
    expect(result.diagnostics).toEqual([]);
  });

  it('rejects inconsistent captured counters or item indexes', () => {
    const snapshot = capture();
    for (const changed of [
      { ...snapshot, fileBytes: 2 }, { ...snapshot, textBytes: -1 }, { ...snapshot, fileBytes: Infinity },
      { ...snapshot, items: snapshot.items.map(entry => ({ ...entry, itemIndex: 1 })) },
      { ...snapshot, items: snapshot.items.map(entry => ({ ...entry, fileSize: -1 })) },
      { ...snapshot, items: snapshot.items.map(entry => ({ ...entry, file: null })) },
      { ...snapshot, items: snapshot.items.map(entry => ({ ...entry, kind: 'string' })) },
      { ...snapshot, itemCount: 0 }, { ...snapshot, itemCount: -1 },
      { ...snapshot, items: snapshot.items.map(entry => ({ ...entry, overLimit: undefined as unknown as boolean })) },
      { ...snapshot, items: snapshot.items.map(entry => ({ ...entry, overLimit: true })) },
    ]) {
      const result = check(changed);
      expect(result.status).toBe('rejected');
      expect(result.diagnostics[0]?.code).toBe('invalid-snapshot');
    }
  });

  it('bounds placements and binding tables before reading their entries', () => {
    const fail = vi.fn(() => { throw new Error('Entries must not be read'); });
    const refs = [reference(), reference('b')];
    Object.defineProperty(refs, '0', { get: fail });
    expect(check(capture(), refs, [], destination(), { ...limits, maxPlacements: 1 }).status).toBe('rejected');
    const bindings = [binding(), binding()];
    Object.defineProperty(bindings, '0', { get: fail });
    expect(check(capture(), [], bindings, destination(), { ...limits, maxBindings: 1 }).status).toBe('rejected');
    expect(fail).not.toHaveBeenCalled();
  });

  it('indexes bounded tables without invoking custom iterators or following appended entries', () => {
    const refs = [reference()];
    const bindings = [binding()];
    const iterator = vi.fn(() => { throw new Error('Iterator must not run'); });
    Object.defineProperty(refs, Symbol.iterator, { value: iterator });
    Object.defineProperty(bindings, Symbol.iterator, { value: iterator });
    expect(check(capture(), refs, bindings).matches).toHaveLength(1);
    expect(iterator).not.toHaveBeenCalled();

    const growingRefs = [reference()];
    const first = growingRefs[0];
    Object.defineProperty(growingRefs, '0', { get: () => { growingRefs.push(reference('b')); return first; } });
    expect(check(capture(), growingRefs, [binding()], destination(), { ...limits, maxPlacements: 1 }).matches).toHaveLength(1);

    const growingBindings = [binding()];
    const initial = growingBindings[0];
    Object.defineProperty(growingBindings, '0', { get: () => { growingBindings.push(binding('a', 99)); return initial; } });
    expect(check(capture(), [reference()], growingBindings, destination(), { ...limits, maxBindings: 1 }).matches).toHaveLength(1);
  });

  it('bounds private source strings, identifiers, descriptions and dimensions', () => {
    for (const source of [
      reference('x'.repeat(129)), reference('a', 'x'.repeat(1025)),
      reference('a', 'cid:0', { alt: 'x'.repeat(513) }), reference('a', 'cid:0', { width: 10_001 }),
    ]) {
      const result = check(capture(), [source]);
      expect(result.status).toBe('rejected');
      expect(result.diagnostics[0]?.code).toBe('input-limit');
    }
    for (const evidence of [
      { kind: 'host' as const, matcherId: 'x'.repeat(129) },
      { kind: 'verified-profile' as const, profileId: 'x'.repeat(129) },
    ]) expect(check(capture(), [reference()], [{ ...binding(), evidence }]).status).toBe('rejected');
    expect(check(capture(), [reference()], [binding('x'.repeat(129))]).status).toBe('rejected');
  });

  it('rejects duplicate placement IDs and invalid optional source data before matching', () => {
    expect(check(capture(), [reference(), reference()]).status).toBe('rejected');
    for (const options of [{ sourceOffset: -1 }, { sourceOffset: 108 }, { sourceOffset: 0.5 }, { width: 0 }, { height: Infinity }, { height: NaN }]) {
      const result = check(capture(), [reference('a', 'cid:0', options)]);
      expect(result.status).toBe('rejected');
      expect(result.diagnostics[0]?.code).toBe('invalid-reference');
    }
    expect(check(capture(), [reference('', 'cid:0')]).status).toBe('rejected');
  });

  it('diagnoses unknown placements and invalid evidence without including supplied source strings', () => {
    const source = reference('a', 'file:///private/secret.png', { alt: 'Private description' });
    const result = check(capture(), [source], [binding('unknown'), { ...binding(), evidence: { kind: 'host', matcherId: '' } }]);
    expect(result.matches).toEqual([]);
    expect(result.diagnostics).toEqual([{ code: 'unknown-placement' }, { code: 'invalid-binding', placementId: 'a', offset: 4 }]);
    expect(JSON.stringify(result.diagnostics)).not.toContain('secret');
    expect(JSON.stringify(result.diagnostics)).not.toContain('Private');
    expect(JSON.stringify(result.diagnostics)).not.toContain('unknown"');
  });

  it('caps diagnostics without hiding whether a rejected operation exceeded limits', () => {
    const result = check(capture(), [reference('a'), reference('b')], [], destination(), { ...limits, maxDiagnostics: 1 });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnosticsTruncated).toBe(true);
    const rejected = check(capture(), [reference()], [], destination(), { ...limits, maxPlacements: 0, maxDiagnostics: 0 });
    expect(rejected).toEqual({ status: 'rejected', reason: 'input-limit', matches: [], hasInvalidBindings: false, diagnostics: [], diagnosticsTruncated: true });
  });

  it.each([0, 1])('retains invalid binding state when diagnostics are capped at %i', maximum => {
    const snapshot = capture([
      { kind: 'file', type: 'image/png', file: file() },
      { kind: 'file', type: 'image/png', file: file() },
    ]);
    for (const bindings of [[binding('b', 99)], [binding('b', 0), binding('b', 1)], [binding('unknown')]]) {
      const result = check(snapshot, [reference('a'), reference('b')], bindings, destination(), { ...limits, maxDiagnostics: maximum });
      expect(result.status).toBe('checked');
      expect(result.hasInvalidBindings).toBe(true);
      expect(result.diagnostics.length).toBeLessThanOrEqual(maximum);
      expect(result.diagnosticsTruncated).toBe(true);
    }
    const unbound = check(snapshot, [reference('a'), reference('b')], [], destination(), { ...limits, maxDiagnostics: maximum });
    expect(unbound.hasInvalidBindings).toBe(false);
    expect(unbound.diagnosticsTruncated).toBe(true);
    expect(check(snapshot).hasInvalidBindings).toBe(false);
  });

  it('freezes all returned containers and copies mutable caller reference data', () => {
    const source = { ...reference(), alt: 'Original' };
    const result = check(capture(), [source]);
    for (const value of [result, result.matches, result.diagnostics, ...result.matches]) expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(result.matches[0]?.reference)).toBe(true);
    source.alt = 'Changed';
    expect(result.matches[0]?.reference.alt).toBe('Original');
    const missing = check(capture(), [reference()], []);
    expect(Object.isFrozen(missing.diagnostics[0])).toBe(true);
  });

  it('fails closed when snapshot, reference or binding getters throw without returning partial matches', () => {
    const fail = (): never => { throw new Error('Private failure detail'); };
    const brokenSnapshot = { ...capture() };
    Object.defineProperty(brokenSnapshot, 'items', { get: fail });
    expect(check(brokenSnapshot).status).toBe('rejected');
    const brokenReference = { ...reference('b') };
    Object.defineProperty(brokenReference, 'rawReference', { get: fail });
    const sourceResult = check(capture(), [reference(), brokenReference]);
    expect(sourceResult.matches).toEqual([]);
    expect(sourceResult.diagnostics[0]?.code).toBe('unreadable-input');
    const brokenBinding = { ...binding('b') };
    Object.defineProperty(brokenBinding, 'evidence', { get: fail });
    const bindingResult = check(capture(), [reference(), reference('b')], [binding(), brokenBinding]);
    expect(bindingResult.matches).toEqual([]);
    expect(bindingResult.diagnostics[0]?.code).toBe('unreadable-input');
  });

  it('validates explicit limits before reading a snapshot', () => {
    const snapshot = { ...capture() };
    const read = vi.fn(() => { throw new Error('Snapshot must not be read'); });
    Object.defineProperty(snapshot, 'items', { get: read });
    for (const key of Object.keys(limits)) {
      for (const value of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, undefined]) {
        expect(() => check(snapshot, [], [], destination(), { ...limits, [key]: value })).toThrow(RangeError);
      }
    }
    expect(read).not.toHaveBeenCalled();
  });
});
