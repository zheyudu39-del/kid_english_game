/**
 * skills-bar.js - Bottom-of-screen skills bar with coin display.
 * Exposed as window.SkillsBar
 */
(function () {
  'use strict';

  const SkillsBar = {
    /**
     * Render the skills bar.
     * @param {object} player - player record (with coins, skills)
     * @param {object} state - runtime state ({ shieldActive, critActive })
     * @param {Function} onUseSkill - (skillId) => void
     */
    render(player, state, onUseSkill) {
      const coins = (player && player.coins) || 0;
      const skills = (player && player.skills) || { hint: 0, shield: 0, crit: 0 };
      const s = state || {};
      // Guard against missing SKILLS table
      const skillDefs = (window.Worlds && window.Worlds.SKILLS) || { hint: {}, shield: {}, crit: {} };

      return `
        <div class="keg-skills">
          <div class="keg-skills__coins">💰 <span id="keg-coins">${coins}</span></div>
          <div class="keg-skills__row">
            ${['hint', 'shield', 'crit'].map(id => {
              const def = skillDefs[id] || { emoji: '?', name: id, cost: 999 };
              const count = skills[id] || 0;
              const ownedClass = count > 0 ? 'keg-skill--owned' : 'keg-skill--empty';
              // Defensive: state[id+'Active'] may be undefined
              const active = !!(s[id + 'Active']);
              const disabled = (count <= 0 || coins < def.cost || active) ? 'disabled' : '';
              return `
                <button class="keg-skill ${ownedClass}" data-skill="${id}" ${disabled}>
                  <span class="keg-skill__emoji">${def.emoji}</span>
                  <span class="keg-skill__name">${def.name}</span>
                  <span class="keg-skill__count">×${count}</span>
                  <span class="keg-skill__cost">💰${def.cost}</span>
                </button>
              `;
            }).join('')}
          </div>
        </div>
      `;
    },

    /**
     * Bind click handlers to skill buttons.
     * @param {HTMLElement} container - parent of .keg-skills
     * @param {Function} onUseSkill - (skillId) => boolean (true => consumed)
     */
    bind(container, onUseSkill) {
      const root = container.querySelector('.keg-skills');
      if (!root) return;
      root.querySelectorAll('.keg-skill').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          const id = btn.dataset.skill;
          const ok = onUseSkill(id);
          if (ok) {
            // brief pulse
            btn.classList.add('keg-skill--used');
            setTimeout(() => btn.classList.remove('keg-skill--used'), 350);
          }
        });
      });
    },

    /**
     * Update the coin counter without re-rendering the whole bar.
     */
    updateCoins(container, coins) {
      const el = container.querySelector('#keg-coins');
      if (el) el.textContent = coins;
    }
  };

  window.SkillsBar = SkillsBar;
})();
