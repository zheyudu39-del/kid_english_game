// report.js - 家长学习报告 (parent learning report) screen.
// Merges two data sources:
//   server  /api/report/:nickname — session rows (accuracy, play time) and
//           the registered profile (cleared levels), aggregated server-side
//   browser WrongBook + local save — word-level 错词/掌握 counts and the
//           furthest level reached on this device
// Rendering is DOM APIs + textContent + inline SVG built via createElementNS
// (CSP-safe, no innerHTML with data).
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  function reportName() {
    const reg = window.RegisterModule;
    const logged = (reg && typeof reg.getNickname === 'function') ? (reg.getNickname() || '') : '';
    if (logged) return logged;
    const input = el('player-name');
    const typed = input && input.value.trim();
    if (typed) return typed;
    const g = window._game;
    return (g && g.playerName) || 'guest';
  }

  function fmtDuration(sec) {
    if (!sec || sec < 60) return sec ? sec + ' 秒' : '0 分钟';
    if (sec < 3600) return Math.round(sec / 60) + ' 分钟';
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return m ? (h + ' 小时 ' + m + ' 分') : (h + ' 小时');
  }

  function fmtDate(iso) {
    try {
      const d = new Date(iso);
      return (d.getMonth() + 1) + '/' + d.getDate();
    } catch (e) { return ''; }
  }

  function makeCard(emoji, num, label) {
    const card = document.createElement('div');
    card.className = 'rp-card';
    const n = document.createElement('div');
    n.className = 'rp-card__num';
    n.textContent = emoji + ' ' + num;
    const l = document.createElement('div');
    l.className = 'rp-card__label';
    l.textContent = label;
    card.append(n, l);
    return card;
  }

  // Inline SVG accuracy trend (oldest → newest). A flat 100%-height line is
  // boring but correct when there's a single session.
  function makeTrendSVG(sessions) {
    const W = 320, H = 90, PAD = 6;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('class', 'rp-trend__svg');
    svg.setAttribute('preserveAspectRatio', 'none');

    const grid = document.createElementNS(ns, 'line');
    grid.setAttribute('x1', 0); grid.setAttribute('x2', W);
    grid.setAttribute('y1', H / 2); grid.setAttribute('y2', H / 2);
    grid.setAttribute('class', 'rp-trend__grid');
    svg.appendChild(grid);

    const pts = sessions.map((s, i) => {
      const x = sessions.length === 1 ? W / 2 : PAD + (i / (sessions.length - 1)) * (W - 2 * PAD);
      const acc = s.rounds > 0 ? s.correct / s.rounds : 0;
      const y = H - PAD - acc * (H - 2 * PAD);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    const poly = document.createElementNS(ns, 'polyline');
    poly.setAttribute('points', pts.join(' '));
    poly.setAttribute('class', 'rp-trend__line');
    svg.appendChild(poly);
    return svg;
  }

  async function refresh() {
    const who = el('rp-who'), cards = el('rp-cards'), trend = el('rp-trend'),
          words = el('rp-words'), sessionsEl = el('rp-sessions');
    if (cards) cards.textContent = '加载中…';

    const name = reportName();
    let report = null;
    try {
      report = await window.API.getReport(name);
    } catch (e) {
      if (cards) {
        cards.textContent = '';
        const err = document.createElement('div');
        err.className = 'rp-empty';
        err.textContent = '报告加载失败，请稍后重试';
        cards.appendChild(err);
      }
      return;
    }

    // Header: who + account hint.
    if (who) {
      who.textContent = '👤 学员：' + report.nickname +
        (report.hasAccount ? '（已注册）' : '（游客 · 登录后记录长期累积）');
    }

    if (cards) {
      cards.textContent = '';
      const t = report.totals || {};
      const wb = (window.WrongBook && WrongBook.stats()) || { total: 0, due: 0, mastered: 0 };
      const g = window._game;
      const localMax = (g && g.maxUnlocked) || 1;
      cards.appendChild(makeCard('📝', t.rounds || 0, '累计答题'));
      cards.appendChild(makeCard('🎯', (t.accuracy || 0) + '%', '总正确率'));
      cards.appendChild(makeCard('⏱️', fmtDuration(t.playSec || 0), '游戏时长'));
      cards.appendChild(makeCard('🗓️', t.playDays || 0, '学习天数'));
      const cleared = report.hasAccount && report.profile
        ? report.profile.cleared
        : Math.max(0, localMax - 1);
      cards.appendChild(makeCard('🏅', cleared, '通关关卡'));
      cards.appendChild(makeCard('✨', wb.mastered, '掌握的错词'));
      // SRS stats (if available from logged-in session)
      const reg = window.RegisterModule;
      if (reg && typeof reg.getNickname === 'function' && reg.getNickname()) {
        // Load SRS stats asynchronously
        if (window.API && typeof API.srsStats === 'function') {
          API.srsStats().then(srsData => {
            if (srsData && srsData.stats) {
              const srs = srsData.stats;
              const srsCard = cards.querySelector('.rp-card--srs');
              if (srsCard) {
                srsCard.querySelector('.rp-card__num').textContent = '📚 ' + (srs.total || 0);
              } else {
                const card = makeCard('📚', srs.total || 0, 'SRS单词库');
                card.classList.add('rp-card--srs');
                cards.appendChild(card);
              }
            }
          }).catch(() => {});
        }
      }
    }

    // Accuracy trend over recent sessions.
    if (trend) {
      trend.textContent = '';
      const head = document.createElement('div');
      head.className = 'rp-section__head';
      head.textContent = '📈 正确率走势（最近 ' + ((report.sessions || []).length) + ' 局）';
      trend.appendChild(head);
      const sessions = report.sessions || [];
      if (sessions.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'rp-empty';
        empty.textContent = '还没有学习记录，先去闯一关吧！';
        trend.appendChild(empty);
      } else {
        trend.appendChild(makeTrendSVG(sessions));
      }
    }

    // Word-level snapshot from the local wrong-word book.
    if (words) {
      words.textContent = '';
      const head = document.createElement('div');
      head.className = 'rp-section__head';
      head.textContent = '📕 单词掌握';
      words.appendChild(head);
      const wb = window.WrongBook
        ? { stats: WrongBook.stats(), list: WrongBook.allWords() }
        : { stats: { total: 0, due: 0 }, list: [] };
      const line = document.createElement('div');
      line.className = 'rp-words__line';
      line.textContent = '错词本在记 ' + wb.stats.total + ' 词 · 待复习 ' + wb.stats.due + ' 词 · 已毕业 ' + wb.stats.mastered + ' 词';
      words.appendChild(line);
      const top = wb.list.slice(0, 8);
      if (top.length) {
        const chips = document.createElement('div');
        chips.className = 'rp-words__chips';
        top.forEach(w => {
          const chip = document.createElement('span');
          chip.className = 'rp-chip';
          chip.textContent = w.e + ' ' + (w.c || '');
          chips.appendChild(chip);
        });
        words.appendChild(chips);
      }
    }

    // Recent session rows.
    if (sessionsEl) {
      sessionsEl.textContent = '';
      const head = document.createElement('div');
      head.className = 'rp-section__head';
      head.textContent = '🕓 最近学习记录';
      sessionsEl.appendChild(head);
      const sessions = (report.sessions || []).slice(-5).reverse();
      if (!sessions.length) {
        const empty = document.createElement('div');
        empty.className = 'rp-empty';
        empty.textContent = '暂无记录';
        sessionsEl.appendChild(empty);
      } else {
        sessions.forEach(s => {
          const row = document.createElement('div');
          row.className = 'rp-session';
          const acc = s.rounds > 0 ? Math.round((s.correct / s.rounds) * 100) : 0;
          const d = document.createElement('span');
          d.className = 'rp-session__date';
          d.textContent = fmtDate(s.date);
          const result = document.createElement('span');
          result.className = 'rp-session__result';
          result.textContent = s.won ? '🏆 通关' : '💀 未过';
          const q = document.createElement('span');
          q.className = 'rp-session__q';
          q.textContent = '答题 ' + s.correct + '/' + s.rounds;
          const a = document.createElement('span');
          a.className = 'rp-session__acc' + (acc >= 80 ? ' good' : (acc < 50 ? ' bad' : ''));
          a.textContent = acc + '%';
          const dur = document.createElement('span');
          dur.className = 'rp-session__dur';
          dur.textContent = fmtDuration(s.playSec || 0);
          row.append(d, result, q, a, dur);
          sessionsEl.appendChild(row);
        });
      }
    }
  }

  function open() {
    const screen = el('screen-report');
    if (!screen) return;
    const g = window._game;
    if (g && typeof g.pauseForModal === 'function') g.pauseForModal();
    screen.classList.remove('hidden');
    refresh();
  }

  function close() {
    const screen = el('screen-report');
    if (screen) screen.classList.add('hidden');
    const g = window._game;
    if (g && typeof g.isModalPaused === 'function' && typeof g.resumeFromModal === 'function' && g.isModalPaused()) {
      g.resumeFromModal();
    }
  }

  function init() {
    const openBtn = el('btn-report');
    if (openBtn && !openBtn.dataset.wired) {
      openBtn.addEventListener('click', open);
      openBtn.dataset.wired = '1';
    }
    const closeBtn = el('btn-rp-close');
    if (closeBtn && !closeBtn.dataset.wired) {
      closeBtn.addEventListener('click', close);
      closeBtn.dataset.wired = '1';
    }
    const refreshBtn = el('btn-rp-refresh');
    if (refreshBtn && !refreshBtn.dataset.wired) {
      refreshBtn.addEventListener('click', refresh);
      refreshBtn.dataset.wired = '1';
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        const screen = el('screen-report');
        if (screen && !screen.classList.contains('hidden')) {
          e.preventDefault();
          close();
        }
      }
    });
  }

  window.ReportModule = { open, close, refresh };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
