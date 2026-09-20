// Generated from locales/de.ts. Run pnpm locales:generate; do not edit.
import type { CompleteMessages, SearchAliases } from "@domternal/core";
import type { emojiMessages } from "@domternal/extension-emoji";

/** German UI messages leave emoji names and shortcodes unchanged. */
export const deMessages: Readonly<CompleteMessages<typeof emojiMessages>> = Object.freeze({
    'emoji.insert': 'Emoji einfügen',
    'emoji.suggestion.label': 'Emoji-Vorschläge',
    'emoji.suggestion.empty': 'Keine Emojis gefunden',
} satisfies CompleteMessages<typeof emojiMessages>);

/** Emoji suggestions use their dataset identities rather than insertion aliases. */
export const deSearchAliases = Object.freeze({} satisfies SearchAliases);
