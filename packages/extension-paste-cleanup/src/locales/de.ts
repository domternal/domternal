// Generated from locales/de.ts. Run pnpm locales:generate; do not edit.
import type { CompleteMessages, SearchAliases } from "@domternal/core";
import type { pasteCleanupMessages } from "@domternal/extension-paste-cleanup";

/** German paste feedback never includes source content or diagnostic payloads. */
export const deMessages: Readonly<CompleteMessages<typeof pasteCleanupMessages>> = Object.freeze({
    'pasteCleanup.feedback.label': 'Hinweis zum Einfügen',
    'pasteCleanup.feedback.applied': 'Eingefügten Inhalt prüfen.',
    'pasteCleanup.feedback.rejected': 'Einfügen wurde blockiert.',
    'pasteCleanup.feedback.untracked': 'Ergebnis des Einfügens prüfen.',
    'pasteCleanup.feedback.noop': 'Beim Einfügen wurden keine Änderungen vorgenommen.',
    'pasteCleanup.feedback.details': 'Details',
    'pasteCleanup.feedback.dismiss': 'Schließen',
    'pasteCleanup.feedback.dismissLabel': 'Hinweis zum Einfügen schließen',
    'pasteCleanup.feedback.imageRecovery': 'Fehlende Bilder separat einfügen. Falls verfügbar, die ursprüngliche DOCX-Datei importieren.',
    'pasteCleanup.feedback.rejectedRecovery': 'Eine kleinere Auswahl versuchen oder als unformatierten Text einfügen.',
    'pasteCleanup.feedback.truncated': 'Nicht alle Details zum Einfügen werden angezeigt.',
    'pasteCleanup.diagnostic.inputLimit': 'Der Inhalt der Zwischenablage überschreitet die Größenbegrenzung für das Einfügen.',
    'pasteCleanup.diagnostic.structureLimit': 'Der Inhalt der Zwischenablage überschreitet die unterstützten Dokumentgrenzen.',
    'pasteCleanup.diagnostic.parseFailed': 'Der Inhalt der Zwischenablage konnte nicht sicher gelesen werden.',
    'pasteCleanup.diagnostic.unsafeContent': 'Nicht unterstützte oder unsichere Inhalte wurden entfernt.',
    'pasteCleanup.diagnostic.unsupportedFormatting': 'Einige Formatierungen konnten nicht beibehalten werden.',
    'pasteCleanup.diagnostic.imageRemoved': 'Einige Bilder konnten nicht übernommen werden.',
    'pasteCleanup.diagnostic.linkRemoved': 'Einige Links wurden entfernt.',
    'pasteCleanup.diagnostic.formattingAdapted': 'Die Formatierung wurde an den Editor angepasst.',
    'pasteCleanup.diagnostic.officeListUnsupported': 'Einige Office-Listen konnten nicht wiederhergestellt werden.',
    'pasteCleanup.diagnostic.other': 'Einige eingefügte Inhalte sollten überprüft werden.',
} satisfies CompleteMessages<typeof pasteCleanupMessages>);

/** Feedback controls do not participate in insertion search. */
export const deSearchAliases = Object.freeze({} satisfies SearchAliases);
