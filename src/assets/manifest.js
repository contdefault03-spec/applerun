// Registry of every supplied / external asset. Types: gltf | audio | video | image
export const MANIFEST = [
  { id: 'max', type: 'gltf', category: 'characters', url: '/assets/characters/max.glb', label: 'Max (supplied, auto-rigged)' },
  { id: 'humans', type: 'gltf', category: 'characters', url: '/assets/characters/humans.glb', label: 'Human models (supplied, rigged man + woman)' },
  { id: 'ajan', type: 'audio', category: 'audio', url: '/assets/audio/ajan.mp3', label: 'Ajan interaction sound' },
  { id: 'fish', type: 'audio', category: 'audio', url: '/assets/audio/fish.mp3', label: 'Fishing mission catch sound (supplied)' },
  { id: 'rizeVideo', type: 'video', category: 'video', url: '/assets/video/rize_did_it.mp4', preload: false, label: 'Rize "did it" clip' },
  { id: 'mapReference', type: 'image', category: 'maps', url: '/assets/maps/reference.jpg', preload: false, label: 'City map reference' },
  { id: 'dolma', type: 'gltf', category: 'props', url: '/assets/props/dolma.glb', label: 'Dolma food item (supplied)' },
  { id: 'concert', type: 'audio', category: 'audio', url: '/assets/audio/concert.mp3', preload: false, label: 'Concert hall music loop (supplied)' },
  { id: 'cinemaVideo', type: 'video', category: 'video', url: '/assets/video/cinema.mp4', preload: false, label: 'Cinema screen film (supplied)' },
  { id: 'gang', type: 'audio', category: 'audio', url: '/assets/audio/gang.mp3', preload: false, label: 'Gang encounter audio cue (supplied)' },
];
