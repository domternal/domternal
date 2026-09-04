// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizePasteHTML } from './index.js';
import type { NormalizePasteHTMLOptions, NormalizePasteHTMLResult } from './index.js';
import { normalizeClipboardHTML } from './normalize.js';
import { cleanMetadata, cleanSliceContext } from './metadata.js';

// A verified own copy: the anchor carries a nonce that the private verifier confirms.
const OWN_NONCE = 'OwnCopyNonceOwnCopy_-A';
function ownCopy(html: string, options: NormalizePasteHTMLOptions = {}): NormalizePasteHTMLResult {
  return normalizeClipboardHTML(html.replace('data-pm-slice', `data-domternal-copy="v1.${OWN_NONCE}" data-pm-slice`),
    options, undefined, undefined, undefined, nonce => nonce === OWN_NONCE).result;
}

function contextOf(value: string | undefined): unknown {
  if (value === undefined) throw new Error('Expected validated clipboard context');
  return JSON.parse(value.slice(value.indexOf('['))) as unknown;
}

describe('validated clipboard metadata', () => {
  it('retains source IDs and thread references for destination collision and comment processing', () => {
    const result = normalizePasteHTML(
      '<p id="block-123"><span data-thread-ids="thread-1  thread-2">Referenced text</span></p>'
    );

    expect(result.status).toBe('cleaned');
    expect(result.html).toBe(
      '<p id="block-123"><span data-thread-ids="thread-1 thread-2">Referenced text</span></p>'
    );
  });

  it('retains checked tasks, color tokens, and bounded table metadata', () => {
    expect(
      cleanMetadata({
        dataType: 'taskItem',
        dataChecked: 'true',
        dataTextColor: 'blue',
        dataBgColor: 'light-yellow',
        dataBackground: '#123456',
        dataTextAlign: 'center',
        dataVerticalAlign: 'middle',
        dataColwidth: '100,200',
      })
    ).toEqual({
      dataType: 'taskItem',
      dataChecked: 'true',
      dataTextColor: 'blue',
      dataBgColor: 'light-yellow',
      dataBackground: '#123456',
      dataTextAlign: 'center',
      dataVerticalAlign: 'middle',
      dataColwidth: '100,200',
    });
    expect(cleanMetadata({ dataType: 'taskItem', dataChecked: 'false' })).toEqual({
      dataType: 'taskItem',
      dataChecked: 'false',
    });
  });

  it.each([
    '__proto__',
    'prototype',
    'constructor',
    'window',
    'document',
    'forms',
    'block id',
    'block<id',
    'a'.repeat(129),
  ])('drops unsafe or reserved IDs: %s', (id) => {
    expect(cleanMetadata({ id })).toEqual({});
  });

  it('bounds thread and table metadata instead of truncating references', () => {
    expect(
      cleanMetadata({
        dataThreadIds: Array.from({ length: 101 }, (_, index) => `thread-${String(index)}`).join(
          ' '
        ),
      })
    ).toEqual({});
    for (const dataColwidth of ['-1,200', '1.5,200', '10001', '1,'.repeat(1001) + '1']) {
      expect(cleanMetadata({ dataColwidth })).toEqual({});
    }
    expect(cleanMetadata({ dataThreadIds: 'valid unsafe<script>' })).toEqual({});
    expect(cleanMetadata({ dataThreadIds: 'valid constructor' })).toEqual({});
    expect(cleanMetadata({ dataThreadIds: 'block id' })).toEqual({ dataThreadIds: 'block id' });
  });

  it.each([
    'url(https://unsafe.test/image)',
    'red;background-image:url(https://unsafe.test/image)',
    'expression(alert(1))',
    'var(--untrusted)',
  ])('does not preserve CSS payloads in metadata: %s', (value) => {
    expect(
      cleanMetadata({
        dataBackground: value,
        dataTextColor: value,
        dataBgColor: value,
        dataTextAlign: value,
        dataVerticalAlign: value,
        dataColwidth: value,
      })
    ).toEqual({});
    expect(
      contextOf(cleanSliceContext(`1 1 ${JSON.stringify(['paragraph', { background: value }])}`))
    ).toEqual(['paragraph', {}]);
  });

  it('ignores unknown data attributes and active HTML properties', () => {
    expect(
      cleanMetadata({
        id: 'safe-block',
        dataType: 'unregistered-node',
        dataUnknown: 'payload',
        onClick: 'alert(1)',
        src: 'https://unsafe.test/image',
        style: 'color:red',
        dataChecked: 'javascript:alert(1)',
      })
    ).toEqual({ id: 'safe-block' });
  });

  it('retains validated nested list attributes and open slice boundaries', () => {
    const context = [
      'orderedList',
      { id: 'list-1', start: 7 },
      'listItem',
      { id: 'item-1' },
      'taskList',
      null,
      'taskItem',
      { id: 'task-1', checked: true },
    ];
    const value = `1 1 -2 ${JSON.stringify(context)}`;

    expect(cleanSliceContext(value)).toBe(value);
    expect(contextOf(cleanSliceContext('1 1 ["paragraph",{"id":null,"textAlign":null}]'))).toEqual([
      'paragraph',
      { id: null, textAlign: null },
    ]);
  });

  it('removes forged active, prototype, and unknown attributes from otherwise valid context', () => {
    const value =
      '1 1 ["orderedList",{"start":7,"id":"list-1","onclick":"alert(1)","src":"https://unsafe.test/image","style":"background:url(https://unsafe.test/image)","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"unknown":null}]';

    expect(contextOf(cleanSliceContext(value))).toEqual([
      'orderedList',
      { start: 7, id: 'list-1' },
    ]);
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
  });

  it('does not retain unknown context keys merely because their values are null', () => {
    const value =
      '1 1 ["paragraph",{"id":null,"onclick":null,"src":null,"style":null,"constructor":null,"__proto__":null}]';
    expect(contextOf(cleanSliceContext(value))).toEqual(['paragraph', { id: null }]);
  });

  it.each([
    '1 1 ["unregisteredNode",{"id":"unsafe"}]',
    '1 1 ["paragraph",{},"unregisteredNode",{}]',
    '1 1 ["paragraph"]',
    '1 1 ["paragraph",[]]',
    '1 1 ["paragraph","not an object"]',
    '1 1 {"paragraph":{}}',
    '1 1 [invalid JSON]',
    '129 1 []',
    '1 129 []',
    '1 1 -129 []',
    '1 1 [] trailing payload',
  ])('ignores invalid or unknown context without trusting it: %s', (value) => {
    expect(cleanSliceContext(value)).toBeUndefined();
    const html = `<p data-pm-slice='${value}' onclick="alert(1)">Safe</p>`;
    expect(normalizePasteHTML(html).html).toBe('<p>Safe</p>');
  });

  it('bounds context arrays and serialized metadata length', () => {
    expect(
      cleanSliceContext(
        `1 1 ${JSON.stringify(Array.from({ length: 65 }, () => ['paragraph', null]).flat())}`
      )
    ).toBeUndefined();
    expect(cleanSliceContext(`1 1 ["paragraph",{"id":"${'a'.repeat(16_384)}"}]`)).toBeUndefined();
    expect(cleanSliceContext(null)).toBeUndefined();
  });

  it('preserves verified own-copy formatting in adapt mode while still removing unsafe HTML', () => {
    const html = '<p data-pm-slice="0 0 []" onclick="alert(1)"><span data-text-color="red" data-bg-color="blue" style="font-family:Arial;font-size:18px;color:#123456;background-image:url(https://unsafe.test/image)">Internal</span><img src="https://unsafe.test/pixel"></p>';
    // A slice marker alone is structural context, so the standalone entry adapts the same markup.
    const external = normalizePasteHTML(html, { formatting: 'adapt' });
    expect(external.html).toBe('<p data-pm-slice="0 0 []"><span>Internal</span></p>');
    const result = ownCopy(html, { formatting: 'adapt' });

    expect(result.status).toBe('cleaned');
    expect(result.html).toContain('data-text-color="red"');
    expect(result.html).toContain('data-bg-color="blue"');
    expect(result.html).toContain('font-family:Arial');
    expect(result.html).toContain('font-size:18px');
    expect(result.html).toContain('color:#123456');
    expect(result.html).not.toMatch(/(?:onclick|unsafe\.test|<img|background-image)/);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unsupported-formatting' })
    );
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'image-removed' }));
  });

  it('does not let an invalid provenance marker disable external formatting adaptation', () => {
    const result = normalizePasteHTML(
      '<p data-pm-slice=\'1 1 ["unknownNode",{}]\'><span style="font-family:Arial;font-size:18px;color:red">External</span></p>',
      { formatting: 'adapt' }
    );

    expect(result.html).toBe('<p><span>External</span></p>');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'formatting-adapted' })
    );
  });
});
