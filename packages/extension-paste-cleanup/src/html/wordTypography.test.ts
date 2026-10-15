// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Element } from 'hast';
import { parseBoundedHTML } from './parse.js';
import { DEFAULT_PASTE_HTML_LIMITS } from './normalize.js';
import { normalizeClipboardHTML, normalizePasteHTML } from './normalize.js';
import { applyWordTypography } from './wordTypography.js';
import { InheritanceLimitError } from './inheritance.js';

function applied(css: string, body = '<p class="Normal">Text</p>', maximum = 100_000): { styles: unknown[]; warnings: string[] } {
  const tree = parseBoundedHTML(`<style>${css}</style>${body}`, DEFAULT_PASTE_HTML_LIMITS);
  const warnings: Element[] = [];
  applyWordTypography(tree, { maxNodes: 1000, maxInputLength: maximum }, node => { warnings.push(node); });
  const elements: Element[] = [];
  const visit = (node: Element): void => {
    if (node.tagName !== 'style') elements.push(node);
    for (const child of node.children) if (child.type === 'element') visit(child);
  };
  for (const node of tree.children) if (node.type === 'element') visit(node);
  return { styles: elements.map(node => node.properties.style), warnings: warnings.map(node => node.tagName) };
}

describe('bounded Word class typography', () => {
  it('keeps font spelling and each property from a combined Word selector', () => {
    expect(applied('p.Normal, li.Normal, div.Normal {font-family:"Aptos Display", serif;font-size:12pt;color:#123456}'))
      .toEqual({ styles: ['font-family:"Aptos Display", serif;font-size:12pt;color:#123456'], warnings: [] });
  });
  it.each([
    ['p{color:green}.Normal{color:red}', 'color:red'],
    ['p.Normal{color:red}.Normal{color:blue}', 'color:red'],
    ['.Normal{color:red}.Normal{color:blue}', 'color:blue'],
    ['.Normal{color:red !important}.Normal{color:blue}', 'color:red'],
    ['.Normal{color:red !important}.Normal{color:blue!important}', 'color:blue'],
    ['p.Normal{color:red!important}.Normal{color:blue!important}', 'color:red'],
    ['p.normal{color:blue}p.Normal{color:red}', 'color:red'],
    ['P.Normal{color:red}span.Normal{color:blue}', 'color:red'],
    ['.Normal{color:red;color:blue}', 'color:blue'],
    ['.Normal{color:red!important;color:blue}', 'color:red'],
    ['/* heading */ p.Normal{/* first */color: /* color */ red}', 'color:red'],
  ])('resolves cascade and selector identity in %s', (css, expected) => {
    expect(applied(css)).toEqual({ styles: [expected], warnings: [] });
  });
  it.each([
    ['color:blue', '.Normal{color:red}', 'color:blue'],
    ['color:blue', '.Normal{color:red!important}', 'color:red'],
    ['color:blue!important', '.Normal{color:red!important}', 'color:blue'],
    ['color:blue !important;color:green', '.Normal{color:red}', 'color:blue'],
    ['margin:0;color:blue', '.Normal{font-family:Aptos;color:red}', 'margin:0;font-family:Aptos;color:blue'],
  ])('compares the inline declaration %s with its class', (style, css, expected) => {
    expect(applied(css, `<p class="Normal" style="${style}">Text</p>`)).toEqual({ styles: [expected], warnings: [] });
  });
  it('does not depend on class attribute order or duplicate class names', () => {
    const css = '.A{color:red}.B{color:blue}';
    expect(applied(css, '<p class="B A A">Text</p>')).toEqual({ styles: ['color:blue'], warnings: [] });
  });
  it.each([
    ['.Normal{color:red;color:banana}', 'color:red'],
    ['.Normal{font-size:12pt;font-size:banana}', 'font-size:12pt'],
    ['.Normal{font-size:12pt;font-size:-3pt}', 'font-size:12pt'],
  ])('does not let an invalid later value erase a valid declaration: %s', (css, style) => {
    expect(applied(css)).toEqual({ styles: [style], warnings: [] });
  });
  it('ignores an invalid inline color while retaining the class color', () => {
    expect(applied('.Normal{color:red}', '<p class="Normal" style="color:banana">Text</p>'))
      .toEqual({ styles: ['color:red'], warnings: [] });
  });
  it.each([
    '.Normal{color:red}.Normal{color:blue',
    '@namespace "urn:other";.Normal{color:red}',
    '@import "https://style.invalid/a.css";.Normal{color:red}',
    '.Normal{color:red}.Normal{c\\6flor:blue}',
    '.Normal{color:red}.Normal{color:var(--source-color)}',
    '.Normal{font-size:12pt}.Normal{font-size:larger}',
    '.Normal{color:red}.Normal{color:CanvasText}',
  ])('reports an incomplete or unsupported cascade without partially flattening it: %s', css => {
    expect(applied(css)).toEqual({ styles: [undefined], warnings: ['style'] });
  });
  it.each(['c\\6flor:blue', 'f\\6fnt:12pt serif', 'color:"unfinished', 'font-size:var(--size)'])('retains an inline style it cannot fully resolve: %s', style => {
    expect(applied('.Normal{color:red}', `<p class="Normal" style='${style}'>Text</p>`))
      .toEqual({ styles: [style], warnings: ['p'] });
  });
  it('reads nested style elements in document order', () => {
    expect(applied('.Normal{color:red}', '<div><style>.Normal{color:blue}</style><p class="Normal">Text</p></div>'))
      .toEqual({ styles: [undefined, 'color:blue'], warnings: [] });
  });
  it('accepts a closed trailing comment without inventing an unknown rule', () => {
    expect(applied('.Normal{color:red}/* end */')).toEqual({ styles: ['color:red'], warnings: [] });
  });
  it.each([
    '.Normal:hover{color:blue}', '.Normal span{color:blue}', '.Normal[data-x]{color:blue}',
    '@media screen{.Normal{color:blue}}', '@layer theme{.Normal{color:blue}}',
    '.Normal{font:12pt serif}', '.Normal{all:initial}', '.Normal{font-family:"a;b"}',
  ])('reports unsupported CSS and leaves inline formatting intact: %s', css => {
    expect(applied(`.Normal{color:red}${css}`, '<p class="Normal" style="color:green">Text</p>'))
      .toEqual({ styles: ['color:green'], warnings: ['style'] });
  });
  it('does not evaluate font resources, list metadata or page layout', () => {
    expect(applied('@font-face{font-family:Aptos;src:url(https://font.invalid/font.woff)}@page{color:red}@list l0:level1{font-family:Symbol}.Normal{color:blue}'))
      .toEqual({ styles: ['color:blue'], warnings: [] });
  });
  it('reports excessive stylesheet rules without partially applying their cascade', () => {
    const css = '.Normal{color:red}'.repeat(1025);
    expect(applied(css)).toEqual({ styles: [undefined], warnings: ['style'] });
  });
  it('bounds a single large selector list before allocating matches', () => {
    expect(applied(`${'.Normal,'.repeat(20_000)}p{color:red}`)).toEqual({ styles: [undefined], warnings: ['style'] });
  });
  it('bounds repeated generated attributes independently of the input parser', () => {
    expect(() => applied('.Normal{font-family:"Long Font Name"}', '<p class="Normal">a</p><p class="Normal">b</p>', 20))
      .toThrow(InheritanceLimitError);
  });
});

describe('Word class typography through normalization', () => {
  const word = (css: string, body: string): string => `<html xmlns:w="urn:schemas-microsoft-com:office:word"><style>${css}</style>${body}</html>`;
  const css = '.Normal{font-family:Georgia,serif;font-size:12pt;color:#123456}.Larger{font-size:150%}';
  it('resolves class typography and relative descendants before sanitizing the document', () => {
    const result = normalizePasteHTML(word(css, '<p class="Normal">First <span class="Larger">larger</span></p>'));
    expect(result.html).toBe('<p><span style="font-family:Georgia,serif;font-size:12pt;color:#123456">First </span>'
      + '<span><span style="font-family:Georgia,serif;font-size:18pt;color:#123456">larger</span></span></p>');
    expect(result.diagnostics).toEqual([]);
  });
  it('adapts class typography without presenting intentional removals as warnings', () => {
    const result = normalizePasteHTML(word(css, '<p class="Normal">Text</p>'), { formatting: 'adapt' });
    expect(result.html).toBe('<p>Text</p>');
    expect(result.diagnostics).not.toEqual([]);
    expect(result.diagnostics.every(diagnostic => diagnostic.code === 'formatting-adapted' && diagnostic.severity === 'info')).toBe(true);
  });
  it('still asks the destination to support the typography recovered from classes', () => {
    const { result } = normalizeClipboardHTML(word(css, '<p class="Normal">Text</p>'), {}, undefined, undefined, features => [...features]);
    expect(result.diagnostics.some(diagnostic => diagnostic.code === 'destination-formatting-unconfirmed')).toBe(true);
  });
  it('does not apply stylesheet typography to ordinary web HTML', () => {
    const result = normalizePasteHTML(`<style>${css}</style><p class="Normal">Text</p>`);
    expect(result.source).toBe('html');
    expect(result.html).toBe('<p>Text</p>');
  });
  it('does not reinterpret a verified own clipboard copy', () => {
    const nonce = 'OwnCopyNonceOwnCopy_-A';
    const body = `<p class="Normal" data-domternal-copy="v1.${nonce}" data-pm-slice="0 0 []">Text</p>`;
    const { result } = normalizeClipboardHTML(word(css, body), {}, undefined, undefined, undefined, value => value === nonce);
    expect(result.source).toBe('word');
    expect(result.html).not.toContain('font-family');
    expect(result.html).not.toContain('color:');
  });
  it('reports unresolved CSS at its source style element while retaining safe direct formatting', () => {
    const html = word('.Normal{font:italic 12pt serif}', '<p class="Normal" style="color:red">Text</p>');
    const result = normalizePasteHTML(html);
    expect(result.html).toBe('<p><span style="color:red">Text</span></p>');
    expect(result.diagnostics).toContainEqual({ code: 'unsupported-formatting', severity: 'warning', offset: html.indexOf('<style>') });
  });
});
