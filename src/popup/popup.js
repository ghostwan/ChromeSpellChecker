'use strict';

const $ = id => document.getElementById(id);

async function getSettings() {
  return new Promise(r => chrome.storage.local.get({
    engine: 'languagetool', geminiApiKey: '', language: 'auto', enabledSites: {},
  }, r));
}

async function getSiteEnabled(hostname, enabledSites) {
  return hostname in enabledSites ? enabledSites[hostname] : true;
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const hostname = tab?.url ? new URL(tab.url).hostname : '';
  const settings = await getSettings();

  // Populate selects
  $('sel-engine').value = settings.engine;
  $('sel-lang').value   = settings.language;

  // Site toggle
  const siteEnabled = await getSiteEnabled(hostname, settings.enabledSites);
  $('chk-site').checked = siteEnabled;
  if (hostname) $('lbl-toggle').textContent = `Enabled on ${hostname}`;

  // Show notice if Gemini selected but no key
  if (settings.engine === 'gemini' && !settings.geminiApiKey) {
    $('no-key-notice').classList.remove('hidden');
  }

  // ── Listeners ──────────────────────────────────────────────────

  $('sel-engine').addEventListener('change', async () => {
    const v = $('sel-engine').value;
    await chrome.storage.local.set({ engine: v });
    const s = await getSettings();
    $('no-key-notice').classList.toggle('hidden', !(v === 'gemini' && !s.geminiApiKey));
  });

  $('sel-lang').addEventListener('change', () =>
    chrome.storage.local.set({ language: $('sel-lang').value })
  );

  $('chk-site').addEventListener('change', async () => {
    const s = await getSettings();
    await chrome.storage.local.set({
      enabledSites: { ...s.enabledSites, [hostname]: $('chk-site').checked },
    });
    // Reload the active tab's content script state
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: $('chk-site').checked ? 'ENABLE' : 'DISABLE' })
        .catch(() => {});
    }
  });

  $('btn-check').addEventListener('click', async () => {
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_CHECK' }).catch(() => {});
      window.close();
    }
  });

  $('btn-options').addEventListener('click', e => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
    window.close();
  });

  $('link-options')?.addEventListener('click', e => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
    window.close();
  });
}

  $('ver').textContent = 'v' + chrome.runtime.getManifest().version;

  init();
