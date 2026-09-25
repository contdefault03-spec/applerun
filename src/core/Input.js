// Keyboard + mouse input with configurable action bindings and pointer lock.
export class Input {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.keys = new Set();
    this.pressed = new Set(); // codes pressed this frame
    this.released = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, rightPressed: false, leftReleased: false, rightReleased: false, wheel: 0 };
    this.enabled = true; // false while typing in UI
    this.locked = false;
    this.listeners = new Set();
    window.addEventListener('keydown', (e) => {
      if (this.isTyping(e)) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code) || (e.ctrlKey && e.code === 'KeyW')) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      for (const l of this.listeners) l('down', e.code, e);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
      for (const l of this.listeners) l('up', e.code, e);
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) { if (this.mouse.left) this.mouse.leftReleased = true; this.mouse.left = false; }
      if (e.button === 2) { if (this.mouse.right) this.mouse.rightReleased = true; this.mouse.right = false; }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
    });
    window.addEventListener('wheel', (e) => { if (this.locked) this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; for (const l of this.listeners) l('lock', this.locked); });
  }
  isTyping(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  lock() { if (!this.locked) this.canvas.requestPointerLock?.()?.catch?.(() => {}); }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  down(action) { return this.enabled && this.keys.has(this.settings.binding(action)); }
  hit(action) { return this.enabled && this.pressed.has(this.settings.binding(action)); }
  // Mark a press as handled so no other system reacts to it in the same frame
  consume(action) { this.pressed.delete(this.settings.binding(action)); }
  released_(action) { return this.released.has(this.settings.binding(action)); }
  axis() {
    return { x: (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0), y: (this.down('forward') ? 1 : 0) - (this.down('back') ? 1 : 0) };
  }
  endFrame() {
    this.pressed.clear(); this.released.clear();
    this.mouse.dx = this.mouse.dy = 0; this.mouse.wheel = 0;
    this.mouse.leftPressed = this.mouse.rightPressed = this.mouse.leftReleased = this.mouse.rightReleased = false;
  }
}
