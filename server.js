// TANK-10: Main Server (Static HTTP + WebSocket + Multi-Room / Room Code Support)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('./websocket');
const { CONSTANTS, P2PGameRoom } = require('../js/game-engine');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.join(__dirname, '..');

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Static File Server (serves directly from project root)
const httpServer = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';

  const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(ROOT_DIR, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

// Server Room Wrapper bridging P2PGameRoom engine with WebSocket clients
class ServerGameRoom {
  constructor(roomId) {
    this.roomId = roomId;
    this.sockets = new Map(); // playerId -> ws
    this.engine = new P2PGameRoom(roomId, (payload) => {
      this.broadcast(payload);
    });
    this.engine.startLoop();
  }

  broadcast(payload) {
    const json = JSON.stringify(payload);
    for (const [id, ws] of this.sockets) {
      if (ws && ws.isOpen && !ws.socket.destroyed) {
        ws.send(json);
      }
    }
  }

  addPlayer(ws, playerName) {
    if (this.engine.players.length >= CONSTANTS.MAX_PLAYERS) {
      return { success: false, reason: 'Room is full (20 players max)' };
    }
    const isFirst = (this.engine.players.length === 0);
    const playerId = 'p_' + Math.random().toString(36).substring(2, 9);
    const player = this.engine.addPlayer(playerId, playerName, isFirst);
    if (!player) {
      return { success: false, reason: 'Could not allocate slot' };
    }
    this.sockets.set(playerId, ws);
    return { success: true, player };
  }

  removePlayer(playerId) {
    this.sockets.delete(playerId);
    this.engine.removePlayer(playerId);
    if (this.engine.players.length === 0) {
      this.engine.stopLoop();
    }
  }

  sendFullMap(ws) {
    if (ws && ws.isOpen && !ws.socket.destroyed) {
      ws.send(JSON.stringify(this.engine.getMapPayload()));
    }
  }
}

// Multi-Room Manager (Keyed by "合言葉 / Room Code")
const rooms = new Map();

function getOrCreateRoom(roomCode) {
  const code = (roomCode || 'arena').trim().toLowerCase().substring(0, 20) || 'arena';
  if (!rooms.has(code)) {
    rooms.set(code, new ServerGameRoom(code));
  }
  return rooms.get(code);
}

// Pure Node WebSocket Server
const wss = new WebSocketServer(httpServer);

wss.on('connection', (ws, req) => {
  let initialRoomCode = 'arena';
  try {
    const urlParts = (req.url || '').split('?');
    if (urlParts.length > 1) {
      const searchParams = new URLSearchParams(urlParts[1]);
      const r = searchParams.get('room');
      if (r) initialRoomCode = r;
    }
  } catch (e) {}

  let currentRoom = null;
  let currentPlayer = null;

  function joinRoom(targetCode, playerName = null) {
    if (currentRoom && currentPlayer) {
      currentRoom.removePlayer(currentPlayer.id);
    }

    currentRoom = getOrCreateRoom(targetCode);
    const result = currentRoom.addPlayer(ws, playerName);

    if (!result.success) {
      ws.send(JSON.stringify({
        type: 'error',
        message: result.reason
      }));
      return false;
    }

    currentPlayer = result.player;

    ws.send(JSON.stringify({
      type: 'welcome',
      playerId: currentPlayer.id,
      slot: currentPlayer.slot,
      isHost: currentPlayer.isHost,
      roomCode: currentRoom.roomId
    }));

    currentRoom.sendFullMap(ws);
    return true;
  }

  joinRoom(initialRoomCode);

  ws.on('message', (msgStr) => {
    try {
      const msg = JSON.parse(msgStr);
      if (!currentRoom || !currentPlayer) return;

      switch (msg.type) {
        case 'join_room':
          if (msg.roomCode) {
            joinRoom(msg.roomCode, currentPlayer ? currentPlayer.name : null);
          }
          break;

        case 'update_config':
          currentRoom.engine.updatePlayerConfig(currentPlayer.id, msg.data || {});
          break;

        case 'input':
          currentRoom.engine.handlePlayerInput(currentPlayer.id, msg.data || {});
          break;

        case 'start_game':
          currentRoom.engine.startGame();
          for (const [id, s] of currentRoom.sockets) {
            currentRoom.sendFullMap(s);
          }
          break;

        case 'add_bot':
          if (currentPlayer.isHost) {
            currentRoom.engine.addBot(msg.tankType || (msg.data && msg.data.tankType));
          }
          break;

        case 'remove_one_bot':
          if (currentPlayer.isHost) {
            currentRoom.engine.removeOneBot();
          }
          break;

        case 'fill_to_10':
          if (currentPlayer.isHost) {
            currentRoom.engine.fillTo10();
          }
          break;

        case 'fill_bots':
          if (currentPlayer.isHost) {
            currentRoom.engine.fillWithBots();
          }
          break;

        case 'remove_bots':
          if (currentPlayer.isHost) {
            currentRoom.engine.removeBots();
          }
          break;

        case 'set_bot_count':
          const targetCount = (typeof msg.count === 'number' ? msg.count : (msg.data && typeof msg.data.count === 'number' ? msg.data.count : undefined));
          if (currentPlayer.isHost && targetCount !== undefined) {
            currentRoom.engine.setBotCount(targetCount);
          }
          break;

        case 'set_game_mode':
          const chosenMode = msg.mode || (msg.data && msg.data.mode);
          if (currentPlayer.isHost && chosenMode) {
            currentRoom.engine.setGameMode(chosenMode);
          }
          break;

        case 'set_player_team':
          if (msg.data) {
            currentRoom.engine.setPlayerTeam(msg.data.id, msg.data.team);
          }
          break;

        case 'set_bot_tank_type':
          if (currentPlayer.isHost && msg.data) {
            currentRoom.engine.setBotTankType(msg.data.id, msg.data.tankType);
          }
          break;

        case 'set_all_bots_type':
          if (currentPlayer.isHost && msg.data) {
            currentRoom.engine.setAllBotsTankType(msg.data.tankType);
          }
          break;

        case 'setup_host_vs_bots':
          if (currentPlayer.isHost) {
            currentRoom.engine.setupHostVsBots();
          }
          break;

        case 'toggle_god_bot':
          currentRoom.engine.toggleGodBotMode();
          break;

        case 'force_end_game':
          if (currentPlayer.isHost) {
            currentRoom.engine.forceEndGame();
          }
          break;

        case 'return_to_lobby':
          if (currentPlayer.isHost) {
            currentRoom.engine.returnToLobby();
            for (const [id, s] of currentRoom.sockets) {
              currentRoom.sendFullMap(s);
            }
          }
          break;

        case 'request_map':
          currentRoom.sendFullMap(ws);
          break;

        default:
          break;
      }
    } catch (e) {
      console.error('Error handling WebSocket message:', e);
    }
  });

  ws.on('close', () => {
    if (currentRoom && currentPlayer) {
      currentRoom.removePlayer(currentPlayer.id);
      if (currentRoom.roomId !== 'arena' && currentRoom.engine.players.length === 0) {
        rooms.delete(currentRoom.roomId);
      }
    }
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 TANK-10 Server is running on http://0.0.0.0:${PORT}`);
  console.log(`🎮 Multi-Room / Room Code (合言葉) enabled`);
  console.log(`=======================================================`);
});
