/** Extensions augment this interface with message IDs and their parameter types. */
export interface MessageParameters {}

/** Extensions augment this interface with searchable message IDs mapped to true. */
export interface SearchableMessages {}

export type MessageId = Extract<keyof MessageParameters, string>;
export type SearchableMessageId = Extract<keyof SearchableMessages, MessageId>;

export interface I18nFormattingSettings {
  readonly locale: string;
  readonly formattingLocale: string;
  readonly language: string;
  readonly timeZone: string;
}

export interface I18nFormattingContext extends I18nFormattingSettings {
  number(value: number, options?: Intl.NumberFormatOptions): string;
  date(value: number | Date, options?: Intl.DateTimeFormatOptions): string;
  time(value: number | Date, options?: Intl.DateTimeFormatOptions): string;
  relativeTime(value: number, unit: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions): string;
  /** Selects grammar using the message language, including English fallback messages. */
  plural(value: number, options?: Intl.PluralRulesOptions): Intl.LDMLPluralRule;
}

export type MessageValue<Parameters> = string | ((params: Parameters, context: I18nFormattingContext) => string);
export type Messages = { readonly [Id in MessageId]?: MessageValue<MessageParameters[Id]> };
export type SearchAliases = Readonly<Partial<Record<SearchableMessageId, readonly string[]>>>;

export interface MessageDefinition<Id extends MessageId = MessageId> {
  readonly id: Id;
  readonly defaultValue: MessageValue<MessageParameters[Id]>;
  readonly description: string;
  readonly owner: string;
  readonly allowEmpty?: boolean;
  readonly searchAliases?: readonly string[];
  readonly technicalAliases?: readonly string[];
}

// Static message registrations use void instead of an invented empty parameter object.
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type
export type MessageArguments<Id extends MessageId> = [MessageParameters[Id]] extends [void]
  ? [params?: MessageParameters[Id]]
  : [params: MessageParameters[Id]];

export type I18nResolver = <Id extends MessageId>(
  id: Id,
  params: MessageParameters[Id],
  context: I18nFormattingContext,
) => string | undefined;

export interface I18nFormatters {
  readonly number?: (value: number, options: Intl.NumberFormatOptions | undefined, context: I18nFormattingSettings) => string;
  readonly date?: (value: number | Date, options: Intl.DateTimeFormatOptions | undefined, context: I18nFormattingSettings) => string;
  readonly time?: (value: number | Date, options: Intl.DateTimeFormatOptions | undefined, context: I18nFormattingSettings) => string;
  readonly relativeTime?: (
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
    options: Intl.RelativeTimeFormatOptions | undefined,
    context: I18nFormattingSettings,
  ) => string;
}

export interface I18nDiagnostic {
  readonly code: 'invalid-message' | 'callback-error' | 'unsupported-locale' | 'invalid-formatter' | 'listener-error';
  readonly key?: string;
  readonly revision: number;
}

export interface I18nOptions {
  readonly locale?: string;
  readonly messages?: Messages;
  readonly searchAliases?: SearchAliases;
  readonly resolve?: I18nResolver;
  readonly timeZone?: string;
  readonly formatters?: I18nFormatters;
  readonly onDiagnostic?: (diagnostic: I18nDiagnostic) => void;
}

export interface I18nSnapshot {
  readonly locale: string;
  readonly formattingLocale: string;
  readonly timeZone: string;
  readonly messages: Messages;
  readonly searchAliases: SearchAliases;
  readonly formatters: I18nFormatters;
  readonly resolve: I18nResolver | undefined;
  readonly onDiagnostic: I18nOptions['onDiagnostic'];
  readonly revision: number;
}

export interface ResolvedMessage {
  readonly text: string;
  readonly language: string;
  readonly source: 'messages' | 'resolver' | 'default';
}

/** A complete catalog is checked only against the explicitly selected definitions. */
export type CompleteMessages<Definitions extends Readonly<Record<string, { readonly id: MessageId }>>> = {
  readonly [Id in Definitions[keyof Definitions]['id']]: MessageValue<MessageParameters[Id]>;
};
