/**
 * ChromeSpellChecker — Content Script
 * Single non-module file (loaded via manifest content_scripts).
 */
(function () {
  'use strict';

  if (window.__cscLoaded) return;
  window.__cscLoaded = true;

  // ══════════════════════════════════════════════════════════════
  // CONSTANTS
  // ══════════════════════════════════════════════════════════════

  const TYPE_COLORS = {
    spelling:    '#e03d3d',
    grammar:     '#e8930d',
    style:       '#4a90e2',
    punctuation: '#9b59b6',
  };

  const DEBOUNCE_MS = 1200; // LanguageTool auto-check debounce (ms)

  const MIRROR_PROPS = [
    'fontFamily','fontSize','fontWeight','fontStyle','fontVariant',
    'lineHeight','letterSpacing','wordSpacing','textAlign','textTransform',
    'paddingTop','paddingRight','paddingBottom','paddingLeft',
    'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
    'boxSizing','tabSize','wordBreak','overflowWrap',
  ];

  // ══════════════════════════════════════════════════════════════
  // STATE
  // ══════════════════════════════════════════════════════════════

  let field       = null;   // focused element
  let issues      = [];     // current normalised issues
  let isChecking  = false;
  let isDirty     = false;  // text changed after last check
  let mirrorEl    = null;   // mirror div (textarea/input only)
  let badgeEl     = null;
  let cardEl      = null;
  let summaryEl   = null;
  let fieldType   = null;   // 'textarea' | 'input' | 'ce'
  let scrollRaf   = null;
  let resizeObs   = null;
  let enabled     = true;   // per-site toggle (loaded on init)
  let debounceTimer = null;
  let engineMode    = 'auto'; // 'auto' (LT realtime) | 'manual' (Gemini+key)
  let inlineBtnEl   = null;
  let isApplyingFix = false;
  let ceOverlayEls  = {};   // { [issueId]: [div, …] } — CE floating underline overlays
  let autoAdvance   = true; // mirror of storage.autoAdvance — advance card after each fix

  // ══════════════════════════════════════════════════════════════
  // STORAGE HELPERS (inline — no ES module import)
  // ══════════════════════════════════════════════════════════════

  function getSettings(cb) {
    if (!isContextAlive()) return;
    try {
    chrome.storage.local.get({
        engine: 'languagetool', geminiApiKey: '', geminiModel: 'gemini-2.5-flash',
        language: 'auto', enabledSites: {}, personalDictionary: [], autoAdvance: true,
      }, cb);
    } catch (_) {}
  }

  function isEnabledOnSite(cb) {
    getSettings(s => {
      const h = location.hostname;
      cb(h in s.enabledSites ? s.enabledSites[h] : true);
    });
  }

  function addToDictionary(word) {
    if (!isContextAlive()) return;
    try {
      chrome.storage.local.get({ personalDictionary: [] }, ({ personalDictionary }) => {
        const w = word.toLowerCase().trim();
        if (!personalDictionary.includes(w))
          chrome.storage.local.set({ personalDictionary: [...personalDictionary, w] });
      });
    } catch (_) {}
  }

  function loadEngineMode(cb) {
    getSettings(s => cb(s.engine === 'gemini' && s.geminiApiKey ? 'manual' : 'auto'));
  }

  // ══════════════════════════════════════════════════════════════
  // FIELD DETECTION
  // ══════════════════════════════════════════════════════════════

  function detectFieldType(el) {
    if (!el) return null;
    const tag  = el.tagName;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'TEXTAREA') return 'textarea';
    if (tag === 'INPUT' && ['text','search','email','url',''].includes(type)) return 'input';
    if (el.isContentEditable ||
        el.getAttribute('contenteditable') === 'true' ||
        el.getAttribute('contenteditable') === '') return 'ce';
    return null;
  }

  function getFieldText(el) {
    return (fieldType === 'ce') ? (el.innerText || '') : (el.value || '');
  }

  // ══════════════════════════════════════════════════════════════
  // UTILITIES
  // ══════════════════════════════════════════════════════════════

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /**
   * Returns false when the extension has been reloaded and this content
   * script is orphaned. All chrome API calls must be guarded by this check.
   */
  function isContextAlive() {
    try { return !!chrome.runtime?.id; } catch (_) { return false; }
  }

  /** Returns the character offset of the cursor inside a contenteditable. */
  function getCECursorOffset(el) {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer)) return null;
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
  }

  /** Moves the cursor to the very end of a contenteditable element. */
  function setCECursorToEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false); // collapse to end
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ══════════════════════════════════════════════════════════════
  // MIRROR DIV  (textarea / input)
  // ══════════════════════════════════════════════════════════════

  function createMirror(el) {
    const m   = document.createElement('div');
    m.className = 'csc-mirror';
    const cs  = window.getComputedStyle(el);
    MIRROR_PROPS.forEach(p => { m.style[p] = cs[p]; });
    m.style.whiteSpace = (el.tagName === 'TEXTAREA') ? 'pre-wrap' : 'pre';
    document.documentElement.appendChild(m);
    positionMirror(m, el);
    return m;
  }

  function positionMirror(m, el) {
    const r = el.getBoundingClientRect();
    m.style.top    = r.top    + 'px';
    m.style.left   = r.left   + 'px';
    m.style.width  = r.width  + 'px';
    m.style.height = r.height + 'px';
    m.scrollTop    = el.scrollTop;
    m.scrollLeft   = el.scrollLeft;
  }

  function buildMirrorHTML(text, issueList) {
    const sorted = [...issueList].sort((a, b) => a.offset - b.offset);
    let html = '', pos = 0;
    for (const iss of sorted) {
      if (iss.offset < pos) continue;
      html += escHtml(text.slice(pos, iss.offset));
      html += `<span class="csc-underline csc-type-${iss.type}" data-id="${iss.id}">`;
      html += escHtml(text.slice(iss.offset, iss.offset + iss.length));
      html += '</span>';
      pos = iss.offset + iss.length;
    }
    html += escHtml(text.slice(pos));
    return html;
  }

  function refreshMirror() {
    if (!mirrorEl || !field) return;
    const text = getFieldText(field);
    mirrorEl.innerHTML = buildMirrorHTML(text, issues);
    positionMirror(mirrorEl, field);
  }

  function removeMirror() {
    mirrorEl?.remove();
    mirrorEl = null;
  }

  // ══════════════════════════════════════════════════════════════
  // CONTENTEDITABLE  (floating overlay — no DOM injection)
  // ══════════════════════════════════════════════════════════════

  function getTextNodes(root) {
    const nodes = [];
    let offset  = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      nodes.push({ node: n, start: offset });
      offset += n.textContent.length;
    }
    return nodes;
  }

  /** Returns a Range spanning [offset, offset+length) inside el's text content. */
  function getRangeForOffset(el, offset, length) {
    const textNodes = getTextNodes(el);
    const end = offset + length;
    let startNode, startOff, endNode, endOff;
    for (const { node, start } of textNodes) {
      const nodeEnd = start + node.textContent.length;
      if (!startNode && offset >= start && offset <= nodeEnd) {
        startNode = node; startOff = offset - start;
      }
      if (!endNode && end >= start && end <= nodeEnd) {
        endNode = node; endOff = end - start;
      }
      if (startNode && endNode) break;
    }
    if (!startNode || !endNode) return null;
    try {
      const r = document.createRange();
      r.setStart(startNode, startOff);
      r.setEnd(endNode, endOff);
      return r;
    } catch (_) { return null; }
  }

  /**
   * Creates position:fixed underline overlay divs for each CE issue.
   * Zero DOM injection into the CE element — cursor is never disturbed.
   */
  function updateCEOverlays(el, issueList) {
    clearCEOverlays();
    for (const iss of issueList) {
      const range = getRangeForOffset(el, iss.offset, iss.length);
      if (!range) continue;
      const rects = Array.from(range.getClientRects());
      const divs  = [];
      for (const rect of rects) {
        if (rect.width < 1) continue;
        const d = document.createElement('div');
        d.className   = `csc-ce-overlay csc-ce-ov-${iss.type}`;
        d.dataset.id  = iss.id;
        d.style.top   = (rect.bottom - 3) + 'px';
        d.style.left  = rect.left + 'px';
        d.style.width = rect.width + 'px';
        // Clicking the overlay directly shows the card — no cursor hit-test needed
        d.addEventListener('mousedown', e => e.preventDefault()); // don't steal focus
        d.addEventListener('click', e => {
          e.stopPropagation();
          showCard(iss, e.clientX, e.clientY);
        });
        document.documentElement.appendChild(d);
        divs.push(d);
      }
      if (divs.length) ceOverlayEls[iss.id] = divs;
    }
  }

  /** Removes overlay divs for one issue (by id) or all issues (no argument). */
  function clearCEOverlays(issueId) {
    if (issueId !== undefined) {
      (ceOverlayEls[issueId] || []).forEach(d => d.remove());
      delete ceOverlayEls[issueId];
    } else {
      Object.values(ceOverlayEls).forEach(divs => divs.forEach(d => d.remove()));
      ceOverlayEls = {};
    }
  }

  // ══════════════════════════════════════════════════════════════
  // BADGE
  // ══════════════════════════════════════════════════════════════

  const ICON_CHECK = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>`;
  const ICON_SPELL = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><text x="3" y="16" font-family="serif" font-size="13" font-weight="bold" fill="currentColor" stroke="none">A</text><path d="M3 20 Q12 17 21 20" stroke-width="2"/></svg>`;
  const ICON_SPIN  = `<svg class="csc-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10" stroke-opacity=".25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>`;
  const ICON_WARN  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 9v4M12 17h.01M10.3 3.6L2.1 18a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z"/></svg>`;

  function createBadge() {
    const b       = document.createElement('div');
    b.className   = 'csc-badge csc-badge-idle';
    b.setAttribute('role', 'button');
    b.setAttribute('tabindex', '0');
    b.innerHTML   = `${ICON_SPELL}<span class="csc-badge-lbl">Check</span>`;
    b.title       = 'Check grammar & spelling (⌘⇧Space)';
    b.addEventListener('click', onBadgeClick);
    b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') onBadgeClick(); });
    document.documentElement.appendChild(b);
    return b;
  }

  function setBadgeState(state, count) {
    if (!badgeEl) return;
    badgeEl.className = `csc-badge csc-badge-${state}`;
    const lbl = badgeEl.querySelector('.csc-badge-lbl');
    switch (state) {
      case 'idle':
        badgeEl.innerHTML = `${ICON_SPELL}<span class="csc-badge-lbl">${engineMode === 'auto' ? 'Auto' : 'Check'}</span>`;
        badgeEl.title = engineMode === 'auto' ? 'Auto-checking (LanguageTool)' : 'Check grammar & spelling';
        break;
      case 'checking':
        badgeEl.innerHTML = `${ICON_SPIN}<span class="csc-badge-lbl">Checking…</span>`;
        break;
      case 'clean':
        badgeEl.innerHTML = `${ICON_CHECK}<span class="csc-badge-lbl">No errors</span>`;
        break;
      case 'errors':
        badgeEl.innerHTML = `${ICON_WARN}<span class="csc-badge-lbl">${count} issue${count !== 1 ? 's' : ''}</span>`;
        badgeEl.title = `${count} issue${count !== 1 ? 's' : ''} — click to review`;
        break;
      case 'error':
        badgeEl.innerHTML = `${ICON_WARN}<span class="csc-badge-lbl">Error</span>`;
        break;
    }
    // Re-attach click listener since innerHTML was replaced
    badgeEl.onclick = onBadgeClick;
  }

  function positionBadge() {
    if (!badgeEl || !field) return;
    const r      = field.getBoundingClientRect();
    const bw     = badgeEl.offsetWidth  || 80;
    const bh     = badgeEl.offsetHeight || 26;
    const margin = 6;
    let top, left;

    // Prefer below-right, fall back to above-right if no space
    if (window.innerHeight - r.bottom > bh + margin + 4) {
      top = r.bottom + margin;
    } else {
      top = r.top - bh - margin;
    }
    left = clamp(r.right - bw, margin, window.innerWidth - bw - margin);
    top  = clamp(top, margin, window.innerHeight - bh - margin);

    badgeEl.style.top  = top  + 'px';
    badgeEl.style.left = left + 'px';
  }

  function removeBadge() {
    badgeEl?.remove();
    badgeEl = null;
  }

  function onBadgeClick() {
    if (isChecking) return;
    if (issues.length > 0 && !isDirty) {
      toggleSummary();
    } else {
      triggerCheck();
    }
  }

  // ══════════════════════════════════════════════════════════════
  // INLINE BUTTON  (Gemini manual mode — injected inside the field)
  // ══════════════════════════════════════════════════════════════

  const ICON_GEMINI = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c-.5 4.5-4 8-8 8.5 4 .5 7.5 4 8 8.5.5-4.5 4-8 8-8.5-4-.5-7.5-4-8-8.5z"/></svg>`;

  function createInlineBtn() {
    const btn = document.createElement('div');
    btn.className = 'csc-inline-btn';
    btn.innerHTML = ICON_GEMINI;
    btn.title     = 'Check with Gemini AI (⌘⇧Space)';
    btn.addEventListener('mousedown', e => e.preventDefault()); // no focus steal
    btn.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); triggerCheck(); });
    document.documentElement.appendChild(btn);
    return btn;
  }

  function positionInlineBtn() {
    if (!inlineBtnEl || !field) return;
    const r = field.getBoundingClientRect();
    const size = 26, margin = 5;
    const top  = fieldType === 'input'
      ? r.top + (r.height - size) / 2
      : r.bottom - size - margin;
    inlineBtnEl.style.top  = top + 'px';
    inlineBtnEl.style.left = (r.right - size - margin) + 'px';
  }

  function removeInlineBtn() {
    inlineBtnEl?.remove();
    inlineBtnEl = null;
  }

  // ══════════════════════════════════════════════════════════════
  // CORRECTION CARD
  // ══════════════════════════════════════════════════════════════

  function showCard(iss, cx, cy) {
    removeCard();

    const color = TYPE_COLORS[iss.type] || '#4a90e2';
    const card  = document.createElement('div');
    card.className = 'csc-card';
    card.id        = 'csc-card';

    const suggestions = (iss.replacements || []).map(r =>
      `<button class="csc-suggestion-btn" data-rep="${escHtml(r)}">${escHtml(r)}</button>`
    ).join('');

    const dictBtn = iss.type === 'spelling'
      ? `<button class="csc-action-btn csc-add-dict">Add to dictionary</button>` : '';

    card.innerHTML = `
      <div class="csc-card-header">
        <span class="csc-card-type-badge" style="background:${color}">${iss.type}</span>
        <span class="csc-card-title">${escHtml(iss.shortMessage)}</span>
        <button class="csc-card-close" title="Dismiss">✕</button>
      </div>
      <div class="csc-card-body">
        <div class="csc-card-message">${escHtml(iss.message)}</div>
        ${suggestions ? `<div class="csc-suggestions">${suggestions}</div>` : ''}
      </div>
      <div class="csc-card-footer">
        <button class="csc-action-btn csc-ignore">Ignore</button>
        ${dictBtn}
      </div>`;

    // Position card below click, clamp to viewport
    const CW = 340, CH = 160;
    let top  = cy + 12;
    let left = cx - 10;
    top  = clamp(top,  4, window.innerHeight - CH - 4);
    left = clamp(left, 4, window.innerWidth  - CW - 4);
    card.style.top  = top  + 'px';
    card.style.left = left + 'px';

    card.querySelector('.csc-card-close').addEventListener('click', removeCard);
    card.querySelector('.csc-ignore').addEventListener('click', () => ignoreIssue(iss));
    card.querySelector('.csc-add-dict')?.addEventListener('click', () => addIssueToDict(iss));
    card.querySelectorAll('.csc-suggestion-btn').forEach(btn => {
      btn.addEventListener('click', () => applyFix(iss, btn.dataset.rep));
    });

    document.documentElement.appendChild(card);
    cardEl = card;

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('mousedown', onOutsideClick, { capture: true, once: false });
    }, 0);
  }

  function onOutsideClick(e) {
    if (cardEl && !cardEl.contains(e.target)) {
      removeCard();
      document.removeEventListener('mousedown', onOutsideClick, { capture: true });
    }
  }

  function removeCard() {
    cardEl?.remove();
    cardEl = null;
    document.removeEventListener('mousedown', onOutsideClick, { capture: true });
  }

  // ══════════════════════════════════════════════════════════════
  // SUMMARY PANEL
  // ══════════════════════════════════════════════════════════════

  function toggleSummary() {
    if (summaryEl) { removeSummary(); return; }
    showSummary();
  }

  function showSummary() {
    removeSummary();
    const panel = document.createElement('div');
    panel.className = 'csc-summary';
    panel.id = 'csc-summary';

    const items = issues.map(iss => {
      const color = TYPE_COLORS[iss.type] || '#999';
      const originalText = field ? getFieldText(field).slice(iss.offset, iss.offset + iss.length) : '';
      return `<div class="csc-summary-item" data-id="${iss.id}">
        <span class="csc-summary-dot" style="background:${color}"></span>
        <div class="csc-summary-text">
          <div class="csc-summary-original">${escHtml(originalText)}</div>
          <div class="csc-summary-msg">${escHtml(iss.shortMessage)}</div>
        </div>
      </div>`;
    }).join('');

    panel.innerHTML = `
      <div class="csc-summary-header">
        <span>${issues.length} issue${issues.length !== 1 ? 's' : ''}</span>
        <button class="csc-summary-close">✕</button>
      </div>
      <div class="csc-summary-list">${items || '<div class="csc-summary-empty">✓ No issues found</div>'}</div>`;

    // Position above/beside the badge
    const bRect = badgeEl?.getBoundingClientRect();
    if (bRect) {
      const pw = 300, ph = 380;
      let top  = bRect.bottom + 6;
      let left = bRect.right  - pw;
      top  = clamp(top,  4, window.innerHeight - ph - 4);
      left = clamp(left, 4, window.innerWidth  - pw - 4);
      panel.style.top  = top  + 'px';
      panel.style.left = left + 'px';
    }

    panel.querySelector('.csc-summary-close').addEventListener('click', removeSummary);
    panel.querySelectorAll('.csc-summary-item').forEach(item => {
      item.addEventListener('click', () => {
        const iss = issues.find(i => i.id === item.dataset.id);
        if (!iss) return;
        removeSummary();
        focusIssueInField(iss);
        // Find click coords from badge as a fallback
        const bR = badgeEl?.getBoundingClientRect();
        const cx = bR ? bR.left + bR.width / 2 : window.innerWidth / 2;
        const cy = bR ? bR.top  : window.innerHeight / 2;
        showCard(iss, cx, cy);
      });
    });

    document.documentElement.appendChild(panel);
    summaryEl = panel;
  }

  function removeSummary() {
    summaryEl?.remove();
    summaryEl = null;
  }

  function focusIssueInField(iss) {
    if (!field) return;
    if (fieldType !== 'ce') {
      field.focus();
      field.setSelectionRange(iss.offset, iss.offset + iss.length);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // APPLY FIX / IGNORE / DICTIONARY
  // ══════════════════════════════════════════════════════════════

  function applyFix(iss, replacement) {
    if (!field) return;
    removeCard();

    const delta = replacement.length - iss.length;

    if (fieldType === 'ce') {
      const range = getRangeForOffset(field, iss.offset, iss.length);
      if (range) {
        // Focus the field first — required for execCommand and prevents premature detach
        field.focus();
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        try {
          isApplyingFix = true;
          // execCommand fires proper input events that React/Draft.js editors expect
          const applied = document.execCommand('insertText', false, replacement);
          isApplyingFix = false;
          if (!applied) {
            // Fallback: direct DOM manipulation for non-React CEs
            range.deleteContents();
            range.insertNode(document.createTextNode(replacement));
            field.normalize();
          }
        } catch (_) {
          isApplyingFix = false;
          try {
            range.deleteContents();
            range.insertNode(document.createTextNode(replacement));
            field.normalize();
          } catch (_2) {}
        }
        setCECursorToEnd(field);
      }
      issues = issues
        .filter(i => i.id !== iss.id)
        .map(i => i.offset > iss.offset ? { ...i, offset: i.offset + delta } : i);
      updateCEOverlays(field, issues);
      updateAfterIssueChange();
      if (autoAdvance && issues.length > 0) advanceToNextIssue(iss.offset);
      return;
    }

    // textarea / input
    const val = field.value;
    field.value = val.slice(0, iss.offset) + replacement + val.slice(iss.offset + iss.length);
    // Return cursor to end of field so writing can resume
    field.focus();
    const endPos = field.value.length;
    field.setSelectionRange(endPos, endPos);
    isApplyingFix = true;
    field.dispatchEvent(new Event('input',  { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    isApplyingFix = false;

    issues = issues
      .filter(i => i.id !== iss.id)
      .map(i => i.offset > iss.offset ? { ...i, offset: i.offset + delta } : i);

    refreshMirror();
    updateAfterIssueChange();
    if (autoAdvance && issues.length > 0) advanceToNextIssue(iss.offset);
  }

  function ignoreIssue(iss) {
    removeCard();
    issues = issues.filter(i => i.id !== iss.id);
    if (fieldType === 'ce') {
      clearCEOverlays(iss.id);
    } else {
      refreshMirror();
    }
    updateAfterIssueChange();
  }

  function addIssueToDict(iss) {
    const word = field ? getFieldText(field).slice(iss.offset, iss.offset + iss.length) : '';
    if (word) addToDictionary(word);
    // Identify all issues matching that word, then remove them
    const toRemove = issues.filter(i => {
      const w = field ? getFieldText(field).slice(i.offset, i.offset + i.length) : '';
      return w.toLowerCase() === word.toLowerCase();
    });
    issues = issues.filter(i => !toRemove.includes(i));
    removeCard();
    if (fieldType === 'ce') {
      toRemove.forEach(i => clearCEOverlays(i.id));
    } else {
      refreshMirror();
    }
    updateAfterIssueChange();
  }

  // Advance card to the next issue in document order after fromOffset.
  // Used when autoAdvance is enabled after applying a fix.
  function advanceToNextIssue(fromOffset) {
    if (!issues.length) return;
    const sorted = [...issues].sort((a, b) => a.offset - b.offset);
    // Pick first issue at or after the fixed position; wrap to beginning if none
    const next = sorted.find(i => i.offset >= fromOffset) || sorted[0];
    let cx, cy;
    if (fieldType === 'ce') {
      const divs = ceOverlayEls[next.id];
      if (divs && divs.length) {
        const r = divs[0].getBoundingClientRect();
        cx = r.left;
        cy = r.bottom;
      } else {
        const fr = field.getBoundingClientRect();
        cx = fr.left + 40; cy = fr.top + 20;
      }
    } else {
      const span = mirrorEl?.querySelector(`[data-id="${next.id}"]`);
      if (span) {
        const r = span.getBoundingClientRect();
        cx = r.left; cy = r.bottom;
      } else {
        const fr = field.getBoundingClientRect();
        cx = fr.left + 40; cy = fr.top + 20;
      }
    }
    showCard(next, cx, cy);
  }

  function updateAfterIssueChange() {
    if (issues.length === 0) {
      setBadgeState('clean');
    } else {
      setBadgeState('errors', issues.length);
    }
    if (summaryEl) showSummary(); // re-render summary
  }

  // ══════════════════════════════════════════════════════════════
  // CHECK ORCHESTRATION
  // ══════════════════════════════════════════════════════════════

  function triggerCheck() {
    if (!field || isChecking) return;
    if (!isContextAlive()) { detachFromField(); return; }

    const text = getFieldText(field);
    if (!text.trim()) { setBadgeState('clean'); return; }

    isChecking = true;
    isDirty    = false;
    setBadgeState('checking');
    removeCard();
    removeSummary();

    try {
      chrome.runtime.sendMessage({ type: 'CHECK_TEXT', text }, res => {
        isChecking = false;
        if (!isContextAlive()) return;
        if (chrome.runtime.lastError || !res) {
          setBadgeState('error');
          badgeEl && (badgeEl.title = chrome.runtime.lastError?.message || 'Extension error');
          return;
        }
        if (!res.ok) {
          setBadgeState('error');
          badgeEl && (badgeEl.title = res.error || 'Check failed');
          return;
        }
        issues = res.issues || [];
        if (fieldType === 'ce') {
          updateCEOverlays(field, issues);
        } else {
          refreshMirror();
        }
        if (issues.length === 0) {
          setBadgeState('clean');
        } else {
          setBadgeState('errors', issues.length);
        }
      });
    } catch (_) {
      isChecking = false;
      setBadgeState('error');
    }
  }

  // ══════════════════════════════════════════════════════════════
  // FIELD LIFECYCLE
  // ══════════════════════════════════════════════════════════════

  function attachToField(el) {
    if (el === field) return;
    detachFromField();

    fieldType = detectFieldType(el);
    if (!fieldType) return;
    field     = el;
    issues    = [];
    isDirty   = false;

    badgeEl = createBadge();
    positionBadge();

    if (fieldType !== 'ce') {
      mirrorEl = createMirror(el);
    }

    // Click handler: hit-test issues for textarea/input via selectionStart.
    // For CE, overlay divs handle their own clicks directly.
    el.__cscClickHandler = () => {
      if (fieldType === 'ce') {
        removeCard(); // clicking in the CE field (not on an overlay) dismisses the card
      } else {
        const pos = el.selectionStart;
        const hit = issues.find(i => pos >= i.offset && pos < i.offset + i.length);
        if (hit) {
          const span = mirrorEl?.querySelector(`[data-id="${hit.id}"]`);
          let cx = el.getBoundingClientRect().left + 40;
          let cy = el.getBoundingClientRect().top  + 20;
          if (span) { const r = span.getBoundingClientRect(); cx = r.left; cy = r.bottom; }
          showCard(hit, cx, cy);
        } else {
          removeCard();
        }
      }
    };
    el.addEventListener('click', el.__cscClickHandler);

    // Input: auto-check with debounce (LT) or just invalidate (Gemini manual)
    el.__cscInputHandler = () => {
      if (isApplyingFix) return;
      if (issues.length > 0) {
        issues = [];
        if (fieldType === 'ce') clearCEOverlays();
        else refreshMirror();
        removeCard();
        removeSummary();
      }
      if (engineMode === 'auto') {
        isDirty = false;
        setBadgeState('idle');
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => { if (field === el) triggerCheck(); }, DEBOUNCE_MS);
      } else {
        isDirty = true;
        setBadgeState('idle');
      }
    };
    el.addEventListener('input', el.__cscInputHandler);

    // Sync mirror scroll (textarea/input) or reposition CE overlays on internal scroll
    el.__cscScrollHandler = fieldType === 'ce'
      ? () => schedulePositionUpdate()
      : () => { if (mirrorEl) { mirrorEl.scrollTop = el.scrollTop; mirrorEl.scrollLeft = el.scrollLeft; } };
    el.addEventListener('scroll', el.__cscScrollHandler, { passive: true });

    // Async: determine engine mode → inline btn or initial auto-check
    loadEngineMode(mode => {
      if (field !== el) return;
      engineMode = mode;
      if (mode === 'manual') {
        inlineBtnEl = createInlineBtn();
        positionInlineBtn();
      } else if (getFieldText(el).trim()) {
        // Auto mode: check text already present when field gets focus
        debounceTimer = setTimeout(() => { if (field === el) triggerCheck(); }, 600);
      }
      setBadgeState('idle'); // update label (Auto vs Check)
    });

    // ResizeObserver to reposition badge + mirror
    resizeObs = new ResizeObserver(() => {
      schedulePositionUpdate();
    });
    resizeObs.observe(el);
  }

  function detachFromField() {
    if (!field) return;
    field.removeEventListener('click',  field.__cscClickHandler);
    field.removeEventListener('input',  field.__cscInputHandler);
    field.removeEventListener('scroll', field.__cscScrollHandler);
    if (fieldType === 'ce') clearCEOverlays();
    resizeObs?.disconnect();
    resizeObs     = null;
    clearTimeout(debounceTimer);
    debounceTimer = null;
    removeInlineBtn();
    engineMode    = 'auto';
    removeMirror();
    removeBadge();
    removeCard();
    removeSummary();
    issues   = [];
    isDirty  = false;
    field    = null;
    fieldType = null;
  }

  // ══════════════════════════════════════════════════════════════
  // POSITION UPDATE (scroll / resize)
  // ══════════════════════════════════════════════════════════════

  function schedulePositionUpdate() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = null;
      if (!field) return;
      if (mirrorEl) positionMirror(mirrorEl, field);
      if (fieldType === 'ce' && issues.length) updateCEOverlays(field, issues);
      positionBadge();
      positionInlineBtn();
    });
  }

  // ══════════════════════════════════════════════════════════════
  // GLOBAL EVENT LISTENERS
  // ══════════════════════════════════════════════════════════════

  document.addEventListener('focusin', e => {
    if (!enabled) return;
    const ft = detectFieldType(e.target);
    if (ft) attachToField(e.target);
  });

  document.addEventListener('focusout', e => {
    if (e.target !== field) return;
    // Delay so card clicks still register
    setTimeout(() => {
      if (document.activeElement !== field) detachFromField();
    }, 220);
  });

  window.addEventListener('scroll',  schedulePositionUpdate, { passive: true, capture: true });
  window.addEventListener('resize',  schedulePositionUpdate, { passive: true });

  // Keyboard shortcut (Ctrl/Cmd+Shift+Space)
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === ' ') {
      e.preventDefault();
      triggerCheck();
    }
  });

  // Listen for background command relay
  chrome.runtime.onMessage.addListener((msg) => {
    if (!isContextAlive()) return;
    if (msg.type === 'TRIGGER_CHECK') triggerCheck();
  });

  // ══════════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════════

  isEnabledOnSite(v => {
    enabled = v;
    if (!enabled) return;
    // Attach to already-focused element (e.g. page loaded with autofocus)
    const active = document.activeElement;
    if (active && detectFieldType(active)) attachToField(active);
  });

  // Load autoAdvance preference on startup
  getSettings(s => { autoAdvance = s.autoAdvance !== false; });

  // Re-check enabled state and engine mode when storage changes
  chrome.storage.onChanged.addListener(() => {
    if (!isContextAlive()) return;
    getSettings(s => { autoAdvance = s.autoAdvance !== false; });
    isEnabledOnSite(v => {
      enabled = v;
      if (!enabled) { detachFromField(); return; }
      if (!field) return;
      // Live engine mode switch (e.g. user just added/removed Gemini key)
      loadEngineMode(mode => {
        if (!field) return;
        const prev = engineMode;
        engineMode = mode;
        if (prev === mode) return;
        if (mode === 'manual') {
          clearTimeout(debounceTimer);
          if (!inlineBtnEl) { inlineBtnEl = createInlineBtn(); positionInlineBtn(); }
        } else {
          removeInlineBtn();
        }
        setBadgeState('idle');
      });
    });
  });

})();
