import { freezeAliases } from './defineMessage.js';
import { FormattingCache } from './formatting.js';
import type {
  I18nDiagnostic, I18nFormatters, I18nFormattingContext, I18nOptions, I18nSnapshot,
  MessageArguments, MessageDefinition, MessageId, MessageParameters, ResolvedMessage,
} from './types.js';

type Listener = (snapshot: I18nSnapshot) => void;

function definedEntries(value: object | undefined): [string, unknown][] {
  return Object.entries(value ?? {}).filter(([, entry]: [string, unknown]) => entry !== undefined);
}

function sameEntries(left: object, right: object, arrays = false): boolean {
  const a = Object.entries(left);
  const b = Object.entries(right);
  if (a.length !== b.length) return false;
  return a.every(([key, value]) => {
    if (!Object.hasOwn(right, key)) return false;
    const other: unknown = (right as Record<string, unknown>)[key];
    return arrays && Array.isArray(value) && Array.isArray(other)
      ? value.length === other.length && value.every((item: unknown, index: number) => item === other[index])
      : value === other;
  });
}

function equivalent(a: I18nSnapshot, b: I18nSnapshot): boolean {
  return a.locale === b.locale && a.formattingLocale === b.formattingLocale && a.timeZone === b.timeZone
    && a.resolve === b.resolve && a.onDiagnostic === b.onDiagnostic
    && sameEntries(a.messages, b.messages) && sameEntries(a.searchAliases, b.searchAliases, true)
    && sameEntries(a.formatters, b.formatters);
}

function normalize(options: I18nOptions, environmentTimeZone: string, revision: number): I18nSnapshot {
  const requested = options.locale ?? 'en';
  if (typeof requested !== 'string') throw new TypeError('The UI locale must be a BCP 47 string.');
  const locale = Intl.getCanonicalLocales(requested)[0];
  if (!locale) throw new RangeError('The UI locale must not be empty.');
  if (options.timeZone !== undefined && typeof options.timeZone !== 'string') {
    throw new TypeError('The UI time zone must be a string.');
  }
  const timeZone = new Intl.DateTimeFormat('en', { timeZone: options.timeZone ?? environmentTimeZone }).resolvedOptions().timeZone;
  const supported = Intl.NumberFormat.supportedLocalesOf(locale).length > 0
    && Intl.DateTimeFormat.supportedLocalesOf(locale).length > 0
    && Intl.RelativeTimeFormat.supportedLocalesOf(locale).length > 0
    && Intl.PluralRules.supportedLocalesOf(locale).length > 0;
  if (options.resolve !== undefined && typeof options.resolve !== 'function') throw new TypeError('The message resolver must be a function.');
  if (options.onDiagnostic !== undefined && typeof options.onDiagnostic !== 'function') throw new TypeError('The diagnostic handler must be a function.');
  const messages = Object.freeze(Object.fromEntries(definedEntries(options.messages)));
  const searchAliases = Object.freeze(Object.fromEntries(definedEntries(options.searchAliases)
    .map(([id, aliases]) => [id, freezeAliases(aliases as readonly string[])])));
  const formatters: I18nFormatters = Object.freeze(Object.fromEntries(definedEntries(options.formatters)
    .map(([name, formatter]) => {
      if (!['number', 'date', 'time', 'relativeTime'].includes(name) || typeof formatter !== 'function') {
        throw new TypeError('UI formatters must be named formatting functions.');
      }
      return [name, formatter];
    })));
  return Object.freeze({
    locale,
    formattingLocale: supported ? locale : 'en',
    timeZone,
    messages,
    searchAliases,
    formatters,
    resolve: options.resolve,
    onDiagnostic: options.onDiagnostic,
    revision,
  });
}

/** Per-editor message state with no DOM, network access or shared registry. */
export class I18nService {
  private snapshot: I18nSnapshot;
  private readonly environmentTimeZone: string;
  private readonly listeners = new Set<Listener>();
  private readonly diagnostics = new Set<string>();
  private readonly formatting = new FormattingCache();
  private readonly contexts = new Map<string, I18nFormattingContext>();
  private destroyed = false;

  constructor(options: I18nOptions = {}) {
    this.environmentTimeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    this.snapshot = normalize(options, this.environmentTimeZone, 0);
    this.reportUnsupportedLocale();
  }

  /** Returns the same immutable object until a configuration change or refresh. */
  getSnapshot = (): I18nSnapshot => this.snapshot;

  /** Replaces configuration completely. Equivalent configurations are a no-op. */
  set(options: I18nOptions = {}): void {
    if (this.destroyed) return;
    const next = normalize(options, this.environmentTimeZone, this.snapshot.revision + 1);
    if (equivalent(this.snapshot, next)) return;
    this.commit(next);
  }

  /** Re-evaluates external resolver resources without replacing configuration. */
  refresh(): void {
    if (this.destroyed) return;
    this.commit(Object.freeze({ ...this.snapshot, revision: this.snapshot.revision + 1 }));
  }

  /** Listeners run in registration order. A failing listener does not stop others. */
  subscribe = (listener: Listener): (() => void) => {
    if (this.destroyed) return () => undefined;
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** Disposes subscriptions and formatter caches. Repeated disposal is harmless. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.listeners.clear();
    this.diagnostics.clear();
    this.contexts.clear();
    this.formatting.clear();
  }

  /** Formats standalone UI values using this editor's locale and time zone. */
  getFormattingContext(language = this.snapshot.locale): I18nFormattingContext {
    const cached = this.contexts.get(language);
    if (cached) return cached;
    const snapshot = this.snapshot;
    const context = this.formatting.context(snapshot, language, (code, key) => { this.report(code, key, snapshot); });
    if (this.contexts.size >= 8) this.contexts.clear();
    if (!this.destroyed) this.contexts.set(language, context);
    return context;
  }

  t<const Id extends MessageId>(definition: MessageDefinition<Id>, ...args: MessageArguments<NoInfer<Id>>): string {
    return this.resolve(definition, ...args).text;
  }

  resolve<const Id extends MessageId>(definition: MessageDefinition<Id>, ...args: MessageArguments<NoInfer<Id>>): ResolvedMessage {
    const params = args[0] as MessageParameters[Id];
    const snapshot = this.snapshot;
    const { locale, messages, resolve } = snapshot;
    const translatedContext = this.getFormattingContext();
    const fallbackContext = this.getFormattingContext('en');
    const values = messages as Record<string, unknown>;
    if (Object.hasOwn(values, definition.id)) {
      const translated = this.evaluate(values[definition.id], definition, params, translatedContext, snapshot);
      if (translated !== undefined) return Object.freeze({ text: translated, language: locale, source: 'messages' });
    }
    if (resolve) {
      try {
        const translated: unknown = resolve(definition.id, params, translatedContext);
        if (translated !== undefined) {
          const text = this.validate(translated, definition, snapshot);
          if (text !== undefined) return Object.freeze({ text, language: locale, source: 'resolver' });
        }
      } catch { this.report('callback-error', definition.id, snapshot); }
    }
    const fallback = this.evaluate(definition.defaultValue, definition, params, fallbackContext, snapshot);
    if (fallback === undefined) {
      throw new TypeError(`Invalid English default for message "${definition.id}".`);
    }
    return Object.freeze({ text: fallback, language: 'en', source: 'default' });
  }

  /** Returns display-search aliases, retaining stable technical aliases. */
  getSearchAliases<Id extends MessageId>(definition: MessageDefinition<Id>): readonly string[] {
    const configured = (this.snapshot.searchAliases as Record<string, readonly string[]>)[definition.id];
    return Object.freeze([...new Set([...(configured ?? definition.searchAliases ?? []), ...(definition.technicalAliases ?? [])])]);
  }

  private evaluate<Id extends MessageId>(value: unknown, definition: MessageDefinition<Id>, params: MessageParameters[Id], context: I18nFormattingContext, snapshot: I18nSnapshot): string | undefined {
    try {
      const result: unknown = typeof value === 'function'
        ? (value as (args: MessageParameters[Id], formatting: I18nFormattingContext) => unknown)(params, context)
        : value;
      return this.validate(result, definition, snapshot);
    } catch {
      this.report('callback-error', definition.id, snapshot);
      return undefined;
    }
  }

  private validate<Id extends MessageId>(value: unknown, definition: MessageDefinition<Id>, snapshot: I18nSnapshot): string | undefined {
    if (typeof value === 'string' && (definition.allowEmpty || value.trim())) return value;
    this.report('invalid-message', definition.id, snapshot);
    return undefined;
  }

  private commit(next: I18nSnapshot): void {
    this.snapshot = next;
    this.diagnostics.clear();
    this.contexts.clear();
    this.formatting.clear();
    this.reportUnsupportedLocale();
    for (const listener of [...this.listeners]) {
      // A callback can publish a newer revision before this notification resumes.
      if (this.snapshot !== next || this.destroyed) break;
      if (!this.listeners.has(listener)) continue;
      try { listener(next); } catch { this.report('listener-error', 'subscribe'); }
    }
  }

  private reportUnsupportedLocale(): void {
    if (this.snapshot.locale !== this.snapshot.formattingLocale) this.report('unsupported-locale', 'locale');
  }

  private report(code: I18nDiagnostic['code'], key: string, snapshot = this.snapshot): void {
    if (snapshot !== this.snapshot || this.destroyed || this.diagnostics.has(key) || this.diagnostics.size >= 100) return;
    this.diagnostics.add(key);
    try { this.snapshot.onDiagnostic?.(Object.freeze({ code, key, revision: this.snapshot.revision })); }
    catch { /* Diagnostics must never interrupt message resolution or subscriptions. */ }
  }
}
