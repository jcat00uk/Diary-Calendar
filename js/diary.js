/** Chronicle — Diary area init, autosave, and global rich-text toolbar */

const _debounceTimers = new Map();

function debounce(key, fn, delay) {
  clearTimeout(_debounceTimers.get(key));
  _debounceTimers.set(key, setTimeout(() => {
    _debounceTimers.delete(key);
    fn();
  }, delay));
}

/** Get the diary HTML/text for a date key from the data model */
export function getDiaryText(data, dateKey) {
  return data?.days?.[dateKey]?.diary ?? '';
}

/**
 * Attach contenteditable behaviour and autosave to a diary area element.
 * opts: { placeholder, ariaLabel, onSaved, onFocus }
 */
export function initDiaryArea(el, getTextFn, setTextFn, opts = {}) {
  el.setAttribute('contenteditable', 'true');
  el.setAttribute('data-placeholder', opts.placeholder ?? 'Tap to write…');
  el.setAttribute('aria-label', opts.ariaLabel ?? 'Diary entry');
  el.setAttribute('spellcheck', 'true');
  el.setAttribute('role', 'textbox');
  el.setAttribute('aria-multiline', 'true');

  // Load existing content — detect legacy plain-text vs stored HTML
  const existing = getTextFn();
  if (existing) {
    if (/<[a-z]/i.test(existing)) {
      el.innerHTML = existing;
    } else {
      el.textContent = existing;
    }
  }

  // Use <br> for newlines so line-height stays uniform and text aligns to ruled lines
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.execCommand('insertLineBreak');
    }
  });

  el.addEventListener('input', () => {
    const html = el.innerHTML;
    debounce(el, () => {
      setTextFn(html);
      opts.onSaved?.();
    }, 800);
  });

  el.addEventListener('focus', () => opts.onFocus?.());

  // Prevent card tap-to-expand when touching the diary area
  el.addEventListener('click',       e => e.stopPropagation());
  el.addEventListener('mousedown',   e => e.stopPropagation());
  el.addEventListener('pointerdown', e => e.stopPropagation());
}

// ── Global format toolbar singleton ───────────────────────────────────────

let _toolbar        = null;
let _activeEditable = null;
let _lastTextColor  = '#1a1a18';
let _lastHiColor    = '#FFF176';

// Recent text colours — last 5 picks, seeded with defaults
let _recentTextColors = ['#1a1a18','#6b6a66','#E24B4A','#185FA5','#27500A'];
const HI_COLORS = ['#FFF176','#B9F6CA','#BBDEFB','#FCE4EC','#FFE0B2','#E1BEE7'];

function _addRecentTextColor(color) {
  _recentTextColors = [color, ..._recentTextColors.filter(c => c !== color)].slice(0, 5);
}

/** Return a vivid opening colour for <input type="color">.
 *  If the hex is dark (low brightness) or desaturated (near grey),
 *  fall back to red so the picker opens at full S+V. */
function _vividDefault(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return '#FF0000';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 100 || max - min < 30) return '#ff0000';
  return hex.toLowerCase();
}

/** Apply an execCommand without blurring the diary area */
function _exec(cmd, value = null) {
  if (!_activeEditable) return;
  _activeEditable.focus();
  document.execCommand(cmd, false, value);
}

/** Show a colour swatch popup above the toolbar anchored near anchorEl */
function _showColorPicker(anchorEl, colors, onPick) {
  document.querySelectorAll('.fmt-color-picker').forEach(p => p.remove());

  const picker = document.createElement('div');
  picker.className = 'fmt-color-picker';
  colors.forEach(c => {
    const sw = document.createElement('button');
    sw.className = 'fmt-swatch';
    sw.style.background = c;
    sw.setAttribute('aria-label', c);
    // mousedown: prevent blur on desktop
    sw.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      onPick(c);
      picker.remove();
    });
    // touchend: mobile
    sw.addEventListener('touchend', e => {
      e.preventDefault();
      e.stopPropagation();
      onPick(c);
      picker.remove();
    });
    picker.appendChild(sw);
  });

  document.body.appendChild(picker);

  // Position above the toolbar so it clears the keyboard
  const toolbarRect = _toolbar.getBoundingClientRect();
  const btnRect     = anchorEl.getBoundingClientRect();
  picker.style.bottom = `${window.innerHeight - toolbarRect.top + 4}px`;

  // Horizontal: align with button, clamp inside app-wrapper
  requestAnimationFrame(() => {
    const pw  = picker.offsetWidth;
    const aw  = document.getElementById('appWrapper');
    const awR = aw ? aw.getBoundingClientRect() : { left: 4, right: window.innerWidth - 4 };
    const idealLeft = btnRect.left;
    picker.style.left = `${Math.max(awR.left + 4, Math.min(idealLeft, awR.right - pw - 4))}px`;
  });

  // Close when tapping outside
  const away = e => {
    if (!picker.contains(e.target) && !anchorEl.contains(e.target)) {
      picker.remove();
      document.removeEventListener('pointerdown', away, true);
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', away, true), 50);
}

/** Show text-colour picker: 5 recent swatches + a native colour input button */
function _showTextColorPicker(anchorEl, onPick) {
  document.querySelectorAll('.fmt-color-picker').forEach(p => p.remove());

  const picker = document.createElement('div');
  picker.className = 'fmt-color-picker';

  _recentTextColors.forEach(c => {
    const sw = document.createElement('button');
    sw.className = 'fmt-swatch';
    sw.style.background = c;
    sw.setAttribute('aria-label', c);
    sw.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); onPick(c); picker.remove(); });
    sw.addEventListener('touchend',  e => { e.preventDefault(); e.stopPropagation(); onPick(c); picker.remove(); });
    picker.appendChild(sw);
  });

  // Custom colour — built via innerHTML so the value attribute is part of the parsed HTML,
  // which is the only reliable way to set the opening colour on Android colour pickers.
  const startColor = _vividDefault(_lastTextColor);
  const customWrap = document.createElement('div');
  customWrap.innerHTML =
    `<input type="color" value="${startColor}"
            class="fmt-swatch fmt-swatch--custom"
            aria-label="Choose custom colour"
            title="Custom colour">`;
  const customInput = customWrap.querySelector('input');
  customInput.addEventListener('change', () => {
    onPick(customInput.value);
    picker.remove();
  });
  customInput.addEventListener('mousedown', e => e.preventDefault());
  picker.appendChild(customInput);

  document.body.appendChild(picker);

  const toolbarRect = _toolbar.getBoundingClientRect();
  const btnRect     = anchorEl.getBoundingClientRect();
  picker.style.bottom = `${window.innerHeight - toolbarRect.top + 4}px`;

  requestAnimationFrame(() => {
    const pw  = picker.offsetWidth;
    const aw  = document.getElementById('appWrapper');
    const awR = aw ? aw.getBoundingClientRect() : { left: 4, right: window.innerWidth - 4 };
    picker.style.left = `${Math.max(awR.left + 4, Math.min(btnRect.left, awR.right - pw - 4))}px`;
  });

  const away = e => {
    if (!picker.contains(e.target) && !anchorEl.contains(e.target)) {
      picker.remove();
      document.removeEventListener('pointerdown', away, true);
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', away, true), 50);
}

/**
 * Create the global format toolbar once. Call from app init().
 */
export function initFormatToolbar() {
  if (_toolbar) return;

  _toolbar = document.createElement('div');
  _toolbar.className = 'format-toolbar';
  _toolbar.setAttribute('role', 'toolbar');
  _toolbar.setAttribute('aria-label', 'Text formatting');

  _toolbar.innerHTML = `
    <button class="fmt-btn" data-cmd="bold"      title="Bold"><b>B</b></button>
    <button class="fmt-btn" data-cmd="italic"    title="Italic"><i>I</i></button>
    <button class="fmt-btn" data-cmd="underline" title="Underline"><u>U</u></button>
    <div class="fmt-sep"></div>
    <div class="fmt-compound" title="Highlight (hold for colours)">
      <button class="fmt-btn fmt-apply" id="fmtHiApply" aria-label="Highlight">
        <span class="fmt-compound-icon">
          <span class="fmt-compound-letter">A</span>
          <span class="fmt-compound-bar" id="fmtHiBar" style="background:${_lastHiColor}"></span>
        </span>
      </button>
      <button class="fmt-btn fmt-pick" id="fmtHiPick" aria-label="Choose highlight colour">▾</button>
    </div>
    <div class="fmt-compound" title="Text colour (hold for colours)">
      <button class="fmt-btn fmt-apply" id="fmtClrApply" aria-label="Text colour">
        <span class="fmt-compound-icon">
          <span class="fmt-compound-letter" id="fmtClrLetter" style="color:${_lastTextColor}">A</span>
          <span class="fmt-compound-bar" id="fmtClrBar" style="background:${_lastTextColor}"></span>
        </span>
      </button>
      <button class="fmt-btn fmt-pick" id="fmtClrPick" aria-label="Choose text colour">▾</button>
    </div>
    <div class="fmt-sep"></div>
    <button class="fmt-btn" data-cmd="removeFormat" title="Clear formatting">✕</button>
  `;

  document.body.appendChild(_toolbar);

  // ── Helper: make a compound main button work (tap = apply, hold = picker) ──
  function _compoundApply(applyBtn, getColor, onApply, pickerColors, onPickerSelect) {
    let timer = null;
    let fired = false;
    let startX = 0, startY = 0;

    applyBtn.addEventListener('pointerdown', e => {
      e.preventDefault();
      fired = false;
      startX = e.clientX;
      startY = e.clientY;
      timer = setTimeout(() => {
        fired = true;
        timer = null;
        if (applyBtn._openCustomPicker) {
          applyBtn._openCustomPicker();
        } else {
          _showColorPicker(applyBtn, pickerColors, c => {
            onPickerSelect(c);
            _updateActiveStates();
          });
        }
      }, 480);
    });

    applyBtn.addEventListener('pointerup', () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        if (!fired) {
          _exec(...onApply());
          _updateActiveStates();
        }
      }
    });

    applyBtn.addEventListener('pointercancel', () => {
      clearTimeout(timer);
      timer = null;
    });

    applyBtn.addEventListener('pointermove', e => {
      if (!timer) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      // only cancel long-press if finger has actually drifted (8px²)
      if (dx * dx + dy * dy > 64) {
        clearTimeout(timer);
        timer = null;
      }
    });
  }

  // ── Helper: make a picker arrow button open immediately ──
  function _compoundPick(pickBtn, pickerColors, onPickerSelect) {
    const open = e => {
      e.preventDefault();
      _showColorPicker(pickBtn, pickerColors, c => {
        onPickerSelect(c);
        _updateActiveStates();
      });
    };
    pickBtn.addEventListener('mousedown', open);
    pickBtn.addEventListener('touchend',  open);
  }

  // ── Highlight ──
  _compoundApply(
    _toolbar.querySelector('#fmtHiApply'),
    () => _lastHiColor,
    () => { return ['backColor', _lastHiColor]; },
    HI_COLORS,
    c => {
      _lastHiColor = c;
      _toolbar.querySelector('#fmtHiBar').style.background = c;
      _exec('backColor', c);
    }
  );
  _compoundPick(
    _toolbar.querySelector('#fmtHiPick'),
    HI_COLORS,
    c => {
      _lastHiColor = c;
      _toolbar.querySelector('#fmtHiBar').style.background = c;
      if (_activeEditable) { _activeEditable.focus(); _exec('backColor', c); }
    }
  );

  // ── Text colour ──
  function _applyTextColor(c) {
    _addRecentTextColor(c);
    _lastTextColor = c;
    _toolbar.querySelector('#fmtClrBar').style.background = c;
    _toolbar.querySelector('#fmtClrLetter').style.color  = c;
  }

  _compoundApply(
    _toolbar.querySelector('#fmtClrApply'),
    () => _lastTextColor,
    () => { return ['foreColor', _lastTextColor]; },
    null, // unused — long-press opens custom picker instead
    c => { _applyTextColor(c); _exec('foreColor', c); }
  );

  // Override the long-press picker for text colour to use the recent+custom picker
  const clrApplyBtn = _toolbar.querySelector('#fmtClrApply');
  clrApplyBtn._openCustomPicker = () => {
    _showTextColorPicker(clrApplyBtn, c => {
      _applyTextColor(c);
      if (_activeEditable) { _activeEditable.focus(); _exec('foreColor', c); }
      _updateActiveStates();
    });
  };

  // Picker arrow also opens recent+custom picker
  const clrPickBtn = _toolbar.querySelector('#fmtClrPick');
  const openClrPicker = e => {
    e.preventDefault();
    _showTextColorPicker(clrPickBtn, c => {
      _applyTextColor(c);
      if (_activeEditable) { _activeEditable.focus(); _exec('foreColor', c); }
      _updateActiveStates();
    });
  };
  clrPickBtn.addEventListener('mousedown', openClrPicker);
  clrPickBtn.addEventListener('touchend',  openClrPicker);

  // ── Bold / Italic / Underline / Clear (mousedown + touchend) ──
  _toolbar.addEventListener('mousedown', e => {
    const btn = e.target.closest('[data-cmd]');
    if (!btn) return;
    e.preventDefault();
    _exec(btn.dataset.cmd, btn.dataset.value ?? null);
    _updateActiveStates();
  });
  _toolbar.addEventListener('touchend', e => {
    const btn = e.target.closest('[data-cmd]');
    if (!btn) return;
    e.preventDefault();
    _exec(btn.dataset.cmd, btn.dataset.value ?? null);
    _updateActiveStates();
  });

  // ── Show/hide on diary focus ──
  document.addEventListener('focusin', e => {
    const target = e.target;
    if (!target.isContentEditable) return;
    if (!target.closest('.diary-area, .expanded-diary-area')) return;
    _activeEditable = target;
    _toolbar.classList.add('visible');
    document.getElementById('weekContainer')?.classList.add('toolbar-open');
    _updateActiveStates();
  });

  document.addEventListener('focusout', () => {
    setTimeout(() => {
      const f = document.activeElement;
      if (f && (f.isContentEditable || f.closest('.format-toolbar, .fmt-color-picker'))) return;
      _toolbar.classList.remove('visible');
      document.getElementById('weekContainer')?.classList.remove('toolbar-open');
      _activeEditable = null;
      document.querySelectorAll('.fmt-color-picker').forEach(p => p.remove());
    }, 150);
  });

  document.addEventListener('selectionchange', () => {
    if (_activeEditable) _updateActiveStates();
  });

  // ── Keep toolbar above the software keyboard (visual viewport) ──
  if (window.visualViewport) {
    const reposition = () => {
      const vv = window.visualViewport;
      const bottom = Math.max(0, window.innerHeight - vv.offsetTop - vv.height);
      _toolbar.style.bottom = `${bottom}px`;
    };
    window.visualViewport.addEventListener('resize', reposition);
    window.visualViewport.addEventListener('scroll', reposition);
  }
}

function _updateActiveStates() {
  if (!_toolbar) return;
  ['bold', 'italic', 'underline'].forEach(cmd => {
    const btn = _toolbar.querySelector(`[data-cmd="${cmd}"]`);
    if (btn) btn.classList.toggle('active', document.queryCommandState(cmd));
  });
}
