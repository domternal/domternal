import {
  I18nService,
  type MessageArguments,
  type MessageDefinition,
  type MessageId,
  type ResolvedMessage,
} from '../i18n/index.js';

/** Resolve presentation for bound editors and schema-only extension contexts. */
export function localizeMessage<Id extends MessageId>(
  i18n: I18nService | undefined,
  definition: MessageDefinition<Id>,
  ...params: MessageArguments<Id>
): ResolvedMessage {
  if (i18n) return i18n.resolve(definition, ...params);
  const fallback = new I18nService();
  try {
    return fallback.resolve(definition, ...params);
  } finally {
    fallback.destroy();
  }
}

/** Add localized text and its language without changing the public string label. */
export function localizedLabel<Id extends MessageId>(
  i18n: I18nService | undefined,
  definition: MessageDefinition<Id>,
  ...params: MessageArguments<Id>
): { label: string; labelLanguage: string } {
  const message = localizeMessage(i18n, definition, ...params);
  return { label: message.text, labelLanguage: message.language };
}
