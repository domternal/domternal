// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizeClipboardHTML } from './normalize.js';
import type { NormalizePasteHTMLOptions, NormalizePasteHTMLResult } from './types.js';
import type { PasteDestinationFeature } from './destinationDemand.js';

// English authored variants of the Google Docs run and image shapes in Chrome, with synthetic data images rather than new native captures.
const RUN = 'font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;'
  + 'font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;';
const paragraph = (text: string): string => `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="${RUN}">${text}</span></p>`;
const docs = (content: string): string =>
  `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-a5c727ca-7fff-16a5-f500-346b1a0df84d">${content}</b><br class="Apple-interchange-newline">`;
const warnings = (result: NormalizePasteHTMLResult): string[] => result.diagnostics.filter(diagnostic => diagnostic.severity !== 'info').map(diagnostic => diagnostic.code);
/** The cleanup the editor runs, with a destination that lacks the given features. */
const pasted = (html: string, missing: readonly PasteDestinationFeature[], options: NormalizePasteHTMLOptions = {}): NormalizePasteHTMLResult =>
  normalizeClipboardHTML(html, options, undefined, undefined, features => features.filter(feature => missing.includes(feature))).result;

describe('images a destination cannot hold', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
  const imageParagraph = (alt: string, src = PNG): string => `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="${RUN}">`
    + `<img alt="${alt}" src="${src}" width="320" height="200" style="border:none;" /></span></p>`;
  const html = docs(paragraph('GI02 Text before the picture.') + imageParagraph('GI03 Blue rectangle') + paragraph('GI04 Text after the picture.'));

  it('removes a data image a destination\'s image refuses, as a refused source, with its alt text in its place', () => {
    // Image with allowBase64 false parsed the data URL without its source, a broken picture, with no finding.
    const refused = pasted(html, ['image-data']);
    expect(warnings(refused)).toEqual(['image-removed']);
    expect(refused.html).not.toContain('<img');
    expect(refused.html).toContain('GI03 Blue rectangle');
    const held = pasted(html, []);
    expect(warnings(held)).toEqual([]);
    expect(held.html).toContain(`src="${PNG}"`);
  });

  it('removes every image in a destination without an image node, data and remote alike, with its alt text in its place', () => {
    // Images and their alt text vanished without a finding, and a copy of one image was a silent empty paste.
    const only = docs(`<span style="${RUN}"><img alt="GI03 Blue rectangle" src="${PNG}" width="320" height="200" style="border:none;" /></span>`);
    const result = pasted(only, ['image', 'image-data']);
    expect(warnings(result)).toEqual(['image-removed']);
    expect(result.html).toContain('GI03 Blue rectangle');
    const remote = pasted('<p><img src="https://example.com/remote.png" alt="Remote"></p>', ['image', 'image-data'], { allowRemoteImages: true });
    expect(warnings(remote)).toEqual(['image-removed']);
    expect(remote.html).toBe('<p>Remote</p>');
  });

  it('asks the destination once for each kind of source a paste holds', () => {
    const asked: string[][] = [];
    normalizeClipboardHTML(html + imageParagraph('GI05 Green square'), {}, undefined, undefined, features => { asked.push([...features]); return []; });
    expect(asked.filter(features => features.some(feature => feature.startsWith('image')))).toEqual([['image-data']]);
  });
});
