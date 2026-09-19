// German UI translation source. Edit this file, then run pnpm locales:generate.
// Per-package locale files are generated; this module is not shipped to consumers.
import type { CompleteMessages, SearchAliases, coreMessages } from '@domternal/core';
import type { blockControlsMessages } from '@domternal/extension-block-controls';
import type { detailsMessages } from '@domternal/extension-details';
import type { emojiMessages } from '@domternal/extension-emoji';
import type { imageMessages } from '@domternal/extension-image';
import type { mathMessages } from '@domternal/extension-math';
import type { mentionMessages } from '@domternal/extension-mention';
import type { tableMessages } from '@domternal/extension-table';
import type { tocMessages } from '@domternal/extension-toc';

/** German messages owned by @domternal/core. */
export function core(): { deMessages: Readonly<CompleteMessages<typeof coreMessages>>; deSearchAliases: SearchAliases } {
  /** Complete German UI messages. Import explicitly; English remains the default. */
  const deMessages: Readonly<CompleteMessages<typeof coreMessages>> = Object.freeze({
    'core.bubbleMenu.blockActionsSelectionHint': 'Blockaktionen (Auswahl innerhalb eines einzelnen Blocks erforderlich)',
    'core.bubbleMenu.label': 'Textformatierung',
    'core.bubbleMenu.moreOptions': 'Weitere Optionen',
    'core.colorPicker.background': 'Hintergrundfarbe',
    'core.colorPicker.backgroundSwatch': ({ color }) => `Hintergrundfarbe: ${color}`,
    'core.colorPicker.blue': 'Blau',
    'core.colorPicker.brown': 'Braun',
    'core.colorPicker.defaultBackground': 'Standardhintergrund',
    'core.colorPicker.defaultText': 'Standardtextfarbe',
    'core.colorPicker.gray': 'Grau',
    'core.colorPicker.green': 'Grün',
    'core.colorPicker.label': 'Text- und Hintergrundfarbe',
    'core.colorPicker.orange': 'Orange',
    'core.colorPicker.pink': 'Rosa',
    'core.colorPicker.purple': 'Violett',
    'core.colorPicker.red': 'Rot',
    'core.colorPicker.text': 'Textfarbe',
    'core.colorPicker.textSwatch': ({ color }) => `Textfarbe: ${color}`,
    'core.colorPicker.yellow': 'Gelb',
    'core.editor.label': 'Rich-Text-Editor',
    'core.emojiPicker.categories': 'Emoji-Kategorien',
    'core.emojiPicker.category.activities': 'Aktivitäten',
    'core.emojiPicker.category.animalsNature': 'Tiere und Natur',
    'core.emojiPicker.category.flags': 'Flaggen',
    'core.emojiPicker.category.foodDrink': 'Essen und Trinken',
    'core.emojiPicker.category.objects': 'Gegenstände',
    'core.emojiPicker.category.peopleBody': 'Menschen und Körper',
    'core.emojiPicker.category.smileysEmotion': 'Smileys und Gefühle',
    'core.emojiPicker.category.symbols': 'Symbole',
    'core.emojiPicker.category.travelPlaces': 'Reisen und Orte',
    'core.emojiPicker.empty': 'Keine Emojis gefunden',
    'core.emojiPicker.frequentlyUsed': 'Häufig verwendet',
    // Individual names belong to the caller's emoji dataset, not to UI chrome.
    'core.emojiPicker.itemName': ({ name }) => name.replace(/_/g, ' '),
    'core.emojiPicker.label': 'Emoji-Auswahl',
    'core.emojiPicker.searchLabel': 'Emojis suchen',
    'core.emojiPicker.searchPlaceholder': 'Emojis suchen …',
    'core.floating.bulletedList': 'Aufzählungsliste',
    'core.floating.bulletedListDescription': 'Eine einfache Aufzählungsliste erstellen',
    'core.floating.codeBlock': 'Codeblock',
    'core.floating.codeBlockDescription': 'Einen Codeausschnitt einfügen',
    'core.floating.divider': 'Trennlinie',
    'core.floating.dividerDescription': 'Eine horizontale Linie einfügen',
    'core.floating.headingBigDescription': 'Große Abschnittsüberschrift',
    'core.floating.headingDescription': 'Abschnittsüberschrift',
    'core.floating.headingMediumDescription': 'Mittlere Abschnittsüberschrift',
    'core.floating.headingSmallDescription': 'Kleine Abschnittsüberschrift',
    'core.floating.numberedList': 'Nummerierte Liste',
    'core.floating.numberedListDescription': 'Eine nummerierte Liste erstellen',
    'core.floating.quote': 'Zitat',
    'core.floating.quoteDescription': 'Ein Zitat einfügen',
    'core.floating.todoList': 'Aufgabenliste',
    'core.floating.todoListDescription': 'Aufgaben mit Kontrollkästchen verwalten',
    'core.floatingMenu.label': 'Block einfügen',
    'core.group.advanced': 'Erweitert',
    'core.group.alignment': 'Ausrichtung',
    'core.group.basic': 'Grundlagen',
    'core.group.blocks': 'Blöcke',
    'core.group.document': 'Dokument',
    'core.group.format': 'Formatierung',
    'core.group.history': 'Verlauf',
    'core.group.insert': 'Einfügen',
    'core.group.listInsert': 'Listen',
    'core.group.lists': 'Listen',
    'core.group.media': 'Medien',
    'core.group.textStyle': 'Textstil',
    'core.group.utilities': 'Werkzeuge',
    'core.group.utility': 'Werkzeuge',
    'core.heading.level': ({ level }, context) => `Überschrift ${context.number(level)}`,
    'core.linkPopover.apply': 'Link übernehmen',
    'core.linkPopover.remove': 'Link entfernen',
    'core.linkPopover.urlLabel': 'URL',
    'core.linkPopover.urlPlaceholder': 'URL eingeben …',
    'core.placeholder.default': 'Text eingeben …',
    'core.taskItem.status': 'Aufgabenstatus',
    'core.toolbar.alignCenter': 'Zentrieren',
    'core.toolbar.alignLeft': 'Linksbündig',
    'core.toolbar.alignRight': 'Rechtsbündig',
    'core.toolbar.blockquote': 'Zitatblock',
    'core.toolbar.bold': 'Fett',
    'core.toolbar.bulletList': 'Aufzählungsliste',
    'core.toolbar.clearFormatting': 'Formatierung entfernen',
    'core.toolbar.code': 'Inline-Code',
    'core.toolbar.codeBlock': 'Codeblock',
    'core.toolbar.fontFamily': 'Schriftart',
    'core.toolbar.fontSize': 'Schriftgröße',
    'core.toolbar.fontSizeDefault': 'Standard',
    'core.toolbar.hardBreak': 'Zeilenumbruch',
    'core.toolbar.heading': 'Überschrift',
    'core.toolbar.highlight': 'Hervorhebung',
    'core.toolbar.horizontalRule': 'Horizontale Linie',
    'core.toolbar.invisibleCharacters': 'Unsichtbare Zeichen',
    'core.toolbar.italic': 'Kursiv',
    'core.toolbar.justify': 'Blocksatz',
    'core.toolbar.label': 'Editorformatierung',
    'core.toolbar.lineHeight': 'Zeilenabstand',
    'core.toolbar.lineHeightDefault': 'Standard',
    'core.toolbar.link': 'Link',
    'core.toolbar.noHighlight': 'Keine Hervorhebung',
    'core.toolbar.normalText': 'Normaler Text',
    'core.toolbar.orderedList': 'Nummerierte Liste',
    'core.toolbar.print': 'Drucken',
    'core.toolbar.redo': 'Wiederholen',
    'core.toolbar.strike': 'Durchgestrichen',
    'core.toolbar.subscript': 'Tiefgestellt',
    'core.toolbar.superscript': 'Hochgestellt',
    'core.toolbar.taskList': 'Aufgabenliste',
    'core.toolbar.textAlignment': 'Textausrichtung',
    'core.toolbar.textColor': 'Textfarbe',
    'core.toolbar.textColorDefault': 'Standard',
    'core.toolbar.toolsGroup': 'Werkzeuge',
    'core.toolbar.underline': 'Unterstrichen',
    'core.toolbar.undo': 'Rückgängig',
  } satisfies CompleteMessages<typeof coreMessages>);

  /** German discovery terms supplement the definitions' stable technical aliases. */
  const deSearchAliases = Object.freeze({
    'core.floating.bulletedList': Object.freeze(['aufzählung', 'aufzaehlung', 'liste', 'punkte']),
    'core.floating.codeBlock': Object.freeze(['quellcode', 'codeblock']),
    'core.floating.divider': Object.freeze(['trennlinie', 'linie', 'trenner']),
    'core.floating.numberedList': Object.freeze(['nummerierung', 'nummerierte liste', 'liste']),
    'core.floating.quote': Object.freeze(['zitat', 'zitatblock']),
    'core.floating.todoList': Object.freeze(['aufgaben', 'checkliste', 'kontrollkästchen']),
    'core.heading.level': Object.freeze(['überschrift', 'ueberschrift', 'titel']),
    'core.toolbar.bold': Object.freeze(['fett', 'fettdruck']),
  } satisfies SearchAliases);
  return { deMessages, deSearchAliases };
}

/** German messages owned by @domternal/extension-block-controls. */
export function extensionBlockControls(): { deMessages: Readonly<CompleteMessages<typeof blockControlsMessages>>; deSearchAliases: SearchAliases } {
  /** German UI messages for block controls. */
  const deMessages: Readonly<CompleteMessages<typeof blockControlsMessages>> = Object.freeze({
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
  const deSearchAliases = Object.freeze({} satisfies SearchAliases);
  return { deMessages, deSearchAliases };
}

/** German messages owned by @domternal/extension-details. */
export function extensionDetails(): { deMessages: Readonly<CompleteMessages<typeof detailsMessages>>; deSearchAliases: SearchAliases } {
  /** German UI messages for collapsible details. */
  const deMessages: Readonly<CompleteMessages<typeof detailsMessages>> = Object.freeze({
    'details.toggle.label': 'Details ein- oder ausklappen',
    'details.toolbar.toggle': 'Aufklappbaren Block umschalten',
    'details.insert.label': 'Aufklappbarer Block',
    'details.insert.description': 'Ein- und ausklappbarer Inhaltsbereich',
  } satisfies CompleteMessages<typeof detailsMessages>);

  /** German search terms supplement the stable technical aliases. */
  const deSearchAliases = Object.freeze({
    'details.insert.label': Object.freeze(['aufklappen', 'einklappen', 'details', 'akkordeon']),
  } satisfies SearchAliases);
  return { deMessages, deSearchAliases };
}

/** German messages owned by @domternal/extension-emoji. */
export function extensionEmoji(): { deMessages: Readonly<CompleteMessages<typeof emojiMessages>>; deSearchAliases: SearchAliases } {
  /** German UI messages leave emoji names and shortcodes unchanged. */
  const deMessages: Readonly<CompleteMessages<typeof emojiMessages>> = Object.freeze({
    'emoji.insert': 'Emoji einfügen',
    'emoji.suggestion.label': 'Emoji-Vorschläge',
    'emoji.suggestion.empty': 'Keine Emojis gefunden',
  } satisfies CompleteMessages<typeof emojiMessages>);

  /** Emoji suggestions use their dataset identities rather than insertion aliases. */
  const deSearchAliases = Object.freeze({} satisfies SearchAliases);
  return { deMessages, deSearchAliases };
}

/** German messages owned by @domternal/extension-image. */
export function extensionImage(): { deMessages: Readonly<CompleteMessages<typeof imageMessages>>; deSearchAliases: SearchAliases } {
  /** German UI messages for images. */
  const deMessages: Readonly<CompleteMessages<typeof imageMessages>> = Object.freeze({
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
  const deSearchAliases = Object.freeze({
    'image.insert.label': Object.freeze(['bild', 'foto', 'abbildung']),
  } satisfies SearchAliases);
  return { deMessages, deSearchAliases };
}

/** German messages owned by @domternal/extension-math. */
export function extensionMath(): { deMessages: Readonly<CompleteMessages<typeof mathMessages>>; deSearchAliases: SearchAliases } {
  /** German UI messages leave authored LaTeX source unchanged. */
  const deMessages: Readonly<CompleteMessages<typeof mathMessages>> = Object.freeze({
    'math.inline.label': 'Formel im Text',
    'math.inline.description': 'Eine LaTeX-Formel im Text einfügen',
    'math.block.label': 'Formel',
    'math.block.description': 'Eine LaTeX-Formel als eigenen Block einfügen',
    'math.empty': 'Neue Formel',
    'math.source.label': 'LaTeX-Quelltext',
    'math.preview.placeholder': 'Vorschau',
  } satisfies CompleteMessages<typeof mathMessages>);

  /** German search terms supplement the stable technical aliases. */
  const deSearchAliases = Object.freeze({
    'math.inline.label': Object.freeze(['formel', 'gleichung', 'mathematik', 'im text']),
    'math.block.label': Object.freeze(['formel', 'gleichung', 'mathematik', 'formelblock']),
  } satisfies SearchAliases);
  return { deMessages, deSearchAliases };
}

/** German messages owned by @domternal/extension-mention. */
export function extensionMention(): { deMessages: Readonly<CompleteMessages<typeof mentionMessages>>; deSearchAliases: SearchAliases } {
  /** German UI messages leave mention names and identities unchanged. */
  const deMessages: Readonly<CompleteMessages<typeof mentionMessages>> = Object.freeze({
    'mention.suggestions.label': 'Erwähnungsvorschläge',
    'mention.suggestions.empty': 'Keine Ergebnisse',
  } satisfies CompleteMessages<typeof mentionMessages>);

  /** Mention suggestions use provider data rather than insertion aliases. */
  const deSearchAliases = Object.freeze({} satisfies SearchAliases);
  return { deMessages, deSearchAliases };
}

/** German messages owned by @domternal/extension-table. */
export function extensionTable(): { deMessages: Readonly<CompleteMessages<typeof tableMessages>>; deSearchAliases: SearchAliases } {
  /** German UI messages for tables. */
  const deMessages: Readonly<CompleteMessages<typeof tableMessages>> = Object.freeze({
    'table.cell.color': ({ color }) => color,
    'table.toolbar.insert': 'Tabelle einfügen',
    'table.insert.label': 'Tabelle',
    'table.insert.description': 'Eine einfache Tabelle einfügen',
    'table.controls.columnOptions': 'Spaltenoptionen',
    'table.controls.rowOptions': 'Zeilenoptionen',
    'table.controls.cellOptions': 'Zellenoptionen',
    'table.controls.cellFormatting': 'Zellenformatierung',
    'table.controls.cellColor': 'Zellenfarbe',
    'table.controls.alignment': 'Ausrichtung',
    'table.controls.mergeCells': 'Zellen verbinden',
    'table.controls.splitCell': 'Zelle teilen',
    'table.controls.toggleHeader': 'Kopfzelle umschalten',
    'table.row.insertAbove': 'Zeile darüber einfügen',
    'table.row.insertBelow': 'Zeile darunter einfügen',
    'table.row.delete': 'Zeile löschen',
    'table.column.insertLeft': 'Spalte links einfügen',
    'table.column.insertRight': 'Spalte rechts einfügen',
    'table.column.delete': 'Spalte löschen',
    'table.cell.backgroundColor': 'Zellenhintergrundfarbe',
    'table.cell.defaultColor': 'Standardfarbe',
    'table.cell.defaultColorText': 'Standard',
    'table.cell.alignment': 'Zellenausrichtung',
    'table.cell.alignLeft': 'Linksbündig ausrichten',
    'table.cell.alignCenter': 'Zentrieren',
    'table.cell.alignRight': 'Rechtsbündig ausrichten',
    'table.cell.alignTop': 'Oben ausrichten',
    'table.cell.alignMiddle': 'Vertikal zentrieren',
    'table.cell.alignBottom': 'Unten ausrichten',
  } satisfies CompleteMessages<typeof tableMessages>);

  /** German search terms supplement the stable technical aliases. */
  const deSearchAliases = Object.freeze({
    'table.insert.label': Object.freeze(['tabelle', 'raster', 'zeilen', 'spalten']),
  } satisfies SearchAliases);
  return { deMessages, deSearchAliases };
}

/** German messages owned by @domternal/extension-toc. */
export function extensionToc(): { deMessages: Readonly<CompleteMessages<typeof tocMessages>>; deSearchAliases: SearchAliases } {
  /** German UI messages preserve user-authored heading text. */
  const deMessages: Readonly<CompleteMessages<typeof tocMessages>> = Object.freeze({
    'toc.block.empty': 'Überschriften hinzufügen, um ein Inhaltsverzeichnis zu erstellen.',
    'toc.outline.label': 'Dokumentgliederung',
    'toc.heading.fallback': ({ level }, context) => `Überschrift der Ebene ${context.number(level)}`,
    'toc.heading.label': ({ label, level }, context) => `${label} (Überschrift ${context.number(level)})`,
    'toc.insert.label': 'Inhaltsverzeichnis',
    'toc.insert.description': 'Liste der Überschriften auf dieser Seite',
  } satisfies CompleteMessages<typeof tocMessages>);

  /** German search terms supplement the stable technical aliases. */
  const deSearchAliases = Object.freeze({
    'toc.insert.label': Object.freeze(['inhaltsverzeichnis', 'gliederung', 'übersicht', 'uebersicht', 'überschriften', 'ueberschriften']),
  } satisfies SearchAliases);
  return { deMessages, deSearchAliases };
}
