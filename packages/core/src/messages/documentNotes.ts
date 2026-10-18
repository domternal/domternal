import { defineMessage } from '../i18n/index.js';

export const documentNoteMessages = {
  noteFootnote: defineMessage({ id: 'core.documentNotes.footnote', defaultValue: ({ label }) => `Footnote ${label}`, owner: '@domternal/core', description: 'A document footnote and its displayed number or custom mark.', optionalTranslation: true }),
  noteEndnote: defineMessage({ id: 'core.documentNotes.endnote', defaultValue: ({ label }) => `Endnote ${label}`, owner: '@domternal/core', description: 'A document endnote and its displayed number or custom mark.', optionalTranslation: true }),
  noteMissing: defineMessage({ id: 'core.documentNotes.missing', defaultValue: 'Note content is missing', owner: '@domternal/core', description: 'A reference without one matching note body.', optionalTranslation: true }),
  noteDuplicate: defineMessage({ id: 'core.documentNotes.duplicate', defaultValue: 'More than one note uses this identity', owner: '@domternal/core', description: 'Ambiguous document note bodies are kept visible for correction.', optionalTranslation: true }),
  noteUnreferenced: defineMessage({ id: 'core.documentNotes.unreferenced', defaultValue: 'This note has no reference', owner: '@domternal/core', description: 'An editable note whose reference was removed.', optionalTranslation: true }),
  noteLimit: defineMessage({ id: 'core.documentNotes.limit', defaultValue: 'Note navigation is unavailable for this document size', owner: '@domternal/core', description: 'The bounded note index cannot safely resolve this document.', optionalTranslation: true }),
};
