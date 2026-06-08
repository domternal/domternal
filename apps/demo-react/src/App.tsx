import { useState } from 'react';
import { EditorDemo } from './EditorDemo.js';
import { NotionDemo } from './NotionDemo.js';
import { MultiEditorDemo } from './MultiEditorDemo.js';
import { TabIndentDemo } from './TabIndentDemo.js';
import { NodeViewDemo } from './NodeViewDemo.js';
import { CompoundDemo } from './CompoundDemo.js';

type Mode = 'default' | 'custom' | 'nodeview' | 'compound' | 'notion' | 'notion-scrollable' | 'multi' | 'tab';

export function App() {
  const [isDark, setIsDark] = useState(false);
  const [mode, setMode] = useState<Mode>('default');

  const toggleTheme = () => {
    setIsDark((v) => !v);
    document.body.classList.toggle('dm-theme-dark');
  };

  const isNotion = mode === 'notion' || mode === 'notion-scrollable';

  return (
    <div className="demo">
      <h1>
        Domternal React Demo
        <button className="theme-toggle" onClick={toggleTheme} title={isDark ? 'Switch to light' : 'Switch to dark'}>
          {isDark ? '☀️' : '🌙'}
        </button>
      </h1>

      <div className="toolbar-mode-toggle">
        <button data-testid="mode-default" className={mode === 'default' ? 'active' : ''} onClick={() => setMode('default')}>
          Default toolbar
        </button>
        <button data-testid="mode-custom" className={mode === 'custom' ? 'active' : ''} onClick={() => setMode('custom')}>
          Custom layout
        </button>
        <button data-testid="mode-nodeview" className={mode === 'nodeview' ? 'active' : ''} onClick={() => setMode('nodeview')}>
          NodeView
        </button>
        <button data-testid="mode-compound" className={mode === 'compound' ? 'active' : ''} onClick={() => setMode('compound')}>
          Compound
        </button>
        <button data-testid="mode-notion" className={mode === 'notion' ? 'active' : ''} onClick={() => setMode('notion')}>
          Notion style
        </button>
        <button data-testid="mode-notion-scrollable" className={mode === 'notion-scrollable' ? 'active' : ''} onClick={() => setMode('notion-scrollable')}>
          Notion scrollable
        </button>
        <button data-testid="mode-multi" className={mode === 'multi' ? 'active' : ''} onClick={() => setMode('multi')}>
          Multiple editors
        </button>
        <button data-testid="mode-tab" className={mode === 'tab' ? 'active' : ''} onClick={() => setMode('tab')}>
          Tab + lists
        </button>
      </div>

      {isNotion ? (
        // Keying on the mode forces a fresh mount when switching between
        // the two Notion variants - matches the vanilla demo which
        // destroys + recreates the NotionDemo on mode change.
        <NotionDemo key={mode} scrollable={mode === 'notion-scrollable'} />
      ) : mode === 'multi' ? (
        <MultiEditorDemo />
      ) : mode === 'tab' ? (
        <TabIndentDemo />
      ) : mode === 'nodeview' ? (
        <NodeViewDemo />
      ) : mode === 'compound' ? (
        <CompoundDemo />
      ) : (
        <div className="app-editor-demo">
          <EditorDemo useLayout={mode === 'custom'} />
        </div>
      )}
    </div>
  );
}
