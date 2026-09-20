// Generated from locales/de.ts. Run pnpm locales:generate; do not edit.
import type { CompleteMessages, SearchAliases } from "@domternal/core";
import type { mentionMessages } from "@domternal/extension-mention";

/** German UI messages leave mention names and identities unchanged. */
export const deMessages: Readonly<CompleteMessages<typeof mentionMessages>> = Object.freeze({
    'mention.suggestions.label': 'Erwähnungsvorschläge',
    'mention.suggestions.empty': 'Keine Ergebnisse',
} satisfies CompleteMessages<typeof mentionMessages>);

/** Mention suggestions use provider data rather than insertion aliases. */
export const deSearchAliases = Object.freeze({} satisfies SearchAliases);
