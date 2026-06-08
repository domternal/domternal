import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomternalEditorComponent } from '@domternal/angular';
import {
  Bold,
  Italic,
  Underline,
  Strike,
  Heading,
  BulletList,
  OrderedList,
  SelectionDecoration,
  type AnyExtension,
  type Content,
} from '@domternal/core';

/**
 * Angular-specific demo for [(ngModel)] two-way binding on
 * DomternalEditorComponent (which implements ControlValueAccessor).
 *
 * Mirrors the Vue VModelDemo so the two wrappers cover the same
 * two-way binding behaviour (parent to editor and editor to parent).
 * Uses default change detection: the editor emits its onChange inside
 * ngZone.run(), so the bound `content` and the derived <pre>/<textarea>
 * stay in sync without manual markForCheck.
 */
@Component({
  selector: 'app-ngmodel-demo',
  imports: [FormsModule, DomternalEditorComponent],
  templateUrl: './ngmodel-demo.component.html',
})
export class NgModelDemoComponent {
  extensions: AnyExtension[] = [
    Bold,
    Italic,
    Underline,
    Strike,
    Heading,
    BulletList,
    OrderedList,
    SelectionDecoration,
  ];

  content = '<p>Edit me - changes sync via ngModel</p>';
  updateCount = 0;

  onModelChange(value: Content): void {
    this.content = value as string;
    this.updateCount++;
  }

  setContent(html: string): void {
    this.content = html;
  }

  clearContent(): void {
    this.content = '<p></p>';
  }
}
