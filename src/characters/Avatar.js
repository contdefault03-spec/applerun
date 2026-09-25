import * as THREE from 'three';
import { Animator } from './Animator.js';

// A character in the world: model + animator + name tag + held item.
export class Avatar {
  constructor(factory, key, { name = '', showTag = true, tagColor = '#ffffff' } = {}) {
    this.factory = factory;
    this.group = new THREE.Group();
    this.group.name = 'avatar';
    this.yaw = 0;
    this.name = name;
    this.tagColor = tagColor;
    this.talking = false;
    this.held = null;
    this.setCharacter(key);
    if (showTag) {
      this.tag = new NameTag(name, tagColor);
      this.group.add(this.tag.sprite);
      this.tag.sprite.position.y = this.char.height + 0.45;
    }
  }
  get position() { return this.group.position; }
  setCharacter(key) {
    if (this.char && this.key === key) return;
    const heldSpec = this.heldSpec;
    if (this.char) { this.group.remove(this.char.root); }
    this.key = key;
    this.char = this.factory.create(key);
    this.group.add(this.char.root);
    this.anim = new Animator(this.char);
    this.handR = this.char.rig.bones.handR;
    if (this.tag) this.tag.sprite.position.y = this.char.height + 0.45;
    if (heldSpec) this.hold(heldSpec.model, heldSpec.kind);
  }
  setName(n) { this.name = n; this.tag?.set(n, this.talking); }
  setTalking(t) { if (this.talking !== t) { this.talking = t; this.tag?.set(this.name, t); } }
  setTagColor(c) { this.tagColor = c; if (this.tag) { this.tag.color = c; this.tag.set(this.name, this.talking); } }

  /** Hold an item (weapon, ball...) in the right hand. The model is authored with the
   *  grip at its origin and the barrel along +Z; it is placed at the hand bone each frame
   *  and oriented along the aim direction (works for every rig). */
  hold(model, kind = 'weapon') {
    if (this.held) { this.held.removeFromParent(); this.held = null; }
    this.heldSpec = model ? { model, kind } : null;
    if (!model) return;
    const m = model.clone();
    m.userData = { ...model.userData, kind };
    m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.group.add(m);
    this.held = m;
  }
  placeHeld(pitch = 0) {
    if (!this.held) return;
    this.group.updateMatrixWorld(true);
    const hw = new THREE.Vector3();
    this.handR.getWorldPosition(hw);
    this.group.worldToLocal(hw);
    this.held.position.copy(hw);
    this.held.rotation.set(-pitch, 0, 0);
  }

  update(dt, state) {
    this.group.rotation.y = this.yaw;
    this.anim.update(dt, state);
    if (this.held) this.placeHeld(state?.aim ? (state.aimPitch || 0) : state?.weapon && state.weapon !== 'none' ? -0.5 : -1.2);
  }

  headWorld(out = new THREE.Vector3()) {
    this.char.rig.bones.head.getWorldPosition(out);
    return out;
  }
  dispose() { this.group.removeFromParent(); }
}

export class NameTag {
  constructor(text, color = '#ffffff') {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512; this.canvas.height = 128;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, depthTest: true, transparent: true, sizeAttenuation: true }));
    this.sprite.scale.set(1.6, 0.4, 1);
    this.sprite.renderOrder = 10;
    this.color = color;
    this.set(text, false);
  }
  set(text, talking) {
    const g = this.canvas.getContext('2d');
    g.clearRect(0, 0, 512, 128);
    if (!text) { this.tex.needsUpdate = true; return; }
    g.font = 'bold 54px system-ui, Arial, sans-serif';
    const w = Math.min(470, g.measureText(text).width + (talking ? 110 : 50));
    const x0 = 256 - w / 2;
    g.fillStyle = 'rgba(10,12,20,0.55)';
    roundRect(g, x0, 22, w, 84, 30); g.fill();
    g.fillStyle = this.color; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 256 + (talking ? 30 : 0), 66, 400);
    if (talking) {
      g.fillStyle = '#4cff7a';
      roundRect(g, x0 + 22, 38, 26, 40, 13); g.fill();
      g.fillRect(x0 + 33, 78, 4, 14);
      g.strokeStyle = '#4cff7a'; g.lineWidth = 5; g.beginPath(); g.arc(x0 + 35, 62, 22, 0.15, Math.PI - 0.15); g.stroke();
    }
    this.tex.needsUpdate = true;
  }
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
