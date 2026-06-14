'use strict';

const $ = id => document.getElementById(id);

const DEFAULTS = {
  engine: 'languagetool', geminiApiKey: '', geminiModel: 'gemini-2.5-flash',
  language: 'auto', enabledSites: {}, personalDictionary: [], autoAdvance: true,
};

function getSettings() {
  return new Promise(r => chrome.storage.local.get(DEFAULTS, r));
}

function saveSettings(partial) {
  return new Promise((res, rej) =>
    chrome.storage.local.set(partial, () =>
      chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res()
    )
  );
}

// ── Save banner ───────────────────────────────────────────────────────────────

let bannerTimer;
function showSaved() {
  const b = $('save-banner');
  b.classList.remove('hidden');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.add('hidden'), 2000);
}

// ── Dictionary list ───────────────────────────────────────────────────────────

function renderDict(list) {
  const ul = $('dict-list');
  ul.innerHTML = '';
  list.forEach(word => {
    const li  = document.createElement('li');
    li.innerHTML = `<span>${word}</span><button class="btn-remove" data-word="${word}" title="Remove">✕</button>`;
    ul.appendChild(li);
  });
  ul.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const s = await getSettings();
      const d = s.personalDictionary.filter(w => w !== btn.dataset.word);
      await saveSettings({ personalDictionary: d });
      renderDict(d);
      showSaved();
    });
  });
}

// ── Disabled-sites list ───────────────────────────────────────────────────────

function renderSites(enabledSites) {
  const disabled = Object.entries(enabledSites)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  const ul     = $('sites-list');
  const notice = $('no-sites');
  ul.innerHTML = '';

  if (!disabled.length) {
    notice.style.display = '';
    return;
  }
  notice.style.display = 'none';

  disabled.forEach(host => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${host}</span><button class="btn-remove" data-host="${host}" title="Re-enable">✕</button>`;
    ul.appendChild(li);
  });

  ul.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const s = await getSettings();
      const es = { ...s.enabledSites };
      delete es[btn.dataset.host];
      await saveSettings({ enabledSites: es });
      renderSites(es);
      showSaved();
    });
  });
}

// ── Auto-save helpers ─────────────────────────────────────────────────────────

function autoSave(key, getValue) {
  return async () => {
    await saveSettings({ [key]: getValue() });
    showSaved();
  };
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const s = await getSettings();

  $('gemini-key').value  = s.geminiApiKey;
  $('sel-engine').value  = s.engine;
  $('sel-lang').value    = s.language;
  $('sel-model').value   = s.geminiModel;
  $('chk-auto-advance').checked = s.autoAdvance !== false;

  // Show/hide model selector based on engine
  $('model-field').style.display = s.engine === 'gemini' ? '' : 'none';
  $('sel-engine').addEventListener('change', () => {
    $('model-field').style.display = $('sel-engine').value === 'gemini' ? '' : 'none';
  });

  renderDict(s.personalDictionary);
  renderSites(s.enabledSites);

  // ── API key toggle visibility ──────────────────────────────────

  $('toggle-key').addEventListener('click', () => {
    const inp = $('gemini-key');
    inp.type  = inp.type === 'password' ? 'text' : 'password';
  });

  // ── Auto-save on change ────────────────────────────────────────

  $('gemini-key').addEventListener('change', autoSave('geminiApiKey', () => $('gemini-key').value.trim()));
  $('sel-engine').addEventListener('change', autoSave('engine',       () => $('sel-engine').value));
  $('sel-lang').addEventListener('change',   autoSave('language',     () => $('sel-lang').value));
  $('sel-model').addEventListener('change',  autoSave('geminiModel',  () => $('sel-model').value));
  $('chk-auto-advance').addEventListener('change', autoSave('autoAdvance', () => $('chk-auto-advance').checked));

  // ── Add word ───────────────────────────────────────────────────

  async function addWord() {
    const w = $('new-word').value.trim().toLowerCase();
    if (!w) return;
    const s = await getSettings();
    if (s.personalDictionary.includes(w)) { $('new-word').value = ''; return; }
    const d = [...s.personalDictionary, w];
    await saveSettings({ personalDictionary: d });
    $('new-word').value = '';
    renderDict(d);
    showSaved();
  }

  $('btn-add-word').addEventListener('click', addWord);
  $('new-word').addEventListener('keydown', e => { if (e.key === 'Enter') addWord(); });
}

init();
