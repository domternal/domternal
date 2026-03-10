import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { EditorDemoComponent } from './editor-demo/editor-demo.component.js';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EditorDemoComponent],
  templateUrl: './app.html',
})
export class App {
  isDark = signal(false);
  useLayout = signal(false);

  toggleTheme(): void {
    this.isDark.update(v => !v);
    document.body.classList.toggle('dm-theme-dark');
  }
}
