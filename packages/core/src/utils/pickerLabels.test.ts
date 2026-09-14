import { describe, expect, it } from 'vitest';
import { I18nService } from '../i18n/index.js';
import {
  matchesEmojiPresentation,
  resolveColorName,
  resolveColorSwatch,
  resolveEmojiCategory,
  resolveEmojiLabel,
} from './pickerLabels.js';

describe('shared picker presentation', () => {
  it('resolves named tokens and complete swatch wording without altering custom tokens', () => {
    const i18n = new I18nService({
      locale: 'hr',
      messages: {
        'core.colorPicker.blue': 'Plava',
        'core.colorPicker.textSwatch': ({ color }) => `Boja teksta: ${color}`,
      },
    });
    expect(resolveColorName(i18n, 'blue')).toMatchObject({ text: 'Plava', language: 'hr' });
    expect(resolveColorSwatch(i18n, 'blue', 'text')).toMatchObject({
      text: 'Boja teksta: Plava',
      language: 'hr',
    });
    expect(resolveColorSwatch(i18n, null, 'text')).toMatchObject({
      text: 'Default text color',
      language: 'en',
    });
    expect(resolveColorName(i18n, 'brand')).toEqual({ text: 'Brand' });
    expect(resolveColorName(undefined, 'blue')).toMatchObject({ text: 'Blue', language: 'en' });
  });

  it('translates known categories and emoji display names while preserving explicit labels', () => {
    const i18n = new I18nService({
      locale: 'hr',
      messages: {
        'core.emojiPicker.category.objects': 'Predmeti',
        'core.emojiPicker.itemName': ({ name }) =>
          name === 'light_bulb' ? '<b>Žarulja</b>' : name,
      },
    });
    const item = { name: 'light_bulb', searchAliases: ['svjetlo'] };
    expect(resolveEmojiCategory(i18n, 'Objects')).toMatchObject({
      text: 'Predmeti',
      language: 'hr',
    });
    expect(resolveEmojiCategory(i18n, 'My custom group')).toEqual({ text: 'My custom group' });
    expect(resolveEmojiLabel(i18n, item)).toMatchObject({ text: '<b>Žarulja</b>', language: 'hr' });
    expect(matchesEmojiPresentation(i18n, item, 'ŽARULJA')).toBe(true);
    expect(matchesEmojiPresentation(i18n, item, 'svjetlo')).toBe(true);
    expect(resolveEmojiLabel(i18n, { ...item, label: 'light bulb' })).toEqual({
      text: 'light bulb',
    });
    expect(resolveEmojiLabel(i18n, { ...item, label: 'Custom', labelLanguage: 'fr' })).toEqual({
      text: 'Custom',
      language: 'fr',
    });
    expect(item.name).toBe('light_bulb');
  });
});
