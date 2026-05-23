import { Component, ChangeDetectionStrategy, computed, signal } from '@angular/core';
import { EditorDemoComponent } from './editor-demo/editor-demo.component.js';
import { NotionDemoComponent } from './notion-demo/notion-demo.component.js';

export type DemoMode = 'default' | 'custom' | 'notion' | 'notion-scrollable';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EditorDemoComponent, NotionDemoComponent],
  templateUrl: './app.html',
})
export class App {
  isDark = signal(false);
  mode = signal<DemoMode>('default');
  // The editor-demo takes a boolean `useLayout` input; derive it from mode
  // so the existing component stays unchanged.
  useLayout = computed(() => this.mode() === 'custom');
  isNotion = computed(() => this.mode() === 'notion' || this.mode() === 'notion-scrollable');
  isScrollable = computed(() => this.mode() === 'notion-scrollable');

  toggleTheme(): void {
    this.isDark.update(v => !v);
    document.body.classList.toggle('dm-theme-dark');
  }
}
