// question.js - Question modal logic
// Pops a 4-option multiple-choice question when the player touches a monster.
// Pass a word; returns a Promise<{ correct: bool, choice: string, correctAnswer: string }>
(function () {
  'use strict';

  // Static pool of common Chinese words used to pad the options when the
  // real vocabulary can't supply 3 distractors (tiny or offline word
  // pools). Without it the modal shows '...' buttons that still count as
  // wrong answers.
  const FALLBACK_DISTRACTORS = ['苹果', '书', '猫', '房子', '水', '朋友', '学校', '汽车', '鸟', '花', '太阳', '鱼', '狗', '桌子'];

  // A value that can actually be shown as a Chinese answer. Rejects the
  // empty/missing cases AND any entry whose "chinese" was left as English
  // text (a historical data bug that leaked English words into the option
  // list), so options always stay in the right language.
  function isRealChinese(s) {
    return typeof s === 'string' && s.trim().length > 0 && /[一-鿿]/.test(s);
  }

  // Build a 4-option question for the given word (Chinese meaning of the English word)
  function buildOptions(word, allWords) {
    const correct = (word && isRealChinese(word.chinese)) ? word.chinese : '...';
    const pool = Array.isArray(allWords) ? allWords.filter(w => w && isRealChinese(w.chinese)) : [];
    if (pool.length < 2) {
      console.warn('Not enough words in pool for options; using fallback distractors');
    }

    // Distractor words from the vocabulary, then shuffle with correct.
    // Distractors can never equal the correct answer (filtered by Chinese
    // meaning) and are deduped below, so cross-difficulty supplements are
    // safe even if a word repeats across difficulties.
    const sameCat = pool.filter(w => w.id !== word.id && w.chinese !== correct);
    // Prefer same difficulty first
    let distractorPool = sameCat.filter(w => w.difficulty === word.difficulty);
    if (distractorPool.length < 6) {
      const extras = sameCat.filter(w => w.difficulty !== word.difficulty);
      distractorPool = distractorPool.concat(extras);
    }

    // Remove duplicate Chinese meanings
    const uniquePool = distractorPool.filter((w, i, a) => a.findIndex(x => x.chinese === w.chinese) === i);

    let distractors = Utils.pickN(uniquePool, 3).map(w => w.chinese);
    // Pad with the static fallback list so the player always gets 4 real
    // choices instead of '...' buttons that can only ever be "wrong".
    if (distractors.length < 3) {
      const fallback = FALLBACK_DISTRACTORS.filter(c => c !== correct && !distractors.includes(c));
      distractors = distractors.concat(Utils.pickN(fallback, 3 - distractors.length));
    }

    // Ensure unique options. The '...' pad is added at most once (guarded
    // by includes) so a fallback pad can never show two identical '...'
    // buttons.
    const options = [correct, ...distractors].filter((v, i, a) => a.indexOf(v) === i);
    if (options.length < 4 && !options.includes('...')) options.push('...');
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
      let settled = false;
      let closeTimer = null;
      let fallbackTimer = null;

      // Single settlement path: stop speech, hide the modal, resolve exactly
      // once. game.js can hide the modal without answering (endLevel /
      // startLevel), so a fallback timer below guarantees this Promise
      // always settles and the game's `await Question.show(...)` can never
      // hang forever.
      const settle = (result) => {
        if (settled) return;
        settled = true;
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
        if (window.TTS && TTS.isSupported()) TTS.stop();
        modal.classList.add('hidden');
        resolve(result);
      };

      // Safety net: if the modal is dismissed externally before the player
      // clicks anything, resolve as a wrong answer so the awaiting
      // collision handler can bail out cleanly instead of leaking the
      // await forever. 30s is far beyond any normal answer time.
      fallbackTimer = setTimeout(() => {
        if (!settled && !answered) {
          settle({ correct: false, choice: null, correctAnswer: word.chinese });
        }
      }, 30000);

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

          // Close after a brief delay. settle() stops any still-running
          // TTS before hiding so the word isn't spoken over the resumed
          // game.
          closeTimer = setTimeout(() => {
            settle({ correct, choice: opt, correctAnswer: word.chinese });
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
