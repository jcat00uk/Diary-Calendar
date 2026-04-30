# CLAUDE TASK PROTOCOL (CHRONICLE)

This file defines how all tasks must be interpreted and executed.

---

## 1. TASK INPUT FORMAT

All requests will follow:

TASK: <what needs to be done>

OPTIONAL:
FILE: <suggested file>
FUNCTION: <optional function hint>

---

## 2. FILE SELECTION RULE

If FILE is not provided:

Use /docs/index.md to determine:
- primary file
- secondary dependencies (max 2)

Never guess outside index.md.

---

## 3. OUTPUT FORMAT (STRICT)

All responses MUST follow this structure:

FILE:
<file name>

LOCATION:
~ line X–Y (approximate, based on context)

CHANGE TYPE:
modify | add | remove

BEFORE:
```code
(existing code block with surrounding context)