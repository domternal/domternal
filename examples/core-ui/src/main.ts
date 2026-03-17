import { Editor, StarterKit, defaultIcons } from '@domternal/core';
import '@domternal/theme';

const editorEl = document.getElementById('editor')!;

// Toolbar
const toolbar = document.createElement('div');
toolbar.className = 'dm-toolbar';
toolbar.innerHTML = `<div class="dm-toolbar-group">
  <button class="dm-toolbar-button" data-mark="bold">${defaultIcons.textB}</button>
  <button class="dm-toolbar-button" data-mark="italic">${defaultIcons.textItalic}</button>
  <button class="dm-toolbar-button" data-mark="underline">${defaultIcons.textUnderline}</button>
</div>`;
editorEl.before(toolbar);

// Editor
const editor = new Editor({
  element: editorEl,
  extensions: [StarterKit],
  content: '<p>Hello world</p>',
});

// Toggle marks on click (event delegation)
toolbar.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest<HTMLButtonElement>('[data-mark]');
  if (!btn) return;
  editor.chain().focus().toggleMark(btn.dataset.mark!).run();
});

// Active state sync
editor.on('transaction', () => {
  toolbar.querySelectorAll<HTMLButtonElement>('[data-mark]').forEach((btn) => {
    btn.classList.toggle('dm-toolbar-button--active', editor.isActive(btn.dataset.mark!));
  });
});
