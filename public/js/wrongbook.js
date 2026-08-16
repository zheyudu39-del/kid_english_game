// wrongbook.js - 错词本 (wrong-word book) with lightweight spaced repetition.
//
// Every solo/practice question result is recorded here, per player nickname
// (localStorage, mirroring the wordhunter:save:NAME key pattern), so it works
// for guests and offline play with zero server load.
//
// Scheduling is a simplified Leitner box system tuned for kids' short
// sessions: wrong → due immediately (next review batch), each correct answer
// moves the word one box up (20min → 12h → 3d), and a third consecutive-box
// correct answer graduates the word to "mastered" (removed from the book,
// counted forever in stats).
(function () {
  'use strict';

  // Box n → ms until the word is due again. Box 0 (just missed) is due now.
  const BOX_INTERVALS = [
    0,                        // 0: missed — due immediately
    20 * 60 * 1000,           // 1: right once — 20 minutes
    12 * 60 * 60 * 1000,      // 2: right twice — 12 hours
    3 * 24 * 60 * 60 * 1000   // 3: right three times — graduates on next pass
  ];
  const MASTER_BOX = 3;
  const REVIEW_BATCH = 10;    // max words per review level
  const REVIEW_HINT_THRESHOLD = 5; // "batch ready" toast threshold

  function storeKey() {
    const g = window._game;
    const name = (g && g.playerName) || 'guest';
    return 'wordhunter:wrongbook:' + name;
  }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(storeKey()) || '{}');
      return {
        v: 1,
        entries: (raw && typeof raw.entries === 'object' && raw.entries) || {},
        mastered: Number(raw && raw.mastered) || 0,
        lifetime: Number(raw && raw.lifetime) || 0
      };
    } catch (e) {
      return { v: 1, entries: {}, mastered: 0, lifetime: 0 };
    }
  }

  function save(store) {
    try { localStorage.setItem(storeKey(), JSON.stringify(store)); } catch (e) { /* private mode */ }
  }

  function entryOf(word) {
    return {
      e: String(word.english || '').trim(),
      c: String(word.chinese || '').trim(),
      d: Number(word.difficulty) || 1,
      wrong: 0,
      box: 0,
      last: 0,
      next: 0
    };
  }

  const WrongBook = {
    // A wrong answer: (re)enter the book at box 0, due right now.
    recordWrong(word) {
      if (!word || !word.english) return;
      const store = load();
      const key = String(word.english).trim().toLowerCase();
      const cur = store.entries[key];
      if (cur) {
        cur.wrong += 1;
        cur.box = 0;
        cur.last = Date.now();
        cur.next = 0;
        if (word.chinese) cur.c = String(word.chinese).trim();
      } else {
        const e = entryOf(word);
        e.wrong = 1;
        e.last = Date.now();
        e.next = 0;
        store.entries[key] = e;
        store.lifetime += 1;
      }
      save(store);
      this.refreshBadge();
    },

    // A correct answer: advance one box; box 3 correct = mastered, remove.
    recordRight(word) {
      if (!word || !word.english) return;
      const store = load();
      const key = String(word.english).trim().toLowerCase();
      const cur = store.entries[key];
      if (!cur) return; // never-wrong words don't track here
      cur.box += 1;
      cur.last = Date.now();
      if (cur.box >= MASTER_BOX) {
        delete store.entries[key];
        store.mastered += 1;
      } else {
        cur.next = Date.now() + (BOX_INTERVALS[cur.box] || 0);
      }
      save(store);
      this.refreshBadge();
    },

    // Words due for review: due-now first, then most-wrong, then oldest.
    dueWords(limit) {
      const cap = limit || REVIEW_BATCH;
      const now = Date.now();
      const all = Object.values(load().entries);
      const due = all.filter(e => !e.next || e.next <= now);
      due.sort((a, b) => (b.wrong - a.wrong) || (a.last - b.last));
      return due.slice(0, cap).map(e => ({
        id: 'wb-' + e.e,
        english: e.e,
        chinese: e.c,
        difficulty: e.d
      }));
    },

    // All active entries (wrongbook UI listing), newest miss first.
    allWords() {
      const all = Object.values(load().entries);
      all.sort((a, b) => b.last - a.last);
      return all;
    },

    stats() {
      const store = load();
      const now = Date.now();
      let due = 0;
      for (const e of Object.values(store.entries)) {
        if (!e.next || e.next <= now) due += 1;
      }
      return {
        total: Object.keys(store.entries).length,
        due,
        mastered: store.mastered,
        lifetime: store.lifetime
      };
    },

    clear() {
      save({ v: 1, entries: {}, mastered: 0, lifetime: 0 });
      this.refreshBadge();
    },

    // Title-screen badge: due-word count, hidden when nothing is due.
    refreshBadge() {
      const badge = document.getElementById('wb-badge');
      if (!badge) return;
      const due = this.stats().due;
      badge.textContent = due > 0 ? String(due) : '';
      badge.classList.toggle('hidden', due === 0);
    },

    REVIEW_HINT_THRESHOLD
  };

  window.WrongBook = WrongBook;

  // ---- 错词本 screen UI ----
  // Follows the leaderboard/modal module pattern: DOM APIs + textContent
  // only (CSP-safe), self-wired buttons, Escape closes.

  function el(id) { return document.getElementById(id); }

  function playerName() {
    const g = window._game;
    const input = el('player-name');
    const typed = input && input.value.trim();
    return (g && g.playerName) || typed || 'guest';
  }

  function statusText(entry, now) {
    if (!entry.next || entry.next <= now) return '待复习';
    const left = entry.next - now;
    if (left < 60 * 60 * 1000) return Math.max(1, Math.round(left / 60000)) + '分钟后';
    if (left < 24 * 60 * 60 * 1000) return Math.round(left / (60 * 60 * 1000)) + '小时后';
    return Math.round(left / (24 * 60 * 60 * 1000)) + '天后';
  }

  function renderScreen() {
    const g = window._game;
    if (g && g.playerName !== playerName()) g.playerName = playerName();

    const stats = WrongBook.stats();
    const statsEl = el('wb-stats');
    if (statsEl) {
      statsEl.textContent = '';
      const bits = [
        '📖 在本 ' + stats.total + ' 词',
        '⏰ 待复习 ' + stats.due + ' 词',
        '✨ 已掌握 ' + stats.mastered + ' 词'
      ];
      bits.forEach(t => {
        const s = document.createElement('span');
        s.className = 'wb-stat';
        s.textContent = t;
        statsEl.appendChild(s);
      });
    }

    const list = el('wb-list');
    if (list) {
      list.textContent = '';
      const words = WrongBook.allWords();
      if (!words.length) {
        const empty = document.createElement('div');
        empty.className = 'wb-empty';
        empty.textContent = '本子还是空的 — 闯关时答错的单词会自动记到这里 📗';
        list.appendChild(empty);
      } else {
        const now = Date.now();
        words.forEach(w => {
          const row = document.createElement('div');
          row.className = 'wb-row' + ((!w.next || w.next <= now) ? ' due' : '');
          const en = document.createElement('span');
          en.className = 'wb-row__en';
          en.textContent = w.e;
          const cn = document.createElement('span');
          cn.className = 'wb-row__cn';
          cn.textContent = w.c || '—';
          const wrong = document.createElement('span');
          wrong.className = 'wb-row__wrong';
          wrong.textContent = '✗' + w.wrong;
          const st = document.createElement('span');
          st.className = 'wb-row__status';
          st.textContent = statusText(w, now);
          row.append(en, cn, wrong, st);
          list.appendChild(row);
        });
      }
    }

    const btn = el('btn-review-start');
    if (btn) {
      const due = stats.due;
      btn.disabled = due === 0;
      btn.textContent = due > 0 ? ('🔁 复习 ' + Math.min(10, due) + ' 个错词') : '暂无待复习的错词';
    }
    WrongBook.refreshBadge();
  }

  function openScreen() {
    const screen = el('screen-wrongbook');
    if (!screen) return;
    const g = window._game;
    if (g && typeof g.pauseForModal === 'function') g.pauseForModal();
    renderScreen();
    screen.classList.remove('hidden');
  }

  function closeScreen() {
    const screen = el('screen-wrongbook');
    if (screen) screen.classList.add('hidden');
    const g = window._game;
    if (g && typeof g.isModalPaused === 'function' && typeof g.resumeFromModal === 'function' && g.isModalPaused()) {
      g.resumeFromModal();
    }
  }

  async function startReview() {
    const g = window._game;
    if (!g || typeof g.startReviewLevel !== 'function') return;
    g.playerName = playerName();
    closeScreen();
    if (!(await g.startReviewLevel())) {
      // Nothing due (or book empty) — reopen so the state above stays true.
      openScreen();
    }
  }

  function initUI() {
    const openBtn = el('btn-wrongbook');
    if (openBtn && !openBtn.dataset.wired) {
      openBtn.addEventListener('click', openScreen);
      openBtn.dataset.wired = '1';
    }
    const closeBtn = el('btn-wb-close');
    if (closeBtn && !closeBtn.dataset.wired) {
      closeBtn.addEventListener('click', closeScreen);
      closeBtn.dataset.wired = '1';
    }
    const reviewBtn = el('btn-review-start');
    if (reviewBtn && !reviewBtn.dataset.wired) {
      reviewBtn.addEventListener('click', startReview);
      reviewBtn.dataset.wired = '1';
    }
    // Two-step confirm: the first click arms, the second within 3s clears.
    const clearBtn = el('btn-wb-clear');
    if (clearBtn && !clearBtn.dataset.wired) {
      let armed = false, timer = null;
      clearBtn.addEventListener('click', () => {
        if (!armed) {
          armed = true;
          clearBtn.textContent = '❗确认';
          timer = setTimeout(() => { armed = false; clearBtn.textContent = '🗑️'; }, 3000);
          return;
        }
        clearTimeout(timer);
        armed = false;
        clearBtn.textContent = '🗑️';
        WrongBook.clear();
        renderScreen();
      });
      clearBtn.dataset.wired = '1';
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        const screen = el('screen-wrongbook');
        if (screen && !screen.classList.contains('hidden')) {
          e.preventDefault();
          closeScreen();
        }
      }
    });
  }

  window.WrongBookModule = { open: openScreen, close: closeScreen, refresh: renderScreen };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { WrongBook.refreshBadge(); initUI(); });
  } else {
    WrongBook.refreshBadge();
    initUI();
  }
})();
