import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureClipboard } from './capture.js';
import type { ClipboardCaptureLimits, ClipboardTextFormat } from './capture.js';

const limits: ClipboardCaptureLimits = {
  maxItems: 16,
  maxStringLength: 128,
  maxMetadataLength: 128,
  maxTextBytes: 512,
  maxFileBytes: 512,
  maxTotalFileBytes: 1024,
  maxClipboardBytes: 1536,
};

function item(kind: string, type: string, file: File | null = null): DataTransferItem {
  return { kind, type, getAsFile: () => file } as unknown as DataTransferItem;
}

function clipboard(
  text: Partial<Record<ClipboardTextFormat, string>> = {},
  items: readonly DataTransferItem[] = [],
): DataTransfer {
  return {
    items,
    getData: (format: ClipboardTextFormat) => text[format] ?? '',
  } as unknown as DataTransfer;
}

function sizedFile(size: number, type = 'image/png'): File {
  const file = new File([], 'ignored.png', { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

const rejectedLimit = { status: 'rejected', reason: 'input-limit' };
const rejectedRead = { status: 'rejected', reason: 'unreadable-payload' };

afterEach(() => { vi.restoreAllMocks(); });

describe('captureClipboard', () => {
  it('distinguishes unavailable clipboard data from a captured empty payload', () => {
    expect(captureClipboard(null, limits)).toEqual({ status: 'unavailable' });
    expect(captureClipboard(clipboard(), limits)).toEqual({
      status: 'captured',
      snapshot: {
        text: { 'text/html': '', 'text/plain': '', 'text/rtf': '', Text: '', 'text/uri-list': '' },
        items: [], textBytes: 0, fileBytes: 0,
      },
    });
  });

  it('captures every supported string format once and preserves whitespace', () => {
    const text = { 'text/html': '<p>x</p>', 'text/plain': ' x\n', 'text/rtf': '{\\rtf1 x}', Text: ' x\n', 'text/uri-list': 'https://x/' };
    const data = clipboard(text);
    const getData = vi.spyOn(data, 'getData');
    const result = captureClipboard(data, limits);
    expect(result.status).toBe('captured');
    if (result.status !== 'captured') throw new Error('Expected captured clipboard');
    expect(result.snapshot.text).toEqual(text);
    expect(result.snapshot.textBytes).toBe(Object.values(text).reduce((total, value) => total + value.length, 0));
    expect(getData.mock.calls.map(call => call[0])).toEqual(['text/html', 'text/plain', 'text/rtf', 'Text', 'text/uri-list']);
  });

  it('preserves original indexes, metadata and null files without keeping live items', () => {
    const file = new File(['abc'], 'private-name.png', { type: 'image/png' });
    const stringItem = item('string', 'text/html');
    const getStringFile = vi.spyOn(stringItem, 'getAsFile');
    const items = [stringItem, item('file', 'image/png', file), item('file', 'image/jpeg'), item('string', 'text/plain')];
    const data = clipboard({}, items);
    const result = captureClipboard(data, limits);
    expect(result.status).toBe('captured');
    if (result.status !== 'captured') throw new Error('Expected captured clipboard');
    expect(result.snapshot.items).toEqual([
      { itemIndex: 0, kind: 'string', declaredType: 'text/html', file: null, fileType: null, fileSize: null },
      { itemIndex: 1, kind: 'file', declaredType: 'image/png', file, fileType: 'image/png', fileSize: 3 },
      { itemIndex: 2, kind: 'file', declaredType: 'image/jpeg', file: null, fileType: null, fileSize: null },
      { itemIndex: 3, kind: 'string', declaredType: 'text/plain', file: null, fileType: null, fileSize: null },
    ]);
    expect(getStringFile).not.toHaveBeenCalled();
    expect(result.snapshot.items[1]?.file).toBe(file);
    expect(result.snapshot.items).not.toBe(items);
    expect(result.snapshot.items[0]).not.toBe(stringItem);
    items.splice(0, items.length);
    expect(result.snapshot.items).toHaveLength(4);
    expect(result.snapshot.fileBytes).toBe(3);
  });

  it('freezes result containers without freezing or copying the File', () => {
    const file = new File(['x'], 'ignored.png', { type: 'image/png' });
    const result = captureClipboard(clipboard({}, [item('file', 'image/png', file)]), limits);
    expect(result.status).toBe('captured');
    if (result.status !== 'captured') throw new Error('Expected captured clipboard');
    for (const value of [result, result.snapshot, result.snapshot.text, result.snapshot.items, ...result.snapshot.items]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(Object.isFrozen(file)).toBe(false);
    expect(result.snapshot.items[0]?.file).toBe(file);
  });

  it('never reads filenames, file contents or unsupported clipboard formats', () => {
    const file = new File(['image bytes'], 'private.png', { type: 'image/png' });
    const fail = vi.fn(() => { throw new Error('Unexpected resource read'); });
    for (const name of ['name', 'arrayBuffer', 'text', 'stream', 'slice']) {
      Object.defineProperty(file, name, { get: fail });
    }
    const reader = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    const data = clipboard({}, [item('file', 'image/png', file)]);
    Object.defineProperty(data, 'files', { get: fail });
    Object.defineProperty(data, 'types', { get: fail });
    expect(captureClipboard(data, limits).status).toBe('captured');
    expect(fail).not.toHaveBeenCalled();
    expect(reader).not.toHaveBeenCalled();
  });

  it('accepts a real File from another document realm without instanceof assumptions', () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    try {
      const realm = frame.contentWindow as unknown as { File: typeof File };
      const file = new realm.File(['abc'], 'other-realm.png', { type: 'image/png' });
      expect(file.constructor).not.toBe(File);
      const result = captureClipboard(clipboard({}, [item('file', 'image/png', file)]), limits);
      expect(result.status).toBe('captured');
      if (result.status !== 'captured') throw new Error('Expected captured clipboard');
      expect(result.snapshot.items[0]?.file).toBe(file);
      expect(result.snapshot.fileBytes).toBe(3);
    } finally { frame.remove(); }
  });

  it.each([
    ['', 0], ['ASCII', 5], ['é', 2], ['€', 3], ['😀', 4],
    ['\ud800', 3], ['\udc00', 3], ['\ud800A', 4], ['\ud800\ud800\udc00', 7],
    ['Aé😀\ud800', 10], ['\udc00\ud800', 6],
  ] as const)('counts UTF-8 bytes with replacement encoding for %j', (value, bytes) => {
    const data = clipboard({ 'text/html': value });
    const result = captureClipboard(data, { ...limits, maxTextBytes: bytes, maxClipboardBytes: bytes });
    expect(result.status).toBe('captured');
    if (result.status !== 'captured') throw new Error('Expected captured clipboard');
    expect(result.snapshot.textBytes).toBe(bytes);
    if (bytes > 0) expect(captureClipboard(data, { ...limits, maxTextBytes: bytes - 1 })).toEqual(rejectedLimit);
  });

  it('enforces the UTF-16 source ceiling separately from UTF-8 bytes', () => {
    const data = clipboard({ 'text/html': '😀' });
    expect(captureClipboard(data, { ...limits, maxStringLength: 2 }).status).toBe('captured');
    expect(captureClipboard(data, { ...limits, maxStringLength: 1 })).toEqual(rejectedLimit);
  });

  it('rejects a text byte overflow before reading another format', () => {
    const data = clipboard({ 'text/html': '😀abcdef', 'text/plain': 'later' });
    const getData = vi.spyOn(data, 'getData');
    expect(captureClipboard(data, { ...limits, maxTextBytes: 3 })).toEqual(rejectedLimit);
    expect(getData).toHaveBeenCalledExactlyOnceWith('text/html');
  });

  it('stops scanning a long source immediately after its UTF-8 allowance is exhausted', () => {
    const value = '😀' + 'x'.repeat(100_000);
    // The spy delegates with an explicit receiver through original.call below.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = String.prototype.charCodeAt;
    let reads = 0;
    const scan = vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (this: string, index: number): number {
      if (this === value) reads++;
      return original.call(this, index);
    });
    const result = captureClipboard(clipboard({ 'text/html': value }), { ...limits, maxStringLength: value.length, maxTextBytes: 3 });
    scan.mockRestore();
    expect(result).toEqual(rejectedLimit);
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThanOrEqual(2);
  });

  it('checks the UTF-16 source ceiling before any UTF-8 scan', () => {
    const value = 'x'.repeat(100_000);
    // The spy delegates with an explicit receiver through original.call below.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = String.prototype.charCodeAt;
    let reads = 0;
    const scan = vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (this: string, index: number): number {
      if (this === value) reads++;
      return original.call(this, index);
    });
    const result = captureClipboard(clipboard({ 'text/html': value }), limits);
    scan.mockRestore();
    expect(result).toEqual(rejectedLimit);
    expect(reads).toBe(0);
  });

  it('agrees with the platform UTF-8 encoder across mixed Unicode and surrogate sequences', () => {
    const encoder = new TextEncoder();
    const pieces = ['A', 'é', '€', '😀', '\ud800', '\udc00', '\u0000'];
    let seed = 123;
    for (let sample = 0; sample < 64; sample++) {
      let value = '';
      for (let index = 0; index < 32; index++) {
        seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
        value += pieces[seed % pieces.length] ?? '';
      }
      const bytes = encoder.encode(value).byteLength;
      const result = captureClipboard(clipboard({ 'text/html': value }), { ...limits, maxTextBytes: bytes });
      expect(result.status).toBe('captured');
      if (result.status !== 'captured') throw new Error('Expected captured clipboard');
      expect(result.snapshot.textBytes).toBe(bytes);
      expect(captureClipboard(clipboard({ 'text/html': value }), { ...limits, maxTextBytes: bytes - 1 })).toEqual(rejectedLimit);
    }
  });

  it('counts duplicate plain-text aliases and different formats against aggregate text limits', () => {
    const data = clipboard({ 'text/html': 'é', 'text/plain': 'ab', Text: 'ab' });
    expect(captureClipboard(data, { ...limits, maxTextBytes: 6 }).status).toBe('captured');
    expect(captureClipboard(data, { ...limits, maxTextBytes: 5 })).toEqual(rejectedLimit);
  });

  it('checks item count before accessing any item or text format', () => {
    const data = clipboard();
    const access = vi.fn(() => { throw new Error('Item must not be read'); });
    Object.defineProperty(data, 'items', { value: { length: 17, get 0() { return access(); } } });
    const getData = vi.spyOn(data, 'getData');
    expect(captureClipboard(data, limits)).toEqual(rejectedLimit);
    expect(access).not.toHaveBeenCalled();
    expect(getData).not.toHaveBeenCalled();
  });

  it('allows the exact item limit and keeps unsupported metadata without interpreting it', () => {
    const entries = [item('string', 'application/custom'), item('future', 'IMAGE/PNG')];
    const result = captureClipboard(clipboard({}, entries), { ...limits, maxItems: 2 });
    expect(result.status).toBe('captured');
    if (result.status !== 'captured') throw new Error('Expected captured clipboard');
    expect(result.snapshot.items.map(entry => [entry.kind, entry.declaredType, entry.file])).toEqual([
      ['string', 'application/custom', null], ['future', 'IMAGE/PNG', null],
    ]);
  });

  it.each(['kind', 'type'] as const)('bounds item %s before obtaining a File', property => {
    const entry = item('file', 'image/png', sizedFile(1));
    Object.defineProperty(entry, property, { value: 'x'.repeat(9) });
    const getAsFile = vi.spyOn(entry, 'getAsFile');
    expect(captureClipboard(clipboard({}, [entry]), { ...limits, maxMetadataLength: 8 })).toEqual(rejectedLimit);
    expect(getAsFile).not.toHaveBeenCalled();
  });

  it('bounds captured File MIME metadata independently of the item MIME', () => {
    const entry = item('file', '', sizedFile(0, 'x'.repeat(9)));
    expect(captureClipboard(clipboard({}, [entry]), { ...limits, maxMetadataLength: 9 }).status).toBe('captured');
    expect(captureClipboard(clipboard({}, [entry]), { ...limits, maxMetadataLength: 8 })).toEqual(rejectedLimit);
  });

  it('applies per-file limits to unsupported file types too', () => {
    const entry = item('file', 'application/octet-stream', sizedFile(5, 'application/octet-stream'));
    expect(captureClipboard(clipboard({}, [entry]), { ...limits, maxFileBytes: 5 }).status).toBe('captured');
    expect(captureClipboard(clipboard({}, [entry]), { ...limits, maxFileBytes: 4 })).toEqual(rejectedLimit);
  });

  it('counts repeated File references conservatively before later deduplication', () => {
    const file = sizedFile(3);
    const data = clipboard({}, [item('file', 'image/png', file), item('file', 'image/png', file)]);
    const result = captureClipboard(data, { ...limits, maxTotalFileBytes: 6 });
    expect(result.status).toBe('captured');
    if (result.status !== 'captured') throw new Error('Expected captured clipboard');
    expect(result.snapshot.fileBytes).toBe(6);
    expect(captureClipboard(data, { ...limits, maxTotalFileBytes: 5 })).toEqual(rejectedLimit);
  });

  it('enforces a shared file and text budget at the exact byte boundary', () => {
    const data = clipboard({ 'text/html': 'é' }, [item('file', 'image/png', sizedFile(3))]);
    expect(captureClipboard(data, { ...limits, maxClipboardBytes: 5 }).status).toBe('captured');
    expect(captureClipboard(data, { ...limits, maxClipboardBytes: 4 })).toEqual(rejectedLimit);
  });

  it('rejects aggregate files before retrieving source strings', () => {
    const data = clipboard({ 'text/html': 'later' }, [item('file', 'image/png', sizedFile(4))]);
    const getData = vi.spyOn(data, 'getData');
    expect(captureClipboard(data, { ...limits, maxClipboardBytes: 3 })).toEqual(rejectedLimit);
    expect(getData).not.toHaveBeenCalled();
  });

  it('treats zero limits as actual zero ceilings and permits zero-byte files', () => {
    const zero = Object.fromEntries(Object.keys(limits).map(key => [key, 0])) as unknown as ClipboardCaptureLimits;
    expect(captureClipboard(clipboard(), zero).status).toBe('captured');
    expect(captureClipboard(clipboard({ 'text/html': 'x' }), zero)).toEqual(rejectedLimit);
    const data = clipboard({}, [item('file', 'image/png', sizedFile(0))]);
    expect(captureClipboard(data, { ...limits, maxFileBytes: 0, maxTotalFileBytes: 0, maxClipboardBytes: 0 }).status).toBe('captured');
    expect(captureClipboard(data, zero)).toEqual(rejectedLimit);
  });

  it('uses subtraction bounds so large synthetic file totals cannot overflow safe integers', () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const data = clipboard({}, [item('file', '', sizedFile(maximum)), item('file', '', sizedFile(1))]);
    const large = { ...limits, maxFileBytes: maximum, maxTotalFileBytes: maximum, maxClipboardBytes: maximum };
    expect(captureClipboard(data, large)).toEqual(rejectedLimit);
    expect(captureClipboard(clipboard({}, [item('file', '', sizedFile(maximum))]), large).status).toBe('captured');
  });

  it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects malformed file size %s without partial output', size => {
    expect(captureClipboard(clipboard({}, [item('file', '', sizedFile(1)), item('file', '', sizedFile(size))]), limits)).toEqual(rejectedRead);
  });

  it.each([NaN, Infinity, -1, 0.5, '1', undefined])('rejects an unreadable item count %s', length => {
    const data = clipboard();
    Object.defineProperty(data, 'items', { value: { length } });
    expect(captureClipboard(data, limits)).toEqual(rejectedRead);
  });

  it('rejects missing items instead of changing their original indexes', () => {
    const data = clipboard();
    Object.defineProperty(data, 'items', { value: { length: 1 } });
    expect(captureClipboard(data, limits)).toEqual(rejectedRead);
  });

  it.each(['kind', 'type'] as const)('rejects non-string item %s without coercion', property => {
    const entry = item('file', 'image/png');
    Object.defineProperty(entry, property, { value: 42 });
    expect(captureClipboard(clipboard({}, [entry]), limits)).toEqual(rejectedRead);
  });

  it('rejects non-string source data, non-File values and malformed File metadata', () => {
    const data = clipboard();
    Object.defineProperty(data, 'getData', { value: () => 42 });
    expect(captureClipboard(data, limits)).toEqual(rejectedRead);
    const invalidFile = item('file', '');
    Object.defineProperty(invalidFile, 'getAsFile', { value: () => 42 });
    expect(captureClipboard(clipboard({}, [invalidFile]), limits)).toEqual(rejectedRead);
    const file = sizedFile(1);
    Object.defineProperty(file, 'type', { value: 42 });
    expect(captureClipboard(clipboard({}, [item('file', '', file)]), limits)).toEqual(rejectedRead);
  });

  it.each([
    'items', 'length', 'index', 'kind', 'type', 'getAsFile', 'size', 'fileType', 'getData', 'getDataMethod',
  ] as const)('fails closed when %s access throws', field => {
    const file = new File(['x'], 'ignored.png', { type: 'image/png' });
    const entry = item('file', 'image/png', file);
    const items = [entry];
    const data = clipboard({}, items);
    const fail = (): never => { throw new Error('Private source details'); };
    if (field === 'items' || field === 'getData') Object.defineProperty(data, field, { get: fail });
    else if (field === 'length') Object.defineProperty(data, 'items', { value: { get length() { return fail(); } } });
    else if (field === 'index') Object.defineProperty(items, '0', { get: fail });
    else if (field === 'kind' || field === 'type') Object.defineProperty(entry, field, { get: fail });
    else if (field === 'getAsFile') Object.defineProperty(entry, field, { value: fail });
    else if (field === 'size') Object.defineProperty(file, 'size', { get: fail });
    else if (field === 'fileType') Object.defineProperty(file, 'type', { get: fail });
    else Object.defineProperty(data, 'getData', { value: fail });
    expect(captureClipboard(data, limits)).toEqual(rejectedRead);
  });

  it('validates all explicit limits before touching the clipboard', () => {
    const data = clipboard();
    const getData = vi.spyOn(data, 'getData');
    for (const key of Object.keys(limits)) {
      for (const value of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, undefined, '4']) {
        expect(() => captureClipboard(data, { ...limits, [key]: value })).toThrow(RangeError);
      }
    }
    expect(getData).not.toHaveBeenCalled();
  });

  it('snapshots limits before reading application-controlled clipboard getters', () => {
    const changing = { ...limits, maxTextBytes: 1 };
    const data = clipboard({ 'text/html': 'xx' });
    Object.defineProperty(data, 'items', { get: () => { changing.maxTextBytes = 100; return []; } });
    expect(captureClipboard(data, changing)).toEqual(rejectedLimit);
  });
});
