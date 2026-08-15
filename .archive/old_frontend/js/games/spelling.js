/**
 * spelling.js - Game 3: 字母拼写 (Letters & Spelling)
 * Three phases:
 *   Rounds 1-4:  Letter Recognition  - hear letter, pick matching emoji
 *   Rounds 5-8:  Case Matching       - match uppercase to lowercase
 *   Rounds 9-12: Fill-in-Blank       - complete the word with the missing letter
 *
 * Age adaptation:
 *   3-4  -> phases A + B only (8 rounds)
 *   5-6  -> all 3 phases, single missing letter
 *   7-8  -> all 3 phases, harder letters
 *   9-10 -> all 3 phases, spell full 3-letter words from letter tiles
 *
 * Exposed as window.SpellingGame
 */
(function () {
  'use strict';

  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  function getLetterPool(age) {
    if (age <= 3) return 'ABCDE'.split('');
    if (age <= 5) return 'ABCDEFGHIJKLM'.split('');
    return ALPHABET;
  }

  const SpellingGame = {
    start(container, vocab, onComplete) {
      const words = (vocab && vocab.words) || [];
      const letters = (vocab && vocab.letters) || [];
      const age = (vocab && vocab.ageGroup) || 3;

      const letterPool = getLetterPool(age);
      const hasPhaseC = age >= 5;
      const totalRounds = hasPhaseC ? 12 : 8;

      let letterQueue = Utils.shuffle(letterPool);
      let wordPool = words.filter(w => w.difficulty <= 2 && /^[a-z]{3,6}$/.test(w.english));
      let usedWords = [];

      const nextLetter = () => {
        if (letterQueue.length === 0) letterQueue = Utils.shuffle(letterPool);
        return letterQueue.shift();
      };

      const pickWord = () => {
        if (wordPool.length === 0) { wordPool = words.filter(w => /^[a-z]{3,6}$/.test(w.english)); usedWords = []; }
        const w = Utils.randomItem(wordPool);
        wordPool = wordPool.filter(x => x.id !== w.id);
        usedWords.push(w);
        return w;
      };

      const engine = new GameEngine({
        container,
        totalRounds,
        pointsCorrect: 10,
        onRoundStart: (round, eng) => {
          const phase = hasPhaseC ? (round <= 4 ? 'A' : (round <= 8 ? 'B' : 'C')) : (round <= 4 ? 'A' : 'B');
          if (phase === 'A') SpellingGame._phaseA(eng, age, letters, words);
          else if (phase === 'B') SpellingGame._phaseB(eng, age, nextLetter);
          else SpellingGame._phaseC(eng, age, words, pickWord);
        },
        onGameEnd(stats) {
          onComplete(stats);
        }
      });

      engine.start();
    },

    // ---- Phase A: Letter recognition ---------------------------------
    _phaseA(eng, age, letters, words) {
      const letter = Utils.randomItem(letters) || { uppercase: 'A', lowercase: 'a', exampleWord: 'apple', exampleEmoji: '🍎' };
      const example = letter.exampleWord || letter.uppercase;

      // Pick 4 emoji options: 1 matching, 3 non-matching
      const correctWord = words.find(w => w.english === example.toLowerCase()) ||
                          { english: example, emoji: letter.exampleEmoji, id: 'ex' };
      const candidates = words.filter(w => w.id !== correctWord.id && w.emoji && w.emoji !== correctWord.emoji);
      let distractors = Utils.randomPick(candidates, 3);
      if (distractors.length < 3) {
        const extra = words.filter(w => w.id !== correctWord.id && !distractors.includes(w));
        distractors = distractors.concat(Utils.randomPick(extra, 3 - distractors.length));
      }
      const options = Utils.shuffle([correctWord].concat(distractors));

      eng.stage.innerHTML = `
        <div class="keg-game__question keg-slide-in">
          <div class="keg-game__question-text" style="font-size:96px;font-weight:900;color:var(--keg-red)">${letter.uppercase}</div>
          <div class="keg-game__question-text--zh">听：字母 ${letter.uppercase}（/${letter.lowercase}/）</div>
          <div class="keg-game__question-text--zh">哪个图是 <b>${Utils.escapeHtml(example)}</b> 开头的？</div>
          ${correctWord.phonetic ? `<div class="keg-game__question-phonetic">${Utils.escapeHtml(correctWord.phonetic)}</div>` : ''}
        </div>
        <div class="keg-game__option-grid" style="margin-top:20px">
          ${options.map((w, i) => `
            <button class="keg-option keg-option--emoji keg-pop" data-id="${w.id}" style="animation-delay:${i * 0.06}s">${w.emoji}</button>
          `).join('')}
        </div>
      `;

      // Speak letter name + sound + example word
      TTS.speak(letter.uppercase, { rate: 0.85 });
      setTimeout(() => TTS.speak(example, { rate: 0.85 }), 900);

      let answered = false;
      eng.stage.querySelectorAll('.keg-option').forEach(btn => {
        btn.addEventListener('click', () => {
          if (answered) return;
          answered = true;
          const isCorrect = btn.dataset.id === correctWord.id;
          const stat = eng.submitAnswer(isCorrect);

          eng.lock();
          eng.stage.querySelectorAll('.keg-option').forEach(b => b.classList.add('keg-option--disabled'));
          if (isCorrect) {
            btn.classList.add('keg-option--correct');
            Utils.playBeep('correct');
            TTS.speak('Yes! ' + example + ' starts with ' + letter.uppercase);
          } else {
            btn.classList.add('keg-option--wrong');
            Utils.playBeep('wrong');
            TTS.speak('It is ' + correctWord.english);
            eng.stage.querySelector(`.keg-option[data-id="${correctWord.id}"]`).classList.add('keg-option--correct');
          }
          setTimeout(() => eng.nextRound(), 1900);
        });
      });
    },

    // ---- Phase B: Upper/lowercase matching ---------------------------
    _phaseB(eng, age, nextLetter) {
      const upper = nextLetter();
      const lower = upper.toLowerCase();

      // 3 distractor lowercase letters
      const other = Utils.randomPick(letterPoolFor(age).filter(l => l !== upper), 3);
      const options = Utils.shuffle([lower].concat(other));

      eng.stage.innerHTML = `
        <div class="keg-game__question keg-slide-in">
          <div class="keg-game__question-text" style="font-size:96px;font-weight:900;color:var(--keg-blue)">${upper}</div>
          <div class="keg-game__question-text--zh">找到对应的小写字母 🔤</div>
        </div>
        <div class="keg-game__option-grid" style="margin-top:20px">
          ${options.map((c, i) => `
            <button class="keg-option keg-pop" data-lower="${c}" style="font-size:48px;font-weight:900;min-height:110px;animation-delay:${i * 0.06}s">${c}</button>
          `).join('')}
        </div>
      `;

      TTS.speak('Uppercase ' + upper + '. Find the lowercase letter.');

      let answered = false;
      eng.stage.querySelectorAll('.keg-option').forEach(btn => {
        btn.addEventListener('click', () => {
          if (answered) return;
          answered = true;
          const isCorrect = btn.dataset.lower === lower;
          const stat = eng.submitAnswer(isCorrect);

          eng.lock();
          eng.stage.querySelectorAll('.keg-option').forEach(b => b.classList.add('keg-option--disabled'));
          if (isCorrect) {
            btn.classList.add('keg-option--correct');
            Utils.playBeep('correct');
            TTS.speak('Correct! ' + upper + ' ' + lower);
          } else {
            btn.classList.add('keg-option--wrong');
            Utils.playBeep('wrong');
            TTS.speak('The lowercase of ' + upper + ' is ' + lower);
            eng.stage.querySelector(`.keg-option[data-lower="${lower}"]`).classList.add('keg-option--correct');
          }
          setTimeout(() => eng.nextRound(), 1800);
        });
      });
    },

    // ---- Phase C: Fill-in-the-blank spelling -------------------------
    _phaseC(eng, age, words, pickWord) {
      const word = pickWord();
      const text = word.english;
      const blankIdx = age >= 7 ? Utils.randomInt(0, text.length - 1) : Utils.randomInt(1, text.length - 2);

      const correctLetter = text[blankIdx];
      // 3 distractor letters from other letters in the same word + random
      const others = Utils.shuffle(
        (text.slice(0, blankIdx) + text.slice(blankIdx + 1)).split('')
      ).filter((c, i, a) => a.indexOf(c) === i).slice(0, 2);
      let distractorPool = ALPHABET.filter(l => l.toLowerCase() !== correctLetter && !others.includes(l.toLowerCase()));
      while (others.length < 3) others.push(Utils.randomItem(distractorPool).toLowerCase());

      const options = Utils.shuffle([correctLetter].concat(others));
      const shown = text.split('').map((c, i) => i === blankIdx ? '_' : c).join(' ');

      eng.stage.innerHTML = `
        <div class="keg-game__question keg-slide-in">
          <div class="keg-game__question-emoji">${word.emoji}</div>
          <div class="keg-game__question-text" style="font-size:46px;font-weight:900;letter-spacing:6px">${shown.toUpperCase()}</div>
          <div class="keg-game__question-text--zh">${Utils.escapeHtml(word.chinese)} · 缺哪个字母？</div>
          ${word.phonetic ? `<div class="keg-game__question-phonetic">${Utils.escapeHtml(word.phonetic)}</div>` : ''}
        </div>
        <div class="keg-game__option-grid" style="margin-top:20px;grid-template-columns:repeat(4,1fr)">
          ${options.map((c, i) => `
            <button class="keg-option keg-pop" data-lower="${c}" style="font-size:40px;font-weight:900;min-height:100px;animation-delay:${i * 0.06}s">${c.toUpperCase()}</button>
          `).join('')}
        </div>
      `;

      TTS.speak(word.english, { rate: 0.85 });

      let answered = false;
      eng.stage.querySelectorAll('.keg-option').forEach(btn => {
        btn.addEventListener('click', () => {
          if (answered) return;
          answered = true;
          const isCorrect = btn.dataset.lower === correctLetter;
          const stat = eng.submitAnswer(isCorrect);

          eng.lock();
          eng.stage.querySelectorAll('.keg-option').forEach(b => b.classList.add('keg-option--disabled'));
          if (isCorrect) {
            btn.classList.add('keg-option--correct');
            Utils.playBeep('correct');
            TTS.speak('Correct! ' + word.english + ' spells ' + text.split('').join(', '));
          } else {
            btn.classList.add('keg-option--wrong');
            Utils.playBeep('wrong');
            TTS.speak(word.english + ' has letter ' + correctLetter);
            eng.stage.querySelector(`.keg-option[data-lower="${correctLetter}"]`).classList.add('keg-option--correct');
          }
          setTimeout(() => eng.nextRound(), 2000);
        });
      });
    }
  };

  function letterPoolFor(age) {
    if (age <= 3) return 'ABCDE'.split('');
    if (age <= 5) return 'ABCDEFGHIJKLM'.split('');
    return ALPHABET;
  }

  window.SpellingGame = SpellingGame;
})();
