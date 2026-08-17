// mastery.js - 掌握度仪表盘 (Word Mastery Dashboard)
// Shows SRS-based word mastery statistics, category breakdowns,
// recent activity, weakest words, and review forecast.
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  function fmtDate(iso) {
    try {
      const d = new Date(iso);
      return (d.getMonth() + 1) + '/' + d.getDate();
    } catch (e) { return ''; }
  }

  function makeCard(emoji, num, label, color) {
    const card = document.createElement('div');
    card.className = 'ms-card';
    if (color) card.style.borderLeftColor = color;
    const n = document.createElement('div');
    n.className = 'ms-card__num';
    n.textContent = emoji + ' ' + num;
    const l = document.createElement('div');
    l.className = 'ms-card__label';
    l.textContent = label;
    card.append(n, l);
    return card;
  }

  function makeProgressBar(label, value, max, color) {
    const pct = max > 0 ? Math.round((value / max) * 100) : 0;
    const bar = document.createElement('div');
    bar.className = 'ms-bar';
    const hd = document.createElement('div');
    hd.className = 'ms-bar__head';
    hd.textContent = label + ' (' + pct + '%)';
    bar.appendChild(hd);
    const track = document.createElement('div');
    track.className = 'ms-bar__track';
    const fill = document.createElement('div');
    fill.className = 'ms-bar__fill';
    fill.style.width = pct + '%';
    if (color) fill.style.background = color;
    track.appendChild(fill);
    bar.appendChild(track);
    return bar;
  }

  // Review forecast: next 7 days due count
  function makeForecast(playerData) {
    const today = new Date();
    const todayKey = today.toISOString().slice(0, 10);
    const forecast = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      let count = 0;
      if (playerData) {
        for (const k of Object.keys(playerData)) {
          const entry = playerData[k];
          if (entry.nextReview && entry.nextReview === key) {
            count++;
          }
        }
      }
      forecast.push({ date: d, key, count: i === 0 ? (count || 0) : count, isToday: key === todayKey });
    }
    return forecast;
  }

  // Render the forecast as a simple bar chart
  function renderForecast(forecast) {
    const W = 280, H = 60, PAD = 4, BAR_W = 30, GAP = 8;
    const maxCount = Math.max(1, ...forecast.map(f => f.count));
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('class', 'ms-heatmap');
    forecast.forEach((f, i) => {
      const x = i * (BAR_W + GAP);
      const barH = Math.max(2, (f.count / maxCount) * (H - 20));
      const y = H - 8 - barH;
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', BAR_W);
      rect.setAttribute('height', barH);
      rect.setAttribute('rx', '3');
      const intensity = f.count / maxCount;
      const r = Math.round(74 + intensity * 170);
      const g = Math.round(144 + intensity * 80);
      const b = Math.round(217 - intensity * 100);
      rect.setAttribute('fill', 'rgb(' + r + ',' + g + ',' + b + ')');
      svg.appendChild(rect);
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('x', x + BAR_W / 2);
      text.setAttribute('y', H - 2);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('class', 'ms-heatmap__label');
      text.textContent = (f.date.getMonth() + 1) + '/' + f.date.getDate();
      svg.appendChild(text);
      if (f.count > 0) {
        const cnt = document.createElementNS(ns, 'text');
        cnt.setAttribute('x', x + BAR_W / 2);
        cnt.setAttribute('y', y - 3);
        cnt.setAttribute('text-anchor', 'middle');
        cnt.setAttribute('class', 'ms-heatmap__label');
        cnt.setAttribute('font-size', '9');
        cnt.textContent = f.count;
        svg.appendChild(cnt);
      }
    });
    return svg;
  }

  async function refresh() {
    const cards = el('ms-cards');
    const cats = el('ms-categories');
    const heat = el('ms-heat');
    const weak = el('ms-weakest');
    const dueToday = el('ms-due-today');

    if (cards) cards.textContent = '加载中…';

    const reg = window.RegisterModule;
    const logged = reg && typeof reg.getNickname === 'function' ? (reg.getNickname() || '') : '';
    if (!logged) {
      if (cards) {
        cards.textContent = '';
        const empty = document.createElement('div');
        empty.className = 'ms-empty';
        empty.textContent = '请先登录后查看掌握度仪表盘';
        cards.appendChild(empty);
      }
      return;
    }

    let data = null;
    try {
      data = await window.API.srsStats();
    } catch (e) {
      if (cards) {
        cards.textContent = '';
        const err = document.createElement('div');
        err.className = 'ms-empty';
        err.textContent = '加载失败，请稍后重试';
        cards.appendChild(err);
      }
      return;
    }

    const s = data.stats || {};
    const categories = data.categories || [];
    const weakest = data.weakest || [];

    // Overview cards
    if (cards) {
      cards.textContent = '';
      cards.appendChild(makeCard('📚', s.total || 0, '累计单词', '#4a90d9'));
      cards.appendChild(makeCard('✨', s.mastered || 0, '已掌握', '#27ae60'));
      cards.appendChild(makeCard('📖', s.learning || 0, '学习中', '#f39c12'));
      cards.appendChild(makeCard('🆕', s.newWords || 0, '新单词', '#9b59b6'));
      cards.appendChild(makeCard('🎯', (s.accuracy || 0) + '%', '正确率', '#e74c3c'));
      cards.appendChild(makeCard('📅', s.dueToday || 0, '今日待复习', '#e67e22'));
    }

    // Category progress
    if (cats) {
      cats.textContent = '';
      const head = document.createElement('div');
      head.className = 'ms-section__head';
      head.textContent = '📊 分类掌握进度';
      cats.appendChild(head);
      if (!categories.length) {
        const empty = document.createElement('div');
        empty.className = 'ms-empty';
        empty.textContent = '还没有学习记录，先去闯一关吧！';
        cats.appendChild(empty);
      } else {
        const colorMap = ['#4a90d9', '#27ae60', '#f39c12', '#e74c3c', '#9b59b6', '#1abc9c', '#e67e22', '#3498db'];
        categories.forEach((c, i) => {
          cats.appendChild(makeProgressBar(
            c.category, c.mastered, c.total,
            colorMap[i % colorMap.length]
          ));
        });
      }
    }

    // Review forecast (next 7 days)
    if (heat) {
      heat.textContent = '';
      const head = document.createElement('div');
      head.className = 'ms-section__head';
      head.textContent = '📅 未来七天复习预报';
      heat.appendChild(head);
      // Fetch player data for forecast
      const reg = window.RegisterModule;
      const logged = reg && typeof reg.getNickname === 'function' ? (reg.getNickname() || '') : '';
      if (logged && window.API && typeof API.srsDue === 'function') {
        API.srsDue(100).then(dueData => {
          // Build a simple playerData-like object from due words
          const playerData = {};
          if (dueData && dueData.due) {
            dueData.due.forEach(w => {
              playerData[w.wordId] = { nextReview: w.nextReview || '' };
            });
          }
          const forecast = makeForecast(playerData);
          heat.appendChild(renderForecast(forecast));
        }).catch(() => {
          const empty = document.createElement('div');
          empty.className = 'ms-empty';
          empty.textContent = '暂无复习数据';
          heat.appendChild(empty);
        });
      } else {
        const empty = document.createElement('div');
        empty.className = 'ms-empty';
        empty.textContent = '登录后查看复习预报';
        heat.appendChild(empty);
      }
    }

    // Weakest words
    if (weak) {
      weak.textContent = '';
      const head = document.createElement('div');
      head.className = 'ms-section__head';
      head.textContent = '⚠️ 需要加强的单词';
      weak.appendChild(head);
      if (!weakest.length) {
        const empty = document.createElement('div');
        empty.className = 'ms-empty';
        empty.textContent = '太棒了，没有薄弱单词！';
        weak.appendChild(empty);
      } else {
        const list = document.createElement('div');
        list.className = 'ms-word-list';
        weakest.forEach(w => {
          const row = document.createElement('div');
          row.className = 'ms-word-row';
          const en = document.createElement('span');
          en.className = 'ms-word-row__en';
          en.textContent = w.english;
          const cn = document.createElement('span');
          cn.className = 'ms-word-row__cn';
          cn.textContent = w.chinese;
          const score = document.createElement('span');
          score.className = 'ms-word-row__score';
          const scoreColor = w.mastery >= 60 ? 'good' : (w.mastery >= 30 ? 'mid' : 'bad');
          score.className = 'ms-word-row__score ms-word-row__score--' + scoreColor;
          score.textContent = '掌握度 ' + w.mastery + '%';
          const wrong = document.createElement('span');
          wrong.className = 'ms-word-row__wrong';
          wrong.textContent = '错 ' + w.wrong + ' 次';
          row.append(en, cn, score, wrong);

          // Show example sentence on click
          if (window.Question && typeof Question.makeSentence === 'function') {
            row.style.cursor = 'pointer';
            row.title = '点击查看例句';
            row.addEventListener('click', () => {
              const sentence = Question.makeSentence({ english: w.english, chinese: w.chinese });
              Utils.toast('📝 ' + w.english + '：' + sentence);
            });
          }
          list.appendChild(row);
        });
        weak.appendChild(list);
      }
    }

    // Due today summary
    if (dueToday) {
      dueToday.textContent = '';
      const head = document.createElement('div');
      head.className = 'ms-section__head';
      head.textContent = '📅 今日待复习：' + (s.dueToday || 0) + ' 个单词';
      dueToday.appendChild(head);
      if (s.dueToday > 0) {
        const hint = document.createElement('div');
        hint.className = 'ms-empty';
        hint.textContent = '进入"错题复习"即可开始今日复习';
        dueToday.appendChild(hint);
      }
    }
  }

  function open() {
    const screen = el('screen-mastery');
    if (!screen) return;
    const g = window._game;
    if (g && typeof g.pauseForModal === 'function') g.pauseForModal();
    screen.classList.remove('hidden');
    refresh();
  }

  function close() {
    const screen = el('screen-mastery');
    if (screen) screen.classList.add('hidden');
    const g = window._game;
    if (g && typeof g.isModalPaused === 'function' && typeof g.resumeFromModal === 'function' && g.isModalPaused()) {
      g.resumeFromModal();
    }
  }

  function init() {
    const openBtn = el('btn-mastery');
    if (openBtn && !openBtn.dataset.wired) {
      openBtn.addEventListener('click', open);
      openBtn.dataset.wired = '1';
    }
    const closeBtn = el('btn-ms-close');
    if (closeBtn && !closeBtn.dataset.wired) {
      closeBtn.addEventListener('click', close);
      closeBtn.dataset.wired = '1';
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        const screen = el('screen-mastery');
        if (screen && !screen.classList.contains('hidden')) {
          e.preventDefault();
          close();
        }
      }
    });
  }

  window.MasteryModule = { open, close, refresh };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();