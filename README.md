# ChromeSpellChecker

A Chrome extension that checks grammar and spelling in **English** and **French**, inspired by the old free LanguageTool UX.

Powered by **LanguageTool** (free, no key needed) or **Gemini AI** (requires a free API key).

---

## Features

- Wavy coloured underlines — red (spelling), orange (grammar), blue (style), purple (punctuation)
- Click an underline → correction card with suggestions, explanation, Ignore, Add to dictionary
- Badge counter at the bottom-right of every focused text field
- Summary panel listing all issues in the current field
- Two engines: **LanguageTool** (free REST API) and **Gemini AI**
- Works on `<textarea>`, text `<input>`, and `contenteditable` fields
- Per-site enable/disable toggle
- Personal dictionary
- Keyboard shortcut: `Ctrl+Shift+Space` (Mac: `⌘⇧Space`)

---

## Installation

```bash
# 1. Clone / download
git clone https://github.com/ghostwan/ChromeSpellChecker.git
cd ChromeSpellChecker

# 2. Generate icons (one-time)
python3 generate-icons.py

# 3. Load in Chrome
# chrome://extensions  →  Enable "Developer mode"  →  "Load unpacked"  →  select this folder
```

---

## Configuration

Open the **Options** page (click the extension icon → gear icon, or `chrome://extensions` → Details → Extension options).

| Setting | Description |
|---------|-------------|
| **Gemini API Key** | Paste your key from [Google AI Studio](https://aistudio.google.com/app/apikey). Stored in `chrome.storage.local` only — never committed. |
| **Default engine** | LanguageTool (free) or Gemini AI |
| **Language** | Auto-detect, English US/UK, French |
| **Gemini model** | `gemini-2.5-flash` recommended |
| **Personal dictionary** | Words never flagged as spelling errors |

> **Security note:** The Gemini API key is stored in Chrome's local extension storage, never in the source code and never sent to any server other than `generativelanguage.googleapis.com`.

---

## Usage

1. Click into any text field on any page.
2. A small **Check** badge appears near the bottom-right of the field.
3. Click **Check** (or press `⌘⇧Space`) to analyse the text.
4. Click an underlined word to open the correction card.
5. Click a suggestion to apply it, or **Ignore** / **Add to dictionary**.

---

## Known limitations (v1)

- Complex rich-text editors (Gmail compose, Google Docs canvas, Notion) are not supported — their internal rendering bypasses standard DOM text fields.
- LanguageTool free API: ~20 requests/min, ~20 KB per request.
- Gemini: billed per token — `gemini-2.5-flash-lite` is the cheapest option.

---

## Project structure

```
manifest.json
generate-icons.py          ← run once to create PNG icons
src/
  background/service-worker.js   ← API calls, caching, command relay
  content/content.js             ← DOM injection, overlay, badge, card
  content/content.css
  popup/                         ← toolbar action popup
  options/                       ← settings page
  shared/
    storage.js  languages.js  matcher.js
    engines/
      languagetool-engine.js
      gemini-engine.js
      index.js
assets/icons/
```

---

## License

MIT — see [LICENSE](LICENSE).
