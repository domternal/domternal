import { Domternal } from '@domternal/react';
import { StarterKit, BubbleMenu } from '@domternal/core';

export default function Editor() {
  return (
    <Domternal
      extensions={[StarterKit, BubbleMenu]}
      content="<p>Hello!</p>"
      immediatelyRender={false} // SSR-safe
    >
      <Domternal.Loading>Loading editor...</Domternal.Loading>
      <Domternal.Toolbar />
      <Domternal.Content className="editor-content" />
      <Domternal.BubbleMenu />
    </Domternal>
  );
}