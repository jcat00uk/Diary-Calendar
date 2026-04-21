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

const HI_COLORS = [
  '#FFF176','#B9F6CA','#BBDEFB','#FCE4EC','#FFE0B2','#E1BEE7',
  '#F8BBD0','#C8E6C9','#B3E5FC','#FFFDE7','#F3E5F5','#E8EAF6',
];

const TEXT_PRESET_COLORS = [
  '#1a1a18','#6b6a66','#9b9994','#E24B4A','#d4621a','#c49b00',
  '#185FA5','#0d3d6e','#27500A','#2d8a4e','#6d3a9c','#7d4e24',
];

let _recentHiColors = [];

function _addRecentTextColor(color) {
  _recentTextColors = [color, ..._recentTextColors.filter(c => c !== color)].slice(0, 5);
}

function _addRecentHiColor(color) {
  _recentHiColors = [color, ..._recentHiColors.filter(c => c !== color)].slice(0, 5);
}

// ── Colour utilities ───────────────────────────────────────────────────────

function _hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function _rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

function _rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if      (max === r) h = ((g - b) / d % 6) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else                h = ((r - g) / d + 4) * 60;
    if (h < 0) h += 360;
  }
  return { h: Math.round(h), s: max === 0 ? 0 : d / max, v: max };
}

function _hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r, g, b;
  if      (h < 60)  { r=c; g=x; b=0; }
  else if (h < 120) { r=x; g=c; b=0; }
  else if (h < 180) { r=0; g=c; b=x; }
  else if (h < 240) { r=0; g=x; b=c; }
  else if (h < 300) { r=x; g=0; b=c; }
  else              { r=c; g=0; b=x; }
  return { r: Math.round((r+m)*255), g: Math.round((g+m)*255), b: Math.round((b+m)*255) };
}

/** Apply an execCommand without blurring the diary area */
function _exec(cmd, value = null) {
  if (!_activeEditable) return;
  _activeEditable.focus();
  document.execCommand(cmd, false, value);
}

// ── Picker helpers ─────────────────────────────────────────────────────────

function _makeSwatch(color, onClick) {
  const sw = document.createElement('button');
  sw.className = 'fmt-swatch';
  sw.style.background = color;
  sw.setAttribute('aria-label', color);
  sw.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); onClick(); });
  sw.addEventListener('touchend',  e => { e.preventDefault(); e.stopPropagation(); onClick(); });
  return sw;
}

function _positionPicker(picker, anchorEl) {
  const toolbarRect = _toolbar.getBoundingClientRect();
  picker.style.bottom    = `${window.innerHeight - toolbarRect.top + 4}px`;
  picker.style.maxHeight = `${toolbarRect.top - 8}px`;
  requestAnimationFrame(() => {
    const pw  = picker.offsetWidth;
    const aw  = document.getElementById('appWrapper');
    const awR = aw ? aw.getBoundingClientRect() : { left: 4, right: window.innerWidth - 4 };
    const r   = anchorEl.getBoundingClientRect();
    picker.style.left = `${Math.max(awR.left + 4, Math.min(r.left, awR.right - pw - 4))}px`;
  });
}

// ── HSV canvas picker — built lazily into a container element ──────────────

function _buildHsvCanvas(container, initialHex, onApply, onCancel) {
  const W = 200, H = 120, HW = 200;
  const rgb0 = _hexToRgb(initialHex);
  let hsv = _rgbToHsv(rgb0.r, rgb0.g, rgb0.b);
  let currentHex = initialHex;

  container.innerHTML = `
    <div class="fmt-hsv-canvas-wrap">
      <canvas class="fmt-hsv-canvas" width="${W}" height="${H}"></canvas>
      <div class="fmt-hsv-dot"></div>
    </div>
    <div class="fmt-hue-wrap">
      <canvas class="fmt-hue-bar" width="${HW}" height="16"></canvas>
      <div class="fmt-hue-cursor"></div>
    </div>
    <div class="fmt-hsv-preview">
      <div class="fmt-hsv-swatch" style="background:${initialHex}"></div>
      <input class="fmt-hex-input" type="text" maxlength="7"
             value="${initialHex.toUpperCase()}" spellcheck="false" autocomplete="off">
    </div>
    <div class="fmt-hsv-actions">
      <button class="fmt-hsv-cancel">Cancel</button>
      <button class="fmt-hsv-apply">Apply</button>
    </div>
  `;

  const canvas  = container.querySelector('.fmt-hsv-canvas');
  const ctx     = canvas.getContext('2d');
  const dot     = container.querySelector('.fmt-hsv-dot');
  const hueBar  = container.querySelector('.fmt-hue-bar');
  const hueCtx  = hueBar.getContext('2d');
  const hueCur  = container.querySelector('.fmt-hue-cursor');
  const swatch  = container.querySelector('.fmt-hsv-swatch');
  const hexIn   = container.querySelector('.fmt-hex-input');

  function drawHue() {
    const g = hueCtx.createLinearGradient(0, 0, HW, 0);
    for (let i = 0; i <= 360; i += 10) g.addColorStop(i / 360, `hsl(${i},100%,50%)`);
    hueCtx.fillStyle = g;
    hueCtx.fillRect(0, 0, HW, 16);
  }

  function drawGradient() {
    ctx.clearRect(0, 0, W, H);
    const gH = ctx.createLinearGradient(0, 0, W, 0);
    gH.addColorStop(0, '#fff');
    gH.addColorStop(1, `hsl(${hsv.h},100%,50%)`);
    ctx.fillStyle = gH; ctx.fillRect(0, 0, W, H);
    const gV = ctx.createLinearGradient(0, 0, 0, H);
    gV.addColorStop(0, 'rgba(0,0,0,0)');
    gV.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = gV; ctx.fillRect(0, 0, W, H);
  }

  function syncDisplay() {
    const rgb2 = _hsvToRgb(hsv.h, hsv.s, hsv.v);
    currentHex = _rgbToHex(rgb2.r, rgb2.g, rgb2.b);
    swatch.style.background = currentHex;
    hexIn.value = currentHex.toUpperCase();
    dot.style.left = (Math.round(hsv.s * (W - 1)) - 5) + 'px';
    dot.style.top  = (Math.round((1 - hsv.v) * (H - 1)) - 5) + 'px';
    hueCur.style.left = (Math.round((hsv.h / 360) * (HW - 1)) - 5) + 'px';
  }

  drawHue();
  drawGradient();
  syncDisplay();

  let draggingCanvas = false, draggingHue = false;
  const stopDrag = () => { draggingCanvas = false; draggingHue = false; };

  function onCanvasMove(e) {
    if (!draggingCanvas) return;
    const rect = canvas.getBoundingClientRect();
    hsv.s = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    hsv.v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top)  / rect.height));
    syncDisplay();
  }

  function onHueMove(e) {
    if (!draggingHue) return;
    const rect = hueBar.getBoundingClientRect();
    hsv.h = Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * 360);
    drawGradient();
    syncDisplay();
  }

  canvas.addEventListener('pointerdown',   e => { e.preventDefault(); draggingCanvas = true; canvas.setPointerCapture(e.pointerId); onCanvasMove(e); });
  canvas.addEventListener('pointermove',   onCanvasMove);
  canvas.addEventListener('pointerup',     stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);

  hueBar.addEventListener('pointerdown',   e => { e.preventDefault(); draggingHue = true; hueBar.setPointerCapture(e.pointerId); onHueMove(e); });
  hueBar.addEventListener('pointermove',   onHueMove);
  hueBar.addEventListener('pointerup',     stopDrag);
  hueBar.addEventListener('pointercancel', stopDrag);

  hexIn.addEventListener('mousedown', e => e.stopPropagation());
  hexIn.addEventListener('input', () => {
    const v = hexIn.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      const rgb2 = _hexToRgb(v);
      hsv = _rgbToHsv(rgb2.r, rgb2.g, rgb2.b);
      drawGradient();
      syncDisplay();
    }
  });

  const cancelBtn = container.querySelector('.fmt-hsv-cancel');
  const applyBtn  = container.querySelector('.fmt-hsv-apply');
  cancelBtn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
  cancelBtn.addEventListener('click',     e => { e.stopPropagation(); onCancel(); });
  applyBtn.addEventListener('mousedown',  e => { e.preventDefault(); e.stopPropagation(); });
  applyBtn.addEventListener('click',      e => { e.stopPropagation(); onApply(currentHex); });
}

// ── Text colour picker ─────────────────────────────────────────────────────

function _showTextColorPicker(anchorEl, onPick) {
  document.querySelectorAll('.fmt-color-picker').forEach(p => p.remove());

  const picker = document.createElement('div');
  picker.className = 'fmt-color-picker';

  // Recent row
  const recentLbl = document.createElement('div');
  recentLbl.className = 'fmt-picker-label';
  recentLbl.textContent = 'Recent';
  picker.appendChild(recentLbl);
  const recentRow = document.createElement('div');
  recentRow.className = 'fmt-picker-row';
  _recentTextColors.forEach(c => recentRow.appendChild(_makeSwatch(c, () => { onPick(c); picker.remove(); })));
  picker.appendChild(recentRow);

  // Preset rows (two rows of 6)
  const colourLbl = document.createElement('div');
  colourLbl.className = 'fmt-picker-label';
  colourLbl.textContent = 'Colours';
  picker.appendChild(colourLbl);
  [TEXT_PRESET_COLORS.slice(0, 6), TEXT_PRESET_COLORS.slice(6)].forEach(group => {
    const row = document.createElement('div');
    row.className = 'fmt-picker-row';
    group.forEach(c => row.appendChild(_makeSwatch(c, () => { onPick(c); picker.remove(); })));
    picker.appendChild(row);
  });

  // More colours button → lazy HSV section
  const moreBtn = document.createElement('button');
  moreBtn.className = 'fmt-more-btn';
  moreBtn.textContent = 'More colours \u25be';
  moreBtn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
  moreBtn.addEventListener('click', e => {
    e.stopPropagation();
    hsvSection.style.display = 'flex';
    moreBtn.style.display = 'none';
    if (!hsvSection.dataset.built) {
      hsvSection.dataset.built = '1';
      _buildHsvCanvas(
        hsvSection,
        _lastTextColor,
        hex => { onPick(hex); picker.remove(); },
        ()  => { hsvSection.style.display = 'none'; moreBtn.style.display = ''; _positionPicker(picker, anchorEl); }
      );
    }
    _positionPicker(picker, anchorEl);
  });
  picker.appendChild(moreBtn);

  const hsvSection = document.createElement('div');
  hsvSection.className = 'fmt-hsv-section';
  hsvSection.style.display = 'none';
  picker.appendChild(hsvSection);

  document.body.appendChild(picker);
  _positionPicker(picker, anchorEl);

  const away = e => {
    if (!picker.contains(e.target) && !anchorEl.contains(e.target)) {
      picker.remove();
      document.removeEventListener('pointerdown', away, true);
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', away, true), 50);
}

// ── Highlight colour picker ────────────────────────────────────────────────

function _showHiColorPicker(anchorEl, onPick) {
  document.querySelectorAll('.fmt-color-picker').forEach(p => p.remove());

  const picker = document.createElement('div');
  picker.className = 'fmt-color-picker';

  if (_recentHiColors.length > 0) {
    const lbl = document.createElement('div');
    lbl.className = 'fmt-picker-label';
    lbl.textContent = 'Recent';
    picker.appendChild(lbl);
    const row = document.createElement('div');
    row.className = 'fmt-picker-row';
    _recentHiColors.forEach(c => row.appendChild(_makeSwatch(c, () => { onPick(c); picker.remove(); })));
    picker.appendChild(row);
  }

  const lbl = document.createElement('div');
  lbl.className = 'fmt-picker-label';
  lbl.textContent = 'Highlight';
  picker.appendChild(lbl);

  for (let i = 0; i < HI_COLORS.length; i += 6) {
    const row = document.createElement('div');
    row.className = 'fmt-picker-row';
    HI_COLORS.slice(i, i + 6).forEach(c => row.appendChild(_makeSwatch(c, () => { onPick(c); picker.remove(); })));
    picker.appendChild(row);
  }

  document.body.appendChild(picker);
  _positionPicker(picker, anchorEl);

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
  const hiApplyBtn = _toolbar.querySelector('#fmtHiApply');
  const hiPickBtn  = _toolbar.querySelector('#fmtHiPick');

  const _applyHiColor = c => {
    _addRecentHiColor(c);
    _lastHiColor = c;
    _toolbar.querySelector('#fmtHiBar').style.background = c;
  };

  _compoundApply(
    hiApplyBtn,
    () => _lastHiColor,
    () => ['backColor', _lastHiColor],
    null,
    c => { _applyHiColor(c); _exec('backColor', c); }
  );

  hiApplyBtn._openCustomPicker = () => {
    _showHiColorPicker(hiApplyBtn, c => {
      _applyHiColor(c);
      if (_activeEditable) { _activeEditable.focus(); _exec('backColor', c); }
      _updateActiveStates();
    });
  };

  const openHiPicker = e => {
    e.preventDefault();
    _showHiColorPicker(hiPickBtn, c => {
      _applyHiColor(c);
      if (_activeEditable) { _activeEditable.focus(); _exec('backColor', c); }
      _updateActiveStates();
    });
  };
  hiPickBtn.addEventListener('mousedown', openHiPicker);
  hiPickBtn.addEventListener('touchend',  openHiPicker);

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
    if (!target.closest('.diary-area, .expanded-diary-area, .event-title-input')) return;
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
