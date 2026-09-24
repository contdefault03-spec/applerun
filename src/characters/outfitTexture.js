import * as THREE from 'three';

// Front-of-torso print textures. The canvas left half is the front projection of the
// chest (u = 0..0.5), the right half stays white for every non-front vertex. The texture
// is multiplied with the per-vertex outfit colour, so white = "just the shirt colour".
// CHEST box (in canvas px of the left half): x 0..256, y 0..512 maps to the torso front
// from shoulders (top) to hips (bottom).

const cache = new Map();

export function printTexture(kind, colors = {}) {
  const key = kind + JSON.stringify(colors);
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 512);
  const cx = 128; // chest center in left half
  switch (kind) {
    case 'jackedxhan': {
      // Bold text
      g.save();
      g.fillStyle = '#111111';
      g.font = 'bold 44px Arial, Helvetica, sans-serif';
      g.textAlign = 'center';
      g.fillText('JACKED', cx, 120);
      g.fillStyle = '#d6263b';
      g.font = 'bold 60px Arial, Helvetica, sans-serif';
      g.fillText('X', cx, 178);
      g.fillStyle = '#111111';
      g.font = 'bold 44px Arial, Helvetica, sans-serif';
      g.fillText('HAN', cx, 222);
      g.restore();
      // Fictional, non-explicit cartoon beach-girl graphic: sun, palm, stylised figure in a bikini
      g.save();
      g.translate(cx, 330);
      g.fillStyle = '#ffb347'; g.beginPath(); g.arc(34, -40, 26, 0, Math.PI * 2); g.fill(); // sun
      g.fillStyle = '#3aa3c9'; g.fillRect(-70, 40, 140, 22); // sea
      g.fillStyle = '#f3d27a'; g.fillRect(-70, 58, 140, 14); // sand
      // palm
      g.strokeStyle = '#6b4a2b'; g.lineWidth = 6; g.beginPath(); g.moveTo(-50, 62); g.quadraticCurveTo(-58, 10, -42, -35); g.stroke();
      g.fillStyle = '#2f8f46';
      for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse(-42, -38, 26, 7, -1.2 + i * 0.6, 0, Math.PI * 2); g.fill(); }
      // figure (silhouette-style, non-explicit)
      g.fillStyle = '#e0a47a';
      g.beginPath(); g.arc(8, -26, 10, 0, Math.PI * 2); g.fill(); // head
      g.fillStyle = '#5a3419'; g.beginPath(); g.ellipse(8, -26, 12, 13, 0, Math.PI, Math.PI * 2); g.fill(); // hair
      g.fillStyle = '#5a3419'; g.fillRect(-4, -26, 5, 22); g.fillRect(15, -26, 5, 22);
      g.fillStyle = '#e0a47a'; g.fillRect(1, -16, 14, 36); // torso
      g.fillRect(-6, -12, 6, 26); g.fillRect(16, -12, 6, 26); // arms
      g.fillRect(2, 20, 5, 30); g.fillRect(9, 20, 5, 30); // legs
      g.fillStyle = '#e8336b'; g.fillRect(1, -8, 14, 7); g.fillRect(1, 12, 14, 9); // swimsuit
      g.restore();
      g.fillStyle = '#111'; g.font = 'bold 14px sans-serif'; g.textAlign = 'center'; g.fillText('SUMMER GAINS', cx, 430);
      break;
    }
    case 'techfleece': {
      // dark chest panel, vertical zipper, small chest logo, seam lines
      g.fillStyle = colors.panel ? tint(colors.panel, colors.shirt) : '#555';
      g.beginPath(); g.moveTo(40, 40); g.lineTo(216, 40); g.lineTo(200, 170); g.lineTo(56, 170); g.closePath(); g.fill();
      g.fillStyle = '#9a9a9a'; g.fillRect(cx - 3, 20, 6, 480); // zipper
      g.fillStyle = '#d0d0d0'; g.fillRect(cx - 7, 30, 14, 20); // zip pull
      g.strokeStyle = '#8a8a8a'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(30, 260); g.quadraticCurveTo(cx, 300, 226, 260); g.stroke();
      g.fillStyle = '#333'; g.font = 'bold 18px sans-serif'; g.textAlign = 'left'; g.fillText('TF', 165, 110);
      g.fillStyle = '#b0b0b0'; g.fillRect(40, 330, 60, 6); g.fillRect(156, 330, 60, 6); // pockets
      break;
    }
    case 'hoodie': {
      g.strokeStyle = '#999'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(60, 330); g.lineTo(196, 330); g.lineTo(215, 440); g.lineTo(41, 440); g.closePath(); g.stroke(); // pocket
      g.fillStyle = '#eee'; g.fillRect(cx - 22, 30, 5, 120); g.fillRect(cx + 17, 30, 5, 110); // drawstrings
      g.fillStyle = '#bbb'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.fillText('meh.', cx, 230);
      break;
    }
    case 'stripes': {
      for (let y = 0; y < 512; y += 48) { g.fillStyle = '#ffe5ee'; g.fillRect(0, y, 512, 22); }
      g.fillStyle = '#ffd23f'; g.beginPath(); starPath(g, cx, 200, 34, 15); g.fill();
      break;
    }
    case 'bomber': {
      g.fillStyle = '#b8b8b8'; g.fillRect(cx - 3, 20, 6, 480);
      g.fillStyle = '#c0392b'; g.fillRect(50, 130, 50, 30);
      g.fillStyle = '#f1c40f'; g.beginPath(); g.arc(185, 150, 18, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#777'; for (let y = 470; y < 512; y += 8) g.fillRect(0, y, 256, 4);
      break;
    }
    case 'racer': {
      g.fillStyle = '#c86bff'; g.fillRect(30, 0, 18, 512); g.fillRect(208, 0, 18, 512);
      g.fillStyle = '#ffffff'; g.font = 'bold 90px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.fillText('07', cx, 280);
      break;
    }
    case 'police': {
      g.fillStyle = '#d4af37'; g.beginPath(); starPath(g, 190, 150, 22, 10); g.fill();
      g.fillStyle = '#c9d1e0'; g.fillRect(40, 140, 60, 12);
      g.fillStyle = '#ddd'; g.font = 'bold 20px sans-serif'; g.textAlign = 'center'; g.fillText('POLICE', cx, 300);
      g.fillStyle = '#222'; g.fillRect(0, 440, 256, 30);
      break;
    }
    case 'medic': {
      g.fillStyle = '#d32f2f'; g.fillRect(cx - 40, 120, 80, 24); g.fillRect(cx - 12, 92, 24, 80);
      g.fillStyle = '#333'; g.font = 'bold 20px sans-serif'; g.textAlign = 'center'; g.fillText('PARAMEDIC', cx, 250);
      break;
    }
    case 'apron': {
      g.fillStyle = colors.apron || '#2e7d32';
      g.beginPath(); g.moveTo(60, 120); g.lineTo(196, 120); g.lineTo(226, 512); g.lineTo(30, 512); g.closePath(); g.fill();
      break;
    }
    case 'hivis': {
      g.fillStyle = '#e0e0e0'; g.fillRect(0, 300, 256, 26); g.fillRect(40, 0, 20, 512); g.fillRect(196, 0, 20, 512);
      break;
    }
    case 'jersey': {
      g.fillStyle = '#ffffff'; g.font = 'bold 110px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.fillText(String(colors.number || 10), cx, 300);
      break;
    }
    case 'shabby': {
      g.fillStyle = 'rgba(80,60,40,0.5)';
      for (let i = 0; i < 14; i++) { g.beginPath(); g.arc(20 + ((i * 97) % 220), 40 + ((i * 53) % 440), 8 + (i % 5) * 4, 0, Math.PI * 2); g.fill(); }
      break;
    }
    default: break;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

function tint(a) { return a; }
function starPath(g, x, y, R, r) {
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r : R;
    i ? g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
}
