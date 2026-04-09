import { Domternal } from '@domternal/react';
import { StarterKit, BubbleMenu } from '@domternal/core';

export default function Editor() {
  return (
    <Domternal
      extensions={[StarterKit, BubbleMenu]}
      content="<p>Hello!</p>"
    >
      <Domternal.Toolbar />
      <Domternal.Content />
      <Domternal.BubbleMenu />
    </Domternal>
  );
}