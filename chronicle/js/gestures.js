/** Chronicle — Swipe and long-press gesture handling via pointer events */

const SWIPE_THRESHOLD = 50;   // px
const LONG_PRESS_MS   = 500;  // ms
const MOVE_CANCEL_PX  = 8;    // px before long-press cancels

/**
 * Attach horizontal/vertical swipe listeners to an element.
 * callbacks: { onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown }
 */
export function initSwipeGestures(el, callbacks) {
  let startX = 0, startY = 0;
  let tracking = false;
  let committed = false; // true once we've committed to a swipe axis

  el.addEventListener('pointerdown', e => {
    startX = e.clientX;
    startY = e.clientY;
    tracking = true;
    committed = false;
  }, { passive: true });

  el.addEventListener('pointerup', e => {
    if (!tracking) return;
    tracking = false;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDx < SWIPE_THRESHOLD && absDy < SWIPE_THRESHOLD) return;

    if (absDx >= absDy) {
      if (dx < 0 && callbacks.onSwipeLeft)  callbacks.onSwipeLeft();
      else if (dx > 0 && callbacks.onSwipeRight) callbacks.onSwipeRight();
    } else {
      if (dy < 0 && callbacks.onSwipeUp)   callbacks.onSwipeUp();
      else if (dy > 0 && callbacks.onSwipeDown) callbacks.onSwipeDown();
    }
  }, { passive: true });

  el.addEventListener('pointercancel', () => { tracking = false; }, { passive: true });
}

/**
 * Attach a long-press listener to an element.
 * onLongPress(pointerEvent) fires after 500 ms without significant movement.
 */
export function initLongPress(el, onLongPress) {
  let timer = null;
  let startX = 0, startY = 0;

  const cancel = () => {
    clearTimeout(timer);
    timer = null;
  };

  el.addEventListener('pointerdown', e => {
    startX = e.clientX;
    startY = e.clientY;
    timer = setTimeout(() => {
      timer = null;
      onLongPress(e);
    }, LONG_PRESS_MS);
  }, { passive: true });

  el.addEventListener('pointermove', e => {
    if (!timer) return;
    if (Math.abs(e.clientX - startX) > MOVE_CANCEL_PX ||
        Math.abs(e.clientY - startY) > MOVE_CANCEL_PX) {
      cancel();
    }
  }, { passive: true });

  el.addEventListener('pointerup',     cancel, { passive: true });
  el.addEventListener('pointercancel', cancel, { passive: true });
}
