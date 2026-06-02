import { Component, ChangeDetectionStrategy, OnDestroy } from '@angular/core';
import { DomternalEditorComponent } from '@domternal/angular';
import { StarterKit, type AnyExtension, type Editor } from '@domternal/core';

/**
 * "Tab + lists" demo (Angular). Two StarterKit editors embedded between form
 * fields, the page-builder / form scenario from issue #98.
 *
 *  - LEFT  (default StarterKit): `listIndent` OFF. Tab on a paragraph that
 *    merely follows a list moves focus to the next field.
 *  - RIGHT (StarterKit.configure({ listIndent: true })): opt-in. Tab on the
 *    paragraph after the list pulls it INTO the list, focus stays.
 *
 * E2E hook: `window.__TAB_EDITORS__` = [defaultEditor, optInEditor].
 */
@Component({
  selector: 'app-tab-indent-demo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DomternalEditorComponent],
  templateUrl: './tab-indent-demo.component.html',
})
export class TabIndentDemoComponent implements OnDestroy {
  readonly content =
    '<ul><li><p>Bullet one</p></li><li><p>Bullet two</p></li></ul>' +
    '<p>Para after list</p>' +
    '<p>Plain paragraph</p>';

  readonly defaultExt: AnyExtension[] = [StarterKit];
  readonly optInExt: AnyExtension[] = [StarterKit.configure({ listIndent: true }) as AnyExtension];

  // Fixed order: [0] = default editor, [1] = opt-in editor.
  private readonly editors: (Editor | null)[] = [null, null];

  onCreated(index: number, editor: Editor): void {
    this.editors[index] = editor;
    const w = window as unknown as Record<string, unknown>;
    w['__TAB_EDITORS__'] = this.editors.filter((e): e is Editor => Boolean(e));
  }

  ngOnDestroy(): void {
    const w = window as unknown as Record<string, unknown>;
    delete w['__TAB_EDITORS__'];
  }
}
