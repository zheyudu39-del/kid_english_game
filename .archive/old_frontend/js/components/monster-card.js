/**
 * monster-card.js - Monster visual card with HP bar and animations.
 * The monster moves, attacks, and reacts to damage.
 * Exposed as window.MonsterCard
 */
(function () {
  'use strict';

  const MonsterCard = {
    /**
     * Render the monster card HTML.
     * @param {object} levelCfg - result of LevelGenerator.computeLevel()
     * @param {object} state - { currentHP }
     */
    render(levelCfg, state) {
      const hp = state && typeof state.currentHP === 'number' ? state.currentHP : levelCfg.monsterHP;
      const maxHP = levelCfg.maxHP || levelCfg.monsterHP;
      const pct = Math.max(0, Math.min(100, (hp / maxHP) * 100));
      const cfg = Worlds.MONSTER_TYPES[levelCfg.monsterType] || {};
      const bossClass = levelCfg.isBoss ? 'keg-monster--boss' : '';
      const lowClass = pct < 30 ? 'keg-monster__bar--low' : '';

      return `
        <div class="keg-monster ${bossClass} keg-slide-in" id="keg-monster-card">
          <div class="keg-monster__stage">
            <div class="keg-monster__avatar" id="keg-monster-avatar">${levelCfg.monsterEmoji}</div>
            <div class="keg-monster__shadow"></div>
          </div>
          <div class="keg-monster__info">
            <div class="keg-monster__name">
              ${levelCfg.isBoss ? '<span class="keg-monster__crown">👑</span>' : ''}
              <span>${levelCfg.monsterName}</span>
              <span class="keg-monster__level">Lv.${levelCfg.level}</span>
            </div>
            <div class="keg-monster__bar ${lowClass}">
              <div class="keg-monster__bar-fill" style="width:${pct}%"></div>
              <span class="keg-monster__bar-text">❤️ ${hp} / ${maxHP}</span>
            </div>
            ${levelCfg.isBoss ? '<div class="keg-monster__tag">⚠️ BOSS</div>' : ''}
          </div>
        </div>
      `;
    },

    /**
     * Update only the HP bar (no full re-render).
     */
    updateHP(container, levelCfg, currentHP) {
      if (!container) return;
      const bar = container.querySelector('.keg-monster__bar-fill');
      const text = container.querySelector('.keg-monster__bar-text');
      const wrap = container.querySelector('.keg-monster__bar');
      if (!bar || !text) return;
      const maxHP = levelCfg.maxHP || levelCfg.monsterHP;
      const hp = Math.max(0, currentHP);
      const pct = (hp / maxHP) * 100;
      bar.style.width = pct + '%';
      text.textContent = `❤️ ${hp} / ${maxHP}`;
      if (wrap) {
        wrap.classList.toggle('keg-monster__bar--low', pct < 30);
      }
    },

    /**
     * Flash the monster red on damage hit. Adds a brief shake.
     */
    flashDamage(container) {
      if (!container) return;
      const avatar = container.querySelector('#keg-monster-avatar');
      if (!avatar) return;
      avatar.classList.remove('keg-monster--shake', 'keg-monster--hit');
      // Force reflow so the animation re-triggers
      void avatar.offsetWidth;
      avatar.classList.add('keg-monster--shake', 'keg-monster--hit');
      setTimeout(() => avatar.classList.remove('keg-monster--hit'), 400);
    },

    /**
     * Play monster attack animation (player's turn end, monster attacks player).
     */
    playAttack(container, onEnd) {
      if (!container) { if (onEnd) onEnd(); return; }
      const avatar = container.querySelector('#keg-monster-avatar');
      const stage = container.querySelector('.keg-monster__stage');
      if (!avatar) { if (onEnd) onEnd(); return; }

      // Step 1: charge (scale up & shake)
      stage.classList.add('keg-monster--charge');
      setTimeout(() => {
        stage.classList.remove('keg-monster--charge');
        // Step 2: lunge forward
        avatar.classList.add('keg-monster--lunge');
        setTimeout(() => {
          avatar.classList.remove('keg-monster--lunge');
          // Step 3: attack effect (projectile could be added later)
          if (onEnd) onEnd();
        }, 300);
      }, 400);
    },

    /**
     * Play idle animation (breathing/bobbing) while waiting.
     */
    playIdle(container) {
      if (!container) return;
      const avatar = container.querySelector('#keg-monster-avatar');
      if (!avatar) return;
      avatar.classList.add('keg-monster--idle');
      // Match the CSS animation duration (kegMonsterBreath 2.4s) before toggling off
      setTimeout(() => avatar.classList.remove('keg-monster--idle'), 2400);
    },

    /**
     * Play death animation when HP reaches 0.
     */
    playDeath(container, onEnd) {
      if (!container) { if (onEnd) onEnd(); return; }
      const avatar = container.querySelector('#keg-monster-avatar');
      const card = container.querySelector('#keg-monster-card');
      if (!avatar) { if (onEnd) onEnd(); return; }

      avatar.classList.add('keg-monster--die');
      setTimeout(() => {
        if (card) card.classList.add('keg-monster--fadeout');
        setTimeout(() => {
          if (onEnd) onEnd();
        }, 600);
      }, 800);
    }
  };

  window.MonsterCard = MonsterCard;
})();
