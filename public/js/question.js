// question.js - Question modal logic
// Pops a 4-option multiple-choice question when the player touches a monster.
// Pass a word; returns a Promise<{ correct: bool, choice: string, correctAnswer: string }>
(function () {
  'use strict';

  // Build a 4-option question for the given word (Chinese meaning of the English word)
  function buildOptions(word, allWords) {
    // Validate input
    if (!allWords || allWords.length < 2) {
      console.warn('Not enough words in pool for options');
      return [word.chinese, '...', '...', '...'];
    }

    // 3 distractor words from same category/difficulty, then shuffle with correct
    const sameCat = allWords.filter(w =>
      w.id !== word.id &&
      w.chinese !== word.chinese &&
      w.chinese &&
      w.difficulty
    );
    // Prefer same difficulty first
    let pool = sameCat.filter(w => w.difficulty === word.difficulty);
    if (pool.length < 6) {
      const extras = sameCat.filter(w => w.difficulty !== word.difficulty);
      pool = pool.concat(extras);
    }

    // Remove duplicates from pool
    const uniquePool = pool.filter((w, i, a) => a.findIndex(x => x.chinese === w.chinese) === i);

    const distractors = Utils.pickN(uniquePool, 3).map(w => w.chinese);
    // Ensure unique options
    const options = [word.chinese, ...distractors].filter((v, i, a) => a.indexOf(v) === i);
    while (options.length < 4) options.push('...');
    return Utils.shuffle(options.slice(0, 4));
  }

  function show(word, allWords) {
    return new Promise((resolve) => {
      const modal = document.getElementById('question-modal');
      const monsterEl = document.getElementById('modal-monster');
      const wordEl = document.getElementById('modal-word');
      const optionsEl = document.getElementById('modal-options');
      const feedbackEl = document.getElementById('modal-feedback');

      // Display
      monsterEl.textContent = '📚';
      wordEl.textContent = word.english;
      feedbackEl.textContent = '';
      feedbackEl.className = 'modal-feedback';

      const options = buildOptions(word, allWords);
      optionsEl.innerHTML = '';
      let answered = false;

      options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'modal-option';
        btn.textContent = opt;
        btn.addEventListener('click', () => {
          if (answered) return;
          answered = true;
          const correct = opt === word.chinese;
          // Mark buttons
          optionsEl.querySelectorAll('.modal-option').forEach(b => {
            b.classList.add('disabled');
            if (b.textContent === word.chinese) b.classList.add('correct');
            else if (b === btn && !correct) b.classList.add('wrong');
          });

          if (correct) {
            feedbackEl.textContent = 'CORRECT!';
            feedbackEl.className = 'modal-feedback correct';
            Utils.playBeep('correct');
          } else {
            feedbackEl.textContent = 'WRONG! ' + word.english + ' = ' + word.chinese;
            feedbackEl.className = 'modal-feedback wrong';
            Utils.playBeep('wrong');
          }

          // Speak the correct word
          if (window.TTS && TTS.isSupported()) {
            TTS.speak(word.english);
          }

          // Close after a brief delay
          setTimeout(() => {
            modal.classList.add('hidden');
            resolve({ correct, choice: opt, correctAnswer: word.chinese });
          }, correct ? 700 : 1400);
        });
        optionsEl.appendChild(btn);
      });

      // Speak the word when the question pops
      if (window.TTS && TTS.isSupported()) {
        TTS.speak(word.english);
      }

      modal.classList.remove('hidden');
    });
  }

  window.Question = { show };
})();
