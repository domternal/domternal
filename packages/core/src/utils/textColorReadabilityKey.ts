import { PluginKey } from '@domternal/pm/state';

/** The presentation option is editor state, never document state. */
export const textColorReadabilityKey = new PluginKey<boolean>('textColorReadability');
