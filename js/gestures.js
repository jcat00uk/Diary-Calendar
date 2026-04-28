/** Chronicle — Gesture detection (long press + swipe) */

const LONG_PRESS_MS  = 480;
const MOVE_CANCEL_PX = 12;
const SWIPE_MIN_PX   = 50;
const SWIPE_RATIO    = 1.8; // primary axis must be this many times larger than secondary
const HINT_PX        = 22;  // displacement to show swipe direction hint

export function initGestures(el, callbacks) {
  let startX = 0, startY = 0;
  let startTarget = null;
  let moved = false;
  let longPressTimer = null;
  let hintFired = false;

  // ── Touch ───────────────────────────────────────────────────────────────
  el.addEventListener('touchstart', e => {
    const t     = e.touches[0];
    startX      = t.clientX;
    startY      = t.clientY;
    startTarget = e.target;
    moved       = false;
    hintFired   = false;
    el.style.transition = ''; // cancel any in-progress snap-back

    // Long-press only triggers outside editable areas; swipe still works anywhere
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

    if (moved) {
      // Translate the grid in real-time so the user sees their finger drag the content
      if (adx >= ady) {
        el.style.transform = `translateX(${dx}px)`;
      } else {
        el.style.transform = `translateY(${dy}px)`;
      }
    }

    if (moved && !hintFired) {
      let dir = null;
      if (adx >= HINT_PX && adx > ady) dir = dx < 0 ? 'left' : 'right';
      else if (ady >= HINT_PX && ady > adx) dir = dy < 0 ? 'up' : 'down';
      if (dir) { hintFired = true; callbacks.onHint?.(dir); }
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

      // Final finger position decides the action — if user has swiped back
      // toward origin, neither threshold is met and the grid snaps back.
      let committed = false;
      if (adx >= SWIPE_MIN_PX && adx > ady * SWIPE_RATIO) {
        committed = true;
        el.style.transform = ''; // clear before re-render
        if (dx < 0) callbacks.onSwipeLeft?.();
        else        callbacks.onSwipeRight?.();
      } else if (ady >= SWIPE_MIN_PX && ady > adx * SWIPE_RATIO) {
        committed = true;
        el.style.transform = ''; // clear before re-render
        if (dy < 0) callbacks.onSwipeUp?.();
        else        callbacks.onSwipeDown?.();
      }

      if (!committed) {
        // Animate snap-back to origin
        el.style.transition = 'transform 0.25s ease';
        el.style.transform  = '';
        setTimeout(() => { el.style.transition = ''; }, 260);
      }
    } else {
      el.style.transform = '';
    }

    startTarget = null;
  }, { passive: true });

  el.addEventListener('touchcancel', () => {
    clearTimeout(longPressTimer);
    el.querySelectorAll('.day-card.pressing').forEach(c => c.classList.remove('pressing'));
    callbacks.onHint?.(null);
    hintFired = false;
    if (moved) {
      el.style.transition = 'transform 0.25s ease';
      el.style.transform  = '';
      setTimeout(() => { el.style.transition = ''; }, 260);
    }
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

/** Lightweight swipe-only detector for overlays (expanded day, modals).
 *  options.shouldIgnoreTarget(target) — return true to suppress gesture start. */
export function initSwipe(el, callbacks, options = {}) {
  const { shouldIgnoreTarget } = options;
  let startX = 0, startY = 0, active = false, hintFired = false, swipeAxis = null;

  el.addEventListener('touchstart', e => {
    if (shouldIgnoreTarget?.(e.target)) { active = false; return; }
    startX     = e.touches[0].clientX;
    startY     = e.touches[0].clientY;
    active     = true;
    hintFired  = false;
    swipeAxis  = null;
    el.style.transition = ''; // cancel any in-progress snap-back
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    if (!active) return;
    const dx  = e.touches[0].clientX - startX;
    const dy  = e.touches[0].clientY - startY;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    // Lock to the dominant axis once we know it
    if (!swipeAxis) {
      if (adx >= HINT_PX && adx > ady) swipeAxis = 'h';
      else if (ady >= HINT_PX && ady > adx) swipeAxis = 'v';
    }

    // Translate the overlay in real-time so the user sees the drag
    if (swipeAxis === 'h') el.style.transform = `translateX(${dx}px)`;
    else if (swipeAxis === 'v') el.style.transform = `translateY(${dy}px)`;

    if (!hintFired) {
      if (adx >= HINT_PX && adx > ady) {
        hintFired = true;
        callbacks.onHint?.(dx < 0 ? 'left' : 'right');
      } else if (ady >= HINT_PX && ady > adx) {
        hintFired = true;
        callbacks.onHint?.(dy < 0 ? 'up' : 'down');
      }
    }
  }, { passive: true });

  el.addEventListener('touchend', e => {
    if (!active) return;
    active    = false;
    hintFired = false;
    callbacks.onHint?.(null);
    const dx  = e.changedTouches[0].clientX - startX;
    const dy  = e.changedTouches[0].clientY - startY;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    // Final position decides — swiping back before release cancels the action
    let committed = false;
    if (adx >= SWIPE_MIN_PX && adx > ady * SWIPE_RATIO) {
      committed = true;
      el.style.transform = ''; // clear before navigation replaces the overlay
      if (dx < 0) callbacks.onSwipeLeft?.();
      else        callbacks.onSwipeRight?.();
    } else if (ady >= SWIPE_MIN_PX && ady > adx * SWIPE_RATIO) {
      committed = true;
      el.style.transform = '';
      if (dy < 0) callbacks.onSwipeUp?.();
      else        callbacks.onSwipeDown?.();
    }

    if (!committed) {
      el.style.transition = 'transform 0.25s ease';
      el.style.transform  = '';
      setTimeout(() => { el.style.transition = ''; }, 260);
    }
    swipeAxis = null;
  }, { passive: true });

  el.addEventListener('touchcancel', () => {
    if (!active) return;
    active    = false;
    hintFired = false;
    swipeAxis = null;
    callbacks.onHint?.(null);
    el.style.transition = 'transform 0.25s ease';
    el.style.transform  = '';
    setTimeout(() => { el.style.transition = ''; }, 260);
  }, { passive: true });
}
