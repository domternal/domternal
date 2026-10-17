import { Plugin } from '@domternal/pm/state';
import { Extension } from '../Extension.js';
import type { Editor } from '../Editor.js';
import { listLabelAttribute } from '../utils/listLabelAttribute.js';
import { createListLabelStyleOwner } from '../utils/listLabelRuntime.js';
import { pastedAttributesPlugin } from '../utils/pastedAttributes.js';
import { compoundListLabelsPlugin } from '../utils/compoundListLabelsPlugin.js';

export interface ListLabelsOptions {
  /** Install scoped companion CSS for live editors. Disable when the host supplies it. */
  injectCSS: boolean;
  /** Optional CSP nonce for the owned style element. */
  nonce?: string;
}

/** Optional text and counter labels. Existing schemas stay unchanged until this extension is included. */
export const ListLabels = Extension.create<ListLabelsOptions>({
  name: 'listLabels',
  addOptions() { return { injectCSS: true }; },
  addGlobalAttributes() {
    return [
      { types: ['orderedList'], attributes: { listLabel: listLabelAttribute('orderedList') } },
      { types: ['bulletList'], attributes: { listLabel: listLabelAttribute('bulletList') } },
    ];
  },
  addProseMirrorPlugins() {
    const plugins = [pastedAttributesPlugin('unsupported-list-label'), compoundListLabelsPlugin()];
    if (!this.options.injectCSS) return plugins;
    const editor = this.editor as Editor | null;
    const nonce = this.options.nonce;
    plugins.push(new Plugin({
      view(view) {
        const owner = createListLabelStyleOwner(view, nonce);
        const sync = (): void => { owner.update(); };
        owner.update(); editor?.on('adopt', sync);
        return { update: sync, destroy() { editor?.off('adopt', sync); owner.destroy(); } };
      },
    }));
    return plugins;
  },
});
