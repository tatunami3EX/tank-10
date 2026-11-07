// ==========================================================================
// TANK-10: Browser-Ready Game Simulation Engine (P2P Host / Local Authority)
// ==========================================================================

(function(window) {
  // 1. Game Constants
  const CONSTANTS = {
    MAP_GRID_SIZE: 64,
    TILE_SIZE: 36,
    MATCH_DURATION_SEC: 300,
    MAX_PLAYERS: 20,
    TICK_RATE: 30,

    TILE: {
      FLOOR: 0,
      INDESTRUCTIBLE: 1,
      DESTRUCTIBLE: 2
    },

    DESTRUCTIBLE_WALL_HP: 50,

    // 20 Spawn ratio points (scaled automatically to 64x64 or 96x96)
    SPAWN_RATIOS: [
      { rx: 0.10, ry: 0.10 }, // 1. NW
      { rx: 0.50, ry: 0.08 }, // 2. N
      { rx: 0.90, ry: 0.10 }, // 3. NE
      { rx: 0.92, ry: 0.50 }, // 4. E
      { rx: 0.90, ry: 0.90 }, // 5. SE
      { rx: 0.50, ry: 0.92 }, // 6. S
      { rx: 0.10, ry: 0.90 }, // 7. SW
      { rx: 0.08, ry: 0.50 }, // 8. W
      { rx: 0.30, ry: 0.30 }, // 9. Inner NW
      { rx: 0.70, ry: 0.70 }, // 10. Inner SE
      { rx: 0.70, ry: 0.30 }, // 11. Inner NE
      { rx: 0.30, ry: 0.70 }, // 12. Inner SW
      { rx: 0.30, ry: 0.10 }, // 13. N-NW
      { rx: 0.70, ry: 0.10 }, // 14. N-NE
      { rx: 0.90, ry: 0.30 }, // 15. E-NE
      { rx: 0.90, ry: 0.70 }, // 16. E-SE
      { rx: 0.70, ry: 0.90 }, // 17. S-SE
      { rx: 0.30, ry: 0.90 }, // 18. S-SW
      { rx: 0.10, ry: 0.70 }, // 19. W-SW
      { rx: 0.10, ry: 0.30 }  // 20. W-NW
    ],

    getSpawnPoints: function(gridSize = 64) {
      return this.SPAWN_RATIOS.map((pt, idx) => ({
        gridX: Math.max(3, Math.min(gridSize - 4, Math.round(pt.rx * gridSize))),
        gridY: Math.max(3, Math.min(gridSize - 4, Math.round(pt.ry * gridSize))),
        name: `Spawn ${idx + 1}`
      }));
    },

    TANK_TYPES: {
      standard: {
        id: 'standard',
        name: 'スタンダード',
        enName: 'Standard',
        description: 'クセのない万能型',
        color: '#22c55e',
        hp: 100,
        speed: 180,
        damage: 25,
        cooldown: 0.5,
        bulletSpeed: 550,
        bulletRange: 600,
        bulletRadius: 4.5,
        wallDamageMultiplier: 1.0,
        hasLaserSight: false,
        bodyRadius: 14.5,
        turretLength: 18
      },
      assault: {
        id: 'assault',
        name: 'アサルト',
        enName: 'Assault',
        description: '移動速度と連射力で圧倒する前衛型',
        color: '#eab308',
        hp: 70,
        speed: 240,
        damage: 13,
        cooldown: 0.18,
        bulletSpeed: 520,
        bulletRange: 420,
        bulletRadius: 3.5,
        wallDamageMultiplier: 1.35, // Rapid wall breaking in ~3 shots
        hasLaserSight: false,
        bodyRadius: 13.5,
        turretLength: 16
      },
      heavy: {
        id: 'heavy',
        name: 'ヘビー',
        enName: 'Heavy',
        description: '圧倒的な高耐久で前線を押し上げる',
        color: '#3b82f6',
        hp: 200,
        speed: 125,
        damage: 40,
        cooldown: 0.95,
        bulletSpeed: 460,
        bulletRange: 650,
        bulletRadius: 7.0,
        wallDamageMultiplier: 1.0,
        hasLaserSight: false,
        bodyRadius: 15.0, // 1マス（36px）の通路をスムーズに通過可能
        turretLength: 22
      },
      sniper: {
        id: 'sniper',
        name: 'スナイパー',
        enName: 'Sniper',
        description: '長距離からの一撃必殺（照準線表示）',
        color: '#a855f7',
        hp: 60,
        speed: 135,
        damage: 70,
        cooldown: 1.7,
        bulletSpeed: 1100,
        bulletRange: 1200,
        bulletRadius: 4.0,
        wallDamageMultiplier: 1.0,
        hasLaserSight: true,
        bodyRadius: 13.5,
        turretLength: 26
      },
      breaker: {
        id: 'breaker',
        name: 'ブレイカー',
        enName: 'Breaker',
        description: '壁ブロック破壊＆重火器超火力（HP140・攻撃42・壁一撃粉砕）',
        color: '#ef4444',
        hp: 140,                   // Heavy-tier HP (was 110)
        speed: 180,                // Standard speed (was 170)
        damage: 42,                // Massive firepower (was 30)
        cooldown: 0.65,            // Faster rate (was 0.75)
        bulletSpeed: 550,          // Faster bullet (was 490)
        bulletRange: 580,
        bulletRadius: 6.5,
        wallDamageMultiplier: 2.0, // 84 damage against walls (1-shot instant obliteration!)
        hasLaserSight: false,
        bodyRadius: 15.0,
        turretLength: 20
      },
      phantom: {
        id: 'phantom',
        name: 'ファントム',
        enName: 'Phantom',
        description: '【隠し戦車】2連装高速プラズマ砲＆超高機動サイバーアーマー',
        color: '#f59e0b',
        hp: 150,
        speed: 215,
        damage: 38,
        cooldown: 0.35,
        bulletSpeed: 750,
        bulletRange: 850,
        bulletRadius: 5.0,
        wallDamageMultiplier: 2.0,
        hasLaserSight: true,
        isDualBarrel: true,
        isSecret: true,
        bodyRadius: 14.5,
        turretLength: 22
      }
    }
  };

  // Helper: Check if player qualifies for Kolibri secret miniaturization
  // (Standard tank + Name "kolibri" case-insensitive)
  function isKolibriPlayer(player) {
    if (!player || player.tankType !== 'standard') return false;
    const name = (player.name || '').trim().toLowerCase();
    return name === 'kolibri';
  }

  // 2. Procedural Map Generator (Supports 64x64 and 96x96 dynamic scaling)
  class EngineMapGenerator {
    static generate(size = 64) {
      const tiles = Array.from({ length: size }, () => new Array(size).fill(0));
      const wallHp = Array.from({ length: size }, () => new Array(size).fill(0));
      const spawnPoints = CONSTANTS.getSpawnPoints(size);

      // Outer boundary walls
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (x === 0 || y === 0 || x === size - 1 || y === size - 1) {
            tiles[y][x] = CONSTANTS.TILE.INDESTRUCTIBLE;
          } else {
            tiles[y][x] = CONSTANTS.TILE.FLOOR;
          }
        }
      }

      // Safe clearance around each spawn zone (3x3 area)
      const isSpawnZone = (x, y) => {
        for (const sp of spawnPoints) {
          if (Math.abs(sp.gridX - x) <= 2 && Math.abs(sp.gridY - y) <= 2) return true;
        }
        return false;
      };

      // Indestructible structural pillars
      for (let y = 3; y < size - 3; y += 4) {
        for (let x = 3; x < size - 3; x += 4) {
          if (isSpawnZone(x, y)) continue;
          const hash = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
          const val = hash - Math.floor(hash);

          if (val < 0.22) {
            tiles[y][x] = CONSTANTS.TILE.INDESTRUCTIBLE;
            if (val < 0.08 && x + 1 < size - 2 && !isSpawnZone(x + 1, y)) {
              tiles[y][x + 1] = CONSTANTS.TILE.INDESTRUCTIBLE;
            }
            if (val >= 0.08 && val < 0.16 && y + 1 < size - 2 && !isSpawnZone(x, y + 1)) {
              tiles[y + 1][x] = CONSTANTS.TILE.INDESTRUCTIBLE;
            }
          }
        }
      }

      // Destructible brick walls
      for (let y = 2; y < size - 2; y++) {
        for (let x = 2; x < size - 2; x++) {
          if (tiles[y][x] !== CONSTANTS.TILE.FLOOR || isSpawnZone(x, y)) continue;
          const noise = (Math.sin(x * 0.45) + Math.cos(y * 0.45) + Math.sin((x + y) * 0.3)) / 3;
          const r = Math.random();

          if (noise > 0.15 && r < 0.55) {
            tiles[y][x] = CONSTANTS.TILE.DESTRUCTIBLE;
            wallHp[y][x] = CONSTANTS.DESTRUCTIBLE_WALL_HP;
          } else if (r < 0.08) {
            tiles[y][x] = CONSTANTS.TILE.DESTRUCTIBLE;
            wallHp[y][x] = CONSTANTS.DESTRUCTIBLE_WALL_HP;
          }
        }
      }

      // Guaranteed Connectivity between spawns (Clear paths through indestructible obstacles)
      const start = spawnPoints[0];
      for (let i = 1; i < spawnPoints.length; i++) {
        const target = spawnPoints[i];
        let cx = start.gridX;
        let cy = start.gridY;
        while (cx !== target.gridX || cy !== target.gridY) {
          if (tiles[cy][cx] === CONSTANTS.TILE.INDESTRUCTIBLE) {
            tiles[cy][cx] = CONSTANTS.TILE.DESTRUCTIBLE;
            wallHp[cy][cx] = CONSTANTS.DESTRUCTIBLE_WALL_HP;
          }
          if (cx < target.gridX) cx++;
          else if (cx > target.gridX) cx--;
          else if (cy < target.gridY) cy++;
          else if (cy > target.gridY) cy--;
        }
      }

      return { tiles, wallHp, gridSize: size, tileSize: CONSTANTS.TILE_SIZE };
    }
  }

  // 3. Advanced Bot AI (Physics-Checked 8-Way Navigation, Anti-Stuck Steering & Predictive Deflection Shooting)
  class EngineBotAI {
    constructor(player) {
      this.player = player;
      this.wanderTimer = 0;
      this.wanderAngle = Math.random() * Math.PI * 2;
      this.lastX = player.x;
      this.lastY = player.y;
      this.stuckTimer = 0;
      this.unstickTimer = 0;
      this.unstickAngle = 0;
      this.stuckCheckInterval = 0;
    }

    update(room, dt) {
      if (!this.player.alive || this.player.isSpectator) return;
      this.wanderTimer -= dt;
      this.unstickTimer -= dt;
      this.stuckCheckInterval += dt;

      const tankType = CONSTANTS.TANK_TYPES[this.player.tankType] || CONSTANTS.TANK_TYPES.standard;
      const radius = tankType.bodyRadius || 14.5;
      const isSniper = this.player.tankType === 'sniper';
      const isBreaker = this.player.tankType === 'breaker';
      const isAssault = this.player.tankType === 'assault';
      const isGodBot = Boolean(this.player.isBot && room.godBotMode);

      // 1. Stuck Detection: every 0.3s, measure total distance moved
      if (this.stuckCheckInterval >= 0.3) {
        const distMoved = Math.hypot(this.player.x - this.lastX, this.player.y - this.lastY);
        this.lastX = this.player.x;
        this.lastY = this.player.y;
        this.stuckCheckInterval = 0;

        // If trying to move but barely displaced, increment stuck counter
        if (distMoved < 3.5) {
          this.stuckTimer += 0.3;
        } else {
          this.stuckTimer = 0;
        }

        // Trigger unsticking steering maneuver when stuck for > 0.4s
        if (this.stuckTimer >= 0.4 && this.unstickTimer <= 0) {
          this.unstickTimer = 0.85;
          this.stuckTimer = 0;
          // Find an open direction by testing 8 directions with actual physics collision
          this.unstickAngle = this.findEscapeDirection(room, this.player.x, this.player.y, radius);
        }
      }

      // 2. Find nearest alive enemy (excluding teammates in DUO mode)
      let nearestEnemy = null;
      let minDistance = Infinity;

      for (const other of room.players) {
        if (other.id === this.player.id || !other.alive || other.isSpectator) continue;
        if (room.gameMode === 'DUO' && other.team === this.player.team) continue; // Same team
        const dist = Math.hypot(other.x - this.player.x, other.y - this.player.y);
        if (dist < minDistance) {
          minDistance = dist;
          nearestEnemy = other;
        }
      }

      let moveX = 0, moveY = 0;
      let targetTurretAngle = this.player.turretAngle;
      let shouldShoot = false;

      if (this.unstickTimer > 0) {
        // --- State A: Unsticking Maneuver ---
        moveX = Math.cos(this.unstickAngle);
        moveY = Math.sin(this.unstickAngle);
        targetTurretAngle = this.unstickAngle;

        // Blast any destructible wall directly blocking front
        const frontHit = this.checkTileFront(room, this.player.x, this.player.y, this.unstickAngle, 32);
        if (frontHit && frontHit.isDestructible) {
          shouldShoot = true;
        }
      } else if (nearestEnemy) {
        // --- State B: Combat & Predictive Deflection Shooting ---
        const dist = minDistance;
        const enemyAngle = Math.atan2(nearestEnemy.y - this.player.y, nearestEnemy.x - this.player.x);

        // Predictive Lead (Deflection) Calculation
        const bulletSpeed = tankType.bulletSpeed || 550;
        const travelTime = dist / bulletSpeed;
        const evx = nearestEnemy.vx || 0;
        const evy = nearestEnemy.vy || 0;
        const leadX = nearestEnemy.x + evx * travelTime;
        const leadY = nearestEnemy.y + evy * travelTime;
        const leadAngle = Math.atan2(leadY - this.player.y, leadX - this.player.x);

        const los = this.checkLOS(room, this.player.x, this.player.y, leadX, leadY);
        const directLos = this.checkLOS(room, this.player.x, this.player.y, nearestEnemy.x, nearestEnemy.y);

        if (los.clear || directLos.clear || los.hitDestructible || directLos.hitDestructible) {
          // Precise Turret Aiming
          if (los.clear) {
            targetTurretAngle = leadAngle;
          } else if (directLos.clear) {
            targetTurretAngle = enemyAngle;
          } else {
            const hit = los.hitDestructible ? los : directLos;
            targetTurretAngle = Math.atan2(hit.hitY - this.player.y, hit.hitX - this.player.x);
          }

          // Tactical Distance Management
          const idealDist = isSniper ? 650 : (isAssault ? 160 : 300);
          let desiredAngle = enemyAngle;

          if (dist > idealDist + 50) {
            desiredAngle = enemyAngle; // Advance toward enemy
          } else if (dist < idealDist - 50) {
            desiredAngle = enemyAngle + Math.PI; // Back away
          } else {
            desiredAngle = enemyAngle + Math.PI / 2; // Strafe circle
          }

          // Compute best unobstructed movement direction using 8-way physics simulation
          const bestDir = this.findBestMoveDirection(room, this.player.x, this.player.y, radius, desiredAngle);
          moveX = bestDir.x;
          moveY = bestDir.y;

          // Fire decisions
          const angleDiff = Math.abs(this.normAngle(this.player.turretAngle - targetTurretAngle));
          const effectiveRange = isGodBot ? tankType.bulletRange * 1.3 : tankType.bulletRange;
          const maxAllowedAngle = isGodBot ? 0.38 : 0.28;
          if (dist <= effectiveRange && angleDiff < maxAllowedAngle) {
            shouldShoot = true;
          }
          if ((los.hitDestructible || directLos.hitDestructible) && (isBreaker || isAssault || isGodBot || dist < 380)) {
            shouldShoot = true;
          }
        } else {
          // Target blocked by walls -> Navigate around using physics-validated directions
          if (this.wanderTimer <= 0) {
            this.wanderTimer = isGodBot ? 0.5 : (1.0 + Math.random() * 1.5);
            this.wanderAngle = enemyAngle + (Math.random() - 0.5) * (isGodBot ? 0.4 : 1.2);
          }
          const bestDir = this.findBestMoveDirection(room, this.player.x, this.player.y, radius, this.wanderAngle);
          moveX = bestDir.x;
          moveY = bestDir.y;
          targetTurretAngle = isGodBot ? enemyAngle : Math.atan2(moveY, moveX);

          // If front is blocked by destructible wall, shoot to clear path
          const frontHit = this.checkTileFront(room, this.player.x, this.player.y, targetTurretAngle, 32);
          if (frontHit && frontHit.isDestructible) {
            shouldShoot = true;
          }
        }
      } else {
        // --- State C: Patrol / Roaming ---
        if (this.wanderTimer <= 0) {
          this.wanderTimer = 1.5 + Math.random() * 2.0;
          this.wanderAngle = Math.random() * Math.PI * 2;
        }
        const bestDir = this.findBestMoveDirection(room, this.player.x, this.player.y, radius, this.wanderAngle);
        moveX = bestDir.x;
        moveY = bestDir.y;
        targetTurretAngle = this.wanderAngle;
      }

      // Smooth Turret Rotation (Ultra fast snapping for God Bots)
      const turnSpeed = isGodBot ? 22.0 : (isSniper ? 4.5 : 7.0);
      const diff = this.normAngle(targetTurretAngle - this.player.turretAngle);
      this.player.turretAngle += Math.sign(diff) * Math.min(Math.abs(diff), turnSpeed * dt);

      // Apply discrete 4-way inputs to simulate player controls faithfully
      this.player.input = {
        up: moveY < -0.22,
        down: moveY > 0.22,
        left: moveX < -0.22,
        right: moveX > 0.22,
        turretAngle: this.player.turretAngle,
        shoot: shouldShoot
      };
    }

    // 8-Directional Physics Simulation: tests actual collision for each candidate
    findBestMoveDirection(room, x, y, radius, desiredAngle) {
      const candidates = [
        { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
        { x: 0.707, y: 0.707 }, { x: -0.707, y: 0.707 },
        { x: 0.707, y: -0.707 }, { x: -0.707, y: -0.707 }
      ];

      const targetVx = Math.cos(desiredAngle);
      const targetVy = Math.sin(desiredAngle);

      let bestDir = { x: 0, y: 0 };
      let bestScore = -Infinity;
      const stepDist = 8; // Probe step

      for (const dir of candidates) {
        const testX = x + dir.x * stepDist;
        const testY = y + dir.y * stepDist;

        // Perform actual tank physics collision test!
        if (!room.checkTileCollision(testX, testY, radius)) {
          // Dot product score towards target angle
          const score = dir.x * targetVx + dir.y * targetVy;
          if (score > bestScore) {
            bestScore = score;
            bestDir = dir;
          }
        }
      }

      // If all 8 directions are blocked at 8px, try smaller 4px step
      if (bestScore === -Infinity) {
        for (const dir of candidates) {
          if (!room.checkTileCollision(x + dir.x * 4, y + dir.y * 4, radius)) {
            const score = dir.x * targetVx + dir.y * targetVy;
            if (score > bestScore) {
              bestScore = score;
              bestDir = dir;
            }
          }
        }
      }

      return bestDir;
    }

    // Escape Direction for Unsticking: finds any clear path away from collision
    findEscapeDirection(room, x, y, radius) {
      const testAngles = [
        this.player.bodyAngle + Math.PI, // Reverse
        this.player.bodyAngle + Math.PI * 0.5,
        this.player.bodyAngle - Math.PI * 0.5,
        this.player.bodyAngle + Math.PI * 0.75,
        this.player.bodyAngle - Math.PI * 0.75
      ];

      for (const angle of testAngles) {
        const tx = x + Math.cos(angle) * 12;
        const ty = y + Math.sin(angle) * 12;
        if (!room.checkTileCollision(tx, ty, radius)) {
          return this.normAngle(angle);
        }
      }
      return this.normAngle(this.player.bodyAngle + Math.PI);
    }

    checkTileFront(room, x, y, angle, dist) {
      const curSize = room.map ? room.map.gridSize : 64;
      const tx = x + Math.cos(angle) * dist;
      const ty = y + Math.sin(angle) * dist;
      const gx = Math.floor(tx / CONSTANTS.TILE_SIZE);
      const gy = Math.floor(ty / CONSTANTS.TILE_SIZE);
      if (gx < 0 || gy < 0 || gx >= curSize || gy >= curSize) return { isDestructible: false };
      const tile = room.map.tiles[gy][gx];
      return { isDestructible: tile === CONSTANTS.TILE.DESTRUCTIBLE, gx, gy };
    }

    checkLOS(room, x1, y1, x2, y2) {
      const curSize = room.map ? room.map.gridSize : 64;
      const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 18);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const cx = x1 + (x2 - x1) * t;
        const cy = y1 + (y2 - y1) * t;
        const gx = Math.floor(cx / CONSTANTS.TILE_SIZE);
        const gy = Math.floor(cy / CONSTANTS.TILE_SIZE);
        if (gx < 0 || gy < 0 || gx >= curSize || gy >= curSize) return { clear: false };
        const tile = room.map.tiles[gy][gx];
        if (tile === CONSTANTS.TILE.INDESTRUCTIBLE) return { clear: false };
        if (tile === CONSTANTS.TILE.DESTRUCTIBLE) return { clear: false, hitDestructible: true, hitX: cx, hitY: cy };
      }
      return { clear: true };
    }

    normAngle(a) {
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      return a;
    }
  }

  // 4. Host P2P Game Room Simulation
  class P2PGameRoom {
    constructor(roomId, onStateBroadcast) {
      this.roomId = roomId;
      this.onStateBroadcast = onStateBroadcast;
      this.state = 'LOBBY';
      this.gameMode = 'SOLO'; // 'SOLO' or 'DUO'
      this.gridSize = 64;
      this.players = [];
      this.bullets = [];
      this.bulletIdCounter = 1;
      this.map = null;
      this.matchTimeRemaining = CONSTANTS.MATCH_DURATION_SEC;
      this.countdownTimer = 3;
      this.matchStartTime = 0;
      this.lastTickTime = performance.now();
      this.scoreboard = [];
      this.eventQueue = [];
      this.loopInterval = null;
      this.godBotMode = false;

      this.initMap();
    }

    toggleGodBotMode(enabled = null) {
      this.godBotMode = (enabled !== null) ? Boolean(enabled) : !this.godBotMode;
      // Update existing bots status
      this.players.forEach(p => {
        if (p.isBot) {
          const stats = CONSTANTS.TANK_TYPES[p.tankType] || CONSTANTS.TANK_TYPES.standard;
          p.name = this.godBotMode ? `👹 GOD Bot ${p.slot + 1}` : `Bot ${p.slot + 1} (${stats.enName})`;
          p.maxHp = this.godBotMode ? stats.hp * 2 : stats.hp;
          p.hp = p.maxHp;
        }
      });
      this.eventQueue.push({
        type: 'god_bot_toggle',
        enabled: this.godBotMode,
        message: this.godBotMode ? '⚠️ DANGER: GOD BOTS UNLEASHED! 最強ボット軍団が起動した！' : 'ℹ️ GOD BOT PROTOCOL DEACTIVATED (ボット通常化)'
      });
    }

    setBotTankType(id, tankType) {
      if (!CONSTANTS.TANK_TYPES[tankType]) return;
      const p = this.players.find(x => x.id === id);
      if (p && p.isBot) {
        p.tankType = tankType;
        const stats = CONSTANTS.TANK_TYPES[tankType];
        p.maxHp = (this.godBotMode ? stats.hp * 2 : stats.hp);
        p.hp = p.maxHp;
        p.name = this.godBotMode ? `👹 GOD Bot ${p.slot + 1}` : `Bot ${p.slot + 1} (${stats.enName})`;
      }
    }

    setAllBotsTankType(tankType) {
      if (!CONSTANTS.TANK_TYPES[tankType]) return;
      this.players.forEach(p => {
        if (p.isBot) {
          this.setBotTankType(p.id, tankType);
        }
      });
    }

    setupHostVsBots() {
      if (this.state !== 'LOBBY') return;
      // 1. DUO / Team battle mode
      this.gameMode = 'DUO';

      // 2. Set Host to Team 1 (Blue)
      const host = this.players.find(p => p.isHost) || this.players[0];
      if (host) {
        host.team = 1;
      }

      // 3. Fill up to 19 bots (total 20 participants)
      this.setBotCount(19);

      // 4. Set all bots to Team 2 (Red)
      this.players.forEach(p => {
        if (p.isBot) {
          p.team = 2;
        }
      });

      this.eventQueue.push({
        type: 'toast',
        message: '👑 1 vs 19 (ホスト1人 vs 全ボット19人) に設定しました！'
      });
    }

    initMap() {
      // 11 or more players automatically scale up map to 96x96
      this.gridSize = (this.players.length >= 11) ? 96 : 64;
      this.map = EngineMapGenerator.generate(this.gridSize);
      this.bullets = [];
      this.eventQueue = [];
    }

    startLoop() {
      if (this.loopInterval) clearInterval(this.loopInterval);
      this.lastTickTime = performance.now();
      this.loopInterval = setInterval(() => {
        const now = performance.now();
        const dt = Math.min((now - this.lastTickTime) / 1000, 0.1);
        this.lastTickTime = now;
        this.update(dt);
        if (this.onStateBroadcast) {
          this.onStateBroadcast(this.getBroadcastPayload());
        }
      }, 1000 / CONSTANTS.TICK_RATE);
    }

    stopLoop() {
      if (this.loopInterval) {
        clearInterval(this.loopInterval);
        this.loopInterval = null;
      }
    }

    setGameMode(mode) {
      this.gameMode = (mode === 'DUO') ? 'DUO' : 'SOLO';
      // Automatically assign teams for DUO (slots 0-1 = Team 1, 2-3 = Team 2, etc.)
      if (this.gameMode === 'DUO') {
        this.players.forEach(p => {
          p.team = Math.floor(p.slot / 2) + 1;
        });
      }
    }

    setPlayerTeam(id, team) {
      const p = this.players.find(x => x.id === id);
      if (p) {
        p.team = Math.max(1, Math.min(10, parseInt(team, 10) || 1));
      }
    }

    setBotCount(targetCount) {
      if (this.state !== 'LOBBY') return;
      targetCount = Math.max(0, Math.min(19, parseInt(targetCount, 10) || 0));

      // Remove excess bots
      while (this.players.filter(p => p.isBot).length > targetCount) {
        const lastBotIdx = [...this.players].reverse().findIndex(p => p.isBot);
        if (lastBotIdx !== -1) {
          const actualIdx = this.players.length - 1 - lastBotIdx;
          this.players.splice(actualIdx, 1);
        }
      }

      // Add needed bots
      const types = ['standard', 'assault', 'heavy', 'sniper', 'breaker'];
      while (this.players.filter(p => p.isBot).length < targetCount && this.players.length < CONSTANTS.MAX_PLAYERS) {
        this.addBot(types[this.players.length % types.length]);
      }
    }

    forceEndGame() {
      if (this.state === 'PLAYING' || this.state === 'STARTING') {
        this.endGame('host_force_stop');
      }
    }

    addPlayer(id, name, isHost = false) {
      if (this.players.length >= CONSTANTS.MAX_PLAYERS) return null;
      const usedSlots = new Set(this.players.map(p => p.slot));
      let slot = 0;
      while (usedSlots.has(slot) && slot < CONSTANTS.MAX_PLAYERS) slot++;

      const player = {
        id: id,
        slot: slot,
        team: Math.floor(slot / 2) + 1,
        name: name || `Player ${slot + 1}`,
        tankType: 'standard',
        isHost: isHost,
        isSpectator: false,
        isBot: false,
        alive: true,
        x: 0, y: 0, vx: 0, vy: 0,
        bodyAngle: 0, turretAngle: 0,
        hp: 100, maxHp: 100,
        kills: 0, deathTime: 0, survivedTime: 0, rank: 0,
        cooldownTimer: 0,
        input: { up: false, down: false, left: false, right: false, turretAngle: 0, shoot: false }
      };

      this.resetPlayerPosition(player);
      this.players.push(player);
      return player;
    }

    addBot(type = null) {
      if (this.players.length >= CONSTANTS.MAX_PLAYERS || this.state !== 'LOBBY') return false;
      const usedSlots = new Set(this.players.map(p => p.slot));
      let slot = 0;
      while (usedSlots.has(slot) && slot < CONSTANTS.MAX_PLAYERS) slot++;

      const types = ['standard', 'assault', 'heavy', 'sniper', 'breaker'];
      const chosenType = type || types[Math.floor(Math.random() * types.length)];
      const botId = 'bot_' + Math.random().toString(36).substring(2, 7);
      const stats = CONSTANTS.TANK_TYPES[chosenType];
      const baseHp = stats.hp;
      const maxHp = this.godBotMode ? baseHp * 2 : baseHp;

      const bot = {
        id: botId,
        slot: slot,
        team: Math.floor(slot / 2) + 1,
        name: this.godBotMode ? `👹 GOD Bot ${slot + 1}` : `Bot ${slot + 1} (${stats.enName})`,
        tankType: chosenType,
        isHost: false,
        isSpectator: false,
        isBot: true,
        botAI: null,
        alive: true,
        x: 0, y: 0, vx: 0, vy: 0,
        bodyAngle: 0, turretAngle: 0,
        hp: maxHp,
        maxHp: maxHp,
        kills: 0, deathTime: 0, survivedTime: 0, rank: 0,
        cooldownTimer: 0,
        input: { up: false, down: false, left: false, right: false, turretAngle: 0, shoot: false }
      };

      bot.botAI = new EngineBotAI(bot);
      this.resetPlayerPosition(bot);
      this.players.push(bot);
      return true;
    }

    fillWithBots() {
      const types = ['standard', 'assault', 'heavy', 'sniper', 'breaker'];
      while (this.players.length < CONSTANTS.MAX_PLAYERS) {
        this.addBot(types[this.players.length % types.length]);
      }
    }

    fillTo10() {
      if (this.state !== 'LOBBY') return;
      const types = ['standard', 'assault', 'heavy', 'sniper', 'breaker'];
      while (this.players.length < 10) {
        this.addBot(types[this.players.length % types.length]);
      }
      while (this.players.length > 10 && this.players.some(p => p.isBot)) {
        this.removeOneBot();
      }
    }

    removeOneBot() {
      if (this.state !== 'LOBBY') return;
      const lastBotIdx = [...this.players].reverse().findIndex(p => p.isBot);
      if (lastBotIdx !== -1) {
        const actualIdx = this.players.length - 1 - lastBotIdx;
        this.players.splice(actualIdx, 1);
      }
    }

    removeBots() {
      if (this.state !== 'LOBBY') return;
      this.players = this.players.filter(p => !p.isBot);
    }

    removePlayer(id) {
      const idx = this.players.findIndex(p => p.id === id);
      if (idx !== -1) {
        this.players.splice(idx, 1);
        if (this.state === 'PLAYING') this.checkGameOverCondition();
      }
    }

    resetPlayerPosition(player, explicitSpawnIdx = null) {
      const curSize = this.map ? this.map.gridSize : 64;
      const spawns = CONSTANTS.getSpawnPoints(curSize);
      let sIdx;
      if (explicitSpawnIdx !== null && explicitSpawnIdx !== undefined) {
        sIdx = explicitSpawnIdx % spawns.length;
      } else {
        sIdx = Math.floor(Math.random() * spawns.length);
      }
      const sp = spawns[sIdx];
      player.x = sp.gridX * CONSTANTS.TILE_SIZE + CONSTANTS.TILE_SIZE / 2;
      player.y = sp.gridY * CONSTANTS.TILE_SIZE + CONSTANTS.TILE_SIZE / 2;
      player.spawnPointIdx = sIdx;
      const cx = (curSize * CONSTANTS.TILE_SIZE) / 2;
      const cy = (curSize * CONSTANTS.TILE_SIZE) / 2;
      const angle = Math.atan2(cy - player.y, cx - player.x);
      player.bodyAngle = angle;
      player.turretAngle = angle;
      player.vx = 0;
      player.vy = 0;
    }

    updatePlayerConfig(id, config) {
      const p = this.players.find(x => x.id === id);
      if (!p) return;
      if (config.name) p.name = config.name.trim().substring(0, 16);
      if (config.tankType && CONSTANTS.TANK_TYPES[config.tankType]) {
        p.tankType = config.tankType;
        const baseHp = CONSTANTS.TANK_TYPES[config.tankType].hp;
        p.maxHp = (p.isBot && this.godBotMode) ? baseHp * 2 : baseHp;
        p.hp = p.maxHp;
      }
      if (config.team !== undefined) {
        p.team = Math.max(1, Math.min(10, parseInt(config.team, 10) || 1));
      }
      if (config.isSpectator !== undefined && p.isHost) {
        p.isSpectator = Boolean(config.isSpectator);
      }
    }

    startGame() {
      if (this.state !== 'LOBBY') return;
      this.initMap();
      this.state = 'STARTING';
      this.countdownTimer = 3.5;
      this.matchTimeRemaining = CONSTANTS.MATCH_DURATION_SEC;
      this.bullets = [];
      this.scoreboard = [];

      const curSize = this.map ? this.map.gridSize : 64;
      const spawns = CONSTANTS.getSpawnPoints(curSize);

      // Randomize spawn positions: Fisher-Yates shuffle 0 to 19 (spawns.length)
      const availableIndices = [];
      for (let i = 0; i < spawns.length; i++) availableIndices.push(i);
      for (let i = availableIndices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [availableIndices[i], availableIndices[j]] = [availableIndices[j], availableIndices[i]];
      }

      this.players.forEach((p, idx) => {
        p.alive = !p.isSpectator;
        const stats = CONSTANTS.TANK_TYPES[p.tankType] || CONSTANTS.TANK_TYPES.standard;
        const isKolibri = isKolibriPlayer(p);
        p.isKolibri = isKolibri;

        let baseHp = stats.hp;
        if (isKolibri) {
          baseHp = Math.round(stats.hp / 10); // HP 10 (1/10 of standard 100)
        } else if (p.isBot && this.godBotMode) {
          baseHp = stats.hp * 2;
        }

        p.maxHp = baseHp;
        p.hp = baseHp;
        p.kills = 0;
        p.deathTime = 0;
        p.survivedTime = 0;
        p.vx = 0;
        p.vy = 0;
        const spawnIdx = availableIndices[idx % availableIndices.length];
        this.resetPlayerPosition(p, spawnIdx);
      });

      this.eventQueue.push({ type: 'countdown_start' });
    }

    returnToLobby() {
      this.state = 'LOBBY';
      this.initMap();
      this.bullets = [];
      this.eventQueue = [];
      this.players.forEach(p => {
        // Relock / reset Phantom tank to standard on returning to lobby
        if (p.tankType === 'phantom') {
          p.tankType = 'standard';
        }
        p.alive = true;
        p.hp = CONSTANTS.TANK_TYPES[p.tankType].hp;
        p.maxHp = CONSTANTS.TANK_TYPES[p.tankType].hp;
        p.kills = 0;
        p.deathTime = 0;
        p.survivedTime = 0;
        p.vx = 0;
        p.vy = 0;
        this.resetPlayerPosition(p);
      });
    }

    handlePlayerInput(id, inputData) {
      const p = this.players.find(x => x.id === id);
      if (!p || p.isBot || !p.alive || p.isSpectator) return;
      if (inputData.up !== undefined) p.input.up = Boolean(inputData.up);
      if (inputData.down !== undefined) p.input.down = Boolean(inputData.down);
      if (inputData.left !== undefined) p.input.left = Boolean(inputData.left);
      if (inputData.right !== undefined) p.input.right = Boolean(inputData.right);
      if (typeof inputData.turretAngle === 'number') p.input.turretAngle = inputData.turretAngle;
      if (inputData.shoot !== undefined) p.input.shoot = Boolean(inputData.shoot);
    }

    update(dt) {
      if (this.state === 'STARTING') {
        this.countdownTimer -= dt;
        if (this.countdownTimer <= 0) {
          this.state = 'PLAYING';
          this.matchStartTime = performance.now();
          this.eventQueue.push({ type: 'match_start' });
        }
        return;
      }
      if (this.state !== 'PLAYING') return;

      this.matchTimeRemaining -= dt;
      if (this.matchTimeRemaining <= 0) {
        this.matchTimeRemaining = 0;
        this.endGame('time_up');
        return;
      }

      // Bots
      for (const p of this.players) {
        if (p.isBot && p.botAI) p.botAI.update(this, dt);
      }

      // Movement & collision
      for (const p of this.players) {
        if (!p.alive || p.isSpectator) continue;
        const stats = CONSTANTS.TANK_TYPES[p.tankType];
        const isGodBot = Boolean(p.isBot && this.godBotMode);
        const isKolibri = Boolean(p.isKolibri || isKolibriPlayer(p));

        let curSpeed = stats.speed;
        let curCooldown = stats.cooldown;
        let radius = stats.bodyRadius;

        if (isKolibri) {
          curSpeed = Math.round(stats.speed / 4); // 1/4 speed (45 px/s)
          curCooldown = 1 / 60; // 60 shots per second
          radius = stats.bodyRadius / 2; // 1/2 size (7.25 px)
        } else if (isGodBot) {
          curSpeed = stats.speed * 1.55;
          curCooldown = stats.cooldown * 0.4;
        }

        p.cooldownTimer -= dt;
        p.turretAngle = p.input.turretAngle;

        let mx = 0, my = 0;
        if (p.input.up) my -= 1;
        if (p.input.down) my += 1;
        if (p.input.left) mx -= 1;
        if (p.input.right) mx += 1;

        if (mx !== 0 || my !== 0) {
          const len = Math.hypot(mx, my);
          mx /= len; my /= len;
          p.vx = mx * curSpeed;
          p.vy = my * curSpeed;

          const targetBodyAngle = Math.atan2(my, mx);
          let diff = targetBodyAngle - p.bodyAngle;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          p.bodyAngle += diff * Math.min((isGodBot ? 18 : 10) * dt, 1);

          const moveDist = curSpeed * dt;
          const newX = p.x + mx * moveDist;
          const newY = p.y + my * moveDist;

          if (!this.checkTileCollision(newX, p.y, radius)) p.x = newX;
          if (!this.checkTileCollision(p.x, newY, radius)) p.y = newY;

          for (const other of this.players) {
            if (other.id === p.id || !other.alive || other.isSpectator) continue;
            const otherStats = CONSTANTS.TANK_TYPES[other.tankType];
            const otherRadius = (other.isKolibri || isKolibriPlayer(other)) ? (otherStats.bodyRadius / 2) : otherStats.bodyRadius;
            const minDist = radius + otherRadius;
            const dx = p.x - other.x;
            const dy = p.y - other.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 0 && dist < minDist) {
              const overlap = (minDist - dist) * 0.5;
              p.x += (dx / dist) * overlap;
              p.y += (dy / dist) * overlap;
              other.x -= (dx / dist) * overlap;
              other.y -= (dy / dist) * overlap;
            }
          }
        } else {
          p.vx = 0;
          p.vy = 0;
        }

        if (p.input.shoot) {
          // Continuous fire accumulator (enables true 60 shots/s for Kolibri even at 30Hz tick)
          let shotsFired = 0;
          while (p.cooldownTimer <= 0 && shotsFired < 4) {
            this.spawnBullet(p);
            p.cooldownTimer += curCooldown;
            shotsFired++;
            if (p.cooldownTimer >= 0) break;
          }
        } else {
          if (p.cooldownTimer < 0) p.cooldownTimer = 0;
        }
      }

      // Bullets Update with Sub-stepping (Continuous Collision Detection)
      for (let i = this.bullets.length - 1; i >= 0; i--) {
        const b = this.bullets[i];
        const totalDist = b.speed * dt;
        // Subdivide into small steps of max 6px to prevent tunneling or corner leakage
        const numSteps = Math.max(1, Math.ceil(totalDist / 6));
        const subDist = totalDist / numSteps;
        let bulletDestroyed = false;

        for (let step = 0; step < numSteps; step++) {
          const prevX = b.x;
          const prevY = b.y;
          const nextX = b.x + b.vx * subDist;
          const nextY = b.y + b.vy * subDist;
          b.distanceTraveled += subDist;

          if (b.distanceTraveled >= b.maxRange) {
            bulletDestroyed = true;
            break;
          }

          // Wall collision: checks circle AABB & prevents 45-degree corner gap leakage
          const hitWall = this.checkBulletWallCollision(b, prevX, prevY, nextX, nextY);
          if (hitWall) {
            bulletDestroyed = true;
            break;
          }

          const hitTank = this.checkBulletTankCollision(b, nextX, nextY);
          if (hitTank) {
            bulletDestroyed = true;
            break;
          }

          b.x = nextX;
          b.y = nextY;
        }

        if (bulletDestroyed) {
          this.bullets.splice(i, 1);
        }
      }

      this.checkGameOverCondition();
    }

    checkTileCollision(x, y, radius) {
      const curSize = this.map ? this.map.gridSize : 64;
      const minX = Math.floor((x - radius) / CONSTANTS.TILE_SIZE);
      const maxX = Math.floor((x + radius) / CONSTANTS.TILE_SIZE);
      const minY = Math.floor((y - radius) / CONSTANTS.TILE_SIZE);
      const maxY = Math.floor((y + radius) / CONSTANTS.TILE_SIZE);

      for (let gy = minY; gy <= maxY; gy++) {
        for (let gx = minX; gx <= maxX; gx++) {
          if (gx < 0 || gy < 0 || gx >= curSize || gy >= curSize) return true;
          const tile = this.map.tiles[gy][gx];
          if (tile === 1 || tile === 2) {
            const cx = Math.max(gx * CONSTANTS.TILE_SIZE, Math.min(x, (gx + 1) * CONSTANTS.TILE_SIZE));
            const cy = Math.max(gy * CONSTANTS.TILE_SIZE, Math.min(y, (gy + 1) * CONSTANTS.TILE_SIZE));
            if ((x - cx) ** 2 + (y - cy) ** 2 < radius * radius) return true;
          }
        }
      }
      return false;
    }

    spawnBullet(player) {
      const stats = CONSTANTS.TANK_TYPES[player.tankType] || CONSTANTS.TANK_TYPES.standard;
      const isGodBot = Boolean(player.isBot && this.godBotMode);
      const isKolibri = Boolean(player.isKolibri || isKolibriPlayer(player));

      let bulletSpeed = isGodBot ? stats.bulletSpeed * 1.4 : stats.bulletSpeed;
      let bulletDamage = isGodBot ? Math.round(stats.damage * 1.8) : stats.damage;
      let bulletRadius = stats.bulletRadius;
      let wallDamageMultiplier = stats.wallDamageMultiplier || 1.0;
      let bulletRange = stats.bulletRange;

      if (isKolibri) {
        // Kolibri secret mini tank: 1 damage, Heavy tank bullet speed (460), mini needle bullet radius
        // 1秒間に20個の壁を破壊: 60発/秒 ÷ 20個 = 3発で壁1個(HP50)粉砕 → 壁ダメージ17 (17 x 3 = 51 >= 50)
        bulletSpeed = CONSTANTS.TANK_TYPES.heavy.bulletSpeed; // 460 px/s
        bulletDamage = 1;
        bulletRadius = 2.0;
        wallDamageMultiplier = 17.0;
        bulletRange = 850;
      }

      const mLen = (isKolibri ? (stats.turretLength * 0.5) : stats.turretLength) + (isKolibri ? 2 : 4);

      if (stats.isDualBarrel) {
        // Dual-barrel firing for Phantom tank
        const perpAngle = player.turretAngle + Math.PI / 2;
        const barrelOffset = 5.0;
        [-1, 1].forEach(side => {
          const bx = player.x + Math.cos(player.turretAngle) * mLen + Math.cos(perpAngle) * barrelOffset * side;
          const by = player.y + Math.sin(player.turretAngle) * mLen + Math.sin(perpAngle) * barrelOffset * side;

          this.bullets.push({
            id: this.bulletIdCounter++,
            ownerId: player.id,
            team: player.team,
            tankType: player.tankType,
            x: bx,
            y: by,
            vx: Math.cos(player.turretAngle),
            vy: Math.sin(player.turretAngle),
            speed: bulletSpeed,
            damage: Math.round(bulletDamage * 0.7), // Twin burst (total 140% damage)
            wallDamageMultiplier: wallDamageMultiplier,
            radius: bulletRadius,
            distanceTraveled: 0,
            maxRange: bulletRange
          });

          this.eventQueue.push({
            type: 'bullet_fired',
            ownerId: player.id,
            team: player.team,
            tankType: player.tankType,
            x: bx,
            y: by,
            angle: player.turretAngle
          });
        });
      } else {
        const startX = player.x + Math.cos(player.turretAngle) * mLen;
        const startY = player.y + Math.sin(player.turretAngle) * mLen;

        this.bullets.push({
          id: this.bulletIdCounter++,
          ownerId: player.id,
          team: player.team,
          tankType: player.tankType,
          x: startX,
          y: startY,
          vx: Math.cos(player.turretAngle),
          vy: Math.sin(player.turretAngle),
          speed: bulletSpeed,
          damage: bulletDamage,
          wallDamageMultiplier: wallDamageMultiplier,
          radius: bulletRadius,
          distanceTraveled: 0,
          maxRange: bulletRange
        });

        this.eventQueue.push({
          type: 'bullet_fired',
          ownerId: player.id,
          team: player.team,
          tankType: player.tankType,
          x: startX,
          y: startY,
          angle: player.turretAngle
        });
      }
    }

    checkBulletWallCollision(b, prevX, prevY, nx, ny) {
      const curSize = this.map ? this.map.gridSize : 64;
      const ts = CONSTANTS.TILE_SIZE;
      const r = b.radius || 4.5;

      // 1. Precise Circle vs Tile AABB Collision (covers all tiles touching bullet circle)
      const minGx = Math.floor((nx - r) / ts);
      const maxGx = Math.floor((nx + r) / ts);
      const minGy = Math.floor((ny - r) / ts);
      const maxGy = Math.floor((ny + r) / ts);

      for (let gy = minGy; gy <= maxGy; gy++) {
        for (let gx = minGx; gx <= maxGx; gx++) {
          if (gx < 0 || gy < 0 || gx >= curSize || gy >= curSize) return true;
          const tile = this.map.tiles[gy][gx];
          if (tile === 1 || tile === 2) {
            const cx = Math.max(gx * ts, Math.min(nx, (gx + 1) * ts));
            const cy = Math.max(gy * ts, Math.min(ny, (gy + 1) * ts));
            if ((nx - cx) ** 2 + (ny - cy) ** 2 < r * r) {
              return this.applyBulletWallDamage(b, gx, gy, cx, cy);
            }
          }
        }
      }

      // 2. Diagonal Corner-Cutting Prevention (strictly seals 45-degree diagonal gaps between wall corners)
      const prevGx = Math.floor(prevX / ts);
      const prevGy = Math.floor(prevY / ts);
      const nextGx = Math.floor(nx / ts);
      const nextGy = Math.floor(ny / ts);

      if (prevGx !== nextGx && prevGy !== nextGy) {
        // Bullet stepped across a diagonal boundary. Check the two touching corner tiles:
        const t1 = (prevGx >= 0 && nextGy >= 0 && prevGx < curSize && nextGy < curSize) ? this.map.tiles[nextGy][prevGx] : 1;
        const t2 = (nextGx >= 0 && prevGy >= 0 && nextGx < curSize && prevGy < curSize) ? this.map.tiles[prevGy][nextGx] : 1;

        if ((t1 === 1 || t1 === 2) && (t2 === 1 || t2 === 2)) {
          // Both flanking corners are solid walls -> gap is physically sealed!
          const target = t1 === 2 ? { gx: prevGx, gy: nextGy } : { gx: nextGx, gy: prevGy };
          return this.applyBulletWallDamage(b, target.gx, target.gy, nx, ny);
        }
      }

      return false;
    }

    applyBulletWallDamage(b, gx, gy, hitX, hitY) {
      const tile = this.map.tiles[gy][gx];
      if (tile === 1) {
        this.eventQueue.push({ type: 'wall_hit', x: hitX, y: hitY });
        return true;
      }
      if (tile === 2) {
        const dmg = Math.round(b.damage * b.wallDamageMultiplier);
        this.map.wallHp[gy][gx] -= dmg;
        if (this.map.wallHp[gy][gx] <= 0) {
          this.map.tiles[gy][gx] = 0;
          this.map.wallHp[gy][gx] = 0;
          this.eventQueue.push({
            type: 'wall_destroyed',
            gridX: gx, gridY: gy,
            x: gx * CONSTANTS.TILE_SIZE + CONSTANTS.TILE_SIZE / 2,
            y: gy * CONSTANTS.TILE_SIZE + CONSTANTS.TILE_SIZE / 2
          });
        } else {
          this.eventQueue.push({ type: 'wall_hit', x: hitX, y: hitY });
        }
        return true;
      }
      return false;
    }

    checkBulletTankCollision(b, nx, ny) {
      for (const victim of this.players) {
        if (victim.id === b.ownerId || !victim.alive || victim.isSpectator) continue;
        // In DUO mode, friendly fire is strictly disabled (bullets pass through teammates)
        if (this.gameMode === 'DUO' && b.team === victim.team) continue;

        const stats = CONSTANTS.TANK_TYPES[victim.tankType];
        const victimRadius = (victim.isKolibri || isKolibriPlayer(victim)) ? (stats.bodyRadius / 2) : stats.bodyRadius;
        if (Math.hypot(nx - victim.x, ny - victim.y) < victimRadius + b.radius) {
          victim.hp -= b.damage;
          this.eventQueue.push({
            type: 'tank_hit',
            victimId: victim.id,
            attackerId: b.ownerId,
            x: nx, y: ny
          });

          if (victim.hp <= 0) {
            victim.hp = 0;
            victim.alive = false;
            victim.deathTime = performance.now();
            victim.survivedTime = Math.max(0, (victim.deathTime - this.matchStartTime) / 1000);

            const killer = this.players.find(p => p.id === b.ownerId);
            if (killer) killer.kills += 1;

            this.eventQueue.push({
              type: 'tank_destroyed',
              victimId: victim.id,
              victimName: victim.name,
              killerId: b.ownerId,
              killerName: killer ? killer.name : 'Unknown',
              x: victim.x, y: victim.y
            });
          }
          return true;
        }
      }
      return false;
    }

    checkGameOverCondition() {
      if (this.state !== 'PLAYING') return;
      const participants = this.players.filter(p => !p.isSpectator);
      const alivePlayers = participants.filter(p => p.alive);

      if (this.gameMode === 'DUO') {
        // DUO Victory condition: all remaining alive players belong to the same team!
        if (participants.length > 1) {
          if (alivePlayers.length === 0) {
            this.endGame('all_eliminated');
          } else {
            const firstTeam = alivePlayers[0].team;
            const allSameTeam = alivePlayers.every(p => p.team === firstTeam);
            if (allSameTeam) {
              this.endGame('team_victory');
            }
          }
        } else if (participants.length === 1 && alivePlayers.length === 0) {
          this.endGame('solo_eliminated');
        }
      } else {
        // SOLO Victory condition: only 1 tank remains
        if (participants.length > 1 && alivePlayers.length <= 1) {
          this.endGame(alivePlayers.length === 1 ? 'last_tank_standing' : 'all_eliminated');
        } else if (participants.length === 1 && alivePlayers.length === 0) {
          this.endGame('solo_eliminated');
        }
      }
    }

    endGame(reason) {
      this.state = 'GAMEOVER';
      const participants = this.players.filter(p => !p.isSpectator);
      const dur = (performance.now() - this.matchStartTime) / 1000;
      participants.forEach(p => { if (p.alive) p.survivedTime = dur; });

      const sorted = [...participants].sort((a, b) => {
        if (a.alive && !b.alive) return -1;
        if (!a.alive && b.alive) return 1;
        if (!a.alive && !b.alive) {
          if (Math.abs(b.survivedTime - a.survivedTime) > 0.5) return b.survivedTime - a.survivedTime;
          if (b.kills !== a.kills) return b.kills - a.kills;
          return a.slot - b.slot;
        }
        if (b.kills !== a.kills) return b.kills - a.kills;
        if (b.hp !== a.hp) return b.hp - a.hp;
        return a.slot - b.slot;
      });

      this.scoreboard = sorted.map((p, idx) => {
        const rank = idx + 1;
        const isWinner = rank === 1 && (p.alive || sorted.length === 1);
        let status = 'ELIMINATED 💀';
        if (p.alive) {
          status = this.gameMode === 'DUO' ? `TEAM ${p.team} 👑` : 'WINNER 👑';
        }
        return {
          rank,
          id: p.id,
          team: p.team,
          name: p.name,
          tankType: p.tankType,
          kills: p.kills,
          survivedTime: Math.round(p.survivedTime),
          status: status,
          isWinner: isWinner,
          isBot: p.isBot
        };
      });

      this.eventQueue.push({ type: 'game_over', reason, scoreboard: this.scoreboard });
    }

    getBroadcastPayload() {
      const curSize = this.map ? this.map.gridSize : 64;
      const payload = {
        type: 'game_state',
        state: this.state,
        gameMode: this.gameMode,
        godBotMode: this.godBotMode,
        gridSize: curSize,
        timeRemaining: Math.ceil(this.matchTimeRemaining),
        countdown: Math.ceil(this.countdownTimer),
        players: this.players.map(p => ({
          id: p.id,
          slot: p.slot,
          team: p.team,
          name: p.name,
          tankType: p.tankType,
          isHost: p.isHost,
          isSpectator: p.isSpectator,
          isBot: p.isBot,
          isKolibri: Boolean(p.isKolibri || isKolibriPlayer(p)),
          alive: p.alive,
          x: Math.round(p.x * 10) / 10,
          y: Math.round(p.y * 10) / 10,
          vx: Math.round((p.vx || 0) * 10) / 10,
          vy: Math.round((p.vy || 0) * 10) / 10,
          bodyAngle: Math.round(p.bodyAngle * 100) / 100,
          turretAngle: Math.round(p.turretAngle * 100) / 100,
          hp: p.hp,
          maxHp: p.maxHp,
          kills: p.kills,
          rank: p.rank
        })),
        bullets: this.bullets.map(b => ({
          id: b.id,
          ownerId: b.ownerId,
          team: b.team,
          tankType: b.tankType,
          x: Math.round(b.x),
          y: Math.round(b.y),
          radius: b.radius
        })),
        scoreboard: this.state === 'GAMEOVER' ? this.scoreboard : null,
        events: this.eventQueue
      };
      this.eventQueue = [];
      return payload;
    }

    getMapPayload() {
      const curSize = this.map ? this.map.gridSize : 64;
      return {
        type: 'map_data',
        tiles: this.map.tiles,
        wallHp: this.map.wallHp,
        gridSize: curSize,
        tileSize: CONSTANTS.TILE_SIZE,
        gameMode: this.gameMode,
        tankTypes: CONSTANTS.TANK_TYPES,
        spawnPoints: CONSTANTS.getSpawnPoints(curSize)
      };
    }
  }

  if (typeof window !== 'undefined') {
    window.TANK10_CONSTANTS = CONSTANTS;
    window.P2PGameRoom = P2PGameRoom;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CONSTANTS, P2PGameRoom, EngineMapGenerator, EngineBotAI };
  }
})(typeof window !== 'undefined' ? window : global);
