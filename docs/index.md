# CHRONICLE PROJECT INDEX (READ FIRST)

## OVERVIEW
- Type: Diary / calendar hybrid app
- Core systems:
  - Diary editor
  - Week/day UI views
  - Gesture system (swipe/long press)
  - Sync (calendar + storage)
  - Theming system

---

## ROOT FILES

- index.html → app entry point + UI mount
- app.js → main bootstrap + wiring of modules
- README.md → project notes
- todo.txt → loose task tracking
- build-chronicle.bat → build/deploy script
- capacitor.config.json → mobile wrapper config

---

## CORE JS MODULES (/js)

### APP CORE
- app.js → initialisation + orchestration
- events.js → global event bus / event handling
- undo.js → undo/redo stack logic

---

### DIARY / EDITOR
- diary.js → diary state + editing logic
- themeEditor.js → theme editing UI logic
- themes.js → theme definitions + application

---

### UI / INTERACTIONS
- gestures.js → swipe, long press, drag detection
- notifications.js → reminders + alerts

---

### CALENDAR / TIME
- calendar.js → calendar rendering + logic
- holidays.js → holiday data integration
- ical.js → iCal import/export logic

---

### SYNC
- sync.js → unified sync layer (Drive/Calendar/etc)

---

## CSS STRUCTURE (/css)

### CORE STYLES
- base.css → global styles
- themes.css → theme variables + switching
- responsive.css → mobile/tablet layout rules

### UI COMPONENTS
- week-view.css → weekly calendar layout
- day-card.css → day card UI
- expanded-day.css → full editor view
- agenda.css → agenda/list view styling
- ribbon.css → top ribbon UI
- modals.css → popup/dialog styling

---

## ASSET FILES
- assets/icons.svg → icon sprite sheet

---

## COMMON TASK ROUTING

### UI BUGS
- Week layout → week-view.css + calendar.js
- Day editor → expanded-day.css + diary.js
- Modal issues → modals.css + events.js

---

### LOGIC BUGS
- Diary saving/editing → diary.js
- App startup issues → app.js
- Sync problems → sync.js
- Undo issues → undo.js

---

### INTERACTIONS
- Swipe/gesture issues → gestures.js
- Notification bugs → notifications.js

---

### THEMING
- Theme not applying → themes.js + themes.css + themeEditor.js

---

### CALENDAR / ICS
- Events wrong → calendar.js
- Import/export issues → ical.js
- Holidays missing → holidays.js

---

## CRITICAL FUNCTIONS (HIT FIRST)

- initApp() → app startup
- syncData() → sync pipeline
- applyTheme() → theme switching
- handleGesture() → swipe system entry