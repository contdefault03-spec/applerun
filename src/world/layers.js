// Render layers used to keep small objects out of the far shadow cascades.
//   0 WORLD       big structures: visible, cast in every cascade
//   1 NEAR        characters, small props: visible, cast only in the nearest cascade
//   2 MID         vehicles, trees: visible, cast in the two nearest cascades
//   3 SHADOW_NEAR shadow-only proxies (simplified meshes): never drawn, cast in the nearest cascade
export const LAYER = { WORLD: 0, NEAR: 1, MID: 2, SHADOW_NEAR: 3 };

/** Put every mesh under `obj` on one layer (shadow proxies keep their own layer). */
export function setLayer(obj, layer) {
  obj.traverse((o) => { if (!o.userData.shadowProxy) o.layers.set(layer); });
}

/** Main / UI cameras see the visible layers. */
export function enableVisibleLayers(camera) {
  camera.layers.enable(LAYER.NEAR);
  camera.layers.enable(LAYER.MID);
}

/** Shadow cascade `i` (0 = nearest) renders progressively fewer small casters. */
export function configureCascadeLayers(lights) {
  lights.forEach((l, i) => {
    const cam = l.shadow.camera;
    cam.layers.set(LAYER.WORLD);
    if (i === 0) { cam.layers.enable(LAYER.NEAR); cam.layers.enable(LAYER.SHADOW_NEAR); }
    if (i <= 1) cam.layers.enable(LAYER.MID);
  });
}
