// Generated from locales/de.ts. Run pnpm locales:generate; do not edit.
import type { CompleteMessages, SearchAliases } from "@domternal/core";
import type { tocMessages } from "@domternal/extension-toc";

/** German UI messages preserve user-authored heading text. */
export const deMessages: Readonly<CompleteMessages<typeof tocMessages>> = Object.freeze({
    'toc.block.empty': 'Überschriften hinzufügen, um ein Inhaltsverzeichnis zu erstellen.',
    'toc.outline.label': 'Dokumentgliederung',
    'toc.heading.fallback': ({ level }, context) => `Überschrift der Ebene ${context.number(level)}`,
    'toc.heading.label': ({ label, level }, context) => `${label} (Überschrift ${context.number(level)})`,
    'toc.insert.label': 'Inhaltsverzeichnis',
    'toc.insert.description': 'Liste der Überschriften auf dieser Seite',
} satisfies CompleteMessages<typeof tocMessages>);

/** German search terms supplement the stable technical aliases. */
export const deSearchAliases = Object.freeze({
    'toc.insert.label': Object.freeze(['inhaltsverzeichnis', 'gliederung', 'übersicht', 'uebersicht', 'überschriften', 'ueberschriften']),
} satisfies SearchAliases);
