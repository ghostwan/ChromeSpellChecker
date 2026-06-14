// Shared storage helpers — used by background, popup, options (ES module)

export const DEFAULTS = {
  engine:            'languagetool', // 'languagetool' | 'gemini'
  geminiApiKey:      '',
  geminiModel:       'gemini-2.5-flash',
  language:          'auto',         // 'auto' | 'en-US' | 'fr-FR'
  enabledSites:      {},             // { [hostname]: bool }; absent = enabled
  personalDictionary: [],
  autoAdvance:       true,           // jump to next issue automatically after applying a fix
};

export function getSettings() {
  return new Promise(resolve =>
    chrome.storage.local.get(DEFAULTS, resolve)
  );
}

export function updateSettings(partial) {
  return new Promise((resolve, reject) =>
    chrome.storage.local.set(partial, () =>
      chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve()
    )
  );
}

export async function isEnabledOnSite(hostname) {
  const { enabledSites } = await getSettings();
  return hostname in enabledSites ? enabledSites[hostname] : true;
}

export async function toggleSite(hostname) {
  const { enabledSites } = await getSettings();
  const current = hostname in enabledSites ? enabledSites[hostname] : true;
  await updateSettings({ enabledSites: { ...enabledSites, [hostname]: !current } });
  return !current;
}

export async function addToDictionary(word) {
  const { personalDictionary } = await getSettings();
  const w = word.toLowerCase().trim();
  if (!personalDictionary.includes(w)) {
    await updateSettings({ personalDictionary: [...personalDictionary, w] });
  }
}

export async function removeFromDictionary(word) {
  const { personalDictionary } = await getSettings();
  await updateSettings({
    personalDictionary: personalDictionary.filter(w => w !== word.toLowerCase().trim()),
  });
}
