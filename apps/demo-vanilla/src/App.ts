import { EditorDemo } from './EditorDemo.js';
import { NotionDemo } from './NotionDemo.js';
import { MultiEditorDemo } from './MultiEditorDemo.js';

type Mode = 'default' | 'custom' | 'notion' | 'notion-scrollable' | 'multi';

/** Modes that share a single persistent EditorDemo (toolbar layout swap only). */
function isPlainMode(mode: Mode): boolean {
  return mode === 'default' || mode === 'custom';
}

/**
 * Top-level demo router. Manages mode state (default / custom / notion),
 * theme toggle, and delegates rendering to the appropriate demo class.
 * Destroys + recreates the active demo on mode switch.
 */
export class App {
  #host: HTMLElement;
  #mode: Mode = 'default';
  #isDark = false;

  #editorDemo: EditorDemo | null = null;
  #notionDemo: NotionDemo | null = null;
  #multiDemo: MultiEditorDemo | null = null;

  #modeButtons = new Map<Mode, HTMLButtonElement>();
  #themeToggleBtn: HTMLButtonElement | null = null;
  #demoMount: HTMLElement;

  constructor(host: HTMLElement) {
    this.#host = host;
    // `#renderShell` returns the mount point so we don't need to query for
    // it via `querySelector` (which would force a non-null assertion).
    this.#demoMount = this.#renderShell();
    this.#mountCurrentMode();
  }

  #renderShell(): HTMLElement {
    // .demo wrapper
    const demo = document.createElement('div');
    demo.className = 'demo';

    // <h1>Title + theme toggle</h1>
    const h1 = document.createElement('h1');
    h1.textContent = 'Domternal Vanilla Demo';
    const themeBtn = document.createElement('button');
    themeBtn.className = 'theme-toggle';
    themeBtn.textContent = '🌙';
    themeBtn.title = 'Switch to dark';
    themeBtn.addEventListener('click', () => { this.#toggleTheme(); });
    h1.appendChild(themeBtn);
    this.#themeToggleBtn = themeBtn;
    demo.appendChild(h1);

    // Mode toggle
    const modeToggle = document.createElement('div');
    modeToggle.className = 'toolbar-mode-toggle';

    const modes: { id: Mode; label: string }[] = [
      { id: 'default', label: 'Default toolbar' },
      { id: 'custom', label: 'Custom layout' },
      { id: 'notion', label: 'Notion style' },
      { id: 'notion-scrollable', label: 'Notion scrollable' },
      { id: 'multi', label: 'Multiple editors' },
    ];

    for (const m of modes) {
      const btn = document.createElement('button');
      btn.textContent = m.label;
      btn.dataset.testid = `mode-${m.id}`;
      if (this.#mode === m.id) btn.classList.add('active');
      btn.addEventListener('click', () => { this.#setMode(m.id); });
      modeToggle.appendChild(btn);
      this.#modeButtons.set(m.id, btn);
    }
    demo.appendChild(modeToggle);

    // Demo mount point - replaced on mode switch
    const mount = document.createElement('div');
    mount.className = 'app-demo-mount';
    demo.appendChild(mount);

    this.#host.appendChild(demo);
    return mount;
  }

  #setMode(mode: Mode): void {
    if (mode === this.#mode) return;
    const prev = this.#mode;
    this.#mode = mode;

    // Preserve editor state on default ↔ custom toggle: only swap the
    // toolbar's layout, do NOT destroy + recreate the editor. Matches
    // the React demo's conditional render behaviour (same component
    // instance, prop change). Every other transition (notion, multi)
    // tears down the active demo and mounts the new one.
    if (isPlainMode(prev) && isPlainMode(mode) && this.#editorDemo) {
      this.#editorDemo.setUseLayout(mode === 'custom');
    } else {
      this.#destroyCurrentDemo();
      this.#mountCurrentMode();
    }

    for (const [id, btn] of this.#modeButtons) {
      btn.classList.toggle('active', id === mode);
    }
  }

  #mountCurrentMode(): void {
    this.#demoMount.replaceChildren();

    if (this.#mode === 'notion' || this.#mode === 'notion-scrollable') {
      this.#notionDemo = new NotionDemo(this.#demoMount, {
        scrollable: this.#mode === 'notion-scrollable',
      });
      return;
    }

    if (this.#mode === 'multi') {
      const multiWrapper = document.createElement('div');
      multiWrapper.className = 'app-multi-editor-demo-mount';
      this.#demoMount.appendChild(multiWrapper);
      this.#multiDemo = new MultiEditorDemo(multiWrapper);
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'app-editor-demo';
    this.#demoMount.appendChild(wrapper);
    this.#editorDemo = new EditorDemo(wrapper, {
      useLayout: this.#mode === 'custom',
    });
  }

  #destroyCurrentDemo(): void {
    this.#editorDemo?.destroy();
    this.#editorDemo = null;
    this.#notionDemo?.destroy();
    this.#notionDemo = null;
    this.#multiDemo?.destroy();
    this.#multiDemo = null;
  }

  #toggleTheme(): void {
    this.#isDark = !this.#isDark;
    document.body.classList.toggle('dm-theme-dark');
    if (this.#themeToggleBtn) {
      this.#themeToggleBtn.textContent = this.#isDark ? '☀️' : '🌙';
      this.#themeToggleBtn.title = this.#isDark
        ? 'Switch to light'
        : 'Switch to dark';
    }
  }
}
