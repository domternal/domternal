import { useState } from 'react';
import { EditorDemo } from './EditorDemo.js';
import { NotionDemo } from './NotionDemo.js';

type Mode = 'default' | 'custom' | 'notion';

export function App() {
  const [isDark, setIsDark] = useState(false);
  const [mode, setMode] = useState<Mode>('default');

  const toggleTheme = () => {
    setIsDark((v) => !v);
    document.body.classList.toggle('dm-theme-dark');
  };

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
      </div>

      {mode === 'notion' ? (
        <NotionDemo />
      ) : (
        <div className="app-editor-demo">
          <EditorDemo useLayout={mode === 'custom'} />
        </div>
      )}
    </div>
  );
}
