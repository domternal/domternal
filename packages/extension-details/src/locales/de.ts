// Generated from locales/de.ts. Run pnpm locales:generate; do not edit.
import type { CompleteMessages, SearchAliases } from "@domternal/core";
import type { detailsMessages } from "@domternal/extension-details";

/** German UI messages for collapsible details. */
export const deMessages: Readonly<CompleteMessages<typeof detailsMessages>> = Object.freeze({
    'details.toggle.label': 'Details ein- oder ausklappen',
    'details.toolbar.toggle': 'Aufklappbaren Block umschalten',
    'details.insert.label': 'Aufklappbarer Block',
    'details.insert.description': 'Ein- und ausklappbarer Inhaltsbereich',
} satisfies CompleteMessages<typeof detailsMessages>);

/** German search terms supplement the stable technical aliases. */
export const deSearchAliases = Object.freeze({
    'details.insert.label': Object.freeze(['aufklappen', 'einklappen', 'details', 'akkordeon']),
} satisfies SearchAliases);
