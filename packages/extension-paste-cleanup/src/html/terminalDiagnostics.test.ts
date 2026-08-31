// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizePasteHTML } from './index.js';
import { normalizeClipboardHTML, retainDiagnostic } from './normalize.js';
import type { PasteDestinationFeature } from './destinationDemand.js';
import type { PasteDiagnostic } from './types.js';

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

  it('lets a terminal error displace an earlier info before a later warning', () => {
    const html = '<p><span style="color:red">a</span><span style="mso-font-kerning:0pt">b</span></p>'
      + '<p><span style="font-weight:700;font-style:italic">t</span></p>'.repeat(3);
    const options = { formatting: 'adapt', limits: { maxNodes: 18 } } as const;
    const roomy = normalizePasteHTML(html, { ...options, limits: { ...options.limits, maxDiagnostics: 3 } });
    expect(roomy).toMatchObject({ status: 'rejected', html: '', diagnosticsTruncated: false });
    expect(roomy.diagnostics).toEqual([
      { code: 'formatting-adapted', severity: 'info', offset: html.indexOf('<span') },
      { code: 'unsupported-formatting', severity: 'warning', offset: html.indexOf('<span style="mso') },
      { code: 'structure-limit', severity: 'error' },
    ]);

    const result = normalizePasteHTML(html, { ...options, limits: { ...options.limits, maxDiagnostics: 2 } });
    expect(result).toMatchObject({ status: 'rejected', html: '', diagnosticsTruncated: true });
    expect(result.diagnostics).toEqual([roomy.diagnostics[1], roomy.diagnostics[2]]);
  });
});

describe('retainDiagnostic', () => {
  const info = (offset: number): PasteDiagnostic => ({ code: 'formatting-adapted', severity: 'info', offset });
  const warn = (offset: number): PasteDiagnostic => ({ code: 'unsupported-formatting', severity: 'warning', offset });
  const error: PasteDiagnostic = { code: 'structure-limit', severity: 'error' };

  it('appends without truncation while the allowance has room', () => {
    const retained = [info(1)];
    expect(retainDiagnostic(retained, warn(2), 2)).toBe(false);
    expect(retained).toEqual([info(1), warn(2)]);
  });

  it('replaces the least severe retained finding, not the newest less severe one', () => {
    const retained = [info(1), warn(2)];
    expect(retainDiagnostic(retained, error, 2)).toBe(true);
    expect(retained).toEqual([warn(2), error]);
  });

  it('replaces the newest of equally least severe findings and keeps emission order', () => {
    const retained = [info(1), info(2), warn(3)];
    expect(retainDiagnostic(retained, error, 3)).toBe(true);
    expect(retained).toEqual([info(1), warn(3), error]);

    const mixed = [warn(1), info(2), warn(3), info(4)];
    expect(retainDiagnostic(mixed, warn(5), 4)).toBe(true);
    expect(mixed).toEqual([warn(1), info(2), warn(3), warn(5)]);
  });

  it.each([
    ['an info among infos', [info(1), info(2)], info(3)],
    ['a warning among warnings and errors', [warn(1), error], warn(3)],
    ['an error among errors', [error, error], error],
  ])('drops %s and reports truncation', (_, initial, next) => {
    const retained = [...initial];
    expect(retainDiagnostic(retained, next, 2)).toBe(true);
    expect(retained).toEqual(initial);
  });
});
