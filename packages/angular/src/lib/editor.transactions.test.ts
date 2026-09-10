import '@angular/compiler';
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Extension, type Content, type Editor } from '@domternal/core';
import { Plugin, TextSelection } from '@domternal/pm/state';
import { DomternalEditorComponent } from './editor.component.js';

try { TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting()); } catch { /* shared environment */ }

/** Appends a document change to a root marked appendDoc, and vetoes a root marked veto. */
const AppendProbe = Extension.create({
  name: 'wrapperAppendProbe',
  addProseMirrorPlugins: () => [new Plugin({
    filterTransaction: transaction => transaction.getMeta('veto') !== true,
    appendTransaction(transactions, _previous, state) {
      if (!transactions.some(transaction => transaction.getMeta('appendDoc') === true)) return null;
      return state.tr.insertText('!', state.doc.content.size - 1);
    },
  })],
});

class TransactionHost {
  readonly extensions = [AppendProbe];
  readonly control = new FormControl<Content>('<p>Hello</p>', { nonNullable: true });
  readonly calls: string[] = [];
  readonly created: Editor[] = [];

  get editor(): Editor {
    const editor = this.created.at(-1);
    if (!editor) throw new Error('Expected a live editor.');
    return editor;
  }
}
Component({
  selector: 'transaction-host',
  imports: [ReactiveFormsModule, DomternalEditorComponent],
  template: `<domternal-editor [extensions]="extensions" [formControl]="control" (editorCreated)="created.push($event)"
    (contentUpdated)="calls.push('update:' + $event.editor.getText())" (selectionChanged)="calls.push('selection')" />`,
})(TransactionHost);

function moveSelection(editor: Editor, meta: Record<string, unknown> = {}): void {
  const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2));
  for (const [key, value] of Object.entries(meta)) tr.setMeta(key, value);
  editor.view.dispatch(tr);
}

beforeEach(() => {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
});

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('DomternalEditorComponent transaction callbacks', () => {
  it('reports a selection move that a plugin answers with a change to selectionChanged, then contentUpdated, the form and the signals', async () => {
    const fixture = TestBed.createComponent(TransactionHost);
    await fixture.whenStable();
    const host = fixture.componentInstance;
    const component = fixture.debugElement.query(By.directive(DomternalEditorComponent)).componentInstance as DomternalEditorComponent;

    moveSelection(host.editor, { appendDoc: true });
    await fixture.whenStable();

    // The root moved the selection and a plugin answered with a change: the move, then the change.
    expect(host.calls).toEqual(['selection', 'update:Hello!']);
    expect(host.control.value).toBe('<p>Hello!</p>');
    expect(host.control.dirty).toBe(true);
    expect(component.htmlContent()).toBe('<p>Hello!</p>');
    expect(component.jsonContent()?.content?.[0]?.content?.[0]?.text).toBe('Hello!');

    moveSelection(host.editor);
    expect(host.calls).toEqual(['selection', 'update:Hello!', 'selection']);
  });

  it('reports nothing for a vetoed transaction and keeps the form pristine', async () => {
    const fixture = TestBed.createComponent(TransactionHost);
    await fixture.whenStable();
    const host = fixture.componentInstance;
    const editor = host.editor;

    editor.view.dispatch(editor.state.tr.insertText('X', 1).setMeta('veto', true));
    moveSelection(editor, { veto: true });
    await fixture.whenStable();

    expect(editor.getText()).toBe('Hello');
    expect(host.calls).toEqual([]);
    expect(host.control.dirty).toBe(false);
  });

  it('refreshes the signals and emits only the selection move for a skipUpdate root with an appended change', async () => {
    const fixture = TestBed.createComponent(TransactionHost);
    await fixture.whenStable();
    const host = fixture.componentInstance;
    const component = fixture.debugElement.query(By.directive(DomternalEditorComponent)).componentInstance as DomternalEditorComponent;

    moveSelection(host.editor, { appendDoc: true, skipUpdate: true });
    await fixture.whenStable();

    expect(component.htmlContent()).toBe('<p>Hello!</p>');
    expect(component.isEmpty()).toBe(false);
    expect(host.calls).toEqual(['selection']);
    expect(host.control.value).toBe('<p>Hello</p>');
    expect(host.control.dirty).toBe(false);
  });
});

class JsonFormHost {
  readonly control = new FormControl<Content>({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] }, { nonNullable: true });
  readonly created: Editor[] = [];
}
Component({
  selector: 'json-form-host',
  imports: [ReactiveFormsModule, DomternalEditorComponent],
  template: `<domternal-editor outputFormat="json" [formControl]="control" (editorCreated)="created.push($event)" />`,
})(JsonFormHost);

describe('DomternalEditorComponent JSON form value', () => {
  it('gives the form its own copy of the document JSON, so changing it leaves the jsonContent signal alone', async () => {
    const fixture = TestBed.createComponent(JsonFormHost);
    await fixture.whenStable();
    const host = fixture.componentInstance;
    const component = fixture.debugElement.query(By.directive(DomternalEditorComponent)).componentInstance as DomternalEditorComponent;
    const editor = host.created.at(-1);
    if (!editor) throw new Error('Expected a live editor.');

    editor.commands.insertContent('!');
    await fixture.whenStable();

    const value = host.control.value as { content?: { content?: { text?: string }[] }[] };
    expect(value).toEqual(component.jsonContent());
    expect(value).not.toBe(component.jsonContent());
    // An application that edits the form value in place changes only its own copy.
    const text = value.content?.[0]?.content?.[0];
    if (text) text.text = 'changed by the form';
    expect(component.jsonContent()).toEqual(editor.getJSON());
    expect(JSON.stringify(component.jsonContent())).not.toContain('changed by the form');
  });
});
