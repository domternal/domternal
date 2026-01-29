/**
 * Tests for Typography extension
 *
 * Tests extension creation and configuration.
 * Note: Full input rule testing requires browser/DOM simulation.
 */
import { describe, it, expect } from 'vitest';
import { Typography } from './Typography.js';

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
          openDoubleQuote: '\u201C',
          closeDoubleQuote: '\u201D',
          openSingleQuote: '\u2018',
          closeSingleQuote: '\u2019',
        },
      } as never);

      // << and >> (2 guillemets)
      expect(withGuillemets?.length).toBe(2);
    });
  });
});
