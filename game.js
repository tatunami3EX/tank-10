// ==========================================================================
// TANK-10: Main Game Client Engine
// ==========================================================================

(function() {
  // Game State Cache
  let ws = null;
  let myPlayerId = null;
  let mySlot = 0;
  let isHost = false;
  let roomState = 'LOBBY';
  let mapData = null;
  let tankTypesData = {};
  let currentGameState = null;
  let currentGameMode = 'SOLO'; // 'SOLO' or 'DUO'

  // Multi-Room / Room Code (合言葉)
  const urlParams = new URLSearchParams(window.location.search);
  let currentRoomCode = (urlParams.get('room') || 'arena').trim().toLowerCase().substring(0, 16);

  // Camera & Spectator
  const camera = {
    x: 1152,
    y: 1152,
    targetX: 1152,
    targetY: 1152,
    zoom: 1.0,
    targetZoom: 1.0,
    mode: 'overview' // 'overview' (マップ全体俯瞰: 引き) or 'follow' (プレイヤー追従)
  };
  let spectateTargetId = null;
  let screenShake = { intensity: 0, duration: 0 };
  let enableScreenShake = true;

  // Canvas & Context
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const minimapCanvas = document.getElementById('minimap-canvas');
  const minimapCtx = minimapCanvas.getContext('2d');

  // Particles & Visual FX
  const particles = [];
  const skidmarks = [];
  const killFeedQueue = [];

  // Local Player Config
  let localConfig = {
    name: 'Player 1',
    tankType: 'standard',
    isSpectator: false
  };

  // Pre-cached specs for immediate lobby preview
  const LOCAL_TANK_SPECS = {
    standard: {
      name: '1. スタンダード',
      desc: 'クセのない万能型',
      color: '#22c55e',
      special: '⚡ 特徴: バランス型・安定した取り回し',
      speed: 60, hp: 60, power: 60, rate: 60, range: 60
    },
    assault: {
      name: '2. アサルト',
      desc: '移動速度と連射力で圧倒する前衛型',
      color: '#eab308',
      special: '⚡ 特徴: 高速機動 ＆ 超連射マシンガン（壁も連射で素早く粉砕可能）',
      speed: 95, hp: 40, power: 40, rate: 95, range: 45
    },
    heavy: {
      name: '3. ヘビー',
      desc: '圧倒的な高耐久で前線を押し上げる',
      color: '#3b82f6',
      special: '⚡ 特徴: 超高耐久装甲 ＆ 重砲撃（1マス通路もスムーズに通過）',
      speed: 35, hp: 100, power: 80, rate: 40, range: 65
    },
    sniper: {
      name: '4. スナイパー',
      desc: '長距離からの一撃必殺（照準線表示）',
      color: '#a855f7',
      special: '⚡ 特徴: 超長射程・爆速弾・レーザー照準線（極低連射・紙装甲）',
      speed: 45, hp: 35, power: 100, rate: 20, range: 100
    },
    breaker: {
      name: '5. ブレイカー',
      desc: '壁一撃粉砕 ＆ 重火器超火力（HP140・攻撃42）',
      color: '#ef4444',
      special: '⚡ 特徴: 壁ダメージ2倍で1撃瞬殺！超高火力＆タフな重装甲で前線を蹂躙',
      speed: 65, hp: 80, power: 88, rate: 55, range: 60
    },
    phantom: {
      name: '⭐ ファントム (SECRET)',
      desc: '古代ハイパー技術の幻影戦車',
      color: '#f59e0b',
      special: '⚡ 特徴: 2連装高速プラズマ主砲＆超高機動！壁一撃粉砕＋レーザー照準線',
      speed: 88, hp: 75, power: 85, rate: 82, range: 85
    }
  };

  // --- Initialize Client ---
  function init() {
    setupCanvas();
    setupLobbyUI();
    setupOptionsModal();
    setupHUDControls();
    setupNetworking();

    window.addEventListener('resize', setupCanvas);

    // Start render and input loops
    requestAnimationFrame(gameLoop);
  }

  function setupCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (camera.mode === 'overview') {
      calcOverviewCamera();
    }
  }

  // --- WebSocket Connection ---
  function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/?room=${encodeURIComponent(currentRoomCode)}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('Connected to TANK-10 Server, Room:', currentRoomCode);
      const codeInput = document.getElementById('room-code-input');
      if (codeInput) codeInput.value = currentRoomCode;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (e) {
        console.error('Failed to parse WS packet:', e);
      }
    };

    ws.onclose = () => {
      console.warn('Disconnected from server, reconnecting...');
      setTimeout(connectWebSocket, 1500);
    };

    ws.onerror = (err) => {
      console.error('WebSocket Error:', err);
    };
  }

  // Network Mode: 'p2p' (WebRTC via PeerJS) or 'ws' (WebSocket Server)
  let networkMode = 'p2p';

  // --- Send Packet (Unified P2P & WebSocket) ---
  function sendPacket(type, data = {}) {
    if (networkMode === 'p2p' && window.p2pNetwork) {
      window.p2pNetwork.send(type, data);
    } else if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, data }));
    }
  }

  // --- Network Initialization ---
  function setupNetworking() {
    // Check if PeerJS is available
    if (typeof Peer !== 'undefined' && window.p2pNetwork) {
      networkMode = 'p2p';
      window.p2pNetwork.init(
        (msg) => handleServerMessage(msg),
        (status) => {
          console.log('[P2P Status]', status);
          const statusText = document.getElementById('room-status-text');
          if (statusText) statusText.textContent = status;
        }
      );

      // If URL has ?room=CODE, auto-join as Guest
      const paramRoom = urlParams.get('room');
      if (paramRoom && paramRoom.trim().length >= 3 && paramRoom !== 'arena') {
        currentRoomCode = paramRoom.trim().toUpperCase();
        console.log('Auto-joining P2P room from URL:', currentRoomCode);
        window.p2pNetwork.joinRoom(currentRoomCode, localConfig.name);
      } else {
        // Automatically create initial Host room
        window.p2pNetwork.createRoom();
      }
    } else {
      // Fallback to WebSocket
      console.log('PeerJS not loaded, falling back to WebSocket mode');
      networkMode = 'ws';
      connectWebSocket();
    }
  }

  // --- Handle Server Messages ---
  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'welcome':
        myPlayerId = msg.playerId;
        mySlot = msg.slot;
        isHost = msg.isHost;
        if (msg.roomCode) {
          currentRoomCode = msg.roomCode.toUpperCase();
          const displayCode = document.getElementById('display-room-code');
          if (displayCode) displayCode.textContent = currentRoomCode;
          const codeInput = document.getElementById('room-code-input');
          if (codeInput) codeInput.value = currentRoomCode;
          // Update URL without reload
          const newUrl = `${window.location.pathname}?room=${encodeURIComponent(currentRoomCode)}`;
          window.history.replaceState(null, '', newUrl);
        }

        // Set default name if not customized
        const nameInput = document.getElementById('player-name-input');
        if (nameInput.value === 'Player 1') {
          nameInput.value = `Player ${mySlot + 1}`;
          localConfig.name = nameInput.value;
        }
        sendConfigUpdate();
        updateHostVisibility();
        break;

      case 'map_data':
        mapData = {
          tiles: msg.tiles,
          wallHp: msg.wallHp,
          gridSize: msg.gridSize,
          tileSize: msg.tileSize,
          gameMode: msg.gameMode || 'SOLO'
        };
        tankTypesData = msg.tankTypes || {};
        if (msg.gameMode) currentGameMode = msg.gameMode;

        // Update Radar title
        const radarTitle = document.querySelector('.minimap-title');
        if (radarTitle) radarTitle.textContent = `RADAR (${mapData.gridSize}x${mapData.gridSize})`;

        // Update Lobby map badge
        const mapBadge = document.getElementById('lobby-map-size-badge');
        if (mapBadge) {
          mapBadge.textContent = mapData.gridSize >= 96 ? '🗺️ MAP: 96x96 (大規模)' : '🗺️ MAP: 64x64 (標準)';
        }

        // Recalculate overview camera zoom if in overview mode
        if (camera.mode === 'overview') calcOverviewCamera();
        break;

      case 'game_state':
        currentGameState = msg;
        if (msg.gameMode) currentGameMode = msg.gameMode;
        updateUIFromState(msg);
        processEvents(msg.events || []);
        break;

      default:
        break;
    }
  }

  // --- Lobby UI Setup ---
  function setupLobbyUI() {
    const nameInput = document.getElementById('player-name-input');
    nameInput.addEventListener('input', (e) => {
      localConfig.name = e.target.value.trim() || `Player ${mySlot + 1}`;
      sendConfigUpdate();
    });

    // Tank Type Tabs
    const tabs = document.querySelectorAll('.tank-tab-btn');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        window.soundManager.playClick();
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const type = tab.getAttribute('data-type');
        localConfig.tankType = type;
        updateTankSpecDisplay(type);
        sendConfigUpdate();
      });
    });

    // Host Mode Toggle (Player vs Spectator)
    const btnPlayer = document.getElementById('btn-mode-player');
    const btnSpectator = document.getElementById('btn-mode-spectator');

    btnPlayer.addEventListener('click', () => {
      window.soundManager.playClick();
      btnPlayer.classList.add('active');
      btnSpectator.classList.remove('active');
      localConfig.isSpectator = false;
      sendConfigUpdate();
    });

    btnSpectator.addEventListener('click', () => {
      window.soundManager.playClick();
      btnSpectator.classList.add('active');
      btnPlayer.classList.remove('active');
      localConfig.isSpectator = true;
      sendConfigUpdate();
    });

    // Host Mode (Solo vs Duo) Selector
    const btnSelectSolo = document.getElementById('btn-select-solo');
    const btnSelectDuo = document.getElementById('btn-select-duo');

    if (btnSelectSolo && btnSelectDuo) {
      btnSelectSolo.addEventListener('click', () => {
        window.soundManager.playClick();
        sendPacket('set_game_mode', { mode: 'SOLO' });
      });
      btnSelectDuo.addEventListener('click', () => {
        window.soundManager.playClick();
        sendPacket('set_game_mode', { mode: 'DUO' });
      });
    }

    // Bot Count Controls (Instant +1, -1, Fill to 10, Fill to 20, Clear)
    const btnBotDec = document.getElementById('btn-bot-dec');
    const btnBotInc = document.getElementById('btn-bot-inc');
    const btnFill10 = document.getElementById('btn-fill-10');
    const btnFill20 = document.getElementById('btn-fill-20');
    const btnRemoveBots = document.getElementById('btn-remove-bots');

    if (btnBotInc) {
      btnBotInc.addEventListener('click', () => {
        window.soundManager.playClick();
        sendPacket('add_bot');
      });
    }

    if (btnBotDec) {
      btnBotDec.addEventListener('click', () => {
        window.soundManager.playClick();
        sendPacket('remove_one_bot');
      });
    }

    if (btnFill10) {
      btnFill10.addEventListener('click', () => {
        window.soundManager.playClick();
        sendPacket('fill_to_10');
      });
    }

    if (btnFill20) {
      btnFill20.addEventListener('click', () => {
        window.soundManager.playClick();
        sendPacket('fill_bots');
      });
    }

    if (btnRemoveBots) {
      btnRemoveBots.addEventListener('click', () => {
        window.soundManager.playClick();
        sendPacket('remove_bots');
      });
    }

    // 1 vs 19 Host Battle Preset Button
    const btnHostVsBots = document.getElementById('btn-host-vs-bots');
    if (btnHostVsBots) {
      btnHostVsBots.addEventListener('click', () => {
        window.soundManager.playClick();
        sendPacket('setup_host_vs_bots');
      });
    }

    // All Bots Tank Type Bulk Selector
    const selectAllBotsType = document.getElementById('select-all-bots-type');
    if (selectAllBotsType) {
      selectAllBotsType.addEventListener('change', (e) => {
        const type = e.target.value;
        if (!type) return;
        window.soundManager.playClick();
        sendPacket('set_all_bots_type', { tankType: type });
        // Reset select back to placeholder
        setTimeout(() => { selectAllBotsType.value = ''; }, 300);
      });
    }

    // God Bot Toggle Button
    const btnToggleGodBot = document.getElementById('btn-toggle-god-bot');
    if (btnToggleGodBot) {
      btnToggleGodBot.addEventListener('click', () => {
        window.soundManager.playClick();
        sendPacket('toggle_god_bot');
      });
    }

    // Setup Secret Unlock System (Phantom Tank & God Bots)
    setupSecretSystem();

    // Host Action Buttons
    document.getElementById('btn-start-game').addEventListener('click', () => {
      window.soundManager.playClick();
      sendPacket('start_game');
    });

    // Rematch / Return to Lobby
    document.getElementById('btn-return-lobby').addEventListener('click', () => {
      window.soundManager.playClick();
      lockPhantomTank();
      sendPacket('return_to_lobby');
    });

    // Host Force End Game button in HUD
    const btnForceEnd = document.getElementById('hud-btn-force-end');
    if (btnForceEnd) {
      btnForceEnd.addEventListener('click', () => {
        if (confirm('試合を強制終了してリザルト画面に移行しますか？')) {
          window.soundManager.playClick();
          sendPacket('force_end_game');
        }
      });
    }

    // P2P Create Room (HOST) Button
    const btnCreateP2P = document.getElementById('btn-create-p2p-room');
    if (btnCreateP2P) {
      btnCreateP2P.addEventListener('click', () => {
        window.soundManager.playClick();
        if (window.p2pNetwork) {
          window.p2pNetwork.createRoom();
        }
      });
    }

    // P2P Room Code Join (GUEST)
    const roomCodeInput = document.getElementById('room-code-input');
    const btnJoinCode = document.getElementById('btn-join-room-code');

    const switchRoomCode = () => {
      const newCode = (roomCodeInput.value.trim().toUpperCase().substring(0, 10));
      if (!newCode) return;
      window.soundManager.playClick();
      currentRoomCode = newCode;

      if (networkMode === 'p2p' && window.p2pNetwork) {
        window.p2pNetwork.joinRoom(newCode, localConfig.name);
      } else {
        sendPacket('join_room', { roomCode: newCode });
      }

      const newUrl = `${window.location.pathname}?room=${encodeURIComponent(newCode)}`;
      window.history.replaceState(null, '', newUrl);
    };

    if (btnJoinCode) btnJoinCode.addEventListener('click', switchRoomCode);
    if (roomCodeInput) {
      roomCodeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') switchRoomCode();
      });
    }

    // Copy Invite URL
    const btnCopyInvite = document.getElementById('btn-copy-invite');
    if (btnCopyInvite) {
      btnCopyInvite.addEventListener('click', () => {
        window.soundManager.playClick();
        const shareUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(currentRoomCode)}`;
        navigator.clipboard.writeText(shareUrl).then(() => {
          btnCopyInvite.textContent = '✅ コピー済!';
          setTimeout(() => { btnCopyInvite.textContent = '🔗 招待URLコピー'; }, 2000);
        }).catch(() => {
          prompt('以下のURLを共有してください:', shareUrl);
        });
      });
    }

    // Connect Guide & QR Code Modal
    const connectModal = document.getElementById('connect-modal');
    const btnOpenGuide = document.getElementById('btn-open-connect-guide');
    const btnCloseGuide = document.getElementById('btn-close-connect');
    const btnDoneGuide = document.getElementById('btn-done-connect');
    const lanUrlDisplay = document.getElementById('lan-url-display');
    const onlineUrlDisplay = document.getElementById('online-url-display');
    const qrCanvas = document.getElementById('qr-code-canvas');

    const openConnectModal = () => {
      window.soundManager.playClick();
      connectModal.classList.add('active');

      // Default LAN URL for this host PC
      const lanUrl = `http://192.168.0.10:3000/?room=${encodeURIComponent(currentRoomCode)}`;
      if (lanUrlDisplay) lanUrlDisplay.value = lanUrl;

      // If already accessed via online URL (tunnel), show current origin
      const currentFullUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(currentRoomCode)}`;
      if (onlineUrlDisplay) {
        if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1' && window.location.hostname !== '192.168.0.10') {
          onlineUrlDisplay.value = currentFullUrl;
        } else {
          onlineUrlDisplay.value = `start-online.bat を実行して発行されたURL/?room=${currentRoomCode}`;
        }
      }

      // Generate QR Code for Mobile
      const targetQRUrl = (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1')
        ? currentFullUrl
        : lanUrl;

      if (window.generateQRCodeCanvas && qrCanvas) {
        window.generateQRCodeCanvas(targetQRUrl, qrCanvas, 180);
      }
    };

    const closeConnectModal = () => {
      window.soundManager.playClick();
      connectModal.classList.remove('active');
    };

    if (btnOpenGuide) btnOpenGuide.addEventListener('click', openConnectModal);
    if (btnCloseGuide) btnCloseGuide.addEventListener('click', closeConnectModal);
    if (btnDoneGuide) btnDoneGuide.addEventListener('click', closeConnectModal);

    // Mini copy buttons in modal
    const btnCopyLan = document.getElementById('btn-copy-lan-url');
    if (btnCopyLan && lanUrlDisplay) {
      btnCopyLan.addEventListener('click', () => {
        navigator.clipboard.writeText(lanUrlDisplay.value);
        btnCopyLan.textContent = '済!';
        setTimeout(() => { btnCopyLan.textContent = 'コピー'; }, 1500);
      });
    }

    const btnCopyOnline = document.getElementById('btn-copy-online-url');
    if (btnCopyOnline && onlineUrlDisplay) {
      btnCopyOnline.addEventListener('click', () => {
        navigator.clipboard.writeText(onlineUrlDisplay.value);
        btnCopyOnline.textContent = '済!';
        setTimeout(() => { btnCopyOnline.textContent = 'コピー'; }, 1500);
      });
    }

    updateTankSpecDisplay('standard');
  }

  // --- Secret Tank & God Bot Systems ---
  let isPhantomUnlocked = false; // Relocked on every return to lobby

  function lockPhantomTank() {
    isPhantomUnlocked = false;
    try {
      localStorage.removeItem('tank10_phantom_unlocked');
    } catch (e) {}

    const tabPhantom = document.getElementById('tab-phantom');
    if (tabPhantom) {
      tabPhantom.style.display = 'none';
      tabPhantom.classList.remove('active');
    }

    const bulkSelect = document.getElementById('select-all-bots-type');
    if (bulkSelect) {
      const opt = bulkSelect.querySelector('option[value="phantom"]');
      if (opt) opt.remove();
    }

    // Revert local player tank to standard if currently phantom
    if (localConfig.tankType === 'phantom') {
      localConfig.tankType = 'standard';
      document.querySelectorAll('.tank-tab-btn').forEach(t => t.classList.remove('active'));
      const tabStandard = document.getElementById('tab-standard');
      if (tabStandard) tabStandard.classList.add('active');
      updateTankSpecDisplay('standard');
      sendConfigUpdate();
    }

    lastLobbySlotsKey = '';
    if (currentGameState && currentGameState.players) {
      renderLobbySlots(currentGameState.players);
    }
  }

  function showSecretBanner(title, desc, icon = '🎉', isGod = false) {
    const banner = document.getElementById('secret-banner-overlay');
    if (!banner) return;
    const box = banner.querySelector('.secret-banner-box');
    if (box) {
      if (isGod) box.classList.add('god-bot-banner');
      else box.classList.remove('god-bot-banner');
    }
    const iconEl = document.getElementById('secret-banner-icon');
    const titleEl = document.getElementById('secret-banner-title');
    const descEl = document.getElementById('secret-banner-desc');
    if (iconEl) iconEl.textContent = icon;
    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = desc;

    banner.style.display = 'block';
    setTimeout(() => {
      banner.style.display = 'none';
    }, 4500);
  }

  function unlockPhantomTank() {
    if (isPhantomUnlocked) {
      showSecretBanner('ALREADY UNLOCKED', 'ファントム戦車は既に解放されています！', '⭐');
      return;
    }
    isPhantomUnlocked = true;

    const tabPhantom = document.getElementById('tab-phantom');
    if (tabPhantom) {
      tabPhantom.style.display = 'flex';
      tabPhantom.classList.add('secret-tank-tab');
      // Auto-attach tab click event
      tabPhantom.onclick = () => {
        window.soundManager.playClick();
        document.querySelectorAll('.tank-tab-btn').forEach(t => t.classList.remove('active'));
        tabPhantom.classList.add('active');
        localConfig.tankType = 'phantom';
        updateTankSpecDisplay('phantom');
        sendConfigUpdate();
      };
    }

    // Also add phantom to bulk bot tank type selector if not present
    const bulkSelect = document.getElementById('select-all-bots-type');
    if (bulkSelect && !bulkSelect.querySelector('option[value="phantom"]')) {
      const opt = document.createElement('option');
      opt.value = 'phantom';
      opt.textContent = '⭐ ファントム (SECRET)';
      bulkSelect.appendChild(opt);
    }

    lastLobbySlotsKey = '';
    if (currentGameState && currentGameState.players) {
      renderLobbySlots(currentGameState.players);
    }

    showSecretBanner('SECRET TANK UNLOCKED!', '【隠し戦車】ファントムが解放されました！タブから選択可能！', '⭐');
  }

  function setupSecretSystem() {
    // Initial start: lock phantom
    lockPhantomTank();

    // 2. Bind keyboard chord listeners (T+A+N+K and B+O+T / G+O+D)
    if (window.inputManager) {
      window.inputManager.onSecretTankUnlocked = () => {
        unlockPhantomTank();
      };
      window.inputManager.onGodBotToggle = () => {
        window.soundManager.playClick();
        sendPacket('toggle_god_bot');
      };
    }

    // 3. Mobile touch: Logo Long Press or 5 rapid taps -> Unlock Phantom
    const logoEl = document.getElementById('main-game-logo');
    if (logoEl) {
      let logoTapCount = 0;
      let logoTapTimer = null;
      let logoPressTimer = null;

      logoEl.addEventListener('touchstart', () => {
        logoPressTimer = setTimeout(() => {
          unlockPhantomTank();
        }, 1300);
      }, { passive: true });

      logoEl.addEventListener('touchend', () => {
        if (logoPressTimer) clearTimeout(logoPressTimer);
        logoTapCount++;
        clearTimeout(logoTapTimer);
        logoTapTimer = setTimeout(() => { logoTapCount = 0; }, 1200);
        if (logoTapCount >= 5) {
          logoTapCount = 0;
          unlockPhantomTank();
        }
      }, { passive: true });
    }

    // 4. Mobile touch: Bot box Long Press or 5 rapid taps -> Toggle God Bots
    const botStatusBox = document.getElementById('bot-status-box');
    if (botStatusBox) {
      let botTapCount = 0;
      let botTapTimer = null;
      let botPressTimer = null;

      botStatusBox.addEventListener('touchstart', () => {
        botPressTimer = setTimeout(() => {
          window.soundManager.playClick();
          sendPacket('toggle_god_bot');
        }, 1300);
      }, { passive: true });

      botStatusBox.addEventListener('touchend', () => {
        if (botPressTimer) clearTimeout(botPressTimer);
        botTapCount++;
        clearTimeout(botTapTimer);
        botTapTimer = setTimeout(() => { botTapCount = 0; }, 1200);
        if (botTapCount >= 5) {
          botTapCount = 0;
          window.soundManager.playClick();
          sendPacket('toggle_god_bot');
        }
      }, { passive: true });
    }
  }

  function updateTankSpecDisplay(type) {
    const spec = LOCAL_TANK_SPECS[type] || LOCAL_TANK_SPECS.standard;
    const nameEl = document.getElementById('spec-name');
    nameEl.textContent = spec.name;
    nameEl.style.color = spec.color;

    document.getElementById('spec-desc').textContent = spec.desc;
    document.getElementById('bar-speed').style.width = `${spec.speed}%`;
    document.getElementById('bar-hp').style.width = `${spec.hp}%`;
    document.getElementById('bar-power').style.width = `${spec.power}%`;
    document.getElementById('bar-rate').style.width = `${spec.rate}%`;
    document.getElementById('bar-range').style.width = `${spec.range}%`;
    document.getElementById('spec-special').textContent = spec.special;
  }

  function sendConfigUpdate() {
    sendPacket('update_config', localConfig);
  }

  function updateHostVisibility() {
    const myPlayer = currentGameState ? currentGameState.players.find(p => p.id === myPlayerId) : null;
    const hostActive = myPlayer ? myPlayer.isHost : isHost;

    const hostTag = document.getElementById('host-tag');
    const hostControls = document.getElementById('host-controls');
    const nonHostMsg = document.getElementById('non-host-msg');
    const hostRoleWrapper = document.getElementById('host-role-wrapper');
    const resultHostControls = document.getElementById('result-host-controls');
    const resultClientMsg = document.getElementById('result-client-msg');
    const hudForceEndBtn = document.getElementById('hud-btn-force-end');
    const gameModeWrapper = document.getElementById('game-mode-wrapper');

    if (hostActive) {
      hostTag.style.display = 'block';
      hostControls.style.display = 'block';
      nonHostMsg.style.display = 'none';
      hostRoleWrapper.style.display = 'flex';
      resultHostControls.style.display = 'block';
      resultClientMsg.style.display = 'none';
      if (hudForceEndBtn) hudForceEndBtn.style.display = 'flex';
      if (gameModeWrapper) gameModeWrapper.style.pointerEvents = 'auto';
    } else {
      hostTag.style.display = 'none';
      hostControls.style.display = 'none';
      nonHostMsg.style.display = 'block';
      hostRoleWrapper.style.display = 'none';
      resultHostControls.style.display = 'none';
      resultClientMsg.style.display = 'block';
      if (hudForceEndBtn) hudForceEndBtn.style.display = 'none';
      if (gameModeWrapper) gameModeWrapper.style.pointerEvents = 'none';
    }

    // Sync Game Mode active buttons
    const btnSolo = document.getElementById('btn-select-solo');
    const btnDuo = document.getElementById('btn-select-duo');
    if (btnSolo && btnDuo) {
      if (currentGameMode === 'DUO') {
        btnDuo.classList.add('active');
        btnSolo.classList.remove('active');
      } else {
        btnSolo.classList.add('active');
        btnDuo.classList.remove('active');
      }
    }
  }

  // --- Options Modal & HUD Setup ---
  function setupOptionsModal() {
    const modal = document.getElementById('options-modal');
    const btnOpen = document.getElementById('btn-open-options');
    const btnHudOpen = document.getElementById('hud-btn-options');
    const btnClose = document.getElementById('btn-close-options');
    const btnSave = document.getElementById('btn-save-options');

    const openModal = () => {
      window.soundManager.playClick();
      modal.classList.add('active');
    };
    const closeModal = () => {
      window.soundManager.playClick();
      modal.classList.remove('active');
    };

    btnOpen.addEventListener('click', openModal);
    btnHudOpen.addEventListener('click', openModal);
    btnClose.addEventListener('click', closeModal);
    btnSave.addEventListener('click', closeModal);

    // Control scheme radios
    const radios = document.querySelectorAll('input[name="control-mode"]');
    radios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        window.inputManager.setMode(e.target.value);
      });
    });

    // Volume Slider
    const volumeSlider = document.getElementById('volume-slider');
    const volumeText = document.getElementById('volume-val-text');
    volumeSlider.addEventListener('input', (e) => {
      const vol = parseInt(e.target.value, 10);
      volumeText.textContent = `${vol}%`;
      window.soundManager.setVolume(vol / 100);
    });

    // Screen Shake Toggle
    const toggleShake = document.getElementById('toggle-screenshake');
    toggleShake.addEventListener('change', (e) => {
      enableScreenShake = e.target.checked;
    });

    // Sound Mute Toggle Button
    const hudSoundBtn = document.getElementById('hud-btn-sound');
    hudSoundBtn.addEventListener('click', () => {
      const enabled = window.soundManager.toggleMute();
      hudSoundBtn.textContent = enabled ? '🔊' : '🔇';
    });
  }

  function setupHUDControls() {
    // Spectator View Mode Toggle (Map Overview vs Player Follow)
    const btnOverview = document.getElementById('btn-view-overview');
    const btnFollow = document.getElementById('btn-view-follow');

    if (btnOverview) {
      btnOverview.addEventListener('click', () => {
        window.soundManager.playClick();
        camera.mode = 'overview';
        btnOverview.classList.add('active');
        btnFollow.classList.remove('active');
        calcOverviewCamera();
      });
    }

    if (btnFollow) {
      btnFollow.addEventListener('click', () => {
        window.soundManager.playClick();
        camera.mode = 'follow';
        btnFollow.classList.add('active');
        btnOverview.classList.remove('active');
        camera.targetZoom = 1.0;
        updateZoomLevelText();
      });
    }

    // Spectator navigation buttons
    const btnPrev = document.getElementById('btn-spectate-prev');
    const btnNext = document.getElementById('btn-spectate-next');

    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        if (camera.mode === 'overview') {
          camera.mode = 'follow';
          if (btnFollow) btnFollow.classList.add('active');
          if (btnOverview) btnOverview.classList.remove('active');
          camera.targetZoom = 1.0;
          updateZoomLevelText();
        }
        cycleSpectateTarget(-1);
      });
    }

    if (btnNext) {
      btnNext.addEventListener('click', () => {
        if (camera.mode === 'overview') {
          camera.mode = 'follow';
          if (btnFollow) btnFollow.classList.add('active');
          if (btnOverview) btnOverview.classList.remove('active');
          camera.targetZoom = 1.0;
          updateZoomLevelText();
        }
        cycleSpectateTarget(1);
      });
    }

    // Zoom Buttons
    const btnZoomOut = document.getElementById('btn-zoom-out');
    const btnZoomIn = document.getElementById('btn-zoom-in');
    const btnZoomReset = document.getElementById('btn-zoom-reset');

    if (btnZoomOut) {
      btnZoomOut.addEventListener('click', () => {
        window.soundManager.playClick();
        camera.targetZoom = Math.max(0.18, camera.targetZoom * 0.8);
        updateZoomLevelText();
      });
    }

    if (btnZoomIn) {
      btnZoomIn.addEventListener('click', () => {
        window.soundManager.playClick();
        camera.targetZoom = Math.min(2.0, camera.targetZoom * 1.25);
        updateZoomLevelText();
      });
    }

    if (btnZoomReset) {
      btnZoomReset.addEventListener('click', () => {
        window.soundManager.playClick();
        camera.mode = 'overview';
        if (btnOverview) btnOverview.classList.add('active');
        if (btnFollow) btnFollow.classList.remove('active');
        calcOverviewCamera();
      });
    }

    // Mouse Wheel Zoom Listener (ONLY allowed when spectating!)
    if (window.inputManager) {
      window.inputManager.onWheelZoom = (deltaY) => {
        // Player is locked at 150% zoom; only spectators can zoom
        const isPlayingSelf = currentGameState && currentGameState.players.some(p => p.id === myPlayerId && p.alive && !p.isSpectator);
        if (isPlayingSelf) return; // Zoom is disabled for active living players

        if (deltaY > 0) {
          // Pull back / zoom out
          camera.targetZoom = Math.max(0.18, camera.targetZoom * 0.9);
        } else {
          // Zoom in
          camera.targetZoom = Math.min(2.0, camera.targetZoom * 1.1);
        }
        updateZoomLevelText();
      };
    }
  }

  function calcOverviewCamera() {
    if (!mapData) return;
    const mapPx = (mapData.gridSize || 64) * (mapData.tileSize || 36);
    camera.targetX = mapPx / 2;
    camera.targetY = mapPx / 2;
    // Fit entire 2304x2304 map into viewport with comfortable margin
    const padding = 70;
    const fitZoom = Math.min((canvas.width - padding) / mapPx, (canvas.height - padding) / mapPx);
    camera.targetZoom = Math.max(0.18, Math.min(1.0, fitZoom));
    updateZoomLevelText();
  }

  function updateZoomLevelText() {
    const textEl = document.getElementById('zoom-level-text');
    if (textEl) {
      textEl.textContent = `${Math.round(camera.targetZoom * 100)}%`;
    }
  }

  function cycleSpectateTarget(direction) {
    if (!currentGameState) return;
    const alivePlayers = currentGameState.players.filter(p => p.alive && !p.isSpectator);
    if (alivePlayers.length === 0) return;

    let idx = alivePlayers.findIndex(p => p.id === spectateTargetId);
    if (idx === -1) {
      idx = 0;
    } else {
      idx = (idx + direction + alivePlayers.length) % alivePlayers.length;
    }
    spectateTargetId = alivePlayers[idx].id;
    window.soundManager.playClick();
  }

  // --- UI Update from Game State ---
  let lastKnownState = 'LOBBY';

  function updateUIFromState(state) {
    const returnedToLobby = (lastKnownState !== 'LOBBY' && state.state === 'LOBBY');
    lastKnownState = state.state;
    roomState = state.state;

    // Relock phantom whenever room returns to lobby
    if (returnedToLobby) {
      lockPhantomTank();
    }

    // Screen switching
    const lobbyScreen = document.getElementById('lobby-screen');
    const gameHud = document.getElementById('game-hud');
    const resultScreen = document.getElementById('result-screen');

    if (roomState === 'LOBBY') {
      lobbyScreen.classList.add('active');
      gameHud.classList.remove('active');
      resultScreen.classList.remove('active');
      renderLobbySlots(state.players);
    } else if (roomState === 'STARTING' || roomState === 'PLAYING') {
      lobbyScreen.classList.remove('active');
      gameHud.classList.add('active');
      resultScreen.classList.remove('active');
      updateHUD(state);
    } else if (roomState === 'GAMEOVER') {
      lobbyScreen.classList.remove('active');
      gameHud.classList.add('active'); // keep HUD visible in background
      resultScreen.classList.add('active');
      renderScoreboard(state.scoreboard || []);
    }

    updateHostVisibility();
  }

  let lastLobbySlotsKey = '';

  function renderLobbySlots(players) {
    const container = document.getElementById('player-slots-container');
    if (!container) return;
    document.getElementById('player-count').textContent = players.length;

    // Dynamically update map badge based on participant count (11+ = 96x96)
    const mapBadge = document.getElementById('lobby-map-size-badge');
    if (mapBadge) {
      if (players.length >= 11) {
        mapBadge.textContent = '🗺️ MAP: 96x96 (大規模20人)';
        mapBadge.style.borderColor = '#eab308';
        mapBadge.style.color = '#facc15';
      } else {
        mapBadge.textContent = '🗺️ MAP: 64x64 (標準10人)';
        mapBadge.style.borderColor = 'var(--accent-cyan)';
        mapBadge.style.color = 'var(--accent-cyan)';
      }
    }

    // Sync bot count display with current number of bots
    const botDisplay = document.getElementById('current-bot-display');
    if (botDisplay) {
      const currentBots = players.filter(p => p.isBot).length;
      botDisplay.textContent = currentBots;
    }

    // Sync God Bot toggle button state (only visible when secret God Bot mode is active!)
    const btnToggleGod = document.getElementById('btn-toggle-god-bot');
    if (btnToggleGod) {
      if (currentGameState && currentGameState.godBotMode) {
        btnToggleGod.style.display = 'block';
        btnToggleGod.classList.add('active');
        btnToggleGod.innerHTML = '⚠️ 最強Bot稼働中 (解除)';
      } else {
        btnToggleGod.style.display = 'none';
        btnToggleGod.classList.remove('active');
      }
    }

    const myPlayer = players.find(p => p.id === myPlayerId);
    const hostActive = myPlayer ? myPlayer.isHost : isHost;

    // 1. Skip re-render if user currently has a select or input focused inside container
    if (document.activeElement && container.contains(document.activeElement) &&
        (document.activeElement.tagName === 'SELECT' || document.activeElement.tagName === 'INPUT')) {
      return;
    }

    // 2. Cache key check: avoid rebuilding DOM 30 times a second if slots didn't change
    const currentSlotsKey = JSON.stringify(players.map(p => ({
      slot: p.slot,
      id: p.id,
      name: p.name,
      team: p.team,
      tankType: p.tankType,
      isHost: p.isHost,
      isBot: p.isBot,
      isSpectator: p.isSpectator
    }))) + '|' + currentGameMode + '|' + (currentGameState?.godBotMode) + '|' + isPhantomUnlocked + '|' + hostActive + '|' + myPlayerId;

    if (currentSlotsKey === lastLobbySlotsKey) {
      return;
    }
    lastLobbySlotsKey = currentSlotsKey;

    let html = '';
    for (let slot = 0; slot < 20; slot++) {
      const p = players.find(x => x.slot === slot);
      if (p) {
        const isMe = p.id === myPlayerId;
        // Camouflage Phantom: to all other players, Phantom's name appears as Standard!
        const disguisedType = (p.tankType === 'phantom' && !isMe) ? 'standard' : p.tankType;
        const typeInfo = LOCAL_TANK_SPECS[disguisedType] || LOCAL_TANK_SPECS.standard;

        // Team Selector: Always configurable for host, and players can change their own team
        let teamHtml = '';
        const curTeam = p.team || (Math.floor(slot / 2) + 1);
        if (hostActive || isMe) {
          let options = '';
          for (let t = 1; t <= 10; t++) {
            const teamLabel = (t === 1) ? 'T1(青)' : ((t === 2) ? 'T2(赤)' : `T${t}`);
            options += `<option value="${t}" ${t === curTeam ? 'selected' : ''}>${teamLabel}</option>`;
          }
          teamHtml = `<select class="team-select" data-player-id="${p.id}" title="チーム変更 (自動でチーム戦になります)">${options}</select>`;
        } else {
          teamHtml = `<span class="team-badge team-${curTeam}">TEAM ${curTeam}</span>`;
        }

        // Bot Tank Type Selector (Host can change any bot's tank type directly!)
        let typeHtml = '';
        if (p.isBot && hostActive) {
          const types = [
            { id: 'standard', name: 'STD (万能)' },
            { id: 'assault', name: 'AST (突撃)' },
            { id: 'heavy', name: 'HVY (重装)' },
            { id: 'sniper', name: 'SNP (狙撃)' },
            { id: 'breaker', name: 'BRK (粉砕)' }
          ];
          if (isPhantomUnlocked) {
            types.push({ id: 'phantom', name: '⭐ 幻影 (SECRET)' });
          }
          let typeOpts = '';
          for (const tp of types) {
            typeOpts += `<option value="${tp.id}" ${tp.id === p.tankType ? 'selected' : ''}>${tp.name}</option>`;
          }
          typeHtml = `<select class="bot-tank-select" data-bot-id="${p.id}" title="Bot戦車タイプ変更">${typeOpts}</select>`;
        } else {
          typeHtml = `<span class="tag-badge tag-type" style="border-left: 3px solid ${typeInfo.color};">${typeInfo.name.split('.')[1] || p.tankType}</span>`;
        }

        const isGod = Boolean(p.isBot && currentGameState && currentGameState.godBotMode);

        html += `
          <div class="player-slot-item ${isMe ? 'is-me' : ''}">
            <div class="slot-left">
              <span class="slot-num">${slot + 1}</span>
              <span class="slot-name" title="${p.name}">${p.name} ${isMe ? '(YOU)' : ''}</span>
              ${teamHtml}
            </div>
            <div class="slot-tags">
              ${p.isHost ? '<span class="tag-badge tag-host">HOST</span>' : ''}
              ${p.isBot ? '<span class="tag-badge tag-bot">BOT</span>' : ''}
              ${isGod ? '<span class="tag-badge" style="border: 1px solid #ef4444; color: #f87171; background: rgba(239,68,68,0.2);">👹 GOD</span>' : ''}
              ${p.isSpectator ? '<span class="tag-badge tag-spec">SPEC</span>' : ''}
              ${typeHtml}
            </div>
          </div>
        `;
      } else {
        html += `
          <div class="player-slot-item empty">
            <div class="slot-left">
              <span class="slot-num">${slot + 1}</span>
              <span class="slot-name">待機中 (EMPTY)</span>
            </div>
          </div>
        `;
      }
    }
    container.innerHTML = html;

    // Attach team selector events (Host can change anyone, player can change self)
    const selects = container.querySelectorAll('.team-select');
    selects.forEach(sel => {
      sel.addEventListener('mousedown', (e) => e.stopPropagation());
      sel.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
      sel.addEventListener('change', (e) => {
        const targetId = sel.getAttribute('data-player-id');
        const newTeam = parseInt(e.target.value, 10);
        // If mode was SOLO, automatically switch to DUO for team battle
        if (currentGameMode !== 'DUO') {
          currentGameMode = 'DUO';
          sendPacket('set_game_mode', { mode: 'DUO' });
        }
        sendPacket('set_player_team', { id: targetId, team: newTeam });
        // Optimistically update
        const p = players.find(x => x.id === targetId);
        if (p) p.team = newTeam;
      });
    });

    // Attach bot tank type selector events (Host only)
    if (hostActive) {
      const botTypeSelects = container.querySelectorAll('.bot-tank-select');
      botTypeSelects.forEach(sel => {
        sel.addEventListener('mousedown', (e) => e.stopPropagation());
        sel.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
        sel.addEventListener('change', (e) => {
          const targetId = sel.getAttribute('data-bot-id');
          const newType = e.target.value;
          sendPacket('set_bot_tank_type', { id: targetId, tankType: newType });
          // Optimistically update
          const p = players.find(x => x.id === targetId);
          if (p) p.tankType = newType;
        });
      });
    }
  }

  function updateHUD(state) {
    // 1. Timer: 05:00 format
    const totalSec = Math.max(0, state.timeRemaining);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    document.getElementById('match-timer-text').textContent =
      `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

    // 2. Survivor Count
    const aliveCount = state.players.filter(p => p.alive && !p.isSpectator).length;
    const totalParticipants = state.players.filter(p => !p.isSpectator).length;
    document.getElementById('survivors-count-text').textContent =
      `ALIVE: ${aliveCount} / ${totalParticipants}`;

    // 3. My Player Info
    const myPlayer = state.players.find(p => p.id === myPlayerId);
    const spectatorBar = document.getElementById('spectator-bar');

    if (myPlayer && myPlayer.alive && !myPlayer.isSpectator) {
      spectatorBar.style.display = 'none';
      document.getElementById('my-tank-hud').style.display = 'block';

      document.getElementById('hud-player-name').textContent = myPlayer.name;
      document.getElementById('hud-kills').textContent = `${myPlayer.kills} KILLS`;

      const typeSpec = LOCAL_TANK_SPECS[myPlayer.tankType] || LOCAL_TANK_SPECS.standard;
      const iconEl = document.getElementById('hud-type-icon');
      iconEl.textContent = (myPlayer.tankType || 'STD').substring(0, 3).toUpperCase();
      iconEl.style.backgroundColor = typeSpec.color;

      const hpPct = Math.max(0, Math.min(100, (myPlayer.hp / myPlayer.maxHp) * 100));
      document.getElementById('hud-hp-bar').style.width = `${hpPct}%`;
      document.getElementById('hud-hp-text').textContent = `${myPlayer.hp} / ${myPlayer.maxHp}`;
    } else {
      // Spectating Mode (Dead or Host Spectator)
      spectatorBar.style.display = 'flex';
      document.getElementById('my-tank-hud').style.display = 'none';

      // Pick target to spectate
      const alivePlayers = state.players.filter(p => p.alive && !p.isSpectator);
      if (!alivePlayers.some(p => p.id === spectateTargetId)) {
        spectateTargetId = alivePlayers.length > 0 ? alivePlayers[0].id : null;
      }

      const target = state.players.find(p => p.id === spectateTargetId);
      document.getElementById('spectate-target-name').textContent = target ? target.name : 'None';

      // If in overview mode, ensure target coordinates stay at map center
      if (camera.mode === 'overview' && mapData) {
        const mapPx = (mapData.gridSize || 64) * (mapData.tileSize || 36);
        camera.targetX = mapPx / 2;
        camera.targetY = mapPx / 2;
      }
    }

    // 4. Starting Countdown Announcement
    const annOverlay = document.getElementById('announcement-overlay');
    const annTitle = document.getElementById('announcement-title');

    if (state.state === 'STARTING') {
      annOverlay.style.display = 'block';
      const c = state.countdown;
      annTitle.textContent = c > 0 ? c : 'BATTLE START!';
      annTitle.style.color = c > 0 ? '#f59e0b' : '#22c55e';
    } else {
      annOverlay.style.display = 'none';
    }
  }

  function renderScoreboard(scoreboard) {
    const tbody = document.getElementById('scoreboard-body');
    const winnerNameEl = document.getElementById('winner-name-text');

    if (scoreboard.length > 0) {
      if (currentGameMode === 'DUO' && scoreboard[0].team) {
        winnerNameEl.textContent = `TEAM ${scoreboard[0].team} (${scoreboard[0].name})`;
      } else {
        winnerNameEl.textContent = scoreboard[0].name;
      }
    }

    let rowsHtml = '';
    scoreboard.forEach(item => {
      const rankClass = item.rank === 1 ? 'rank-1' : (item.rank === 2 ? 'rank-2' : (item.rank === 3 ? 'rank-3' : 'rank-other'));
      const statusClass = item.isWinner ? 'status-winner' : (item.status.includes('SURVIVED') ? 'status-survived' : 'status-eliminated');
      const isMe = (item.id === myPlayerId);
      // Camouflage Phantom: to all other players, Phantom's name appears as Standard!
      const disguisedType = (item.tankType === 'phantom' && !isMe) ? 'standard' : item.tankType;
      const typeInfo = LOCAL_TANK_SPECS[disguisedType] || LOCAL_TANK_SPECS.standard;
      const teamTag = (currentGameMode === 'DUO' && item.team) ? `<span class="team-badge team-${item.team}">T${item.team}</span> ` : '';

      rowsHtml += `
        <tr>
          <td><span class="rank-badge ${rankClass}">${item.rank}</span></td>
          <td style="font-weight: 700; color: #fff;">${teamTag}${item.name} ${isMe ? '<b style="color: #38bdf8;">(YOU)</b>' : ''}</td>
          <td><span style="color: ${typeInfo.color}; font-weight: 700;">${typeInfo.name}</span></td>
          <td style="font-family: var(--font-display); font-weight: 700;">${item.kills}</td>
          <td style="font-family: var(--font-display);">${item.survivedTime}s</td>
          <td><span class="status-badge ${statusClass}">${item.status}</span></td>
        </tr>
      `;
    });

    tbody.innerHTML = rowsHtml;
  }

  // --- Spatial Audio: Audible radius = Sniper range (1200) + 100px = 1300px centered on player ---
  const SNIPER_BULLET_RANGE = 1200;
  const AUDIBLE_RADIUS = SNIPER_BULLET_RANGE + 100; // 1300px

  function getAudioListenerPos() {
    if (!currentGameState || !currentGameState.players) return null;
    const myPlayer = currentGameState.players.find(p => p.id === myPlayerId);
    if (myPlayer && myPlayer.alive && !myPlayer.isSpectator) {
      return { x: myPlayer.x, y: myPlayer.y };
    }
    // Spectating: follow the spectated tank if alive
    if (spectateTargetId) {
      const target = currentGameState.players.find(p => p.id === spectateTargetId);
      if (target && target.alive) {
        return { x: target.x, y: target.y };
      }
    }
    // Fallback: camera center
    if (camera) {
      return { x: camera.x, y: camera.y };
    }
    return null;
  }

  function getSpatialAudioParams(x, y) {
    if (typeof x !== 'number' || typeof y !== 'number') {
      return { inRange: true, vol: 1.0, pan: 0 };
    }

    const listener = getAudioListenerPos();
    if (!listener) {
      return { inRange: true, vol: 1.0, pan: 0 };
    }

    const dx = x - listener.x;
    const dy = y - listener.y;
    const dist = Math.hypot(dx, dy);

    // Strictly inaudible outside Sniper range + 100px
    if (dist > AUDIBLE_RADIUS) {
      return { inRange: false, vol: 0, pan: 0 };
    }

    // Distance-based attenuation within the 1300px bubble (1.0 at center down to 0.12 at perimeter)
    const normDist = dist / AUDIBLE_RADIUS;
    const vol = Math.max(0.12, 1.0 - Math.pow(normDist, 1.15) * 0.88);

    // Stereo panning (left/right ear positioning)
    const pan = Math.max(-0.85, Math.min(0.85, dx / (AUDIBLE_RADIUS * 0.75)));

    return { inRange: true, vol, pan };
  }

  // --- Process Server Instant Events ---
  function processEvents(events) {
    for (const ev of events) {
      switch (ev.type) {
        case 'bullet_fired': {
          const audio = getSpatialAudioParams(ev.x, ev.y);
          if (audio.inRange) {
            window.soundManager.playShoot(ev.tankType, audio.vol, audio.pan);
          }
          spawnMuzzleParticles(ev.x, ev.y, ev.angle, ev.tankType);
          break;
        }

        case 'wall_hit': {
          const audio = getSpatialAudioParams(ev.x, ev.y);
          if (audio.inRange) {
            window.soundManager.playWallHit(audio.vol, audio.pan);
          }
          spawnSparks(ev.x, ev.y, 4, '#cbd5e1');
          break;
        }

        case 'wall_destroyed': {
          const audio = getSpatialAudioParams(ev.x, ev.y);
          if (audio.inRange) {
            window.soundManager.playWallBreak(audio.vol, audio.pan);
            triggerScreenShake(4 * audio.vol, 0.2);
          }
          spawnWallDebris(ev.x, ev.y);
          if (mapData && mapData.tiles) {
            mapData.tiles[ev.gridY][ev.gridX] = 0;
          }
          break;
        }

        case 'tank_hit': {
          const audio = getSpatialAudioParams(ev.x, ev.y);
          if (audio.inRange) {
            window.soundManager.playHit(audio.vol, audio.pan);
          }
          spawnSparks(ev.x, ev.y, 8, '#f59e0b');
          if (ev.victimId === myPlayerId) {
            triggerScreenShake(7, 0.25);
          }
          break;
        }

        case 'tank_destroyed': {
          const audio = getSpatialAudioParams(ev.x, ev.y);
          if (audio.inRange) {
            window.soundManager.playExplosion(audio.vol, audio.pan);
            triggerScreenShake(14 * audio.vol, 0.5);
          }
          spawnExplosion(ev.x, ev.y);
          addKillFeed(ev.killerName, ev.victimName);
          break;
        }

        case 'countdown_start':
          window.soundManager.playBeep(false);
          break;

        case 'match_start':
          window.soundManager.playBeep(true);
          break;

        case 'god_bot_toggle':
          if (ev.enabled) {
            showSecretBanner('⚠️ GOD BOT PROTOCOL!', '最強ボット軍団が起動した！(超エイム＆全ステータス強化)', '👹', true);
            triggerScreenShake(12, 0.4);
          } else {
            showSecretBanner('ℹ️ GOD BOT DEACTIVATED', 'ボットの最強モードを解除しました（通常化）', '🤖');
          }
          break;

        case 'toast':
          showSecretBanner('STATUS UPDATE', ev.message || '', '🛡️');
          break;

        case 'game_over':
          window.soundManager.playVictory();
          break;

        default:
          break;
      }
    }
  }

  function addKillFeed(killer, victim) {
    const feed = document.getElementById('kill-feed');
    const item = document.createElement('div');
    item.className = 'kill-feed-item';
    item.innerHTML = `💥 <b style="color: #38bdf8;">${killer}</b> eliminated <b style="color: #f87171;">${victim}</b>`;
    feed.appendChild(item);

    setTimeout(() => {
      if (item.parentNode) item.parentNode.removeChild(item);
    }, 4500);
  }

  function triggerScreenShake(intensity, duration) {
    if (!enableScreenShake) return;
    screenShake.intensity = Math.max(screenShake.intensity, intensity);
    screenShake.duration = Math.max(screenShake.duration, duration);
  }

  // --- Particles & VFX System ---
  function spawnMuzzleParticles(x, y, angle, type) {
    for (let i = 0; i < 6; i++) {
      const spread = (Math.random() - 0.5) * 0.5;
      const speed = 80 + Math.random() * 120;
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle + spread) * speed,
        vy: Math.sin(angle + spread) * speed,
        size: 3 + Math.random() * 4,
        color: '#ffedd5',
        life: 0.15,
        maxLife: 0.15
      });
    }
  }

  function spawnSparks(x, y, count = 6, color = '#f59e0b') {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 140;
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2 + Math.random() * 3,
        color: color,
        life: 0.2 + Math.random() * 0.15,
        maxLife: 0.35
      });
    }
  }

  function spawnWallDebris(x, y) {
    for (let i = 0; i < 16; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 160;
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 3 + Math.random() * 6,
        color: Math.random() > 0.5 ? '#b45309' : '#d97706',
        life: 0.6 + Math.random() * 0.4,
        maxLife: 1.0
      });
    }
  }

  function spawnExplosion(x, y) {
    // Fireball & smoke particles
    for (let i = 0; i < 35; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 30 + Math.random() * 220;
      const colors = ['#f87171', '#fbbf24', '#f97316', '#64748b'];
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 5 + Math.random() * 12,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 0.5 + Math.random() * 0.5,
        maxLife: 1.0
      });
    }
  }

  function addSkidmark(x, y, angle) {
    skidmarks.push({ x, y, angle, alpha: 0.4 });
    if (skidmarks.length > 300) skidmarks.shift();
  }

  // --- Main Game Loop ---
  let lastTime = performance.now();

  function gameLoop(time) {
    const dt = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;

    // 1. Process Input & Send to Server
    handleInput(dt);

    // 2. Update Camera & Screen Shake
    updateCamera(dt);

    // 3. Update Particles
    updateParticles(dt);

    // 4. Render Everything
    render();

    // 5. Render Minimap
    renderMinimap();

    requestAnimationFrame(gameLoop);
  }

  function handleInput(dt) {
    if (!currentGameState || roomState !== 'PLAYING') return;

    const myPlayer = currentGameState.players.find(p => p.id === myPlayerId);
    if (!myPlayer || !myPlayer.alive || myPlayer.isSpectator) return;

    const inputData = window.inputManager.update(dt, myPlayer, camera);
    sendPacket('input', inputData);
  }

  function updateCamera(dt) {
    let focusTarget = null;
    const isPlayingSelf = currentGameState && currentGameState.players.some(p => p.id === myPlayerId && p.alive && !p.isSpectator);

    if (isPlayingSelf) {
      // In-Game Self Control -> follow own tank with expanded field of view (1.5x wider screen area)
      const myPlayer = currentGameState.players.find(p => p.id === myPlayerId);
      if (myPlayer) {
        camera.targetX = myPlayer.x;
        camera.targetY = myPlayer.y;
        camera.targetZoom = 1.0; // 1.5x wider viewport (zoomed out from 1.5 to 1.0)
      }
    } else {
      // Spectating Mode
      if (camera.mode === 'overview') {
        // Map Overview (Center camera on entire 64x64 arena)
        if (mapData) {
          const mapPx = (mapData.gridSize || 64) * (mapData.tileSize || 36);
          camera.targetX = mapPx / 2;
          camera.targetY = mapPx / 2;
        }
      } else {
        // Follow Spectated Alive Target
        if (spectateTargetId && currentGameState) {
          focusTarget = currentGameState.players.find(p => p.id === spectateTargetId && p.alive);
          if (focusTarget) {
            camera.targetX = focusTarget.x;
            camera.targetY = focusTarget.y;
          }
        }
      }
    }

    // Smooth camera position interpolation
    camera.x += (camera.targetX - camera.x) * Math.min(8 * dt, 1);
    camera.y += (camera.targetY - camera.y) * Math.min(8 * dt, 1);

    // Smooth camera zoom interpolation
    camera.zoom += (camera.targetZoom - camera.zoom) * Math.min(10 * dt, 1);

    // Screen Shake
    if (screenShake.duration > 0) {
      screenShake.duration -= dt;
      if (screenShake.duration <= 0) screenShake.intensity = 0;
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  // --- Rendering ---
  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();

    // Apply Screen Shake
    let shakeX = 0;
    let shakeY = 0;
    if (screenShake.duration > 0) {
      shakeX = (Math.random() - 0.5) * screenShake.intensity;
      shakeY = (Math.random() - 0.5) * screenShake.intensity;
    }

    // Camera Transformation: Center on camera position with scale
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    ctx.translate(cx + shakeX, cy + shakeY);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    // 1. Draw Map (Floor & Walls)
    drawMap();

    // 2. Draw Skidmarks
    drawSkidmarks();

    // 3. Draw Player Aim & Bullet Range Guide Line (向いてる方向＆射程の表示)
    drawAimAndRangeGuide();

    // 4. Draw Sniper Laser Sights
    drawLaserSights();

    // 5. Draw Bullets
    drawBullets();

    // 6. Draw Tanks
    drawTanks();

    // 7. Draw Particles
    drawParticles();

    ctx.restore();
  }

  function drawMap() {
    if (!mapData || !mapData.tiles) return;

    const tileSize = mapData.tileSize || 36;
    const gridSize = mapData.gridSize || 64;
    const mapPx = gridSize * tileSize;

    // Map Ground
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, mapPx, mapPx);

    // Outer Void Background when zoomed out
    if (camera.zoom < 0.9) {
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = 4;
      ctx.strokeRect(-2, -2, mapPx + 4, mapPx + 4);
      ctx.restore();
    }

    // Cyber Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= mapPx; x += tileSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, mapPx);
      ctx.stroke();
    }
    for (let y = 0; y <= mapPx; y += tileSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(mapPx, y);
      ctx.stroke();
    }

    // View Frustum Culling (considering camera zoom)
    const halfViewW = (canvas.width / 2) / camera.zoom;
    const halfViewH = (canvas.height / 2) / camera.zoom;
    const startGX = Math.max(0, Math.floor((camera.x - halfViewW) / tileSize) - 1);
    const endGX = Math.min(gridSize - 1, Math.ceil((camera.x + halfViewW) / tileSize) + 1);
    const startGY = Math.max(0, Math.floor((camera.y - halfViewH) / tileSize) - 1);
    const endGY = Math.min(gridSize - 1, Math.ceil((camera.y + halfViewH) / tileSize) + 1);

    for (let gy = startGY; gy <= endGY; gy++) {
      for (let gx = startGX; gx <= endGX; gx++) {
        const tile = mapData.tiles[gy][gx];
        const px = gx * tileSize;
        const py = gy * tileSize;

        if (tile === 1) {
          // Indestructible Steel Wall
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(px, py, tileSize, tileSize);

          ctx.strokeStyle = '#475569';
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 1, py + 1, tileSize - 2, tileSize - 2);

          // Diagonal steel cross
          ctx.strokeStyle = 'rgba(71, 85, 105, 0.4)';
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + tileSize, py + tileSize);
          ctx.moveTo(px + tileSize, py);
          ctx.lineTo(px, py + tileSize);
          ctx.stroke();
        } else if (tile === 2) {
          // Destructible Brick Wall
          ctx.fillStyle = '#7c2d12';
          ctx.fillRect(px, py, tileSize, tileSize);

          ctx.strokeStyle = '#b45309';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(px + 1, py + 1, tileSize - 2, tileSize - 2);

          // Brick lines pattern
          ctx.strokeStyle = '#451a03';
          ctx.beginPath();
          ctx.moveTo(px, py + tileSize / 2);
          ctx.lineTo(px + tileSize, py + tileSize / 2);
          ctx.moveTo(px + tileSize / 2, py);
          ctx.lineTo(px + tileSize / 2, py + tileSize / 2);
          ctx.stroke();

          // Damage cracks if damaged
          if (mapData.wallHp && mapData.wallHp[gy][gx] < 50) {
            ctx.strokeStyle = 'rgba(254, 215, 170, 0.7)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(px + tileSize * 0.2, py + tileSize * 0.2);
            ctx.lineTo(px + tileSize * 0.5, py + tileSize * 0.6);
            ctx.lineTo(px + tileSize * 0.8, py + tileSize * 0.3);
            ctx.stroke();
          }
        }
      }
    }
  }

  function drawSkidmarks() {
    for (const sm of skidmarks) {
      ctx.save();
      ctx.translate(sm.x, sm.y);
      ctx.rotate(sm.angle);
      ctx.fillStyle = `rgba(0, 0, 0, ${sm.alpha})`;
      ctx.fillRect(-6, -10, 4, 20);
      ctx.fillRect(2, -10, 4, 20);
      ctx.restore();
    }
  }

  // Draw Aiming Direction & Max Bullet Range Guide Line for Local Player
  function drawAimAndRangeGuide() {
    if (!currentGameState || !mapData) return;
    const myPlayer = currentGameState.players.find(p => p.id === myPlayerId);
    if (!myPlayer || !myPlayer.alive || myPlayer.isSpectator) return;

    const spec = LOCAL_TANK_SPECS[myPlayer.tankType] || LOCAL_TANK_SPECS.standard;
    const angle = myPlayer.turretAngle;

    // Bullet range mapping per tank type
    const rangeMap = {
      standard: 600,
      assault: 420,
      heavy: 650,
      sniper: 1200,
      breaker: 550
    };
    const maxRange = rangeMap[myPlayer.tankType] || 600;

    const barrelLen = myPlayer.tankType === 'sniper' ? 28 : (myPlayer.tankType === 'heavy' ? 24 : 18);
    const startX = myPlayer.x + Math.cos(angle) * barrelLen;
    const startY = myPlayer.y + Math.sin(angle) * barrelLen;

    // Raycast step to find any blocking wall
    let hitDist = maxRange;
    let hitObstacle = false;
    const step = 6;

    for (let d = 0; d < maxRange; d += step) {
      const testX = startX + Math.cos(angle) * d;
      const testY = startY + Math.sin(angle) * d;
      const gx = Math.floor(testX / mapData.tileSize);
      const gy = Math.floor(testY / mapData.tileSize);

      if (gx < 0 || gy < 0 || gx >= mapData.gridSize || gy >= mapData.gridSize) {
        hitDist = d;
        hitObstacle = true;
        break;
      }

      const tile = mapData.tiles[gy][gx];
      if (tile === 1 || tile === 2) {
        hitDist = d;
        hitObstacle = true;
        break;
      }
    }

    const endX = startX + Math.cos(angle) * hitDist;
    const endY = startY + Math.sin(angle) * hitDist;

    ctx.save();

    // 1. Aiming Laser / Dash Line
    ctx.strokeStyle = spec.color;
    ctx.shadowColor = spec.color;
    ctx.shadowBlur = 8;
    ctx.lineWidth = 2.2;
    ctx.setLineDash([12, 6]);

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    ctx.setLineDash([]); // Reset dash

    // 2. Obstacle Impact or Free Range Reticle
    if (hitObstacle) {
      // Wall collision point: glowing red indicator with mini-X
      ctx.fillStyle = '#ef4444';
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(endX, endY, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      const xs = 3.5;
      ctx.beginPath();
      ctx.moveTo(endX - xs, endY - xs);
      ctx.lineTo(endX + xs, endY + xs);
      ctx.moveTo(endX + xs, endY - xs);
      ctx.lineTo(endX - xs, endY + xs);
      ctx.stroke();
    } else {
      // Maximum Range Target Reticle (Circle + Crosshair)
      ctx.fillStyle = spec.color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.arc(endX, endY, 7, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(endX, endY, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Crosshair tick marks
      const cLen = 10;
      ctx.beginPath();
      ctx.moveTo(endX - cLen, endY);
      ctx.lineTo(endX - 3, endY);
      ctx.moveTo(endX + 3, endY);
      ctx.lineTo(endX + cLen, endY);
      ctx.moveTo(endX, endY - cLen);
      ctx.lineTo(endX, endY - 3);
      ctx.moveTo(endX, endY + 3);
      ctx.lineTo(endX, endY + cLen);
      ctx.stroke();

      // Range Boundary Arc: Shows maximum effective firing boundary
      ctx.strokeStyle = spec.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.arc(myPlayer.x, myPlayer.y, maxRange, angle - 0.22, angle + 0.22);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 3. Distance & Target Angle Tag
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 4;
    const tagDist = Math.max(30, hitDist - 22);
    const tagX = startX + Math.cos(angle) * tagDist;
    const tagY = startY + Math.sin(angle) * tagDist - 8;
    ctx.fillText(`${Math.round(hitDist)}px`, tagX, tagY);

    ctx.restore();
  }

  // Draw Sniper & Phantom Laser Sight
  function drawLaserSights() {
    if (!currentGameState || !mapData) return;

    for (const p of currentGameState.players) {
      if (!p.alive || p.isSpectator || (p.tankType !== 'sniper' && p.tankType !== 'phantom')) continue;

      const isPhantom = (p.tankType === 'phantom');
      const angle = p.turretAngle;
      const startX = p.x + Math.cos(angle) * (isPhantom ? 22 : 26);
      const startY = p.y + Math.sin(angle) * (isPhantom ? 22 : 26);

      // Raycast to find wall obstacle
      const maxRayDist = isPhantom ? 850 : 1200;
      let hitDist = maxRayDist;
      const step = 8;
      for (let d = 0; d < maxRayDist; d += step) {
        const testX = startX + Math.cos(angle) * d;
        const testY = startY + Math.sin(angle) * d;
        const gx = Math.floor(testX / mapData.tileSize);
        const gy = Math.floor(testY / mapData.tileSize);

        if (gx < 0 || gy < 0 || gx >= mapData.gridSize || gy >= mapData.gridSize) {
          hitDist = d;
          break;
        }

        const tile = mapData.tiles[gy][gx];
        if (tile === 1 || tile === 2) {
          hitDist = d;
          break;
        }
      }

      const endX = startX + Math.cos(angle) * hitDist;
      const endY = startY + Math.sin(angle) * hitDist;

      // Draw glowing laser line
      ctx.save();
      ctx.strokeStyle = isPhantom ? 'rgba(245, 158, 11, 0.75)' : 'rgba(239, 68, 68, 0.7)';
      ctx.lineWidth = isPhantom ? 1.8 : 1.5;
      ctx.setLineDash(isPhantom ? [4, 4] : [8, 4]);
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      // Dot at laser end
      ctx.fillStyle = isPhantom ? '#f59e0b' : '#ef4444';
      ctx.beginPath();
      ctx.arc(endX, endY, isPhantom ? 3.5 : 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawBullets() {
    if (!currentGameState || !currentGameState.bullets) return;

    // Enhance bullet visibility when zoomed out
    const zoomScale = camera.zoom < 0.7 ? Math.max(1, 0.7 / camera.zoom) : 1;

    for (const b of currentGameState.bullets) {
      ctx.save();
      const spec = LOCAL_TANK_SPECS[b.tankType] || LOCAL_TANK_SPECS.standard;

      ctx.fillStyle = spec.color;
      ctx.shadowColor = spec.color;
      ctx.shadowBlur = camera.zoom < 0.6 ? 14 : 10;

      const r = b.radius * zoomScale;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();

      // Bright inner core
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(b.x, b.y, r * 0.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  function drawTanks() {
    if (!currentGameState || !currentGameState.players) return;

    const isZoomedOut = camera.zoom < 0.65;
    const textScale = isZoomedOut ? Math.min(2.0, 0.85 / camera.zoom) : 1.0;

    for (const p of currentGameState.players) {
      if (!p.alive || p.isSpectator) continue;

      ctx.save();
      ctx.translate(p.x, p.y);

      const spec = LOCAL_TANK_SPECS[p.tankType] || LOCAL_TANK_SPECS.standard;
      const isMe = p.id === myPlayerId;
      const isSpectated = p.id === spectateTargetId;

      // --- Beacon highlight when zoomed out in overview mode ---
      if (isZoomedOut) {
        ctx.save();
        ctx.strokeStyle = isMe ? '#38bdf8' : (isSpectated ? '#a855f7' : spec.color);
        ctx.lineWidth = isSpectated ? 3 : 2;
        ctx.beginPath();
        ctx.arc(0, 0, 26, 0, Math.PI * 2);
        ctx.stroke();

        // Target brackets for spectated target
        if (isSpectated) {
          ctx.strokeStyle = '#c084fc';
          ctx.lineWidth = 2.5;
          const s = 32;
          ctx.strokeRect(-s/2, -s/2, s, s);
        }
        ctx.restore();
      }

      const isGodBot = Boolean(p.isBot && currentGameState && currentGameState.godBotMode);
      const isPhantom = (p.tankType === 'phantom');
      const isKolibri = Boolean(p.isKolibri || (p.tankType === 'standard' && (p.name || '').trim().toLowerCase() === 'kolibri'));

      // --- 0. God Bot Demonic Red Aura or Phantom Cyber Aura or Kolibri Sparkle Aura ---
      if (isGodBot) {
        ctx.save();
        ctx.strokeStyle = '#ef4444';
        ctx.shadowColor = '#ef4444';
        ctx.shadowBlur = 15;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 3]);
        ctx.beginPath();
        ctx.arc(0, 0, 24 + Math.sin(performance.now() * 0.008) * 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (isPhantom) {
        ctx.save();
        ctx.strokeStyle = '#f59e0b';
        ctx.shadowColor = '#f59e0b';
        ctx.shadowBlur = 12;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(0, 0, 22 + Math.sin(performance.now() * 0.005) * 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (isKolibri) {
        ctx.save();
        ctx.strokeStyle = '#38bdf8';
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 8;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.arc(0, 0, 11 + Math.sin(performance.now() * 0.015) * 1.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // --- 1. Tank Hull & Tracks (Rotates with bodyAngle, scaled 0.5 for Kolibri) ---
      ctx.save();
      if (isKolibri) {
        ctx.scale(0.5, 0.5);
      }
      ctx.rotate(p.bodyAngle);

      // Left & Right Tracks
      ctx.fillStyle = isGodBot ? '#450a0a' : '#1e293b';
      ctx.fillRect(-17, -15, 34, 7);
      ctx.fillRect(-17, 8, 34, 7);

      // Track tread lines
      ctx.strokeStyle = isGodBot ? '#991b1b' : '#0f172a';
      ctx.lineWidth = 1.5;
      for (let tx = -15; tx <= 15; tx += 6) {
        ctx.beginPath();
        ctx.moveTo(tx, -15);
        ctx.lineTo(tx, -8);
        ctx.moveTo(tx, 8);
        ctx.lineTo(tx, 15);
        ctx.stroke();
      }

      // Main Tank Body
      ctx.fillStyle = isGodBot ? '#dc2626' : (isPhantom ? '#d97706' : spec.color);
      ctx.beginPath();
      ctx.roundRect(-14, -10, 28, 20, 4);
      ctx.fill();

      // Armor plating highlights
      ctx.strokeStyle = isPhantom ? '#fef08a' : (isGodBot ? '#fca5a5' : 'rgba(0, 0, 0, 0.4)');
      ctx.lineWidth = isPhantom ? 1.5 : 2;
      ctx.stroke();

      ctx.restore();

      // --- 2. Turret & Barrel (Rotates with turretAngle, scaled 0.5 for Kolibri) ---
      ctx.save();
      if (isKolibri) {
        ctx.scale(0.5, 0.5);
      }
      ctx.rotate(p.turretAngle);

      if (isPhantom) {
        // Dual Barrels for Phantom
        const bLen = 22;
        const bWidth = 4;
        const bOffset = 4.5;
        ctx.fillStyle = '#f59e0b';
        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 1;

        [-1, 1].forEach(side => {
          const by = side * bOffset - bWidth / 2;
          ctx.fillRect(0, by, bLen, bWidth);
          ctx.strokeRect(0, by, bLen, bWidth);
          // Muzzle tip
          ctx.fillStyle = '#fef08a';
          ctx.fillRect(bLen - 2, by - 0.5, 3, bWidth + 1);
        });

        // Phantom Turret Dome
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.arc(0, 0, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      } else {
        // Single Barrel
        const barrelLen = p.tankType === 'sniper' ? 28 : (p.tankType === 'heavy' ? 24 : 18);
        const barrelWidth = p.tankType === 'heavy' ? 7 : (p.tankType === 'assault' ? 4 : 5);

        ctx.fillStyle = isGodBot ? '#7f1d1d' : '#334155';
        ctx.fillRect(0, -barrelWidth / 2, barrelLen, barrelWidth);
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, -barrelWidth / 2, barrelLen, barrelWidth);

        // Muzzle brake
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(barrelLen - 3, -barrelWidth / 2 - 1.5, 4, barrelWidth + 3);

        // Turret Dome
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.arc(0, 0, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = isGodBot ? '#ef4444' : spec.color;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      ctx.restore();

      // --- 3. Overhead Name, Team Badge & HP Bar (Always Facing Up) ---
      ctx.save();
      if (textScale > 1.0) {
        ctx.scale(textScale, textScale);
      }

      const myP = currentGameState.players.find(x => x.id === myPlayerId);
      const isAlly = (currentGameMode === 'DUO' && myP && p.team === myP.team && !isMe);
      const yOffset = isKolibri ? 10 : 0; // Bring overhead items closer to mini tank

      // Ally indicator circle
      if (isAlly) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(0, 0, 22, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Team badge in DUO mode
      if (currentGameMode === 'DUO' && p.team) {
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = isAlly ? '#38bdf8' : (isMe ? '#4ade80' : '#f87171');
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 4;
        ctx.fillText(`[TEAM ${p.team}]${isAlly ? ' (味方)' : ''}`, 0, -38 + yOffset);
      }

      // Player Name
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = isMe ? '#38bdf8' : (isAlly ? '#7dd3fc' : '#ffffff');
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 4;
      ctx.fillText(p.name, 0, -26 + yOffset);

      // HP Bar
      const barW = isKolibri ? 24 : 36;
      const barH = 5;
      const hpPct = Math.max(0, Math.min(1, p.hp / p.maxHp));

      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(-barW / 2, -22 + yOffset, barW, barH);

      ctx.fillStyle = hpPct > 0.5 ? '#22c55e' : (hpPct > 0.25 ? '#eab308' : '#ef4444');
      ctx.fillRect(-barW / 2, -22 + yOffset, barW * hpPct, barH);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(-barW / 2, -22 + yOffset, barW, barH);

      ctx.restore();

      ctx.restore();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.save();
      const alpha = p.life / p.maxLife;
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // --- Minimap Radar ---
  function renderMinimap() {
    if (!minimapCtx || !mapData || !currentGameState) return;

    const w = minimapCanvas.width;
    const h = minimapCanvas.height;
    minimapCtx.clearRect(0, 0, w, h);

    const mapPx = (mapData.gridSize || 64) * (mapData.tileSize || 36);
    const scaleX = w / mapPx;
    const scaleY = h / mapPx;

    // Draw Map Walls on Minimap
    for (let gy = 0; gy < mapData.gridSize; gy++) {
      for (let gx = 0; gx < mapData.gridSize; gx++) {
        const tile = mapData.tiles[gy][gx];
        if (tile === 1) {
          minimapCtx.fillStyle = '#475569';
          minimapCtx.fillRect(gx * mapData.tileSize * scaleX, gy * mapData.tileSize * scaleY, 2.5, 2.5);
        } else if (tile === 2) {
          minimapCtx.fillStyle = '#92400e';
          minimapCtx.fillRect(gx * mapData.tileSize * scaleX, gy * mapData.tileSize * scaleY, 2.5, 2.5);
        }
      }
    }

    // Draw Tanks on Minimap
    for (const p of currentGameState.players) {
      if (!p.alive || p.isSpectator) continue;

      const mx = p.x * scaleX;
      const my = p.y * scaleY;
      const isMe = p.id === myPlayerId;

      minimapCtx.fillStyle = isMe ? '#38bdf8' : '#ef4444';
      minimapCtx.beginPath();
      minimapCtx.arc(mx, my, isMe ? 4 : 2.5, 0, Math.PI * 2);
      minimapCtx.fill();

      if (isMe) {
        minimapCtx.strokeStyle = '#ffffff';
        minimapCtx.lineWidth = 1;
        minimapCtx.stroke();
      }
    }

    // Viewport box on minimap
    const vW = canvas.width * scaleX;
    const vH = canvas.height * scaleY;
    const vx = (camera.x - canvas.width / 2) * scaleX;
    const vy = (camera.y - canvas.height / 2) * scaleY;

    minimapCtx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
    minimapCtx.lineWidth = 1;
    minimapCtx.strokeRect(vx, vy, vW, vH);
  }

  // --- Run on Load ---
  window.addEventListener('DOMContentLoaded', init);
})();
