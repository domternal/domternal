import type { I18nService } from '../i18n/index.js';
import { coreMessages } from '../messages/core.js';
import { localizeMessage } from './localizeMessage.js';

/** A custom literal has no inferred language unless its owner supplies one. */
export interface PickerLabel {
  text: string;
  language?: string;
}

/** Presentation fields never replace the stable emoji name or shortcodes. */
export interface EmojiPresentationItem {
  name: string;
  label?: string;
  labelLanguage?: string;
  searchAliases?: readonly string[];
}

export function resolveColorName(i18n: I18nService | undefined, token: string): PickerLabel {
  switch (token) {
    case 'gray':
      return localizeMessage(i18n, coreMessages.colorGray);
    case 'brown':
      return localizeMessage(i18n, coreMessages.colorBrown);
    case 'orange':
      return localizeMessage(i18n, coreMessages.colorOrange);
    case 'yellow':
      return localizeMessage(i18n, coreMessages.colorYellow);
    case 'green':
      return localizeMessage(i18n, coreMessages.colorGreen);
    case 'blue':
      return localizeMessage(i18n, coreMessages.colorBlue);
    case 'purple':
      return localizeMessage(i18n, coreMessages.colorPurple);
    case 'pink':
      return localizeMessage(i18n, coreMessages.colorPink);
    case 'red':
      return localizeMessage(i18n, coreMessages.colorRed);
    default:
      return { text: token.charAt(0).toUpperCase() + token.slice(1) };
  }
}

export function resolveColorSwatch(
  i18n: I18nService | undefined,
  token: string | null,
  variant: 'text' | 'bg'
): PickerLabel {
  if (token === null) {
    return variant === 'text'
      ? localizeMessage(i18n, coreMessages.colorDefaultText)
      : localizeMessage(i18n, coreMessages.colorDefaultBackground);
  }
  const color = resolveColorName(i18n, token).text;
  return variant === 'text'
    ? localizeMessage(i18n, coreMessages.colorTextSwatch, { color })
    : localizeMessage(i18n, coreMessages.colorBackgroundSwatch, { color });
}

export function resolveEmojiCategory(i18n: I18nService | undefined, category: string): PickerLabel {
  switch (category) {
    case 'Smileys & Emotion':
      return localizeMessage(i18n, coreMessages.emojiCategorySmileysEmotion);
    case 'People & Body':
      return localizeMessage(i18n, coreMessages.emojiCategoryPeopleBody);
    case 'Animals & Nature':
      return localizeMessage(i18n, coreMessages.emojiCategoryAnimalsNature);
    case 'Food & Drink':
      return localizeMessage(i18n, coreMessages.emojiCategoryFoodDrink);
    case 'Travel & Places':
      return localizeMessage(i18n, coreMessages.emojiCategoryTravelPlaces);
    case 'Activities':
      return localizeMessage(i18n, coreMessages.emojiCategoryActivities);
    case 'Objects':
      return localizeMessage(i18n, coreMessages.emojiCategoryObjects);
    case 'Symbols':
      return localizeMessage(i18n, coreMessages.emojiCategorySymbols);
    case 'Flags':
      return localizeMessage(i18n, coreMessages.emojiCategoryFlags);
    default:
      return { text: category };
  }
}

export function resolveEmojiLabel(
  i18n: I18nService | undefined,
  item: EmojiPresentationItem
): PickerLabel {
  if (item.label !== undefined) {
    return {
      text: item.label,
      ...(item.labelLanguage === undefined ? {} : { language: item.labelLanguage }),
    };
  }
  return localizeMessage(i18n, coreMessages.emojiItemName, { name: item.name });
}

/** Match presentation words without mutating the dataset or replacing technical lookup. */
export function matchesEmojiPresentation(
  i18n: I18nService | undefined,
  item: EmojiPresentationItem,
  query: string
): boolean {
  const normalized = query.toLocaleLowerCase(i18n?.getSnapshot().locale);
  return [resolveEmojiLabel(i18n, item).text, ...(item.searchAliases ?? [])].some((word) =>
    word.toLocaleLowerCase(i18n?.getSnapshot().locale).includes(normalized)
  );
}
