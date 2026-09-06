import { describe, it, expect } from 'vitest';
import { isSafeCssValue } from './isSafeCssValue.js';
import * as core from '../index.js';

describe('isSafeCssValue', () => {
  it.each([
    '#ff0000', '#FFF', 'red', 'transparent', 'currentColor',
    'rgb(1, 2, 3)', 'rgba(1,2,3,0.5)', 'hsl(120 50% 50%)', 'hsla(120, 50%, 50%, .5)', 'hwb(0 0% 0%)',
    'lab(50% 40 59.5)', 'lch(52.2% 72.2 50)', 'oklab(59% 0.1 0.1)', 'oklch(60% 0.15 50)', 'color(display-p3 1 0 0)',
    'var(--brand)', 'var(--brand, #000)', 'calc(1em + 2px)', 'min(10px, 2vw)', 'max(1rem, 12px)', 'clamp(1rem, 2vw, 3rem)',
    'rgb(calc(10 + 5) 0 0)', 'rgb(from red r g b)', 'color-mix(in srgb, var(--x) 20%, transparent)', 'light-dark(#000, #fff)',
    '18px', '1.2em', 'larger', 'xx-small', '120%', '1.5',
    'Arial', 'Times New Roman', 'Times New Roman, serif', '微软雅黑', 'Noto Sans JP', 'Comic Sans MS, cursive',
    'center', 'justify', 'RGB(1, 2, 3)', 'Calc(1px + 1px)', 'a'.repeat(256),
  ])('allows %j (G1, G3, G4)', (value) => {
    expect(isSafeCssValue(value)).toBe(true);
  });

  it.each([
    ['another declaration', 'red;position:fixed;inset:0;z-index:2147483647'],
    ['a loaded resource', 'url(https://probe.test/x)'],
    ['a resource in upper case', 'URL(https://probe.test/x)'],
    ['a resource inside an allowed function', 'var(--x, url(https://probe.test/x))'],
    ['an image set', 'image-set(a.png 1x)'],
    ['a prefixed image set', '-webkit-image-set(a.png 1x)'],
    ['an image function', 'image(https://probe.test/x)'],
    ['a gradient', 'linear-gradient(red, blue)'],
    ['an expression', 'expression(alert(1))'],
    ['an element reference', 'element(#x)'],
    ['a paint worklet', 'paint(x)'],
    ['an attribute read', 'attr(title)'],
    ['an environment read', 'env(safe-area-inset-top)'],
    ['a parenthesis without a function', '(1px)'],
    ['a function name separated by a space', 'rgb (1, 2, 3)'],
    ['importance', 'red !important'],
    ['a comment', 'red/**/'],
    ['an escape', '\\3b'],
    ['an escaped function name', 'u\\72l(x)'],
    ['an at-rule', '@import url(x)'],
    ['a block', 'red} body {color:red'],
    ['a bracket block', 'red [x'],
    ['a closed bracket block', 'red [x]'],
    ['an unclosed function', 'rgb(1, 2, 3'],
    ['an unclosed nested function', 'rgb(calc(1 + 2) 0 0'],
    ['a closing parenthesis first', 'red)'],
    ['parentheses closed before they open', ')rgb('],
    ['a double quote', 'x" onmouseover="alert(1)'],
    ['a single quote', "x';background:url(y);'"],
    ['markup', '</style><script>'],
    // HTML that leaves `&` unescaped in an attribute, as linkedom writes it, is decoded by the browser that reads it.
    ['a character reference', 'red&#59;position:fixed'],
    ['a hexadecimal character reference', 'red&#x3b;position:fixed'],
    ['a named character reference', 'red&semi;position:fixed'],
    ['parentheses spelled as references', 'url&#40;https://probe.test/x&#41;'],
    ['an ampersand', 'Tom&Jerry'],
    ['a line break', 'red\nposition:fixed'],
    ['a carriage return', 'red\rblue'],
    ['a tab', 'red\tblue'],
    ['a form feed', 'red\fblue'],
    ['a NUL', 'red\u0000'],
    ['DEL', 'red\u007f'],
    ['a C1 control', 'red\u0085'],
    ['an empty string', ''],
    ['only spaces', '   '],
    ['a value longer than 256 characters', 'a'.repeat(257)],
  ])('refuses %s (G2)', (_label, value) => {
    expect(isSafeCssValue(value)).toBe(false);
  });

  it.each([[null], [undefined], [42], [['red']], [{ color: 'red' }], [true], [Object('red')]])('refuses %j, which is not a string', (value) => {
    expect(isSafeCssValue(value)).toBe(false);
  });

  it('is exported from the package entry', () => {
    expect(core.isSafeCssValue).toBe(isSafeCssValue);
  });

  it('keeps every allowed value inside one declaration of a real style attribute', () => {
    const allowed = ['red', 'rgb(1, 2, 3)', 'var(--x, #000)', 'calc(1em + 2px)', 'Times New Roman, serif', '微软雅黑'];
    for (const value of allowed) {
      const element = document.createElement('span');
      element.setAttribute('style', `color: ${value}`);
      // Whatever the engine accepts, no second declaration can appear.
      expect(element.style.length, value).toBeLessThanOrEqual(1);
    }
    const refused = ['red;position:fixed', 'red; background: url(x)'];
    for (const value of refused) {
      expect(isSafeCssValue(value)).toBe(false);
      const element = document.createElement('span');
      element.setAttribute('style', `color: ${value}`);
      expect(element.style.length, value).toBeGreaterThan(1);
    }
  });
});
