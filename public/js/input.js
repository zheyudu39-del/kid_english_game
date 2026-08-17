// input.js - Keyboard + touch joystick input
(function () {
  'use strict';

  class Input {
    constructor() {
      this.state = {
        up: false, down: false, left: false, right: false, fire: false
      };
      this._touchActive = false;
      this._touchVec = { x: 0, y: 0 };
      // Set true while an external (login/register) modal is open so the
      // game can stop reading input axes. Keyboard preventDefault is also
      // skipped for movement keys so users can type normally in form fields.
      this._locked = false;
      this._setupKeyboard();
      this._setupJoystick();
      this._setupFireButton();
      this._isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    }

    isMobile() { return this._isMobile; }

    // True while a modal is locking game input. Used by Game._update()
    // (via getMoveVector returning zero) and by the keyboard listener
    // (to skip preventDefault on form fields).
    isLocked() { return this._locked; }

    setLocked(flag) {
      this._locked = !!flag;
      // Drop all held inputs the moment we lock, so resuming doesn't
      // immediately shoot the player in the last-pressed direction.
      if (this._locked) {
        this.state.up = false;
        this.state.down = false;
        this.state.left = false;
        this.state.right = false;
        this.state.fire = false;
        this._touchActive = false;
        this._touchVec.x = 0;
        this._touchVec.y = 0;
      }
    }

    _setupKeyboard() {
      window.addEventListener('keydown', e => {
        const k = e.key.toLowerCase();
        // While a modal is open, leave typing alone — only consume
        // keys when we're not on a form field.
        if (this._locked) return;
        // Never consume keys while the user is typing in an editable
        // field (e.g. the title-screen nickname input, which is NOT
        // behind a lockable modal). Otherwise 'w'/'a'/'s'/'d' and the
        // arrow keys would be swallowed by preventDefault and could not
        // be typed into the nickname.
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                  t.tagName === 'SELECT' || t.isContentEditable)) return;
        if (k === 'arrowup' || k === 'w')    { this.state.up = true; e.preventDefault(); }
        if (k === 'arrowdown' || k === 's')  { this.state.down = true; e.preventDefault(); }
        if (k === 'arrowleft' || k === 'a')  { this.state.left = true; e.preventDefault(); }
        if (k === 'arrowright' || k === 'd') { this.state.right = true; e.preventDefault(); }
        if (k === ' ' || k === 'spacebar' || k === 'j') { this.state.fire = true; e.preventDefault(); }
      });
      window.addEventListener('keyup', e => {
        const k = e.key.toLowerCase();
        if (k === 'arrowup' || k === 'w')    this.state.up = false;
        if (k === 'arrowdown' || k === 's')  this.state.down = false;
        if (k === 'arrowleft' || k === 'a')  this.state.left = false;
        if (k === 'arrowright' || k === 'd') this.state.right = false;
        if (k === ' ' || k === 'spacebar' || k === 'j') this.state.fire = false;
      });
      // If the window loses focus (alt-tab / clicking outside) while a key
      // is held, the keyup event is lost and the direction stays stuck.
      // Clear all held input whenever the page stops being visible/focused.
      window.addEventListener('blur', () => this.reset());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.reset();
      });
    }

    // Clear every held input (keys + joystick drag) without locking.
    // Called when returning to the title screen and on window blur, so a
    // fresh level never starts with the player already moving.
    reset() {
      this.state.up = false;
      this.state.down = false;
      this.state.left = false;
      this.state.right = false;
      this.state.fire = false;
      this._touchActive = false;
      this._touchVec.x = 0;
      this._touchVec.y = 0;
      if (this._joystick && this._joystick.knob) {
        const knob = this._joystick.knob;
        knob.classList.remove('active');
        try {
          const r = this._joystick.base.getBoundingClientRect();
          knob.style.left = (r.width / 2 - 28) + 'px';
          knob.style.top = (r.height / 2 - 28) + 'px';
        } catch (e) { /* element not laid out yet; knob reset is cosmetic */ }
      }
    }

    _setupJoystick() {
      const joystick = document.getElementById('joystick');
      const base = joystick.querySelector('.joystick-base');
      const knob = document.getElementById('joystick-knob');
      this._joystick = { el: joystick, base, knob };
      const knobRadius = 28;
      const maxDist = 38;
      let activeTouchId = null;   // track OUR touch by identifier

      const start = (e) => {
        // While a modal is open, ignore joystick presses entirely.
        if (this._locked) return;
        // Already tracking a touch — ignore additional fingers on the joystick.
        if (activeTouchId !== null) return;
        e.preventDefault();
        const t = e.changedTouches ? e.changedTouches[0] : e;
        activeTouchId = t.identifier || 'mouse';
        this._touchActive = true;
        knob.classList.add('active');
        // Apply the initial position immediately so the player starts
        // moving without waiting for the next touchmove event.
        applyTouch(t);
      };

      const findTouch = (e) => {
        if (activeTouchId === 'mouse') return e;
        for (let i = 0; i < e.touches.length; i++) {
          if (e.touches[i].identifier === activeTouchId) return e.touches[i];
        }
        // Also check changedTouches (for touchend, our touch is gone from touches)
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === activeTouchId) return e.changedTouches[i];
        }
        return null;
      };

      const applyTouch = (t) => {
        // Recompute baseRect every time so the centre is always correct
        // (e.g. after mobile address bar shows/hides and shifts the viewport).
        const rect = base.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        let dx = t.clientX - cx;
        let dy = t.clientY - cy;
        const d = Math.hypot(dx, dy);
        if (d > maxDist) { dx = dx * maxDist / d; dy = dy * maxDist / d; }
        knob.style.left = (rect.width / 2 + dx - knobRadius) + 'px';
        knob.style.top  = (rect.height / 2 + dy - knobRadius) + 'px';
        this._touchVec.x = dx / maxDist;
        this._touchVec.y = dy / maxDist;
      };

      const move = (e) => {
        if (!this._touchActive || this._locked) return;
        const t = findTouch(e);
        if (!t) return;
        e.preventDefault();
        applyTouch(t);
      };

      const end = (e) => {
        // Only reset when OUR touch ends (not some other finger).
        if (activeTouchId === null) return;
        let ourTouchEnded = false;
        if (e.changedTouches) {
          for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === activeTouchId) {
              ourTouchEnded = true;
              break;
            }
          }
        } else {
          // Mouse event — always reset.
          ourTouchEnded = true;
        }
        if (!ourTouchEnded) return;
        if (e && e.type !== 'mouseup') e.preventDefault();
        activeTouchId = null;
        this._touchActive = false;
        this._touchVec.x = 0;
        this._touchVec.y = 0;
        const rect = base.getBoundingClientRect();
        knob.style.left = (rect.width / 2 - knobRadius) + 'px';
        knob.style.top  = (rect.height / 2 - knobRadius) + 'px';
        knob.classList.remove('active');
      };

      // Touch events
      joystick.addEventListener('touchstart', start, { passive: false });
      joystick.addEventListener('touchmove', move, { passive: false });
      joystick.addEventListener('touchend', end);
      joystick.addEventListener('touchcancel', end);
      // Mouse fallback (desktop only — on mobile we rely on touch events)
      if (!this._isMobile) {
        joystick.addEventListener('mousedown', start);
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', end);
      }
    }

    _setupFireButton() {
      const btn = document.getElementById('fire-btn');
      if (!btn) return;
      const press = (e) => {
        if (this._locked) return;
        e.preventDefault();
        this.state.fire = true;
      };
      const release = () => { this.state.fire = false; };
      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointerleave', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    showJoystick() {
      document.getElementById('joystick').classList.remove('hidden');
      const fb = document.getElementById('fire-btn');
      if (fb) fb.classList.remove('hidden');
    }
    hideJoystick() {
      document.getElementById('joystick').classList.add('hidden');
      const fb = document.getElementById('fire-btn');
      if (fb) fb.classList.add('hidden');
    }

    // Returns { x, y, magnitude } of the current input as a normalized direction
    getMoveVector() {
      // When an external modal is open, force a zero vector. Belt-and-
      // suspenders alongside Game.paused: ensures no movement input
      // ever reaches the player while the auth UI is showing.
      if (this._locked) return { x: 0, y: 0, magnitude: 0 };
      let x = 0, y = 0;
      if (this.state.left)  x -= 1;
      if (this.state.right) x += 1;
      if (this.state.up)    y -= 1;
      if (this.state.down)  y += 1;

      // Mix in joystick if active
      if (this._touchActive && (Math.abs(this._touchVec.x) > 0.15 || Math.abs(this._touchVec.y) > 0.15)) {
        x = this._touchVec.x;
        y = this._touchVec.y;
      }

      const m = Math.hypot(x, y);
      if (m > 0) { x /= m; y /= m; }
      return { x, y, magnitude: m };
    }
  }

  window.Input = Input;
})();
