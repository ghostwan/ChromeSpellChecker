import * as lt     from './languagetool-engine.js';
import * as gemini from './gemini-engine.js';

/**
 * Returns a check() function bound to the right engine.
 * Falls back to LanguageTool if Gemini is selected but no key is set.
 *
 * @param {{ engine: string, geminiApiKey: string, geminiModel: string,
 *           language: string, personalDictionary: string[] }} settings
 * @param {AbortSignal} [signal]
 * @returns {{ name: string, fn: (text) => Promise<NormalisedIssue[]> }}
 */
export function selectEngine(settings, signal) {
  const { engine, geminiApiKey, geminiModel, language, personalDictionary = [] } = settings;

  if (engine === 'gemini' && geminiApiKey) {
    return {
      name: 'gemini',
      fn: text => gemini.check(text, language, { geminiApiKey, geminiModel }, personalDictionary, signal),
    };
  }

  // Default / fallback
  return {
    name: 'languagetool',
    fn: text => lt.check(text, language, personalDictionary, signal),
  };
}
