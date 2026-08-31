// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizePasteHTML } from './index.js';
import { normalizeClipboardHTML } from './normalize.js';
import type { PasteDestinationFeature } from './destinationDemand.js';

const warnings = '<p style="position:fixed">A</p><p style="position:fixed">B</p><p style="position:fixed">C</p>';
const warning = { code: 'unsupported-formatting', severity: 'warning' };

describe('terminal rejection reason under a full diagnostic allowance', () => {
  it.each([
    ['generated inherited formatting', 16, '<p><span style="color:red">x</span><span style="color:red">y</span><span style="color:red">z</span></p>'],
    ['the final output tree', 13, '<p data-pm-slice="1 1 []"><span style="font-weight:700;font-style:italic;text-decoration:underline line-through">T</span></p>'],
  ])('keeps structure-limit after warnings fill the allowance: %s', (_, maxNodes, tail) => {
    const html = warnings + tail;
    const roomy = normalizePasteHTML(html, { limits: { maxNodes, maxDiagnostics: 10 } });
    expect(roomy.diagnostics.map(item => item.code)).toEqual(['unsupported-formatting', 'unsupported-formatting', 'unsupported-formatting', 'structure-limit']);

    const result = normalizePasteHTML(html, { limits: { maxNodes, maxDiagnostics: 2 } });
    expect(result).toMatchObject({ status: 'rejected', html: '', diagnosticsTruncated: true });
    expect(result.diagnostics).toEqual([expect.objectContaining(warning), { code: 'structure-limit', severity: 'error' }]);
  });

  it('keeps parse-failed when a destination check throws after warnings fill the allowance', () => {
    const { result } = normalizeClipboardHTML(`${warnings}<p><strong>S</strong></p>`, { limits: { maxDiagnostics: 1 } },
      undefined, undefined, () => { throw new Error('probe failed'); });
    expect(result).toMatchObject({ status: 'rejected', html: '', diagnosticsTruncated: true });
    expect(result.diagnostics).toEqual([{ code: 'parse-failed', severity: 'error' }]);
  });

  it('keeps an unsupported table refusal with a single-entry allowance', () => {
    const unsupported = (features: readonly PasteDestinationFeature[]): readonly PasteDestinationFeature[] => features.filter(feature => feature === 'table');
    const { result, destinationRejected } = normalizeClipboardHTML(`${warnings}<table><tr><td>Cell</td></tr></table>`,
      { limits: { maxDiagnostics: 1 } }, undefined, undefined, unsupported);
    expect(destinationRejected).toBe(true);
    expect(result).toMatchObject({ status: 'rejected', html: '', diagnosticsTruncated: true });
    expect(result.diagnostics).toEqual([{ code: 'destination-table-unsupported', severity: 'error' }]);
  });

  it('appends the terminal error without truncation when the allowance has room', () => {
    const tail = '<p><span style="color:red">x</span><span style="color:red">y</span><span style="color:red">z</span></p>';
    const result = normalizePasteHTML(warnings + tail, { limits: { maxNodes: 16, maxDiagnostics: 4 } });
    expect(result.status).toBe('rejected');
    expect(result.diagnosticsTruncated).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining(warning), expect.objectContaining(warning), expect.objectContaining(warning),
      { code: 'structure-limit', severity: 'error' },
    ]);
  });

  it('keeps truncating ordinary findings without inventing an error', () => {
    const result = normalizePasteHTML(warnings.repeat(3), { limits: { maxDiagnostics: 2 } });
    expect(result.status).toBe('cleaned');
    expect(result.diagnosticsTruncated).toBe(true);
    expect(result.diagnostics).toEqual([expect.objectContaining(warning), expect.objectContaining(warning)]);
  });
});

describe('severity priority under a full diagnostic allowance', () => {
  const adaptedRun = '<p><span style="font-family:Calibri;font-size:11pt;color:#1F3864">t</span></p>';

  it('keeps early link and image losses ahead of informational adaptation', () => {
    const html = `<p><a href="javascript:alert(1)">bad</a><img src="http://remote.test/x.png" alt="A"></p>${adaptedRun.repeat(40)}`;
    const result = normalizePasteHTML(html, { formatting: 'adapt' });
    expect(result.status).toBe('cleaned');
    expect(result.diagnosticsTruncated).toBe(true);
    expect(result.diagnostics).toHaveLength(100);
    expect(result.diagnostics.filter(item => item.severity !== 'info')).toEqual([
      { code: 'link-removed', severity: 'warning', offset: html.indexOf('<a ') },
      { code: 'image-removed', severity: 'warning', offset: html.indexOf('<img') },
    ]);
  });

  it('never lets an informational finding displace a warning', () => {
    const result = normalizePasteHTML(`${warnings}<p><span style="color:red">x</span></p>`, { formatting: 'adapt', limits: { maxDiagnostics: 2 } });
    expect(result.diagnosticsTruncated).toBe(true);
    expect(result.diagnostics).toEqual([expect.objectContaining(warning), expect.objectContaining(warning)]);
  });

  it('keeps retained findings in emission order after a displacement', () => {
    const html = `${'<p><span style="color:red">x</span></p>'.repeat(3)}<p style="position:fixed">late</p>`;
    const result = normalizePasteHTML(html, { formatting: 'adapt', limits: { maxDiagnostics: 3 } });
    expect(result.diagnosticsTruncated).toBe(true);
    expect(result.diagnostics.map(item => item.code)).toEqual(['formatting-adapted', 'formatting-adapted', 'unsupported-formatting']);
    expect(result.diagnostics.at(-1)?.offset).toBe(html.indexOf('<p style="position:fixed">'));
  });
});
