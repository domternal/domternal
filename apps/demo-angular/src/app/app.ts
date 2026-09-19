import { Component, ChangeDetectionStrategy, computed, signal } from '@angular/core';
import { DEMO_I18N, type DemoLanguage } from './demo-i18n.js';
import { EditorDemoComponent } from './editor-demo/editor-demo.component.js';
import { NotionDemoComponent } from './notion-demo/notion-demo.component.js';
import { MultiEditorDemoComponent } from './multi-editor-demo/multi-editor-demo.component.js';
import { TabIndentDemoComponent } from './tab-indent-demo/tab-indent-demo.component.js';
import { NgModelDemoComponent } from './ngmodel-demo/ngmodel-demo.component.js';

export type DemoMode = 'default' | 'custom' | 'ngmodel' | 'notion' | 'notion-scrollable' | 'multi' | 'tab';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EditorDemoComponent, NotionDemoComponent, MultiEditorDemoComponent, TabIndentDemoComponent, NgModelDemoComponent],
  templateUrl: './app.html',
})
export class App {
  readonly language = signal<DemoLanguage>('en');
  readonly editorI18n = computed(() => DEMO_I18N[this.language()]);

  isDark = signal(false);
  mode = signal<DemoMode>('default');
  // The editor-demo takes a boolean `useLayout` input; derive it from mode
  // so the existing component stays unchanged.
  useLayout = computed(() => this.mode() === 'custom');
  isNotion = computed(() => this.mode() === 'notion' || this.mode() === 'notion-scrollable');
  isScrollable = computed(() => this.mode() === 'notion-scrollable');

  setLanguage(value: string): void {
    if (value === 'en' || value === 'de') this.language.set(value);
  }

  toggleTheme(): void {
    this.isDark.update(v => !v);
    document.body.classList.toggle('dm-theme-dark');
  }
}
