import { describe, expect, it, vi } from 'vitest';
import { I18nService } from './I18nService.js';
import { defineMessage } from './defineMessage.js';
import type { CompleteMessages, I18nFormattingSettings, I18nOptions, I18nResolver, Messages, SearchAliases } from './types.js';

declare module '@domternal/core' {
  interface MessageParameters {
    'test.bold': undefined;
    'test.replies': { count: number };
    'test.description': undefined;
    'test.unsafe': undefined;
  }
  interface SearchableMessages {
    'test.bold': true;
  }
}

const bold = defineMessage({
  id: 'test.bold', defaultValue: 'Bold', description: 'Bold button name', owner: 'test',
  searchAliases: ['strong'], technicalAliases: ['bold'],
});
const replies = defineMessage({
  id: 'test.replies', owner: 'test', description: 'Number of replies',
  defaultValue: ({ count }, context) => `${context.number(count)} ${context.plural(count) === 'one' ? 'reply' : 'replies'}`,
});
const description = defineMessage({
  id: 'test.description', defaultValue: 'Description', owner: 'test', description: 'Optional hint', allowEmpty: true,
});

describe('I18nService configuration', () => {
  it('isolates editors sharing definitions and input maps without changing the source data', () => {
    const source = { 'test.bold': 'Podebljano' };
    const first = new I18nService({ locale: 'hr', messages: source });
    const second = new I18nService({ locale: 'de', messages: { 'test.bold': 'Fett' } });
    source['test.bold'] = 'Changed externally';
    expect(first.t(bold)).toBe('Podebljano');
    expect(second.t(bold)).toBe('Fett');
    first.set({ locale: 'hr', messages: { 'test.bold': 'New wording' } });
    expect(first.t(bold)).toBe('New wording');
    expect(second.t(bold)).toBe('Fett');
    expect(bold.defaultValue).toBe('Bold');
  });

  it('keeps a stable snapshot and suppresses equivalent configuration replacements', () => {
    const service = new I18nService({ locale: 'hr-hr', messages: { 'test.bold': 'Podebljano' }, searchAliases: { 'test.bold': ['jako'] } });
    const snapshot = service.getSnapshot();
    const listener = vi.fn();
    service.subscribe(listener);
    service.set({ locale: 'hr-HR', messages: { 'test.bold': 'Podebljano' }, searchAliases: { 'test.bold': ['jako'] } });
    expect(service.getSnapshot()).toBe(snapshot);
    expect(listener).not.toHaveBeenCalled();
    service.set({ locale: 'hr-HR', messages: { 'test.bold': 'Drugi naziv' } });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(service.getSnapshot());
    expect(service.getSnapshot().revision).toBe(snapshot.revision + 1);
    expect(service.getSnapshot().searchAliases).toEqual({});
  });

  it('forces a revision for external resources while retaining the resolver and options', () => {
    let resource = 'First';
    const resolve = (): string => resource;
    const service = new I18nService({ locale: 'hr', resolve, timeZone: 'Europe/Zagreb' });
    const listener = vi.fn();
    service.subscribe(listener);
    const before = service.getSnapshot();
    resource = 'Second';
    service.set({ locale: 'hr', resolve, timeZone: 'Europe/Zagreb' });
    expect(service.getSnapshot()).toBe(before);
    service.refresh();
    expect(listener).toHaveBeenCalledOnce();
    expect(service.getSnapshot()).toMatchObject({ locale: 'hr', resolve, timeZone: 'Europe/Zagreb', revision: 1 });
    expect(service.t(bold)).toBe('Second');
  });

  it('copies and freezes alias arrays, preserves technical aliases and resets omitted fields', () => {
    const aliases = ['jako'];
    const service = new I18nService({ locale: 'hr', searchAliases: { 'test.bold': aliases }, messages: { 'test.bold': 'Podebljano' } });
    aliases.push('outside');
    const snapshot = service.getSnapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.messages)).toBe(true);
    expect(Object.isFrozen(snapshot.searchAliases)).toBe(true);
    expect(Object.isFrozen(snapshot.searchAliases['test.bold'])).toBe(true);
    expect(service.getSearchAliases(bold)).toEqual(['jako', 'bold']);
    service.set({ searchAliases: { 'test.bold': [] } });
    expect(service.getSearchAliases(bold)).toEqual(['bold']);
    service.set();
    expect(service.getSnapshot().locale).toBe('en');
    expect(service.getSearchAliases(bold)).toEqual(['strong', 'bold']);
    expect(service.t(bold)).toBe('Bold');
  });

  it('validates before committing and keeps the previous working configuration', () => {
    const service = new I18nService({ locale: 'hr', timeZone: 'Europe/Zagreb' });
    const before = service.getSnapshot();
    const listener = vi.fn();
    service.subscribe(listener);
    for (const options of [
      { locale: 'not a locale' },
      { locale: '' },
      { timeZone: 'Invalid/Zone' },
      { searchAliases: { 'test.bold': ['valid', 1] } } as unknown as I18nOptions,
    ]) expect(() => { service.set(options); }).toThrow();
    expect(service.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('isolates failing listeners and supports unsubscription and idempotent destruction', () => {
    const diagnostics = vi.fn(() => { throw new Error('diagnostic failure'); });
    const service = new I18nService({ onDiagnostic: diagnostics });
    service.subscribe(() => { throw new Error('subscriber failure'); });
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);
    expect(() => { service.refresh(); }).not.toThrow();
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    unsubscribe();
    service.refresh();
    expect(listener).toHaveBeenCalledOnce();
    service.destroy();
    service.destroy();
    const snapshot = service.getSnapshot();
    service.set({ locale: 'hr' });
    service.refresh();
    service.subscribe(listener)();
    expect(service.getSnapshot()).toBe(snapshot);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('never sends an older snapshot after a listener publishes a new configuration', () => {
    const service = new I18nService();
    const seen: number[] = [];
    service.subscribe(snapshot => {
      if (snapshot.locale === 'hr') service.set({ locale: 'de' });
    });
    service.subscribe(snapshot => { seen.push(snapshot.revision); });
    service.set({ locale: 'hr' });
    expect(seen).toEqual([2]);
    expect(service.getSnapshot()).toMatchObject({ locale: 'de', revision: 2 });
  });

  it('does not notify a superseded configuration after a diagnostic replaces it', () => {
    const service = new I18nService();
    const seen: number[] = [];
    service.subscribe(snapshot => { seen.push(snapshot.revision); });
    service.set({ locale: 'zz-ZZ', onDiagnostic: () => { service.set({ locale: 'en' }); } });
    expect(seen).toEqual([2]);
    expect(service.getSnapshot()).toMatchObject({ locale: 'en', revision: 2 });
  });
});

describe('I18nService resolution', () => {
  it('resolves map, bridge and English layers with language metadata and literal text', () => {
    const service = new I18nService({ locale: 'hr', messages: { 'test.bold': '<strong> & "bold"' }, resolve: id => id === 'test.description' ? 'Opis' : undefined });
    expect(service.resolve(bold)).toEqual({ text: '<strong> & "bold"', language: 'hr', source: 'messages' });
    expect(service.resolve(description)).toEqual({ text: 'Opis', language: 'hr', source: 'resolver' });
    expect(service.resolve(replies, { count: 2 })).toEqual({ text: '2 replies', language: 'en', source: 'default' });
  });

  it('continues after invalid or throwing candidates and bounds diagnostics per key and revision', () => {
    const diagnostics = vi.fn();
    const bad = (): string => { throw new Error('private content must not reach diagnostics'); };
    const service = new I18nService({ locale: 'hr', messages: { 'test.bold': bad }, resolve: () => 'Bridge', onDiagnostic: diagnostics });
    expect(service.t(bold)).toBe('Bridge');
    expect(service.t(bold)).toBe('Bridge');
    expect(diagnostics).toHaveBeenCalledExactlyOnceWith({ code: 'callback-error', key: 'test.bold', revision: 0 });
    service.refresh();
    service.t(bold);
    expect(diagnostics).toHaveBeenCalledTimes(2);
    service.set({ messages: { 'test.bold': 42 } as unknown as Messages, resolve: (() => null) as unknown as I18nResolver });
    expect(service.resolve(bold)).toEqual({ text: 'Bold', language: 'en', source: 'default' });
    service.set({ messages: { 'test.bold': bad }, resolve: bad, onDiagnostic: () => { throw new Error('reporting failed'); } });
    expect(service.t(bold)).toBe('Bold');
  });

  it('accepts intentional empty hints and rejects empty required labels before trying the bridge', () => {
    const service = new I18nService({ messages: { 'test.bold': '  ', 'test.description': '' }, resolve: () => 'Bridge' });
    expect(service.t(bold)).toBe('Bridge');
    expect(service.t(description)).toBe('');
    service.set({ resolve: () => '' });
    expect(service.t(bold)).toBe('Bold');
  });

  it('uses English grammar for fallback sentences and active-language grammar for translated functions', () => {
    const service = new I18nService({ locale: 'hr' });
    expect(service.t(replies, { count: 21 })).toBe('21 replies');
    service.set({ locale: 'hr', messages: { 'test.replies': ({ count }, context) => `${context.number(count)}:${context.plural(count)}` } });
    expect(service.t(replies, { count: 21 })).toBe('21:one');
    expect(service.t(replies, { count: 2 })).toBe('2:few');
    service.set({ locale: 'ar', messages: { 'test.replies': ({ count }, context) => context.plural(count) } });
    expect([0, 1, 2, 3, 11, 100].map(count => service.t(replies, { count }))).toEqual(['zero', 'one', 'two', 'few', 'many', 'other']);
  });

  it('diagnoses unsupported formatting data while retaining the requested message language', () => {
    const diagnostics = vi.fn();
    const service = new I18nService({ locale: 'zz-ZZ', onDiagnostic: diagnostics, messages: { 'test.bold': 'Custom' } });
    expect(service.getSnapshot()).toMatchObject({ locale: 'zz-ZZ', formattingLocale: 'en' });
    expect(service.resolve(bold).language).toBe('zz-ZZ');
    expect(diagnostics).toHaveBeenCalledExactlyOnceWith({ code: 'unsupported-locale', key: 'locale', revision: 0 });
  });

  it('keeps a lookup on its captured snapshot when a custom callback replaces configuration', () => {
    const definition = defineMessage({
      id: 'test.unsafe', owner: 'test', description: 'Formatting context probe',
      defaultValue: (_params, context) => `${context.locale}:${context.language}:${context.timeZone}`,
    });
    const service = new I18nService({
      locale: 'hr', timeZone: 'Europe/Zagreb',
      resolve: () => { service.set({ locale: 'de', timeZone: 'Europe/Berlin' }); return undefined; },
    });
    expect(service.resolve(definition)).toEqual({ text: 'hr:en:Europe/Zagreb', language: 'en', source: 'default' });
    expect(service.getSnapshot().locale).toBe('de');
  });

  it('uses English relative-time wording in English fallback sentences', () => {
    const definition = defineMessage({
      id: 'test.unsafe', owner: 'test', description: 'Relative date',
      defaultValue: (_params, context) => `Updated ${context.relativeTime(-1, 'day', { numeric: 'auto' })}`,
    });
    const service = new I18nService({ locale: 'hr' });
    expect(service.resolve(definition)).toEqual({ text: 'Updated yesterday', language: 'en', source: 'default' });
    expect(service.getFormattingContext().relativeTime(-1, 'day', { numeric: 'auto' })).toBe('jučer');
  });
});

describe('I18nService formatting', () => {
  it('reuses native formatters for equivalent options and discards them on refresh', () => {
    const service = new I18nService({ locale: 'en' });
    const NativeNumberFormat = Intl.NumberFormat;
    const constructor = vi.spyOn(Intl, 'NumberFormat').mockImplementation(function NumberFormat(
      locales?: Intl.LocalesArgument,
      options?: Intl.NumberFormatOptions,
    ): Intl.NumberFormat {
      return new NativeNumberFormat(locales, options);
    });
    try {
      const context = service.getFormattingContext();
      context.number(1, { maximumFractionDigits: 2, minimumFractionDigits: 1 });
      context.number(2, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
      expect(constructor).toHaveBeenCalledOnce();
      service.refresh();
      service.getFormattingContext().number(3, { maximumFractionDigits: 2, minimumFractionDigits: 1 });
      expect(constructor).toHaveBeenCalledTimes(2);
    } finally {
      constructor.mockRestore();
    }
  });

  it('formats timestamps in the configured zone and changes contexts only after a revision', () => {
    const service = new I18nService({ locale: 'en', timeZone: 'UTC' });
    const context = service.getFormattingContext();
    const instant = Date.UTC(2026, 0, 1, 0, 30);
    expect(context.date(instant, { day: 'numeric' })).toBe('1');
    expect(context.number(1234.5)).toBe(new Intl.NumberFormat('en').format(1234.5));
    expect(context.time(instant)).toBe(new Intl.DateTimeFormat('en', { timeZone: 'UTC', timeStyle: 'short' }).format(instant));
    expect(context.relativeTime(-1, 'day', { numeric: 'auto' })).toBe('yesterday');
    expect(service.getFormattingContext()).toBe(context);
    service.set({ locale: 'en', timeZone: 'America/New_York' });
    expect(service.getFormattingContext()).not.toBe(context);
    expect(service.getFormattingContext().date(instant, { day: 'numeric' })).toBe('31');
  });

  it('passes immutable formatting settings to custom callbacks and falls back from faulty formatters', () => {
    const diagnostics = vi.fn();
    const number = vi.fn((_value: number, _options: Intl.NumberFormatOptions | undefined, context: I18nFormattingSettings) => context.locale + ':custom');
    const service = new I18nService({ locale: 'hr', timeZone: 'UTC', formatters: { number }, onDiagnostic: diagnostics });
    expect(service.getFormattingContext().number(12)).toBe('hr:custom');
    expect(Object.isFrozen(number.mock.calls[0]?.[2])).toBe(true);
    service.set({ locale: 'en', formatters: { number: () => { throw new Error('failure'); }, date: () => '' }, onDiagnostic: diagnostics });
    expect(service.getFormattingContext().number(12)).toBe('12');
    expect(service.getFormattingContext().number(13)).toBe('13');
    expect(diagnostics).toHaveBeenCalledOnce();
    expect(service.getFormattingContext().date(0)).not.toBe('');
    expect(diagnostics).toHaveBeenCalledTimes(2);
  });
});

describe('message definitions and types', () => {
  it('validates and freezes owned defaults and independent alias arrays', () => {
    const aliases = ['original'];
    const definition = defineMessage({ id: 'test.unsafe', defaultValue: 'Default', owner: 'test', description: 'Label', technicalAliases: aliases });
    aliases.push('changed');
    expect(Object.isFrozen(definition)).toBe(true);
    expect(definition.technicalAliases).toEqual(['original']);
    expect(() => defineMessage({ id: 'test.unsafe', defaultValue: ' ', owner: 'test', description: 'Name' })).toThrow();
    expect(() => defineMessage({ id: 'test.unsafe', defaultValue: 'Valid', owner: '', description: 'Name' })).toThrow();
  });

  it('keeps custom IDs and parameter shapes checked without a string index signature', () => {
    const partial: Messages = { 'test.replies': ({ count }) => String(count) };
    const complete: CompleteMessages<{ bold: typeof bold; replies: typeof replies }> = { 'test.bold': 'Bold', 'test.replies': ({ count }) => String(count) };
    const aliases: SearchAliases = { 'test.bold': ['strong'] };
    expect(partial['test.replies']).toBeTypeOf('function');
    expect(Object.keys(complete)).toHaveLength(2);
    expect(aliases['test.bold']).toEqual(['strong']);
    // @ts-expect-error Unknown keys must not be accepted as built-in messages.
    const unknown: Messages = { 'test.notRegistered': 'Unknown' };
    // @ts-expect-error Only declared searchable IDs accept aliases.
    const invalidAliases: SearchAliases = { 'test.replies': ['responses'] };
    // @ts-expect-error The message function must receive the declared parameter type.
    const invalidParams: Messages = { 'test.replies': (params: { value: string }) => params.value };
    expect([unknown, invalidAliases, invalidParams]).toHaveLength(3);
    const service = new I18nService();
    const compileOnly = (): void => {
      // @ts-expect-error Parameterized messages require arguments.
      service.t(replies);
      // @ts-expect-error Parameter shapes come from the message definition.
      service.t(replies, { count: 'two' });
      // @ts-expect-error Static messages do not accept invented parameters.
      service.t(bold, { count: 2 });
    };
    expect(compileOnly).toBeTypeOf('function');
  });
});
