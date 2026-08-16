// map.js - Growth-tree level map screen. Renders all 666 levels as fruits
// on a vertical tree that grows upward: the current few dozen levels fill
// the window, scrolling up (wheel or drag) reveals the later levels.
// Clicking an unlocked level starts it through main.js's startLevelSafe.
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  let booted = false;
  let builtForPlayer = null; // avoid rebuilding identical trees on every open
  let unlockedCache = 1;     // captured per build for makeNode()
  let perWorldCache = 111;

  function game() { return window._game || null; }

  function maxUnlocked() {
    const g = game();
    const total = window.Levels.TOTAL_LEVELS;
    return Math.max(1, Math.min(total, (g && g.maxUnlocked) || 1));
  }

  // Node factory — one fruit on the tree.
  function makeNode(level) {
    const progress = ((level - 1) % perWorldCache) + 1;
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'map-node';
    node.dataset.level = String(level);
    const boss = window.Levels.isBossLevel(level);
    const done = level < unlockedCache;
    const current = level === unlockedCache;
    if (boss) node.classList.add('map-node--boss');
    if (done) node.classList.add('map-node--done');
    else if (current) node.classList.add('map-node--now');
    else node.classList.add('map-node--locked');

    const num = document.createElement('span');
    num.className = 'map-node__num';
    num.textContent = String(level);
    node.appendChild(num);
    if (boss) {
      const crown = document.createElement('span');
      crown.className = 'map-node__crown';
      crown.textContent = '👑';
      node.appendChild(crown);
    } else if (done) {
      const tick = document.createElement('span');
      tick.className = 'map-node__tick';
      tick.textContent = '✓';
      node.appendChild(tick);
    } else if (!current) {
      const lock = document.createElement('span');
      lock.className = 'map-node__lock';
      lock.textContent = '🔒';
      node.appendChild(lock);
    } else {
      const play = document.createElement('span');
      play.className = 'map-node__play';
      play.textContent = '▶';
      node.appendChild(play);
    }
    node.setAttribute('aria-label', '第 ' + level + ' 关' + (boss ? ' Boss' : '') + (done ? '，已通关' : (current ? '，当前关卡' : '，未解锁')));
    return node;
  }

  // Build (or rebuild) the tree. Levels are appended highest-first so the
  // top of the scroll area is the END of the journey — scrolling up (as
  // opposed to down a list) moves you toward later levels, matching the
  // "growth" metaphor. Three fruits share one branch row (plus a dedicated
  // centered knot for every boss), so a window holds a few dozen levels.
  function buildTree() {
    const tree = el('map-tree');
    if (!tree) return;
    const total = window.Levels.TOTAL_LEVELS;
    const perWorld = window.Levels.LEVELS_PER_WORLD;
    perWorldCache = perWorld;
    const worlds = window.Levels.WORLDS;
    unlockedCache = maxUnlocked();
    tree.textContent = '';

    const frag = document.createDocumentFragment();
    let pending = []; // consecutive non-boss levels, flushed 3 per branch row

    function flushRow() {
      if (!pending.length) return;
      const row = document.createElement('div');
      row.className = 'map-row';
      pending
        .slice()
        .sort((a, b) => a - b) // ascending: left → mid → right fruit
        .forEach(lv => row.appendChild(makeNode(lv)));
      frag.appendChild(row);
      pending = [];
    }

    for (let level = total; level >= 1; level--) {
      const progress = ((level - 1) % perWorld) + 1;
      // World banner sits above the world's first level (level 1, 112, ...)
      if (progress === 1) {
        flushRow();
        const w = worlds[Math.floor((level - 1) / perWorld)] || worlds[0];
        const banner = document.createElement('div');
        banner.className = 'map-world';
        banner.style.setProperty('--w-accent', w.accentColor);
        const emoji = document.createElement('span');
        emoji.className = 'map-world__emoji';
        emoji.textContent = w.emoji;
        const label = document.createElement('span');
        label.className = 'map-world__name';
        label.textContent = w.name + ' · 第 ' + level + '-' + (level + perWorld - 1) + ' 关';
        banner.append(emoji, label);
        frag.appendChild(banner);
      }
      if (window.Levels.isBossLevel(level)) {
        flushRow(); // bosses never share a branch
        const row = document.createElement('div');
        row.className = 'map-row map-row--boss';
        row.appendChild(makeNode(level));
        frag.appendChild(row);
      } else {
        pending.push(level);
        if (pending.length === 3) flushRow();
      }
    }
    flushRow();
    tree.appendChild(frag);

    // Summit star crowns the very top (first level of the DOM = level 666).
    const top = document.createElement('div');
    top.className = 'map-top';
    top.textContent = '🌟';
    const topLabel = document.createElement('span');
    topLabel.className = 'map-top__label';
    topLabel.textContent = '第 666 关 · 登顶';
    top.appendChild(topLabel);
    tree.prepend(top);

    // Roots + grass mound anchor the tree under level 1.
    const roots = document.createElement('div');
    roots.className = 'map-roots';
    roots.setAttribute('aria-hidden', 'true');
    tree.appendChild(roots);

    const prog = el('map-progress');
    if (prog) {
      const cleared = unlockedCache - 1;
      prog.textContent = '已通关 ' + cleared + ' / ' + total + ' 关 · 当前第 ' + unlockedCache + ' 关';
    }
  }

  // Center the scroll window on the current level so the map opens showing
  // "the levels around you", never the top of the tree. Uses viewport
  // rectangles (not offsetTop — the rows are positioned containers, so
  // offsetTop is relative to the row, not the tree).
  function scrollToCurrent() {
    const scroll = el('map-scroll');
    if (!scroll) return;
    const node = scroll.querySelector('.map-node--now') || scroll.querySelector('.map-node--done');
    if (!node) return;
    const r = node.getBoundingClientRect();
    const sr = scroll.getBoundingClientRect();
    // Park the current level ~74% down the window so a few dozen LATER
    // levels are already visible above it (the tree grows upward).
    scroll.scrollTop += r.top - sr.top - sr.height * 0.74;
  }

  function open() {
    const screen = el('screen-map');
    if (!screen) return;
    const g = game();
    if (g && typeof g.pauseForModal === 'function') g.pauseForModal();
    const playerKey = (g && g.playerName) + '|' + maxUnlocked();
    if (builtForPlayer !== playerKey) {
      buildTree();
      builtForPlayer = playerKey;
    }
    screen.classList.remove('hidden');
    scrollToCurrent();
  }

  function close() {
    const screen = el('screen-map');
    if (screen) screen.classList.add('hidden');
    const g = game();
    if (g && typeof g.isModalPaused === 'function' && typeof g.resumeFromModal === 'function' && g.isModalPaused()) {
      g.resumeFromModal();
    }
  }

  function onNodeClick(e) {
    const node = e.target.closest('.map-node');
    if (!node) return;
    const level = parseInt(node.dataset.level, 10);
    if (!Number.isFinite(level)) return;
    if (level > maxUnlocked()) {
      node.classList.remove('shake');
      void node.offsetWidth; // restart the CSS animation
      node.classList.add('shake');
      if (window.Sound) window.Sound.play('wrong');
      Utils.toast('先通过前面的关卡才能解锁这里哦');
      return;
    }
    if (window.Sound) window.Sound.play('unlock');
    close();
    window.dispatchEvent(new CustomEvent('wordhunter:start-level', { detail: { level } }));
  }

  // Drag-to-scroll (mouse + touch): kids shouldn't need a scroll wheel to
  // climb the tree. A short drag (< 6px) still counts as a click because
  // the click lands on the node; longer drags scroll and suppress it.
  function bindDragScroll() {
    const scroll = el('map-scroll');
    if (!scroll || scroll.dataset.wired) return;
    scroll.dataset.wired = '1';
    let dragging = false;
    let startY = 0;
    let startTop = 0;
    let moved = 0;
    scroll.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.map-node') && e.pointerType === 'mouse' && e.button !== 0) return;
      dragging = true;
      moved = 0;
      startY = e.clientY;
      startTop = scroll.scrollTop;
      scroll.classList.add('dragging');
    });
    scroll.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      moved = Math.max(moved, Math.abs(dy));
      if (moved > 6) scroll.scrollTop = startTop - dy;
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      scroll.classList.remove('dragging');
    };
    scroll.addEventListener('pointerup', end);
    scroll.addEventListener('pointercancel', end);
    scroll.addEventListener('pointerleave', end);
    // Suppress the click that follows a real drag so the tree doesn't start
    // a level the user only used as a hand-hold.
    scroll.addEventListener('click', (e) => {
      if (moved > 6) { e.stopPropagation(); e.preventDefault(); moved = 0; }
    }, true);
  }

  function init() {
    if (booted) return;
    booted = true;

    const btn = el('btn-map');
    if (btn && !btn.dataset.wired) {
      btn.addEventListener('click', open);
      btn.dataset.wired = '1';
    }
    const closeBtn = el('btn-map-close');
    if (closeBtn && !closeBtn.dataset.wired) {
      closeBtn.addEventListener('click', close);
      closeBtn.dataset.wired = '1';
    }
    const tree = el('map-tree');
    if (tree && !tree.dataset.wired) {
      tree.addEventListener('click', onNodeClick);
      tree.dataset.wired = '1';
    }
    bindDragScroll();
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      const screen = el('screen-map');
      if (screen && !screen.classList.contains('hidden')) {
        e.preventDefault();
        close();
      }
    });
  }

  window.MapModule = { init, open, close, rebuild: buildTree };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
