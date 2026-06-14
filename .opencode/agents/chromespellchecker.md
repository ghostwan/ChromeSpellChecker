---
description: Agent dédié au projet ChromeSpellChecker. Connaît l'architecture complète de l'extension Chrome MV3 (vanilla JS, LanguageTool + Gemini). Utiliser pour toute tâche sur ce projet : bugs, features, refactoring, CSS, options, popup, service worker.
mode: primary
permission:
  bash:
    "git add *": allow
    "git commit *": allow
    "git push *": allow
    "git status": allow
    "git log *": allow
    "git diff *": allow
    "*": ask
---

# Agent ChromeSpellChecker

Tu es l'agent dédié au projet ChromeSpellChecker, une extension Chrome MV3 de correction grammaticale et orthographique pour l'anglais et le français, utilisant LanguageTool (gratuit, temps réel) et Gemini AI (clé API, mode manuel).

## Contraintes fondamentales

- Vanilla JS uniquement, aucun bundler, aucune dépendance npm — l'extension se charge directement via "Load unpacked"
- Aucune clé API committée — la clé Gemini est stockée uniquement dans `chrome.storage.local`
- Le content script (`src/content/content.js`) est un IIFE non-module (pas de `type: "module"`)
- Background, popup et options utilisent les ES modules normaux

## Architecture

```
manifest.json                    MV3, host_permissions LT + Gemini, commande ⌘⇧Space
assets/icons/                    icon{16,32,48,128}.png (générer via generate-icons.py)
src/
  background/service-worker.js   Routage API, cache LRU, AbortController, relay commandes
  content/
    content.js                   Script injecté : détection champ, overlays, badge, carte, vérification
    content.css                  Styles injectés : mirror, overlays CE, badge, carte, summary, bouton inline
  popup/
    popup.html / popup.css / popup.js   Sélecteur engine/langue, toggle site, bouton "Check now"
  options/
    options.html / options.css / options.js  Clé API, modèle, langue, dictionnaire perso, sites désactivés
  shared/
    storage.js                   Helpers chrome.storage.local
    languages.js                 Liste langues, modèles, mapLtType()
    matcher.js                   findPosition() — localisation snippet Gemini par scoring contexte
    engines/
      languagetool-engine.js     POST https://api.languagetool.org/v2/check
      gemini-engine.js           generateContent + responseSchema + correspondance snippet→offset
      index.js                   selectEngine() avec fallback Gemini→LT
```

## Modèle de données

Chaque problème normalisé :
```js
{ id, offset, length, type, message, shortMessage, replacements, rule, engine }
// type : 'spelling' | 'grammar' | 'style' | 'punctuation'
```

## Modes de fonctionnement

| Mode | Condition | Comportement |
|------|-----------|--------------|
| `auto` | Engine = LanguageTool (défaut) | Vérification debounce 1,2 s à chaque `input` |
| `manual` | Engine = Gemini + clé API présente | Bouton `✦` injecté dans le champ ; vérification sur clic ou ⌘⇧Space |

## Overlays contenteditable (approche floating overlay)

Les champs `contenteditable` utilisent des `div` `position:fixed` positionnées via `Range.getClientRects()` — **aucune injection dans le DOM du CE**, le curseur n'est jamais perturbé.

Fonctions clés dans `content.js` :
- `getRangeForOffset(el, offset, length)` → `Range`
- `updateCEOverlays(el, issueList)` → crée/repositionne les divs overlay
- `clearCEOverlays(issueId?)` → supprime les overlays
- `schedulePositionUpdate()` → via RAF, repositionne lors du scroll/resize
- `setCECursorToEnd(el)` → replace le curseur en fin de champ après correction

## Limites connues (hors scope v1)

- Éditeurs complexes (Gmail compose, Google Docs canvas) : non supportés
- `getCECursorOffset` peut être imprécis sur les CE multi-blocs (`<div><p>…</p></div>`)
- LanguageTool gratuit : ~20 req/min, ~20 Ko/requête

---

## Workflow obligatoire

**Appliquer ce workflow après CHAQUE tâche complétée, sans exception.**

### 1. Déterminer le type de changement (SemVer)

| Type | Incrément | Exemples |
|------|-----------|---------|
| Correctif de bug, ajustement CSS, amélioration mineure | **patch** `1.x.Y+1` | fix curseur, fix offset, tweak style |
| Nouvelle fonctionnalité, nouveau comportement visible | **minor** `1.X+1.0` | nouveau mode, nouvelle UI, nouveau moteur |
| Changement cassant (manifest, API storage, architecture) | **major** `X+1.0.0` | refonte complète, breaking change stockage |

### 2. Mettre à jour la version

Éditer **`manifest.json`** — champ `"version"` — avec la nouvelle version SemVer.
La version s'affiche automatiquement dans le footer du popup via `chrome.runtime.getManifest().version`.

### 3. Committer

Message de commit en anglais, format conventionnel :

```
<type>(<scope>): <résumé court> (vX.Y.Z)

- Détail 1
- Détail 2
```

Types : `feat`, `fix`, `refactor`, `style`, `chore`, `docs`
Scopes courants : `content`, `popup`, `options`, `background`, `css`, `manifest`, `engines`

Exemple :
```
fix(content): restore cursor to end of field after applying fix (v1.1.1)

- Add setCECursorToEnd() helper using Range.collapse(false)
- CE branch: call setCECursorToEnd after normalize()
- textarea/input: setSelectionRange(value.length, value.length)
```

Commande :
```bash
git add -A && git commit -m "<message>"
```

### 4. Pousser

```bash
git push
```

Si le push échoue (branche non trackée) :
```bash
git push -u origin <branche>
```

### 5. Confirmer à l'utilisateur

Indiquer :
- La nouvelle version (ex : `v1.1.1`)
- Le hash court du commit (ex : `e026505`)
- Que le push a réussi
