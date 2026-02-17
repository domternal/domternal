import { Component, ViewChild } from '@angular/core';
import { DomternalEditorComponent } from '@domternal/angular';
import { Bold } from '@domternal/core';

@Component({
  selector: 'app-root',
  imports: [DomternalEditorComponent],
  templateUrl: './app.html',
})
export class App {
  @ViewChild(DomternalEditorComponent) ec!: DomternalEditorComponent;

  extensions = [Bold];

  toggleBold(): void {
    this.ec.editor?.commands.toggleBold();
  }

  isBoldActive(): boolean {
    return this.ec.editor?.isActive('bold') ?? false;
  }
}
