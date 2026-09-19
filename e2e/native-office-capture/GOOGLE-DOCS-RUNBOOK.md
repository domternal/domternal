# Google Docs capture runbook: Chrome, Safari and Firefox on macOS

> History rewrite context: the original dates, versions, findings and results
> below describe this revision's archived baseline. Where fixture content has
> been translated, the committed artifacts are authored English regression
> variants, not new native Office captures. Original native evidence remains
> unchanged in the owner's private baseline bundle. A variant's `derivation`
> references that baseline's source, capture and manifest hashes; its own hashes
> identify the edited bytes. Word Chrome screenshot alternatives become
> synthetic PNG controls. Historical qualification remains limited to the
> original reviewed paths; no old result is a test of translated bytes. The
> later synthetic variants preserve regression intent and make no fresh native
> qualification claim. Future native admission still needs an actual capture.


Status: **prepared, not captured.** The owner or a named tester performs every
step by hand. The documents, selections and expected results for preserve and
adapt are in [`content/google-docs-v1.json`](./content/google-docs-v1.json); a
capture made this way is evidence for review, never a qualification.

## Never include

- Personal data: no names, addresses, phone numbers or photos of anyone. The
  only addresses are the `example.com` and `example.org` ones in the
  specification.
- The account: never write the Google account address, its display name or a
  document URL or ID in the capture form, a file name, a copy method or a note.
  Record only "personal account" or "Workspace account".
- Comments, suggestions, @mentions, people, file, date or place chips, Drive
  links, bookmarks, headers, footers and footnotes.
- Images other than the generated ones. Never insert by URL or from Drive,
  Photos, a search or a camera.
- Sharing: keep every document Restricted, never "Anyone with the link". Delete
  the documents from Drive and its trash once the fixtures are reviewed.
- Other software in the clipboard path: quit clipboard managers and remote
  desktop sessions, and use a browser profile without extensions.

A capture holds the image addresses Google Docs serves, which open those images
for anyone who has them. That is acceptable only because the images are
generated; a bundle that holds anything else must be deleted, not edited.

## Prepare once

1. In the repository, run `pnpm build`, then
   `node e2e/native-office-capture/content/google-docs-images.mjs /private/tmp/gdocs-v1-images`
   (57 PNG files, listed with their SHA-256) and
   `node e2e/native-office-capture/content/large-source.mjs > /private/tmp/large-v1.html`.
2. Print the texts to enter:
   `node e2e/native-office-capture/semantics.mjs --print e2e/native-office-capture/content/google-docs-v1.json > /private/tmp/gdocs-v1-texts.txt`
   and open the file in TextEdit. Each block lists its instruction, the exact
   text and the formatting of single words.
3. In Google Docs, turn off Tools > Preferences > Automatically capitalize words,
   Use smart quotes and Automatic substitution.
4. Create the seven documents with File > New > Document and the titles of the
   specification: `gdocs-v1-basics`, `gdocs-v1-lists`, `gdocs-v1-tables`,
   `gdocs-v1-images`, `gdocs-v1-large-image`, `gdocs-v1-mixed` and
   `gdocs-v1-large`. Copy each text from TextEdit and paste it with
   Cmd+Shift+V, then apply the formatting the block names. Never type a list
   marker. Never upload or import a document file.
5. When a document is finished, use File > Download > Microsoft Word (.docx),
   keep the file outside the repository and run `shasum -a 256 <file>.docx`.
   That hash is the fixture hash of every capture from the document; a later
   edit needs a new export and hash. Each capture's fixture holds this export,
   which `prepare-fixture.mjs` and `offline.mjs` accept up to 16 MiB; the large
   image has its own document so that only its captures carry it. Confirm that
   `unzip -p <file>.docx docProps/core.xml docProps/app.xml` shows no name or
   address.

## Per capture, in Chrome, Safari and Firefox

1. Run `node e2e/native-office-capture/server.mjs` and open
   `http://127.0.0.1:5896` in the browser being captured, the same browser that
   shows the Google document.
2. Fill the form. OS: the output of `sw_vers`. Application: "Google Docs web",
   the capture date, the account type and the page format. Browser: only the
   version with its build, from the first line of chrome://version, Safari >
   About Safari or Firefox > About Firefox. Fixture identifier:
   `<scenario>-<browser>`, for example `gdocs-default-bullets-chrome`; a
   scenario copied more than once adds what differs, for example
   `gdocs-slow-copy-chrome-wait-15s` or `gdocs-large-document-safari-25-percent`,
   so every bundle gets its own fixture directory. Fixture hash: the export
   hash. Scenario: the scenario from the Google Docs group. Copy method: the
   scenario's selection, the copy command and "exported with File > Download >
   .docx". Then confirm and enable the area.
3. For `gdocs-large-image`, `gdocs-slow-copy`, `gdocs-image-limit-51` and
   `gdocs-large-document`, first run the flavor size snippet of the
   [README](./README.md#per-capture) in the capture page's console.
4. In Google Docs, make the scenario's selection exactly and press Cmd+C. Click
   the capture area and press Cmd+V once, then download the bundle. For
   `gdocs-slow-copy`, paste within one second; copy again, wait 15 seconds and
   capture a second bundle.
5. After `pnpm build`, start the fixture editor with
   `node apps/demo-react/node_modules/vite/bin/vite.js --config e2e/paste-cleanup-fixture/vite.config.mjs`
   and open
   `http://127.0.0.1:5895/?framework=vanilla&formatting=preserve&list-markers=1`,
   with the scenario's `editorQuery` appended when it has one. Copy the selection
   again, paste, note whether the notice shows and run
   `copy(JSON.stringify({ results: __pasteCleanup.results, doc: __pasteCleanup.editor.getJSON() }))`
   in the console. Save it as `editor-preserve.json`, then repeat with
   `formatting=adapt` for `editor-adapt.json`.
6. Check both results and the capture itself:
   `node e2e/native-office-capture/semantics.mjs e2e/native-office-capture/content/google-docs-v1.json <scenario> editor-preserve.json preserve`,
   the same with `editor-adapt.json adapt`, and with the downloaded bundle in
   place of the editor result. The bundle report replays the captured HTML and
   counts its images by URL scheme without printing an address. Problems are
   findings to record; never edit a capture.
7. Put the export as `source.docx` and the bundle as `capture.json` into
   `e2e/native-office-capture/fixtures/<fixture identifier>/` and run
   `node e2e/native-office-capture/prepare-fixture.mjs <that directory> --id <fixture identifier> --source source.docx`.
   Commit nothing before the privacy review of the source and the bundle.

## Browser notes

- Chrome: record only the first line of chrome://version, including the build.
  The rest of the page shows the profile and executable paths, which name the
  macOS account.
- Safari: Safari can rewrite HTML pasted from another site; capture what
  arrives. If it asks to allow a paste, allow it and say so in the copy method.
- Firefox: record which formats the capture lists; Firefox can expose fewer
  than Chrome.

A scenario that cannot be captured, for example a list preset Google Docs does
not offer, is recorded with its reason instead of a bundle.
