/** Chronicle — Gesture detection (long press + swipe) */

const LONG_PRESS_MS  = 480;
const MOVE_CANCEL_PX = 12;
export const SWIPE_MIN_PX   = 50;
const SWIPE_RATIO    = 1.8;
export const SWIPE_HINT_PX  = 22;
const HINT_PX        = SWIPE_HINT_PX;
export const SPRING_EASE = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

export function initGestures(el, callbacks) {
  const parent = el.parentElement; // translated element (gridWithSides)
  let startX = 0, startY = 0;
  let startTarget = null;
  let moved = false;
  let longPressTimer = null;
  let hintFired = false;
  let swipeAxis = null;
  let dragStartFired = false;

  // ── Touch ───────────────────────────────────────────────────────────────
  el.addEventListener('touchstart', e => {
    const t     = e.touches[0];
    startX      = t.clientX;
    startY      = t.clientY;
    startTarget = e.target;
    moved          = false;
    hintFired      = false;
    swipeAxis      = null;
    dragStartFired = false;
    parent.style.transition = '';

    if (!e.target.closest('[contenteditable]')) {
      const card = startTarget.closest('.day-card');
      longPressTimer = setTimeout(() => {
        if (moved) return;
        if (card?.dataset.date) callbacks.onLongPress?.(card.dataset.date);
        startTarget = null;
      }, LONG_PRESS_MS);
      if (card) card.classList.add('pressing');
    }
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    if (!startTarget) return;
    const t   = e.touches[0];
    const dx  = t.clientX - startX;
    const dy  = t.clientY - startY;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    if (!moved && (adx > MOVE_CANCEL_PX || ady > MOVE_CANCEL_PX)) {
      moved = true;
      clearTimeout(longPressTimer);
      el.querySelectorAll('.day-card.pressing').forEach(c => c.classList.remove('pressing'));
    }

    // Commit to an axis once HINT_PX is exceeded — no translation before that
    if (moved && !swipeAxis) {
      if (adx >= HINT_PX && adx > ady) swipeAxis = 'h';
      else if (ady >= HINT_PX && ady > adx) swipeAxis = 'v';
    }

    if (moved && swipeAxis) {
      if (!dragStartFired && swipeAxis === 'h') {
        dragStartFired = true;
        callbacks.onDragStart?.();
      }
      if (swipeAxis === 'h') {
        parent.style.transform = `translateX(${dx}px)`;
        callbacks.onDragTranslate?.(dx);
      } else {
        parent.style.transform = `translateY(${dy}px)`;
      }
    }

    if (moved && !hintFired && swipeAxis) {
      hintFired = true;
      const dir = swipeAxis === 'h'
        ? (dx < 0 ? 'left' : 'right')
        : (dy < 0 ? 'up' : 'down');
      callbacks.onHint?.(dir);
    }
  }, { passive: true });

  el.addEventListener('touchend', e => {
    clearTimeout(longPressTimer);
    el.querySelectorAll('.day-card.pressing').forEach(c => c.classList.remove('pressing'));
    callbacks.onHint?.(null);
    hintFired = false;

    if (startTarget && moved) {
      const t   = e.changedTouches[0];
      const dx  = t.clientX - startX;
      const dy  = t.clientY - startY;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);

      let committed = false;
      if (adx >= SWIPE_MIN_PX && adx > ady * SWIPE_RATIO) {
        committed = true;
        parent.style.transform = '';
        callbacks.onDragEnd?.();
        if (dx < 0) callbacks.onSwipeLeft?.();
        else        callbacks.onSwipeRight?.();
      } else if (ady >= SWIPE_MIN_PX && ady > adx * SWIPE_RATIO) {
        committed = true;
        parent.style.transform = '';
        callbacks.onDragEnd?.();
        if (dy < 0) callbacks.onSwipeUp?.();
        else        callbacks.onSwipeDown?.();
      }

      if (!committed) {
        const DUR = 350;
        parent.style.transition = `transform ${DUR}ms ${SPRING_EASE}`;
        parent.style.transform  = '';
        callbacks.onDragSnapBack?.(DUR);
        setTimeout(() => {
          parent.style.transition = '';
          callbacks.onDragEnd?.();
        }, DUR + 20);
      }
    } else {
      parent.style.transform = '';
    }

    startTarget = null;
  }, { passive: true });

  el.addEventListener('touchcancel', () => {
    clearTimeout(longPressTimer);
    el.querySelectorAll('.day-card.pressing').forEach(c => c.classList.remove('pressing'));
    callbacks.onHint?.(null);
    hintFired = false;
    if (moved && swipeAxis) {
      const DUR = 250;
      parent.style.transition = `transform ${DUR}ms ease`;
      parent.style.transform  = '';
      callbacks.onDragSnapBack?.(DUR);
      setTimeout(() => {
        parent.style.transition = '';
        callbacks.onDragEnd?.();
      }, DUR + 20);
    } else {
      parent.style.transform = '';
    }
    startTarget = null;
  }, { passive: true });

  // ── Mouse (desktop long-press only) ─────────────────────────────────────
  el.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('[contenteditable]')) return;

    const ox     = e.clientX;
    const oy     = e.clientY;
    const target = e.target;
    let mouseTimer = null;

    const onMove = ev => {
      if (Math.abs(ev.clientX - ox) > MOVE_CANCEL_PX ||
          Math.abs(ev.clientY - oy) > MOVE_CANCEL_PX) {
        cancel();
      }
    };
    const onUp   = () => cancel();
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

/** Lightweight swipe-only detector for overlays and panels.
 *  Horizontal axis only — vertical movement cancels the gesture.
 *  No translation occurs until the horizontal axis is committed.
 *  options.shouldIgnoreTarget(target) — return true to suppress gesture start. */
export function initSwipe(el, callbacks, options = {}) {
  const { shouldIgnoreTarget } = options;
  let startX = 0, startY = 0, active = false, hintFired = false, swipeAxis = null;

  el.addEventListener('touchstart', e => {
    if (shouldIgnoreTarget?.(e.target)) { active = false; return; }
    startX    = e.touches[0].clientX;
    startY    = e.touches[0].clientY;
    active    = true;
    hintFired = false;
    swipeAxis = null;
    el.style.transition = '';
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    if (!active) return;
    const dx  = e.touches[0].clientX - startX;
    const dy  = e.touches[0].clientY - startY;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    if (!swipeAxis) {
      if (adx >= HINT_PX && adx > ady)      swipeAxis = 'h';
      else if (ady >= HINT_PX && ady > adx) { active = false; return; } // vertical → cancel
    }
    if (swipeAxis !== 'h') return;

    el.style.transform = `translateX(${dx}px)`;

    if (!hintFired && adx >= HINT_PX) {
      hintFired = true;
      callbacks.onHint?.(dx < 0 ? 'left' : 'right');
    }
  }, { passive: true });

  el.addEventListener('touchend', e => {
    if (!active) return;
    active    = false;
    hintFired = false;
    callbacks.onHint?.(null);

    if (swipeAxis !== 'h') {
      el.style.transform = '';
      swipeAxis = null;
      return;
    }

    const dx  = e.changedTouches[0].clientX - startX;
    const dy  = e.changedTouches[0].clientY - startY;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    swipeAxis = null;

    if (adx >= SWIPE_MIN_PX && adx > ady * SWIPE_RATIO) {
      el.style.transform = '';
      if (dx < 0) callbacks.onSwipeLeft?.();
      else        callbacks.onSwipeRight?.();
      return;
    }

    el.style.transition = `transform 350ms ${SPRING_EASE}`;
    el.style.transform  = '';
    setTimeout(() => { el.style.transition = ''; }, 370);
  }, { passive: true });

  el.addEventListener('touchcancel', () => {
    if (!active) return;
    active    = false;
    hintFired = false;
    swipeAxis = null;
    callbacks.onHint?.(null);
    el.style.transition = 'transform 250ms ease';
    el.style.transform  = '';
    setTimeout(() => { el.style.transition = ''; }, 260);
  }, { passive: true });
}
