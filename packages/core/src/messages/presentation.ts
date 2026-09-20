import type { I18nService, MessageArguments, MessageDefinition, MessageId } from '../i18n/index.js';
import { localizeMessage } from '../utils/localizeMessage.js';

export function localizedDescription<Id extends MessageId>(
  i18n: I18nService | undefined,
  definition: MessageDefinition<Id>,
  ...params: MessageArguments<Id>
): { description: string; descriptionLanguage: string } {
  const message = localizeMessage(i18n, definition, ...params);
  return { description: message.text, descriptionLanguage: message.language };
}

export function localizedGroup<Id extends MessageId>(
  i18n: I18nService | undefined,
  definition: MessageDefinition<Id>,
  ...params: MessageArguments<Id>
): { groupLabel: string; groupLabelLanguage: string } {
  const message = localizeMessage(i18n, definition, ...params);
  return { groupLabel: message.text, groupLabelLanguage: message.language };
}

export function messageAliases<Id extends MessageId>(
  i18n: I18nService | undefined,
  definition: MessageDefinition<Id>,
  technicalAliases: readonly string[] = []
): string[] {
  const aliases = i18n?.getSearchAliases(definition) ?? [
    ...(definition.searchAliases ?? []),
    ...(definition.technicalAliases ?? []),
  ];
  return [...new Set([...aliases, ...technicalAliases])];
}
