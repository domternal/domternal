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
  createBubbleMenuPlugin,
} from '@domternal/core';
import type { BubbleMenuOptions } from '@domternal/core';

@Component({
  selector: 'domternal-bubble-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: '<div #menuEl class="dm-bubble-menu"><ng-content /></div>',
  styles: [`:host { display: contents; }`],
})
export class DomternalBubbleMenuComponent implements OnDestroy {
  readonly editor = input.required<Editor>();
  readonly shouldShow = input<BubbleMenuOptions['shouldShow']>();
  readonly placement = input<'top' | 'bottom'>('top');
  readonly offset = input<[number, number]>([0, 8]);
  readonly updateDelay = input(0);

  private menuEl = viewChild.required<ElementRef<HTMLElement>>('menuEl');
  private pluginKey: PluginKey;

  constructor() {
    // Unique key per instance — multiple bubble menus on same page
    this.pluginKey = new PluginKey(
      'angularBubbleMenu-' + Math.random().toString(36).slice(2, 8),
    );

    afterNextRender(() => {
      const plugin = createBubbleMenuPlugin({
        pluginKey: this.pluginKey,
        editor: this.editor(),
        element: this.menuEl().nativeElement,
        shouldShow: this.shouldShow(),
        placement: this.placement(),
        offset: this.offset(),
        updateDelay: this.updateDelay(),
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
