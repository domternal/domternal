import { useState } from 'react';
import { EditorDemo } from './EditorDemo.js';
import { NotionDemo } from './NotionDemo.js';

type Mode = 'default' | 'custom' | 'notion' | 'notion-scrollable';

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
        <button className={mode === 'default' ? 'active' : ''} onClick={() => setMode('default')}>
          Default toolbar
        </button>
        <button className={mode === 'custom' ? 'active' : ''} onClick={() => setMode('custom')}>
          Custom layout
        </button>
        <button className={mode === 'notion' ? 'active' : ''} onClick={() => setMode('notion')}>
          Notion style
        </button>
        <button className={mode === 'notion-scrollable' ? 'active' : ''} onClick={() => setMode('notion-scrollable')}>
          Notion scrollable
        </button>
      </div>

      {isNotion ? (
        // Keying on the mode forces a fresh mount when switching between
        // the two Notion variants - matches the vanilla demo which
        // destroys + recreates the NotionDemo on mode change.
        <NotionDemo key={mode} scrollable={mode === 'notion-scrollable'} />
      ) : (
        <div className="app-editor-demo">
          <EditorDemo useLayout={mode === 'custom'} />
        </div>
      )}
    </div>
  );
}
