// Generated from locales/de.ts. Run pnpm locales:generate; do not edit.
import type { CompleteMessages, SearchAliases } from "@domternal/core";
import type { blockControlsMessages } from "@domternal/extension-block-controls";

/** German UI messages for block controls. */
export const deMessages: Readonly<CompleteMessages<typeof blockControlsMessages>> = Object.freeze({
    'blockControls.handle.drag': 'Zum Verschieben ziehen, für Optionen klicken',
    'blockControls.handle.add': 'Block darunter hinzufügen',
    'blockControls.context.label': 'Blockoptionen',
    'blockControls.context.delete': 'Löschen',
    'blockControls.context.duplicate': 'Duplizieren',
    'blockControls.context.copyLink': 'Link kopieren',
    'blockControls.context.colors': 'Farben',
    'blockControls.context.turnInto': 'Umwandeln in',
    'blockControls.color.text': 'Textfarbe',
    'blockControls.color.background': 'Hintergrund',
    'blockControls.color.clearBackground': 'Kein Hintergrund',
    'blockControls.color.clearText': 'Standardtextfarbe',
    'blockControls.turnInto.paragraph': 'Absatz',
    'blockControls.turnInto.bulletList': 'Aufzählungsliste',
    'blockControls.turnInto.orderedList': 'Nummerierte Liste',
    'blockControls.turnInto.taskList': 'Aufgabenliste',
    'blockControls.turnInto.quote': 'Zitat',
    'blockControls.turnInto.codeBlock': 'Codeblock',
    'blockControls.slash.noMatches': 'Keine Treffer',
    'blockControls.turnInto.heading': ({ level }, context) => `Überschrift ${context.number(level)}`,
    'blockControls.color.backgroundSwatch': ({ color }) => `Hintergrundfarbe: ${color}`,
    'blockControls.color.textSwatch': ({ color }) => `Textfarbe: ${color}`,
} satisfies CompleteMessages<typeof blockControlsMessages>);

/** Block controls do not own searchable insertion messages. */
export const deSearchAliases = Object.freeze({} satisfies SearchAliases);
