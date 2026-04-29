/** Chronicle — Theme data and CSS injection */

// ── Helper: compact theme colour row ──────────────────────────────────────

function _v(bgP, bgS, bgT, dcB, dcW, dhB, dhW, tP, tS, tTer, toB, toT) {
  return {
    '--bg-primary': bgP, '--bg-secondary': bgS, '--bg-tertiary': bgT,
    '--day-card-bg': dcB, '--day-card-bg-weekend': dcW,
    '--day-header-bg': dhB, '--day-header-bg-weekend': dhW,
    '--text-primary': tP, '--text-secondary': tS, '--text-tertiary': tTer,
    '--today-border': toB, '--today-text': toT,
  };
}

// ── Built-in UI themes ─────────────────────────────────────────────────────

export const BUILTIN_UI_THEMES = [
  {
    id: 'default', name: 'Default', swatch: '#378ADD', builtin: true,
    light: _v('#ffffff','#f7f6f3','#f0efe9','#ffffff','#F3F7FB','#a4e3ff','#d5e4f0','#1a1a18','#6b6a66','#a8a79f','#378ADD','#185FA5'),
    dark:  _v('#1a1a18','#242420','#2c2c28','#1a2230','#161d28','#1e2d42','#1a2840','#f0efe9','#a8a79f','#6b6a66','#378ADD','#4d9fe0'),
  },
  {
    id: 'warm', name: 'Warm', swatch: '#c8762a', builtin: true,
    light: _v('#fffaf5','#f7f0e8','#f0e6d8','#fdf4e8','#fef7ee','#f0d9b8','#ecdbb8','#2a1a08','#6b5240','#a8907a','#c8762a','#9a5420'),
    dark:  _v('#1e1610','#2a1e14','#33261a','#2a1e0e','#221808','#3a2810','#311e08','#f0e8d8','#b09070','#6b5240','#c8762a','#e8a060'),
  },
  {
    id: 'forest', name: 'Forest', swatch: '#2d7a32', builtin: true,
    light: _v('#f5faf5','#ebf4eb','#e0ecdf','#e8f5e8','#eef7ee','#c0ddbf','#c8e4c8','#0a200a','#406040','#7a9a7a','#2d7a32','#1a5520'),
    dark:  _v('#101a10','#162016','#1c281c','#102010','#0c180c','#1a3020','#162818','#d8f0d8','#80a880','#406040','#2d7a32','#50c050'),
  },
  {
    id: 'slate', name: 'Slate', swatch: '#3a5fa0', builtin: true,
    light: _v('#f5f6fa','#eceef5','#e2e5f0','#e8ecf8','#eef1f8','#c8d0e8','#cdd4ec','#0e1628','#505870','#8890a8','#3a5fa0','#1e3c80'),
    dark:  _v('#0e1020','#151828','#1c2030','#141828','#101420','#1c2438','#181e30','#d8ddf0','#8890b8','#505870','#3a5fa0','#6080d0'),
  },
  {
    id: 'hicontrast', name: 'Hi-Contrast', swatch: '#0055cc', builtin: true,
    light: _v('#ffffff','#f0f0f0','#e0e0e0','#f0f4ff','#f8f8ff','#c0cfff','#ccd8ff','#000000','#333333','#666666','#0055cc','#0033aa'),
    dark:  _v('#000000','#101010','#1a1a1a','#001022','#000c18','#002040','#001830','#ffffff','#cccccc','#888888','#4488ff','#88bbff'),
  },
];

// ── Built-in event themes ──────────────────────────────────────────────────

export const BUILTIN_EVENT_THEMES = [
  { id: 'birthday',    name: 'Birthday',    builtin: true, light: { bg: '#fce7f5', text: '#7a1060' }, dark: { bg: '#3d1030', text: '#f0a0d8' } },
  { id: 'work',        name: 'Work',        builtin: true, light: { bg: '#e7edfc', text: '#1a3488' }, dark: { bg: '#0d2040', text: '#a0b4f0' } },
  { id: 'holiday',     name: 'Holiday',     builtin: true, light: { bg: '#e7f5ed', text: '#1a6640' }, dark: { bg: '#0d3020', text: '#a0d8b4' } },
  { id: 'personal',    name: 'Personal',    builtin: true, light: { bg: '#f0e7fc', text: '#521a88' }, dark: { bg: '#240d40', text: '#c0a0f0' } },
  { id: 'appointment', name: 'Appointment', builtin: true, light: { bg: '#fdf3e7', text: '#884a1a' }, dark: { bg: '#3d2010', text: '#f0c0a0' } },
];

// ── UI theme variable groups (for editor) ──────────────────────────────────

export const UI_THEME_GROUPS = [
  {
    label: 'Backgrounds',
    vars: [
      { key: '--bg-primary',   label: 'Primary' },
      { key: '--bg-secondary', label: 'Secondary' },
      { key: '--bg-tertiary',  label: 'Tertiary' },
    ],
  },
  {
    label: 'Day Cards',
    vars: [
      { key: '--day-card-bg',           label: 'Card' },
      { key: '--day-card-bg-weekend',   label: 'Weekend card' },
      { key: '--day-header-bg',         label: 'Header' },
      { key: '--day-header-bg-weekend', label: 'Weekend header' },
    ],
  },
  {
    label: 'Text',
    vars: [
      { key: '--text-primary',   label: 'Primary' },
      { key: '--text-secondary', label: 'Secondary' },
      { key: '--text-tertiary',  label: 'Tertiary' },
    ],
  },
  {
    label: 'Accent',
    vars: [
      { key: '--today-border', label: 'Today ring' },
      { key: '--today-text',   label: 'Today text' },
    ],
  },
];

// ── UI theme application ───────────────────────────────────────────────────

export function applyUITheme(settings) {
  // Clear any inline CSS variable overrides left by live picker previews
  UI_THEME_GROUPS.forEach(g => g.vars.forEach(v => document.documentElement.style.removeProperty(v.key)));

  const themeId     = settings.uiTheme || 'default';
  const customThemes = settings.customUIThemes || [];
  const base = customThemes.find(t => t.id === themeId)
    || BUILTIN_UI_THEMES.find(t => t.id === themeId)
    || BUILTIN_UI_THEMES[0];

  const customVars = settings.uiThemeCustomVars || { light: {}, dark: {} };
  const light = { ...base.light, ...(customVars.light || {}) };
  const dark  = { ...base.dark,  ...(customVars.dark  || {}) };

  const toDecl = vars => Object.entries(vars).map(([k, v]) => `  ${k}:${v};`).join('\n');
  const css = `:root{\n${toDecl(light)}\n}\nbody.dark{\n${toDecl(dark)}\n}\n`;

  let el = document.getElementById('chronicle-ui-theme');
  if (!el) {
    el = document.createElement('style');
    el.id = 'chronicle-ui-theme';
    document.head.appendChild(el);
  }
  el.textContent = css;

  document.body.classList.toggle('dark', settings.theme === 'dark');
}

// ── Event theme helpers ────────────────────────────────────────────────────

export function getEffectiveEventThemes(settings) {
  const overrides = settings.eventThemeOverrides || {};
  const custom    = settings.customEventThemes   || [];

  const builtins = BUILTIN_EVENT_THEMES.map(t => {
    const ov = overrides[t.id];
    if (!ov) return t;
    return {
      ...t,
      light: { ...t.light, ...(ov.light || {}) },
      dark:  { ...t.dark,  ...(ov.dark  || {}) },
    };
  });

  return [...builtins, ...custom];
}

export function injectEventThemeCSS(settings) {
  const themes = getEffectiveEventThemes(settings);

  let rootVars = ':root{\n';
  let darkVars = 'body.dark{\n';
  let rules = '';

  for (const t of themes) {
    rootVars += `  --evt-${t.id}-bg:${t.light.bg};--evt-${t.id}-text:${t.light.text};\n`;
    darkVars  += `  --evt-${t.id}-bg:${t.dark.bg};--evt-${t.id}-text:${t.dark.text};\n`;
    const bg  = `var(--evt-${t.id}-bg)`;
    const txt = `var(--evt-${t.id}-text)`;
    // Week grid — event pills
    rules += `.event-pill.event-pill--theme-${t.id}{background:${bg};color:${txt}}\n`;
    // Week grid — todo items with theme
    rules += `.todo-item.todo-item--theme-${t.id}{background:${bg}}\n`;
    rules += `.todo-item.todo-item--theme-${t.id} .todo-label{color:${txt}}\n`;
    rules += `.todo-item.todo-item--theme-${t.id} .todo-checkbox{border-color:${txt};color:${txt}}\n`;
    // Expanded day view
    //rules += `.expanded-event-item--theme-${t.id}{background:${bg};border-color:${bg}}\n`;
    //rules += `.expanded-event-item--theme-${t.id} .expanded-event-dot{background:${txt}}\n`;
    //rules += `.expanded-event-item--theme-${t.id} .expanded-event-title{color:${txt}}\n`;
    rules += `.expanded-todo-item--theme-${t.id}{background:${bg};border-color:${bg}}\n`;
    rules += `.expanded-todo-item--theme-${t.id} .expanded-todo-check{border-color:${txt};color:${txt}}\n`;
    rules += `.expanded-todo-item--theme-${t.id} .expanded-todo-label{color:${txt}}\n`;
    // Agenda — full row tint + icon + title
    rules += `.agenda-list .agenda-item--theme-${t.id}{background:${bg}}\n`;
    rules += `.agenda-item--theme-${t.id} .agenda-item__icon{background:${bg};color:${txt}}\n`;
    rules += `.agenda-item--theme-${t.id} .agenda-item__title{color:${txt}}\n`;
    rules += `.agenda-item--theme-${t.id} .agenda-item__date{color:${txt};opacity:0.7}\n`;

 

  }

  const css = rootVars + '}\n' + darkVars + '}\n' + rules;
  let el = document.getElementById('chronicle-event-themes');
  if (!el) {
    el = document.createElement('style');
    el.id = 'chronicle-event-themes';
    document.head.appendChild(el);
  }
  el.textContent = css;
}
