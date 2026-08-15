/**
 * tts.js - Text-to-Speech wrapper using the browser Web Speech API
 * Exposed as window.TTS
 */
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
    // Chrome loads voices asynchronously
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  /**
   * Pick the best English voice available.
   * Prefers en-US female if present, otherwise any English voice.
   */
  function getEnglishVoice() {
    if (cachedVoices.length === 0) loadVoices();
    const en = cachedVoices.filter(v => v.lang && v.lang.startsWith('en'));
    if (en.length === 0) return null;

    const us = en.find(v => v.lang === 'en-US' && /female|zira|samantha|jenny/i.test(v.name));
    if (us) return us;
    const usAny = en.find(v => v.lang === 'en-US');
    if (usAny) return usAny;
    return en[0];
  }

  const TTS = {
    /**
     * Speak English text.
     * @param {string} text - text to speak
     * @param {object} opts - { rate, pitch, onend }
     */
    speak(text, opts = {}) {
      if (!window.speechSynthesis) return false;

      // Cancel any previous speech to avoid queue pile-up
      window.speechSynthesis.cancel();

      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'en-US';
      const voice = getEnglishVoice();
      if (voice) utter.voice = voice;
      utter.rate = opts.rate !== undefined ? opts.rate : 0.9;
      utter.pitch = opts.pitch !== undefined ? opts.pitch : 1.1;
      if (typeof opts.onend === 'function') utter.onend = opts.onend;
      if (typeof opts.onerror === 'function') utter.onerror = opts.onerror;

      window.speechSynthesis.speak(utter);
      return true;
    },

    /**
     * Speak a Chinese phrase (feedback text).
     */
    speakZh(text) {
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'zh-CN';
      utter.rate = 0.9;
      window.speechSynthesis.speak(utter);
    },

    stop() {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    },

    isSpeaking() {
      return !!(window.speechSynthesis && window.speechSynthesis.speaking);
    },

    isSupported() {
      return !!window.speechSynthesis;
    },

    getVoices() {
      if (cachedVoices.length === 0) loadVoices();
      return cachedVoices;
    }
  };

  window.TTS = TTS;
})();
