// Playable character definitions + NPC outfit presets.
// Colours are CSS hex strings. `base` picks the source model:
//   'max'   -> supplied max_3d_model.glb (auto-rigged)
//   'man'   -> supplied HumanModels.glb "Man (Rig)"
//   'woman' -> supplied HumanModels.glb "Woman (Rig)"

export const PLAYABLE = [
  {
    id: 'max', name: 'Max', base: 'max', height: 1.8,
    tagline: 'The original. Long hair, black tee, zero fear.',
    description: 'Built from the supplied Max model. A laid-back rocker who knows every street in Bayview and treats the whole city like his personal playground.',
    personality: 'Max is confident, easy-going and a little cocky. Talks like a chill rocker, uses slang, loves cars and trouble.',
    stats: { speed: 1.0, strength: 1.0, stamina: 1.0 },
    accent: '#ff5a36',
  },
  {
    id: 'ajan', name: 'Ajan', base: 'man', height: 1.86,
    tagline: 'A fat gorilla in a Tech Fleece. Press E on him.',
    description: 'A chunky silverback who never takes off his grey tech fleece. Heavy hitter, slow sprinter, legendary vibes.',
    personality: 'Ajan is a fat gorilla in a tech fleece. Loud, hilarious, proud of his fit, constantly hungry, makes gorilla noises (OOH OOH), roasts people affectionately and hypes himself up.',
    stats: { speed: 0.9, strength: 1.35, stamina: 0.85 },
    accent: '#8a8f98',
    skin: '#2a2522', gorilla: true,
    deform: { torsoW: 1.55, torsoD: 1.55, belly: 1.0, armThick: 1.75, legThick: 1.45, armLen: 1.14, legLen: 0.78, headScale: 1.0, shoulder: 0.05 },
    outfit: { shirt: '#6f747b', shirtPanel: '#2b2d31', sleeves: 'long', pants: '#6a6f76', pantsLen: 'long', shoes: '#f2f2f2', print: 'techfleece' },
    idleStyle: 'gorilla', runStyle: 'gorilla',
  },
  {
    id: 'rize', name: 'Rize', base: 'man', height: 1.75,
    tagline: 'Bored teenager. Fluffy hair. Did it.',
    description: 'A permanently unimpressed teen with a cloud of fluffy hair. Moves like every step is a chore — until something is actually fun.',
    personality: 'Rize is a bored teenage dude. Replies short, lowercase energy, says things like "idk", "bro", "mid", "fr". Hard to impress, secretly funny.',
    stats: { speed: 1.05, strength: 0.9, stamina: 1.1 },
    accent: '#7bd389',
    skin: '#e3b797', hair: '#5a3b24', hairStyle: 'fluffy', eyes: 'bored',
    deform: { torsoW: 0.92, torsoD: 0.92, armThick: 0.9, legThick: 0.9, legLen: 1.02 },
    outfit: { shirt: '#56644a', sleeves: 'long', pants: '#1f2126', pantsLen: 'long', shoes: '#d9d9d9', print: 'hoodie' },
    idleStyle: 'bored', runStyle: 'lazy',
  },
  {
    id: 'masked', name: 'Masked', base: 'man', height: 2.02,
    tagline: 'Tall, lean, jacked. JackedXhan on the chest.',
    description: 'A long-limbed, shredded mystery man in a ski mask. Nobody knows his real name — they just read the shirt.',
    personality: 'Masked is a mysterious, tall, jacked guy in a ski mask who wears a JackedXhan shirt. Speaks in calm, short, intimidating sentences, obsessed with gains and protein, dry humour.',
    stats: { speed: 1.08, strength: 1.2, stamina: 1.05 },
    accent: '#e8e8e8',
    skin: '#c48b60', mask: '#141414',
    deform: { torsoW: 1.02, torsoD: 0.95, armThick: 1.22, legThick: 1.06, armLen: 1.08, legLen: 1.12, shoulder: 0.03, waist: 0.86 },
    outfit: { shirt: '#f4f4f4', sleeves: 'short', pants: '#202225', pantsLen: 'long', shoes: '#111111', print: 'jackedxhan' },
    idleStyle: 'flex', runStyle: 'athletic',
  },
  {
    id: 'lucky', name: 'Lucky', base: 'man', height: 1.34,
    tagline: 'Short, silly, umbrella hat. Chaos goblin.',
    description: 'A tiny, goofy legend wearing a ridiculous umbrella hat. Waddles everywhere and somehow always wins.',
    personality: 'Lucky is short, silly and funny. Wears a cute umbrella hat. Talks excitedly, makes goofy jokes, random tangents, calls everyone "buddy", believes he is extremely lucky.',
    stats: { speed: 0.95, strength: 0.85, stamina: 1.2 },
    accent: '#ffd23f',
    skin: '#f0c6a4', hair: '#2f2118',
    deform: { legLen: 0.72, headScale: 1.38, torsoW: 1.1, torsoD: 1.1, belly: 0.35, armLen: 0.92 },
    outfit: { shirt: '#ff8fb1', stripes: '#ffffff', sleeves: 'short', pants: '#3d7bd9', pantsLen: 'short', shoes: '#ffd23f', print: 'stripes' },
    hat: 'umbrella', idleStyle: 'silly', runStyle: 'waddle',
  },
  {
    id: 'dex', name: 'Dex', base: 'man', height: 1.82,
    tagline: 'Supplied rigged male model. Streetwear regular.',
    description: 'Built from the supplied rigged male model (HumanModels.glb). An everyday Bayview local in a bomber jacket.',
    personality: 'Dex is a friendly, chatty local guy who knows gossip about everyone in Bayview. Upbeat and helpful.',
    stats: { speed: 1.0, strength: 1.0, stamina: 1.0 },
    accent: '#4fa3ff',
    skin: '#8d5a3b', hair: '#111111',
    outfit: { shirt: '#2e3b55', sleeves: 'long', pants: '#48505e', pantsLen: 'long', shoes: '#ffffff', print: 'bomber' },
    hat: 'cap', hatColor: '#c0392b',
  },
  {
    id: 'nova', name: 'Nova', base: 'woman', height: 1.7,
    tagline: 'Supplied rigged female model. Fast and sharp.',
    description: 'Built from the supplied rigged female model (HumanModels.glb). A quick-witted street racer.',
    personality: 'Nova is a sharp, witty street racer. Confident, teasing, competitive, always talking about her next race.',
    stats: { speed: 1.08, strength: 0.9, stamina: 1.05 },
    accent: '#c86bff',
    skin: '#e8b996', hair: '#7a2d8f', hairStyle: 'ponytail',
    outfit: { shirt: '#1d1d24', sleeves: 'short', pants: '#2f4f7a', pantsLen: 'long', shoes: '#c86bff', print: 'racer' },
  },
];

export const PLAYABLE_BY_ID = Object.fromEntries(PLAYABLE.map((p) => [p.id, p]));

// NPC outfits by role; variants are generated deterministically from these.
export const NPC_ROLES = {
  civilian: { shirts: ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#ecf0f1', '#34495e', '#e67e22', '#16a085', '#d35400'], pants: ['#2c3e50', '#34495e', '#7f8c8d', '#1c2833', '#6e5a3b', '#3b5b8c'] },
  police: { shirts: ['#1b2a4a'], pants: ['#15203a'], hat: 'police', badge: true },
  gang: { shirts: ['#7d1111', '#0f3d91', '#1d1d1d'], pants: ['#1d1d1d', '#27313d'], hat: 'bandana' },
  shopkeeper: { shirts: ['#f5f5f5', '#dfe6e9'], pants: ['#2d3436'], apron: '#2e7d32' },
  medic: { shirts: ['#eef3f6'], pants: ['#1b5e20'], badge: true },
  worker: { shirts: ['#ff9f1a', '#f7e51b'], pants: ['#2f3542'], hat: 'hardhat' },
  athlete: { shirts: ['#e53935', '#1e88e5'], pants: ['#ffffff'], sleeves: 'short', pantsLen: 'short' },
  junkie: { shirts: ['#6b5f4b', '#4c4c3f', '#5d4037'], pants: ['#3e3a33', '#4a4239'], shabby: true },
  resident: { shirts: ['#95a5a6', '#bdc3c7', '#a29bfe', '#fab1a0', '#81ecec'], pants: ['#2d3436', '#636e72'] },
  teamA: { shirts: ['#1e63d8'], pants: ['#ffffff'], sleeves: 'short', pantsLen: 'short', jersey: true },
  teamB: { shirts: ['#d8342b'], pants: ['#1a1a1a'], sleeves: 'short', pantsLen: 'short', jersey: true },
  wrestler: { shirts: ['#6a1b9a', '#ff6f00', '#00897b', '#c62828'], pants: ['#111111', '#ffd600', '#1565c0'], sleeves: 'short', pantsLen: 'short' },
};

export const SKIN_TONES = ['#f1d2b6', '#e8b996', '#d69e76', '#b97a52', '#8d5a3b', '#6b4127', '#4a2c1a'];
export const HAIR_COLORS = ['#111111', '#2f2118', '#5a3b24', '#8b5a2b', '#c9a15b', '#d9d0c1', '#7b1f1f', '#3a3a3a'];
