/** Chronicle — Diary area initialisation and autosave */

const _debounceTimers = new Map();

/** Debounce a function call, keyed by an arbitrary token */
function debounce(key, fn, delay) {
  clearTimeout(_debounceTimers.get(key));
  _debounceTimers.set(key, setTimeout(() => {
    _debounceTimers.delete(key);
    fn();
  }, delay));
}

/** Get the diary text for a date key from the data model */
export function getDiaryText(data, dateKey) {
  return data?.days?.[dateKey]?.diary ?? '';
}

/**
 * Attach contenteditable behaviour to a diary area element.
 * @param {HTMLElement} el        The element to activate
 * @param {Function}    getTextFn () => string — returns current diary text
 * @param {Function}    setTextFn (text: string) => void — persists diary text
 * @param {Object}      opts      { placeholder, ariaLabel }
 */
export function initDiaryArea(el, getTextFn, setTextFn, opts = {}) {
  el.setAttribute('contenteditable', 'true');
  el.setAttribute('data-placeholder', opts.placeholder ?? 'Tap to write…');
  el.setAttribute('aria-label', opts.ariaLabel ?? 'Diary entry');
  el.setAttribute('spellcheck', 'true');
  el.setAttribute('role', 'textbox');
  el.setAttribute('aria-multiline', 'true');

  const existing = getTextFn();
  if (existing) el.textContent = existing;

  el.addEventListener('input', () => {
    const text = el.textContent;
    debounce(el, () => setTextFn(text), 800);
  });

  // Prevent card tap-to-expand when focus is on diary text
  el.addEventListener('click', e => e.stopPropagation());
  el.addEventListener('mousedown', e => e.stopPropagation());
  el.addEventListener('pointerdown', e => e.stopPropagation());
}
