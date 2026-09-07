import type { EditorView } from '@domternal/pm/view';
import type { PluginView } from '@domternal/pm/state';
import type { Editor } from '../Editor.js';

/**
 * Rebinds a DOM-dependent plugin view when the editor changes its mount host.
 * Only this view's UI resources are recreated; plugin state and editor history
 * stay intact. Initial setup still runs immediately, including detached views.
 */
export function createAdoptablePluginView(
  editor: Editor | null,
  view: EditorView,
  createView: (view: EditorView) => PluginView,
): PluginView {
  let currentView = view;
  let binding: PluginView | undefined = createView(currentView);
  let destroyed = false;

  const rebind = (): void => {
    const previous = binding;
    binding = undefined;
    previous?.destroy?.();
    if (!destroyed) {
      binding = createView(currentView);
    }
  };
  editor?.on('adopt', rebind);

  return {
    update(nextView, previousState) {
      currentView = nextView;
      binding?.update?.(nextView, previousState);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      editor?.off('adopt', rebind);
      const previous = binding;
      binding = undefined;
      previous?.destroy?.();
    },
  };
}
