// essay.js - Boss translation modal (中文作文 → 英文翻译).
// The boss engages the player with a ~50-character Chinese essay; the
// player types an English translation. Grading is keyword-based and
// kid-lenient (essays.js). Resolves { correct, text, details } exactly
// once, mirroring Question.show's single-settlement contract.
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  function show(essay) {
    return new Promise((resolve) => {
      const modal = el('translation-modal');
      const essayEl = el('translation-essay');
      const input = el('translation-input');
      const submitBtn = el('translation-submit');
      const feedbackEl = el('translation-feedback');

      essayEl.textContent = essay.zh;
      input.value = '';
      input.disabled = false;
      feedbackEl.textContent = '';
      feedbackEl.className = 'translation-feedback';
      submitBtn.classList.remove('hidden');
      // Debug/test hook so an E2E test can build a perfect translation.
      window.Essay = window.Essay || {};
      window.Essay._lastEssay = essay;

      let settled = false;
      let fallbackTimer = null;
      let closeTimer = null;

      const settle = (result) => {
        if (settled) return;
        settled = true;
        if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        if (window.TTS && TTS.isSupported()) TTS.stop();
        // Remove event listeners so they don't accumulate across repeated
        // boss attempts (re-shooting after a wrong translation).
        submitBtn.removeEventListener('click', onSubmit);
        input.removeEventListener('keydown', onKeyDown);
        modal.classList.add('hidden');
        resolve(result);
      };

      // Safety net: dismissed externally (endLevel / restart) — resolve as
      // wrong so the awaiting engage handler can bail out cleanly.
      fallbackTimer = setTimeout(() => {
        settle({ correct: false, text: '', details: [], timedOut: true });
      }, 300000); // generous: kids type slowly

      const onSubmit = () => {
        if (settled) return;
        const text = input.value.trim();
        if (!text) {
          feedbackEl.textContent = '先写几句英文再提交吧！不会的单词可以用简单的说法～';
          feedbackEl.className = 'translation-feedback wrong';
          return;
        }
        const result = window.Essays.grade(essay, text);
        input.disabled = true;
        submitBtn.classList.add('hidden');
        renderFeedback(essay, result);

        if (result.correct) {
          Utils.playBeep('correct');
        } else {
          Utils.playBeep('wrong');
        }
        // Speak the reference translation so kids hear the model answer.
        const fullEn = essay.sentences.map(s => s.en).join(' ');
        if (window.TTS && TTS.isSupported()) TTS.speak(fullEn);

        closeTimer = setTimeout(() => {
          settle({ correct: result.correct, text, details: result.details });
        }, result.correct ? 2600 : 4200);
      };

      const onKeyDown = (e) => {
        // Ctrl+Enter submits; plain Enter stays available for new lines.
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          onSubmit();
        }
      };

      function renderFeedback(essay, result) {
        feedbackEl.textContent = '';
        feedbackEl.className = 'translation-feedback ' + (result.correct ? 'correct' : 'wrong');
        const head = document.createElement('div');
        head.className = 'translation-verdict';
        head.textContent = result.correct
          ? '🎉 翻译得太棒了！Boss 被你打败了！'
          : '还差一点点，看看参考答案，再试一次！';
        feedbackEl.appendChild(head);

        essay.sentences.forEach((s, i) => {
          const d = result.details[i];
          const line = document.createElement('div');
          line.className = 'translation-line' + (d.pass ? ' pass' : ' fail');
          const mark = document.createElement('span');
          mark.className = 'translation-line__mark';
          mark.textContent = d.pass ? '✓' : '✗';
          const zh = document.createElement('span');
          zh.className = 'translation-line__zh';
          zh.textContent = s.zh;
          const en = document.createElement('span');
          en.className = 'translation-line__en';
          en.textContent = s.en;
          const miss = document.createElement('span');
          miss.className = 'translation-line__miss';
          miss.textContent = d.matched.length < d.keys.length
            ? ('缺少: ' + d.keys.filter(k => !d.matched.includes(k)).join(' / '))
            : '';
          line.append(mark, zh, en, miss);
          feedbackEl.appendChild(line);
        });

        if (!result.correct) {
          const again = document.createElement('div');
          again.className = 'translation-again';
          again.textContent = 'Boss 恼羞成怒，向你发动了攻击！重新射击 Boss 再挑战一次';
          feedbackEl.appendChild(again);
        }
      }

      submitBtn.addEventListener('click', onSubmit);
      input.addEventListener('keydown', onKeyDown);

      if (window.TTS && TTS.isSupported()) {
        // Reading the Chinese essay aloud isn't supported (English voice
        // only), so no auto-speak here.
      }

      modal.classList.remove('hidden');
      setTimeout(() => { if (!settled) input.focus(); }, 60);
    });
  }

  window.Essay = Object.assign(window.Essay || {}, { show });
})();
