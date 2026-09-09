// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Element, RootContent } from 'hast';
import type * as HTMLSerializer from 'hast-util-to-html';
import { toHtml } from 'hast-util-to-html';
import { normalizePasteHTML } from '../html/index.js';
import { DEFAULT_PASTE_HTML_LIMITS } from '../html/normalize.js';
import { parseBoundedHTML } from '../html/parse.js';
import type { NormalizePasteHTMLResult } from '../html/types.js';
import { headingOutline } from '../html/headingLevels.js';
import type { PasteDestinationFeature } from '../html/destinationDemand.js';
import {
  discardPreparedClipboardHTML,
  materializeClipboardHTML,
  materializeResolvedClipboardHTML,
  prepareClipboardHTML,
  readPreparedClipboardHTMLNormalization,
  type ClipboardInlineHTMLPreparation,
  type ClipboardHTMLPreparationResult,
  type ClipboardHTMLMaterialization,
  type PreparedClipboardHTML,
  type PreparedClipboardHTMLLimits,
} from './preparedHTML.js';
import type { ClipboardResolvedImagePlacement } from './preparedHTML.js';
import { createClipboardResolvedSourcePolicy } from './resolverPolicy.js';
import type { ClipboardResolvedSourcePolicy } from './resolverPolicy.js';
import { DEFAULT_CLIPBOARD_ASSET_LIMITS } from './limits.js';

vi.mock('hast-util-to-html', async importOriginal => {
  const actual = await importOriginal<typeof HTMLSerializer>();
  return { ...actual, toHtml: vi.fn(actual.toHtml) };
});

// A complete one-pixel PNG with independently generated zlib data and CRC32 chunks.
const PNG = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC');
const DATA = `data:image/png;base64,${btoa(PNG)}`;
const LIMITS: PreparedClipboardHTMLLimits = {
  maxReferences: 200,
  maxReferenceLength: 2_000_000,
  maxDescriptionLength: 2_000_000,
  maxOutputUnits: 32 * 1024 * 1024,
};

function prepared(result: ClipboardHTMLPreparationResult): Extract<ClipboardHTMLPreparationResult, { status: 'prepared' }> {
  expect(result.status).toBe('prepared');
  if (result.status !== 'prepared') throw new Error('Expected a prepared test fixture');
  return result;
}

function materialized(handle: PreparedClipboardHTML, urls: ReadonlyMap<string, string> = new Map()): NormalizePasteHTMLResult {
  const result = materializeClipboardHTML(handle, urls);
  expect(result.status).toBe('materialized');
  if (result.status !== 'materialized') throw new Error('Expected a materialized test fixture');
  return result.normalization;
}

function elements(html: string): Element[] {
  const result: Element[] = [];
  const visit = (children: RootContent[]): void => {
    for (const child of children) {
      if (child.type !== 'element') continue;
      result.push(child);
      visit(child.children);
    }
  };
  visit(parseBoundedHTML(html, DEFAULT_PASTE_HTML_LIMITS).children);
  return result;
}

function pngTextChunk(text: string): string {
  const bytes = `tEXtComment\0${text}`;
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) {
    crc ^= bytes.charCodeAt(index);
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) === 0 ? 0 : 0xedb88320);
  }
  const be32 = (value: number): string => String.fromCharCode(value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
  return be32(bytes.length - 4) + bytes + be32((crc ^ 0xffffffff) >>> 0);
}

beforeEach(() => { vi.mocked(toHtml).mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('private inline image preparation', () => {
  const SRC = 'https://cdn.example/inline.png';
  const policy = createClipboardResolvedSourcePolicy(['https://cdn.example']);
  const config = (): ClipboardInlineHTMLPreparation => ({
    destination: { allowedMimeTypes: ['image/png'], maxFileBytes: 1024 * 1024 },
    assetLimits: { ...DEFAULT_CLIPBOARD_ASSET_LIMITS }, sourceAllowDataImages: true,
  });
  const resolve = (result: Extract<ClipboardHTMLPreparationResult, { status: 'prepared' }>, ids: readonly string[]): ClipboardHTMLMaterialization =>
    materializeResolvedClipboardHTML(result.handle, new Map(ids.map(id => [id, { src: SRC, pixels: 1 }])), policy);

  it('qualifies authorized inline bytes once without allocating Blob, File, DOM or requests', () => {
    const decode = vi.spyOn(globalThis, 'atob');
    const forbidden = vi.fn(() => { throw new Error('Unexpected allocation or I/O'); });
    for (const name of ['Blob', 'File', 'DOMParser', 'fetch', 'XMLHttpRequest']) vi.stubGlobal(name, forbidden);
    const html = `<p>Before<img src="${DATA}" alt="Diagram" width="12" height="13">After</p>`;
    const result = prepared(prepareClipboardHTML(html, LIMITS, {}, undefined, config()));
    expect(decode).toHaveBeenCalledTimes(1);
    expect(result.references).toEqual([]);
    expect(result.inlineAssets).toEqual({
      resources: [{ binary: PNG, mimeType: 'image/png', byteLength: PNG.length, pixels: 1 }],
      placements: [{ placementId: 'image:1', resourceIndex: 0, sourceOffset: 9, alt: 'Diagram', width: 12, height: 13 }],
      readBytes: PNG.length, pixelCount: 1,
    });
    expect(result.existingImagePixels).toBe(0);
    expect(result.hasRemovedImages).toBe(false);
    expect(readPreparedClipboardHTMLNormalization(result.handle)?.html).toBe('');
    expect(resolve(result, ['image:1'])).toMatchObject({ status: 'materialized', normalization: {
      html: `<p>Before<img alt="Diagram" width="12" height="13" src="${SRC}">After</p>`, diagnostics: [],
    } });
    expect(decode).toHaveBeenCalledTimes(1);
    expect(forbidden).not.toHaveBeenCalled();
  });

  it('keeps inline and explicitly matched reference slots in source order without exposing inline bytes to matching', () => {
    const result = prepared(prepareClipboardHTML(`<ol start="7"><li><p>A<img src="${DATA}" alt="Inline &quot;one&quot;" style="float:right;width:20px">B<img src="cid:external" alt="File">C<img src="${DATA}" alt="Inline two">D</p></li></ol>`, LIMITS, {}, undefined, config()));
    expect(result.references).toEqual([expect.objectContaining({ placementId: 'image:2', rawReference: 'cid:external', alt: 'File' })]);
    expect(JSON.stringify(result.references)).not.toContain('data:');
    expect(JSON.stringify(result.references)).not.toContain(PNG);
    expect(result.inlineAssets.placements.map(value => value.placementId)).toEqual(['image:1', 'image:3']);
    const output = resolve(result, ['image:3', 'image:2', 'image:1']);
    expect(output.status).toBe('materialized');
    if (output.status !== 'materialized') return;
    const nodes = elements(output.normalization.html);
    expect(nodes.find(value => value.tagName === 'ol')?.properties.start).toBe(7);
    expect(nodes.filter(value => value.tagName === 'img').map(value => [value.properties.alt, value.properties.src]))
      .toEqual([['Inline "one"', SRC], ['File', SRC], ['Inline two', SRC]]);
    expect(nodes.find(value => value.tagName === 'img')?.properties.style).toContain('float:right');
    expect(output.normalization.html).toContain('>B<img');
    expect(output.normalization.html).toContain('>C<img');
    expect(output.normalization.html).toContain('>D</p>');
  });

  it('charges identical inline source bytes once and raster pixels for each placement', () => {
    const decode = vi.spyOn(globalThis, 'atob');
    const input = config();
    const result = prepared(prepareClipboardHTML(`<img src="${DATA}"><img src="${DATA}"><img src="${DATA}">`, LIMITS,
      { limits: { maxImagePixels: 3 } }, undefined, { ...input, assetLimits: { ...input.assetLimits, maxFileBytes: PNG.length, maxTotalFileBytes: PNG.length } }));
    expect(decode).toHaveBeenCalledTimes(1);
    expect(result.inlineAssets.resources).toHaveLength(1);
    expect(result.inlineAssets.placements.map(value => value.resourceIndex)).toEqual([0, 0, 0]);
    expect(result.inlineAssets).toMatchObject({ readBytes: PNG.length, pixelCount: 3 });
    expect(resolve(result, ['image:1', 'image:2', 'image:3']).status).toBe('materialized');
  });

  it('qualifies source encoding variants separately for a later exact binary batch deduplication', () => {
    const decode = vi.spyOn(globalThis, 'atob');
    const alternate = DATA.replace('data:image/png;base64,', 'DATA:IMAGE/PNG;BASE64,');
    const result = prepared(prepareClipboardHTML(`<img src="${DATA}"><img src="${alternate}">`, LIMITS, {}, undefined, config()));
    expect(decode).toHaveBeenCalledTimes(2);
    expect(result.inlineAssets.resources).toHaveLength(2);
    expect(result.inlineAssets.resources[0]).toEqual(result.inlineAssets.resources[1]);
    expect(result.inlineAssets.placements.map(value => value.resourceIndex)).toEqual([0, 1]);
    expect(result.inlineAssets).toMatchObject({ readBytes: PNG.length * 2, pixelCount: 2 });
    discardPreparedClipboardHTML(result.handle);
  });

  it('retains legacy and public HTML behavior unless the private transport is explicitly selected', () => {
    const html = `<p><img src="${DATA}"></p>`;
    expect(normalizePasteHTML(html).html).toBe(html);
    const result = prepared(prepareClipboardHTML(html, LIMITS));
    expect(result.inlineAssets).toEqual({ resources: [], placements: [], readBytes: 0, pixelCount: 0 });
    expect(result.existingImagePixels).toBe(1);
    expect(materialized(result.handle).html).toBe(html);
  });

  it('honors denied source data images without decoding or granting transport authority', () => {
    const decode = vi.spyOn(globalThis, 'atob');
    const result = prepared(prepareClipboardHTML(`<p>A<img src="${DATA}" alt="Denied">B</p>`, LIMITS,
      { allowDataImages: true }, undefined, { ...config(), sourceAllowDataImages: false }));
    expect(decode).not.toHaveBeenCalled();
    expect(result.inlineAssets).toEqual({ resources: [], placements: [], readBytes: 0, pixelCount: 0 });
    expect(result.hasRemovedImages).toBe(true);
    expect(materialized(result.handle)).toMatchObject({ html: '<p>ADeniedB</p>', diagnostics: [{ code: 'image-removed', severity: 'warning', offset: 4 }] });
  });

  it.each([
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:image/png;base64,@@==',
    'data:image/png;base64,AAAA', 'data:image/png,raw', 'data:text/plain;base64,AAAA',
  ])('sanitizes an invalid or unsupported inline source as an explicit loss: %s', src => {
    const result = prepared(prepareClipboardHTML(`<p>A<img src="${src}" alt="Missing">B</p>`, LIMITS, {}, undefined, config()));
    expect(result.inlineAssets.resources).toEqual([]);
    expect(result.references).toEqual([]);
    expect(result.hasRemovedImages).toBe(true);
    expect(materialized(result.handle)).toMatchObject({ html: '<p>AMissingB</p>', diagnostics: [expect.objectContaining({ code: 'image-removed' })] });
  });

  it('does not decode repeated invalid rasters more than once', () => {
    const decode = vi.spyOn(globalThis, 'atob');
    const result = prepared(prepareClipboardHTML('<img src="data:image/png;base64,AAAA"><img src="data:image/png;base64,AAAA">', LIMITS, {}, undefined, config()));
    expect(decode).toHaveBeenCalledTimes(1);
    expect(materialized(result.handle).diagnostics).toHaveLength(2);
  });

  it('rejects destination MIME refusal before decoding and without returning a preparation handle', () => {
    const decode = vi.spyOn(globalThis, 'atob');
    const result = prepareClipboardHTML(`<img src="${DATA}">`, LIMITS, {}, undefined,
      { ...config(), destination: { allowedMimeTypes: ['image/jpeg'], maxFileBytes: PNG.length } });
    expect(result).toMatchObject({ status: 'rejected', assetReason: 'assets-unavailable', normalization: { status: 'rejected', html: '' } });
    expect(result).not.toHaveProperty('handle');
    expect(decode).not.toHaveBeenCalled();
  });

  it('enforces destination and operation byte caps before decoded allocation', () => {
    const decode = vi.spyOn(globalThis, 'atob');
    const input = config();
    for (const limited of [
      { ...input, destination: { ...input.destination, maxFileBytes: PNG.length - 1 } },
      { ...input, assetLimits: { ...input.assetLimits, maxFileBytes: PNG.length - 1 } },
    ]) {
      expect(prepareClipboardHTML(`<img src="${DATA}">`, LIMITS, {}, undefined, limited))
        .toMatchObject({ status: 'rejected', assetReason: 'asset-limit' });
    }
    expect(decode).not.toHaveBeenCalled();
  });

  it('preflights aggregate decoded bytes before a second distinct inline qualification', () => {
    const decode = vi.spyOn(globalThis, 'atob');
    const input = config();
    const html = `<img src="${DATA}"><img src="${DATA.replace('data:', 'DATA:')}">`;
    const exact = prepared(prepareClipboardHTML(html, LIMITS, {}, undefined, { ...input,
      assetLimits: { ...input.assetLimits, maxFileBytes: PNG.length, maxTotalFileBytes: PNG.length * 2 } }));
    expect(exact.inlineAssets.readBytes).toBe(PNG.length * 2);
    discardPreparedClipboardHTML(exact.handle);
    decode.mockClear();
    expect(prepareClipboardHTML(html, LIMITS, {}, undefined, { ...input,
      assetLimits: { ...input.assetLimits, maxFileBytes: PNG.length, maxTotalFileBytes: PNG.length * 2 - 1 } }))
      .toMatchObject({ status: 'rejected', assetReason: 'asset-limit' });
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('rejects repeated-placement pixels independently of a full diagnostic allowance', () => {
    const decode = vi.spyOn(globalThis, 'atob');
    const result = prepareClipboardHTML(`<span onclick="bad()">A</span><img src="${DATA}"><img src="${DATA}">`, LIMITS,
      { limits: { maxImagePixels: 1, maxDiagnostics: 1 } }, undefined, config());
    expect(result).toMatchObject({ status: 'rejected', assetReason: 'asset-limit', normalization: {
      status: 'rejected', html: '', diagnostics: [{ code: 'unsafe-content-removed', severity: 'warning', offset: 0 }], diagnosticsTruncated: true,
    } });
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('counts inline and CID slots together under the original image count bound', () => {
    const decode = vi.spyOn(globalThis, 'atob');
    const result = prepared(prepareClipboardHTML(`<img src="${DATA}" alt="One"><img src="cid:two" alt="Two"><img src="${DATA}" alt="Three">`, LIMITS,
      { limits: { maxImages: 2 } }, undefined, config()));
    expect(result.inlineAssets.placements).toHaveLength(1);
    expect(result.references.map(value => value.placementId)).toEqual(['image:2']);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(resolve(result, ['image:1', 'image:2'])).toMatchObject({ status: 'materialized', normalization: {
      html: `<img alt="One" src="${SRC}"><img alt="Two" src="${SRC}">Three`,
      diagnostics: [expect.objectContaining({ code: 'image-removed' })],
    } });
  });

  it('does not let inline slots exceed the private combined placement allowance', () => {
    expect(prepareClipboardHTML(`<img src="cid:first"><img src="${DATA}">`, { ...LIMITS, maxReferences: 1 }, {}, undefined, config()))
      .toMatchObject({ status: 'rejected', assetReason: 'asset-limit' });
  });

  it('snapshots source policy, destination and byte budgets before destination list callbacks', () => {
    const mimeTypes = ['image/png'] as const;
    const mutableMimeTypes = [...mimeTypes];
    const input = { destination: { allowedMimeTypes: mutableMimeTypes, maxFileBytes: PNG.length },
      assetLimits: { ...DEFAULT_CLIPBOARD_ASSET_LIMITS, maxFileBytes: PNG.length, maxTotalFileBytes: PNG.length }, sourceAllowDataImages: true };
    const callback = vi.fn(() => {
      mutableMimeTypes.length = 0;
      input.destination.maxFileBytes = 1;
      input.assetLimits.maxTotalFileBytes = 1;
      input.sourceAllowDataImages = false;
      return { orderedLists: true, bulletLists: true, nestedLists: true };
    });
    const result = prepared(prepareClipboardHTML(`<!--mso-list:--><img src="${DATA}">`, LIMITS, {}, callback, input));
    expect(callback).toHaveBeenCalledOnce();
    expect(result.inlineAssets.readBytes).toBe(PNG.length);
    discardPreparedClipboardHTML(result.handle);
  });

  it('freezes private binary resource and placement metadata', () => {
    const result = prepared(prepareClipboardHTML(`<img src="${DATA}">`, LIMITS, {}, undefined, config()));
    for (const value of [result.inlineAssets, result.inlineAssets.resources, result.inlineAssets.resources[0],
      result.inlineAssets.placements, result.inlineAssets.placements[0]]) expect(Object.isFrozen(value)).toBe(true);
    discardPreparedClipboardHTML(result.handle);
    expect(readPreparedClipboardHTMLNormalization(result.handle)).toBeUndefined();
    expect(resolve(result, ['image:1'])).toEqual({ status: 'rejected', reason: 'expired-preparation' });
  });

  it('requires complete owned-slot resolution, supports explicit omission and rejects forged markers', () => {
    const html = `<p>A<img src="${DATA}" alt="Missing">B<img src="https://cdn.example/unowned" data-domternal-clipboard-image-slot="image:2" alt="Unowned">C</p>`;
    const first = prepared(prepareClipboardHTML(html, LIMITS, {}, undefined, config()));
    expect(resolve(first, [])).toEqual({ status: 'rejected', reason: 'missing-image' });
    const second = prepared(prepareClipboardHTML(html, LIMITS, {}, undefined, config()));
    expect(resolve(second, ['image:1', 'image:2'])).toEqual({ status: 'rejected', reason: 'invalid-resolution' });
    const third = prepared(prepareClipboardHTML(html, LIMITS, {}, undefined, config()));
    expect(materializeResolvedClipboardHTML(third.handle, new Map(), policy, { omitUnresolved: true }))
      .toMatchObject({ status: 'materialized', normalization: { html: '<p>AMissingBUnownedC</p>', diagnostics: [
        expect.objectContaining({ code: 'image-removed' }), expect.objectContaining({ code: 'image-removed' }),
      ] } });
  });

  it('still bounds escaped generated output before serialization for inline-only slots', () => {
    const result = prepared(prepareClipboardHTML(`<img src="${DATA}" alt="${'&quot;'.repeat(100)}">`, { ...LIMITS, maxOutputUnits: 256 }, {}, undefined, config()));
    expect(resolve(result, ['image:1'])).toEqual({ status: 'rejected', reason: 'output-limit' });
    expect(toHtml).not.toHaveBeenCalled();
  });

  it('does not decode an original HTML input beyond its source allowance', () => {
    const decode = vi.spyOn(globalThis, 'atob');
    expect(prepareClipboardHTML(`<img src="${DATA}">`, LIMITS, { limits: { maxInputLength: 10 } }, undefined, config()))
      .toMatchObject({ status: 'rejected', normalization: { diagnostics: [{ code: 'input-limit', severity: 'error' }] } });
    expect(decode).not.toHaveBeenCalled();
  });

  it('rejects malformed private limits and authorization without decoding', () => {
    const decode = vi.spyOn(globalThis, 'atob');
    for (const value of [0, -1, NaN, Infinity, 0.5]) {
      const input = config();
      expect(() => prepareClipboardHTML(`<img src="${DATA}">`, LIMITS, {}, undefined,
        { ...input, assetLimits: { ...input.assetLimits, maxFileBytes: value } })).toThrow(RangeError);
    }
    expect(() => prepareClipboardHTML(`<img src="${DATA}">`, LIMITS, {}, undefined,
      { ...config(), sourceAllowDataImages: undefined as unknown as boolean })).toThrow(RangeError);
    expect(decode).not.toHaveBeenCalled();
  });
});

describe('private resolved clipboard HTML materialization', () => {
  const SRC = 'https://cdn.example/image.png';
  const policy = createClipboardResolvedSourcePolicy(['https://cdn.example']);
  const image = (src = SRC, pixels = 1): ClipboardResolvedImagePlacement => ({ src, pixels });

  it('replaces exact owned slots without authorizing remote source images', () => {
    const input = '<p>Before<img src="https://cdn.example/untrusted.png" alt="Untrusted"><img src="cid:owned" alt="Owned">After</p>';
    const result = prepared(prepareClipboardHTML(input, LIMITS, { allowRemoteImages: false, allowDataImages: false }));
    const output = materializeResolvedClipboardHTML(result.handle, new Map([['image:1', image()]]), policy);
    expect(output.status).toBe('materialized');
    if (output.status !== 'materialized') return;
    expect(output.normalization.html).toBe(`<p>BeforeUntrusted<img alt="Owned" src="${SRC}">After</p>`);
    expect(output.normalization.diagnostics).toContainEqual(expect.objectContaining({ code: 'image-removed' }));
    expect(materializeResolvedClipboardHTML(result.handle, new Map([['image:1', image()]]), policy)).toEqual({ status: 'rejected', reason: 'expired-preparation' });
  });

  it('keeps reversed resource maps at their original placements and escapes resolved URL attributes', () => {
    const result = prepared(prepareClipboardHTML('<p>A<img src="cid:first" alt="First" width="10">B<img src="cid:second" alt="Second">C</p>', LIMITS));
    const first = 'https://cdn.example/first.png?a=1&b=2';
    const output = materializeResolvedClipboardHTML(result.handle, new Map([['image:2', image(SRC)], ['image:1', image(first)]]), policy);
    expect(output.status).toBe('materialized');
    if (output.status !== 'materialized') return;
    const images = elements(output.normalization.html).filter(value => value.tagName === 'img');
    expect(images.map(value => value.properties.src)).toEqual([first, SRC]);
    expect(images.map(value => value.properties.alt)).toEqual(['First', 'Second']);
    expect(images[0]?.properties.width).toBe(10);
  });

  it.each([
    'https://other.example/image.png', 'http://cdn.example/image.png', '//cdn.example/image.png',
    'file:///private/image.png', 'blob:https://cdn.example/id', 'javascript:alert(1)', DATA,
    'https://name@cdn.example/image.png', 'https://cdn.example\\image.png', 'https://CDN.EXAMPLE/image.png',
  ])('rejects unapproved, temporary or noncanonical resolved URLs: %j', src => {
    const result = prepared(prepareClipboardHTML('<img src="cid:owned">', LIMITS));
    expect(materializeResolvedClipboardHTML(result.handle, new Map([['image:1', image(src)]]), policy)).toEqual({ status: 'rejected', reason: 'invalid-image' });
    expect(toHtml).not.toHaveBeenCalled();
  });

  it('rejects a forged policy even when its source URL matches an allowed origin elsewhere', () => {
    const result = prepared(prepareClipboardHTML('<img src="cid:owned">', LIMITS));
    expect(materializeResolvedClipboardHTML(result.handle, new Map([['image:1', image()]]), { allowedOrigins: ['https://cdn.example'] } as unknown as ClipboardResolvedSourcePolicy)).toEqual({ status: 'rejected', reason: 'invalid-image' });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('rejects invalid pixel accounting: %s', pixels => {
    const result = prepared(prepareClipboardHTML('<img src="cid:owned">', LIMITS));
    expect(materializeResolvedClipboardHTML(result.handle, new Map([['image:1', image(SRC, pixels)]]), policy)).toEqual({ status: 'rejected', reason: 'invalid-image' });
  });

  it('charges every repeated placement together with existing data image pixels', () => {
    const input = `<p><img src="${DATA}"><img src="cid:first"><img src="cid:second"></p>`;
    const images = new Map([['image:1', image()], ['image:2', image()]]);
    const exact = prepared(prepareClipboardHTML(input, LIMITS, { limits: { maxImagePixels: 3 } }));
    expect(materializeResolvedClipboardHTML(exact.handle, images, policy).status).toBe('materialized');
    const over = prepared(prepareClipboardHTML(input, LIMITS, { limits: { maxImagePixels: 2 } }));
    expect(materializeResolvedClipboardHTML(over.handle, images, policy)).toEqual({ status: 'rejected', reason: 'invalid-image' });
  });

  it('refuses missing and unrelated image identities unless omission is explicit', () => {
    const missing = prepared(prepareClipboardHTML('<img src="cid:owned" alt="Missing">', LIMITS));
    expect(materializeResolvedClipboardHTML(missing.handle, new Map(), policy)).toEqual({ status: 'rejected', reason: 'missing-image' });
    const unrelated = prepared(prepareClipboardHTML('<img src="cid:owned">', LIMITS));
    expect(materializeResolvedClipboardHTML(unrelated.handle, new Map([['image:other', image()]]), policy, { omitUnresolved: true })).toEqual({ status: 'rejected', reason: 'invalid-resolution' });
    const omitted = prepared(prepareClipboardHTML('<p>A<img src="cid:owned" alt="Missing">B</p>', LIMITS));
    const output = materializeResolvedClipboardHTML(omitted.handle, new Map(), policy, { omitUnresolved: true });
    expect(output.status).toBe('materialized');
    if (output.status === 'materialized') {
      expect(output.normalization.html).toBe('<p>AMissingB</p>');
      expect(output.normalization.diagnostics).toContainEqual(expect.objectContaining({ code: 'image-removed' }));
    }
  });

  it('keeps an omitted image warning ahead of informational adaptation in a full allowance', () => {
    const html = '<p><span style="color:red">A</span><span style="color:red">B</span><img src="cid:owned" alt="Missing"></p>';
    const adapted = prepared(prepareClipboardHTML(html, LIMITS, { formatting: 'adapt', limits: { maxDiagnostics: 2 } }));
    expect(readPreparedClipboardHTMLNormalization(adapted.handle)?.diagnostics.map(item => item.code))
      .toEqual(['formatting-adapted', 'formatting-adapted']);
    const output = materializeResolvedClipboardHTML(adapted.handle, new Map(), policy, { omitUnresolved: true });
    expect(output).toMatchObject({ status: 'materialized', normalization: {
      html: '<p><span>A</span><span>B</span>Missing</p>', diagnosticsTruncated: true,
      diagnostics: [{ code: 'formatting-adapted', severity: 'info', offset: 3 }, { code: 'image-removed', severity: 'warning', offset: html.indexOf('<img') }],
    } });
  });

  it('bounds escaped output before calling the serializer', () => {
    const result = prepared(prepareClipboardHTML(`<p><img src="cid:owned" alt="${'&quot;'.repeat(100)}"></p>`, { ...LIMITS, maxOutputUnits: 256 }));
    expect(materializeResolvedClipboardHTML(result.handle, new Map([['image:1', image()]]), policy)).toEqual({ status: 'rejected', reason: 'output-limit' });
    expect(toHtml).not.toHaveBeenCalled();
  });

  it('bounds repeated URL units before serialization', () => {
    const result = prepared(prepareClipboardHTML('<img src="cid:first"><img src="cid:second">', { ...LIMITS, maxOutputUnits: SRC.length * 2 - 1 }));
    expect(materializeResolvedClipboardHTML(result.handle, new Map([['image:1', image()], ['image:2', image()]]), policy)).toEqual({ status: 'rejected', reason: 'output-limit' });
    expect(toHtml).not.toHaveBeenCalled();
  });

  it('quarantines unreadable resource metadata and consumes the preparation', () => {
    const result = prepared(prepareClipboardHTML('<img src="cid:owned">', LIMITS));
    const resource = { get src(): string { throw new Error('Private value'); }, pixels: 1 };
    expect(materializeResolvedClipboardHTML(result.handle, new Map([['image:1', resource]]), policy)).toEqual({ status: 'rejected', reason: 'invalid-resolution' });
    expect(materializeResolvedClipboardHTML(result.handle, new Map(), policy)).toEqual({ status: 'rejected', reason: 'expired-preparation' });
  });
});

describe('private clipboard HTML preparation', () => {
  it('records removed source images independently of the diagnostic allowance', () => {
    const result = prepared(prepareClipboardHTML(`<p><span onclick="alert(1)">A</span><img src="${DATA}" alt="Missing">B</p>`, LIMITS,
      { allowDataImages: false, limits: { maxDiagnostics: 1 } }));
    expect(result.hasRemovedImages).toBe(true);
    expect(result.references).toEqual([]);
    const output = materialized(result.handle);
    expect(output.html).toBe('<p><span>A</span>MissingB</p>');
    expect(output.diagnostics).toEqual([expect.objectContaining({ code: 'unsafe-content-removed' })]);
    expect(output.diagnosticsTruncated).toBe(true);
    const retained = prepared(prepareClipboardHTML(`<img src="${DATA}"><img src="cid:reserved">`, LIMITS));
    expect(retained.hasRemovedImages).toBe(false);
    discardPreparedClipboardHTML(retained.handle);
  });

  it('keeps public normalization unchanged and serializes only after explicit resolution', () => {
    const html = '<p>Before<img src="cid:private-image" alt="Diagram">After</p>';
    const baseline = normalizePasteHTML(html);
    expect(baseline.html).toBe('<p>BeforeDiagramAfter</p>');
    vi.mocked(toHtml).mockClear();
    const result = prepared(prepareClipboardHTML(html, LIMITS));
    expect(toHtml).not.toHaveBeenCalled();
    expect(result.references).toEqual([{ placementId: 'image:1', rawReference: 'cid:private-image', sourceOffset: 9, alt: 'Diagram' }]);
    const output = materialized(result.handle, new Map([['image:1', DATA]]));
    expect(output.html).toBe(`<p>Before<img alt="Diagram" src="${DATA}">After</p>`);
    expect(output.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'image-removed' }));
    expect(toHtml).toHaveBeenCalledTimes(1);
    expect(normalizePasteHTML(html)).toEqual(baseline);
  });

  it.each(['cid:photo', 'CID:PHOTO', 'file:///private/photo.png', 'blob:owned-reference', 'images/photo.png'])('reserves a recoverable %s reference without choosing a file', rawReference => {
    const result = prepared(prepareClipboardHTML(`<img src="${rawReference}" alt="Image">`, LIMITS));
    expect(result.references).toEqual([{ placementId: 'image:1', rawReference, sourceOffset: 0, alt: 'Image' }]);
    expect(materializeClipboardHTML(result.handle, new Map())).toEqual({ status: 'rejected', reason: 'missing-image' });
  });

  it.each(['https://remote.test/p.png', '//remote.test/p.png', '#image', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'cid:two words', 'cid:tab&#9;here', ''])('does not create a recoverable slot for %s', rawReference => {
    const result = prepared(prepareClipboardHTML(`<p><img src="${rawReference}" alt="Keep"></p>`, LIMITS));
    expect(result.references).toEqual([]);
    expect(materialized(result.handle).html).toBe('<p>Keep</p>');
  });

  it('uses owned tree data rather than an attacker-supplied slot attribute', () => {
    const result = prepared(prepareClipboardHTML(
      '<p data-domternal-clipboard-image-slot="image:1">Before<img data-domternal-clipboard-image-slot="image:1" domternalClipboardImageSlot="image:1" alt="Unowned"><img src="cid:real" data-domternal-clipboard-image-slot="image:999" alt="Owned">After</p>', LIMITS,
    ));
    expect(result.references).toHaveLength(1);
    const output = materialized(result.handle, new Map([['image:1', DATA]]));
    expect(output.html).toBe(`<p>BeforeUnowned<img alt="Owned" src="${DATA}">After</p>`);
    expect(output.html).not.toMatch(/ClipboardImageSlot|data-domternal|cid:|image:999/iu);
  });

  it('preserves exact sibling and list placement, alt, dimensions, and supported image styling', () => {
    const result = prepared(prepareClipboardHTML(
      '<ol start="7"><li><p>Left<strong>Bold</strong><img src="file:///first.png" alt="First" width="120" height="80" data-align="right" style="float:left">Middle<img src="cid:second" alt="Second">Right</p></li></ol><p>After</p>', LIMITS,
    ));
    expect(result.references.map(reference => reference.placementId)).toEqual(['image:1', 'image:2']);
    // Reverse Map insertion order to prove replacement follows placement identity.
    const output = materialized(result.handle, new Map([['image:2', DATA], ['image:1', DATA]]));
    expect(output.html).toBe(`<ol start="7"><li><p>Left<span><strong>Bold</strong></span><img data-align="right" style="float:left" alt="First" width="120" height="80" src="${DATA}">Middle<img alt="Second" src="${DATA}">Right</p></li></ol><p>After</p>`);
    expect(result.references[0]).toMatchObject({ alt: 'First', width: 120, height: 80 });
  });

  it('keeps owned slots in reconstructed Office list items', () => {
    const html = '<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">7.<span>&nbsp; </span></span>Seven<img src="cid:first" alt="A"></p>' +
      '<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">8.<span>&nbsp; </span></span>Eight<img src="cid:second" alt="B"></p>';
    const result = prepared(prepareClipboardHTML(html, LIMITS));
    expect(result.preserveOrderedListStart).toBe(true);
    expect(materialized(result.handle, new Map([['image:1', DATA], ['image:2', DATA]])).html)
      .toBe(`<ol style="list-style-type:decimal" start="7"><li><p>Seven<img alt="A" src="${DATA}"></p></li><li><p>Eight<img alt="B" src="${DATA}"></p></li></ol>`);
  });

  it('keeps existing data images separate from unresolved file placements', () => {
    const result = prepared(prepareClipboardHTML(`<p><img src="${DATA}" alt="Existing">Between<img src="file:///new.png" alt="New"></p>`, LIMITS));
    expect(result.existingImagePixels).toBe(1);
    expect(result.references.map(reference => reference.rawReference)).toEqual(['file:///new.png']);
    expect(materialized(result.handle, new Map([['image:1', DATA]])).html)
      .toBe(`<p><img src="${DATA}" alt="Existing">Between<img alt="New" src="${DATA}"></p>`);
  });

  it('separates source data-image policy from explicitly authorized private replacements', () => {
    // The private caller must independently validate destination allowEmbedded before
    // supplying this map. Public normalization cannot authorize a replacement.
    const html = `<p><img src="${DATA}" alt="Source"><img src="cid:local" alt="Replacement"></p>`;
    const result = prepared(prepareClipboardHTML(html, LIMITS, { allowDataImages: false }));
    expect(result.existingImagePixels).toBe(0);
    expect(result.references.map(reference => reference.rawReference)).toEqual(['cid:local']);
    expect(materialized(result.handle, new Map([['image:1', DATA]])).html)
      .toBe(`<p>Source<img alt="Replacement" src="${DATA}"></p>`);
    expect(normalizePasteHTML(html, { allowDataImages: false }).html).toBe('<p>SourceReplacement</p>');
  });

  it('keeps the preparation opaque and raw references out of materialized HTML and diagnostics', () => {
    const result = prepared(prepareClipboardHTML('<img src="file:///private/customer/report.png" alt="Diagram">', LIMITS));
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.handle)).toBe(true);
    expect(Object.getPrototypeOf(result.handle)).toBeNull();
    expect(Reflect.ownKeys(result.handle)).toEqual([]);
    expect(Object.isFrozen(result.references)).toBe(true);
    expect(Object.isFrozen(result.references[0])).toBe(true);
    expect(result).not.toHaveProperty('html');
    expect(result).not.toHaveProperty('normalization');
    const output = materialized(result.handle, new Map([['image:1', DATA]]));
    expect(JSON.stringify(output)).not.toMatch(/private|customer|report\.png|file:/u);
  });

  it('uses no DOM, object URLs, fetch, or image decoder', () => {
    expect(typeof document).toBe('undefined');
    const forbidden = vi.fn(() => { throw new Error('Unexpected resource access'); });
    for (const name of ['fetch', 'Image', 'DOMParser', 'XMLHttpRequest', 'createImageBitmap']) vi.stubGlobal(name, forbidden);
    vi.spyOn(URL, 'createObjectURL').mockImplementation(forbidden);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(forbidden);
    const result = prepared(prepareClipboardHTML(`<p><img src="${DATA}"><img src="https://remote.test/image" alt="Remote"><img src="cid:local" alt="Local"></p>`, LIMITS));
    expect(materialized(result.handle, new Map([['image:1', DATA]])).html).toContain('Remote');
    expect(forbidden).not.toHaveBeenCalled();
  });

  it('escapes quoted alt text without introducing attributes and bounds dimensions independently', () => {
    const alt = '" onerror="alert(1) & <tag> \'quoted\'';
    const html = '<p>Before<img src="cid:quoted" alt="&quot; onerror=&quot;alert(1) &amp; &lt;tag&gt; &#39;quoted&#39;" width="10000" height="10001">After<img src="cid:invalid" width="1.5" height="-1"></p>';
    const result = prepared(prepareClipboardHTML(html, LIMITS));
    expect(result.references[0]).toMatchObject({ alt, width: 10_000 });
    expect(result.references[0]).not.toHaveProperty('height');
    expect(result.references[1]).not.toHaveProperty('width');
    expect(result.references[1]).not.toHaveProperty('height');
    const output = materialized(result.handle, new Map([['image:1', DATA], ['image:2', DATA]]));
    const images = elements(output.html).filter(node => node.tagName === 'img');
    expect(images[0]?.properties).toEqual({ alt, width: 10_000, src: DATA });
    expect(images[1]?.properties).toEqual({ src: DATA });
    expect(output.html).toMatch(/^<p>Before<img /u);
    expect(output.html).toContain('>After<img ');
  });
});

describe('prepared HTML budgets', () => {
  it('preserves the original two-million-unit input cap independently from the output cap', () => {
    const html = `<p>${'x'.repeat(2_000_000 - 7)}</p>`;
    const result = prepared(prepareClipboardHTML(html, LIMITS));
    expect(materialized(result.handle).html).toBe(html);
    const rejected = prepareClipboardHTML(`${html}x`, LIMITS);
    expect(rejected).toMatchObject({ status: 'rejected', normalization: { status: 'rejected', html: '', diagnostics: [{ code: 'input-limit' }] } });
  });

  it('permits generated raster URLs larger than the source input limit under the separate output budget', () => {
    // PNG permits a text chunk without changing its one-pixel raster dimensions.
    const bytes = PNG.slice(0, -12) + pngTextChunk('x'.repeat(1_500_000)) + PNG.slice(-12);
    const largeData = `data:image/png;base64,${btoa(bytes)}`;
    expect(largeData.length).toBeGreaterThan(2_000_000);
    const result = prepared(prepareClipboardHTML('<img src="cid:large" alt="Large">', LIMITS));
    expect(materialized(result.handle, new Map([['image:1', largeData]])).html)
      .toBe(`<img alt="Large" src="${largeData}">`);
  });

  it('rejects escaped output before calling the serializer or allocating the final string', () => {
    const result = prepared(prepareClipboardHTML(`<p>${'&amp;'.repeat(60)}<img src="cid:one"></p>`, { ...LIMITS, maxOutputUnits: 350 }));
    expect(DATA.length).toBeLessThan(350);
    expect(toHtml).not.toHaveBeenCalled();
    expect(materializeClipboardHTML(result.handle, new Map([['image:1', DATA]])))
      .toEqual({ status: 'rejected', reason: 'output-limit' });
    expect(toHtml).not.toHaveBeenCalled();
  });

  it('counts the same resolved URL at every placement before serialization', () => {
    const result = prepared(prepareClipboardHTML('<img src="cid:one"><img src="cid:two">', { ...LIMITS, maxOutputUnits: DATA.length * 2 - 1 }));
    expect(materializeClipboardHTML(result.handle, new Map([['image:1', DATA], ['image:2', DATA]])))
      .toEqual({ status: 'rejected', reason: 'output-limit' });
    expect(toHtml).not.toHaveBeenCalled();
  });

  it('charges each repeated slot and existing data image against the same pixel budget', () => {
    const html = `<p><img src="${DATA}"><img src="cid:repeat"><img src="cid:repeat"></p>`;
    const denied = prepared(prepareClipboardHTML(html, LIMITS, { limits: { maxImagePixels: 2 } }));
    expect(denied.existingImagePixels).toBe(1);
    expect(materializeClipboardHTML(denied.handle, new Map([['image:1', DATA], ['image:2', DATA]])))
      .toEqual({ status: 'rejected', reason: 'invalid-image' });
    const allowed = prepared(prepareClipboardHTML(html, LIMITS, { limits: { maxImagePixels: 3 } }));
    const output = materialized(allowed.handle, new Map([['image:1', DATA], ['image:2', DATA]]));
    expect(elements(output.html).filter(node => node.tagName === 'img')).toHaveLength(3);
  });

  it('retains alt text and diagnostics for references beyond configured metadata limits', () => {
    const result = prepared(prepareClipboardHTML('<p><img src="cid:a" alt="A"><img src="cid:b" alt="B"><img src="cid:too-long" alt="C"></p>', { ...LIMITS, maxReferences: 1, maxReferenceLength: 5 }));
    expect(result.references).toHaveLength(1);
    const output = materialized(result.handle, new Map([['image:1', DATA]]));
    expect(output.html).toBe(`<p><img alt="A" src="${DATA}">BC</p>`);
    expect(output.diagnostics.filter(diagnostic => diagnostic.code === 'image-removed')).toHaveLength(2);
  });

  it('counts safe source images and unresolved placements under the original image-count cap', () => {
    const result = prepared(prepareClipboardHTML(`<p><img src="${DATA}" alt="Existing"><img src="cid:first" alt="First"><img src="cid:second" alt="Second"></p>`, LIMITS, { limits: { maxImages: 2 } }));
    expect(result.references.map(reference => reference.rawReference)).toEqual(['cid:first']);
    const output = materialized(result.handle, new Map([['image:1', DATA]]));
    expect(output.html).toBe(`<p><img src="${DATA}" alt="Existing"><img alt="First" src="${DATA}">Second</p>`);
    expect(output.diagnostics).toContainEqual(expect.objectContaining({ code: 'image-removed' }));
  });

  it('does not silently truncate a reference description', () => {
    const result = prepared(prepareClipboardHTML('<img src="cid:one" alt="Complete">', { ...LIMITS, maxDescriptionLength: 3 }));
    expect(result.references).toEqual([]);
    expect(materialized(result.handle).html).toBe('Complete');
  });

  it('snapshots caller limits and normalization options before later materialization', () => {
    const limits = { ...LIMITS };
    const options = { limits: { maxImagePixels: 1 } };
    const result = prepared(prepareClipboardHTML('<img src="cid:one"><img src="cid:two">', limits, options));
    limits.maxOutputUnits = 1;
    options.limits.maxImagePixels = 100;
    expect(materializeClipboardHTML(result.handle, new Map([['image:1', DATA], ['image:2', DATA]])))
      .toEqual({ status: 'rejected', reason: 'invalid-image' });
  });

  it.each(['maxReferences', 'maxReferenceLength', 'maxDescriptionLength', 'maxOutputUnits'] as const)('rejects invalid numeric %s limits', name => {
    for (const value of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined, '100']) {
      expect(() => prepareClipboardHTML('<p>Safe</p>', { ...LIMITS, [name]: value }), String(value)).toThrow(RangeError);
    }
  });

  it.each([
    ['maxReferences', 201],
    ['maxReferenceLength', 2_000_001],
    ['maxDescriptionLength', 2_000_001],
    ['maxOutputUnits', 32 * 1024 * 1024 + 1],
  ] as const)('does not permit raising the hard %s maximum', (name, value) => {
    expect(() => prepareClipboardHTML('<p>Safe</p>', { ...LIMITS, [name]: value })).toThrow(RangeError);
  });
});

describe('prepared HTML resolution lifecycle', () => {
  it('requires explicit omission consent and preserves omitted alt text in its exact position', () => {
    const html = '<p>Before<img src="cid:first" alt="First">Between<img src="cid:second" alt="Second">After</p>';
    const denied = prepared(prepareClipboardHTML(html, LIMITS));
    expect(materializeClipboardHTML(denied.handle, new Map([['image:2', DATA]])))
      .toEqual({ status: 'rejected', reason: 'missing-image' });
    const allowed = prepared(prepareClipboardHTML(html, LIMITS));
    const output = materializeClipboardHTML(allowed.handle, new Map([['image:2', DATA]]), { omitUnresolved: true });
    expect(output).toMatchObject({ status: 'materialized', normalization: {
      html: `<p>BeforeFirstBetween<img alt="Second" src="${DATA}">After</p>`,
      diagnostics: [{ code: 'image-removed', severity: 'warning', offset: html.indexOf('<img') }],
      diagnosticsTruncated: false,
    } });
    expect(JSON.stringify(output)).not.toMatch(/cid:first|cid:second/u);
  });

  it('caps omission diagnostics without losing sibling text or resolved images', () => {
    const html = '<p><img src="cid:first" alt="A">1<img src="cid:second" alt="B">2<img src="cid:third" alt="C">3</p>';
    const result = prepared(prepareClipboardHTML(html, LIMITS, { limits: { maxDiagnostics: 1 } }));
    expect(materializeClipboardHTML(result.handle, new Map(), { omitUnresolved: true }))
      .toMatchObject({ status: 'materialized', normalization: { html: '<p>A1B2C3</p>', diagnostics: [{ code: 'image-removed' }], diagnosticsTruncated: true } });
  });

  it('shares the diagnostic cap with warnings produced during normalization', () => {
    const result = prepared(prepareClipboardHTML('<p onclick="bad()">Before<img src="cid:one" alt="A">After</p>', LIMITS, { limits: { maxDiagnostics: 1 } }));
    const output = materializeClipboardHTML(result.handle, new Map(), { omitUnresolved: true });
    expect(output).toMatchObject({ status: 'materialized', normalization: { html: '<p>BeforeAAfter</p>', diagnosticsTruncated: true } });
    if (output.status !== 'materialized') throw new Error('Expected omission result');
    expect(output.normalization.diagnostics).toHaveLength(1);
  });

  it('rejects unknown resolution keys even when omissions are explicitly accepted', () => {
    const result = prepared(prepareClipboardHTML('<img src="cid:one">', LIMITS));
    expect(materializeClipboardHTML(result.handle, new Map([['image:999', DATA]]), { omitUnresolved: true }))
      .toEqual({ status: 'rejected', reason: 'invalid-resolution' });
  });

  it('rejects extra map entries without processing their content', () => {
    const result = prepared(prepareClipboardHTML('<img src="cid:one">', LIMITS));
    expect(materializeClipboardHTML(result.handle, new Map([['image:1', DATA], ['extra', DATA]])))
      .toEqual({ status: 'rejected', reason: 'invalid-resolution' });
  });

  it.each(['javascript:alert(1)', 'https://remote.test/a.png', 'file:///a.png', 'blob:local', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,YWJjZA=='])('rejects an unsafe or unqualified resolved URL: %s', url => {
    const result = prepared(prepareClipboardHTML('<img src="cid:one">', LIMITS));
    expect(materializeClipboardHTML(result.handle, new Map([['image:1', url]])))
      .toEqual({ status: 'rejected', reason: 'invalid-image' });
    expect(toHtml).not.toHaveBeenCalled();
    expect(materializeClipboardHTML(result.handle, new Map([['image:1', DATA]])))
      .toEqual({ status: 'rejected', reason: 'expired-preparation' });
  });

  it('consumes successful and rejected preparations exactly once', () => {
    const first = prepared(prepareClipboardHTML('<img src="cid:one">', LIMITS));
    materialized(first.handle, new Map([['image:1', DATA]]));
    expect(materializeClipboardHTML(first.handle, new Map([['image:1', DATA]])))
      .toEqual({ status: 'rejected', reason: 'expired-preparation' });
    const second = prepared(prepareClipboardHTML('<img src="cid:two">', LIMITS));
    expect(materializeClipboardHTML(second.handle, new Map())).toEqual({ status: 'rejected', reason: 'missing-image' });
    expect(materializeClipboardHTML(second.handle, new Map(), { omitUnresolved: true }))
      .toEqual({ status: 'rejected', reason: 'expired-preparation' });
  });

  it('discards only the specified preparation and rejects forged handles', () => {
    const first = prepared(prepareClipboardHTML('<p>First</p>', LIMITS));
    const second = prepared(prepareClipboardHTML('<p>Second</p>', LIMITS));
    discardPreparedClipboardHTML(first.handle);
    discardPreparedClipboardHTML(first.handle);
    expect(materializeClipboardHTML(first.handle, new Map())).toEqual({ status: 'rejected', reason: 'expired-preparation' });
    expect(materializeClipboardHTML(Object.freeze({}) as PreparedClipboardHTML, new Map())).toEqual({ status: 'rejected', reason: 'expired-preparation' });
    expect(materialized(second.handle).html).toBe('<p>Second</p>');
  });

  it('expires the handle even when a resolution getter throws', () => {
    const result = prepared(prepareClipboardHTML('<img src="cid:one">', LIMITS));
    const hostile = new Map<string, string>();
    Object.defineProperty(hostile, 'size', { get() { throw new Error('Caller map failed'); } });
    expect(materializeClipboardHTML(result.handle, hostile)).toEqual({ status: 'rejected', reason: 'invalid-resolution' });
    expect(materializeClipboardHTML(result.handle, new Map([['image:1', DATA]]))).toEqual({ status: 'rejected', reason: 'expired-preparation' });
  });
});

describe('the heading outline of a prepared paste', () => {
  const lacksFive = (features: readonly PasteDestinationFeature[]): readonly PasteDestinationFeature[] =>
    features.filter(feature => feature === 'heading-5' || feature === 'heading-6');

  it('travels with the provisional and the final normalization', () => {
    const html = '<h2>Two</h2><h5>Five</h5><p><img src="cid:chart" alt="Chart"></p>';
    const result = prepared(prepareClipboardHTML(html, LIMITS, {}, undefined, undefined, lacksFive));
    const provisional = readPreparedClipboardHTMLNormalization(result.handle);
    expect(provisional?.diagnostics.map(item => item.code)).toEqual(['destination-heading-level-adapted']);
    expect(headingOutline(provisional)).toEqual([false, true]);
    const final = materialized(result.handle, new Map([['image:1', DATA]]));
    expect(final.html).toContain('<h4>Five</h4>');
    expect(headingOutline(final)).toEqual([false, true]);
    const omitted = prepared(prepareClipboardHTML(html, LIMITS, {}, undefined, undefined, lacksFive));
    const output = materializeClipboardHTML(omitted.handle, new Map(), { omitUnresolved: true });
    if (output.status !== 'materialized') throw new Error('Expected a materialized paste');
    expect(output.normalization.diagnostics.map(item => item.code)).toEqual(['destination-heading-level-adapted', 'image-removed']);
    expect(headingOutline(output.normalization)).toEqual([false, true]);
  });

  it('travels with a normalization whose images a resolver placed', () => {
    const policy = createClipboardResolvedSourcePolicy(['https://cdn.example']);
    const result = prepared(prepareClipboardHTML('<h5>Five</h5><p><img src="cid:chart" alt="Chart"></p>', LIMITS, {}, undefined, undefined, lacksFive));
    const output = materializeResolvedClipboardHTML(result.handle, new Map([['image:1', { src: 'https://cdn.example/chart.png', pixels: 1 }]]), policy);
    if (output.status !== 'materialized') throw new Error('Expected a materialized paste');
    expect(output.normalization.html).toContain('src="https://cdn.example/chart.png"');
    expect(headingOutline(output.normalization)).toEqual([true]);
  });

  it('has no outline when no heading was renamed', () => {
    const result = prepared(prepareClipboardHTML('<h2>Two</h2><p><img src="cid:chart" alt="Chart"></p>', LIMITS, {}, undefined, undefined, lacksFive));
    expect(headingOutline(readPreparedClipboardHTMLNormalization(result.handle))).toBeUndefined();
    expect(headingOutline(materialized(result.handle, new Map([['image:1', DATA]])))).toBeUndefined();
  });
});
