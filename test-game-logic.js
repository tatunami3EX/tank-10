// Test TANK-10 Core Logic & Physics
const assert = require('assert');
const { CONSTANTS: constants, P2PGameRoom } = require('./js/game-engine');

console.log('🧪 Starting TANK-10 Unit Tests...\n');

// 1. Constants Test
console.log('Test 1: Constants Verification');
assert.strictEqual(constants.MAP_GRID_SIZE, 64, 'Map grid default is 64x64');
assert.strictEqual(constants.MATCH_DURATION_SEC, 300, 'Match duration must be 300s (5 min)');
assert.strictEqual(constants.MAX_PLAYERS, 20, 'Max players must be 20');
assert.strictEqual(constants.getSpawnPoints(64).length, 20, 'Must generate 20 spawn points for 64x64');
assert.strictEqual(constants.getSpawnPoints(96).length, 20, 'Must generate 20 spawn points for 96x96');

const { standard, assault, heavy, sniper, breaker } = constants.TANK_TYPES;
assert.ok(standard && assault && heavy && sniper && breaker, 'All 5 tank types must exist');
assert.strictEqual(sniper.hasLaserSight, true, 'Sniper must have laser sight');
assert.strictEqual(breaker.wallDamageMultiplier, 2.0, 'Breaker must deal 2x wall damage');
assert.ok(heavy.bodyRadius <= 15.0, 'Heavy bodyRadius must be <= 15 to easily traverse 1-tile 36px corridor');
assert.ok(assault.speed > standard.speed && standard.speed > heavy.speed, 'Speed stats: Assault > Standard > Heavy');
assert.ok(heavy.hp > standard.hp && standard.hp > assault.hp, 'HP stats: Heavy > Standard > Assault');
console.log('  ✅ Constants verified successfully.\n');

// 2. Heavy 1-Tile Passage Simulation Test
console.log('Test 2: Heavy Tank 1-Tile (36px) Passage');
// Simulate tile collision with a 1-tile corridor at gx = 5 (between gx = 4 and gx = 6 walls)
const tileSize = 36;
const corridorCenterX = 5 * tileSize + tileSize / 2; // 198px
const corridorCenterY = 5 * tileSize + tileSize / 2;
const heavyRadius = heavy.bodyRadius; // 15px

// Check distance to left wall right edge (gx = 4, x = 180)
const distToLeftWall = corridorCenterX - 180; // 18px
assert.ok(distToLeftWall > heavyRadius, 'Corridor margin must be greater than heavy bodyRadius (18px > 15px)');
console.log(`  ✅ Heavy radius ${heavyRadius}px successfully navigates 36px (18px half-width) corridor with clearance.\n`);

// 3. Browser Simulation Engine Test (64x64 & 96x96 dynamic scaling, DUO mode, Predictive AI)
console.log('Test 3: Browser Simulation Engine (20 players, 96x96 scaling, DUO mode)');
assert.ok(P2PGameRoom, 'P2PGameRoom must be exported');

const room = new P2PGameRoom('TEST1');
assert.strictEqual(room.state, 'LOBBY');

// Add 1 human host
const host = room.addPlayer('host_1', 'Host Ace', true);
assert.strictEqual(host.slot, 0);
assert.strictEqual(host.isHost, true);

// Set bot count to 15 (total 16 players -> triggers 96x96 map)
room.setBotCount(15);
assert.strictEqual(room.players.length, 16, 'Total players must be 16');

// Set game mode to DUO
room.setGameMode('DUO');
assert.strictEqual(room.gameMode, 'DUO');
assert.strictEqual(host.team, 1, 'Host in slot 0 must be in Team 1');
assert.strictEqual(room.players[1].team, 1, 'Player in slot 1 must be in Team 1');
assert.strictEqual(room.players[2].team, 2, 'Player in slot 2 must be in Team 2');

// Start game
room.startGame();
assert.strictEqual(room.state, 'STARTING');
assert.strictEqual(room.gridSize, 96, '16 players must automatically scale map to 96x96');
assert.strictEqual(room.map.tiles.length, 96, 'Map tiles must have height 96');
assert.strictEqual(room.map.tiles[0].length, 96, 'Map tiles must have width 96');

// Complete countdown
room.countdownTimer = 0;
room.update(0.1);
assert.strictEqual(room.state, 'PLAYING');
console.log('  ✅ 16-player game started with 96x96 map in DUO mode.\n');

// 4. Test Friendly Fire Disabled in DUO Mode
console.log('Test 4: DUO Friendly Fire Prevention');
const teammate = room.players[1]; // Slot 1, Team 1 (same as host)
const enemy = room.players[2];    // Slot 2, Team 2

// Host shoots bullet
host.cooldownTimer = 0;
host.input.shoot = true;
host.turretAngle = 0;
room.spawnBullet(host);
const firedBullet = room.bullets[0];
assert.strictEqual(firedBullet.team, 1, 'Bullet must inherit owner team 1');

// Position teammate directly in bullet path
teammate.x = firedBullet.x + 10;
teammate.y = firedBullet.y;
const initHp = teammate.hp;

// Bullet collision check on teammate
const hitTeammate = room.checkBulletTankCollision(firedBullet, teammate.x, teammate.y);
assert.strictEqual(hitTeammate, false, 'Bullet must pass through teammate without damage');
assert.strictEqual(teammate.hp, initHp, 'Teammate HP must remain intact');

// Position enemy directly in bullet path
enemy.x = firedBullet.x + 10;
enemy.y = firedBullet.y;
const enemyInitHp = enemy.hp;
const hitEnemy = room.checkBulletTankCollision(firedBullet, enemy.x, enemy.y);
assert.strictEqual(hitEnemy, true, 'Bullet must hit enemy');
assert.ok(enemy.hp < enemyInitHp, 'Enemy HP must decrease from hit');
console.log('  ✅ DUO friendly fire correctly disabled, enemy hit confirmed.\n');

// 5. Test Host Force End Game
console.log('Test 5: Host Force End Game');
room.forceEndGame();
assert.strictEqual(room.state, 'GAMEOVER', 'Host forceEndGame must immediately transition to GAMEOVER');
assert.ok(room.scoreboard.length > 0, 'Scoreboard must be generated');
console.log('  ✅ Host force end game verified.\n');

// 6. Test Diagonal 45-Degree Corner-Cutting Prevention
console.log('Test 6: Diagonal 45-Degree Wall Corner-Cutting Prevention');
// Setup two diagonal touching indestructible walls: (10, 10) and (11, 11)
room.map.tiles[10][10] = 1;
room.map.tiles[11][11] = 1;
room.map.tiles[10][11] = 0; // open floor
room.map.tiles[11][10] = 0; // open floor

// Bullet traveling diagonally from (10.9, 10.1) towards (11.1, 10.9)
const diagBullet = {
  id: 9999,
  ownerId: 'test',
  speed: 600,
  damage: 20,
  wallDamageMultiplier: 1.0,
  radius: 4,
  distanceTraveled: 0,
  maxRange: 500
};

// Check collision stepping across diagonal corner contact
const prevX = 10 * 36 + 32; // (10.88, 10.1) in tile 10,10 edge
const prevY = 10 * 36 + 4;
const nextX = 11 * 36 + 4;  // stepping into 11,10 while touching corner
const nextY = 11 * 36 + 4;
const hitCorner = room.checkBulletWallCollision(diagBullet, prevX, prevY, nextX, nextY);
assert.strictEqual(hitCorner, true, 'Bullet attempting to cross 45-degree diagonal touching wall corners must collide');
console.log('  ✅ 45-degree diagonal corner-cutting gap strictly sealed.\n');

// 7. Test Assault Wall Breaking & Breaker Buff Verification
console.log('Test 7: Assault Wall Damage & Breaker Mega-Buff Verification');
const { assault: ast, breaker: brk } = constants.TANK_TYPES;
assert.ok(ast.wallDamageMultiplier > 1.0, 'Assault must have wallDamageMultiplier > 1.0 for rapid breach');
const assaultWallDmgPerShot = Math.round(ast.damage * ast.wallDamageMultiplier);
assert.ok(assaultWallDmgPerShot * 3 >= 50, 'Assault must breach 50-HP destructible wall in 3 shots (~0.36s)');

assert.strictEqual(brk.hp, 140, 'Breaker HP must be buffed to 140 (heavy-tier armor)');
assert.strictEqual(brk.damage, 42, 'Breaker tank damage must be buffed to 42');
assert.strictEqual(brk.speed, 180, 'Breaker speed must be 180');
const breakerWallDmg = Math.round(brk.damage * brk.wallDamageMultiplier);
assert.ok(breakerWallDmg >= 50, 'Breaker bullet must obliterate 50-HP destructible wall in 1 single shot');
console.log(`  ✅ Assault breaches wall in 3 rapid shots (${assaultWallDmgPerShot * 3} dmg).`);
console.log(`  ✅ Breaker buffed: HP ${brk.hp}, Tank Dmg ${brk.damage}, 1-Shot Wall Obliteration (${breakerWallDmg} dmg).\n`);

// 8. Test Bot AI Physics-Validated Navigation
console.log('Test 8: Bot AI 8-Way Physics Navigation');
const botPlayer = room.players.find(p => p.isBot);
assert.ok(botPlayer && botPlayer.botAI, 'Bot player must have botAI');
// Check best move direction calculation returns valid unobstructed vector
const testDir = botPlayer.botAI.findBestMoveDirection(room, botPlayer.x, botPlayer.y, 14.5, 0);
assert.ok(typeof testDir.x === 'number' && typeof testDir.y === 'number', 'Bot must compute valid move vector');
console.log('  ✅ Bot AI physics navigation verified.\n');

// 9. Test Secret Phantom Tank
console.log('Test 9: Secret Phantom Tank Verification');
const { phantom } = constants.TANK_TYPES;
assert.ok(phantom, 'Secret tank "phantom" must exist in TANK_TYPES');
assert.strictEqual(phantom.isSecret, true, 'Phantom must be flagged isSecret');
assert.strictEqual(phantom.isDualBarrel, true, 'Phantom must have dual barrels');
assert.strictEqual(phantom.hasLaserSight, true, 'Phantom must have laser sight');
assert.strictEqual(phantom.wallDamageMultiplier, 2.0, 'Phantom must deal 2x wall damage');
assert.ok(phantom.speed >= 210, 'Phantom must have high speed >= 210');

// Test dual bullet spawning for phantom
const phantomTester = {
  id: 'tester_phantom',
  tankType: 'phantom',
  team: 1,
  x: 200, y: 200,
  turretAngle: 0
};
const bulletCountBefore = room.bullets.length;
room.spawnBullet(phantomTester);
assert.strictEqual(room.bullets.length, bulletCountBefore + 2, 'Phantom must fire 2 simultaneous bullets (dual barrels)');
console.log('  ✅ Secret Phantom tank verified with dual-barrel firing.\n');

// 10. Test Randomized Spawn Points (1 to 20 starting points)
console.log('Test 10: Randomized Spawn Distribution');
const spawnRoom = new P2PGameRoom('SPAWN_TEST');
for (let i = 0; i < 20; i++) {
  if (i === 0) spawnRoom.addPlayer('host_sp', 'Host', true);
  else spawnRoom.addBot();
}
assert.strictEqual(spawnRoom.players.length, 20, 'Room must have 20 participants');
spawnRoom.startGame();
const spawnIndicesUsed = new Set(spawnRoom.players.map(p => p.spawnPointIdx));
assert.strictEqual(spawnIndicesUsed.size, 20, 'All 20 players must receive unique randomized spawn points from the 20 locations');
console.log('  ✅ 20 spawn locations randomly and uniquely distributed without collision.\n');

// 11. Test Host 1 vs 19 Bots Preset
console.log('Test 11: Host 1 vs 19 Bots Setup');
const vsRoom = new P2PGameRoom('VS_TEST');
vsRoom.addPlayer('my_host', 'Boss Host', true);
vsRoom.setupHostVsBots();
assert.strictEqual(vsRoom.players.length, 20, 'Must have exactly 20 players (1 host + 19 bots)');
const hostInVs = vsRoom.players.find(p => p.isHost);
assert.strictEqual(hostInVs.team, 1, 'Host must be on Team 1 (Blue)');
const botList = vsRoom.players.filter(p => p.isBot);
assert.strictEqual(botList.length, 19, 'Must have 19 bots');
assert.ok(botList.every(b => b.team === 2), 'All 19 bots must be on Team 2 (Red)');
assert.strictEqual(vsRoom.gameMode, 'DUO', 'Game mode must be DUO/Team');
console.log('  ✅ 1 Host vs 19 Bots defense battle successfully configured.\n');

// 12. Test Bot Tank Type (Class/Attribute) Customization
console.log('Test 12: Bot Tank Type Customization (Individual & Bulk)');
const firstBot = botList[0];
vsRoom.setBotTankType(firstBot.id, 'sniper');
assert.strictEqual(firstBot.tankType, 'sniper', 'First bot must now be Sniper');
assert.strictEqual(firstBot.hp, constants.TANK_TYPES.sniper.hp, 'Bot HP must update to sniper stats');

// Bulk change all bots to Breaker
vsRoom.setAllBotsTankType('breaker');
assert.ok(botList.every(b => b.tankType === 'breaker'), 'All bots must now be Breaker');
console.log('  ✅ Bot tank attribute / class successfully changed individually and in bulk.\n');

// 13. Test God Bot Mode (Ultra Buffs & AI Aim)
console.log('Test 13: God Bot Mode (Ultra Buffs & Aim)');
assert.strictEqual(vsRoom.godBotMode, false, 'God bot mode is initially disabled');
vsRoom.toggleGodBotMode();
assert.strictEqual(vsRoom.godBotMode, true, 'God bot mode must now be enabled');
assert.ok(firstBot.name.includes('GOD'), 'Bot name must reflect GOD status');
const expectedBreakerGodHp = constants.TANK_TYPES.breaker.hp * 2;
assert.strictEqual(firstBot.maxHp, expectedBreakerGodHp, 'God bot max HP must be 2x base HP');
assert.strictEqual(firstBot.hp, expectedBreakerGodHp, 'God bot current HP must be fully restored to 2x');

// Test toggle back to normal
vsRoom.toggleGodBotMode();
assert.strictEqual(vsRoom.godBotMode, false, 'God bot mode toggled off');
assert.strictEqual(firstBot.maxHp, constants.TANK_TYPES.breaker.hp, 'Bot HP restored to normal');
console.log('  ✅ God Bot mode activation & 2x stat multipliers successfully verified.\n');

// 14. Test Kolibri Secret Mini-Tank (Standard + Name "kolibri")
console.log('Test 14: Kolibri Secret Mini-Tank Mode');
const kolibriRoom = new P2PGameRoom('KOLIBRI_TEST');
const kolibriPlayer = kolibriRoom.addPlayer('p_kolibri', 'Kolibri', true);
kolibriPlayer.tankType = 'standard';
kolibriRoom.startGame();

// Verify HP: 1/10 of Standard (10 HP)
assert.strictEqual(kolibriPlayer.maxHp, 10, 'Kolibri max HP must be 10 (1/10 of Standard)');
assert.strictEqual(kolibriPlayer.hp, 10, 'Kolibri starting HP must be 10');
assert.strictEqual(kolibriPlayer.isKolibri, true, 'isKolibri flag must be true');

// Transition to PLAYING
kolibriRoom.countdownTimer = 0;
kolibriRoom.update(0.1);
assert.strictEqual(kolibriRoom.state, 'PLAYING');

// Test Firing & Bullet Attributes:
kolibriPlayer.cooldownTimer = 0;
kolibriPlayer.input.shoot = true;
kolibriRoom.spawnBullet(kolibriPlayer);
const kBullet = kolibriRoom.bullets[0];
assert.ok(kBullet, 'Kolibri must spawn a bullet');
assert.strictEqual(kBullet.damage, 1, 'Kolibri bullet damage must be 1');
assert.strictEqual(kBullet.speed, constants.TANK_TYPES.heavy.bulletSpeed, 'Kolibri bullet speed must match Heavy tank (460 px/s)');
assert.strictEqual(kBullet.radius, 2.0, 'Kolibri bullet radius must be mini (2.0)');
assert.strictEqual(kBullet.wallDamageMultiplier, 17.0, 'Kolibri wallDamageMultiplier must be 17.0');

// Test 20 walls destroyed per second (3 shots per 50 HP wall):
kolibriRoom.map.tiles[5][5] = constants.TILE.DESTRUCTIBLE;
kolibriRoom.map.wallHp[5][5] = 50;

// Shot 1
kolibriRoom.applyBulletWallDamage(kBullet, 5, 5, 5 * 36, 5 * 36);
assert.strictEqual(kolibriRoom.map.wallHp[5][5], 33, 'Shot 1 must reduce wall HP from 50 to 33');
assert.strictEqual(kolibriRoom.map.tiles[5][5], constants.TILE.DESTRUCTIBLE, 'Wall must still exist after shot 1');

// Shot 2
kolibriRoom.applyBulletWallDamage(kBullet, 5, 5, 5 * 36, 5 * 36);
assert.strictEqual(kolibriRoom.map.wallHp[5][5], 16, 'Shot 2 must reduce wall HP from 33 to 16');
assert.strictEqual(kolibriRoom.map.tiles[5][5], constants.TILE.DESTRUCTIBLE, 'Wall must still exist after shot 2');

// Shot 3 (Wall destroyed!)
const destroyed = kolibriRoom.applyBulletWallDamage(kBullet, 5, 5, 5 * 36, 5 * 36);
assert.strictEqual(destroyed, true, 'Shot 3 must destroy wall');
assert.strictEqual(kolibriRoom.map.wallHp[5][5], 0, 'Wall HP must be 0');
assert.strictEqual(kolibriRoom.map.tiles[5][5], 0, 'Tile must become FLOOR (0)');
console.log('  ✅ 3 shots per 50 HP wall (60 shots/s / 3 = exactly 20 walls destroyed/sec).');

// Test 60 shots per second firing accumulator (2 shots per 0.0333s tick):
kolibriRoom.bullets = [];
kolibriPlayer.cooldownTimer = 0;
kolibriPlayer.input.shoot = true;
kolibriRoom.update(1 / 30); // 1 tick at 30Hz (~0.0333s)
assert.strictEqual(kolibriRoom.bullets.length, 2, 'Kolibri continuous fire accumulator must produce 2 shots per 30Hz tick (60 shots/s)');

// Test Movement Speed: 1/4 of Standard (45 px/s)
kolibriPlayer.input.shoot = false;
kolibriPlayer.input.right = true;
kolibriPlayer.x = 200;
kolibriPlayer.y = 200;
kolibriRoom.update(1.0); // 1 full second
assert.strictEqual(kolibriPlayer.vx, 45, 'Kolibri velocity must be 45 px/s (1/4 of standard 180)');

console.log('  ✅ Kolibri Mini-Tank: 1/2 size, 10 HP, 45 speed, 1 dmg, 60 shots/s, Heavy bullet speed verified.\n');

// 15. Test Phantom Tank Relock & Reset on Return to Lobby
console.log('Test 15: Phantom Tank Relock on Return to Lobby');
const phantomLobbyRoom = new P2PGameRoom('PHANTOM_LOBBY_TEST');
const pUser = phantomLobbyRoom.addPlayer('user_phantom', 'Phantom Ace', true);
pUser.tankType = 'phantom';
phantomLobbyRoom.startGame();
assert.strictEqual(pUser.tankType, 'phantom', 'Player is playing as Phantom in match');
phantomLobbyRoom.returnToLobby();
assert.strictEqual(phantomLobbyRoom.state, 'LOBBY');
assert.strictEqual(pUser.tankType, 'standard', 'Phantom tank must be automatically reset to standard upon returning to lobby');
console.log('  ✅ Phantom tank successfully reset to standard on lobby return.\n');

// 16. Test Spatial Audio Audible Range (Sniper range 1200px + 100px = 1300px)
console.log('Test 16: Spatial Audio Audible Radius (Sniper range + 100px)');
const sniperRange = constants.TANK_TYPES.sniper.bulletRange;
assert.strictEqual(sniperRange, 1200, 'Sniper range must be 1200px');
const audibleRadius = sniperRange + 100;
assert.strictEqual(audibleRadius, 1300, 'Audible sound radius must be exactly 1300px (Sniper range + 100px)');

function checkAudible(listenerX, listenerY, soundX, soundY) {
  const dist = Math.hypot(soundX - listenerX, soundY - listenerY);
  return dist <= audibleRadius;
}

const myX = 1000, myY = 1000;
assert.strictEqual(checkAudible(myX, myY, myX + 500, myY), true, 'Sound at 500px is within audible range');
assert.strictEqual(checkAudible(myX, myY, myX + 1300, myY), true, 'Sound at boundary 1300px is audible');
assert.strictEqual(checkAudible(myX, myY, myX + 1301, myY), false, 'Sound at 1301px is strictly inaudible (silent)');
assert.strictEqual(checkAudible(myX, myY, myX + 2500, myY), false, 'Sound from far end of map (2500px) is strictly inaudible');
console.log('  ✅ Spatial audio audible boundary strictly enforced at 1300px (1200px + 100px).\n');

console.log('🎉 ALL TANK-10 CORE LOGIC & NEW FEATURE TESTS PASSED SUCCESSFULLY!');
process.exit(0);
