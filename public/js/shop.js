// shop.js - Hunter shop: weapons + consumables.
// The server (/api/shop) is authoritative for prices & ownership; this module
// keeps a local mirror of the catalog so firing stats work even offline.
(function () {
  'use strict';

  const FALLBACK_WEAPONS = [
    { id: 'wooden',      name: '木制猎枪', emoji: '🔫', price: 0,   desc: '猎人的第一把枪，稳定可靠。', stats: { fireCooldown: 320, bulletSpeed: 9,  bulletRadius: 6, multishot: 1, spread: 0,    ammoBonus: 0, color: '#ffd700' } },
    { id: 'longbow',     name: '猎鹰长弓', emoji: '🏹', price: 120, desc: '弹道极快、命中判定大，射速较慢。', stats: { fireCooldown: 620, bulletSpeed: 14, bulletRadius: 10, multishot: 1, spread: 0,    ammoBonus: 0, color: '#ffd700' } },
    { id: 'crossbow',    name: '疾风连弩', emoji: '⚡', price: 200, desc: '极速连发，附带额外弹药。', stats: { fireCooldown: 170, bulletSpeed: 10, bulletRadius: 5,  multishot: 1, spread: 0,    ammoBonus: 3, color: '#9ecbff' } },
    { id: 'blunderbuss', name: '轰天火铳', emoji: '🧨', price: 320, desc: '一枪五弹扇形散射，近身火力十足。', stats: { fireCooldown: 700, bulletSpeed: 8,  bulletRadius: 5,  multishot: 5, spread: 0.55, ammoBonus: 2, color: '#ff9f43' } },
    { id: 'starstaff',   name: '星辰法杖', emoji: '🌟', price: 500, desc: '星光弹极速飞行，弹药储备充足。', stats: { fireCooldown: 260, bulletSpeed: 16, bulletRadius: 8,  multishot: 1, spread: 0,    ammoBonus: 5, color: '#c9a6ff' } }
  ];

  const FALLBACK_ITEMS = [
    { id: 'health-potion',  name: '生命药水', emoji: '❤️', price: 50,  desc: '立即回复 1 点生命（最多 3 点）。' },
    { id: 'ammo-crate',     name: '弹药箱',   emoji: '🔋', price: 60,  desc: '本关立即补充 10 发子弹。' },
    { id: 'guard-shield',   name: '守护护盾', emoji: '🛡️', price: 80,  desc: '获得 6 秒无敌护盾。' },
    { id: 'time-hourglass', name: '时间沙漏', emoji: '⏳', price: 90,  desc: '本关剩余时间 +15 秒。' },
    { id: 'stun-bomb',      name: '眩晕手雷', emoji: '💥', price: 100, desc: '眩晕全场小怪 4 秒。' }
  ];

  const DEFAULT_STATS = { fireCooldown: 320, bulletSpeed: 9, bulletRadius: 6, multishot: 1, spread: 0, ammoBonus: 0, color: '#ffd700' };

  let catalog = { weapons: FALLBACK_WEAPONS, items: FALLBACK_ITEMS, startingWeapon: 'wooden' };
  let profile = null;
  let activeTab = 'weapons';
  let busy = false;

  const game = () => window._game || null;
  function el(id) { return document.getElementById(id); }

  function loggedInName() {
    const reg = window.RegisterModule;
    if (reg && reg.isLoggedIn && reg.isLoggedIn()) return reg.getNickname();
    const g = game();
    if (g && g.playerName) return g.playerName;
    return '';
  }

  function weapons() { return catalog.weapons || FALLBACK_WEAPONS; }
  function items() { return catalog.items || FALLBACK_ITEMS; }
  function getWeapon(id) { return weapons().find(w => w.id === id) || null; }
  function getItem(id) { return items().find(i => i.id === id) || null; }

  function rateLabel(ms) {
    if (ms <= 200) return '极快';
    if (ms <= 320) return '快';
    if (ms <= 500) return '中';
    return '慢';
  }

  function statLines(stats) {
    const s = stats || DEFAULT_STATS;
    const lines = [
      { label: '射速', value: rateLabel(s.fireCooldown) },
      { label: '弹速', value: String(s.bulletSpeed) },
      { label: '命中', value: String(s.bulletRadius) }
    ];
    if (s.multishot > 1) lines.push({ label: '散射', value: 'x' + s.multishot });
    if (s.ammoBonus > 0) lines.push({ label: '弹药', value: '+' + s.ammoBonus });
    return lines;
  }

  function makeCard() {
    const card = document.createElement('div');
    card.className = 'shop-card';
    return card;
  }

  function renderWeapons() {
    const grid = el('shop-grid');
    grid.innerHTML = '';
    const owned = (profile && profile.inventory && Array.isArray(profile.inventory.weapons)) ? profile.inventory.weapons : [];
    const equipped = (profile && profile.equippedWeapon) || 'wooden';
    const coins = (profile && typeof profile.coins === 'number') ? profile.coins : (game() ? game().coins : 0);

    weapons().forEach(w => {
      const card = makeCard();
      const isOwned = owned.includes(w.id);
      const isEquipped = equipped === w.id;
      if (isEquipped) card.classList.add('equipped');
      if (isOwned) card.classList.add('owned');

      const emoji = document.createElement('div');
      emoji.className = 'shop-card__emoji';
      emoji.textContent = w.emoji;
      const name = document.createElement('div');
      name.className = 'shop-card__name';
      name.textContent = w.name;
      const desc = document.createElement('div');
      desc.className = 'shop-card__desc';
      desc.textContent = w.desc;
      const stats = document.createElement('div');
      stats.className = 'shop-card__stats';
      statLines(w.stats).forEach(sl => {
        const chip = document.createElement('span');
        chip.className = 'shop-card__stat';
        chip.textContent = sl.label + ' ' + sl.value;
        stats.appendChild(chip);
      });
      const foot = document.createElement('div');
      foot.className = 'shop-card__foot';
      const price = document.createElement('span');
      price.className = 'shop-card__price';
      price.textContent = '🪙 ' + w.price;
      foot.appendChild(price);
      const btn = document.createElement('button');
      btn.className = 'shop-card__btn';
      btn.type = 'button';
      if (isEquipped) {
        btn.textContent = '✅ 已装备';
        btn.disabled = true;
      } else if (isOwned) {
        btn.textContent = '🎯 装备';
        btn.addEventListener('click', () => equip(w.id));
      } else {
        btn.textContent = '购买';
        btn.disabled = coins < w.price;
        btn.addEventListener('click', () => buy(w.id));
      }
      foot.appendChild(btn);
      card.append(emoji, name, desc, stats, foot);
      grid.appendChild(card);
    });
  }

  function renderItems() {
    const grid = el('shop-grid');
    grid.innerHTML = '';
    const counts = (profile && profile.inventory && profile.inventory.items) || {};
    const coins = (profile && typeof profile.coins === 'number') ? profile.coins : (game() ? game().coins : 0);

    items().forEach(it => {
      const card = makeCard();
      const count = Number(counts[it.id]) || 0;
      if (count > 0) card.classList.add('owned');
      const emoji = document.createElement('div');
      emoji.className = 'shop-card__emoji';
      emoji.textContent = it.emoji;
      const name = document.createElement('div');
      name.className = 'shop-card__name';
      name.textContent = it.name;
      const desc = document.createElement('div');
      desc.className = 'shop-card__desc';
      desc.textContent = it.desc;
      const owned = document.createElement('div');
      owned.className = 'shop-card__owned';
      owned.textContent = '拥有: ' + count;
      const foot = document.createElement('div');
      foot.className = 'shop-card__foot';
      const price = document.createElement('span');
      price.className = 'shop-card__price';
      price.textContent = '🪙 ' + it.price;
      foot.appendChild(price);
      const btn = document.createElement('button');
      btn.className = 'shop-card__btn';
      btn.type = 'button';
      btn.textContent = '购买';
      btn.disabled = coins < it.price;
      btn.addEventListener('click', () => buy(it.id));
      foot.appendChild(btn);
      card.append(emoji, name, desc, owned, foot);
      grid.appendChild(card);
    });
  }

  function render() {
    const coins = (profile && typeof profile.coins === 'number') ? profile.coins : (game() ? game().coins : 0);
    setCoins(coins);
    if (activeTab === 'weapons') renderWeapons();
    else renderItems();
    updateFoot();
  }

  function updateFoot() {
    const foot = el('shop-foot');
    if (!foot) return;
    if (!loggedInName()) {
      foot.textContent = '🔒 请先登录账号，才能用金币购买装备和道具';
      foot.classList.add('locked');
    } else {
      foot.textContent = '';
      foot.classList.remove('locked');
    }
  }

  function setCoins(n) {
    const shop = el('shop-coins');
    if (shop) shop.textContent = '🪙 ' + (Number.isFinite(n) ? n : 0);
    const title = el('title-coins');
    if (title) title.textContent = '🪙 ' + (Number.isFinite(n) ? n : 0);
  }

  function syncToGame(p) {
    const g = game();
    if (!g || !p) return;
    if (typeof p.coins === 'number' && Number.isFinite(p.coins)) g.coins = p.coins;
    if (typeof p.equippedWeapon === 'string' && p.equippedWeapon) g.equippedWeapon = p.equippedWeapon;
    if (p.inventory) {
      g.inventory = p.inventory;
      g.items = Object.assign({}, p.inventory.items || {});
    }
  }

  async function loadProfile() {
    const name = loggedInName();
    if (!name) { profile = null; return; }
    try {
      profile = await window.API.getOwnProfile(name);
    } catch (e) {
      const g = game();
      profile = g ? { coins: g.coins, equippedWeapon: g.equippedWeapon || 'wooden', inventory: g.inventory || { weapons: ['wooden'], items: {} } } : null;
    }
    if (profile) syncToGame(profile);
  }

  async function open() {
    const screen = el('screen-shop');
    if (!screen) return;
    const g = game();
    if (g && typeof g.pauseForModal === 'function') g.pauseForModal();
    screen.classList.remove('hidden');
    try {
      catalog = await window.API.getShop();
    } catch (e) {
      catalog = { weapons: FALLBACK_WEAPONS, items: FALLBACK_ITEMS, startingWeapon: 'wooden' };
    }
    setActiveTab('weapons');
    await loadProfile();
    render();
  }

  function close() {
    const screen = el('screen-shop');
    if (screen) screen.classList.add('hidden');
    const g = game();
    if (g && typeof g.isModalPaused === 'function' && typeof g.resumeFromModal === 'function' && g.isModalPaused()) {
      g.resumeFromModal();
    }
  }

  function setActiveTab(tab) {
    activeTab = tab;
    const wt = el('tab-weapons');
    const it = el('tab-items');
    if (wt) wt.classList.toggle('active', tab === 'weapons');
    if (it) it.classList.toggle('active', tab === 'items');
    render();
  }

  async function buy(id) {
    if (busy) return;
    const name = loggedInName();
    if (!name) { window.Utils.toast('请先登录账号'); return; }
    busy = true;
    try {
      const res = await window.API.buyItem(name, id);
      if (res && res.player) {
        profile = res.player;
        syncToGame(res.player);
        window.Utils.playBeep('coin');
        window.Utils.toast('购买成功！');
        render();
      }
    } catch (e) {
      window.Utils.toast((e && e.message) || '购买失败');
    } finally {
      busy = false;
    }
  }

  async function equip(id) {
    if (busy) return;
    const name = loggedInName();
    if (!name) { window.Utils.toast('请先登录账号'); return; }
    busy = true;
    try {
      const res = await window.API.equipWeapon(name, id);
      if (res && res.player) {
        profile = res.player;
        syncToGame(res.player);
        window.Utils.playBeep('catch');
        window.Utils.toast('已装备！');
        render();
      }
    } catch (e) {
      window.Utils.toast((e && e.message) || '装备失败');
    } finally {
      busy = false;
    }
  }

  function init() {
    const closeBtn = el('btn-shop-close');
    if (closeBtn && !closeBtn.dataset.wired) {
      closeBtn.addEventListener('click', close);
      closeBtn.dataset.wired = '1';
    }
    const wt = el('tab-weapons');
    const it = el('tab-items');
    if (wt && !wt.dataset.wired) {
      wt.addEventListener('click', () => setActiveTab('weapons'));
      wt.dataset.wired = '1';
    }
    if (it && !it.dataset.wired) {
      it.addEventListener('click', () => setActiveTab('items'));
      it.dataset.wired = '1';
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        const screen = el('screen-shop');
        if (screen && !screen.classList.contains('hidden')) {
          e.preventDefault();
          close();
        }
      }
    });
  }

  window.ShopModule = {
    init, open, close, setCoins, syncToGame,
    getWeaponStats(id) { const w = getWeapon(id); return (w && w.stats) || DEFAULT_STATS; },
    getWeaponMeta(id) { return getWeapon(id) || null; },
    getItemMeta(id) { return getItem(id) || null; },
    weapons, items
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();