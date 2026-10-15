import { describe, expect, it } from 'vitest';
import { normalizeClipboardHTML } from '../html/normalize.js';
import { headingOutline } from '../html/headingLevels.js';
import { removedText } from '../html/removedText.js';
import { imageStandIns, imageStandInAlts } from '../html/imageStandIns.js';
import {
  consumePreparedClipboardHTMLWithoutAssets, discardPreparedClipboardHTML, materializeClipboardHTML,
  prepareClipboardHTML, readPreparedClipboardHTMLNormalization,
} from './preparedHTML.js';
import type { ClipboardDestinationCheck } from '../html/normalize.js';

const limits = { maxReferences: 10, maxReferenceLength: 1000, maxDescriptionLength: 1000, maxOutputUnits: 8 };

describe('consume an ordinary prepared HTML result', () => {
  it('serializes once without imposing image replacement output limits', () => {
    const html = '<p>Ordinary text &amp; symbols whose markup exceeds eight units</p>';
    const prepared = prepareClipboardHTML(html, limits);
    expect(prepared.status).toBe('prepared');
    if (prepared.status !== 'prepared') throw new Error('Expected a prepared tree');
    const result = consumePreparedClipboardHTMLWithoutAssets(prepared.handle);
    expect(result).toEqual(normalizeClipboardHTML(html).result);
    expect(consumePreparedClipboardHTMLWithoutAssets(prepared.handle)).toBeUndefined();
    expect(readPreparedClipboardHTMLNormalization(prepared.handle)).toBeUndefined();
  });

  it('preserves the private outline and hidden-text metadata on the same result', () => {
    const html = '<h5>Five</h5><h2>Two</h2><p class="MsoNormal" style="display:none;mso-hide:all">Hidden</p>';
    const destination: ClipboardDestinationCheck = features => features.filter(feature => ['heading-5', 'heading-6'].includes(feature));
    const ordinary = normalizeClipboardHTML(html, {}, undefined, undefined, destination);
    const prepared = prepareClipboardHTML(html, limits, {}, undefined, undefined, destination);
    expect(prepared.status).toBe('prepared');
    if (prepared.status !== 'prepared') throw new Error('Expected a prepared tree');
    const result = consumePreparedClipboardHTMLWithoutAssets(prepared.handle);
    expect(result).toEqual(ordinary.result);
    expect(headingOutline(result)).toEqual([true, false]);
    expect(removedText(result)).toBe(true);
  });

  it('keeps private removed-image metadata when a caller consumes a tree without replacement slots', () => {
    const prepared = prepareClipboardHTML('<p><img src="https://example.com/a.png" alt=""><img src="https://example.com/b.png"></p>', limits);
    expect(prepared.status).toBe('prepared');
    if (prepared.status !== 'prepared') throw new Error('Expected a prepared tree');
    const result = consumePreparedClipboardHTMLWithoutAssets(prepared.handle);
    expect(result?.status).toBe('cleaned');
    expect(imageStandIns(result)).toEqual(['', '']);
    expect(imageStandInAlts(result)).toEqual(['', null]);
  });

  it('cannot consume a tree with owned image slots or disturb its later materialization', () => {
    const prepared = prepareClipboardHTML('<p>Figure<img src="cid:figure" alt="Diagram"></p>', { ...limits, maxOutputUnits: 1000 });
    expect(prepared.status).toBe('prepared');
    if (prepared.status !== 'prepared') throw new Error('Expected a prepared tree');
    expect(consumePreparedClipboardHTMLWithoutAssets(prepared.handle)).toBeUndefined();
    expect(readPreparedClipboardHTMLNormalization(prepared.handle)?.status).toBe('cleaned');
    const result = materializeClipboardHTML(prepared.handle, new Map(), { omitUnresolved: true });
    expect(result.status).toBe('materialized');
    if (result.status !== 'materialized') throw new Error('Expected materialization to retain ownership');
    expect(result.normalization.html).toBe('<p>FigureDiagram</p>');
    expect(result.normalization.diagnostics).toContainEqual(expect.objectContaining({ code: 'image-removed' }));
  });

  it('does not revive a discarded preparation', () => {
    const prepared = prepareClipboardHTML('<p>Discarded</p>', limits);
    if (prepared.status !== 'prepared') throw new Error('Expected a prepared tree');
    discardPreparedClipboardHTML(prepared.handle);
    expect(consumePreparedClipboardHTMLWithoutAssets(prepared.handle)).toBeUndefined();
  });
});
