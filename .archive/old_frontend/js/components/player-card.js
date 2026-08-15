/**
 * player-card.js - Animated player avatar on the left of the battle arena.
 * Shows HP, level, attack animations.
 * Exposed as window.PlayerCard
 */
(function () {
  'use strict';

  // Hero faces by age group
  const HERO_EMOJI = {
    3: '🧒', 5: '👦', 7: '🧑', 9: '👨',
    12: '🧙', 15: '🦸', 18: '🧞', 'adult': '🐉'
  };
  const DEFAULT_HERO = '🧒';

  const PlayerCard = {
    /**
     * Resolve the hero emoji for the given age group (handles both number and string keys).
     * @param {number|string} ageGroup
     * @returns {string} emoji
     */
    _heroEmoji(ageGroup) {
      if (ageGroup == null) return DEFAULT_HERO;
      // Try as-is, then as string, then as number
      return window.HERO_EMOJI[ageGroup] ||
             window.HERO_EMOJI[String(ageGroup)] ||
             window.HERO_EMOJI[Number(ageGroup)] ||
             DEFAULT_HERO;
    },

    /**
     * @param {object} opts - { heroEmoji, level, maxHP, currentHP }
     */
    render(opts) {
      const emoji = opts.heroEmoji || (opts.ageGroup != null ? PlayerCard._heroEmoji(opts.ageGroup) : DEFAULT_HERO);
      const level = opts.level || 1;
      const maxHP = opts.maxHP || 100;
      const currentHP = (opts.currentHP != null) ? opts.currentHP : maxHP;
      const pct = Math.max(0, Math.min(100, (currentHP / maxHP) * 100));
      const lowClass = pct < 30 ? 'keg-player__bar--low' : '';

      return `
        <div class="keg-player" id="keg-player-card">
          <div class="keg-player__stage">
            <div class="keg-player__avatar" id="keg-player-avatar">${emoji}</div>
            <div class="keg-player__shadow"></div>
          </div>
          <div class="keg-player__info">
            <div class="keg-player__name">
              <span>🛡️ 英雄</span>
              <span class="keg-player__level">Lv.${level}</span>
            </div>
            <div class="keg-player__bar ${lowClass}">
              <div class="keg-player__bar-fill" style="width:${pct}%"></div>
              <span class="keg-player__bar-text">💚 ${currentHP} / ${maxHP}</span>
            </div>
          </div>
        </div>
      `;
    },

    /**
     * Player swings weapon: avatar lunges forward, projectile flies to monster.
     */
    playAttack(container, onEnd) {
      if (!container) { if (onEnd) onEnd(); return; }
      const avatar = container.querySelector('#keg-player-avatar');
      if (!avatar) { if (onEnd) onEnd(); return; }
      avatar.classList.add('keg-player--swing');
      setTimeout(() => {
        avatar.classList.remove('keg-player--swing');
        if (onEnd) onEnd();
      }, 350);
    },

    /**
     * Player gets hit: avatar shakes and flashes red.
     */
    playHit(container, onEnd) {
      if (!container) { if (onEnd) onEnd(); return; }
      const avatar = container.querySelector('#keg-player-avatar');
      if (!avatar) { if (onEnd) onEnd(); return; }
      avatar.classList.add('keg-player--hit');
      setTimeout(() => {
        avatar.classList.remove('keg-player--hit');
        if (onEnd) onEnd();
      }, 500);
    },

    /**
     * Trigger shield defense animation.
     */
    playShield(container, onEnd) {
      if (!container) { if (onEnd) onEnd(); return; }
      const avatar = container.querySelector('#keg-player-avatar');
      if (!avatar) { if (onEnd) onEnd(); return; }
      avatar.classList.add('keg-player--shield');
      setTimeout(() => {
        avatar.classList.remove('keg-player--shield');
        if (onEnd) onEnd();
      }, 700);
    },

    /**
     * Trigger critical attack animation (glowing aura + lunge).
     */
    playCrit(container, onEnd) {
      if (!container) { if (onEnd) onEnd(); return; }
      const avatar = container.querySelector('#keg-player-avatar');
      if (!avatar) { if (onEnd) onEnd(); return; }
      avatar.classList.add('keg-player--crit');
      setTimeout(() => {
        avatar.classList.remove('keg-player--crit');
        if (onEnd) onEnd();
      }, 600);
    },

    /**
     * Update HP bar.
     */
    updateHP(container, currentHP, maxHP) {
      if (!container) return;
      const bar = container.querySelector('.keg-player__bar-fill');
      const text = container.querySelector('.keg-player__bar-text');
      const wrap = container.querySelector('.keg-player__bar');
      if (!bar || !text) return;
      const pct = Math.max(0, Math.min(100, (currentHP / maxHP) * 100));
      bar.style.width = pct + '%';
      text.textContent = `💚 ${currentHP} / ${maxHP}`;
      if (wrap) wrap.classList.toggle('keg-player__bar--low', pct < 30);
    }
  };

  window.PlayerCard = PlayerCard;
  window.HERO_EMOJI = HERO_EMOJI;
})();
