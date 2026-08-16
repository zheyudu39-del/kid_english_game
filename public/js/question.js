// question.js - Question modal logic
// Pops a multiple-choice question when the player touches a monster.
// Pass a word + the vocabulary pool; returns a Promise
// { correct, choice, correctAnswer, type }.
//
// Question types (opts.type, default 'en2cn'):
//   en2cn   — see the English word, pick its Chinese meaning (classic)
//   cn2en   — see the Chinese meaning, pick the English word
//   listen  — hear the word via TTS (no text shown), pick the English word
//   spell   — see Chinese + the word with one letter blanked, pick the letter
(function () {
  'use strict';

  // Static pool of common Chinese words used to pad the options when the
  // real vocabulary can't supply 3 distractors (tiny or offline word
  // pools). Without it the modal shows '...' buttons that still count as
  // wrong answers.
  const FALLBACK_DISTRACTORS = ['苹果', '书', '猫', '房子', '水', '朋友', '学校', '汽车', '鸟', '花', '太阳', '鱼', '狗', '桌子'];

  const PROMPTS = {
    en2cn: '选出正确的中文意思',
    cn2en: '选出正确的英文单词',
    listen: '听一听，选出你听到的单词',
    spell: '补全缺失的字母'
  };

  // A value that can actually be shown as a Chinese answer. Rejects the
  // empty/missing cases AND any entry whose "chinese" was left as English
  // text (a historical data bug that leaked English words into the option
  // list), so options always stay in the right language.
  function isRealChinese(s) {
    return typeof s === 'string' && s.trim().length > 0 && /[一-鿿]/.test(s);
  }

  function isRealEnglish(s) {
    return typeof s === 'string' && /^[a-zA-Z][a-zA-Z -]*$/.test(s.trim()) && s.trim().length > 0;
  }

  // ---- option builders per type. Each returns { options:[4 strings],
  // isCorrect(opt) }. Distractors prefer same-difficulty vocabulary and are
  // deduped, with static fallbacks so there are always 4 real choices. ----

  function buildChineseOptions(word, allWords) {
    const correct = (word && isRealChinese(word.chinese)) ? word.chinese : '...';
    const pool = Array.isArray(allWords) ? allWords.filter(w => w && isRealChinese(w.chinese)) : [];
    if (pool.length < 2) {
      console.warn('Not enough words in pool for options; using fallback distractors');
    }

    const sameCat = pool.filter(w => w.id !== word.id && w.chinese !== correct);
    let distractorPool = sameCat.filter(w => w.difficulty === word.difficulty);
    if (distractorPool.length < 6) {
      const extras = sameCat.filter(w => w.difficulty !== word.difficulty);
      distractorPool = distractorPool.concat(extras);
    }
    const uniquePool = distractorPool.filter((w, i, a) => a.findIndex(x => x.chinese === w.chinese) === i);

    let distractors = Utils.pickN(uniquePool, 3).map(w => w.chinese);
    if (distractors.length < 3) {
      const fallback = FALLBACK_DISTRACTORS.filter(c => c !== correct && !distractors.includes(c));
      distractors = distractors.concat(Utils.pickN(fallback, 3 - distractors.length));
    }

    const options = [correct, ...distractors].filter((v, i, a) => a.indexOf(v) === i);
    if (options.length < 4 && !options.includes('...')) options.push('...');
    return { options: Utils.shuffle(options.slice(0, 4)), isCorrect: (opt) => opt === correct };
  }

  function buildEnglishOptions(word, allWords) {
    const correct = (word && isRealEnglish(word.english)) ? word.english.trim() : '...';
    const pool = Array.isArray(allWords) ? allWords.filter(w => w && isRealEnglish(w.english)) : [];
    const sameCat = pool.filter(w => w.english !== correct);
    let distractorPool = sameCat.filter(w => w.difficulty === word.difficulty);
    if (distractorPool.length < 6) {
      const extras = sameCat.filter(w => w.difficulty !== word.difficulty);
      distractorPool = distractorPool.concat(extras);
    }
    const uniquePool = distractorPool.filter((w, i, a) => a.findIndex(x => x.english.trim() === w.english.trim()) === i);

    let distractors = Utils.pickN(uniquePool, 3).map(w => w.english.trim());
    if (distractors.length < 3) {
      const fallback = ['apple', 'water', 'house', 'happy', 'green', 'tiger', 'bread', 'music']
        .filter(e => e.toLowerCase() !== correct.toLowerCase() && !distractors.includes(e));
      distractors = distractors.concat(Utils.pickN(fallback, 3 - distractors.length));
    }

    const options = [correct, ...distractors]
      .map(o => String(o))
      .filter((v, i, a) => a.indexOf(v) === i);
    if (options.length < 4 && !options.includes('...')) options.push('...');
    return {
      options: Utils.shuffle(options.slice(0, 4)),
      isCorrect: (opt) => String(opt).toLowerCase() === correct.toLowerCase()
    };
  }

  // One blanked letter (never the first letter — it's the acoustic anchor
  // of the word and keeps the task solvable for pre-readers). Distractors
  // prefer other letters from the same word, which is far more instructive
  // than random alphabet noise.
  function buildSpellOptions(word) {
    const letters = (word && typeof word.english === 'string') ? word.english.trim().split('') : [];
    const usable = /^[a-z]{3,9}$/.test(word.english.trim().toLowerCase());
    if (!usable || letters.length < 3) {
      // Word isn't spellable (has spaces/hyphens/caps or too short) —
      // degrade to the Chinese-meaning question rather than break.
      return Object.assign(buildChineseOptions(word, []), { fallbackType: 'en2cn', blankIndex: -1 });
    }
    const blankIndex = Utils.randInt(1, letters.length - 1);
    const correctLetter = letters[blankIndex];
    const inWord = [...new Set(letters.filter(l => l !== correctLetter))];
    const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('');
    let distractors = Utils.pickN(inWord, 3);
    if (distractors.length < 3) {
      const rest = alphabet.filter(l => l !== correctLetter && !distractors.includes(l));
      distractors = distractors.concat(Utils.pickN(rest, 3 - distractors.length));
    }
    const options = Utils.shuffle([correctLetter, ...distractors]);
    return { options, isCorrect: (opt) => opt === correctLetter, blankIndex };
  }

  // Build the full question description for a type: prompt text, main
  // display text, optional sub-line, and the option builder result.
  function buildQuestion(word, allWords, type) {
    if (type === 'listen' && !(window.TTS && TTS.isSupported())) type = 'cn2en';
    let q = { type, prompt: PROMPTS[type] || PROMPTS.en2cn, display: '', sub: '', replay: false };
    if (type === 'en2cn') {
      Object.assign(q, buildChineseOptions(word, allWords));
      q.display = word.english;
    } else if (type === 'cn2en') {
      Object.assign(q, buildEnglishOptions(word, allWords));
      q.display = word.chinese;
    } else if (type === 'listen') {
      Object.assign(q, buildEnglishOptions(word, allWords));
      q.display = '';
      q.replay = true;
    } else if (type === 'spell') {
      Object.assign(q, buildSpellOptions(word));
      if (q.fallbackType) {
        // buildSpellOptions degraded to en2cn — rebuild the display bits.
        q.type = q.fallbackType;
        q.prompt = PROMPTS.en2cn;
        q.display = word.english;
      } else {
        const letters = word.english.trim().split('');
        q.display = letters.map((ch, i) => i === q.blankIndex ? '_' : ch).join(' ');
        q.sub = word.chinese;
      }
    } else {
      Object.assign(q, buildChineseOptions(word, allWords));
      q.display = word.english;
      q.type = 'en2cn';
    }
    return q;
  }

  function show(word, allWords, opts) {
    return new Promise((resolve) => {
      const modal = document.getElementById('question-modal');
      const monsterEl = document.getElementById('modal-monster');
      const wordEl = document.getElementById('modal-word');
      const subEl = document.getElementById('modal-sub');
      const replayEl = document.getElementById('modal-replay');
      const promptEl = document.getElementById('modal-prompt');
      const optionsEl = document.getElementById('modal-options');
      const feedbackEl = document.getElementById('modal-feedback');

      const q = buildQuestion(word, allWords, opts && opts.type);

      // Display
      monsterEl.textContent = q.type === 'listen' ? '👂' : '📚';
      wordEl.textContent = q.display || '❓';
      if (subEl) {
        subEl.textContent = q.sub || '';
        subEl.classList.toggle('hidden', !q.sub);
      }
      if (replayEl) replayEl.classList.toggle('hidden', !q.replay);
      if (promptEl) promptEl.textContent = q.prompt;
      feedbackEl.textContent = '';
      feedbackEl.className = 'modal-feedback';

      const options = q.options;
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
        if (replayEl) replayEl.classList.add('hidden');
        if (subEl) subEl.classList.add('hidden');
        modal.classList.add('hidden');
        resolve(result);
      };

      // Safety net: if the modal is dismissed externally before the player
      // clicks anything, resolve as a wrong answer so the awaiting
      // collision handler can bail out cleanly instead of leaking the
      // await forever. 30s is far beyond any normal answer time.
      fallbackTimer = setTimeout(() => {
        if (!settled && !answered) {
          settle({ correct: false, choice: null, correctAnswer: word.chinese, type: q.type });
        }
      }, 30000);

      if (replayEl && !replayEl.dataset.wired) {
        replayEl.dataset.wired = '1';
        replayEl.addEventListener('click', () => {
          if (window.TTS && TTS.isSupported()) TTS.speak(word.english);
        });
      }

      options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'modal-option';
        btn.textContent = opt;
        btn.addEventListener('click', () => {
          if (answered) return;
          answered = true;
          const correct = q.isCorrect(opt);
          // Mark buttons: highlight the button(s) matching the right answer
          // (spell letters can repeat, so compare by correctness, not text).
          optionsEl.querySelectorAll('.modal-option').forEach(b => {
            b.classList.add('disabled');
            if (q.isCorrect(b.textContent)) b.classList.add('correct');
            else if (b === btn && !correct) b.classList.add('wrong');
          });

          if (correct) {
            feedbackEl.textContent = 'CORRECT!';
            feedbackEl.className = 'modal-feedback correct';
            Utils.playBeep('correct');
          } else {
            feedbackEl.textContent = '答错了！' + word.english + ' = ' + word.chinese;
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
            settle({ correct, choice: opt, correctAnswer: word.chinese, type: q.type });
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

  window.Question = { show, buildQuestion };
})();
