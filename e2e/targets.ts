/**
 * The four demo apps as matrix targets. Cross-framework behavior specs in
 * this directory loop over these so each behavior is written once and runs
 * against every framework (same pattern as the domternal-pro e2e suite).
 */
export interface DemoTarget {
  name: 'vanilla' | 'react' | 'vue' | 'angular';
  baseURL: string;
  /** The Notion demo's editor root; Angular uses a component tag, not a class. */
  editorSelector: string;
  /** Selector that switches the demo app into Notion mode. */
  notionToggle: string;
}

export const demoTargets: DemoTarget[] = [
  {
    name: 'vanilla',
    baseURL: 'http://localhost:5199',
    editorSelector: '.app-notion-demo .ProseMirror',
    notionToggle: '.toolbar-mode-toggle button:has-text("Notion style")',
  },
  {
    name: 'react',
    baseURL: 'http://localhost:5299',
    editorSelector: '.app-notion-demo .ProseMirror',
    notionToggle: '.toolbar-mode-toggle button:has-text("Notion style")',
  },
  {
    name: 'vue',
    baseURL: 'http://localhost:5499',
    editorSelector: '.app-notion-demo .ProseMirror',
    notionToggle: '[data-testid="mode-notion"]',
  },
  {
    name: 'angular',
    baseURL: 'http://localhost:5399',
    editorSelector: 'app-notion-demo .ProseMirror',
    notionToggle: '.toolbar-mode-toggle button:has-text("Notion style")',
  },
];
