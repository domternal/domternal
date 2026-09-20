import type { I18nFormattingContext, I18nSnapshot, I18nDiagnostic } from './types.js';

type Formatter = Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat | Intl.PluralRules;

/** Bounded caches belong to one service and are cleared for every revision. */
export class FormattingCache {
  private readonly cache = new Map<string, Formatter>();

  clear(): void {
    this.cache.clear();
  }

  private get<T extends Formatter>(kind: string, locale: string, options: object | undefined, create: () => T): T {
    const normalized = Object.entries(options ?? {}).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b));
    const key = JSON.stringify([kind, locale, normalized]);
    const found = this.cache.get(key);
    if (found) return found as T;
    const formatter = create();
    if (this.cache.size >= 64) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, formatter);
    return formatter;
  }

  context(snapshot: I18nSnapshot, language: string, report: (code: I18nDiagnostic['code'], key: string) => void): I18nFormattingContext {
    const { locale, formattingLocale, timeZone, formatters } = snapshot;
    const wordingLocale = Intl.RelativeTimeFormat.supportedLocalesOf(language).length ? language : 'en';
    const settings = Object.freeze({ locale, formattingLocale, timeZone, language });
    const custom = (key: keyof typeof formatters, run: () => unknown, fallback: () => string): string => {
      if (formatters[key]) {
        try {
          const result = run();
          if (typeof result === 'string' && result.trim()) return result;
        } catch { /* Invalid custom formatters use the native implementation. */ }
        report('invalid-formatter', `formatters.${key}`);
      }
      return fallback();
    };
    const date = (value: number | Date, options: Intl.DateTimeFormatOptions | undefined, kind: 'date' | 'time'): string => {
      const dateOptions = { ...(options ?? (kind === 'time' ? { timeStyle: 'short' as const } : {})), timeZone: options?.timeZone ?? timeZone };
      return custom(kind, () => formatters[kind]?.(value, options, settings), () =>
        this.get(kind, formattingLocale, dateOptions, () => new Intl.DateTimeFormat(formattingLocale, dateOptions)).format(value));
    };
    return Object.freeze({
      ...settings,
      number: (value: number, options?: Intl.NumberFormatOptions): string => custom('number',
        () => formatters.number?.(value, options, settings),
        () => this.get('number', formattingLocale, options, () => new Intl.NumberFormat(formattingLocale, options)).format(value)),
      date: (value: number | Date, options?: Intl.DateTimeFormatOptions): string => date(value, options, 'date'),
      time: (value: number | Date, options?: Intl.DateTimeFormatOptions): string => date(value, options, 'time'),
      relativeTime: (value: number, unit: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions): string => custom('relativeTime',
        () => formatters.relativeTime?.(value, unit, options, settings),
        () => this.get('relativeTime', wordingLocale, options, () => new Intl.RelativeTimeFormat(wordingLocale, options)).format(value, unit)),
      plural: (value: number, options?: Intl.PluralRulesOptions): Intl.LDMLPluralRule => {
        const grammarLocale = Intl.PluralRules.supportedLocalesOf(language).length ? language : 'en';
        return this.get('plural', grammarLocale, options, () => new Intl.PluralRules(grammarLocale, options)).select(value);
      },
    });
  }
}
