import { Domternal } from '@domternal/react';
import { StarterKit, BubbleMenu } from '@domternal/core';

const extensions = [StarterKit, BubbleMenu];

export default function Editor() {
  return (
    <Domternal
      extensions={extensions}
      content="<p>Hello!</p>"
    >
      <Domternal.Toolbar />
      <Domternal.Content />
      <Domternal.BubbleMenu />
    </Domternal>
  );
}