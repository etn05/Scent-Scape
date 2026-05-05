// ─────────────────────────────────────────────────────────────────────────────
//  A small, polished Three.js scene with:
//   · procedurally-built floating island + props
//   · warm painterly PBR lighting + soft shadows
//   · lightweight third-person firefly controller
//   · raycast hover interaction with floating HTML labels
//   · post-processing (bloom + vignette) and atmospheric fog
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass }      from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass }      from 'three/addons/postprocessing/OutputPass.js';

// ─── Globals ─────────────────────────────────────────────────────────────────
let renderer, scene, camera, composer, clock;
let island, sky;
let player, playerGlow;
const interactables = [];      // meshes/groups the raycaster cares about
const swayables      = [];     // things that gently sway (plants, grass…)
let raycaster, pointerNdc;
let hoveredRoot = null;
let labelEl, labelText, labelSub;
// const ASSET_LINKS = {
//   woody: '',
//   floral: '',
//   fresh: '',
// };

const keys = Object.create(null);

// Third-person camera state
const camTarget    = new THREE.Vector3();   // desired camera position
const camCurrent   = new THREE.Vector3();   // smoothed camera position
const camLookTarget = new THREE.Vector3();  // desired look-at
const camLookCurrent = new THREE.Vector3(); // smoothed look-at

// Player state (moves on top of the island)
const playerState = {
  pos: new THREE.Vector3(0, 0, 2.4),
  yaw: Math.PI,                // facing the stump initially
  vel: new THREE.Vector3(),
  radius: 0.18,
};

// ─── Palette ─────────────────────────────────────────────────────────────────
// Warm ivory sky / creamy fog — reads as "perfume" backdrop.
// The island reads as *green* all the way down (no brown dirt).
const COL = {
  skyTop:      new THREE.Color('#f5e7c9'),
  skyBottom:   new THREE.Color('#fbeed6'),
  fog:         new THREE.Color('#efe1c5'),

  grass:       new THREE.Color('#7aa95a'),
  grassDark:   new THREE.Color('#5e8a40'),
  // "dirt" is now mossy green — the whole island is verdant
  dirt:        new THREE.Color('#4f7a3a'),
  dirtDark:    new THREE.Color('#2f4a26'),

  bark:        new THREE.Color('#6b4f36'),
  barkLight:   new THREE.Color('#8a6a46'),
  barkRing:    new THREE.Color('#a8815a'),

  moss:        new THREE.Color('#5a8e3a'),
  leaf:        new THREE.Color('#4d7e3a'),
  leafLight:   new THREE.Color('#7aa04a'),

  mushCap:     new THREE.Color('#c03a2d'),
  mushSpot:    new THREE.Color('#f5efe0'),
  mushStem:    new THREE.Color('#efe3c8'),

  rock:        new THREE.Color('#8c8578'),
  rockDark:    new THREE.Color('#6a6458'),

  petalYellow: new THREE.Color('#e8c24a'),
  petalWhite:  new THREE.Color('#f3e8d0'),
  petalPink:   new THREE.Color('#e89aa0'),
  petalBlush:  new THREE.Color('#f0c2c4'),
  petalRose:   new THREE.Color('#d9899a'),

  firefly:     new THREE.Color('#ffe8a6'),
};

// Utility — small deterministic-ish jitter
const rand  = (a, b) => a + Math.random() * (b - a);
const pick  = arr  => arr[(Math.random() * arr.length) | 0];
const vary  = (c, amt = 0.08) => c.clone().offsetHSL(rand(-amt*0.2, amt*0.2), rand(-amt*0.4, amt*0.4), rand(-amt, amt));

// ─── Fuzzy material factory ──────────────────────────────────────────────────
// MeshPhysicalMaterial extends MeshStandardMaterial, so every existing param
// (color, roughness, metalness, emissive, map, side, flatShading, …) still
// works. We layer a warm sheen on top → the velvet / peach-fuzz / felted look.
// High sheenRoughness (~0.9) makes it soft & diffuse rather than specular.
const SHEEN_WARM = new THREE.Color('#fff1d8');

function fuzzyMat(params = {}, sheenOverride = {}) {
  const mat = new THREE.MeshPhysicalMaterial(params);
  mat.sheen          = sheenOverride.sheen          ?? 0.85;
  mat.sheenRoughness = sheenOverride.sheenRoughness ?? 0.9;
  mat.sheenColor     = (sheenOverride.sheenColor
    ? new THREE.Color(sheenOverride.sheenColor)
    : SHEEN_WARM.clone());
  return mat;
}

// ═════════════════════════════════════════════════════════════════════════════
//  INIT
// ═════════════════════════════════════════════════════════════════════════════
function init() {
  clock = new THREE.Clock();

  // Renderer
  const canvas = document.getElementById('canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // Scene
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(COL.fog, 14, 48);

  // Camera
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(6, 5, 7);
  camera.lookAt(0, 0.6, 0);
  camCurrent.copy(camera.position);
  camLookCurrent.set(0, 0.6, 0);

  // DOM refs
  labelEl   = document.getElementById('label');
  labelText = document.getElementById('label-text');
  labelSub  = document.getElementById('label-sub');

  // Ray
  raycaster  = new THREE.Raycaster();
  pointerNdc = new THREE.Vector2(-2, -2); // offscreen until user moves

  createSky();
  createLights();
  createScene();
  createPlayer();
  setupPostprocessing();
  setupControls();
  setupInteraction();

  window.addEventListener('resize', onResize);

  // Fade out loading
  requestAnimationFrame(() => {
    document.getElementById('loading').classList.add('hidden');
  });

  animate();
}

// ═════════════════════════════════════════════════════════════════════════════
//  SKY + LIGHTS
// ═════════════════════════════════════════════════════════════════════════════
function createSky() {
  const geo = new THREE.SphereGeometry(90, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor:    { value: COL.skyTop.clone() },
      bottomColor: { value: COL.skyBottom.clone() },
      offset:      { value: 20.0 },
      exponent:    { value: 0.55 },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      varying vec3 vWorld;
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      void main() {
        float h = normalize(vWorld + vec3(0.0, offset, 0.0)).y;
        float t = max(pow(max(h, 0.0), exponent), 0.0);
        vec3 col = mix(bottomColor, topColor, t);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  sky = new THREE.Mesh(geo, mat);
  scene.add(sky);
}

function createLights() {
  // Hemisphere: sky warms up, ground cools down slightly — keeps shadows colorful, never black
  const hemi = new THREE.HemisphereLight(0xffe6b8, 0x4a5a40, 0.85);
  hemi.position.set(0, 20, 0);
  scene.add(hemi);

  // Warm directional "sun" — angled low for long soft shadows
  const sun = new THREE.DirectionalLight(0xfff1c7, 1.65);
  sun.position.set(-7, 11, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far  = 40;
  sun.shadow.camera.left   = -12;
  sun.shadow.camera.right  =  12;
  sun.shadow.camera.top    =  12;
  sun.shadow.camera.bottom = -12;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 4.0;          // soften shadow edges
  sun.shadow.blurSamples = 12;
  scene.add(sun);
  scene.add(sun.target);

  // Cool rim / fill from the opposite side to lift shadows
  const fill = new THREE.DirectionalLight(0x9cc0d8, 0.35);
  fill.position.set(8, 6, -6);
  scene.add(fill);

  // Faint ambient so nothing is ever fully black
  scene.add(new THREE.AmbientLight(0xfff0d8, 0.12));
}

// ═════════════════════════════════════════════════════════════════════════════
//  SCENE — composed with intention, not random scatter
// ═════════════════════════════════════════════════════════════════════════════
function createScene() {
  island = createIsland();
  scene.add(island);

  // ---- Central focal point: tree stump at (0,0,0) ----
  const stump = createTreeStump({ height: 1.25, radius: 0.85 });
  stump.position.set(0, 0, 0);
  stump.userData.label = 'Woody';
  stump.userData.scent = 'Sandalwood · Cedarwood · Palo Santo';
  addInteractable(stump);
  scene.add(stump);

  // A small moss ring at the stump's base
  const mossRing = createMossRing(1.1);
  mossRing.position.set(0, 0.02, 0);
  scene.add(mossRing);

  // A featured hero flower — the "perfume" centrepiece — set near the stump
  const hero = createHeroFlower();
  hero.position.set(-0.95, snapToIsland(-0.95, 0.85), 0.85);
  hero.rotation.y = -0.4;
  hero.userData.label = 'Floral';
  hero.userData.scent = 'Lotus · Jasmine · Rose · Lily · Plumeria';
  addInteractable(hero);
  swayables.push({ obj: hero, phase: Math.random() * Math.PI * 2, amt: 0.03, speed: 0.7 });
  scene.add(hero);

  // Mushroom cluster against the stump (cozy detail)
  // const stumpMush1 = createMushroom(0.35);
  // stumpMush1.position.set(0.75, snapToIsland(0.75, 0.35), 0.35);
  // stumpMush1.rotation.y = 0.6;
  // stumpMush1.userData.label = 'Ember Cap';
  // stumpMush1.userData.scent = 'earthy · musky · damp petrichor';
  // addInteractable(stumpMush1);
  // scene.add(stumpMush1);

  addCluster(scene, [
    { fn: () => createMushroom(0.22), at: [0.95, 0, 0.1],  rot: -0.2 },
    { fn: () => createMushroom(0.28), at: [0.82, 0, -0.2], rot: 1.8 },
  ]);

  // ---- Supporting: fallen logs, arranged for circular flow ----
  const log1 = createLog({ length: 2.2, radius: 0.32 });
  log1.position.set(-2.1, 0.34, -1.4);
  log1.rotation.set(0, Math.PI * 0.35, 0.06);
  log1.userData.label = 'Woody';
  log1.userData.scent = 'Sandalwood · Cedarwood · Palo Santo';
  addInteractable(log1);
  scene.add(log1);

  const log2 = createLog({ length: 1.6, radius: 0.26 });
  log2.position.set(2.4, 0.28, 1.1);
  log2.rotation.set(0, -Math.PI * 0.22, -0.04);
  log2.userData.label = 'Woody';
  log2.userData.scent = 'Sandalwood · Cedarwood · Palo Santo';
  addInteractable(log2);
  scene.add(log2);

  const log3 = createLog({ length: 0.9, radius: 0.2 });
  log3.position.set(1.1, 0.22, -2.6);
  log3.rotation.set(0, Math.PI * 0.65, 0.12);
  log3.userData.label = 'Woody';
  log3.userData.scent = 'Sandalwood · Cedarwood · Palo Santo';
  addInteractable(log3);
  scene.add(log3);

  // Mushrooms on/near the logs
  addCluster(scene, [
    { fn: () => createMushroom(0.32), at: [-1.5, 0, -1.6], rot: 0.4 },
    { fn: () => createMushroom(0.20), at: [-1.25, 0, -1.35], rot: 1.1 },
    { fn: () => createMushroom(0.24), at: [ 2.0, 0,  1.5], rot: -0.3 },
  ]);

  // ---- Ferns — frame the focal point, guide the eye ----
  const fernSpots = [
    { at: [-2.9, 0,  0.8], s: 1.15 },
    { at: [-1.0, 0,  2.6], s: 0.95 },
    { at: [ 1.6, 0,  2.8], s: 1.05 },
    { at: [ 3.0, 0, -0.6], s: 1.00 },
    { at: [ 0.2, 0, -3.1], s: 1.10 },
    { at: [-2.6, 0, -2.3], s: 0.85 },
  ];
  const fernLabels = [
    { label: 'Fresh',    scent: 'Grassy · Dew · Green Sap' },
    { label: 'Fresh',    scent: 'Grassy · Dew · Green Sap' },
    { label: 'Fresh',    scent: 'Grassy · Dew · Green Sap' },
    { label: 'Fresh',        scent: 'Grassy · Dew · Green Sap' },
    { label: 'Fresh',        scent: 'Grassy · Dew · Green Sap' },
    { label: 'Fresh',        scent: 'Grassy · Dew · Green Sap' },
  ];
  fernSpots.forEach((f, i) => {
    const fern = createFern(f.s);
    fern.position.set(f.at[0], snapToIsland(f.at[0], f.at[2]), f.at[2]);
    fern.rotation.y = rand(0, Math.PI * 2);
    fern.userData.label = fernLabels[i].label;
    fern.userData.scent = fernLabels[i].scent;
    addInteractable(fern);
    swayables.push({ obj: fern, phase: Math.random() * Math.PI * 2, amt: 0.06, speed: 0.9 });
    scene.add(fern);
  });

  // ---- Rocks — varied sizes, clustered ----
 

  // ---- Grass clumps scattered — use polar placement for natural cluster feel ----
  for (let i = 0; i < 46; i++) {
    const a = rand(0, Math.PI * 2);
    const r = 0.7 + Math.pow(Math.random(), 0.6) * 4.2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    // avoid overlapping the stump too much
    if (Math.hypot(x, z) < 1.0) continue;
    const g = createGrassClump(rand(0.7, 1.25));
    g.position.set(x, snapToIsland(x, z), z);
    g.rotation.y = rand(0, Math.PI * 2);
    swayables.push({ obj: g, phase: Math.random() * Math.PI * 2, amt: 0.08, speed: 1.4 });
    scene.add(g);
  }

  // ---- Small flowers accenting the palette ----
  const flowerScents = [
    { label: 'Floral',   scent: 'Lotus · Jasmine · Rose · Lily · Plumeria' },
    { label: 'Floral',   scent: 'Lotus · Jasmine · Rose · Lily · Plumeria' },
    { label: 'Floral', scent: 'Lotus · Jasmine · Rose · Lily · Plumeria' },
  ];
  let flowerInteractIdx = 0;
  for (let i = 0; i < 18; i++) {
    const a = rand(0, Math.PI * 2);
    const r = 1.2 + Math.random() * 3.4;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const f = createFlower();
    f.position.set(x, snapToIsland(x, z), z);
    f.rotation.y = rand(0, Math.PI * 2);
    // tag three of them as interactable so the user has more to discover
    if ((i === 2 || i === 8 || i === 14) && flowerInteractIdx < flowerScents.length) {
      const meta = flowerScents[flowerInteractIdx++];
      f.userData.label = meta.label;
      f.userData.scent = meta.scent;
      addInteractable(f);
    }
    swayables.push({ obj: f, phase: Math.random() * Math.PI * 2, amt: 0.05, speed: 1.1 });
    scene.add(f);
  }

  // Drifting firefly dust — tiny additive sprites for atmosphere
  addFireflyDust();
}

// Helper — add children from an array spec to a parent, respecting island height
function addCluster(parent, entries) {
  entries.forEach(e => {
    const o = e.fn();
    const y = snapToIsland(e.at[0], e.at[2]);
    o.position.set(e.at[0], y + (e.at[1] || 0), e.at[2]);
    if (typeof e.rot === 'number') o.rotation.y = e.rot;
    parent.add(o);
  });
}

// Approximate the island-top height at (x,z). Dome bulges a bit.
function snapToIsland(x, z) {
  const r = Math.hypot(x, z);
  // Matches the island lathe profile near the top
  // (see createIsland — top bulges ~0.45, falls off toward edge)
  const t = Math.min(r / 6.0, 1.0);
  return 0.45 - 0.35 * t * t;
}

// ═════════════════════════════════════════════════════════════════════════════
//  OBJECT BUILDERS — every prop is built procedurally
// ═════════════════════════════════════════════════════════════════════════════

// --- The floating island ---
function createIsland() {
  const keyProfile = [
    new THREE.Vector2(0.001, 0.45),   // dome crown
    new THREE.Vector2(1.3,   0.50),
    new THREE.Vector2(3.0,   0.42),
    new THREE.Vector2(4.5,   0.25),
    new THREE.Vector2(5.6,   0.05),
    new THREE.Vector2(6.0,  -0.15),
    new THREE.Vector2(5.7,  -0.6),
    new THREE.Vector2(4.9,  -1.3),
    new THREE.Vector2(3.6,  -2.2),
    new THREE.Vector2(2.1,  -3.1),
    new THREE.Vector2(0.8,  -3.8),
    new THREE.Vector2(0.001, -4.0),
  ];
  // Densify the profile with a Catmull-Rom spline so the island's vertical
  // silhouette is genuinely smooth (not piecewise linear between key points).
  const spline  = new THREE.SplineCurve(keyProfile);
  const profile = spline.getPoints(80);
  const geom = new THREE.LatheGeometry(profile, 96);

  // Organic displacement — small, non-repeating
  const pos = geom.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = Math.hypot(v.x, v.z);
    if (r < 0.05) continue; // don't move poles
    const n1 = Math.sin(v.x * 1.7 + v.y * 0.8) * Math.cos(v.z * 1.9 - v.y * 0.6);
    const n2 = Math.sin(v.x * 4.1 + v.z * 3.7) * 0.4;
    const amt = (v.y > -0.1) ? 0.08 : 0.22;     // underside is rougher
    const dx = (v.x / r) * (n1 + n2) * amt;
    const dz = (v.z / r) * (n1 + n2) * amt;
    pos.setXYZ(i, v.x + dx, v.y + (v.y < -0.1 ? n2 * 0.08 : 0), v.z + dz);
  }
  geom.computeVertexNormals();

  // Vertex colors: grass on top, fading into dirt below
  const cArr = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > 0.12) {
      c.copy(COL.grass);
    } else if (y > -0.15) {
      const t = THREE.MathUtils.smoothstep(y, -0.15, 0.12);
      c.copy(COL.dirt).lerp(COL.grass, t);
    } else if (y > -1.2) {
      c.copy(COL.dirt);
    } else {
      const t = THREE.MathUtils.smoothstep(y, -3.8, -1.2);
      c.copy(COL.dirtDark).lerp(COL.dirt, t);
    }
    // subtle handcrafted variation
    const j = 0.92 + Math.random() * 0.14;
    cArr[i * 3 + 0] = c.r * j;
    cArr[i * 3 + 1] = c.g * j;
    cArr[i * 3 + 2] = c.b * j;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(cArr, 3));

  const mat = fuzzyMat({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.0,
  }, { sheen: 1.1, sheenRoughness: 0.88, sheenColor: '#cfe4a0' });   // mossy island fuzz
  const mesh = new THREE.Mesh(geom, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

// --- Tree stump with spiral growth rings ---
function createTreeStump({ height = 1.2, radius = 0.8 } = {}) {
  const group = new THREE.Group();

  // Body — slightly tapered, organic vertical ridges
  const bodyGeo = new THREE.CylinderGeometry(radius * 0.94, radius * 1.05, height, 48, 6, true);
  const pos = bodyGeo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ang = Math.atan2(v.z, v.x);
    const ridge = Math.sin(ang * 14) * 0.025 + Math.sin(ang * 6 + v.y * 2.0) * 0.04;
    const r = Math.hypot(v.x, v.z);
    if (r > 0.01) {
      pos.setX(i, v.x + (v.x / r) * ridge);
      pos.setZ(i, v.z + (v.z / r) * ridge);
    }
  }
  bodyGeo.computeVertexNormals();

  const bodyMat = fuzzyMat({
    color: COL.bark.clone(),
    roughness: 0.88,
    metalness: 0.0,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = height / 2;
  body.castShadow = body.receiveShadow = true;
  group.add(body);

  // Top cap with spiral rings (canvas texture)
  const topTex = makeRingsTexture();
  const topMat = fuzzyMat({
    map: topTex,
    roughness: 0.82,
    metalness: 0.0,
  });
  const top = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.94, 48),
    topMat
  );
  top.rotation.x = -Math.PI / 2;
  top.position.y = height + 0.001;
  top.receiveShadow = true;
  group.add(top);

  // Subtle bark lip where top meets body
  const lip = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.93, 0.04, 16, 48),
    fuzzyMat({ color: COL.barkLight, roughness: 0.85 })
  );
  lip.rotation.x = Math.PI / 2;
  lip.position.y = height - 0.01;
  group.add(lip);

  // Exposed roots
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rand(-0.15, 0.15);
    const r = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.07, 0.35, 8, 16),
      fuzzyMat({ color: vary(COL.bark, 0.1), roughness: 0.9 })
    );
    r.position.set(Math.cos(a) * radius * 0.95, 0.08, Math.sin(a) * radius * 0.95);
    r.rotation.z = Math.cos(a) * 0.6;
    r.rotation.x = Math.sin(a) * 0.6;
    r.castShadow = r.receiveShadow = true;
    group.add(r);
  }

  // Tiny moss patches on the side
  for (let i = 0; i < 3; i++) {
    const a = rand(0, Math.PI * 2);
    const moss = new THREE.Mesh(
      new THREE.SphereGeometry(rand(0.15, 0.22), 20, 14, 0, Math.PI * 2, 0, Math.PI / 2.3),
      fuzzyMat(
        { color: vary(COL.moss, 0.1), roughness: 0.95 },
        { sheen: 1.2, sheenRoughness: 0.85, sheenColor: '#d0e8a8' },
      )
    );
    moss.position.set(Math.cos(a) * radius * 0.96, rand(0.15, height - 0.2), Math.sin(a) * radius * 0.96);
    moss.lookAt(moss.position.x * 3, moss.position.y, moss.position.z * 3);
    moss.scale.set(rand(0.8, 1.3), rand(0.5, 0.8), rand(0.8, 1.3));
    group.add(moss);
  }

  // A tiny stemmed mushroom perched on top
  const mush = createMushroom(0.18);
  mush.position.set(rand(-0.25, 0.25), height, rand(-0.2, 0.2));
  group.add(mush);

  return group;
}

// Generate a painterly growth-rings canvas texture for the stump top
function makeRingsTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  // Base warm wood
  const grad = ctx.createRadialGradient(size/2, size/2, 10, size/2, size/2, size/2);
  grad.addColorStop(0,   '#b38759');
  grad.addColorStop(0.6, '#9a6c3f');
  grad.addColorStop(1,   '#6b4a2a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Concentric rings (slightly wavy)
  ctx.strokeStyle = 'rgba(70,45,22,0.55)';
  ctx.lineWidth = 2;
  for (let r = 12; r < size/2 - 10; r += 10 + Math.random() * 6) {
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.02; a += 0.08) {
      const wobble = Math.sin(a * 7 + r * 0.3) * 1.6;
      const x = size/2 + Math.cos(a) * (r + wobble);
      const y = size/2 + Math.sin(a) * (r + wobble);
      if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Radial cracks
  ctx.strokeStyle = 'rgba(45,28,14,0.7)';
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 4; i++) {
    const a = Math.random() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(size/2, size/2);
    let r = 0;
    let cx = size/2, cy = size/2;
    while (r < size/2 - 20) {
      r += 6 + Math.random() * 5;
      cx = size/2 + Math.cos(a + Math.sin(r*0.1)*0.1) * r;
      cy = size/2 + Math.sin(a + Math.sin(r*0.1)*0.1) * r;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  // Soft vignette on the rim (wear)
  const rim = ctx.createRadialGradient(size/2, size/2, size*0.35, size/2, size/2, size/2);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, 'rgba(50,28,10,0.45)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// --- Fallen log ---
function createLog({ length = 2.0, radius = 0.3 } = {}) {
  const group = new THREE.Group();

  const barkCol = vary(COL.bark, 0.08);
  const geo = new THREE.CylinderGeometry(radius, radius * 1.02, length, 36, 5, false);
  // Bark ridges
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ang = Math.atan2(v.z, v.x);
    const ridge = Math.sin(ang * 12 + v.y * 0.8) * 0.02;
    const r = Math.hypot(v.x, v.z);
    if (r > 0.01) {
      pos.setX(i, v.x + (v.x / r) * ridge);
      pos.setZ(i, v.z + (v.z / r) * ridge);
    }
  }
  geo.computeVertexNormals();
  const mat = fuzzyMat({
    color: barkCol, roughness: 0.9,
  });
  const log = new THREE.Mesh(geo, mat);
  log.rotation.z = Math.PI / 2;  // lay on its side along X
  log.castShadow = log.receiveShadow = true;
  group.add(log);

  // Ring end-caps (slightly different)
  const capMat = fuzzyMat({
    color: vary(COL.barkRing, 0.06), roughness: 0.85,
  });
  for (const s of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.CircleGeometry(radius, 36), capMat);
    cap.position.x = s * length / 2;
    cap.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    group.add(cap);
  }

  // A few moss tufts on top
  const tuftCount = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < tuftCount; i++) {
    const tuft = new THREE.Mesh(
      new THREE.SphereGeometry(rand(0.08, 0.14), 16, 12, 0, Math.PI * 2, 0, Math.PI / 2.2),
      fuzzyMat(
        { color: vary(COL.moss, 0.1), roughness: 0.95 },
        { sheen: 1.2, sheenRoughness: 0.85, sheenColor: '#d0e8a8' },
      )
    );
    tuft.position.set(rand(-length/2 + 0.2, length/2 - 0.2), radius * 0.95, rand(-0.05, 0.05));
    tuft.scale.set(rand(1, 1.4), rand(0.5, 0.8), rand(1, 1.4));
    group.add(tuft);
  }

  return group;
}

// --- Rock ---
function createRock(scale = 1) {
  const geo = new THREE.IcosahedronGeometry(0.4, 3);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  // Use a few random low-frequency sinusoid components to make smooth boulder
  // lobes rather than jagged per-vertex noise. This keeps the silhouette round.
  const seedA = Math.random() * 10, seedB = Math.random() * 10, seedC = Math.random() * 10;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const nx = v.x / 0.4, ny = v.y / 0.4, nz = v.z / 0.4;
    const lump =
        Math.sin(nx * 1.8 + seedA) * 0.10 +
        Math.cos(ny * 1.6 + seedB) * 0.10 +
        Math.sin(nz * 2.1 + seedC) * 0.08;
    const f = 1.0 + lump;
    v.multiplyScalar(f);
    v.y *= 0.78;    // squash top a bit
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const mat = fuzzyMat({
    color: vary(COL.rock, 0.08),
    roughness: 0.92,
  }, { sheen: 0.35, sheenRoughness: 0.95 });   // stones are barely fuzzy
  const rock = new THREE.Mesh(geo, mat);
  rock.castShadow = rock.receiveShadow = true;
  rock.scale.setScalar(scale);
  return rock;
}

// --- Mushroom: red cap + white spots + cream stem ---
function createMushroom(scale = 1) {
  const group = new THREE.Group();

  const stemH = 0.22;
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.075, stemH, 20),
    fuzzyMat({ color: vary(COL.mushStem, 0.04), roughness: 0.8 })
  );
  stem.position.y = stemH / 2;
  stem.castShadow = stem.receiveShadow = true;
  group.add(stem);

  // Cap — half sphere
  const capGeo = new THREE.SphereGeometry(0.18, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const capMat = fuzzyMat({
    color: vary(COL.mushCap, 0.06),
    roughness: 0.55,
    metalness: 0.0,
  }, { sheen: 1.3, sheenRoughness: 0.78, sheenColor: '#ffd0b6' });   // velvety cap
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.position.y = stemH + 0.02;
  cap.castShadow = true;
  group.add(cap);

  // Gills underside (simple flat disc)
  const gills = new THREE.Mesh(
    new THREE.CircleGeometry(0.16, 28),
    fuzzyMat({ color: vary(COL.mushStem, 0.06), roughness: 0.9, side: THREE.DoubleSide })
  );
  gills.rotation.x = Math.PI / 2;
  gills.position.y = stemH + 0.015;
  group.add(gills);

  // White spots
  const spotMat = fuzzyMat({ color: COL.mushSpot, roughness: 0.6 });
  const spotCount = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < spotCount; i++) {
    const u = Math.random() * Math.PI * 2;
    const t = Math.random() * 0.8;
    const r = 0.18;
    const x = Math.sin(t) * Math.cos(u) * r;
    const z = Math.sin(t) * Math.sin(u) * r;
    const y = Math.cos(t) * r;
    const spot = new THREE.Mesh(new THREE.SphereGeometry(0.02 + Math.random() * 0.015, 14, 10), spotMat);
    spot.position.set(x, cap.position.y + y - 0.005, z);
    group.add(spot);
  }

  group.scale.setScalar(scale);
  return group;
}

// --- Fern: several curved blades radiating from a base ---
function createFern(scale = 1) {
  const group = new THREE.Group();
  const baseColor = vary(COL.leaf, 0.1);

  const count = 6 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) {
    const blade = createFernBlade(vary(baseColor, 0.08));
    blade.rotation.y = (i / count) * Math.PI * 2 + rand(-0.1, 0.1);
    blade.rotation.z = rand(-0.08, 0.08);
    // tilt blades outward slightly
    blade.rotation.x = rand(-0.08, -0.02);
    blade.scale.setScalar(rand(0.85, 1.15));
    group.add(blade);
  }

  // Small secondary leaves
  for (let i = 0; i < 3; i++) {
    const leaflet = createFernBlade(vary(COL.leafLight, 0.08));
    leaflet.rotation.y = rand(0, Math.PI * 2);
    leaflet.rotation.x = rand(-0.25, -0.15);
    leaflet.scale.setScalar(rand(0.4, 0.6));
    leaflet.position.y = 0.02;
    group.add(leaflet);
  }

  group.scale.setScalar(scale);
  return group;
}

function createFernBlade(color) {
  // Leaf shape in XY plane, pointing along +X
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.25, 0.12, 0.6, 0.18, 1.0, 0.06);
  shape.bezierCurveTo(1.08, 0, 1.08, 0, 1.0, -0.06);
  shape.bezierCurveTo(0.6, -0.18, 0.25, -0.12, 0, 0);
  const geom = new THREE.ShapeGeometry(shape, 40);
  // Rotate into XZ so leaf lies flat, tip at +X
  geom.rotateX(-Math.PI / 2);
  // Scale the blade length
  geom.scale(0.9, 1, 0.9);

  // Bend: tip rises in Y, edges curl slightly
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const lift = Math.pow(Math.max(x, 0), 1.6) * 0.55;      // tip up
    const curl = Math.pow(Math.max(x, 0), 1.2) * Math.abs(z) * 0.6; // edge curl
    pos.setY(i, pos.getY(i) + lift + curl);
  }
  geom.computeVertexNormals();

  const mat = fuzzyMat({
    color: color,
    roughness: 0.82,
    metalness: 0,
    side: THREE.DoubleSide,
    flatShading: false,
  }, { sheen: 1.3, sheenRoughness: 0.8, sheenColor: '#e8f0c4' });  // green peach-fuzz
  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// --- Grass clump: three thin bent blades ---
function createGrassClump(scale = 1) {
  const group = new THREE.Group();
  const blades = 3 + Math.floor(Math.random() * 2);
  const color = vary(COL.grassDark, 0.12);
  for (let i = 0; i < blades; i++) {
    const g = new THREE.PlaneGeometry(0.04, rand(0.25, 0.42), 1, 4);
    // Bend blade slightly forward
    const pos = g.attributes.position;
    for (let j = 0; j < pos.count; j++) {
      const y = pos.getY(j);
      const t = (y + 0.2) / 0.5;
      pos.setZ(j, pos.getZ(j) + Math.pow(Math.max(t, 0), 2) * 0.08);
    }
    g.computeVertexNormals();
    g.translate(0, 0.2, 0);
    const m = fuzzyMat({
      color: vary(color, 0.06), roughness: 0.9,
      side: THREE.DoubleSide,
    }, { sheen: 1.4, sheenRoughness: 0.78, sheenColor: '#e0ecb4' });  // grass fuzz
    const blade = new THREE.Mesh(g, m);
    blade.rotation.y = (i / blades) * Math.PI * 2 + rand(-0.3, 0.3);
    blade.rotation.z = rand(-0.1, 0.1);
    blade.position.y = 0;
    blade.castShadow = false; // grass is small enough; skip to save perf
    group.add(blade);
  }
  group.scale.setScalar(scale);
  return group;
}

// --- Hero flower: a layered peony-style bloom on a slender stem ---
// This is the "perfume" centrepiece: larger, detailed, lightly emissive petals,
// framed by two stylised leaves.
function createHeroFlower() {
  const group = new THREE.Group();

  // --- Stem (slight curve using two stacked cylinders) ---
  const stemMat = fuzzyMat({
    color: vary(COL.leaf, 0.08), roughness: 0.85,
  });
  const stemLower = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.03, 0.55, 14),
    stemMat,
  );
  stemLower.position.y = 0.27;
  stemLower.rotation.z = -0.06;
  stemLower.castShadow = true;
  group.add(stemLower);

  const stemUpper = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.025, 0.45, 14),
    stemMat,
  );
  stemUpper.position.set(0.03, 0.75, 0);
  stemUpper.rotation.z = 0.08;
  stemUpper.castShadow = true;
  group.add(stemUpper);

  // --- Two base leaves (reused fern-blade builder, darker/larger) ---
  for (let i = 0; i < 2; i++) {
    const leaf = createFernBlade(vary(COL.leaf, 0.06));
    leaf.scale.setScalar(0.75);
    leaf.rotation.y = i === 0 ? 0.6 : Math.PI - 0.4;
    leaf.rotation.x = -0.18;
    leaf.position.y = 0.12;
    group.add(leaf);
  }

  // --- Flower head ---
  const head = new THREE.Group();
  head.position.set(0.08, 1.0, 0);
  head.rotation.set(-0.15, 0, 0.05);
  group.add(head);

  const headColor = COL.petalBlush.clone();
  const innerColor = COL.petalRose.clone();

  // Sepal / calyx — small green cup beneath the petals
  const calyx = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 20, 14, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45),
    fuzzyMat({
      color: vary(COL.leaf, 0.06),
      roughness: 0.85,
      side: THREE.DoubleSide,
    }),
  );
  calyx.position.y = -0.05;
  calyx.castShadow = true;
  head.add(calyx);

  // Layered petals — three rings, decreasing in size, rotated between rings
  const ringSpecs = [
    { count: 8, radius: 0.17, size: 0.16, tilt: 0.45, y: 0.00, color: headColor,   open: 1.0 },
    { count: 7, radius: 0.11, size: 0.13, tilt: 0.75, y: 0.04, color: headColor.clone().lerp(innerColor, 0.35), open: 0.85 },
    { count: 6, radius: 0.07, size: 0.10, tilt: 1.05, y: 0.07, color: innerColor,  open: 0.6 },
  ];

  ringSpecs.forEach((ring, ringIdx) => {
    const petalMat = fuzzyMat({
      color: vary(ring.color, 0.04),
      roughness: 0.5,
      metalness: 0.0,
      side: THREE.DoubleSide,
      emissive: ring.color.clone().multiplyScalar(0.15),
      emissiveIntensity: 0.6,
    }, { sheen: 1.5, sheenRoughness: 0.7, sheenColor: '#ffe0d8' }); // velvet petal
    for (let i = 0; i < ring.count; i++) {
      const petal = createPetal(ring.size, ring.open);
      petal.material = petalMat;
      const a = (i / ring.count) * Math.PI * 2 + ringIdx * 0.25;
      petal.position.set(
        Math.cos(a) * ring.radius,
        ring.y,
        Math.sin(a) * ring.radius,
      );
      // orient outward & tilt up toward center
      petal.rotation.y = -a + Math.PI / 2;
      petal.rotation.x = -ring.tilt;
      petal.rotation.z = rand(-0.08, 0.08);
      petal.castShadow = true;
      head.add(petal);
    }
  });

  // Inner bud — small clustered sphere core
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 20, 14),
    fuzzyMat({
      color: innerColor.clone().lerp(COL.petalYellow, 0.3),
      roughness: 0.55,
      emissive: innerColor.clone().multiplyScalar(0.35),
      emissiveIntensity: 0.7,
    }),
  );
  core.position.y = 0.09;
  head.add(core);

  // A few pollen dots
  const pollenMat = fuzzyMat({
    color: COL.petalYellow, roughness: 0.5,
    emissive: COL.petalYellow.clone().multiplyScalar(0.4), emissiveIntensity: 0.5,
  }, { sheen: 0 });
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.05;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), pollenMat);
    dot.position.set(Math.cos(a) * r, 0.13 + Math.random() * 0.02, Math.sin(a) * r);
    head.add(dot);
  }

  return group;
}

// A single curved petal shape — like a cupped teardrop
function createPetal(size = 0.15, openness = 1.0) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(size * 0.6,  size * 0.1, size * 0.9,  size * 0.55, size * 0.2, size * 1.0);
  shape.bezierCurveTo(size * 0.05, size * 1.05, -size * 0.05, size * 1.05, -size * 0.2, size * 1.0);
  shape.bezierCurveTo(-size * 0.9, size * 0.55, -size * 0.6, size * 0.1, 0, 0);
  const geom = new THREE.ShapeGeometry(shape, 32);
  // Orient: shape is in XY (+Y = petal length). Rotate to XZ so Y stays up-ish after later rotation.
  geom.rotateX(-Math.PI / 2);
  // Bend: cup petal inward (tip lifts up; edges curl slightly)
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // z now goes from 0 at base to ~size at tip
    const t = Math.max(z, 0) / size;
    const cup = Math.pow(t, 1.4) * size * 0.6 * openness;
    const edge = Math.pow(Math.abs(x) / size, 1.2) * size * 0.35 * openness;
    pos.setY(i, pos.getY(i) + cup + edge);
  }
  geom.computeVertexNormals();
  // placeholder material, replaced by caller
  const mat = fuzzyMat({ color: 0xffffff, side: THREE.DoubleSide });
  return new THREE.Mesh(geom, mat);
}

// --- Small flower: stem + cross-petals + center ---
function createFlower() {
  const group = new THREE.Group();

  const stemH = rand(0.16, 0.24);
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, stemH, 10),
    fuzzyMat({ color: COL.leaf, roughness: 0.9 })
  );
  stem.position.y = stemH / 2;
  group.add(stem);

  const col = pick([COL.petalYellow, COL.petalWhite, COL.petalPink]);
  const petalMat = fuzzyMat({
    color: vary(col, 0.06), roughness: 0.65, side: THREE.DoubleSide,
  }, { sheen: 1.3, sheenRoughness: 0.72, sheenColor: '#ffe6d8' });   // small petal fuzz

  const petals = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(0.05, 18, 0, Math.PI), petalMat);
    p.rotation.z = (i / 5) * Math.PI * 2;
    p.position.y = 0.04;
    petals.add(p);
  }
  petals.position.y = stemH;
  petals.rotation.x = -Math.PI / 2;
  group.add(petals);

  // Center bead
  const center = new THREE.Mesh(
    new THREE.SphereGeometry(0.018, 14, 10),
    fuzzyMat({ color: COL.petalYellow, roughness: 0.55, emissive: COL.petalYellow.clone().multiplyScalar(0.12) })
  );
  center.position.y = stemH + 0.01;
  group.add(center);

  return group;
}

// --- Moss ring at base of stump ---
function createMossRing(radius) {
  const group = new THREE.Group();
  const count = 22;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rand(-0.05, 0.05);
    const r = radius * rand(0.85, 1.12);
    const tuft = new THREE.Mesh(
      new THREE.SphereGeometry(rand(0.07, 0.12), 16, 12, 0, Math.PI * 2, 0, Math.PI / 2.2),
      fuzzyMat(
        { color: vary(COL.moss, 0.1), roughness: 0.95 },
        { sheen: 1.2, sheenRoughness: 0.85, sheenColor: '#d0e8a8' },
      )
    );
    tuft.position.set(Math.cos(a) * r, 0.02, Math.sin(a) * r);
    tuft.scale.set(rand(0.9, 1.4), rand(0.5, 0.8), rand(0.9, 1.4));
    tuft.receiveShadow = true;
    group.add(tuft);
  }
  return group;
}

// --- Firefly dust: tiny glowing points drifting in the scene ---
let dust = null;
let dustBase = null;          // base positions we oscillate *around* (no drift)

function addFireflyDust() {
  const count = 60;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  dustBase = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 1.5 + Math.random() * 4.5;
    const bx = Math.cos(a) * r;
    const by = 0.8 + Math.random() * 2.2;
    const bz = Math.sin(a) * r;
    positions[i*3+0] = bx;
    positions[i*3+1] = by;
    positions[i*3+2] = bz;
    dustBase[i*3+0] = bx;
    dustBase[i*3+1] = by;
    dustBase[i*3+2] = bz;
    phases[i] = Math.random() * Math.PI * 2;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('phase',    new THREE.BufferAttribute(phases, 1));

  const mat = new THREE.PointsMaterial({
    color: COL.firefly,
    size: 0.09,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  dust = new THREE.Points(geo, mat);
  scene.add(dust);
}

// ═════════════════════════════════════════════════════════════════════════════
//  PLAYER (a small firefly lantern)
// ═════════════════════════════════════════════════════════════════════════════
function createPlayer() {
  player = new THREE.Group();

  // Main orb
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 16, 12),
    fuzzyMat({
      color: 0xfff1c7,
      emissive: 0xffd88a,
      emissiveIntensity: 2.4,
      roughness: 0.3,
    }, { sheen: 0 })   // no fuzz on the glowing firefly orb
  );
  orb.castShadow = false;
  player.add(orb);

  // Soft halo
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 16, 12),
    new THREE.MeshBasicMaterial({
      color: 0xfff1c7,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  player.add(halo);

  // Tiny warm point light
  playerGlow = new THREE.PointLight(0xffd88a, 1.6, 4.5, 2);
  playerGlow.castShadow = false;
  player.add(playerGlow);

  player.position.copy(playerState.pos);
  player.position.y = snapToIsland(playerState.pos.x, playerState.pos.z) + 0.55;
  scene.add(player);
}

// ═════════════════════════════════════════════════════════════════════════════
//  POST PROCESSING
// ═════════════════════════════════════════════════════════════════════════════
// We keep a reference to the diffusion pass so resize can update uResolution.
let diffusionPass = null;

function setupPostprocessing() {
  composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(window.innerWidth, window.innerHeight);

  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.38,   // strength — soft
    0.9,    // radius
    0.82,   // threshold — only highlights bloom
  );
  composer.addPass(bloom);

  // ─── "Dreamy Diffusion" pass ────────────────────────────────────────────
  // A translucent soft-focus film:
  //   · a tiny multi-tap blur
  //   · screen-blended back over the original (creamy subsurface glow)
  //   · micro chromatic offset on the blurred layer (smeared silhouettes)
  //   · gentle desaturation + warm ivory tint (pastel palette)
  // Every amount is deliberately TINY.
  diffusionPass = new ShaderPass({
    uniforms: {
      tDiffuse:    { value: null },
      uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      uAmount:     { value: 0.20 },   // how much diffused layer bleeds in
      uSpread:     { value: 1.8 },    // blur radius in texels
      uChroma:     { value: 2.2 },    // colour smear in *pixels at corner*
      uWarm:       { value: 0.12 },   // warm ivory tint amount
      uPastel:     { value: 0.06 },   // desat amount
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      precision highp float;
      uniform sampler2D tDiffuse;
      uniform vec2  uResolution;
      uniform float uAmount;
      uniform float uSpread;
      uniform float uChroma;
      uniform float uWarm;
      uniform float uPastel;
      varying vec2 vUv;

      // 8-tap ring + center box blur (cheap, gaussian-ish).
      vec3 softBlur(vec2 uv, vec2 px) {
        vec3 c = texture2D(tDiffuse, uv).rgb * 0.28;
        // inner ring
        c += texture2D(tDiffuse, uv + vec2( px.x, 0.0)).rgb * 0.10;
        c += texture2D(tDiffuse, uv + vec2(-px.x, 0.0)).rgb * 0.10;
        c += texture2D(tDiffuse, uv + vec2( 0.0,  px.y)).rgb * 0.10;
        c += texture2D(tDiffuse, uv + vec2( 0.0, -px.y)).rgb * 0.10;
        // outer ring (diagonals, slightly farther)
        vec2 d = px * 1.4;
        c += texture2D(tDiffuse, uv + vec2( d.x,  d.y)).rgb * 0.08;
        c += texture2D(tDiffuse, uv + vec2(-d.x,  d.y)).rgb * 0.08;
        c += texture2D(tDiffuse, uv + vec2( d.x, -d.y)).rgb * 0.08;
        c += texture2D(tDiffuse, uv + vec2(-d.x, -d.y)).rgb * 0.08;
        return c;
      }

      void main() {
        vec4 orig = texture2D(tDiffuse, vUv);

        vec2 px = uSpread / uResolution;

        // Base soft-blur layer
        vec3 blur = softBlur(vUv, px);

        // Tiny chromatic offset on the blurred layer (smeared silhouettes).
        // Scale grows with distance from screen centre (lens-like aberration).
        // uChroma is expressed in *pixels at the corner*.
        vec2 cDir = vUv - 0.5;
        vec2 cOff = cDir * uChroma / uResolution;
        vec3 chroma;
        chroma.r = texture2D(tDiffuse, vUv + cOff).r;
        chroma.g = blur.g;
        chroma.b = texture2D(tDiffuse, vUv - cOff).b;
        blur = mix(blur, chroma, 0.4);

        // "Creamy subsurface glow": screen-blend blur over original at uAmount.
        vec3 screen = 1.0 - (1.0 - orig.rgb) * (1.0 - blur * 0.55);
        vec3 result = mix(orig.rgb, screen, uAmount);

        // Lift deep shadows ever so slightly (never-black requirement).
        result = max(result, orig.rgb * 0.98 + vec3(0.008, 0.008, 0.006));

        // Warm ivory tint
        vec3 warm = result * vec3(1.025, 1.005, 0.965);
        result = mix(result, warm, uWarm);

        // Low-contrast pastel (desaturate toward luma)
        float luma = dot(result, vec3(0.299, 0.587, 0.114));
        result = mix(result, vec3(luma), uPastel);

        gl_FragColor = vec4(result, orig.a);
      }`,
  });
  composer.addPass(diffusionPass);

  // Vignette + gentle color grade
  const vignette = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uStrength: { value: 0.55 },
      uWarmth:   { value: 0.03 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float uStrength;
      uniform float uWarmth;
      varying vec2 vUv;
      void main() {
        vec4 col = texture2D(tDiffuse, vUv);
        col.r = min(col.r + uWarmth * 0.6, 1.0);
        col.b = max(col.b - uWarmth * 0.3, 0.0);
        vec2 q = vUv - 0.5;
        float d = dot(q, q);
        float v = smoothstep(0.25, 0.7, d);
        col.rgb *= mix(1.0, 1.0 - uStrength, v);
        gl_FragColor = col;
      }`,
  });
  composer.addPass(vignette);

  composer.addPass(new OutputPass());
}

// ═════════════════════════════════════════════════════════════════════════════
//  CONTROLS — third-person: WASD / Arrows (W/S move, A/D turn)
// ═════════════════════════════════════════════════════════════════════════════
function setupControls() {
  window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
}

function updatePlayer(dt) {
  // Input
  const turn = ((keys['KeyA'] || keys['ArrowLeft']) ? 1 : 0) -
               ((keys['KeyD'] || keys['ArrowRight']) ? 1 : 0);
  const fwd  = ((keys['KeyW'] || keys['ArrowUp'])   ? 1 : 0) -
               ((keys['KeyS'] || keys['ArrowDown']) ? 1 : 0);

  // Turn
  playerState.yaw += turn * 2.2 * dt;

  // Forward direction based on yaw
  const speed = 2.3;
  const dx = Math.sin(playerState.yaw) * fwd * speed * dt;
  const dz = Math.cos(playerState.yaw) * fwd * speed * dt;

  // Proposed next position
  let nx = playerState.pos.x + dx;
  let nz = playerState.pos.z + dz;

  // Constrain to island top circle (keep away from edge)
  const maxR = 4.6;
  const r = Math.hypot(nx, nz);
  if (r > maxR) {
    nx = (nx / r) * maxR;
    nz = (nz / r) * maxR;
  }
  playerState.pos.x = nx;
  playerState.pos.z = nz;

  // Hover height — never clips into ground
  const groundY = snapToIsland(nx, nz);
  const hoverBob = Math.sin(clock.elapsedTime * 2.0) * 0.05;
  playerState.pos.y = groundY + 0.58 + hoverBob;

  // Apply to mesh
  player.position.copy(playerState.pos);
  player.rotation.y = playerState.yaw;

  // Player light pulses gently
  playerGlow.intensity = 1.5 + Math.sin(clock.elapsedTime * 2.4) * 0.25;
}

// ═════════════════════════════════════════════════════════════════════════════
//  INTERACTION — raycast hover + floating HTML label
// ═════════════════════════════════════════════════════════════════════════════
function addInteractable(obj) {
  // Walk descendants, tag them as part of this interactable group.
  obj.traverse(child => {
    if (child.isMesh) child.userData.__interactRoot = obj;
  });
  // Cache original scale + emissive per child material (so hover can lerp)
  obj.userData.__hover = 0;       // 0..1
  obj.userData.__targetHover = 0;
  obj.userData.__origScale = obj.scale.clone();
  obj.userData.__mats = [];
  obj.traverse(child => {
    if (child.isMesh && child.material && child.material.emissive) {
      obj.userData.__mats.push({
        mat: child.material,
        origEmissive: child.material.emissive.clone(),
        origIntensity: child.material.emissiveIntensity ?? 1,
      });
    }
  });
  interactables.push(obj);
}

function setupInteraction() {
  window.addEventListener('pointermove', (e) => {
    pointerNdc.x =  (e.clientX / window.innerWidth) * 2 - 1;
    pointerNdc.y = -(e.clientY / window.innerHeight) * 2 + 1;
  });
  window.addEventListener('pointerleave', () => {
    pointerNdc.set(-2, -2);
  });
  window.addEventListener('click', (e) => {
    const root = pickInteractableAtClientPos(e.clientX, e.clientY);
    if (!root) return;
    const label = (root.userData.label || '').toLowerCase();
    const url = ASSET_LINKS[label];
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  });
}

function getInteractableMeshes() {
  const meshes = [];
  interactables.forEach(root => {
    root.traverse(c => { if (c.isMesh) meshes.push(c); });
  });
  return meshes;
}

function pickInteractableAtNdc(ndcX, ndcY) {
  const meshes = getInteractableMeshes();
  raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
  const hits = raycaster.intersectObjects(meshes, false);
  if (!hits.length) return null;
  return hits[0].object.userData.__interactRoot || null;
}

function pickInteractableAtClientPos(clientX, clientY) {
  const ndcX =  (clientX / window.innerWidth) * 2 - 1;
  const ndcY = -(clientY / window.innerHeight) * 2 + 1;
  return pickInteractableAtNdc(ndcX, ndcY);
}

function updateHover(dt) {
  let newHoveredRoot = pickInteractableAtNdc(pointerNdc.x, pointerNdc.y);

  if (newHoveredRoot !== hoveredRoot) {
    if (hoveredRoot) hoveredRoot.userData.__targetHover = 0;
    hoveredRoot = newHoveredRoot;
    if (hoveredRoot) {
      hoveredRoot.userData.__targetHover = 1;
      // populate label
      labelText.textContent = hoveredRoot.userData.label || 'unnamed';
      labelSub.textContent  = hoveredRoot.userData.scent
                           || hoveredRoot.userData.sub
                           || 'soft · ambient · unknown';
    }
  }

  // Lerp hover states for every interactable
  interactables.forEach(obj => {
    const ud = obj.userData;
    ud.__hover += (ud.__targetHover - ud.__hover) * Math.min(1, dt * 8.0);
    const k = ud.__hover;
    // scale
    const s = 1 + k * 0.045;
    obj.scale.copy(ud.__origScale).multiplyScalar(s);
    // emissive boost
    ud.__mats.forEach(m => {
      m.mat.emissive.copy(m.origEmissive).lerp(new THREE.Color(0xfff0c4), k * 0.45);
      m.mat.emissiveIntensity = (m.origIntensity || 1) + k * 0.7;
    });
  });

  // Label positioning / fade
  if (hoveredRoot) {
    // compute a slightly-above-object anchor
    const box = new THREE.Box3().setFromObject(hoveredRoot);
    const size = box.getSize(new THREE.Vector3());
    const anchor = new THREE.Vector3(
      (box.min.x + box.max.x) / 2,
      box.max.y + Math.min(0.25, size.y * 0.15),
      (box.min.z + box.max.z) / 2,
    );
    const projected = anchor.clone().project(camera);
    const x = (projected.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-projected.y * 0.5 + 0.5) * window.innerHeight;
    const inFront = projected.z > -1 && projected.z < 1;
    if (inFront) {
      labelEl.style.left = x + 'px';
      labelEl.style.top  = y + 'px';
      labelEl.classList.add('visible');
    } else {
      labelEl.classList.remove('visible');
    }
  } else {
    labelEl.classList.remove('visible');
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  ANIMATION LOOP
// ═════════════════════════════════════════════════════════════════════════════
function updateCamera(dt) {
  // Third-person offset: behind and above the player, in local (yaw) space.
  // Local forward is +Z (matches movement), so "behind" is -Z.
  const offset = new THREE.Vector3(0, 1.9, -3.6);
  // Rotate offset by player yaw around Y
  const cos = Math.cos(playerState.yaw);
  const sin = Math.sin(playerState.yaw);
  const ox =  offset.x * cos + offset.z * sin;
  const oz = -offset.x * sin + offset.z * cos;

  camTarget.set(
    playerState.pos.x + ox,
    playerState.pos.y + offset.y,
    playerState.pos.z + oz,
  );
  // Subtle camera idle drift
  const t = clock.elapsedTime;
  camTarget.x += Math.sin(t * 0.25) * 0.06;
  camTarget.y += Math.sin(t * 0.33) * 0.04;

  camLookTarget.set(
    playerState.pos.x,
    playerState.pos.y + 0.1,
    playerState.pos.z,
  );

  // Frame-rate independent exponential smoothing.
  // Lower damping  = more lag  (softer follow).
  // We deliberately let the camera lag a bit behind the look target for "game feel".
  const aPos  = 1 - Math.exp(-dt * 3.5);
  const aLook = 1 - Math.exp(-dt * 5.0);
  camCurrent.lerp(camTarget, aPos);
  camLookCurrent.lerp(camLookTarget, aLook);

  // Prevent camera dipping into island top
  const camMinY = snapToIsland(camCurrent.x, camCurrent.z) + 0.6;
  if (camCurrent.y < camMinY) camCurrent.y = camMinY;

  camera.position.copy(camCurrent);
  camera.lookAt(camLookCurrent);
}

function updateSway(dt) {
  const t = clock.elapsedTime;
  swayables.forEach(s => {
    const a = Math.sin(t * s.speed + s.phase) * s.amt;
    const b = Math.cos(t * s.speed * 0.7 + s.phase) * s.amt * 0.6;
    s.obj.rotation.z = a;
    s.obj.rotation.x = b;
  });

  if (dust && dustBase) {
    const pos = dust.geometry.attributes.position;
    const phase = dust.geometry.attributes.phase;
    for (let i = 0; i < pos.count; i++) {
      const ph = phase.getX(i);
      const bx = dustBase[i*3+0];
      const by = dustBase[i*3+1];
      const bz = dustBase[i*3+2];
      pos.setX(i, bx + Math.sin(t * 0.4 + ph) * 0.25);
      pos.setY(i, by + Math.sin(t * 0.7 + ph) * 0.20);
      pos.setZ(i, bz + Math.cos(t * 0.35 + ph * 1.3) * 0.25);
    }
    pos.needsUpdate = true;
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 1 / 30);

  updatePlayer(dt);
  updateCamera(dt);
  updateSway(dt);
  updateHover(dt);

  composer.render();
}

// ═════════════════════════════════════════════════════════════════════════════
//  RESIZE
// ═════════════════════════════════════════════════════════════════════════════
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  if (diffusionPass) {
    diffusionPass.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
  }
}

// ─── go ──────────────────────────────────────────────────────────────────────
init();
