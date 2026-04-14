import { useState } from 'react';
import { EditorDemo } from './EditorDemo.js';

export function App() {
  const [isDark, setIsDark] = useState(false);
  const [useLayout, setUseLayout] = useState(false);

  const toggleTheme = () => {
    setIsDark((v) => !v);
    document.body.classList.toggle('dm-theme-dark');
  };

  return (
    <div className="demo">
      <h1>
        Domternal React Demo
        <button className="theme-toggle" onClick={toggleTheme} title={isDark ? 'Switch to light' : 'Switch to dark'}>
          {isDark ? '\u2600\uFE0F' : '\uD83C\uDF19'}
        </button>
      </h1>

      <div className="toolbar-mode-toggle">
        <button className={!useLayout ? 'active' : ''} onClick={() => setUseLayout(false)}>
          Default toolbar
        </button>
        <button className={useLayout ? 'active' : ''} onClick={() => setUseLayout(true)}>
          Custom layout
        </button>
      </div>

      <EditorDemo useLayout={useLayout} />
    </div>
  );
}
