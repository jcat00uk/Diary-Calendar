/** Chronicle — Theme editor (half-screen bottom sheet, 3 tabs + HSV picker) */

import {
  BUILTIN_UI_THEMES, BUILTIN_EVENT_THEMES, UI_THEME_GROUPS,
  applyUITheme, getEffectiveEventThemes, injectEventThemeCSS,
} from './themes.js';

// ── HSV colour conversion ──────────────────────────────────────────────────

function hsv2rgb(h, s, v) {
  const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}

function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const v = max, s = max ? d / max : 0;
  let h = 0;
  if (d) {
    if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else                h = ((r - g) / d + 4) * 60;
  }
  return [h, s, v];
}

function hex2rgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgb2hex(r, g, b) {
  return '#' + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
}

// ── Canvas drawing ─────────────────────────────────────────────────────────

function drawSV(canvas, hue) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const [hr, hg, hb] = hsv2rgb(hue, 1, 1);
  const gS = ctx.createLinearGradient(0, 0, w, 0);
  gS.addColorStop(0, 'white');
  gS.addColorStop(1, `rgb(${hr},${hg},${hb})`);
  ctx.fillStyle = gS; ctx.fillRect(0, 0, w, h);
  const gV = ctx.createLinearGradient(0, 0, 0, h);
  gV.addColorStop(0, 'rgba(0,0,0,0)');
  gV.addColorStop(1, 'black');
  ctx.fillStyle = gV; ctx.fillRect(0, 0, w, h);
}

function drawHue(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const g = ctx.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i <= 6; i++) {
    const [r, gv, b] = hsv2rgb(i * 60, 1, 1);
    g.addColorStop(i / 6, `rgb(${r},${gv},${b})`);
  }
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

// ── HSV picker overlay ─────────────────────────────────────────────────────

let _pickerCleanup = null;

function openPicker(initialHex, { onLive, onApply, onCancel } = {}) {
  if (_pickerCleanup) _pickerCleanup(true);

  const safe = /^#[0-9a-fA-F]{6}$/.test(initialHex) ? initialHex : '#888888';
  const [ir, ig, ib] = hex2rgb(safe);
  let [h, s, v] = rgb2hsv(ir, ig, ib);
  let currentHex = safe;

  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay';
  overlay.innerHTML = `
    <div class="picker-card">
      <div class="picker-sv-wrap">
        <canvas class="picker-sv" width="260" height="160"></canvas>
        <div class="picker-sv-cursor"></div>
      </div>
      <div class="picker-hue-wrap">
        <canvas class="picker-hue" width="260" height="18"></canvas>
        <div class="picker-hue-cursor"></div>
      </div>
      <div class="picker-bottom">
        <div class="picker-hex-row">
          <div class="picker-preview"></div>
          <input class="picker-hex" maxlength="7" spellcheck="false" autocomplete="off">
        </div>
        <div class="picker-actions">
          <button class="picker-cancel">Cancel</button>
          <button class="picker-apply">Apply</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const svCanvas  = overlay.querySelector('.picker-sv');
  const hueCanvas = overlay.querySelector('.picker-hue');
  const svCursor  = overlay.querySelector('.picker-sv-cursor');
  const hueCursor = overlay.querySelector('.picker-hue-cursor');
  const preview   = overlay.querySelector('.picker-preview');
  const hexInput  = overlay.querySelector('.picker-hex');

  drawHue(hueCanvas);

  const updateFromHSV = () => {
    const [r, g, b] = hsv2rgb(h, s, v);
    currentHex = rgb2hex(r, g, b);
    drawSV(svCanvas, h);
    const svW = svCanvas.offsetWidth || 260;
    const svH = svCanvas.offsetHeight || 160;
    svCursor.style.left = (s * svW) + 'px';
    svCursor.style.top  = ((1 - v) * svH) + 'px';
    hueCursor.style.left = (h / 360 * (hueCanvas.offsetWidth || 260)) + 'px';
    preview.style.background = currentHex;
    hexInput.value = currentHex;
    onLive?.(currentHex);
  };

  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  function makeDragHandler(canvas, onDrag) {
    const start = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      onDrag(clientX, clientY, rect);
    };
    canvas.addEventListener('mousedown', e => {
      start(e.clientX, e.clientY);
      const onMove = e2 => { const r = canvas.getBoundingClientRect(); onDrag(e2.clientX, e2.clientY, r); };
      const onUp   = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.touches[0];
      start(t.clientX, t.clientY);
      const onMove = e2 => { const t2 = e2.touches[0]; const r = canvas.getBoundingClientRect(); onDrag(t2.clientX, t2.clientY, r); };
      const onEnd  = () => { canvas.removeEventListener('touchmove', onMove); canvas.removeEventListener('touchend', onEnd); };
      canvas.addEventListener('touchmove', onMove, { passive: false });
      canvas.addEventListener('touchend', onEnd);
    }, { passive: false });
  }

  makeDragHandler(svCanvas, (cx, cy, rect) => {
    s = clamp((cx - rect.left) / rect.width,  0, 1);
    v = clamp(1 - (cy - rect.top) / rect.height, 0, 1);
    updateFromHSV();
  });

  makeDragHandler(hueCanvas, (cx, _cy, rect) => {
    h = clamp((cx - rect.left) / rect.width, 0, 1) * 360;
    updateFromHSV();
  });

hexInput.addEventListener('input', () => {
   let v = hexInput.value.trim();
   if (/^[0-9a-fA-F]{6}$/.test(v)) v = '#' + v;
   if (/^#[0-9a-fA-F]{6}$/.test(v)) {
     const [r, g, b] = hex2rgb(v);
     [h, s, v] = rgb2hsv(r, g, b);
     currentHex = hexInput.value = v;
     drawSV(svCanvas, h);
     const svW = svCanvas.offsetWidth || 260;
     const svH = svCanvas.offsetHeight || 160;
     svCursor.style.left = (s * svW) + 'px';
     svCursor.style.top = ((1 - v) * svH) + 'px';
     hueCursor.style.left = (h / 360 * (hueCanvas.offsetWidth || 260)) + 'px';
     preview.style.background = v;
     onLive?.(v);
   }
 });

  const cleanup = (isCancelling = false) => {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 200);
    _pickerCleanup = null;
    if (isCancelling) onCancel?.();
  };

  overlay.querySelector('.picker-cancel').addEventListener('click', () => cleanup(true));
  overlay.querySelector('.picker-apply').addEventListener('click', () => { cleanup(); onApply?.(currentHex); });

  _pickerCleanup = cleanup;
  updateFromHSV();
  requestAnimationFrame(() => overlay.classList.add('open'));
}

// ── Theme editor state ─────────────────────────────────────────────────────

let _editorSheet      = null;
let _editorBackdrop   = null;
let _originalSettings = null;
let _onEditorSave     = null;
let _editorSaved      = false;
let _settingsRef      = null;

export function isThemeEditorOpen() { return !!_editorSheet; }

export function closeThemeEditor() {
  if (_pickerCleanup) _pickerCleanup(true);
  if (!_editorSaved && _originalSettings && _settingsRef) {
    Object.assign(_settingsRef, JSON.parse(JSON.stringify(_originalSettings)));
    applyUITheme(_settingsRef);
    injectEventThemeCSS(_settingsRef);
  }
  _originalSettings = null;
  _settingsRef      = null;
  _editorSaved      = false;
  if (_editorSheet) {
    _editorSheet.classList.remove('open');
    const el = _editorSheet;
    _editorSheet = null;
    setTimeout(() => el.remove(), 300);
  }
  _editorBackdrop?.remove();
  _editorBackdrop = null;
}

export function openThemeEditor(settings, onSave) {
  if (_editorSheet) return;
  _originalSettings = JSON.parse(JSON.stringify(settings));
  _settingsRef  = settings;
  _onEditorSave = onSave;
  _editorSaved  = false;

  history.pushState({ chronicle: 'modal', modal: 'themeEditor' }, '');

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop theme-editor-backdrop';
  backdrop.addEventListener('click', () => history.back());

  const sheet = document.createElement('div');
  sheet.className = 'theme-editor-sheet';
  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="theme-editor-tabs">
      <button class="te-tab active" data-tab="presets">Presets</button>
      <button class="te-tab" data-tab="ui">UI Colours</button>
      <button class="te-tab" data-tab="events">Events</button>
    </div>
    <div class="te-panels">
      <div class="te-panel active" data-panel="presets"></div>
      <div class="te-panel" data-panel="ui"></div>
      <div class="te-panel" data-panel="events"></div>
    </div>
    <div class="te-footer">
      <button class="te-btn te-btn--cancel" id="teCancel">Cancel</button>
      <button class="te-btn te-btn--save" id="teSave">Done</button>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);
  _editorBackdrop = backdrop;
  _editorSheet    = sheet;

  const getPanel = id => sheet.querySelector(`[data-panel="${id}"]`);

  sheet.querySelectorAll('.te-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const id = tab.dataset.tab;
      sheet.querySelectorAll('.te-tab').forEach(t => t.classList.toggle('active', t === tab));
      sheet.querySelectorAll('.te-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === id));
      if (id === 'presets') renderPresetsTab(getPanel('presets'), settings);
      if (id === 'ui')      renderUITab(getPanel('ui'), settings);
      if (id === 'events')  renderEventsTab(getPanel('events'), settings);
    });
  });

  sheet.querySelector('#teCancel').addEventListener('click', () => history.back());

  sheet.querySelector('#teSave').addEventListener('click', () => {
    _editorSaved = true;
    history.back();
    _onEditorSave?.(settings);
  });

  renderPresetsTab(getPanel('presets'), settings);
  requestAnimationFrame(() => sheet.classList.add('open'));
}

// ── Presets tab ────────────────────────────────────────────────────────────

function renderPresetsTab(panel, settings) {
  const customThemes = settings.customUIThemes || [];
  const allThemes = [...BUILTIN_UI_THEMES, ...customThemes];
  const activeId  = settings.uiTheme || 'default';

  const isDark = settings.theme === 'dark';
  const customVars = settings.uiThemeCustomVars || { light: {}, dark: {} };

  panel.innerHTML = `
    <div class="te-presets-grid">
      ${allThemes.map(t => {
        const modeVars = t.id === activeId
          ? { ...t[isDark ? 'dark' : 'light'], ...(customVars[isDark ? 'dark' : 'light'] || {}) }
          : t[isDark ? 'dark' : 'light'];
        const swatchColor = modeVars['--day-header-bg'] || t.swatch || '#888';
        return `
        <div class="te-preset-item ${t.id === activeId ? 'active' : ''}" data-theme-id="${t.id}">
          <div class="te-preset-swatch" style="background:${swatchColor}">
            ${t.id === activeId ? '<span class="te-preset-check">✓</span>' : ''}
          </div>
          <div class="te-preset-name">${t.name}</div>
          ${!t.builtin ? `<button class="te-preset-delete" data-del="${t.id}" aria-label="Delete">✕</button>` : ''}
        </div>`;
      }).join('')}
    </div>
    <div class="te-presets-footer">
      <label class="te-btn te-btn--secondary">
        Import theme
        <input type="file" accept=".json" style="display:none" id="teImportTheme">
      </label>
    </div>
  `;

  panel.querySelectorAll('.te-preset-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.closest('.te-preset-delete')) return;
      const id = item.dataset.themeId;
      settings.uiTheme = id;
      settings.uiThemeCustomVars = { light: {}, dark: {} };
      applyUITheme(settings);
      panel.querySelectorAll('.te-preset-item').forEach(i => {
        i.classList.toggle('active', i === item);
        const swatch = i.querySelector('.te-preset-swatch');
        const existing = swatch?.querySelector('.te-preset-check');
        if (i === item && !existing) {
          const chk = document.createElement('span');
          chk.className = 'te-preset-check';
          chk.textContent = '✓';
          swatch?.appendChild(chk);
        } else if (i !== item && existing) {
          existing.remove();
        }
      });
    });
  });

  panel.querySelectorAll('.te-preset-delete').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id   = btn.dataset.del;
      const name = (settings.customUIThemes || []).find(t => t.id === id)?.name || 'this theme';
      if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
      settings.customUIThemes = (settings.customUIThemes || []).filter(t => t.id !== id);
      if (settings.uiTheme === id) {
        settings.uiTheme = 'default';
        settings.uiThemeCustomVars = { light: {}, dark: {} };
        applyUITheme(settings);
      }
      renderPresetsTab(panel, settings);
    });
  });

  const importInput = panel.querySelector('#teImportTheme');
  importInput?.addEventListener('change', () => {
    const file = importInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const t = JSON.parse(ev.target.result);
        if (!t.name || !t.light || !t.dark) throw new Error('invalid');
        if (!t.id) t.id = 'custom_' + Date.now();
        if (!settings.customUIThemes) settings.customUIThemes = [];
        settings.customUIThemes = settings.customUIThemes.filter(x => x.id !== t.id);
        settings.customUIThemes.push(t);
        renderPresetsTab(panel, settings);
      } catch { alert('Invalid theme file'); }
    };
    reader.readAsText(file);
  });
}

// ── UI Colours tab ─────────────────────────────────────────────────────────

function renderUITab(panel, settings) {
  const isDark    = settings.theme === 'dark';
  const activeId  = settings.uiTheme || 'default';
  const allThemes = [...BUILTIN_UI_THEMES, ...(settings.customUIThemes || [])];
  const base      = allThemes.find(t => t.id === activeId) || BUILTIN_UI_THEMES[0];
  const customVars = settings.uiThemeCustomVars || { light: {}, dark: {} };
  const modeKey   = isDark ? 'dark' : 'light';
  const currentVars = { ...base[modeKey], ...(customVars[modeKey] || {}) };

  panel.innerHTML = `
    <div class="te-ui-header">
      <span class="te-ui-mode-label">Editing <strong>${isDark ? 'dark' : 'light'} mode</strong> of <em>${base.name}</em></span>
      <button class="te-btn te-btn--sm te-btn--secondary" id="teUIExport">Export</button>
    </div>
    ${UI_THEME_GROUPS.map(group => `
      <div class="te-var-group">
        <div class="te-var-group-label">${group.label}</div>
        ${group.vars.map(vd => {
          const hex = currentVars[vd.key] || '#888888';
          return `<div class="te-var-row" data-var="${vd.key}" data-mode="${modeKey}">
            <div class="te-var-swatch" style="background:${hex}"></div>
            <div class="te-var-label">${vd.label}</div>
            <div class="te-var-value">${hex}</div>
          </div>`;
        }).join('')}
      </div>
    `).join('')}
    <div class="te-ui-action-bar">
      <div class="te-ui-hint">
        ${!base.builtin
          ? 'Tap <strong>Update</strong> to overwrite this theme, or <strong>Save as</strong> to create a new one.'
          : 'Tap <strong>Save as</strong> to save these colours as a new custom theme.'}
      </div>
      <div class="te-ui-action-btns">
        ${!base.builtin ? `<button class="te-btn te-btn--secondary" id="teUISave">Update</button>` : ''}
        <button class="te-btn te-btn--save" id="teUISaveAs">Save as</button>
      </div>
    </div>
    <div id="teUISaveAsRow" style="display:none;padding:8px 16px;border-top:0.5px solid var(--color-border);background:var(--bg-secondary);">
      <div style="display:flex;gap:6px;align-items:center;">
        <input class="picker-hex" id="teUISaveName" placeholder="Theme name" style="flex:1;font-family:inherit;font-size:13px;">
        <button class="te-btn te-btn--sm" id="teUISaveConfirm">Save</button>
        <button class="te-btn te-btn--sm te-btn--secondary" id="teUISaveCancel">✕</button>
      </div>
      <div id="teUISaveError" style="font-size:11px;color:#E24B4A;margin-top:4px;display:none;"></div>
    </div>
  `;

  panel.querySelectorAll('.te-var-row').forEach(row => {
    row.addEventListener('click', () => {
      const varKey = row.dataset.var;
      const hex    = row.querySelector('.te-var-value').textContent.trim();

      openPicker(hex, {
        onLive: newHex => {
          document.documentElement.style.setProperty(varKey, newHex);
          row.querySelector('.te-var-swatch').style.background = newHex;
          row.querySelector('.te-var-value').textContent = newHex;
        },
        onApply: newHex => {
          if (!settings.uiThemeCustomVars) settings.uiThemeCustomVars = { light: {}, dark: {} };
          if (!settings.uiThemeCustomVars[modeKey]) settings.uiThemeCustomVars[modeKey] = {};
          settings.uiThemeCustomVars[modeKey][varKey] = newHex;
          applyUITheme(settings);
        },
        onCancel: () => {
          applyUITheme(settings);
        },
      });
    });
  });

  panel.querySelector('#teUISave')?.addEventListener('click', () => {
    const light = { ...base.light, ...(customVars.light || {}) };
    const dark  = { ...base.dark,  ...(customVars.dark  || {}) };
    const swatch = light['--day-header-bg'] || base.swatch || '#888';
    const idx = (settings.customUIThemes || []).findIndex(t => t.id === base.id);
    if (idx !== -1) {
      settings.customUIThemes[idx] = { ...settings.customUIThemes[idx], light, dark, swatch };
    }
    settings.uiThemeCustomVars = { light: {}, dark: {} };
    applyUITheme(settings);
    renderUITab(panel, settings);
  });

  panel.querySelector('#teUIExport')?.addEventListener('click', () => {
    const light = { ...base.light, ...(customVars.light || {}) };
    const dark  = { ...base.dark,  ...(customVars.dark  || {}) };
    const exportData = { name: base.name + ' Custom', swatch: base.swatch, light, dark };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'chronicle-theme.json'; a.click();
    URL.revokeObjectURL(url);
  });

  const saveAsRow  = panel.querySelector('#teUISaveAsRow');
  const saveName   = panel.querySelector('#teUISaveName');
  const saveError  = panel.querySelector('#teUISaveError');

  panel.querySelector('#teUISaveAs')?.addEventListener('click', () => {
    saveAsRow.style.display = saveAsRow.style.display === 'none' ? 'block' : 'none';
    if (saveAsRow.style.display === 'block') {
      saveName.value = base.name + (base.builtin ? ' Custom' : ' Copy');
      saveError.style.display = 'none';
      saveName.focus();
    }
  });

  panel.querySelector('#teUISaveCancel')?.addEventListener('click', () => {
    saveAsRow.style.display = 'none';
  });

  panel.querySelector('#teUISaveConfirm')?.addEventListener('click', () => {
    const name = saveName.value.trim();
    if (!name) {
      saveError.textContent = 'Name cannot be empty.';
      saveError.style.display = 'block';
      return;
    }
    const existing = [...BUILTIN_UI_THEMES, ...(settings.customUIThemes || [])];
    const dupe = existing.find(t => t.name.toLowerCase() === name.toLowerCase() && t.id !== (base.builtin ? null : base.id));
    if (dupe) {
      saveError.textContent = 'A theme with that name already exists.';
      saveError.style.display = 'block';
      return;
    }
    const light = { ...base.light, ...(customVars.light || {}) };
    const dark  = { ...base.dark,  ...(customVars.dark  || {}) };
    const swatch = light['--day-header-bg'] || base.swatch || '#888';
    const newId = 'custom-' + Date.now();
    const newTheme = { id: newId, name, swatch, light, dark };
    if (!settings.customUIThemes) settings.customUIThemes = [];
    settings.customUIThemes.push(newTheme);
    settings.uiTheme = newId;
    settings.uiThemeCustomVars = { light: {}, dark: {} };
    applyUITheme(settings);
    saveAsRow.style.display = 'none';
    renderUITab(panel, settings);
  });
}

// ── Events tab ─────────────────────────────────────────────────────────────


function renderEventsTab(panel, settings) {
  const themes = getEffectiveEventThemes(settings);
  const isDark  = settings.theme === 'dark';

  panel.innerHTML = `
    <div class="te-event-list">
      ${themes.map(t => buildEventThemeRow(t, isDark)).join('')}
    </div>
    <div class="te-events-footer">
      <button class="te-btn te-btn--secondary" id="teAddEvtTheme">+ Add event theme</button>
    </div>
  `;

  wireEventRows(panel, settings, themes);

  panel.querySelector('#teAddEvtTheme')?.addEventListener('click', () => {
    const newTheme = {
      id:      'custom_' + Date.now(),
      name:    '',
      builtin: false,
      light:   { bg: '#e8e8f5', text: '#333388' },
      dark:    { bg: '#22223a', text: '#a0a0e0' },
    };
    if (!settings.customEventThemes) settings.customEventThemes = [];
    settings.customEventThemes.push(newTheme);
    injectEventThemeCSS(settings);
    renderEventsTab(panel, settings);
    const newRow = panel.querySelector(`[data-evt-id="${newTheme.id}"]`);
    newRow?.querySelector('.te-evt-expand-btn')?.click();
  });
}

function buildEventThemeRow(t, isDark) {
  const bg   = isDark ? t.dark.bg   : t.light.bg;
  const text = isDark ? t.dark.text : t.light.text;
  const label = t.name || '(unnamed)';
  return `
    <div class="te-evt-row" data-evt-id="${t.id}">
      <div class="te-evt-row-header">
        <div class="te-evt-preview-pill" style="background:${bg};color:${text}">${label}</div>
        <div class="te-evt-row-actions">
          <button class="te-btn te-btn--sm te-evt-expand-btn" data-evt-id="${t.id}">Edit</button>
          ${!t.builtin ? `<button class="te-btn te-btn--sm te-evt-del-btn" data-evt-id="${t.id}" aria-label="Delete ${label}">✕</button>` : ''}
        </div>
      </div>
      <div class="te-evt-expand-panel" style="display:none"></div>
    </div>
  `;
}

function wireEventRows(panel, settings, themes) {
  const isDark = settings.theme === 'dark';

  panel.querySelectorAll('.te-evt-expand-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id  = btn.dataset.evtId;
      const row = panel.querySelector(`.te-evt-row[data-evt-id="${id}"]`);
      if (!row) return;
      const expandPanel = row.querySelector('.te-evt-expand-panel');
      const isOpen = expandPanel.style.display !== 'none';

      panel.querySelectorAll('.te-evt-expand-panel').forEach(p => { p.style.display = 'none'; });
      panel.querySelectorAll('.te-evt-expand-btn').forEach(b => b.textContent = 'Edit');

      if (!isOpen) {
        const theme = themes.find(t => t.id === id);
        if (theme) {
          expandPanel.style.display = 'block';
          btn.textContent = 'Close';
          const headerPill = row.querySelector('.te-evt-preview-pill');
          renderEventThemeExpand(expandPanel, theme, settings, isDark, headerPill, () => renderEventsTab(panel, settings));
        }
      }
    });
  });

  panel.querySelectorAll('.te-evt-del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id   = btn.dataset.evtId;
      const name = themes.find(t => t.id === id)?.name || 'this theme';
      if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
      settings.customEventThemes = (settings.customEventThemes || []).filter(t => t.id !== id);
      injectEventThemeCSS(settings);
      renderEventsTab(panel, settings);
    });
  });
}

function renderEventThemeExpand(container, theme, settings, isDark, headerPill, onDone) {
  const isBuiltin = !!theme.builtin;

  container.innerHTML = `
    <div class="te-evt-expand-inner">
      <div class="te-evt-name-row">
        <input class="te-evt-name-input field-input" value="${isBuiltin ? theme.name + ' (copy)' : theme.name}" placeholder="Theme name (required)">
        <div class="te-evt-name-error" style="display:none;color:#E24B4A;font-size:11px;margin-top:4px"></div>
      </div>
      <div class="te-evt-colors-grid">
        <div class="te-evt-color-section">
          <div class="te-evt-color-label">Light mode</div>
          <div class="te-evt-color-pair">
            <div class="te-evt-color-item" data-mode="light" data-field="bg">
              <div class="te-evt-color-swatch" style="background:${theme.light.bg}"></div>
              <span>Background</span>
            </div>
            <div class="te-evt-color-item" data-mode="light" data-field="text">
              <div class="te-evt-color-swatch" style="background:${theme.light.text}"></div>
              <span>Text</span>
            </div>
          </div>
        </div>
        <div class="te-evt-color-section">
          <div class="te-evt-color-label">Dark mode</div>
          <div class="te-evt-color-pair">
            <div class="te-evt-color-item" data-mode="dark" data-field="bg">
              <div class="te-evt-color-swatch te-evt-color-swatch--dark" style="background:${theme.dark.bg}"></div>
              <span>Background</span>
            </div>
            <div class="te-evt-color-item" data-mode="dark" data-field="text">
              <div class="te-evt-color-swatch te-evt-color-swatch--dark" style="background:${theme.dark.text}"></div>
              <span>Text</span>
            </div>
          </div>
        </div>
      </div>
      <div class="te-evt-expand-footer">
        <span class="te-evt-builtin-note" style="${isBuiltin ? '' : 'display:none'}">
          Saves as a new custom theme
        </span>
        <button class="te-btn te-btn--save te-evt-save-btn">${isBuiltin ? 'Save as new' : 'Save'}</button>
      </div>
    </div>
  `;

  const working = JSON.parse(JSON.stringify(theme));
  const nameInput  = container.querySelector('.te-evt-name-input');
  const nameError  = container.querySelector('.te-evt-name-error');

  const refreshPreview = () => {
    const name = nameInput.value.trim() || '(unnamed)';
    const bg   = isDark ? working.dark.bg   : working.light.bg;
    const text = isDark ? working.dark.text : working.light.text;
    if (headerPill) {
      headerPill.textContent    = name;
      headerPill.style.background = bg;
      headerPill.style.color      = text;
    }
  };

  nameInput.addEventListener('input', () => { nameError.style.display = 'none'; refreshPreview(); });

  container.querySelectorAll('.te-evt-color-item').forEach(item => {
    item.addEventListener('click', () => {
      const mode   = item.dataset.mode;
      const field  = item.dataset.field;
      const swatch = item.querySelector('.te-evt-color-swatch');

      openPicker(working[mode][field], {
        onLive: newHex => {
          swatch.style.background = newHex;
          working[mode][field] = newHex;
          refreshPreview();
        },
        onApply: newHex => {
          swatch.style.background = newHex;
          working[mode][field] = newHex;
          refreshPreview();
        },
        onCancel: () => {
          swatch.style.background = working[mode][field];
        },
      });
    });
  });

  container.querySelector('.te-evt-save-btn')?.addEventListener('click', () => {
    const name = nameInput.value.trim();

    if (!name) {
      nameError.textContent = 'Name is required.';
      nameError.style.display = 'block';
      nameInput.focus();
      return;
    }

    // Dupe check — for built-ins creating a copy, allow matching the original name only if ID differs
    const existingNames = getEffectiveEventThemes(settings)
      .filter(t => t.id !== (isBuiltin ? null : theme.id))
      .map(t => t.name.toLowerCase());

    if (existingNames.includes(name.toLowerCase())) {
      nameError.textContent = `A theme named "${name}" already exists.`;
      nameError.style.display = 'block';
      nameInput.focus();
      return;
    }

    if (isBuiltin) {
      // Create a new custom theme — never modify the built-in
      const copy = {
        id:      'custom_' + Date.now(),
        name,
        builtin: false,
        light:   { ...working.light },
        dark:    { ...working.dark },
      };
      if (!settings.customEventThemes) settings.customEventThemes = [];
      settings.customEventThemes.push(copy);
    } else {
      // Update custom theme in-place
      working.name = name;
      const idx = (settings.customEventThemes || []).findIndex(t => t.id === theme.id);
      if (idx !== -1) settings.customEventThemes[idx] = { ...working };
    }

    injectEventThemeCSS(settings);
    onDone();
  });
}
