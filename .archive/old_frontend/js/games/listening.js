/**
 * listening.js - Game 2: 听力反应 (Listening Reaction)
 * Audio-only question: TTS speaks a word, player clicks the matching emoji.
 *
 * Exposed as window.ListeningGame
 */
(function () {
  'use strict';

  const ListeningGame = {
    start(container, vocab, onComplete) {
      const words = (vocab && vocab.words) || [];
      const age = (vocab && vocab.ageGroup) || 3;
      const optionCount = age <= 3 ? 4 : 4;

      let pool = words.slice();
      let used = [];

      const pickRound = () => {
        if (pool.length === 0) { pool = words.slice(); used = []; }
        const correct = Utils.randomItem(pool);
        pool = pool.filter(w => w.id !== correct.id);
        used.push(correct);

        // For young kids use visually distinct words (different categories);
        // for older kids use same-category distractors.
        let candidates;
        if (age <= 3) {
          candidates = words.filter(w =>
            w.id !== correct.id &&
            w.category !== correct.category &&
            w.emoji !== correct.emoji
          );
        } else {
          candidates = words.filter(w =>
            w.id !== correct.id &&
            w.category === correct.category
          );
        }
        let distractors = Utils.randomPick(candidates, optionCount - 1);
        if (distractors.length < optionCount - 1) {
          const extra = words.filter(w =>
            w.id !== correct.id &&
            w.emoji !== correct.emoji &&
            !distractors.includes(w)
          );
          distractors = distractors.concat(
            Utils.randomPick(extra, optionCount - 1 - distractors.length)
          );
        }
        const options = Utils.shuffle([correct].concat(distractors));
        return { correct, options };
      };

      const speakWord = (word, rate) => {
        // Speak twice with a short gap for clarity
        TTS.speak(word.english, { rate });
        setTimeout(() => TTS.speak(word.english, { rate }), 900);
      };

      const engine = new GameEngine({
        container,
        totalRounds: 10,
        pointsCorrect: 10,
        onRoundStart(round, eng) {
          const { correct, options } = pickRound();
          AppState.category = correct.category;
          eng.currentCorrectId = correct.id; // expose for hint skill

          eng.stage.innerHTML = `
            <div class="keg-game__question keg-slide-in">
              <div class="keg-game__question-text--zh">👂 听一听，选对图！</div>
              <div class="keg-game__question-text" style="font-size:22px;color:var(--keg-light)">
                刚才说的英文是哪个？
              </div>
              <button class="keg-btn keg-btn--ghost keg-btn--small" id="btn-listen">🔊 再听一遍</button>
            </div>
            <div class="keg-game__option-grid" style="margin-top:20px">
              ${options.map((w, i) => `
                <button class="keg-option keg-option--emoji keg-pop" data-index="${i}" data-id="${w.id}" style="animation-delay:${i * 0.06}s">
                  ${w.emoji}
                </button>
              `).join('')}
            </div>
          `;

          speakWord(correct, age <= 3 ? 0.85 : 0.9);

          eng.stage.querySelector('#btn-listen').addEventListener('click', () => {
            Utils.playBeep('click');
            speakWord(correct, age <= 3 ? 0.85 : 0.9);
          });

          let answered = false;
          eng.stage.querySelectorAll('.keg-option').forEach(btn => {
            btn.addEventListener('click', () => {
              if (answered) return;
              answered = true;
              const isCorrect = btn.dataset.id === correct.id;
              const stat = eng.submitAnswer(isCorrect);

              eng.lock();
              eng.stage.querySelectorAll('.keg-option').forEach(b => b.classList.add('keg-option--disabled'));

              // Reveal the word + phonetic after answering
              const reveal = Utils.el('div', 'keg-game__question-phonetic keg-slide-in',
                correct.english + (correct.phonetic ? '  ' + correct.phonetic : ''));
              eng.stage.appendChild(reveal);

              if (isCorrect) {
                btn.classList.add('keg-option--correct');
                const rect = btn.getBoundingClientRect();
                Utils.showStars(rect.left + rect.width / 2, rect.top + rect.height / 2);
                Utils.playBeep('correct');
                TTS.speak('Correct! ' + correct.english);
              } else {
                btn.classList.add('keg-option--wrong');
                Utils.playBeep('wrong');
                TTS.speak('Try again. It is ' + correct.english);
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

  window.ListeningGame = ListeningGame;
})();
