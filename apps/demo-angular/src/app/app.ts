import { Component, inject, NgZone, signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import {
  DomternalEditorComponent,
  DomternalToolbarComponent,
  DomternalBubbleMenuComponent,
} from '@domternal/angular';
import {
  Bold,
  Italic,
  Underline,
  Strike,
  Code,
  Highlight,
  Subscript,
  Superscript,
  Link,
  Heading,
  Blockquote,
  HardBreak,
  HorizontalRule,
  BulletList,
  OrderedList,
  TaskList,
  TaskItem,
  ListItem,
  TextAlign,
  TextStyle,
  TextColor,
  FontSize,
  FontFamily,
  LineHeight,
  InvisibleChars,
  SelectionDecoration,
  Editor,
  defaultIcons,
} from '@domternal/core';
import { CodeBlockLowlight } from '@domternal/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';

const lowlight = createLowlight(common);

@Component({
  selector: 'app-root',
  imports: [DomternalEditorComponent, DomternalToolbarComponent, DomternalBubbleMenuComponent],
  templateUrl: './app.html',
})
export class App {
  private sanitizer = inject(DomSanitizer);
  private ngZone = inject(NgZone);

  // History is already in DEFAULT_EXTENSIONS (from DomternalEditorComponent)
  extensions = [
    Italic,
    Bold,
    Underline,
    Strike,
    Code,
    Highlight,
    Subscript,
    Superscript,
    Link,
    Heading,
    Blockquote,
    CodeBlockLowlight.configure({ lowlight }),
    HardBreak,
    HorizontalRule,
    BulletList,
    OrderedList,
    TaskList,
    TaskItem,
    ListItem,
    TextAlign,
    TextStyle,
    TextColor.configure({ colors: ['#ff0000', '#00ff00', '#0000ff', '#ff9900'] }),
    FontSize,
    FontFamily,
    LineHeight.configure({ lineHeights: ['1', '1.15', '1.5', '2'] }),
    InvisibleChars,
    SelectionDecoration,
  ];
  editor: Editor | null = null;
  isDark = signal(false);

  // Bumped on every editor transaction so bubble menu active state stays in sync with CD
  private stateVersion = signal(0);
  private transactionHandler = (): void => {
    this.ngZone.run(() => this.stateVersion.update(v => v + 1));
  };

  // Bubble menu icon cache
  private iconCache = new Map<string, SafeHtml>();

  onEditorCreated(editor: Editor): void {
    this.editor = editor;
    editor.on('transaction', this.transactionHandler);
  }

  toggleTheme(): void {
    this.isDark.update(v => !v);
    document.body.classList.toggle('dm-theme-dark');
  }

  icon(name: string): SafeHtml {
    let cached = this.iconCache.get(name);
    if (!cached) {
      cached = this.sanitizer.bypassSecurityTrustHtml(defaultIcons[name] ?? '');
      this.iconCache.set(name, cached);
    }
    return cached;
  }

  isMarkActive(mark: string): boolean {
    this.stateVersion(); // subscribe to transaction changes
    return this.editor?.isActive(mark) ?? false;
  }

  canCommand(command: string): boolean {
    this.stateVersion(); // subscribe to transaction changes
    try {
      const can = this.editor?.can() as Record<string, (...args: unknown[]) => boolean> | undefined;
      return can?.[command]?.() ?? true;
    } catch {
      return true;
    }
  }
}
