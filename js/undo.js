/** Chronicle — Undo/redo stack (max 50 snapshots) */

const MAX_UNDO = 50;
const undoStack = [];
const redoStack = [];

/** Push a JSON-serialised snapshot of the current state */
export function pushUndo(snapshot) {
  undoStack.push(JSON.stringify(snapshot));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
}

/** Undo: saves currentState to redo stack, returns previous state or null */
export function undo(currentState) {
  if (undoStack.length === 0) return null;
  redoStack.push(JSON.stringify(currentState));
  return JSON.parse(undoStack.pop());
}

/** Redo: saves currentState to undo stack, returns next state or null */
export function redo(currentState) {
  if (redoStack.length === 0) return null;
  undoStack.push(JSON.stringify(currentState));
  return JSON.parse(redoStack.pop());
}

/** True if there is something to undo */
export function canUndo() { return undoStack.length > 0; }

/** True if there is something to redo */
export function canRedo() { return redoStack.length > 0; }
