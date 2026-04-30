# CLAUDE EDITING RULES (CHRONICLE PROJECT)

## MODE
- Default: DIFF-ONLY
- Only output minimal patch
- Never rewrite full files unless explicitly told

---

## FILE DISCOVERY RULE

ALWAYS:
1. Check index.md first
2. Identify target module
3. Open ONLY that file
4. Stop

NEVER:
- scan entire /js folder
- open multiple unrelated modules
- re-architect system without request

---

## SCOPE CONTROL

You may ONLY modify:
- The file specified in request
- OR 1 directly related dependency (as listed in index.md)

---

## OUTPUT FORMAT

Default response:
- ONLY changed functions or minimal diff
- NO explanations
- NO repeated code blocks
- MAX ~80–120 lines

---

## DEBUG FLOW

When fixing a bug:

1. Locate file via index.md
2. Inspect ONLY relevant function
3. Apply smallest possible fix
4. STOP immediately

---

## UI RULES

If issue is UI-related:
- Prefer CSS fix before JS rewrite
- Do NOT restructure layout unless necessary

---

## SYNC RULES

For sync issues:
- sync.js is primary authority
- calendar.js / ical.js are helpers only

---

## THEME RULES

Theme issues must follow order:
1. themes.js (logic)
2. themes.css (styles)
3. themeEditor.js (UI)

---

## GESTURE RULES

gesture issues:
- ALWAYS start in gestures.js
- DO NOT modify calendar or diary unless required

---

## STRICT LIMITS

- No full file rewrites (unless explicitly allowed)
- No cross-file refactors unless requested
- No “improvements” outside scope of bug/task

---

## IF UNCERTAIN

Ask:
- which file?
- which function?

DO NOT guess across modules

---

## PERFORMANCE PRINCIPLE

Prefer:
- smallest patch
- local fix
- no architectural changes