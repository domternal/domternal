// Generated from locales/de.ts. Run pnpm locales:generate; do not edit.
import type { CompleteMessages, SearchAliases } from "@domternal/core";
import type { mathMessages } from "@domternal/extension-math";

/** German UI messages leave authored LaTeX source unchanged. */
export const deMessages: Readonly<CompleteMessages<typeof mathMessages>> = Object.freeze({
    'math.inline.label': 'Formel im Text',
    'math.inline.description': 'Eine LaTeX-Formel im Text einfügen',
    'math.block.label': 'Formel',
    'math.block.description': 'Eine LaTeX-Formel als eigenen Block einfügen',
    'math.empty': 'Neue Formel',
    'math.source.label': 'LaTeX-Quelltext',
    'math.preview.placeholder': 'Vorschau',
} satisfies CompleteMessages<typeof mathMessages>);

/** German search terms supplement the stable technical aliases. */
export const deSearchAliases = Object.freeze({
    'math.inline.label': Object.freeze(['formel', 'gleichung', 'mathematik', 'im text']),
    'math.block.label': Object.freeze(['formel', 'gleichung', 'mathematik', 'formelblock']),
} satisfies SearchAliases);
