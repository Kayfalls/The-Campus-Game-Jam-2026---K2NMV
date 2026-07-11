// sim.js — shared authoritative simulation. Pure functions over a state object.
// Runs identically in the browser (solo) and on the host server (multiplayer).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ARENA = { w: 1600, h: 1000 };
  const WALLS = [
    { x: 0, y: 0, w: 1600, h: 24 }, { x: 0, y: 976, w: 1600, h: 24 },
    { x: 0, y: 0, w: 24, h: 1000 }, { x: 1576, y: 0, w: 24, h: 1000 },
    { x: 500, y: 200, w: 40, h: 260 }, { x: 1060, y: 540, w: 40, h: 260 },
    { x: 760, y: 460, w: 220, h: 40 }, { x: 240, y: 700, w: 260, h: 40 },
    { x: 1100, y: 160, w: 260, h: 40 }
  ];
  const SPAWNS = [
    [80, 80], [1520, 80], [80, 920], [1520, 920], [800, 60], [800, 940],
    [60, 500], [1540, 500], [400, 500], [1200, 500], [800, 300], [800, 700]
  ];

  const PLAYER_R = 14, PLAYER_SPEED = 220, PLAYER_MAX_HP = 100;
  const WEAPON_DMG = 20, WEAPON_COOLDOWN = 0.25, WEAPON_RANGE = 620;
  const ECHO_COOLDOWN = 3, ECHO_RADIUS = 480;
  const HUNTER_R = 16, HUNTER_BASE_SPEED = 90, HUNTER_BASE_HP = 60, HUNTER_CONTACT_DMG = 14;
  const RESPAWN_TIME = 3;
  const WAVE_REST = 5;

  function rectsOverlapCircle(rect, cx, cy, r) {
    const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
    const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
    return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
  }

  function resolveWalls(x, y, r) {
    for (const w of WALLS) {
      if (rectsOverlapCircle(w, x, y, r)) {
        const nx = Math.max(w.x, Math.min(x, w.x + w.w));
        const ny = Math.max(w.y, Math.min(y, w.y + w.h));
        let dx = x - nx, dy = y - ny;
        let d = Math.hypot(dx, dy);
        if (d < 0.0001) { dx = 1; dy = 0; d = 1; }
        const push = r - d;
        x += (dx / d) * push;
        y += (dy / d) * push;
      }
    }
    return [x, y];
  }

  function segmentBlocked(x1, y1, x2, y2) {
    for (const w of WALLS) {
      if (segIntersectsRect(x1, y1, x2, y2, w)) return true;
    }
    return false;
  }
  function segIntersectsRect(x1, y1, x2, y2, r) {
    const lines = [
      [r.x, r.y, r.x + r.w, r.y], [r.x + r.w, r.y, r.x + r.w, r.y + r.h],
      [r.x + r.w, r.y + r.h, r.x, r.y + r.h], [r.x, r.y + r.h, r.x, r.y]
    ];
    for (const [x3, y3, x4, y4] of lines) {
      if (segSeg(x1, y1, x2, y2, x3, y3, x4, y4)) return true;
    }
    return false;
  }
  function segSeg(x1, y1, x2, y2, x3, y3, x4, y4) {
    const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
    if (Math.abs(d) < 1e-9) return false;
    const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
    const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
    return t > 0 && t < 1 && u > 0 && u < 1;
  }

  function freeSpawn(rng) {
    return SPAWNS[Math.floor(rng() * SPAWNS.length)];
  }

  function newState(seed) {
    let s = seed >>> 0 || 1;
    const rng = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s % 100000) / 100000; };
    return {
      t: 0, wave: 0, waveTimer: WAVE_REST, phase: 'rest', // rest | active
      players: {}, hunters: [], nextHunterId: 1, rng
    };
  }

  function addPlayer(state, id, name, skin) {
    const [sx, sy] = freeSpawn(state.rng);
    state.players[id] = {
      id, name: (name || 'Diver').slice(0, 16), skin: skin || 0,
      x: sx, y: sy, hp: PLAYER_MAX_HP, alive: true, respawnIn: 0,
      kills: 0, deaths: 0, weaponCd: 0, echoCd: 0, aimX: 1, aimY: 0,
      input: { up: false, down: false, left: false, right: false, aimX: 1, aimY: 0, fire: false, echo: false }
    };
  }
  function removePlayer(state, id) { delete state.players[id]; }
  function setInput(state, id, input) {
    const p = state.players[id];
    if (p) p.input = Object.assign(p.input, input);
  }

  function spawnWave(state) {
    state.wave += 1;
    const count = Math.min(2 + state.wave, 14);
    const hp = HUNTER_BASE_HP + state.wave * 8;
    const speed = HUNTER_BASE_SPEED + Math.min(state.wave * 4, 70);
    for (let i = 0; i < count; i++) {
      const edge = Math.floor(state.rng() * 4);
      let x, y;
      if (edge === 0) { x = 40; y = 40 + state.rng() * (ARENA.h - 80); }
      else if (edge === 1) { x = ARENA.w - 40; y = 40 + state.rng() * (ARENA.h - 80); }
      else if (edge === 2) { x = 40 + state.rng() * (ARENA.w - 80); y = 40; }
      else { x = 40 + state.rng() * (ARENA.w - 80); y = ARENA.h - 40; }
      state.hunters.push({
        id: state.nextHunterId++, x, y, hp, maxHp: hp, speed,
        target: null, stuckTimer: 0, lastX: x, lastY: y
      });
    }
    state.phase = 'active';
  }

  function step(state, dt) {
    state.t += dt;

    if (state.phase === 'rest') {
      state.waveTimer -= dt;
      if (state.waveTimer <= 0) spawnWave(state);
    } else if (state.hunters.length === 0) {
      state.phase = 'rest';
      state.waveTimer = WAVE_REST;
    }

    // players
    for (const id in state.players) {
      const p = state.players[id];
      if (!p.alive) {
        p.respawnIn -= dt;
        if (p.respawnIn <= 0) {
          const [sx, sy] = freeSpawn(state.rng);
          p.x = sx; p.y = sy; p.hp = PLAYER_MAX_HP; p.alive = true;
        }
        continue;
      }
      const inp = p.input;
      let dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      let dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
      const len = Math.hypot(dx, dy) || 1;
      let nx = p.x + (dx / len) * PLAYER_SPEED * dt;
      let ny = p.y + (dy / len) * PLAYER_SPEED * dt;
      nx = Math.max(PLAYER_R, Math.min(ARENA.w - PLAYER_R, nx));
      ny = Math.max(PLAYER_R, Math.min(ARENA.h - PLAYER_R, ny));
      [nx, ny] = resolveWalls(nx, ny, PLAYER_R);
      p.x = nx; p.y = ny;
      if (inp.aimX !== undefined) { p.aimX = inp.aimX; p.aimY = inp.aimY; }

      p.weaponCd = Math.max(0, p.weaponCd - dt);
      p.echoCd = Math.max(0, p.echoCd - dt);
      if (inp.fire && p.weaponCd <= 0) {
        p.weaponCd = WEAPON_COOLDOWN;
        fireWeapon(state, p);
      }
      if (inp.echo && p.echoCd <= 0) {
        p.echoCd = ECHO_COOLDOWN;
        for (const h of state.hunters) {
          if (Math.hypot(h.x - p.x, h.y - p.y) < ECHO_RADIUS) h.target = p.id;
        }
      }
    }

    // hunters
    for (const h of state.hunters) {
      if (!h.target || !state.players[h.target] || !state.players[h.target].alive) {
        let best = null, bestD = Infinity;
        for (const id in state.players) {
          const p = state.players[id];
          if (!p.alive) continue;
          const d = Math.hypot(p.x - h.x, p.y - h.y);
          if (d < bestD) { bestD = d; best = id; }
        }
        h.target = best;
      }
      if (h.target) {
        const p = state.players[h.target];
        const dx = p.x - h.x, dy = p.y - h.y;
        const d = Math.hypot(dx, dy) || 1;
        let nx = h.x + (dx / d) * h.speed * dt;
        let ny = h.y + (dy / d) * h.speed * dt;
        nx = Math.max(HUNTER_R, Math.min(ARENA.w - HUNTER_R, nx));
        ny = Math.max(HUNTER_R, Math.min(ARENA.h - HUNTER_R, ny));
        [nx, ny] = resolveWalls(nx, ny, HUNTER_R);
        if (Math.hypot(nx - h.lastX, ny - h.lastY) < 2) {
          h.stuckTimer += dt;
          if (h.stuckTimer > 0.6) {
            const ang = state.rng() * Math.PI * 2;
            nx += Math.cos(ang) * 30; ny += Math.sin(ang) * 30;
            h.stuckTimer = 0;
          }
        } else h.stuckTimer = 0;
        h.lastX = h.x; h.lastY = h.y;
        h.x = nx; h.y = ny;
        if (d < PLAYER_R + HUNTER_R + 4 && p.alive) {
          p.hp -= HUNTER_CONTACT_DMG * dt;
          if (p.hp <= 0) killPlayer(state, p);
        }
      }
    }
  }

  function fireWeapon(state, shooter) {
    const dirLen = Math.hypot(shooter.aimX, shooter.aimY) || 1;
    const dx = shooter.aimX / dirLen, dy = shooter.aimY / dirLen;
    const ex = shooter.x + dx * WEAPON_RANGE, ey = shooter.y + dy * WEAPON_RANGE;
    let hit = null, hitD = Infinity;
    for (const h of state.hunters) {
      const t = ((h.x - shooter.x) * dx + (h.y - shooter.y) * dy);
      if (t < 0 || t > WEAPON_RANGE) continue;
      const px = shooter.x + dx * t, py = shooter.y + dy * t;
      const perp = Math.hypot(h.x - px, h.y - py);
      if (perp < HUNTER_R + 6 && t < hitD && !segmentBlocked(shooter.x, shooter.y, h.x, h.y)) {
        hit = h; hitD = t;
      }
    }
    if (hit) {
      hit.hp -= WEAPON_DMG;
      if (hit.hp <= 0) {
        state.hunters = state.hunters.filter(h => h !== hit);
        shooter.kills += 1;
      }
    }
  }

  function killPlayer(state, p) {
    p.alive = false; p.deaths += 1; p.respawnIn = RESPAWN_TIME; p.hp = 0;
  }

  function snapshot(state) {
    return {
      t: state.t, wave: state.wave, phase: state.phase, waveTimer: Math.max(0, state.waveTimer),
      players: Object.values(state.players).map(p => ({
        id: p.id, name: p.name, skin: p.skin, x: Math.round(p.x), y: Math.round(p.y),
        hp: Math.round(p.hp), alive: p.alive, kills: p.kills, deaths: p.deaths
      })),
      hunters: state.hunters.map(h => ({ id: h.id, x: Math.round(h.x), y: Math.round(h.y), hp: h.hp, maxHp: h.maxHp }))
    };
  }

  return {
    ARENA, WALLS, newState, addPlayer, removePlayer, setInput, step, snapshot,
    PLAYER_R, HUNTER_R, PLAYER_MAX_HP
  };
});
