/** Chronicle — Gesture detection (long press + swipe) */

const LONG_PRESS_MS  = 480;
const MOVE_CANCEL_PX = 12;
const SWIPE_MIN_PX   = 50;
const SWIPE_RATIO    = 1.8; // primary axis must be this many times larger than secondary

export function initGestures(el, callbacks) {
  let startX = 0, startY = 0;
  let startTarget = null;
  let moved = false;
  let longPressTimer = null;

  // ── Touch ───────────────────────────────────────────────────────────────
  el.addEventListener('touchstart', e => {
    if (e.target.closest('[contenteditable]')) return;

    const t     = e.touches[0];
    startX      = t.clientX;
    startY      = t.clientY;
    startTarget = e.target;
    moved       = false;

    const card = startTarget.closest('.day-card');
    longPressTimer = setTimeout(() => {
      if (moved) return;
      if (card?.dataset.date) callbacks.onLongPress?.(card.dataset.date);
      startTarget = null;
    }, LONG_PRESS_MS);
    if (card) card.classList.add('pressing');
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    if (!startTarget || moved) return;
    const t  = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dx) > MOVE_CANCEL_PX || Math.abs(dy) > MOVE_CANCEL_PX) {
      moved = true;
      clearTimeout(longPressTimer);
      el.querySelectorAll('.day-card.pressing').forEach(c => c.classList.remove('pressing'));
    }
  }, { passive: true });

  el.addEventListener('touchend', e => {
    clearTimeout(longPressTimer);
    el.querySelectorAll('.day-card.pressing').forEach(c => c.classList.remove('pressing'));

    if (startTarget && moved) {
      const t   = e.changedTouches[0];
      const dx  = t.clientX - startX;
      const dy  = t.clientY - startY;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);

      if (adx >= SWIPE_MIN_PX && adx > ady * SWIPE_RATIO) {
        if (dx < 0) callbacks.onSwipeLeft?.();
        else        callbacks.onSwipeRight?.();
      } else if (ady >= SWIPE_MIN_PX && ady > adx * SWIPE_RATIO) {
        if (dy < 0) callbacks.onSwipeUp?.();
        else        callbacks.onSwipeDown?.();
      }
    }

    startTarget = null;
  }, { passive: true });

  el.addEventListener('touchcancel', () => {
    clearTimeout(longPressTimer);
    el.querySelectorAll('.day-card.pressing').forEach(c => c.classList.remove('pressing'));
    startTarget = null;
  }, { passive: true });

  // ── Mouse (desktop long-press only) ─────────────────────────────────────
  el.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('[contenteditable]')) return;

    const ox = e.clientX;
    const oy = e.clientY;
    const target = e.target;
    let mouseTimer = null;

    const onMove = ev => {
      if (Math.abs(ev.clientX - ox) > MOVE_CANCEL_PX ||
          Math.abs(ev.clientY - oy) > MOVE_CANCEL_PX) {
        cancel();
      }
    };
    const onUp  = () => cancel();
    const cancel = () => {
      clearTimeout(mouseTimer);
      if (card) card.classList.remove('pressing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);

    const card = target.closest('.day-card');
    if (card) card.classList.add('pressing');
    mouseTimer = setTimeout(() => {
      cancel();
      if (card?.dataset.date) callbacks.onLongPress?.(card.dataset.date);
    }, LONG_PRESS_MS);
  });
}

/** Lightweight swipe-only detector for overlays (expanded day, modals). */
export function initSwipe(el, callbacks) {
  let startX = 0, startY = 0, active = false;

  el.addEventListener('touchstart', e => {
    if (e.target.closest('[contenteditable]')) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    active = true;
  }, { passive: true });

  el.addEventListener('touchend', e => {
    if (!active) return;
    active = false;
    const dx  = e.changedTouches[0].clientX - startX;
    const dy  = e.changedTouches[0].clientY - startY;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if (adx >= SWIPE_MIN_PX && adx > ady * SWIPE_RATIO) {
      if (dx < 0) callbacks.onSwipeLeft?.();
      else        callbacks.onSwipeRight?.();
    } else if (ady >= SWIPE_MIN_PX && ady > adx * SWIPE_RATIO) {
      if (dy < 0) callbacks.onSwipeUp?.();
      else        callbacks.onSwipeDown?.();
    }
  }, { passive: true });

  el.addEventListener('touchcancel', () => { active = false; }, { passive: true });
}
