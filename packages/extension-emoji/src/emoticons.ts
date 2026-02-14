/**
 * Emoticon to emoji name mappings.
 * Used when `enableEmoticons: true` to convert text shortcuts to emoji.
 *
 * Each key is the emoticon text, value is the emoji `name` from the dataset.
 * The emoticon is matched at the end of input (after a space or at line start).
 */
export const emoticons: Record<string, string> = {
  // Smileys
  ':)': 'slightly_smiling_face',
  ':-)': 'slightly_smiling_face',
  '(:': 'slightly_smiling_face',
  ':D': 'grinning_face_with_big_eyes',
  ':-D': 'grinning_face_with_big_eyes',
  ';)': 'winking_face',
  ';-)': 'winking_face',
  ':(': 'slightly_frowning_face',
  ':-(': 'slightly_frowning_face',
  ":'(": 'crying_face',
  ':P': 'face_with_tongue',
  ':-P': 'face_with_tongue',
  ':p': 'face_with_tongue',
  ':O': 'face_with_open_mouth',
  ':-O': 'face_with_open_mouth',
  ':o': 'face_with_open_mouth',
  ':/': 'confused_face',
  ':-/': 'confused_face',
  ':\\': 'confused_face',
  'B)': 'smiling_face_with_sunglasses',
  '8)': 'smiling_face_with_sunglasses',
  ':*': 'kissing_face',
  ':-*': 'kissing_face',
  '>:(': 'angry_face',
  '>:-(': 'angry_face',
  'XD': 'face_with_tears_of_joy',
  'xD': 'face_with_tears_of_joy',
  ':$': 'flushed_face',
  'O:)': 'smiling_face_with_halo',
  '>:)': 'smiling_face_with_horns',
  ':|': 'neutral_face',
  ':-|': 'neutral_face',

  // Symbols
  '<3': 'red_heart',
  '</3': 'broken_heart',
};
