// TANK-10: Multi-Device Input Handler
// Supports 3 control schemes per spec:
// 1. PC: Mouse + Keyboard (Default recommended)
// 2. PC: Full Keyboard (WASD + JL + K/Space)
// 3. Mobile: Virtual Twin Sticks (Left = Move, Right = Aim + Fire)

class InputManager {
  constructor() {
    this.mode = 'pc-mouse'; // 'pc-mouse', 'pc-keyboard', 'mobile-touch'
    this.keys = {};
    this.pressedChordKeys = new Set(); // For chorded secret commands (simultaneous keypress)
    this.mouse = { x: 0, y: 0, isDown: false, worldX: 0, worldY: 0 };
    this.keyboardTurretAngle = 0;
    this.keyboardTurnSpeed = 3.8; // rad/s

    // Callbacks for secret chords
    this.onSecretTankUnlocked = null;
    this.onGodBotToggle = null;

    // Mobile Virtual Sticks
    this.touchMove = { active: false, startX: 0, startY: 0, curX: 0, curY: 0, identifier: null };
    this.touchAim = { active: false, startX: 0, startY: 0, curX: 0, curY: 0, identifier: null, isAiming: false };
    this.releaseShootTimer = 0; // Release-to-fire trigger timer

    // Final normalized output sent to server
    this.currentInput = {
      up: false,
      down: false,
      left: false,
      right: false,
      turretAngle: 0,
      shoot: false
    };

    // Auto-detect mobile devices
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      this.mode = 'mobile-touch';
    }

    this.initListeners();
  }

  setMode(mode) {
    this.mode = mode;
    const touchOverlay = document.getElementById('touch-controls');
    if (touchOverlay) {
      touchOverlay.style.display = this.mode === 'mobile-touch' ? 'block' : 'none';
    }
  }

  _isGameActive() {
    // Stick controls should ONLY be active during live battle, NEVER blocking lobby/results/modals
    const lobby = document.getElementById('lobby-screen');
    if (lobby && lobby.classList.contains('active')) return false;

    const result = document.getElementById('result-screen');
    if (result && result.classList.contains('active')) return false;

    const activeModal = document.querySelector('.modal-backdrop.active');
    if (activeModal) return false;

    const gameHud = document.getElementById('game-hud');
    return Boolean(gameHud && gameHud.classList.contains('active'));
  }

  checkSecretChords() {
    // 1. T + A + N + K simultaneously pressed -> Unlock Secret Tank (Phantom)
    if (
      this.pressedChordKeys.has('KeyT') &&
      this.pressedChordKeys.has('KeyA') &&
      this.pressedChordKeys.has('KeyN') &&
      this.pressedChordKeys.has('KeyK')
    ) {
      if (this.onSecretTankUnlocked) {
        this.onSecretTankUnlocked();
      }
    }

    // 2. B + O + T or G + O + D simultaneously pressed -> Toggle God Bots (Ultra stats & Aim)
    if (
      (this.pressedChordKeys.has('KeyB') && this.pressedChordKeys.has('KeyO') && this.pressedChordKeys.has('KeyT')) ||
      (this.pressedChordKeys.has('KeyG') && this.pressedChordKeys.has('KeyO') && this.pressedChordKeys.has('KeyD'))
    ) {
      if (this.onGodBotToggle) {
        this.onGodBotToggle();
      }
    }
  }

  initListeners() {
    // Keyboard events
    window.addEventListener('keydown', (e) => {
      this.keys[e.key.toLowerCase()] = true;
      this.keys[e.code] = true;

      // Chord detection (ignore if typing in text input)
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      this.pressedChordKeys.add(e.code);
      this.checkSecretChords();
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
      this.keys[e.code] = false;
      this.pressedChordKeys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.pressedChordKeys.clear();
      this.keys = {};
    });

    // Mouse events
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });

    window.addEventListener('mousedown', (e) => {
      if (e.target.closest('.modal-backdrop, .ui-screen, button, input, select, .spectator-bar')) return;
      if (e.button === 0) {
        this.mouse.isDown = true;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.mouse.isDown = false;
      }
    });

    // Wheel event for smooth zoom in/out
    window.addEventListener('wheel', (e) => {
      if (this.onWheelZoom) {
        this.onWheelZoom(e.deltaY);
      }
    }, { passive: true });

    // Touch events for Mobile: ONLY active during gameplay
    window.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: true });
    window.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
    window.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: true });
    window.addEventListener('touchcancel', (e) => this._onTouchEnd(e), { passive: true });
  }

  _onTouchStart(e) {
    if (this.mode !== 'mobile-touch') return;
    if (!this._isGameActive()) return; // Never block lobby scrolling!
    if (e.target.closest('.modal-backdrop, button, input, select, .spectator-bar, .lobby-card')) return;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const screenMid = window.innerWidth / 2;

      // Left half = Move stick
      if (t.clientX < screenMid && !this.touchMove.active) {
        this.touchMove.active = true;
        this.touchMove.identifier = t.identifier;
        this.touchMove.startX = t.clientX;
        this.touchMove.startY = t.clientY;
        this.touchMove.curX = t.clientX;
        this.touchMove.curY = t.clientY;
        this._updateTouchStickUI('stick-move', t.clientX, t.clientY, 0, 0);
      }
      // Right half = Aim & Release to Fire stick
      else if (t.clientX >= screenMid && !this.touchAim.active) {
        this.touchAim.active = true;
        this.touchAim.identifier = t.identifier;
        this.touchAim.startX = t.clientX;
        this.touchAim.startY = t.clientY;
        this.touchAim.curX = t.clientX;
        this.touchAim.curY = t.clientY;
        this.touchAim.isAiming = true;
        this._updateTouchStickUI('stick-aim', t.clientX, t.clientY, 0, 0, '🎯 エイム中 (離して発射)');
      }
    }
  }

  _onTouchMove(e) {
    if (this.mode !== 'mobile-touch') return;
    if (!this._isGameActive()) return;

    let handled = false;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];

      if (this.touchMove.active && t.identifier === this.touchMove.identifier) {
        this.touchMove.curX = t.clientX;
        this.touchMove.curY = t.clientY;
        const dx = t.clientX - this.touchMove.startX;
        const dy = t.clientY - this.touchMove.startY;
        this._updateTouchStickUI('stick-move', this.touchMove.startX, this.touchMove.startY, dx, dy, 'MOVE');
        handled = true;
      } else if (this.touchAim.active && t.identifier === this.touchAim.identifier) {
        this.touchAim.curX = t.clientX;
        this.touchAim.curY = t.clientY;
        const dx = t.clientX - this.touchAim.startX;
        const dy = t.clientY - this.touchAim.startY;
        this._updateTouchStickUI('stick-aim', this.touchAim.startX, this.touchAim.startY, dx, dy, '🎯 エイム中 (離して発射)');
        handled = true;
      }
    }

    if (handled && e.cancelable) {
      e.preventDefault();
    }
  }

  _onTouchEnd(e) {
    if (this.mode !== 'mobile-touch') return;
    if (!this._isGameActive()) return;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];

      if (this.touchMove.active && t.identifier === this.touchMove.identifier) {
        this.touchMove.active = false;
        this.touchMove.identifier = null;
        this._hideTouchStickUI('stick-move');
      } else if (this.touchAim.active && t.identifier === this.touchAim.identifier) {
        // Released! Release-to-fire trigger
        const dx = this.touchAim.curX - this.touchAim.startX;
        const dy = this.touchAim.curY - this.touchAim.startY;
        const dist = Math.hypot(dx, dy);

        // If dragged out, lock the final aim angle
        if (dist > 8) {
          this.currentInput.turretAngle = Math.atan2(dy, dx);
        }
        // Fire when releasing finger
        this.releaseShootTimer = 0.15;

        this.touchAim.active = false;
        this.touchAim.identifier = null;
        this.touchAim.isAiming = false;
        this._hideTouchStickUI('stick-aim');
      }
    }
  }

  _updateTouchStickUI(elementId, baseX, baseY, dx, dy, labelText = null) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.style.display = 'block';
    el.style.left = `${baseX}px`;
    el.style.top = `${baseY}px`;

    const knob = el.querySelector('.stick-knob');
    if (knob) {
      const maxDist = 45;
      const dist = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const clampedDist = Math.min(dist, maxDist);
      const kx = Math.cos(angle) * clampedDist;
      const ky = Math.sin(angle) * clampedDist;
      knob.style.transform = `translate(${kx}px, ${ky}px)`;

      // Glowing aim feedback on right stick
      if (elementId === 'stick-aim') {
        knob.style.background = 'radial-gradient(circle, #ef4444 0%, #b91c1c 100%)';
        knob.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.8)';
      }
    }

    const label = el.querySelector('.stick-label');
    if (label && labelText) {
      label.textContent = labelText;
      if (elementId === 'stick-aim') {
        label.style.color = '#f87171';
      }
    }
  }

  _hideTouchStickUI(elementId) {
    const el = document.getElementById(elementId);
    if (el) el.style.display = 'none';
  }

  // Update input loop (called by game loop with delta time and player info)
  update(dt, player, camera) {
    let up = false;
    let down = false;
    let left = false;
    let right = false;
    let turretAngle = this.currentInput.turretAngle;
    let shoot = false;

    // Movement: WASD or Arrow Keys
    if (this.keys['w'] || this.keys['arrowup']) up = true;
    if (this.keys['s'] || this.keys['arrowdown']) down = true;
    if (this.keys['a'] || this.keys['arrowleft']) left = true;
    if (this.keys['d'] || this.keys['arrowright']) right = true;

    if (this.mode === 'pc-mouse') {
      // 1. PC (Mouse + Keyboard)
      if (player && camera) {
        // Convert screen mouse to world coordinates taking zoom into account
        const canvas = document.getElementById('game-canvas');
        const screenCenterX = canvas.width / 2;
        const screenCenterY = canvas.height / 2;
        const zoom = camera.zoom || 1.0;
        const mouseWorldX = camera.x + (this.mouse.x - screenCenterX) / zoom;
        const mouseWorldY = camera.y + (this.mouse.y - screenCenterY) / zoom;

        turretAngle = Math.atan2(mouseWorldY - player.y, mouseWorldX - player.x);
      }
      shoot = this.mouse.isDown;
    } else if (this.mode === 'pc-keyboard') {
      // 2. PC (Full Keyboard): WASD move, J/L rotate turret, K or Space shoot
      if (this.keys['j']) {
        this.keyboardTurretAngle -= this.keyboardTurnSpeed * dt;
      }
      if (this.keys['l']) {
        this.keyboardTurretAngle += this.keyboardTurnSpeed * dt;
      }
      turretAngle = this.keyboardTurretAngle;
      shoot = Boolean(this.keys['k'] || this.keys[' '] || this.keys['space']);
    } else if (this.mode === 'mobile-touch') {
      // 3. Mobile (Touch Twin Sticks: Drag to Aim, Release to Fire)
      if (this.touchMove.active) {
        const dx = this.touchMove.curX - this.touchMove.startX;
        const dy = this.touchMove.curY - this.touchMove.startY;
        const deadzone = 12;

        if (Math.abs(dx) > deadzone) {
          if (dx > 0) right = true;
          else left = true;
        }
        if (Math.abs(dy) > deadzone) {
          if (dy > 0) down = true;
          else up = true;
        }
      }

      if (this.touchAim.active) {
        const dx = this.touchAim.curX - this.touchAim.startX;
        const dy = this.touchAim.curY - this.touchAim.startY;
        if (Math.hypot(dx, dy) > 8) {
          turretAngle = Math.atan2(dy, dx);
        }
        // While dragging/aiming, do NOT fire
        shoot = false;
      }

      // Check if finger was just released -> fire projectile!
      if (this.releaseShootTimer > 0) {
        shoot = true;
        this.releaseShootTimer -= dt;
        if (this.releaseShootTimer < 0) this.releaseShootTimer = 0;
      }
    }

    this.currentInput = { up, down, left, right, turretAngle, shoot };
    return this.currentInput;
  }
}

window.inputManager = new InputManager();
