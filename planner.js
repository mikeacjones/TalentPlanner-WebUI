(async function() {
  const POINTS_PER_TIER = 5;
  const ICON_BASE = 'images/icons/';
  const ORDER_GRID_MIN_COL_WIDTH = 60;
  const ORDER_GRID_GAP = 6;
  const ORDER_GRID_ROW_HEIGHT = 36;

  const FLAVORS = [
    { name: 'Classic', slug: 'classic' },
    { name: 'TBC',     slug: 'tbc' },
  ];

  const CLASS_LIST = [
    { name: 'Druid',   slug: 'druid' },
    { name: 'Hunter',  slug: 'hunter' },
    { name: 'Mage',    slug: 'mage' },
    { name: 'Paladin', slug: 'paladin' },
    { name: 'Priest',  slug: 'priest' },
    { name: 'Rogue',   slug: 'rogue' },
    { name: 'Shaman',  slug: 'shaman' },
    { name: 'Warlock', slug: 'warlock' },
    { name: 'Warrior', slug: 'warrior' },
  ];

  let classData = null;
  let maxPoints = 0;
  let currentFlavor = FLAVORS[1]; // Default TBC
  let currentClass = CLASS_LIST[3]; // Default Paladin

  // State
  const state = {
    trees: [],
    order: [],
  };

  // DOM refs
  const flavorToggle = document.getElementById('flavor-toggle');
  const classPicker = document.getElementById('class-picker');
  const plannerShell = document.getElementById('planner-shell');
  const plannerEl = document.getElementById('planner');
  const treesContainer = document.getElementById('trees-container');
  const orderList = document.getElementById('order-list');
  const pointsLeftEl = document.getElementById('points-left');
  const reqLevelEl = document.getElementById('req-level');
  const exportModal = document.getElementById('export-modal');
  const exportOutput = document.getElementById('export-output');

  // Flavor toggle
  function renderFlavorToggle() {
    flavorToggle.innerHTML = '';
    FLAVORS.forEach(flavor => {
      const btn = document.createElement('button');
      btn.className = `flavor-btn${flavor.slug === currentFlavor.slug ? ' active' : ''}`;
      btn.textContent = flavor.name;
      btn.addEventListener('click', () => {
        currentFlavor = flavor;
        renderFlavorToggle();
        loadCurrentClass();
      });
      flavorToggle.appendChild(btn);
    });
  }

  // Class picker
  function renderClassPicker() {
    classPicker.innerHTML = '';
    CLASS_LIST.forEach(cls => {
      const btn = document.createElement('button');
      btn.className = `class-btn c-${cls.slug}${cls.slug === currentClass.slug ? ' active' : ''}`;
      btn.title = cls.name;
      btn.innerHTML = `<img src="${ICON_BASE}classicon_${cls.slug}.jpg" alt="${cls.name}">`;
      btn.addEventListener('click', () => {
        currentClass = cls;
        renderClassPicker();
        loadCurrentClass();
      });
      classPicker.appendChild(btn);
    });
  }

  async function loadCurrentClass() {
    const file = `data/${currentClass.slug}-${currentFlavor.slug}.json`;
    const resp = await fetch(file);
    classData = await resp.json();
    maxPoints = classData.maxLevel - classData.startingLevel;

    // Reset state
    state.trees = classData.trees.map(tree => ({
      ...tree,
      talents: tree.talents.map(t => ({ ...t, currentRank: 0 })),
    }));
    state.order = [];

    document.title = `${currentFlavor.name} Talent Planner - ${currentClass.name}`;
    renderTrees();

    // Apply URL-encoded build if present and matching current flavor/class
    if (pendingHash) {
      const decoded = decodeURL(pendingHash);
      if (decoded) {
        applySpellIdOrder(decoded.talents);
      }
      pendingHash = null;
    }
  }

  // Helpers
  function getTotalSpent() {
    return state.trees.reduce((sum, tree) =>
      sum + tree.talents.reduce((s, t) => s + t.currentRank, 0), 0);
  }

  function getTreeSpent(treeIndex) {
    return state.trees[treeIndex].talents.reduce((s, t) => s + t.currentRank, 0);
  }

  function getPointsInTiersUpTo(treeIndex, row) {
    return state.trees[treeIndex].talents
      .filter(t => t.row < row)
      .reduce((s, t) => s + t.currentRank, 0);
  }

  function getRequiredPointsForRow(row) {
    return row * POINTS_PER_TIER;
  }

  function findTalent(treeIndex, talentId) {
    return state.trees[treeIndex].talents.find(t => t.id === talentId);
  }

  function prereqsMet(treeIndex, talent) {
    if (!talent.requires || talent.requires.length === 0) return true;
    return talent.requires.every(req => {
      const dep = findTalent(treeIndex, req.id);
      return dep && dep.currentRank >= req.qty;
    });
  }

  function canAllocate(treeIndex, talent) {
    if (getTotalSpent() >= maxPoints) return false;
    if (talent.currentRank >= talent.maxRank) return false;
    if (getPointsInTiersUpTo(treeIndex, talent.row) < getRequiredPointsForRow(talent.row)) return false;
    if (!prereqsMet(treeIndex, talent)) return false;
    return true;
  }

  function hasDependents(treeIndex, talent) {
    return state.trees[treeIndex].talents.some(t =>
      t.currentRank > 0 &&
      t.requires &&
      t.requires.some(r => r.id === talent.id && talent.currentRank <= r.qty)
    );
  }

  function hasHigherTierDependents(treeIndex, talent) {
    const occupiedRows = state.trees[treeIndex].talents
      .filter(t => t.currentRank > 0)
      .map(t => t.row);
    if (occupiedRows.length === 0) return false;
    const maxOccupiedRow = Math.max(...occupiedRows);

    for (let row = maxOccupiedRow; row > talent.row; row--) {
      const talentsInRow = state.trees[treeIndex].talents
        .filter(t => t.row === row && t.currentRank > 0);
      if (talentsInRow.length > 0) {
        const requiredBelow = getRequiredPointsForRow(row);
        const pointsBelowIfRemoved = getPointsInTiersUpTo(treeIndex, row) - (talent.row < row ? 1 : 0);
        if (pointsBelowIfRemoved < requiredBelow) return true;
      }
    }
    return false;
  }

  function canDeallocate(treeIndex, talent) {
    if (talent.currentRank <= 0) return false;
    if (hasDependents(treeIndex, talent)) return false;
    if (hasHigherTierDependents(treeIndex, talent)) return false;
    return true;
  }

  function getTalentState(treeIndex, talent) {
    if (talent.currentRank >= talent.maxRank) return 'maxed';
    if (talent.currentRank > 0) return 'has-points';
    if (canAllocate(treeIndex, talent)) return 'available';
    return 'locked';
  }

  function getReqText(treeIndex, talent) {
    const parts = [];
    const rowReq = getRequiredPointsForRow(talent.row);
    const pointsBelow = getPointsInTiersUpTo(treeIndex, talent.row);
    if (pointsBelow < rowReq) {
      parts.push(`Requires ${rowReq} points in ${state.trees[treeIndex].name}`);
    }
    if (talent.requires) {
      for (const req of talent.requires) {
        const dep = findTalent(treeIndex, req.id);
        if (dep && dep.currentRank < req.qty) {
          parts.push(`Requires ${req.qty} point${req.qty > 1 ? 's' : ''} in ${dep.name}`);
        }
      }
    }
    return parts.join('\n');
  }

  function reserveOrderGridHeight() {
    if (!classData) return;

    orderList.style.minHeight = '';

    const availableWidth = orderList.clientWidth;
    if (!availableWidth) return;

    const columns = Math.max(
      1,
      Math.floor((availableWidth + ORDER_GRID_GAP) / (ORDER_GRID_MIN_COL_WIDTH + ORDER_GRID_GAP))
    );
    const rows = Math.max(1, Math.ceil(maxPoints / columns));
    const reservedHeight =
      rows * ORDER_GRID_ROW_HEIGHT + (rows - 1) * ORDER_GRID_GAP;

    orderList.style.minHeight = `${reservedHeight}px`;
  }

  function updatePlannerScale() {
    plannerShell.style.setProperty('--planner-scale', '1');
    plannerShell.style.height = '';

    reserveOrderGridHeight();

    const plannerWidth = plannerEl.offsetWidth;
    const plannerHeight = plannerEl.offsetHeight;
    if (!plannerWidth || !plannerHeight) return;

    const shellStyle = getComputedStyle(plannerShell);
    const shellPadX = parseFloat(shellStyle.paddingLeft) + parseFloat(shellStyle.paddingRight);
    const shellPadY = parseFloat(shellStyle.paddingTop) + parseFloat(shellStyle.paddingBottom);
    const availableWidth = window.innerWidth - shellPadX;
    const availableHeight = window.innerHeight - shellPadY;

    const scale = Math.min(
      1,
      availableWidth / plannerWidth,
      availableHeight / plannerHeight
    );

    plannerShell.style.setProperty('--planner-scale', String(scale));
    plannerShell.style.height = `${plannerHeight * scale + shellPadY}px`;
  }

  // Rendering
  function renderTrees() {
    treesContainer.innerHTML = '';
    state.trees.forEach((tree, treeIndex) => {
      const treeEl = document.createElement('div');
      treeEl.className = 'tree';

      const treeTalents = tree.talents.slice().sort((a, b) => a.row - b.row || a.col - b.col);
      const firstIcon = treeTalents[0]?.icon || '';

      treeEl.innerHTML = `
        <div class="tree-header">
          <img class="tree-header-icon" src="${ICON_BASE}${firstIcon}.jpg" alt="${tree.name}">
          <h3>${tree.name}</h3>
          <span class="tree-points" data-tree-points="${treeIndex}">0</span>
        </div>
        <div class="tree-body" style="background-image: url('${tree.background}')">
          <div class="talent-grid" data-tree="${treeIndex}"></div>
        </div>
      `;

      const grid = treeEl.querySelector('.talent-grid');
      const maxRow = Math.max(...tree.talents.map(t => t.row));
      const maxCol = 3;

      for (let row = 0; row <= maxRow; row++) {
        for (let col = 0; col <= maxCol; col++) {
          const talent = tree.talents.find(t => t.row === row && t.col === col);
          const cell = document.createElement('div');
          cell.className = 'talent-cell';

          if (talent) {
            cell.innerHTML = `
              <div class="talent locked"
                   data-tree="${treeIndex}"
                   data-talent-id="${talent.id}">
                <img class="talent-icon"
                     src="${ICON_BASE}${talent.icon}.jpg"
                     alt="${talent.name}"
                     draggable="false">
                <span class="talent-rank">0/${talent.maxRank}</span>
              </div>
            `;
          }

          grid.appendChild(cell);
        }
      }

      treesContainer.appendChild(treeEl);
      requestAnimationFrame(() => drawArrows(treeIndex, treeEl));
    });

    updateAllStates();
  }

  function drawArrows(treeIndex, treeEl) {
    treeEl.querySelectorAll('.arrow-line').forEach(a => a.remove());
    treeEl.querySelectorAll('.arrow-head').forEach(a => a.remove());

    const tree = state.trees[treeIndex];
    const grid = treeEl.querySelector('.talent-grid');

    function appendLine(className, styles) {
      const line = document.createElement('div');
      line.className = className;
      Object.assign(line.style, styles);
      grid.appendChild(line);
    }

    function appendArrowHead(x, y, arrowClass, direction = 'down') {
      const head = document.createElement('div');
      head.className = `arrow-head arrow-head-${direction} ${arrowClass}`.trim();
      head.style.left = `${x}px`;
      head.style.top = `${y}px`;
      grid.appendChild(head);
    }

    tree.talents.forEach(talent => {
      if (!talent.requires || talent.requires.length === 0) return;

      talent.requires.forEach(req => {
        const source = findTalent(treeIndex, req.id);
        if (!source) return;

        const sourceEl = grid.querySelector(`[data-talent-id="${req.id}"]`);
        const targetEl = grid.querySelector(`[data-talent-id="${talent.id}"]`);
        if (!sourceEl || !targetEl) return;

        const sx = sourceEl.offsetLeft + sourceEl.offsetWidth / 2;
        const sy = sourceEl.offsetTop + sourceEl.offsetHeight;
        const tx = targetEl.offsetLeft + targetEl.offsetWidth / 2;
        const ty = targetEl.offsetTop;
        const sourceCenterY = sourceEl.offsetTop + sourceEl.offsetHeight / 2;
        const sourceRight = sourceEl.offsetLeft + sourceEl.offsetWidth;
        const sourceLeft = sourceEl.offsetLeft;
        const targetLeft = targetEl.offsetLeft;
        const targetRight = targetEl.offsetLeft + targetEl.offsetWidth;

        let arrowClass = '';
        if (source.currentRank >= req.qty && talent.currentRank >= talent.maxRank) {
          arrowClass = 'maxed';
        } else if (source.currentRank >= req.qty) {
          arrowClass = 'active';
        }

        if (source.row === talent.row) {
          const direction = tx > sx ? 'right' : 'left';
          const startX = direction === 'right' ? sourceRight : targetRight;
          const width = direction === 'right'
            ? targetLeft - sourceRight
            : sourceLeft - targetRight;

          appendLine(`arrow-line arrow-line-h ${arrowClass}`.trim(), {
            left: `${startX}px`,
            top: `${sourceCenterY - 2}px`,
            width: `${width}px`,
          });
          appendArrowHead(direction === 'right' ? targetLeft : targetRight, sourceCenterY, arrowClass, direction);
        } else if (source.col === talent.col) {
          appendLine(`arrow-line arrow-line-v ${arrowClass}`.trim(), {
            left: `${sx - 2}px`,
            top: `${sy}px`,
            height: `${ty - sy}px`,
          });
          appendArrowHead(sx, ty - 7, arrowClass, 'down');
        } else {
          const midY = ty - 10;

          appendLine(`arrow-line arrow-line-v ${arrowClass}`.trim(), {
            left: `${sx - 2}px`,
            top: `${sy}px`,
            height: `${midY - sy}px`,
          });

          const leftX = Math.min(sx, tx);
          const rightX = Math.max(sx, tx);
          appendLine(`arrow-line arrow-line-h ${arrowClass}`.trim(), {
            left: `${leftX}px`,
            top: `${midY - 2}px`,
            width: `${rightX - leftX}px`,
          });

          appendLine(`arrow-line arrow-line-v ${arrowClass}`.trim(), {
            left: `${tx - 2}px`,
            top: `${midY}px`,
            height: `${ty - midY}px`,
          });
          appendArrowHead(tx, ty - 7, arrowClass, 'down');
        }
      });
    });
  }

  function updateAllStates() {
    const totalSpent = getTotalSpent();
    const pointsLeft = maxPoints - totalSpent;
    const reqLevel = classData.startingLevel + totalSpent + 1;

    pointsLeftEl.textContent = pointsLeft;
    reqLevelEl.textContent = reqLevel;

    const perTree = state.trees.map((_, i) => getTreeSpent(i));

    document.querySelectorAll('[data-tree-points]').forEach(el => {
      const idx = parseInt(el.dataset.treePoints);
      el.textContent = perTree[idx];
      el.classList.toggle('has-points', perTree[idx] > 0);
    });

    state.trees.forEach((tree, treeIndex) => {
      tree.talents.forEach(talent => {
        const el = document.querySelector(`[data-talent-id="${talent.id}"]`);
        if (!el) return;

        const talentState = getTalentState(treeIndex, talent);
        el.className = `talent ${talentState}`;

        el.querySelector('.talent-rank').textContent =
          `${talent.currentRank}/${talent.maxRank}`;
      });
    });

    document.querySelectorAll('.tree').forEach((treeEl, treeIndex) => {
      drawArrows(treeIndex, treeEl);
    });

    renderOrder();
    updateURL();
    updatePlannerScale();

    // Refresh tooltip if visible
    if (tooltip.style.display === 'block') {
      const hovered = document.querySelector('.talent:hover');
      if (hovered) showTooltip(hovered);
    }
  }

  function renderOrder() {
    orderList.innerHTML = '';
    state.order.forEach((entry, i) => {
      const level = classData.startingLevel + i + 1;
      const item = document.createElement('div');
      item.className = 'order-item';
      item.innerHTML = `
        <img class="order-item-icon" src="${ICON_BASE}${entry.icon}.jpg" alt="${entry.name}">
        <span class="order-item-level">${level}</span>
      `;
      orderList.appendChild(item);
    });
  }

  // Global tooltip
  const tooltip = document.createElement('div');
  tooltip.className = 'talent-tooltip';
  tooltip.innerHTML = `
    <div class="tooltip-name"></div>
    <div class="tooltip-rank"></div>
    <div class="tooltip-desc"></div>
    <div class="tooltip-next-label"></div>
    <div class="tooltip-next"></div>
    <div class="tooltip-req"></div>
  `;
  document.body.appendChild(tooltip);

  treesContainer.addEventListener('mouseenter', (e) => {
    const talentEl = e.target.closest('.talent');
    if (!talentEl) return;
    showTooltip(talentEl);
  }, true);

  treesContainer.addEventListener('mouseleave', (e) => {
    const talentEl = e.target.closest('.talent');
    if (!talentEl) return;
    tooltip.style.display = 'none';
  }, true);

  treesContainer.addEventListener('mousemove', (e) => {
    const talentEl = e.target.closest('.talent');
    if (!talentEl) { tooltip.style.display = 'none'; return; }
    showTooltip(talentEl);
  });

  function showTooltip(talentEl) {
    const treeIndex = parseInt(talentEl.dataset.tree);
    const talentId = parseInt(talentEl.dataset.talentId);
    const talent = findTalent(treeIndex, talentId);
    if (!talent) return;

    tooltip.querySelector('.tooltip-name').textContent = talent.name;
    tooltip.querySelector('.tooltip-rank').textContent =
      `Rank ${talent.currentRank}/${talent.maxRank}`;

    const displayRank = Math.max(talent.currentRank, 1);
    const descEl = tooltip.querySelector('.tooltip-desc');
    const nextLabelEl = tooltip.querySelector('.tooltip-next-label');
    const nextEl = tooltip.querySelector('.tooltip-next');

    descEl.textContent = talent.descriptions[displayRank - 1];

    if (displayRank < talent.maxRank) {
      nextLabelEl.textContent = 'Next rank:';
      nextEl.textContent = talent.descriptions[displayRank];
    } else {
      nextLabelEl.textContent = '';
      nextEl.textContent = '';
    }

    const reqText = getReqText(treeIndex, talent);
    tooltip.querySelector('.tooltip-req').textContent = reqText;

    tooltip.style.display = 'block';

    const rect = talentEl.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    let top = rect.top - tipRect.height - 6;

    if (left < 4) left = 4;
    if (left + tipRect.width > window.innerWidth - 4) left = window.innerWidth - tipRect.width - 4;
    if (top < 4) top = rect.bottom + 6;

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  // Click to allocate
  treesContainer.addEventListener('click', (e) => {
    const talentEl = e.target.closest('.talent');
    if (!talentEl) return;

    const treeIndex = parseInt(talentEl.dataset.tree);
    const talentId = parseInt(talentEl.dataset.talentId);
    const talent = findTalent(treeIndex, talentId);
    if (!talent) return;

    if (canAllocate(treeIndex, talent)) {
      talent.currentRank++;
      state.order.push({
        treeIndex,
        talentId: talent.id,
        rank: talent.currentRank,
        maxRank: talent.maxRank,
        name: talent.name,
        icon: talent.icon,
      });
      updateAllStates();
    }
  });

  // Right-click to deallocate
  treesContainer.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const talentEl = e.target.closest('.talent');
    if (!talentEl) return;

    const treeIndex = parseInt(talentEl.dataset.tree);
    const talentId = parseInt(talentEl.dataset.talentId);
    const talent = findTalent(treeIndex, talentId);
    if (!talent) return;

    if (canDeallocate(treeIndex, talent)) {
      for (let i = state.order.length - 1; i >= 0; i--) {
        if (state.order[i].talentId === talent.id && state.order[i].rank === talent.currentRank) {
          state.order.splice(i, 1);
          break;
        }
      }
      talent.currentRank--;
      updateAllStates();
    }
  });

  // Reset
  document.getElementById('btn-reset').addEventListener('click', () => {
    state.trees.forEach(tree => {
      tree.talents.forEach(t => { t.currentRank = 0; });
    });
    state.order = [];
    updateAllStates();
  });

  // Build a reverse lookup: spellId -> { treeIndex, talentId }
  function buildSpellIdLookup() {
    const lookup = {};
    state.trees.forEach((tree, treeIndex) => {
      tree.talents.forEach(talent => {
        if (talent.ranks) {
          talent.ranks.forEach(spellId => {
            lookup[spellId] = { treeIndex, talentId: talent.id };
          });
        }
      });
    });
    return lookup;
  }

  const CLASS_TOKENS = {
    druid: 'DRUID', hunter: 'HUNTER', mage: 'MAGE', paladin: 'PALADIN',
    priest: 'PRIEST', rogue: 'ROGUE', shaman: 'SHAMAN', warlock: 'WARLOCK',
    warrior: 'WARRIOR',
  };

  const CLASS_TOKEN_TO_SLUG = Object.fromEntries(
    Object.entries(CLASS_TOKENS).map(([slug, token]) => [token, slug])
  );

  function buildExportJSON() {
    return {
      classToken: CLASS_TOKENS[currentClass.slug] || currentClass.slug.toUpperCase(),
      flavor: currentFlavor.slug,
      talents: state.order.map(entry => {
        const talent = findTalent(entry.treeIndex, entry.talentId);
        return talent.ranks[entry.rank - 1];
      }),
    };
  }

  function encodeURL() {
    if (state.order.length === 0) return '';
    const json = JSON.stringify(buildExportJSON());
    const base64 = btoa(json);
    return `#b/${base64}`;
  }

  function decodeURL(hash) {
    if (!hash || hash.length < 2) return null;
    const raw = hash.substring(1);

    if (!raw.startsWith('b/')) return null;
    try {
      const json = atob(raw.substring(2));
      const data = JSON.parse(json);
      if (!data.classToken || !Array.isArray(data.talents)) return null;
      return data;
    } catch {
      return null;
    }
  }

  function applySpellIdOrder(spellIds) {
    const lookup = buildSpellIdLookup();
    for (const spellId of spellIds) {
      const loc = lookup[spellId];
      if (!loc) continue;
      const talent = findTalent(loc.treeIndex, loc.talentId);
      if (talent && canAllocate(loc.treeIndex, talent)) {
        talent.currentRank++;
        state.order.push({
          treeIndex: loc.treeIndex,
          talentId: talent.id,
          rank: talent.currentRank,
          maxRank: talent.maxRank,
          name: talent.name,
          icon: talent.icon,
        });
      }
    }
    updateAllStates();
  }

  function updateURL() {
    const hash = encodeURL();
    if (hash) {
      history.replaceState(null, '', hash);
    } else {
      history.replaceState(null, '', window.location.pathname);
    }
  }

  // Export
  document.getElementById('btn-export').addEventListener('click', () => {
    const sequence = buildExportJSON();
    exportOutput.value = JSON.stringify(sequence, null, 2);
    exportModal.hidden = false;
  });

  document.getElementById('modal-close').addEventListener('click', () => {
    exportModal.hidden = true;
  });

  exportModal.addEventListener('click', (e) => {
    if (e.target === exportModal) exportModal.hidden = true;
  });

  window.addEventListener('resize', updatePlannerScale);

  document.getElementById('btn-copy').addEventListener('click', () => {
    exportOutput.select();
    navigator.clipboard.writeText(exportOutput.value);
  });

  document.getElementById('btn-link').addEventListener('click', () => {
    const hash = encodeURL();
    if (!hash) return;
    const url = window.location.origin + window.location.pathname + hash;
    navigator.clipboard.writeText(url);
  });

  // Init - check URL hash for encoded build
  let pendingHash = null;
  if (window.location.hash && window.location.hash.length > 1) {
    const decoded = decodeURL(window.location.hash);
    if (decoded) {
      const classSlug = CLASS_TOKEN_TO_SLUG[decoded.classToken];
      const flavorSlug = decoded.flavor;
      if (classSlug) {
        const cls = CLASS_LIST.find(c => c.slug === classSlug);
        if (cls) currentClass = cls;
      }
      if (flavorSlug) {
        const flavor = FLAVORS.find(f => f.slug === flavorSlug);
        if (flavor) currentFlavor = flavor;
      }
      pendingHash = window.location.hash;
    }
  }

  renderFlavorToggle();
  renderClassPicker();
  loadCurrentClass();
})();
