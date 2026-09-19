/** Official catalogs stay complete, exact and readonly through published declarations. */
import core = require('@domternal/core');
import coreDe = require('@domternal/core/locales/de');
import blockControls = require('@domternal/extension-block-controls');
import blockControlsDe = require('@domternal/extension-block-controls/locales/de');
import table = require('@domternal/extension-table');
import tableDe = require('@domternal/extension-table/locales/de');
import image = require('@domternal/extension-image');
import imageDe = require('@domternal/extension-image/locales/de');
import details = require('@domternal/extension-details');
import detailsDe = require('@domternal/extension-details/locales/de');
import emoji = require('@domternal/extension-emoji');
import emojiDe = require('@domternal/extension-emoji/locales/de');
import math = require('@domternal/extension-math');
import mathDe = require('@domternal/extension-math/locales/de');
import mention = require('@domternal/extension-mention');
import mentionDe = require('@domternal/extension-mention/locales/de');
import toc = require('@domternal/extension-toc');
import tocDe = require('@domternal/extension-toc/locales/de');

type ExpectedCatalogs = {
  core: Readonly<core.CompleteMessages<typeof core.coreMessages>>;
  blockControls: Readonly<core.CompleteMessages<typeof blockControls.blockControlsMessages>>;
  table: Readonly<core.CompleteMessages<typeof table.tableMessages>>;
  image: Readonly<core.CompleteMessages<typeof image.imageMessages>>;
  details: Readonly<core.CompleteMessages<typeof details.detailsMessages>>;
  emoji: Readonly<core.CompleteMessages<typeof emoji.emojiMessages>>;
  math: Readonly<core.CompleteMessages<typeof math.mathMessages>>;
  mention: Readonly<core.CompleteMessages<typeof mention.mentionMessages>>;
  toc: Readonly<core.CompleteMessages<typeof toc.tocMessages>>;
};

const catalogs = {
  core: coreDe.deMessages,
  blockControls: blockControlsDe.deMessages,
  table: tableDe.deMessages,
  image: imageDe.deMessages,
  details: detailsDe.deMessages,
  emoji: emojiDe.deMessages,
  math: mathDe.deMessages,
  mention: mentionDe.deMessages,
  toc: tocDe.deMessages,
} satisfies ExpectedCatalogs;

// A widened string index or any would otherwise conceal missing and unknown keys.
type ExactKeys<Actual, Expected> = 0 extends (1 & Actual) ? false
  : [keyof Actual] extends [keyof Expected]
    ? [keyof Expected] extends [keyof Actual] ? true : false
    : false;
const exactKeys: {
  [Package in keyof ExpectedCatalogs]: ExactKeys<typeof catalogs[Package], ExpectedCatalogs[Package]>;
} = {
  core: true,
  blockControls: true,
  table: true,
  image: true,
  details: true,
  emoji: true,
  math: true,
  mention: true,
  toc: true,
};

const messages: core.Messages = {
  ...coreDe.deMessages,
  ...blockControlsDe.deMessages,
  ...tableDe.deMessages,
  ...imageDe.deMessages,
  ...detailsDe.deMessages,
  ...emojiDe.deMessages,
  ...mathDe.deMessages,
  ...mentionDe.deMessages,
  ...tocDe.deMessages,
  'core.toolbar.bold': 'Custom bold',
};
const searchAliases: core.SearchAliases = {
  ...coreDe.deSearchAliases,
  ...blockControlsDe.deSearchAliases,
  ...tableDe.deSearchAliases,
  ...imageDe.deSearchAliases,
  ...detailsDe.deSearchAliases,
  ...emojiDe.deSearchAliases,
  ...mathDe.deSearchAliases,
  ...mentionDe.deSearchAliases,
  ...tocDe.deSearchAliases,
};

// Application-owned overrides are partial; the official catalog remains readonly.
// @ts-expect-error Official messages cannot be mutated.
coreDe.deMessages['core.bubbleMenu.blockActionsSelectionHint'] = 'Changed';
// @ts-expect-error Official messages cannot be mutated.
blockControlsDe.deMessages['blockControls.color.background'] = 'Changed';
// @ts-expect-error Official messages cannot be mutated.
tableDe.deMessages['table.cell.alignBottom'] = 'Changed';
// @ts-expect-error Official messages cannot be mutated.
imageDe.deMessages['image.action.delete'] = 'Changed';
// @ts-expect-error Official messages cannot be mutated.
detailsDe.deMessages['details.insert.description'] = 'Changed';
// @ts-expect-error Official messages cannot be mutated.
emojiDe.deMessages['emoji.insert'] = 'Changed';
// @ts-expect-error Official messages cannot be mutated.
mathDe.deMessages['math.block.description'] = 'Changed';
// @ts-expect-error Official messages cannot be mutated.
mentionDe.deMessages['mention.suggestions.empty'] = 'Changed';
// @ts-expect-error Official messages cannot be mutated.
tocDe.deMessages['toc.block.empty'] = 'Changed';

declare const context: core.I18nFormattingContext;
const heading = coreDe.deMessages['core.heading.level'];
if (typeof heading === 'function') {
  heading({ level: 2 }, context);
  // @ts-expect-error Locale declarations retain dynamic message parameters.
  heading({ level: 'two' }, context);
}
const cellColor = tableDe.deMessages['table.cell.color'];
if (typeof cellColor === 'function') {
  cellColor({ color: 'blue' }, context);
  // @ts-expect-error Extension parameters survive both declaration graphs.
  cellColor({ color: 2 }, context);
}

// @ts-expect-error Alias keys are restricted to searchable messages.
const invalidAliases: core.SearchAliases = { 'core.group.insert': ['Insertion'] };
