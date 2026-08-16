// leaderboard.js - Level-clearing leaderboard screen (闯关排行榜).
// Ranks every registered account by completedLevels count. Rendering uses
// DOM APIs + textContent exclusively (CSP-safe, no innerHTML with data).
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  const MEDALS = ['🥇', '🥈', '🥉'];
  let loading = false;

  function loggedInName() {
    const reg = window.RegisterModule;
    return (reg && typeof reg.getNickname === 'function') ? (reg.getNickname() || '') : '';
  }

  async function open() {
    const screen = el('screen-leaderboard');
    if (!screen) return;
    const g = window._game;
    if (g && typeof g.pauseForModal === 'function') g.pauseForModal();
    screen.classList.remove('hidden');
    await refresh();
  }

  function close() {
    const screen = el('screen-leaderboard');
    if (screen) screen.classList.add('hidden');
    const g = window._game;
    if (g && typeof g.isModalPaused === 'function' && typeof g.resumeFromModal === 'function' && g.isModalPaused()) {
      g.resumeFromModal();
    }
  }

  function worldName(id) {
    const w = window.Levels && Levels.WORLDS ? Levels.WORLDS.find(x => x.id === id) : null;
    return w ? w.name : '世界 ' + id;
  }

  function makeRow(entry, highlight) {
    const row = document.createElement('div');
    row.className = 'board-row' + (highlight ? ' me' : '');
    const rank = document.createElement('span');
    rank.className = 'board-row__rank';
    rank.textContent = entry.rank <= 3 ? MEDALS[entry.rank - 1] : String(entry.rank);
    const name = document.createElement('span');
    name.className = 'board-row__name';
    name.textContent = entry.nickname;
    const world = document.createElement('span');
    world.className = 'board-row__world';
    world.textContent = worldName(entry.world);
    const cleared = document.createElement('span');
    cleared.className = 'board-row__cleared';
    cleared.textContent = entry.cleared + ' 关';
    const coins = document.createElement('span');
    coins.className = 'board-row__coins';
    coins.textContent = '🪙 ' + entry.coins;
    row.append(rank, name, world, cleared, coins);
    return row;
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    const table = el('board-table');
    const meBox = el('board-me');
    const foot = el('board-foot');
    try {
      if (table) {
        table.textContent = '';
        const hint = document.createElement('div');
        hint.className = 'board-loading';
        hint.textContent = '加载中…';
        table.appendChild(hint);
      }
      const who = loggedInName();
      const data = await window.API.getLevelLeaderboard(who || undefined, 50);
      if (table) {
        table.textContent = '';
        if (!data.entries.length) {
          const empty = document.createElement('div');
          empty.className = 'board-loading';
          empty.textContent = '还没有猎人上榜，快去闯关吧！';
          table.appendChild(empty);
        } else {
          data.entries.forEach(e => table.appendChild(makeRow(e, who && e.nickname === who)));
        }
      }
      if (meBox) {
        meBox.textContent = '';
        if (who && data.me) {
          meBox.appendChild(makeRow(data.me, true));
        } else if (who) {
          meBox.textContent = '你还没有通关记录，通关后即可上榜';
        }
      }
      if (foot) foot.textContent = '共 ' + (data.total || 0) + ' 名猎人 · 按通关关卡数排名';
    } catch (e) {
      if (table) {
        table.textContent = '';
        const err = document.createElement('div');
        err.className = 'board-loading';
        err.textContent = '排行榜加载失败，请稍后重试';
        table.appendChild(err);
      }
    } finally {
      loading = false;
    }
  }

  function init() {
    const openBtn = el('btn-leaderboard');
    if (openBtn && !openBtn.dataset.wired) {
      openBtn.addEventListener('click', open);
      openBtn.dataset.wired = '1';
    }
    const closeBtn = el('btn-board-close');
    if (closeBtn && !closeBtn.dataset.wired) {
      closeBtn.addEventListener('click', close);
      closeBtn.dataset.wired = '1';
    }
    const refreshBtn = el('btn-board-refresh');
    if (refreshBtn && !refreshBtn.dataset.wired) {
      refreshBtn.addEventListener('click', () => { refresh(); });
      refreshBtn.dataset.wired = '1';
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        const screen = el('screen-leaderboard');
        if (screen && !screen.classList.contains('hidden')) {
          e.preventDefault();
          close();
        }
      }
    });
  }

  window.BoardModule = { open, close, refresh };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
