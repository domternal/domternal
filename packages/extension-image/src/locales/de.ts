// Generated from locales/de.ts. Run pnpm locales:generate; do not edit.
import type { CompleteMessages, SearchAliases } from "@domternal/core";
import type { imageMessages } from "@domternal/extension-image";

/** German UI messages for images. */
export const deMessages: Readonly<CompleteMessages<typeof imageMessages>> = Object.freeze({
    'image.toolbar.insert': 'Bild einfügen',
    'image.float.none': 'Ohne Textumfluss',
    'image.float.left': 'Links mit Textumfluss',
    'image.float.center': 'Zentrieren',
    'image.float.right': 'Rechts mit Textumfluss',
    'image.align.left': 'Linksbündig ausrichten',
    'image.align.center': 'Zentrieren',
    'image.align.right': 'Rechtsbündig ausrichten',
    'image.action.editAlt': 'Alternativtext bearbeiten',
    'image.action.delete': 'Löschen',
    'image.insert.label': 'Bild',
    'image.insert.description': 'Hochladen oder über einen Link einbetten',
    'image.group.float': 'Textumfluss',
    'image.group.align': 'Bildausrichtung',
    'image.group.actions': 'Bildaktionen',
    'image.popover.urlPlaceholder': 'Bild-URL eingeben …',
    'image.popover.urlLabel': 'Bild-URL',
    'image.popover.altPlaceholder': 'Alternativtext (optional) …',
    'image.popover.altLabel': 'Alternativtext des Bildes',
    'image.popover.insert': 'Bild einfügen',
    'image.popover.saveAlt': 'Alternativtext speichern',
    'image.popover.browse': 'Dateien durchsuchen',
} satisfies CompleteMessages<typeof imageMessages>);

/** German search terms supplement the stable technical aliases. */
export const deSearchAliases = Object.freeze({
    'image.insert.label': Object.freeze(['bild', 'foto', 'abbildung']),
} satisfies SearchAliases);
