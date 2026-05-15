/**
 * NotionColorPicker Extension
 *
 * Provides storage + toolbar registration for a Notion-style inline color
 * picker that drives the `colorToken` / `backgroundColorToken` attributes on
 * the textStyle mark (added by TextColor and Highlight).
 *
 * This extension owns:
 * - The shared named-token palette (default: 9 Notion-style colors).
 * - Recently-used tracking, optionally persisted to localStorage and synced
 *   across same-origin tabs via the browser `storage` event.
 * - A bubble-menu-only toolbar item (`notionColor`) that emits a custom
 *   `notionColorOpen` event when clicked. Framework wrappers listen for the
 *   event and render the actual picker panel.
 *
 * @example
 * ```ts
 * import { TextStyle, TextColor, Highlight, NotionColorPicker } from '@domternal/core';
 *
 * const editor = new Editor({
 *   extensions: [
 *     // ...
 *     TextStyle,
 *     TextColor,
 *     Highlight,
 *     NotionColorPicker,
 *   ],
 * });
 *
 * editor.commands.pushRecentColor({ kind: 'text', token: 'gray' });
 * console.log(editor.storage.notionColorPicker.recent);
 * ```
 */
import { Extension } from '../Extension.js';
import type { CommandSpec } from '../types/Commands.js';
import type { ToolbarItem } from '../types/Toolbar.js';

declare module '../types/Commands.js' {
  interface RawCommands {
    pushRecentColor: CommandSpec<[entry: RecentEntry]>;
    clearRecentColors: CommandSpec;
  }
}

/**
 * Default named tokens. Match the BlockColor palette + theme tokens
 * (`--dm-block-text-<token>`, `--dm-block-bg-<token>`) so light and dark
 * themes render the right hex without any extra CSS work.
 */
export const DEFAULT_NOTION_COLOR_PALETTE: readonly string[] = Object.freeze([
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
]);

export interface RecentEntry {
  /** Whether the entry sets text color or background color. */
  kind: 'text' | 'bg';
  /** Named token from the palette, or `null` for "default" (clears the attr). */
  token: string | null;
}

export interface NotionColorPickerOptions {
  /**
   * Named tokens shown in the picker. Each token must have matching
   * `--dm-block-text-<token>` and `--dm-block-bg-<token>` CSS variables in
   * the active theme; tokens with no theme support render as transparent
   * swatches.
   * @default DEFAULT_NOTION_COLOR_PALETTE
   */
  palette: readonly string[];

  /**
   * Maximum number of entries kept in the recently-used list.
   * @default 5
   */
  recentLimit: number;

  /**
   * localStorage key for persisting recently-used colors across reloads and
   * tabs. Set to `null` to disable persistence (recent stays in-memory only).
   * @default 'dm-notion-color-recent'
   */
  storageKey: string | null;
}

export interface NotionColorPickerStorage {
  /** Most-recently-used color entries, newest first. */
  recent: RecentEntry[];
  /** Whether the picker panel is currently open. UI sets this. */
  isOpen: boolean;
}

function isValidEntry(value: unknown): value is RecentEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v['kind'] !== 'text' && v['kind'] !== 'bg') return false;
  if (v['token'] !== null && typeof v['token'] !== 'string') return false;
  return true;
}

function loadRecent(storageKey: string | null): RecentEntry[] {
  if (!storageKey || typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry);
  } catch {
    return [];
  }
}

function persistRecent(storageKey: string | null, recent: RecentEntry[]): void {
  if (!storageKey || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(recent));
  } catch {
    // Quota exceeded, private mode, etc. — recent stays in-memory only.
  }
}

export const NotionColorPicker = Extension.create<
  NotionColorPickerOptions,
  NotionColorPickerStorage
>({
  name: 'notionColorPicker',

  // The picker writes textStyle.colorToken / textStyle.backgroundColorToken,
  // so TextStyle must be present. TextColor and Highlight are recommended
  // (they own those attribute schemas) but not strictly required: a host app
  // could supply its own attribute providers if it really wants to.
  dependencies: ['textStyle'],

  addOptions() {
    return {
      palette: DEFAULT_NOTION_COLOR_PALETTE,
      recentLimit: 5,
      storageKey: 'dm-notion-color-recent',
    };
  },

  addStorage() {
    return {
      recent: loadRecent(this.options.storageKey),
      isOpen: false,
    };
  },

  onCreate() {
    if (typeof window === 'undefined') return;
    const storageKey = this.options.storageKey;
    if (!storageKey) return;

    // Cross-tab sync. The `storage` event only fires in OTHER same-origin
    // tabs, so writes by THIS editor instance don't echo back. Same-tab
    // multi-editor staleness is the framework wrapper's concern: it should
    // re-read on picker open (cheap JSON parse).
    const onStorage = (e: StorageEvent): void => {
      if (e.key !== storageKey) return;
      if (e.newValue === null) {
        this.storage.recent = [];
        return;
      }
      try {
        const parsed: unknown = JSON.parse(e.newValue);
        if (Array.isArray(parsed)) {
          this.storage.recent = parsed.filter(isValidEntry);
        }
      } catch {
        // Ignore malformed payload from another tab.
      }
    };
    window.addEventListener('storage', onStorage);

    const internal = this.storage as NotionColorPickerStorage & {
      __cleanup__?: () => void;
    };
    internal.__cleanup__ = (): void => {
      window.removeEventListener('storage', onStorage);
    };
  },

  onDestroy() {
    const internal = this.storage as NotionColorPickerStorage & {
      __cleanup__?: () => void;
    };
    internal.__cleanup__?.();
    delete internal.__cleanup__;
  },

  addCommands() {
    return {
      // Pushes an entry to the MRU recents list. Deduplicates by (kind,token)
      // and trims to recentLimit. Returns true unconditionally because the
      // command always succeeds at the storage level, even when nothing
      // semantically changed (e.g. picking the same color twice).
      pushRecentColor:
        (entry: RecentEntry) =>
        () => {
          if (!isValidEntry(entry)) {
            return false;
          }
          const { recentLimit, storageKey } = this.options;
          const current = this.storage.recent;
          const filtered = current.filter(
            (r) => !(r.kind === entry.kind && r.token === entry.token),
          );
          const next = [entry, ...filtered].slice(0, recentLimit);
          this.storage.recent = next;
          persistRecent(storageKey, next);
          return true;
        },

      clearRecentColors:
        () =>
        () => {
          this.storage.recent = [];
          persistRecent(this.options.storageKey, []);
          return true;
        },
    };
  },

  addToolbarItems(): ToolbarItem[] {
    return [
      {
        type: 'button',
        name: 'notionColor',
        // emitEvent takes priority over `command` at click time. The
        // `command` field is required by the ToolbarButton schema, so we
        // point it at a sensible no-op that fires only if a host disables
        // the popover UI: clearing recents keeps the data layer consistent.
        command: 'clearRecentColors',
        // The "A with an underline" glyph is the closest match in our icon
        // set; the framework wrapper can repaint the underline to reflect
        // the current selection's color (see Phase 4 / Angular wrapper).
        icon: 'textAUnderline',
        label: 'Text and background color',
        emitEvent: 'notionColorOpen',
        group: 'textStyle',
        priority: 250,
        // Bubble-menu-only: the legacy hex pickers (TextColor / Highlight)
        // stay in the main toolbar; this token-based picker is a Notion-mode
        // affordance surfaced beside the text-format buttons in the bubble.
        toolbar: false,
      },
    ];
  },
});
