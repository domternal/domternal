import {
  Component,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  OnDestroy,
  input,
  viewChild,
  ElementRef,
  afterNextRender,
} from '@angular/core';

import {
  Editor,
  PluginKey,
  createFloatingMenuPlugin,
} from '@domternal/core';
import type { FloatingMenuOptions } from '@domternal/core';

@Component({
  selector: 'domternal-floating-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: '<div #menuEl class="dm-floating-menu"><ng-content /></div>',
  styles: [`:host { display: contents; }`],
})
export class DomternalFloatingMenuComponent implements OnDestroy {
  readonly editor = input.required<Editor>();
  readonly shouldShow = input<FloatingMenuOptions['shouldShow']>();
  readonly offset = input<[number, number]>([0, 0]);

  private menuEl = viewChild.required<ElementRef<HTMLElement>>('menuEl');
  private pluginKey: PluginKey;

  constructor() {
    // Unique key per instance — multiple floating menus on same page
    this.pluginKey = new PluginKey(
      'angularFloatingMenu-' + Math.random().toString(36).slice(2, 8),
    );

    afterNextRender(() => {
      const plugin = createFloatingMenuPlugin({
        pluginKey: this.pluginKey,
        editor: this.editor(),
        element: this.menuEl().nativeElement,
        shouldShow: this.shouldShow(),
        offset: this.offset(),
      });
      this.editor().registerPlugin(plugin);
    });
  }

  ngOnDestroy(): void {
    const editor = this.editor();
    if (!editor.isDestroyed) {
      editor.unregisterPlugin(this.pluginKey);
    }
  }
}
