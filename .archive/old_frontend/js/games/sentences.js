/**
 * sentences.js - Game 4: 简单句对 (Sentences & Dialogues)
 * Shows an English sentence + Chinese, TTS reads it out,
 * player picks the correct response from 3 options.
 *
 * Exposed as window.SentencesGame
 */
(function () {
  'use strict';

  const SentencesGame = {
    start(container, vocab, onComplete) {
      const sentences = (vocab && vocab.sentences) || [];
      const age = (vocab && vocab.ageGroup) || 3;

      let pool = sentences.slice();
      let used = [];

      const pickRound = () => {
        if (pool.length === 0) { pool = sentences.slice(); used = []; }
        const correct = Utils.randomItem(pool);
        pool = pool.filter(s => s.id !== correct.id);
        used.push(correct);

        // Distractors: other wrong responses from the sentence pool
        let distractors = Utils.randomPick(
          sentences.filter(s => s.id !== correct.id),
          2
        ).map(s => ({
          text: s.response,
          zh: s.responseChinese
        }));

        // Fill from correct sentence's own wrong responses if needed
        const ownWrong = (correct.wrongResponses || []).map(t => ({ text: t, zh: '' }));
        while (distractors.length < 2) distractors.push(ownWrong.pop() || { text: 'I do not know.', zh: '我不知道。' });

        const options = Utils.shuffle([
          { text: correct.response, zh: correct.responseChinese, isCorrect: true }
        ].concat(distractors));

        return { correct, options };
      };

      const engine = new GameEngine({
        container,
        totalRounds: 10,
        pointsCorrect: 15,
        streakBonus: 0, // dialogues don't use streak bonus
        onRoundStart(round, eng) {
          const { correct, options } = pickRound();
          AppState.category = 'sentences';
          eng.currentCorrectId = correct.id; // expose for hint skill

          eng.stage.innerHTML = `
            <div class="keg-game__question keg-slide-in">
              <div class="keg-game__question-text--en">${Utils.escapeHtml(correct.english)}</div>
              <div class="keg-game__question-text--zh">${Utils.escapeHtml(correct.chinese)}</div>
              <button class="keg-btn keg-btn--ghost keg-btn--small" id="btn-listen">🔊 听句子</button>
            </div>
            <div class="keg-game__option-grid" style="margin-top:20px">
              ${options.map((o, i) => `
                <button class="keg-option keg-pop" data-i="${i}" style="flex-direction:column;gap:4px;animation-delay:${i * 0.06}s">
                  <span class="keg-option__en">${Utils.escapeHtml(o.text)}</span>
                  ${o.zh ? `<span class="keg-option__zh">${Utils.escapeHtml(o.zh)}</span>` : ''}
                </button>
              `).join('')}
            </div>
          `;

          // Speak the sentence at a slower, natural pace
          TTS.speak(correct.english, { rate: age <= 3 ? 0.8 : 0.85 });

          eng.stage.querySelector('#btn-listen').addEventListener('click', () => {
            Utils.playBeep('click');
            TTS.speak(correct.english, { rate: age <= 3 ? 0.8 : 0.85 });
          });

          let answered = false;
          eng.stage.querySelectorAll('.keg-option').forEach((btn, i) => {
            btn.addEventListener('click', () => {
              if (answered) return;
              answered = true;
              const isCorrect = options[i].isCorrect;
              const stat = eng.submitAnswer(isCorrect);

              eng.lock();
              eng.stage.querySelectorAll('.keg-option').forEach(b => b.classList.add('keg-option--disabled'));

              const correctBtn = options.findIndex(o => o.isCorrect);
              if (isCorrect) {
                btn.classList.add('keg-option--correct');
                const rect = btn.getBoundingClientRect();
                Utils.showStars(rect.left + rect.width / 2, rect.top + rect.height / 2, 8);
                Utils.playBeep('correct');
                TTS.speak('Perfect!');
              } else {
                btn.classList.add('keg-option--wrong');
                Utils.playBeep('wrong');
                TTS.speak('Good try. The answer is, ' + correct.response);
                eng.stage.querySelector(`.keg-option[data-i="${correctBtn}"]`).classList.add('keg-option--correct');
              }

              setTimeout(() => eng.nextRound(), 2200);
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

  window.SentencesGame = SentencesGame;
})();
