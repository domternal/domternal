/**
 * Tests for Typography extension
 *
 * Tests extension creation and configuration.
 * Note: Full input rule testing requires browser/DOM simulation.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Typography } from './Typography.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';

describe('Typography', () => {
  describe('extension creation', () => {
    it('creates extension with correct name', () => {
      expect(Typography.name).toBe('typography');
    });

    it('has addOptions defined', () => {
      expect(Typography.config.addOptions).toBeDefined();
    });

    it('has addInputRules defined', () => {
      expect(Typography.config.addInputRules).toBeDefined();
    });
  });

  describe('default options', () => {
    it('has correct default options', () => {
      const options = Typography.config.addOptions?.call({} as never);

      expect(options?.emDash).toBe(true);
      expect(options?.ellipsis).toBe(true);
      expect(options?.arrows).toBe(true);
      expect(options?.fractions).toBe(true);
      expect(options?.symbols).toBe(true);
      expect(options?.math).toBe(true);
      expect(options?.guillemets).toBe(true);
      expect(options?.smartQuotes).toBe(true);
    });

    it('has smart quote defaults', () => {
      const options = Typography.config.addOptions?.call({} as never);

      expect(options?.openDoubleQuote).toBe('\u201C'); // "
      expect(options?.closeDoubleQuote).toBe('\u201D'); // "
      expect(options?.openSingleQuote).toBe('\u2018'); // '
      expect(options?.closeSingleQuote).toBe('\u2019'); // '
    });
  });

  describe('configuration', () => {
    it('can configure to disable rules', () => {
      const ext = Typography.configure({
        emDash: false,
        ellipsis: false,
      });

      expect(ext.name).toBe('typography');
    });

    it('can configure custom quote characters', () => {
      const ext = Typography.configure({
        openDoubleQuote: '«',
        closeDoubleQuote: '»',
      });

      expect(ext.name).toBe('typography');
    });
  });

  describe('input rules creation', () => {
    it('creates input rules array', () => {
      const rules = Typography.config.addInputRules?.call({
        options: {
          emDash: true,
          ellipsis: true,
          arrows: true,
          fractions: true,
          symbols: true,
          math: true,
          guillemets: true,
          smartQuotes: true,
          openDoubleQuote: '\u201C',
          closeDoubleQuote: '\u201D',
          openSingleQuote: '\u2018',
          closeSingleQuote: '\u2019',
        },
      } as never);

      expect(Array.isArray(rules)).toBe(true);
      expect(rules?.length).toBeGreaterThan(0);
    });

    it('creates more rules when all options enabled', () => {
      const allRules = Typography.config.addInputRules?.call({
        options: {
          emDash: true,
          ellipsis: true,
          arrows: true,
          fractions: true,
          symbols: true,
          math: true,
          guillemets: true,
          smartQuotes: true,
          openDoubleQuote: '\u201C',
          closeDoubleQuote: '\u201D',
          openSingleQuote: '\u2018',
          closeSingleQuote: '\u2019',
        },
      } as never);

      const fewerRules = Typography.config.addInputRules?.call({
        options: {
          emDash: true,
          ellipsis: true,
          arrows: false,
          fractions: false,
          symbols: false,
          math: false,
          guillemets: false,
          smartQuotes: false,
          openDoubleQuote: '\u201C',
          closeDoubleQuote: '\u201D',
          openSingleQuote: '\u2018',
          closeSingleQuote: '\u2019',
        },
      } as never);

      expect(fewerRules?.length).toBeLessThan(allRules?.length ?? 0);
    });

    it('creates 2 rules for emDash and ellipsis only', () => {
      const rules = Typography.config.addInputRules?.call({
        options: {
          emDash: true,
          ellipsis: true,
          arrows: false,
          fractions: false,
          symbols: false,
          math: false,
          guillemets: false,
          smartQuotes: false,
          openDoubleQuote: '\u201C',
          closeDoubleQuote: '\u201D',
          openSingleQuote: '\u2018',
          closeSingleQuote: '\u2019',
        },
      } as never);

      expect(rules?.length).toBe(2);
    });

    it('creates 0 rules when all disabled', () => {
      const rules = Typography.config.addInputRules?.call({
        options: {
          emDash: false,
          ellipsis: false,
          arrows: false,
          fractions: false,
          symbols: false,
          math: false,
          guillemets: false,
          smartQuotes: false,
          openDoubleQuote: '\u201C',
          closeDoubleQuote: '\u201D',
          openSingleQuote: '\u2018',
          closeSingleQuote: '\u2019',
        },
      } as never);

      expect(rules?.length).toBe(0);
    });

    it('creates 3 arrow rules when arrows enabled', () => {
      const withArrows = Typography.config.addInputRules?.call({
        options: {
          emDash: false,
          ellipsis: false,
          arrows: true,
          fractions: false,
          symbols: false,
          math: false,
          guillemets: false,
          smartQuotes: false,
          openDoubleQuote: '\u201C',
          closeDoubleQuote: '\u201D',
          openSingleQuote: '\u2018',
          closeSingleQuote: '\u2019',
        },
      } as never);

      // <- -> and => (3 arrows)
      expect(withArrows?.length).toBe(3);
    });

    it('creates 5 fraction rules when fractions enabled', () => {
      const withFractions = Typography.config.addInputRules?.call({
        options: {
          emDash: false,
          ellipsis: false,
          arrows: false,
          fractions: true,
          symbols: false,
          math: false,
          guillemets: false,
          smartQuotes: false,
          openDoubleQuote: '\u201C',
          closeDoubleQuote: '\u201D',
          openSingleQuote: '\u2018',
          closeSingleQuote: '\u2019',
        },
      } as never);

      // 1/2, 1/4, 3/4, 1/3, 2/3 (5 fractions)
      expect(withFractions?.length).toBe(5);
    });

    it('creates 4 symbol rules when symbols enabled', () => {
      const withSymbols = Typography.config.addInputRules?.call({
        options: {
          emDash: false,
          ellipsis: false,
          arrows: false,
          fractions: false,
          symbols: true,
          math: false,
          guillemets: false,
          smartQuotes: false,
          openDoubleQuote: '\u201C',
          closeDoubleQuote: '\u201D',
          openSingleQuote: '\u2018',
          closeSingleQuote: '\u2019',
        },
      } as never);

      // (c), (r), (tm), (sm) (4 symbols)
      expect(withSymbols?.length).toBe(4);
    });

    it('creates 4 math rules when math enabled', () => {
      const withMath = Typography.config.addInputRules?.call({
        options: {
          emDash: false,
          ellipsis: false,
          arrows: false,
          fractions: false,
          symbols: false,
          math: true,
          guillemets: false,
          smartQuotes: false,
          openDoubleQuote: '\u201C',
          closeDoubleQuote: '\u201D',
          openSingleQuote: '\u2018',
          closeSingleQuote: '\u2019',
        },
      } as never);

      // +/-, !=, <=, >= (4 math)
      expect(withMath?.length).toBe(4);
    });

    it('creates 2 guillemet rules when guillemets enabled', () => {
      const withGuillemets = Typography.config.addInputRules?.call({
        options: {
          emDash: false,
          ellipsis: false,
          arrows: false,
          fractions: false,
          symbols: false,
          math: false,
          guillemets: true,
          smartQuotes: false,
          openDoubleQuote: '\u201C',
          closeDoubleQuote: '\u201D',
          openSingleQuote: '\u2018',
          closeSingleQuote: '\u2019',
        },
      } as never);

      // << and >> (2 guillemets)
      expect(withGuillemets?.length).toBe(2);
    });

    it('creates 2 smart quote rules when smartQuotes enabled', () => {
      const withSmartQuotes = Typography.config.addInputRules?.call({
        options: {
          emDash: false,
          ellipsis: false,
          arrows: false,
          fractions: false,
          symbols: false,
          math: false,
          guillemets: false,
          smartQuotes: true,
          openDoubleQuote: '\u201C',
          closeDoubleQuote: '\u201D',
          openSingleQuote: '\u2018',
          closeSingleQuote: '\u2019',
        },
      } as never);

      // "text" and 'text' (2 smart quote rules)
      expect(withSmartQuotes?.length).toBe(2);
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('works with Editor', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Typography],
        content: '<p>Hello</p>',
      });

      expect(editor.getText()).toContain('Hello');
    });

    it('registers input rules in editor', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Typography],
        content: '<p></p>',
      });

      // Editor should have plugins from Typography input rules
      expect(editor.state.plugins.length).toBeGreaterThan(0);
    });

    it('works with all options disabled', () => {
      const CustomTypography = Typography.configure({
        emDash: false,
        ellipsis: false,
        arrows: false,
        fractions: false,
        symbols: false,
        math: false,
        guillemets: false,
        smartQuotes: false,
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomTypography],
        content: '<p>Hello</p>',
      });

      expect(editor.getText()).toContain('Hello');
    });

    it('works with only emDash enabled', () => {
      const CustomTypography = Typography.configure({
        emDash: true,
        ellipsis: false,
        arrows: false,
        fractions: false,
        symbols: false,
        math: false,
        guillemets: false,
        smartQuotes: false,
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomTypography],
        content: '<p>Hello</p>',
      });

      expect(editor.getText()).toContain('Hello');
    });

    it('configured options are preserved', () => {
      const CustomTypography = Typography.configure({
        emDash: false,
        ellipsis: false,
      });

      expect(CustomTypography.options.emDash).toBe(false);
      expect(CustomTypography.options.ellipsis).toBe(false);
      expect(CustomTypography.options.arrows).toBe(true);
    });

    it('configured custom quote characters are preserved', () => {
      const CustomTypography = Typography.configure({
        openDoubleQuote: '«',
        closeDoubleQuote: '»',
      });

      expect(CustomTypography.options.openDoubleQuote).toBe('«');
      expect(CustomTypography.options.closeDoubleQuote).toBe('»');
    });
  });
});
