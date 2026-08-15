// tts.js - Text-to-Speech wrapper
(function () {
  'use strict';

  let cachedVoices = [];

  function loadVoices() {
    if (window.speechSynthesis) {
      cachedVoices = window.speechSynthesis.getVoices();
    }
  }

  if (window.speechSynthesis) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  function getEnglishVoice() {
    if (cachedVoices.length === 0) loadVoices();
    const en = cachedVoices.filter(v => v.lang && v.lang.startsWith('en'));
    if (en.length === 0) return null;
    const us = en.find(v => v.lang === 'en-US');
    if (us) return us;
    return en[0];
  }

  const TTS = {
    speak(text, opts = {}) {
      if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance === 'undefined') {
        return false;
      }
      const synth = window.speechSynthesis;
      // Cancel anything still speaking so rapid consecutive questions /
      // replays never queue up into overlapping speech.
      synth.cancel();
      if (this._pending) clearTimeout(this._pending);
      // Chromium ignores a speak() issued in the same task as cancel(),
      // which would silently drop the next word. Defer by one short tick
      // (and clear any earlier pending speak).
      this._pending = setTimeout(() => {
        this._pending = null;
        try {
          const utter = new SpeechSynthesisUtterance(text);
          utter.lang = 'en-US';
          const voice = getEnglishVoice();
          if (voice) utter.voice = voice;
          utter.rate = opts.rate !== undefined ? opts.rate : 0.9;
          utter.pitch = opts.pitch !== undefined ? opts.pitch : 1.0;
          // Keep a strong reference: Chrome is known to garbage-collect the
          // utterance mid-speech when nothing holds it, cutting words off.
          this._current = utter;
          synth.speak(utter);
        } catch (err) { /* TTS unavailable/blocked — fail silently */ }
      }, 50);
      return true;
    },

    stop() {
      if (this._pending) { clearTimeout(this._pending); this._pending = null; }
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    },

    isSupported() {
      return !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
    }
  };

  window.TTS = TTS;
})();
