import type { MessageDefinition, MessageId } from './types.js';

/** Defines an immutable message without registering global runtime state. */
export function defineMessage<const Id extends MessageId>(definition: MessageDefinition<Id>): MessageDefinition<Id> {
  if (!definition.id.includes('.') || !definition.owner || !definition.description) {
    throw new TypeError('Messages require a namespaced ID, owner and description.');
  }
  if (typeof definition.defaultValue !== 'string' && typeof definition.defaultValue !== 'function') {
    throw new TypeError('A message default must be a string or function.');
  }
  if (typeof definition.defaultValue === 'string' && !definition.allowEmpty && !definition.defaultValue.trim()) {
    throw new TypeError('A required message default must not be empty.');
  }
  return Object.freeze({
    ...definition,
    ...(definition.searchAliases && { searchAliases: freezeAliases(definition.searchAliases) }),
    ...(definition.technicalAliases && { technicalAliases: freezeAliases(definition.technicalAliases) }),
  });
}

export function freezeAliases(aliases: readonly string[]): readonly string[] {
  if (!Array.isArray(aliases) || !aliases.every(alias => typeof alias === 'string')) {
    throw new TypeError('Search aliases must be an array of strings.');
  }
  return Object.freeze([...aliases]);
}
