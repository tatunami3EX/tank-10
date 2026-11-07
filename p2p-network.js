// ==========================================================================
// TANK-10: WebRTC P2P Network Layer (PeerJS Star Topology)
// ==========================================================================

class P2PNetwork {
  constructor() {
    this.peer = null;
    this.connections = new Map(); // peerId -> DataConnection
    this.isHost = false;
    this.roomCode = null;
    this.localPlayerId = null;
    this.hostRoom = null; // P2PGameRoom instance (only active if this client is Host)
    this.onMessageCallback = null;
    this.onStatusChangeCallback = null;
  }

  init(onMessage, onStatusChange) {
    this.onMessageCallback = onMessage;
    this.onStatusChangeCallback = onStatusChange;
  }

  // Complete cleanup of previous peer, connections and background game loops
  cleanup() {
    if (this.hostRoom) {
      this.hostRoom.stopLoop();
      this.hostRoom = null;
    }
    for (const [id, conn] of this.connections) {
      try { conn.close(); } catch (e) {}
    }
    this.connections.clear();
    if (this.peer) {
      try { this.peer.destroy(); } catch (e) {}
      this.peer = null;
    }
  }

  // Generate friendly 5-character room code (e.g. CYBER, TANK7)
  static generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  // --- 1. Create Room as HOST ---
  createRoom(roomCode = null) {
    this.cleanup();
    this.isHost = true;
    this.roomCode = (roomCode || P2PNetwork.generateRoomCode()).toUpperCase();
    const peerId = 'TANK10-' + this.roomCode;
    this.localPlayerId = 'host_' + Math.random().toString(36).substring(2, 7);

    this._setStatus(`ホスト準備中 (コード: ${this.roomCode})...`);

    try {
      this.peer = new Peer(peerId, {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      });
    } catch (e) {
      console.warn('PeerJS init failed, falling back to auto-id:', e);
      this.peer = new Peer({ debug: 1 });
    }

    this.peer.on('open', (id) => {
      console.log('P2P Host Peer ready with ID:', id);
      this._setStatus(`ホスト待機中 [部屋コード: ${this.roomCode}]`);

      // Initialize authoritative game simulation inside host's browser!
      this.hostRoom = new window.P2PGameRoom(this.roomCode, (payload) => {
        // Broadcast game state to all connected guests
        this.broadcast(payload);
        // Also deliver to local host UI
        if (this.onMessageCallback) {
          this.onMessageCallback(payload);
        }
      });

      // Add Host as Player 1
      const p1 = this.hostRoom.addPlayer(this.localPlayerId, 'Host Player', true);

      // Trigger local welcome & map data
      if (this.onMessageCallback) {
        this.onMessageCallback({
          type: 'welcome',
          playerId: p1.id,
          slot: p1.slot,
          isHost: true,
          roomCode: this.roomCode
        });
        this.onMessageCallback(this.hostRoom.getMapPayload());
      }

      this.hostRoom.startLoop();
    });

    this.peer.on('connection', (conn) => {
      this._handleGuestConnection(conn);
    });

    this.peer.on('error', (err) => {
      console.error('Peer error:', err);
      if (err.type === 'unavailable-id') {
        // Code already taken, generate new one
        this.createRoom();
      } else {
        this._setStatus(`接続エラー: ${err.type}`);
      }
    });
  }

  // --- 2. Join Room as GUEST ---
  joinRoom(roomCode, playerName = 'Guest Player') {
    this.cleanup();
    this.isHost = false;
    this.roomCode = roomCode.toUpperCase().trim();
    const targetPeerId = 'TANK10-' + this.roomCode;
    this.localPlayerId = 'guest_' + Math.random().toString(36).substring(2, 7);

    this._setStatus(`部屋 [${this.roomCode}] へ接続中...`);

    this.peer = new Peer({
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    });

    this.peer.on('open', (myId) => {
      console.log('Guest Peer initialized with ID:', myId, 'Connecting to:', targetPeerId);
      // Use reliable data channel to prevent map & state loss
      const conn = this.peer.connect(targetPeerId, { reliable: true });

      const onConnectOpen = () => {
        console.log('Connected to P2P Host!');
        this.connections.set('host', conn);
        this._setStatus(`部屋 [${this.roomCode}] に接続完了!`);

        // Send join greeting with player name
        conn.send({
          type: 'join',
          playerId: this.localPlayerId,
          name: playerName
        });
      };

      if (conn.open) {
        onConnectOpen();
      } else {
        conn.on('open', onConnectOpen);
      }

      conn.on('data', (data) => {
        if (this.onMessageCallback) {
          this.onMessageCallback(data);
        }
      });

      conn.on('close', () => {
        this._setStatus('ホストとの通信が切断されました');
      });

      conn.on('error', (err) => {
        console.error('P2P connection error:', err);
        this._setStatus('ホストへの接続に失敗しました (部屋コードを確認してください)');
      });
    });

    this.peer.on('error', (err) => {
      console.error('PeerJS error:', err);
      this._setStatus('部屋が見つかりませんでした (部屋コードを確認してください)');
    });
  }

  // --- Host: Handle incoming Guest DataConnection ---
  _handleGuestConnection(conn) {
    console.log('New guest incoming:', conn.peer);
    this.connections.set(conn.peer, conn);

    conn.on('data', (msg) => {
      if (!this.hostRoom) return;

      switch (msg.type) {
        case 'join':
          const newPlayer = this.hostRoom.addPlayer(msg.playerId, msg.name, false);
          if (newPlayer) {
            conn.send({
              type: 'welcome',
              playerId: newPlayer.id,
              slot: newPlayer.slot,
              isHost: false,
              roomCode: this.roomCode
            });
            conn.send(this.hostRoom.getMapPayload());
            // If match is already in progress, immediately deliver current game state
            if (this.hostRoom.state !== 'LOBBY') {
              conn.send(this.hostRoom.getBroadcastPayload());
            }
          }
          break;

        case 'update_config':
          this.hostRoom.updatePlayerConfig(msg.playerId, msg.data || {});
          break;

        case 'input':
          this.hostRoom.handlePlayerInput(msg.playerId, msg.data || {});
          break;

        case 'add_bot':
          this.hostRoom.addBot();
          break;

        case 'remove_one_bot':
          this.hostRoom.removeOneBot();
          break;

        case 'set_bot_count':
          if (msg.data && msg.data.count !== undefined) this.hostRoom.setBotCount(msg.data.count);
          break;

        case 'fill_to_10':
          this.hostRoom.fillTo10();
          break;

        case 'fill_bots':
          this.hostRoom.fillWithBots();
          break;

        case 'remove_bots':
          this.hostRoom.removeBots();
          break;

        case 'set_game_mode':
          if (msg.data && msg.data.mode) this.hostRoom.setGameMode(msg.data.mode);
          break;

        case 'set_player_team':
          if (msg.data) this.hostRoom.setPlayerTeam(msg.data.id, msg.data.team);
          break;

        case 'set_bot_tank_type':
          if (msg.data) this.hostRoom.setBotTankType(msg.data.id, msg.data.tankType);
          break;

        case 'set_all_bots_type':
          if (msg.data) this.hostRoom.setAllBotsTankType(msg.data.tankType);
          break;

        case 'setup_host_vs_bots':
          this.hostRoom.setupHostVsBots();
          break;

        case 'toggle_god_bot':
          this.hostRoom.toggleGodBotMode();
          break;

        case 'force_end_game':
          this.hostRoom.forceEndGame();
          break;

        default:
          break;
      }
    });

    conn.on('close', () => {
      console.log('Guest disconnected:', conn.peer);
      this.connections.delete(conn.peer);
      if (this.hostRoom) {
        const p = this.hostRoom.players.find(x => x.id.includes(conn.peer) || !x.isHost);
        // Clean up or remove player if in lobby
        if (this.hostRoom.state === 'LOBBY' && p) {
          this.hostRoom.removePlayer(p.id);
        }
      }
    });
  }

  // --- Send Packet (Host or Guest) ---
  send(type, data = {}) {
    if (this.isHost) {
      // Local Host action -> execute directly on local P2PGameRoom
      if (!this.hostRoom) return;

      switch (type) {
        case 'update_config':
          this.hostRoom.updatePlayerConfig(this.localPlayerId, data);
          break;
        case 'input':
          this.hostRoom.handlePlayerInput(this.localPlayerId, data);
          break;
        case 'start_game':
          this.hostRoom.startGame();
          this.broadcast(this.hostRoom.getMapPayload());
          if (this.onMessageCallback) this.onMessageCallback(this.hostRoom.getMapPayload());
          break;
        case 'force_end_game':
          this.hostRoom.forceEndGame();
          break;
        case 'set_game_mode':
          this.hostRoom.setGameMode(data.mode);
          break;
        case 'set_player_team':
          this.hostRoom.setPlayerTeam(data.id, data.team);
          break;
        case 'set_bot_tank_type':
          this.hostRoom.setBotTankType(data.id, data.tankType);
          break;
        case 'set_all_bots_type':
          this.hostRoom.setAllBotsTankType(data.tankType);
          break;
        case 'setup_host_vs_bots':
          this.hostRoom.setupHostVsBots();
          break;
        case 'toggle_god_bot':
          this.hostRoom.toggleGodBotMode();
          break;
        case 'set_bot_count':
          this.hostRoom.setBotCount(data.count);
          break;
        case 'add_bot':
          this.hostRoom.addBot();
          break;
        case 'remove_one_bot':
          this.hostRoom.removeOneBot();
          break;
        case 'fill_to_10':
          this.hostRoom.fillTo10();
          break;
        case 'fill_bots':
          this.hostRoom.fillWithBots();
          break;
        case 'remove_bots':
          this.hostRoom.removeBots();
          break;
        case 'return_to_lobby':
          this.hostRoom.returnToLobby();
          this.broadcast(this.hostRoom.getMapPayload());
          if (this.onMessageCallback) this.onMessageCallback(this.hostRoom.getMapPayload());
          break;
        default:
          break;
      }
    } else {
      // Guest action -> send to Host via DataConnection
      const hostConn = this.connections.get('host');
      if (hostConn && hostConn.open) {
        hostConn.send({ type, playerId: this.localPlayerId, data });
      }
    }
  }

  broadcast(payload) {
    for (const [peerId, conn] of this.connections) {
      if (conn.open) {
        try {
          conn.send(payload);
        } catch (e) {
          console.warn('Failed to send to peer:', peerId, e);
        }
      }
    }
  }

  _setStatus(status) {
    if (this.onStatusChangeCallback) {
      this.onStatusChangeCallback(status);
    }
  }
}

window.p2pNetwork = new P2PNetwork();
