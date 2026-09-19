// Generated from locales/de.ts. Run pnpm locales:generate; do not edit.
import type { CompleteMessages, SearchAliases } from "@domternal/core";
import type { tableMessages } from "@domternal/extension-table";

/** German UI messages for tables. */
export const deMessages: Readonly<CompleteMessages<typeof tableMessages>> = Object.freeze({
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
export const deSearchAliases = Object.freeze({
    'table.insert.label': Object.freeze(['tabelle', 'raster', 'zeilen', 'spalten']),
} satisfies SearchAliases);
