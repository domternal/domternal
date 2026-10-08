# URL and style policy

Use the same policy as the editor when building custom link controls, previews or exporters. Rendering a stored value does not grant permission to use it in another context; check the value where your application uses it.

[Core overview](../README.md) · [Content normalization](content.md) · [Security guide](https://domternal.dev/v1/guides/security/)

## URL policy

`checkUrl(value, options)` decides whether an address may be stored, rendered and opened, and
returns the spelling to use. It reads the value the way browsers do: leading and trailing control
characters and spaces are stripped, and tabs and line breaks inside it are removed, so a scheme
hidden behind them is judged as the browser would see it.

```ts
import { checkUrl, isValidUrl } from '@domternal/core';

checkUrl(' https://example.com/');           // { status: 'allowed', url: 'https://example.com/' }
checkUrl('java\tscript:alert(1)');           // { status: 'unsafe' }
checkUrl('ftp://example.com/');              // { status: 'unsupported' }
checkUrl('#intro', { allowRelative: true }); // { status: 'allowed', url: '#intro' }
isValidUrl('https://example.com/');          // true
```

- `unsafe`: `javascript:` and `vbscript:` addresses whatever `protocols` lists, `data:` addresses
  other than an allowed image, credentials in a web, mail or phone address such as
  `https://google.com@evil.example/` (a user stays allowed where it is the standard form of a
  scheme `protocols` lists, such as `ssh://git@host/repo.git` or `ftp://anonymous@host/`), control
  characters, unpaired UTF-16 surrogates, U+FFFE/U+FFFF and bidi embeddings, overrides
  and isolates anywhere, invisible format characters
  (every Unicode `Cf` character, such as a zero-width joiner, a bidi mark, a soft hyphen or a tag
  character) in the scheme, the host or the address of a scheme without a host (such as
  `mailto:` or `tel:`, whose address is everything before the query, and for `mailto:` also the
  `to`, `cc` and `bcc` fields), where a percent-encoded one counts too, since a mail client or
  dialer decodes the address, and values that are not strings (an array would otherwise be
  stringified into an address). Format characters, such as the zero-width joiners and marks of
  Persian, Arabic, Indic and emoji text, stay allowed in a path, query or fragment, which browsers
  percent-encode. A `mailto:`, `tel:` or `sms:` link without right-to-left letters may also hold
  LRM, LRE, LRI, PDF and PDI, which right-to-left environments write around a phone number or
  mail address to keep it left to right and which cannot reorder it; RLM, RLE, RLO and the other
  bidi controls reorder even a phone number, so they stay unsafe there.
- `unsupported`: a harmless value these options do not allow, such as another scheme, a relative
  reference without `allowRelative`, a network path (`//host`) or a backslash, which browsers
  read as a slash in web addresses, an address the URL parser rejects, and empty values, `null`
  and `undefined`. So is an `&` in a host, and an `&` that starts a character reference (`&#`, or
  a name and `;`, such as `&colon;`) in the first segment of a relative reference or right after
  its leading slash: HTML that leaves `&` unescaped in an attribute, as linkedom writes it,
  reaches the browser with character references decoded, where `javascript&colon;x` or
  `&#106;avascript:x` would spell a scheme. Any other `&`, as in `R&D-chart.png`, and every `&`
  in a path, query or fragment stays allowed: without a `;` HTML reads only the legacy Latin-1
  names, none of which spells a `:`, `/` or `\`.

The options are `protocols` (default `['http:', 'https:']`, compared in lower case with or
without the colon; `'any'` allows every scheme except `file:`), `allowRelative` (`/path`,
`./page`, `../page`, `page.html`, `?query`, `#fragment`; a colon in the first segment is refused),
`allowNetworkPath` and `allowDataImages`, the last two meant for image sources.

The policy guards against script and deception, so any release can change it: an address allowed
before can be refused once a new way to hide a scheme or a host is known. Check a stored address
where you use it instead of keeping an earlier answer.
`isValidUrl(value, options)` answers the same question with a boolean. Use `checkUrl` in a custom
link or image UI before opening an address yourself, and open it with `noopener`.

`IsValidUrlOptions` retains the 1.3 policy forms, including readonly protocol lists and `'any'`.
Code receiving that type must narrow it before reading a list; copying a list is preferable to
mutating caller-owned options. For a local mutable list, `satisfies` checks the options without
widening the inferred array type:

```ts
import type { IsValidUrlOptions } from '@domternal/core';

const options = { protocols: ['https:'] } satisfies IsValidUrlOptions;
options.protocols.push('mailto:');
```

The `Link` mark applies the policy with its `protocols` and `allowRelative` at every entry and
again at every sink. `allowRelative` (default `true`) allows relative links: `/docs/page`,
`./page`, `../page`, `page.html`, `?query` and `#section`. A network path (`//host`), a backslash
and a colon in the first segment are refused either way; `allowRelative: false` refuses every
relative link, as 1.2 did.

- HTML parsing, `setLink` and `toggleLink` store only an allowed href, in its cleaned spelling.
- A stored href the policy refuses, such as one loaded from JSON or written by a collaborator,
  renders as plain text in a `span` in the editor, `getHTML()` and `generateHTML`, so there is no
  anchor to follow or to copy. Rendering never changes the document.
- A click in an editable editor opens only the clicked link's own href, and only when the policy
  allows it. `_self`, `_parent` and `_top` targets navigate that browsing context; any other
  target opens a new tab with `noopener`, so the opened page cannot reach the editor's page, and
  with `noreferrer` unless `addRelNoopener` is `false` and the link's `rel` lacks it. A
  read-only editor leaves clicks to the browser, which follows only a rendered, allowed href.
  `openOnClick: 'whenNotEditable'` never opens links while the editor is editable, and `false`
  never opens them. A relative link opens resolved against the page. A `#fragment` link scrolls
  to the element with that id, in the editor first and then in the page, without opening a tab
  or changing the location; nothing happens when no element matches. A read-only editor does the
  same for a plain click on a fragment link, so a hash router does not see a route change, and
  leaves a click that asks for a new tab or window to the browser. HTML from `getHTML()` or
  `generateHTML()` shown outside an editor follows a fragment link natively, which changes
  `location.hash`; an app with a hash router handles clicks on `a[href^="#"]` there itself.
- An allowed link renders its `target` only when it is `_blank`, `_self`, `_parent` or `_top`
  (in any case, written in lower case), and its `title` and `class` only when they are strings.
  With `addRelNoopener` (the default), a `_blank` link's `rel` keeps its stored tokens except
  `opener` and gains `noopener` and `noreferrer`, so `nofollow` renders as
  `nofollow noopener noreferrer`.

The `LinkPopover` stores what the `Link` accepts, so its input follows the same policy. A value
that starts with `#`, `/`, `./`, `../` or `?` is stored as typed, `//host/x` and a bare host such
as `example.com` or `localhost:3000` get the Link's `defaultProtocol`, a bare email address
becomes a `mailto:` link, and anything else with a scheme is stored as typed. A refused address
keeps the popover open: the input is marked `aria-invalid`, the localized
`core.linkPopover.invalidUrl` message shows below it as `.dm-link-popover-error`, describes it
through `aria-describedby` and is its validity message, and a refused Apply announces it as an
alert. The reason stays until the value changes and follows a live locale change. Opening the
popover on a stored link the Link would not keep shows it already marked invalid, with the
reason and without an alert. Editing an existing link changes
only its href and keeps its `title`, `target`, `rel` and `class`. `LinkPopover.configure({
protocols })` narrows the schemes the popover accepts, read the way the Link reads its own; the
untouched default and an explicit `null` accept every scheme the Link accepts. An entry that
names no scheme fails editor creation with an `ExtensionConfigurationError`.

When upgrading a complete application translation catalog from 1.2, add
`core.linkPopover.invalidUrl`. `CompleteMessages<typeof coreMessages>` requires
every selected translation, including this key. Applications that intentionally
leave some messages in English can type their overrides as `Messages` instead;
missing translations then use the English defaults.

The public default `Link.options.protocols` and `LinkPopover.options.protocols` values are
string arrays at runtime. The public types continue to accept `null`, readonly lists and object
entries, as in 1.3.0. An explicitly configured
popover array narrows the Link policy even when it contains the default schemes. A changed
default array also narrows the policy. Configure policies before creating the editor.

TypeScript code that reads `protocols` must handle `null` and object entries, including when
reading the default instance. To edit a policy, copy its entries into a new array and configure
the extension before creating the editor:

```ts
import { Link } from '@domternal/core';

const protocols = Link.options.protocols?.map(entry =>
  typeof entry === 'string' ? entry : entry.scheme,
) ?? ['http:', 'https:', 'mailto:', 'tel:'];
protocols.push('ftp:');
const applicationLink = Link.configure({ protocols });
```

Here `null` uses Link's standard schemes. On LinkPopover, `null` instead follows the configured
Link policy, so preserve it when that is the intended behavior.

## Style values

Text color, highlight, font family, font size, alignment and line height are stored as values and
written into a `style` attribute when rendered. `isSafeCssValue(value)` decides whether a value
may be written there: a string of at most 256 characters with no control character, none of
`; { } [ ] < > \ " ' ! @ &`, no comment, balanced parentheses, and no function other than the
color and arithmetic functions (`rgb`, `rgba`, `hsl`, `hsla`, `hwb`, `lab`, `lch`, `oklab`,
`oklch`, `color`, `color-mix`, `light-dark`, `var`, `calc`, `min`, `max`, `clamp`), inside which
parentheses may also group arithmetic, as in `calc(1rem + (2vw - 1rem) * 0.5)`. Such a value
cannot add a declaration, such as `position: fixed`, or load a resource through `url()`.

```ts
import { isSafeCssValue } from '@domternal/core';

isSafeCssValue('#ff0000');                    // true
isSafeCssValue('calc(1em + 2px)');            // true
isSafeCssValue('red;position:fixed');         // false
isSafeCssValue('url(https://example.com/x)'); // false
```

- The editor DOM, `getHTML()` and `generateHTML()` write a stored value only when it is safe. Any
  other value is left out of the `style` attribute and kept in the document, so the stored JSON
  does not change. The other values of the same mark still render.
- `setTextColor`, `setHighlight`, `toggleHighlight` (when it adds a highlight), `setFontFamily`,
  `setFontSize`, `setTextAlign` and `setLineHeight` return `false` for a value that is not safe.
  An empty or blank value, such as a "Default" option's `''`, clears the style instead, as the
  matching unset command does, and returns `true`.
- Alignment renders any safe value as stored, such as the `-webkit-center` Chrome writes for
  centered content. `setTextAlign` also needs the value in `alignments`.
- A line height stored as a finite number, such as `1.5`, renders as that number.
- A font family list is written with each name that holds a space quoted, and quotes in the stored
  value are dropped first, so `"Times New Roman", serif` renders as `'Times New Roman', serif`.
- `LineHeight` renders only its configured `lineHeights`; with an empty list, any safe value.
- Use `isSafeCssValue` before writing a stored style value into markup yourself, such as in an
  exporter. Like the URL policy, the rule can change in any release: a value accepted before can
  be refused once a new way to add a declaration or load a resource is known.
