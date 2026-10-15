import { expect, it } from 'vitest';
import type { CompleteMessages } from '@domternal/core';
import { deMessages } from './locales/de.js';
import { imageMessages } from './messages.js';

it('accepts an existing complete image catalog without the additive loading message', () => {
  const { 'image.upload.loading': loading, ...previous } = deMessages;
  const compatible: CompleteMessages<typeof imageMessages> = previous;
  expect(loading).toBeDefined();
  expect(compatible['image.upload.loading']).toBeUndefined();
  expect(imageMessages.loading.defaultValue).toBe('Loading image...');
  expect(imageMessages.loading.optionalTranslation).toBe(true);
});
