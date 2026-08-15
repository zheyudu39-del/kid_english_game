// input.js - Keyboard + touch joystick input
(function () {
  'use strict';

  class Input {
    constructor() {
      this.state = {
        up: false, down: false, left: false, right: false
      };
      this._touchActive = false;
      this._touchVec = { x: 0, y: 0 };
      // Set true while an external (login/register) modal is open so the
      // game can stop reading input axes. Keyboard preventDefault is also
      // skipped for movement keys so users can type normally in form fields.
      this._locked = false;
      this._setupKeyboard();
      this._setupJoystick();
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
      });
      window.addEventListener('keyup', e => {
        const k = e.key.toLowerCase();
        if (k === 'arrowup' || k === 'w')    this.state.up = false;
        if (k === 'arrowdown' || k === 's')  this.state.down = false;
        if (k === 'arrowleft' || k === 'a')  this.state.left = false;
        if (k === 'arrowright' || k === 'd') this.state.right = false;
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
      let baseRect = null;
      let knobRadius = 28;
      const maxDist = 38;

      const start = (e) => {
        // While a modal is open, ignore joystick presses entirely.
        if (this._locked) return;
        e.preventDefault();
        this._touchActive = true;
        baseRect = base.getBoundingClientRect();
        knob.classList.add('active');
      };
      const move = (e) => {
        if (!this._touchActive || !baseRect || this._locked) return;
        e.preventDefault();
        const t = e.touches ? e.touches[0] : e;
        const cx = baseRect.left + baseRect.width / 2;
        const cy = baseRect.top + baseRect.height / 2;
        let dx = t.clientX - cx;
        let dy = t.clientY - cy;
        const d = Math.hypot(dx, dy);
        if (d > maxDist) { dx = dx * maxDist / d; dy = dy * maxDist / d; }
        knob.style.left = (baseRect.width / 2 + dx - knobRadius) + 'px';
        knob.style.top  = (baseRect.height / 2 + dy - knobRadius) + 'px';
        // Normalized vector
        this._touchVec.x = dx / maxDist;
        this._touchVec.y = dy / maxDist;
      };
      const end = (e) => {
        if (e) e.preventDefault();
        this._touchActive = false;
        this._touchVec.x = 0;
        this._touchVec.y = 0;
        if (baseRect) {
          knob.style.left = (baseRect.width / 2 - knobRadius) + 'px';
          knob.style.top  = (baseRect.height / 2 - knobRadius) + 'px';
        }
        knob.classList.remove('active');
      };

      // Touch events
      joystick.addEventListener('touchstart', start, { passive: false });
      joystick.addEventListener('touchmove', move, { passive: false });
      joystick.addEventListener('touchend', end);
      joystick.addEventListener('touchcancel', end);
      // Mouse fallback (for desktop testing)
      joystick.addEventListener('mousedown', start);
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', end);
    }

    showJoystick() { document.getElementById('joystick').classList.remove('hidden'); }
    hideJoystick() { document.getElementById('joystick').classList.add('hidden'); }

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
