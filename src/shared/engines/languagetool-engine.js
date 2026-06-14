import { mapLtType } from '../languages.js';

const LT_URL = 'https://api.languagetool.org/v2/check';
const MAX_TEXT = 20_000;

/**
 * @param {string} text
 * @param {string} language  'auto' | 'en-US' | 'en-GB' | 'fr-FR'
 * @param {string[]} personalDictionary
 * @param {AbortSignal} [signal]
 * @returns {Promise<NormalisedIssue[]>}
 */
export async function check(text, language, personalDictionary = [], signal) {
  const body = new URLSearchParams({
    text:     text.slice(0, MAX_TEXT),
    language: language === 'auto' ? 'auto' : language,
  });

  const res = await fetch(LT_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
    signal,
  });

  if (res.status === 429) throw new Error('LanguageTool rate limit — wait a moment and try again.');
  if (!res.ok) throw new Error(`LanguageTool error ${res.status}`);

  const { matches } = await res.json();
  const dictLower   = personalDictionary.map(w => w.toLowerCase());

  return matches
    .filter(m => {
      const word = text.slice(m.offset, m.offset + m.length).toLowerCase();
      return !dictLower.includes(word);
    })
    .map(m => ({
      id:           crypto.randomUUID(),
      offset:       m.offset,
      length:       m.length,
      type:         mapLtType(m.rule?.issueType),
      message:      m.message,
      shortMessage: m.shortMessage || m.rule?.category?.name || 'Issue',
      replacements: (m.replacements || []).slice(0, 5).map(r => r.value),
      rule:         m.rule?.id ?? null,
      engine:       'languagetool',
    }));
}
