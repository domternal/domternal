# Preserve pasted lists and markers

Use this reference when pasted lists need their numbering, marker class or nesting retained. Both formatting policies preserve supported list structure; destination rendering still controls glyphs, fonts and layout.

## Supported HTML list markers

Both formatting modes retain supported list marker classes. Ordered lists support
`decimal`, `lower-alpha`, `upper-alpha`, `lower-roman` and `upper-roman`; bullet lists
support `disc`, `circle` and `square`. Only these kind-specific `list-style-type`
values and supported HTML `type` attributes are accepted. A `list-style-type`
declared on list items moves to their list when every direct item agrees, an item
without one counting as its list's marker. Items that disagree, declare a marker
their list kind cannot hold, have an HTML `type` of their own without a marker, or
carry a style that CSS may read otherwise than a split on semicolons (a comment, an
escape, `!important`, or a string or bracket holding a semicolon), and lists that
hold elements other than items and nested lists, keep the markers on the items,
which still report `unsupported-formatting`. This covers the
shape Google Docs writes, the marker on each item and a nested list directly in
its parent list, in supported copies. Core stores an explicit
marker in `listStyleType`; `null` keeps the destination theme's depth-based defaults.
Slice context follows the same restrictions. Task lists do not gain this
attribute. Lists with different explicit markers stay separate during paste and
list editing. A pasted list with an explicit marker, such as one whose item markers
moved to it or a reconstructed Office list, also stays separate from a destination
list without one: pasting it inside such a list splits that list around it, and in
a numbered list the items after the paste number from 1 again.

## Office list reconstruction

Explicit inline `mso-list:lN levelN lfoN` paragraphs with one leading
`mso-list:Ignore` marker can become semantic lists. Reconstruction runs only where the markup
declares `mso-list`, in a style attribute as written, a stylesheet rule or a conditional comment;
text that names the property starts none. When the clipboard HTML carries
Word's stylesheet, its `@list lN:levelN` level definition, with a matching
`lfoN` instance override applied over it, and the font of the marker run identify
the list profile. The visible label must be exactly what that definition produces
for the paragraph's level. It is read without the spacing around it: Word right
aligns a level, as the third level of its numbering library, by padding the label
with a spacer run of 7 pt no-break spaces that fills the indent before it. The
label may hold at most 64 characters other than that spacing, and the marker at
most 2,048 UTF-16 units of text with it: Word writes about one no-break space per
point of the label's position, so about 1,600 at the widest indent it allows
(22 inches):

| Word level definition | Visible marker | Marker class |
| --- | --- | --- |
| Decimal, level text absent, `%N.` or `%N)` | `1.` to `10000.` with the same punctuation | `decimal` |
| `alpha-lower` or `alpha-upper`, same level text rule | one letter of that case | `lower-alpha` or `upper-alpha` |
| `roman-lower` or `roman-upper`, same level text rule | a canonical numeral up to 3999 of that case | `lower-roman` or `upper-roman` |
| Bullet `\F0B7` in Symbol | `·` or U+F0B7 in a Symbol marker run | `disc` |
| Bullet `o` in Courier New, as `font-family` or, without one, the ASCII font Word names per script | `o` in a Courier New marker run | `circle` |
| Bullet `\F0A7` in Wingdings | `§` or U+F0A7 in a Wingdings marker run | `square` |
| Bullet `•`, `●`, `◦` or `▪` | the same glyph | `disc`, `disc`, `circle` or `square` |

A glyph alone never selects a Word profile. `o`, `§`, `a.` or `i.` without a
matching definition and marker run font stay literal, and `i.` under an
alphabetic definition is the ninth letter, not a Roman one. Legal and multilevel
numbering, prefixed or custom level text, other number formats, other symbol and
picture bullets, letters past `z`, and malformed or conflicting definitions stay
literal. A paragraph without a level definition, for example when a browser
drops the stylesheet, admits only these fallback markers: positive decimal numbers followed
by `.` or `)` and the Unicode bullets `• · ◦ ▪ ●` are admitted. The reader records
only the levels that pasted paragraphs reference and the levels above them, bounds
each rule body to 8,192 UTF-16 units, 64 declarations and 64 units of level text,
and resolves no other CSS.

A selection that starts in a nested item has no parent levels. They open from
their level definitions with one empty item each, so the item keeps its depth and
marker; an ordered level starts one before the number of its next item in the
run, which then continues it. Without a supported definition for every missing
level the item stays literal. An item more than one level below the previous one
later in a run stays literal too, with its visible marker and
`office-list-unsupported`: an empty item would show a marker Word does not.

## Unsupported items and destination fallback

Fallback is per item. An unsupported item, or one whose missing parent levels
have no supported definition, stays a literal paragraph with its visible marker:
inside the nearest open list item when the destination can nest lists, otherwise
at the list's own level, which closes the open lists. Deeper items under a
literal item have no list parent and stay literal until the level returns to a
supported parent. A picture bullet, which Word writes as an image inside the
marker, is the marker's decoration and never an image of the paste: a literal
item keeps its alt text as the visible marker, and it is neither removed with
`image-removed` nor offered to image preparation. Each
contiguous group of literal items reports one `office-list-unsupported` located
at its first paragraph. A literal item keeps its source paragraph, so hanging
indentation it carries is also reported as `unsupported-formatting`. Nesting, observed
starts, restarts and gaps retain separate list wrappers. SmartPaste preserves
reconstructed ordered-list starts when pasting into a list. Class-only lists are
not reconstructed. The extension probes the receiving schema's actual list parse
rules for each marker class before removing visible markers, so a destination
that cannot keep one class keeps only those items literal. The standalone HTML
entry has no destination schema and emits semantic list HTML; its caller remains
responsible for destination compatibility.

Reconstructed Office lists use an explicit marker class at every depth, and a
change of marker class creates a separate list. The schema probes must confirm
each explicit marker class before Office marker text is removed. Legacy schemas
keep the visible Office markers with `office-list-unsupported`; ordinary semantic
HTML can still paste with `destination-formatting-unconfirmed`. Marker classes do
not promise identical glyphs, punctuation, fonts, spacing or page layout: `a)`
and `a.` both become `lower-alpha`.

## Partial and nested selections

A list beginning with a nested list before any item gets a first item to hold
that nested list. A task list beginning with a list stays as written.

A list or task item beginning with a nested list gets an empty paragraph first,
so the nested list remains inside its item and later items retain the outer
list's kind. The items on the open start of retained `data-pm-slice` context are
exempt for the marker's open depth: their labels were cut by the selection, and
preserving that shape lets the first line join the paragraph at the caret.
Recognized Domternal own copies remain unchanged.

Destination fitting still matters. Into a paragraph with text, ProseMirror can
place the nested list separately before later items. A paste over the whole
document can drop a quote around the list.

Google Docs copies with consistent `aria-level` values and matching 36 pt margins
restore missing ancestor levels with one empty item at each depth. Checklists
whose items all declare ARIA checkbox state become task lists; without task-list
support, they become bullets with a `destination-formatting-unconfirmed` warning.
See [Google Docs formatting](https://github.com/domternal/domternal/blob/main/packages/extension-paste-cleanup/docs/html-normalization.md#google-docs-formatting).
