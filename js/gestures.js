/** Chronicle — Gesture detection (long press only) using touch events */

export function initGestures(el, callbacks) {
  let startX = 0, startY = 0;
  let startTarget = null;
  let moved = false;
  let longPressTimer = null;

  const LONG_PRESS_MS = 480;
  const MOVE_CANCEL_PX = 12;

  el.addEventListener('touchstart', e => {
    if (e.target.closest('[contenteditable]')) return;

    const t = e.touches[0];
    startX      = t.clientX;
    startY      = t.clientY;
    startTarget = e.target;
    moved       = false;

    longPressTimer = setTimeout(() => {
      if (moved) return;
      const card = startTarget.closest('.day-card');
      if (card?.dataset.date) callbacks.onLongPress?.(card.dataset.date);
      startTarget = null;
    }, LONG_PRESS_MS);
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    if (!startTarget || moved) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dx) > MOVE_CANCEL_PX || Math.abs(dy) > MOVE_CANCEL_PX) {
      moved = true;
      clearTimeout(longPressTimer);
    }
  }, { passive: true });

  el.addEventListener('touchend', () => {
    clearTimeout(longPressTimer);
    startTarget = null;
  }, { passive: true });

  el.addEventListener('touchcancel', () => {
    clearTimeout(longPressTimer);
    startTarget = null;
  }, { passive: true });
}
