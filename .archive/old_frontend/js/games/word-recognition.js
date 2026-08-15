/**
 * word-recognition.js - Game 1: 单词认知 (Word Recognition)
 * Shows a big emoji + Chinese hint, player picks the correct English word.
 *
 * Exposed as window.WordRecognitionGame
 */
(function () {
  'use strict';

  const WordRecognitionGame = {
    /**
     * @param {HTMLElement} container
     * @param {object} vocab - vocabulary data ({ words, ageGroup, ... })
     * @param {Function} onComplete - (stats) => void
     */
    start(container, vocab, onComplete) {
      const words = (vocab && vocab.words) || [];
      const age = (vocab && vocab.ageGroup) || 3;
      // Young kids (3-4) see only 3 options; older kids see 4
      const optionCount = age <= 3 ? 3 : 4;

      let pool = words.slice();
      let used = [];

      const pickRoundWords = () => {
        if (pool.length === 0) { pool = words.slice(); used = []; }
        const correct = Utils.randomItem(pool);
        pool = pool.filter(w => w.id !== correct.id);
        used.push(correct);

        // Distractors: prefer same category + difficulty; fall back to any
        const candidates = words.filter(w =>
          w.id !== correct.id &&
          w.category === correct.category &&
          w.difficulty === correct.difficulty
        );
        let distractors = Utils.randomPick(candidates, optionCount - 1);
        if (distractors.length < optionCount - 1) {
          const extra = words.filter(w =>
            w.id !== correct.id && !distractors.includes(w)
          );
          distractors = distractors.concat(
            Utils.randomPick(extra, optionCount - 1 - distractors.length)
          );
        }
        const options = Utils.shuffle([correct].concat(distractors));
        return { correct, options };
      };

      const engine = new GameEngine({
        container,
        totalRounds: 10,
        pointsCorrect: 10,
        onRoundStart(round, eng) {
          const { correct, options } = pickRoundWords();
          AppState.category = correct.category;
          eng.currentCorrectId = correct.id; // expose for hint skill

          eng.stage.innerHTML = `
            <div class="keg-game__question keg-slide-in">
              <div class="keg-game__question-emoji">${correct.emoji}</div>
              <div class="keg-game__question-text--zh">${Utils.escapeHtml(correct.chinese)}</div>
              <button class="keg-btn keg-btn--ghost keg-btn--small" id="btn-listen">🔊 听发音</button>
            </div>
            <div class="keg-game__option-grid" style="margin-top:20px">
              ${options.map((w, i) => `
                <button class="keg-option keg-pop" data-index="${i}" data-id="${w.id}" style="animation-delay:${i * 0.06}s">
                  <span class="keg-option__en">${Utils.escapeHtml(w.english)}</span>
                  ${w.phonetic ? `<span class="keg-option__phonetic">${Utils.escapeHtml(w.phonetic)}</span>` : ''}
                </button>
              `).join('')}
            </div>
          `;

          // Speak the correct word
          TTS.speak(correct.english, { rate: age <= 3 ? 0.85 : 0.9 });

          const listenBtn = eng.stage.querySelector('#btn-listen');
          if (listenBtn) {
            listenBtn.addEventListener('click', () => TTS.speak(correct.english));
          }

          let answered = false;
          eng.stage.querySelectorAll('.keg-option').forEach(btn => {
            btn.addEventListener('click', () => {
              if (answered) return;
              answered = true;
              const isCorrect = btn.dataset.id === correct.id;
              const stat = eng.submitAnswer(isCorrect);

              eng.lock();
              eng.stage.querySelectorAll('.keg-option').forEach(b => b.classList.add('keg-option--disabled'));

              if (isCorrect) {
                btn.classList.add('keg-option--correct');
                const rect = btn.getBoundingClientRect();
                Utils.showStars(rect.left + rect.width / 2, rect.top + rect.height / 2);
                Utils.playBeep('correct');
                TTS.speak('Great job!');
              } else {
                btn.classList.add('keg-option--wrong');
                Utils.playBeep('wrong');
                TTS.speak('Try again. The answer is ' + correct.english);
                eng.stage.querySelector(`.keg-option[data-id="${correct.id}"]`).classList.add('keg-option--correct');
              }

              setTimeout(() => eng.nextRound(), 1800);
            });
          });
        },
        onGameEnd(stats) {
          onComplete(stats);
        }
      });

      engine.start();
    }
  };

  window.WordRecognitionGame = WordRecognitionGame;
})();
