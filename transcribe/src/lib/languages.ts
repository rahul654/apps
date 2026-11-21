/** Languages Whisper supports (ISO 639-1 where it exists, as Whisper names them). */
export const LANGUAGES: [code: string, name: string][] = [
  ['en', 'English'], ['zh', 'Chinese'], ['de', 'German'], ['es', 'Spanish'], ['ru', 'Russian'], ['ko', 'Korean'],
  ['fr', 'French'], ['ja', 'Japanese'], ['pt', 'Portuguese'], ['tr', 'Turkish'], ['pl', 'Polish'], ['ca', 'Catalan'],
  ['nl', 'Dutch'], ['ar', 'Arabic'], ['sv', 'Swedish'], ['it', 'Italian'], ['id', 'Indonesian'], ['hi', 'Hindi'],
  ['fi', 'Finnish'], ['vi', 'Vietnamese'], ['he', 'Hebrew'], ['uk', 'Ukrainian'], ['el', 'Greek'], ['ms', 'Malay'],
  ['cs', 'Czech'], ['ro', 'Romanian'], ['da', 'Danish'], ['hu', 'Hungarian'], ['ta', 'Tamil'], ['no', 'Norwegian'],
  ['th', 'Thai'], ['ur', 'Urdu'], ['hr', 'Croatian'], ['bg', 'Bulgarian'], ['lt', 'Lithuanian'], ['la', 'Latin'],
  ['mi', 'Maori'], ['ml', 'Malayalam'], ['cy', 'Welsh'], ['sk', 'Slovak'], ['te', 'Telugu'], ['fa', 'Persian'],
  ['lv', 'Latvian'], ['bn', 'Bengali'], ['sr', 'Serbian'], ['az', 'Azerbaijani'], ['sl', 'Slovenian'], ['kn', 'Kannada'],
  ['et', 'Estonian'], ['mk', 'Macedonian'], ['br', 'Breton'], ['eu', 'Basque'], ['is', 'Icelandic'], ['hy', 'Armenian'],
  ['ne', 'Nepali'], ['mn', 'Mongolian'], ['bs', 'Bosnian'], ['kk', 'Kazakh'], ['sq', 'Albanian'], ['sw', 'Swahili'],
  ['gl', 'Galician'], ['mr', 'Marathi'], ['pa', 'Punjabi'], ['si', 'Sinhala'], ['km', 'Khmer'], ['sn', 'Shona'],
  ['yo', 'Yoruba'], ['so', 'Somali'], ['af', 'Afrikaans'], ['oc', 'Occitan'], ['ka', 'Georgian'], ['be', 'Belarusian'],
  ['tg', 'Tajik'], ['sd', 'Sindhi'], ['gu', 'Gujarati'], ['am', 'Amharic'], ['yi', 'Yiddish'], ['lo', 'Lao'],
  ['uz', 'Uzbek'], ['fo', 'Faroese'], ['ht', 'Haitian Creole'], ['ps', 'Pashto'], ['tk', 'Turkmen'], ['nn', 'Nynorsk'],
  ['mt', 'Maltese'], ['sa', 'Sanskrit'], ['lb', 'Luxembourgish'], ['my', 'Myanmar'], ['bo', 'Tibetan'], ['tl', 'Tagalog'],
  ['mg', 'Malagasy'], ['as', 'Assamese'], ['tt', 'Tatar'], ['haw', 'Hawaiian'], ['ln', 'Lingala'], ['ha', 'Hausa'],
  ['ba', 'Bashkir'], ['jw', 'Javanese'], ['su', 'Sundanese'], ['yue', 'Cantonese'],
];

export const SORTED_LANGUAGES = [...LANGUAGES].sort((a, b) => a[1].localeCompare(b[1]));

const NAMES = new Map(LANGUAGES);
export function languageName(code: string | undefined): string {
  if (!code) return 'Unknown';
  return NAMES.get(code) ?? code;
}

/**
 * BCP 47 tags for the Web Speech API (it wants a region for many languages). The browser's
 * own language comes first when it's supported.
 */
export const DICTATION_LANGS: [tag: string, name: string][] = [
  ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-IN', 'English (India)'], ['hi-IN', 'Hindi'], ['es-ES', 'Spanish (Spain)'],
  ['es-MX', 'Spanish (Mexico)'], ['fr-FR', 'French'], ['de-DE', 'German'], ['it-IT', 'Italian'], ['pt-BR', 'Portuguese (Brazil)'],
  ['pt-PT', 'Portuguese (Portugal)'], ['nl-NL', 'Dutch'], ['ru-RU', 'Russian'], ['uk-UA', 'Ukrainian'], ['pl-PL', 'Polish'],
  ['tr-TR', 'Turkish'], ['ar-SA', 'Arabic'], ['he-IL', 'Hebrew'], ['ja-JP', 'Japanese'], ['ko-KR', 'Korean'], ['zh-CN', 'Chinese (Mandarin)'],
  ['zh-TW', 'Chinese (Taiwan)'], ['bn-IN', 'Bengali'], ['ta-IN', 'Tamil'], ['te-IN', 'Telugu'], ['mr-IN', 'Marathi'], ['gu-IN', 'Gujarati'],
  ['kn-IN', 'Kannada'], ['ml-IN', 'Malayalam'], ['id-ID', 'Indonesian'], ['vi-VN', 'Vietnamese'], ['th-TH', 'Thai'], ['sv-SE', 'Swedish'],
];
