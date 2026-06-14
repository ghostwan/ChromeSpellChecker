import { getSettings }  from '../shared/storage.js';
import { selectEngine } from '../shared/engines/index.js';

// Per-tab in-flight AbortControllers
const controllers = new Map();

// Simple LRU-ish text cache (hash → issues), cleared on settings change
const cache = new Map();
const CACHE_MAX = 50;

// ── Helpers ──────────────────────────────────────────────────────────────────

function simpleHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h.toString(16);
}

function cacheKey(text, settings) {
  return `${settings.engine}:${settings.language}:${simpleHash(text)}`;
}

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CHECK_TEXT')  { handleCheck(msg, sender, sendResponse); return true; }
  if (msg.type === 'CANCEL_CHECK') { cancelCheck(sender.tab?.id); sendResponse({ ok: true }); }
  if (msg.type === 'GET_ENGINE_NAME') {
    getSettings().then(s => sendResponse({ name: s.engine === 'gemini' && s.geminiApiKey ? 'gemini' : 'languagetool' }));
    return true;
  }
});

// ── Command handler (keyboard shortcut) ──────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'check-grammar') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_CHECK' }).catch(() => {});
});

// ── Core check ────────────────────────────────────────────────────────────────

async function handleCheck({ text, tabId }, sender, sendResponse) {
  const resolvedTabId = tabId || sender.tab?.id;

  // Cancel any in-flight request for this tab
  cancelCheck(resolvedTabId);

  try {
    const settings = await getSettings();
    const key      = cacheKey(text, settings);

    if (cache.has(key)) {
      return sendResponse({ ok: true, issues: cache.get(key), cached: true });
    }

    const ac = new AbortController();
    if (resolvedTabId) controllers.set(resolvedTabId, ac);

    const engine = selectEngine(settings, ac.signal);
    const issues = await engine.fn(text);

    controllers.delete(resolvedTabId);

    // Evict oldest entries when cache is full
    if (cache.size >= CACHE_MAX) {
      cache.delete(cache.keys().next().value);
    }
    cache.set(key, issues);

    sendResponse({ ok: true, issues, engine: engine.name });
  } catch (err) {
    if (err.name === 'AbortError') return; // cancelled, no response needed
    sendResponse({ ok: false, error: err.message });
  }
}

function cancelCheck(tabId) {
  if (tabId && controllers.has(tabId)) {
    controllers.get(tabId).abort();
    controllers.delete(tabId);
  }
}

// ── Clear cache on settings change ───────────────────────────────────────────

chrome.storage.onChanged.addListener(() => cache.clear());
