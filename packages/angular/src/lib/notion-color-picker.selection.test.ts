import '@angular/compiler';
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor, Document, Extension, Paragraph, Text, TextStyle, NotionColorPicker } from '@domternal/core';
import { Plugin, TextSelection } from '@domternal/pm/state';
import { DomternalNotionColorPickerComponent } from './notion-color-picker.component.js';

try { TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting()); } catch { /* shared environment */ }

/** Answers a selection move marked appendDoc with a document change, as some plugins do. */
const AppendProbe = Extension.create({
  name: 'pickerAppendProbe',
  addProseMirrorPlugins: () => [new Plugin({
    appendTransaction(transactions, _previous, state) {
      if (!transactions.some(transaction => transaction.getMeta('appendDoc') === true)) return null;
      return state.tr.insertText('!', state.doc.content.size - 1);
    },
  })],
});

let host: HTMLDivElement;
let anchor: HTMLButtonElement;
let editor: Editor;

class PickerHost {
  get editor(): Editor { return editor; }
}
Component({
  selector: 'picker-host',
  imports: [DomternalNotionColorPickerComponent],
  template: '<domternal-notion-color-picker [editor]="editor" />',
})(PickerHost);

const isOpen = (): boolean => (editor.storage['notionColorPicker'] as { isOpen: boolean }).isOpen;

beforeEach(async () => {
  vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
  host = document.createElement('div');
  host.className = 'dm-editor';
  anchor = document.createElement('button');
  const content = document.createElement('div');
  host.append(anchor, content);
  document.body.append(host);
  editor = new Editor({
    element: content,
    extensions: [Document, Paragraph, Text, TextStyle, NotionColorPicker, AppendProbe],
    content: '<p>Keep content</p>',
  });
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(PickerHost);
  await fixture.whenStable();
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 5)));
  editor.emit('notionColorOpen', { anchorElement: anchor });
  await fixture.whenStable();
});

afterEach(() => {
  TestBed.resetTestingModule();
  editor.destroy();
  host.remove();
  vi.restoreAllMocks();
});

describe('DomternalNotionColorPickerComponent selection tracking', () => {
  it('closes when the selection collapses, also when a plugin answers the move with a document change', () => {
    expect(isOpen()).toBe(true);

    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)).setMeta('appendDoc', true));

    expect(editor.getText()).toBe('Keep content!');
    expect(isOpen()).toBe(false);
  });

  it('stays open when the document changes without a selection move', () => {
    editor.view.dispatch(editor.state.tr.insertText('X', 8));

    expect(isOpen()).toBe(true);
  });
});
