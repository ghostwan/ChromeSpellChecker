export const LANGUAGES = [
  { value: 'auto',  label: 'Auto-detect',     lt: 'auto',  flag: '🌐' },
  { value: 'en-US', label: 'English (US)',     lt: 'en-US', flag: '🇺🇸' },
  { value: 'en-GB', label: 'English (UK)',     lt: 'en-GB', flag: '🇬🇧' },
  { value: 'fr-FR', label: 'French',           lt: 'fr-FR', flag: '🇫🇷' },
];

export const MODELS = [
  { value: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash (recommended)' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite (cheapest)' },
  { value: 'gemini-2.0-flash',      label: 'Gemini 2.0 Flash' },
];

export const ISSUE_TYPES = {
  spelling:    { label: 'Spelling',    color: '#e03d3d' },
  grammar:     { label: 'Grammar',     color: '#e8930d' },
  style:       { label: 'Style',       color: '#4a90e2' },
  punctuation: { label: 'Punctuation', color: '#9b59b6' },
};

/** Map LanguageTool issueType → our normalised type */
export function mapLtType(issueType) {
  switch ((issueType || '').toLowerCase()) {
    case 'misspelling':        return 'spelling';
    case 'grammar':
    case 'nonconformance':
    case 'duplication':        return 'grammar';
    case 'typographical':      return 'punctuation';
    case 'style':
    case 'locale-violation':   return 'style';
    default:                   return 'grammar';
  }
}
