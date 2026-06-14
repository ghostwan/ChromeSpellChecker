import { findPosition } from '../matcher.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_TEXT = 20_000;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    issues: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          original:     { type: 'STRING' },
          before:       { type: 'STRING' },
          after:        { type: 'STRING' },
          replacements: { type: 'ARRAY', items: { type: 'STRING' } },
          message:      { type: 'STRING' },
          shortMessage: { type: 'STRING' },
          category:     { type: 'STRING', enum: ['spelling','grammar','style','punctuation'] },
        },
        required: ['original','before','after','replacements','message','shortMessage','category'],
      },
    },
  },
  required: ['issues'],
};

function buildPrompt(text, language) {
  const lang = language === 'fr-FR' ? 'French'
             : language === 'en-GB' ? 'English (British)'
             : language === 'en-US' ? 'English (American)'
             : 'the language of the text (auto-detect)';

  return `You are a professional grammar and spelling checker. Analyse the text below written in ${lang}.

For every error return a JSON object with:
- "original":     exact verbatim substring that is wrong (must appear as-is in the text)
- "before":       up to 40 chars immediately before the error (for disambiguation)
- "after":        up to 40 chars immediately after the error (for disambiguation)
- "replacements": array of 1–3 correction suggestions
- "message":      clear explanation of the error
- "shortMessage": brief label, 5 words max
- "category":     one of "spelling" | "grammar" | "style" | "punctuation"

Rules:
• Only report genuine errors, not stylistic preferences unless clearly wrong.
• "original" must be a verbatim substring of the input text.
• If no errors, return {"issues":[]}.

Text to check:
${text.slice(0, MAX_TEXT)}`;
}

/**
 * @param {string} text
 * @param {string} language
 * @param {{ geminiApiKey: string, geminiModel: string }} settings
 * @param {string[]} personalDictionary
 * @param {AbortSignal} [signal]
 * @returns {Promise<NormalisedIssue[]>}
 */
export async function check(text, language, { geminiApiKey, geminiModel }, personalDictionary = [], signal) {
  if (!geminiApiKey) throw new Error('No Gemini API key set. Add it in Options.');

  const model = geminiModel || 'gemini-2.5-flash';
  const url   = `${BASE}/${model}:generateContent?key=${geminiApiKey}`;

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: buildPrompt(text, language) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema:   RESPONSE_SCHEMA,
        temperature:      0,
      },
    }),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gemini API error ${res.status}`);
  }

  const data     = await res.json();
  const jsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!jsonText) throw new Error('Gemini returned an empty response.');

  const { issues } = JSON.parse(jsonText);
  const dictLower  = personalDictionary.map(w => w.toLowerCase());

  return issues
    .map(issue => {
      const pos = findPosition(text, issue.original, issue.before, issue.after);
      if (!pos) return null;

      const word = issue.original.toLowerCase();
      if (dictLower.includes(word)) return null;

      return {
        id:           crypto.randomUUID(),
        offset:       pos.offset,
        length:       issue.original.length,
        type:         issue.category,
        message:      issue.message,
        shortMessage: issue.shortMessage,
        replacements: (issue.replacements || []).slice(0, 3),
        rule:         null,
        engine:       'gemini',
      };
    })
    .filter(Boolean);
}
