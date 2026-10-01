import * as THREE from '../vendor/three.module.min.js';

// Everything is geometry. No models, textures, CDN, backend, or build step.
const DURATION = 60;
const MAX_SPIDERS = 10;
const SPIDER_SPEED_MULTIPLIER = 3;
const GOLD_INTERVAL = 10000;
const $ = (id) => document.getElementById(id);
const rand = (min, max) => min + Math.random() * (max - min);
const integer = (min, max) => Math.floor(rand(min, max + 1));
const pick = (items) => items[integer(0, items.length - 1)];
const scene = new THREE.Scene();
scene.background = new THREE.Color('#d9c9a7');
const camera = new THREE.OrthographicCamera(-12, 12, 7, -7, 0.1, 80);
camera.position.set(0, 30, 0);
camera.up.set(0, 0, -1);
camera.lookAt(0, 0, 0);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const view = { width: 24, height: 14 };
const leaves = [];
const spiders = [];
const effects = [];
const leafLayer = new THREE.Group();
const spiderLayer = new THREE.Group();
const scenery = new THREE.Group();
scene.add(scenery, leafLayer, spiderLayer);
let renderer;
let phase = 'ready';
let score = 0;
let best = 0;
let deadline = 0;
let remaining = DURATION;
let nextSpawn = 0;
let nextGoldSpawn = 0;
let goldNoticeUntil = 0;
let lastFrame = performance.now();
let nextId = 1;
let soundEnabled = false;
let audioContext;
let testTime = null;
let testFrozen = false;
let lastLeafHint = -Infinity;
const now = () => testTime ?? performance.now();
const testMode = new URLSearchParams(location.search).has('test');
try { best = Number(localStorage.getItem('underleaf-best')) || 0; } catch { /* Private browsing is fine. */ }

const sphere = new THREE.SphereGeometry(1, 10, 7);
const segment = new THREE.CylinderGeometry(1, 1, 1, 5);
const pebble = new THREE.IcosahedronGeometry(1, 0);
const circle = new THREE.CircleGeometry(1, 8);
const leafMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
const stemMaterial = new THREE.MeshStandardMaterial({ color: '#617043', roughness: 1 });
const legMaterial = new THREE.MeshStandardMaterial({ color: '#433a31', roughness: 1 });
const eyeMaterial = new THREE.MeshStandardMaterial({ color: '#fff8de', roughness: .65 });
const pupilMaterial = new THREE.MeshStandardMaterial({ color: '#211e1a', roughness: .55 });
const bodyMaterials = ['#514635', '#61503b', '#524c3b', '#79553c'].map(color => new THREE.MeshStandardMaterial({ color, roughness: .9, flatShading: true }));
const goldBodyMaterial = new THREE.MeshStandardMaterial({ color: '#ffc52e', metalness: .55, roughness: .3, emissive: '#a96400', emissiveIntensity: .22, flatShading: true });
const goldLegMaterial = new THREE.MeshStandardMaterial({ color: '#dca122', metalness: .45, roughness: .38 });
const dotMaterial = new THREE.MeshStandardMaterial({ color: '#a8956b', roughness: 1 });
const scratchMaterial = new THREE.MeshBasicMaterial({ color: '#a39370' });
const up = new THREE.Vector3(0, 1, 0);

function mesh(geometry, material, parent, position, scale) {
  const object = new THREE.Mesh(geometry, material);
  if (position) object.position.set(...position);
  if (scale) object.scale.set(...scale);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}

function stick(parent, from, to, radius, material) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const direction = b.clone().sub(a);
  const object = mesh(segment, material, parent);
  object.position.copy(a.add(b).multiplyScalar(.5));
  object.scale.set(radius, direction.length(), radius);
  object.quaternion.setFromUnitVectors(up, direction.normalize());
  return object;
}

function makeGround() {
  const ground = mesh(new THREE.PlaneGeometry(150, 150), new THREE.MeshStandardMaterial({ color: '#d9c8a5', roughness: 1 }), scene);
  ground.rotation.x = -Math.PI / 2;
  ground.castShadow = false;
  const light = new THREE.HemisphereLight('#fff4d7', '#a69f7b', 2.65);
  scene.add(light);
  const sun = new THREE.DirectionalLight('#fff4d7', 3.1);
  sun.position.set(-7, 16, -8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: .1, far: 45 });
  sun.shadow.normalBias = .035;
  sun.shadow.bias = -.0002;
  sun.shadow.radius = 3;
  scene.add(sun);

  // Small low-poly grains are batched into one instanced mesh.
  const grains = new THREE.InstancedMesh(pebble, scratchMaterial, 1300);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 1300; i++) {
    dummy.position.set(rand(-24, 24), .006, rand(-24, 24));
    dummy.scale.set(rand(.012, .035), .01, rand(.014, .065));
    dummy.rotation.y = rand(0, Math.PI);
    dummy.updateMatrix();
    grains.setMatrixAt(i, dummy.matrix);
  }
  scene.add(grains);
}

function makeLeaf(color) {
  const group = new THREE.Group();
  group.userData.kind = 'leaf';
  const vertices = [];
  const colors = [];
  const base = new THREE.Color(color);
  const stations = 8;
  const edge = (i, side) => {
    const t = i / stations;
    return [side * Math.pow(Math.sin(t * Math.PI), .82) * .84, .035 * Math.sin(t * Math.PI), (t - .5) * 3.5];
  };
  const ridge = i => [0, .15 * Math.sin(i / stations * Math.PI), (i / stations - .5) * 3.5];
  const triangle = (a, b, c, shade) => {
    vertices.push(...a, ...b, ...c);
    const col = base.clone().multiplyScalar(shade);
    for (let k = 0; k < 3; k++) colors.push(col.r, col.g, col.b);
  };
  for (let i = 0; i < stations; i++) {
    for (const side of [-1, 1]) {
      const shade = (side === -1 ? .90 : 1.035) + rand(-.025, .025);
      triangle(ridge(i), edge(i, side), edge(i + 1, side), shade);
      triangle(ridge(i), edge(i + 1, side), ridge(i + 1), shade);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  mesh(geometry, leafMaterial, group);
  const veinMaterial = new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(.72), roughness: 1 });
  group.userData.veinMaterial = veinMaterial;
  for (let i = 0; i < stations; i++) {
    const a = ridge(i); const b = ridge(i + 1);
    a[1] += .016; b[1] += .016;
    stick(group, a, b, .015, veinMaterial);
  }
  for (let i = 2; i <= 6; i++) {
    for (const side of [-1, 1]) {
      const a = ridge(i - 1); const b = edge(i, side);
      a[1] += .018; b[0] *= .87; b[1] += .04;
      stick(group, a, b, .009, veinMaterial);
    }
  }
  stick(group, [0, .02, 1.66], [.06, -.03, 2.05], .028, stemMaterial);
  // Bake the blade, veins, and stem into one mesh: fewer draw calls on phones.
  const mergedPositions = [];
  const mergedColors = [];
  for (const part of group.children) {
    part.updateMatrix();
    const source = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    source.applyMatrix4(part.matrix);
    const positions = source.getAttribute('position');
    const partColors = source.getAttribute('color');
    for (let i = 0; i < positions.count; i++) {
      mergedPositions.push(positions.getX(i), positions.getY(i), positions.getZ(i));
      if (partColors) mergedColors.push(partColors.getX(i), partColors.getY(i), partColors.getZ(i));
      else mergedColors.push(part.material.color.r, part.material.color.g, part.material.color.b);
    }
    source.dispose();
  }
  geometry.dispose();
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(mergedPositions, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(mergedColors, 3));
  merged.computeVertexNormals();
  group.clear();
  mesh(merged, leafMaterial, group);
  return group;
}

function arrangeForest() {
  for (const leaf of leaves) {
    leaf.children[0].geometry.dispose();
    leaf.userData.veinMaterial.dispose();
  }
  leaves.length = 0;
  leafLayer.clear();
  scenery.traverse(object => { if (object.isMesh && object.material.userData.disposable) object.material.dispose(); });
  scenery.clear();
  const cols = view.width > 18 ? 5 : 3;
  const rows = view.height > 17 ? 6 : 4;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (Math.random() < .09) continue;
      const leaf = makeLeaf(pick(['#8a984f', '#a0a760', '#7c9157', '#bd9e4e', '#c29450', '#aabb70']));
      leaf.position.set(((col + .5 + rand(-.25, .25)) / cols - .5) * view.width, .94 + rand(0, .035), ((row + .5 + rand(-.26, .26)) / rows - .5) * view.height);
      leaf.rotation.y = rand(0, Math.PI * 2);
      leaf.rotation.z = rand(-.025, .025);
      const scale = rand(.76, 1.17);
      leaf.scale.set(scale * rand(.86, 1.2), 1, scale);
      leaf.userData.restY = leaf.rotation.y;
      leaf.userData.rustle = 0;
      leafLayer.add(leaf);
      leaves.push(leaf);
    }
  }
  const stoneMaterial = new THREE.MeshStandardMaterial({ color: '#b9ae91', roughness: 1 });
  stoneMaterial.userData.disposable = true;
  for (let i = 0; i < 32; i++) {
    const stone = mesh(pebble, stoneMaterial, scenery, [rand(-view.width / 2, view.width / 2), .035, rand(-view.height / 2, view.height / 2)], [rand(.07, .18), rand(.04, .10), rand(.07, .16)]);
    stone.rotation.y = rand(0, Math.PI);
  }
  // Little clover patches add detail without obstructing any spider.
  const cloverMaterial = new THREE.MeshStandardMaterial({ color: '#a4a877', roughness: 1, side: THREE.DoubleSide });
  cloverMaterial.userData.disposable = true;
  for (let i = 0; i < 17; i++) {
    const x = rand(-view.width / 2, view.width / 2);
    const z = rand(-view.height / 2, view.height / 2);
    for (let j = 0; j < 3; j++) {
      const angle = j * Math.PI * 2 / 3;
      const leaf = mesh(circle, cloverMaterial, scenery, [x + Math.sin(angle) * .09, .023, z + Math.cos(angle) * .09], [.09, .13, 1]);
      leaf.rotation.set(-Math.PI / 2, 0, angle);
      leaf.castShadow = false;
    }
  }
}

function makeSpider(x, z, golden = false) {
  // This guard applies to EVERY path that creates a spider, including batches.
  if (spiders.length >= MAX_SPIDERS) return null;
  const root = new THREE.Group();
  const bodyMaterial = golden ? goldBodyMaterial : pick(bodyMaterials);
  const spiderLegMaterial = golden ? goldLegMaterial : legMaterial;
  mesh(sphere, bodyMaterial, root, [0, .29, .15], [.28, .24, .35]);
  mesh(sphere, bodyMaterial, root, [0, .255, -.24], [.22, .18, .23]);
  for (const side of [-1, 1]) {
    mesh(sphere, eyeMaterial, root, [side * .107, .405, -.32], [.102, .081, .103]);
    mesh(sphere, pupilMaterial, root, [side * .109, .475, -.344], [.043, .028, .050]);
    mesh(sphere, eyeMaterial, root, [side * .109 - .013, .498, -.36], [.012, .009, .013]);
    mesh(sphere, golden ? eyeMaterial : dotMaterial, root, [side * .10, .50, .13], [.044, .012, .05]);
    mesh(sphere, bodyMaterial, root, [side * .1, .14, -.45], [.06, .065, .09]);
  }
  const legs = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const leg = new THREE.Group();
      leg.position.set(side * .15, .21, -.24 + i * .13);
      const spread = (i - 1.5) * .20;
      stick(leg, [0, 0, 0], [side * .28, .02, spread], .037, spiderLegMaterial);
      stick(leg, [side * .28, .02, spread], [side * .45, -.16, spread * 1.58], .025, spiderLegMaterial);
      root.add(leg);
      legs.push({ object: leg, side, phase: i * Math.PI + (side === 1 ? Math.PI : 0) });
    }
  }
  const angle = rand(-Math.PI, Math.PI);
  root.position.set(x, 0, z);
  root.rotation.y = angle;
  const spider = { id: nextId++, root, legs, angle, targetAngle: angle, golden, points: golden ? 5 : 1, speed: rand(.6, 1.02) * SPIDER_SPEED_MULTIPLIER, turnIn: rand(.6, 2.2), gait: rand(0, 6), age: 0 };
  root.userData.kind = 'spider';
  root.userData.spider = spider;
  spiderLayer.add(root);
  spiders.push(spider);
  return spider;
}

function spawnBatch(initial = false) {
  const count = integer(1, initial ? 4 : 3);
  for (let i = 0; i < count && spiders.length < MAX_SPIDERS; i++) {
    let x = rand(-view.width * .44, view.width * .44);
    let z = rand(-view.height * .40, view.height * .40);
    if (!initial && Math.random() < .55) {
      if (Math.random() < .5) x = pick([-1, 1]) * (view.width / 2 + .4);
      else z = pick([-1, 1]) * (view.height / 2 + .4);
    }
    const spider = makeSpider(x, z);
    if (spider && (Math.abs(x) > view.width * .44 || Math.abs(z) > view.height * .40)) {
      spider.angle = spider.targetAngle = Math.atan2(-x, -z) - Math.PI;
      spider.root.rotation.y = spider.angle;
    }
  }
}

function spawnGoldenSpider(timestamp) {
  // A bonus must appear on schedule even if all ten slots are occupied.
  // Replace an ordinary spider without awarding points; gold counts toward the cap.
  if (spiders.length >= MAX_SPIDERS) {
    const index = spiders.findIndex(spider => !spider.golden);
    const [replaced] = spiders.splice(index >= 0 ? index : 0, 1);
    spiderLayer.remove(replaced.root);
  }
  let x = 0; let z = 0;
  // Prefer an exposed place in the playable area, below the HUD.
  for (let attempt = 0; attempt < 80; attempt++) {
    x = rand(-view.width * .38, view.width * .38);
    z = rand(-view.height * .28, view.height * .34);
    const point = screenPoint(x, z);
    if (!intersections(point.x, point.y).length) break;
  }
  makeSpider(x, z, true);
  goldNoticeUntil = timestamp + 2800;
  $('game-status').textContent = '금색 거미 등장! 잡으면 +5점';
  $('game-status').classList.add('gold-notice');
  $('announcement').textContent = '금색 거미가 나타났어요. 잡으면 5점!';
  playTone(1080, .17, .045);
}

function moveSpiders(dt) {
  for (const spider of spiders) {
    spider.age += dt;
    spider.turnIn -= dt;
    const pos = spider.root.position;
    // Invisible margin beyond the camera: spiders can leave and later return.
    // In that margin they gently turn toward the forest instead of teleporting.
    const outside = Math.abs(pos.x) > view.width / 2 + .6 || Math.abs(pos.z) > view.height / 2 + .6;
    if (outside) {
      spider.targetAngle = Math.atan2(-pos.x, -pos.z) - Math.PI;
      spider.turnIn = .8;
    } else if (spider.turnIn <= 0) {
      spider.targetAngle += rand(-1.65, 1.65);
      spider.turnIn = rand(.7, 2.8);
    }
    const difference = Math.atan2(Math.sin(spider.targetAngle - spider.angle), Math.cos(spider.targetAngle - spider.angle));
    spider.angle += difference * Math.min(1, dt * (outside ? 4 : 2.5));
    spider.root.rotation.y = spider.angle;
    const speed = spider.speed * (.85 + .15 * Math.sin(spider.age * 2));
    pos.x -= Math.sin(spider.angle) * speed * dt;
    pos.z -= Math.cos(spider.angle) * speed * dt;
    spider.gait += dt * speed * 14;
    pos.y = Math.sin(spider.gait * 2) * .008;
    for (const leg of spider.legs) {
      leg.object.rotation.y = Math.sin(spider.gait + leg.phase) * .22;
      leg.object.rotation.z = Math.max(0, Math.cos(spider.gait + leg.phase)) * .14 * leg.side;
    }
  }
}

function updateHUD() {
  $('score').textContent = String(score).padStart(2, '0');
  const seconds = Math.max(0, Math.ceil(remaining));
  $('time').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  $('time-progress').style.strokeDashoffset = String(100 * (1 - remaining / DURATION));
  $('time-panel').classList.toggle('urgent', remaining <= 10);
}

function clearSpiders() {
  spiderLayer.clear();
  spiders.length = 0;
}

function clearEffects() {
  for (const effect of effects) {
    scene.remove(effect.group);
    effect.materials.forEach(material => material.dispose());
  }
  effects.length = 0;
  $('catch-labels').replaceChildren();
}

function startGame() {
  clearSpiders();
  clearEffects();
  arrangeForest();
  score = 0;
  remaining = DURATION;
  deadline = now() + DURATION * 1000;
  nextSpawn = now() + rand(650, 1600);
  nextGoldSpawn = deadline - DURATION * 1000 + GOLD_INTERVAL;
  goldNoticeUntil = 0;
  lastLeafHint = -Infinity;
  lastFrame = now();
  phase = 'playing';
  spawnBatch(true);
  $('overlay').hidden = true;
  $('game-status').textContent = '나뭇잎 밖으로 나오면, 톡!';
  $('game-status').classList.remove('gold-notice');
  $('announcement').textContent = '게임 시작. 제한 시간은 60초입니다.';
  updateHUD();
  playTone(540, .07, .045);
}

function endGame() {
  if (phase !== 'playing') return;
  phase = 'ended';
  remaining = 0;
  clearEffects();
  const newBest = score > best;
  best = Math.max(best, score);
  try { localStorage.setItem('underleaf-best', String(best)); } catch { /* Storage is optional. */ }
  updateHUD();
  $('card-eyebrow').textContent = 'A LITTLE MOMENT, WELL SPENT';
  $('card-title').textContent = '오늘의 숲속 탐험 끝!';
  $('card-description').hidden = true;
  $('result').hidden = false;
  $('final-score').textContent = score;
  $('best-score').textContent = `${newBest ? '새로운 최고 기록! · ' : ''}BEST ${best}`;
  $('start-label').textContent = 'RESTART';
  $('card-hint').textContent = '한 번 더, 새로운 숲에서 만나요';
  $('overlay').hidden = false;
  $('game-status').textContent = '잠깐의 탐험, 즐거우셨나요?';
  $('game-status').classList.remove('gold-notice');
  $('announcement').textContent = `게임 종료. 최종 점수 ${score}점입니다.`;
  $('start-button').focus({ preventScroll: true });
  playTone(340, .25, .04);
}

function owner(object) {
  while (object && !object.userData.kind) object = object.parent;
  return object;
}

function intersections(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  raycaster.setFromCamera(pointer, camera);
  // One combined query. Three.js sorts the real triangle hits by camera distance.
  // Leaves are above the entire spider. NEVER search past the nearest leaf hit.
  return raycaster.intersectObjects([...leaves, ...spiders.map(spider => spider.root)], true);
}

function screenPoint(x, z, y = 0) {
  const p = new THREE.Vector3(x, y, z).project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  return { x: rect.left + (p.x + 1) / 2 * rect.width, y: rect.top + (1 - p.y) / 2 * rect.height };
}

function popLabel(text, clientX, clientY, leaf = false, golden = false) {
  const rect = renderer.domElement.getBoundingClientRect();
  const label = document.createElement('span');
  label.className = `catch-pop${leaf ? ' leaf-pop' : ''}${golden ? ' gold-pop' : ''}`;
  label.textContent = text;
  label.style.left = `${clientX - rect.left}px`;
  label.style.top = `${clientY - rect.top}px`;
  $('catch-labels').append(label);
  label.addEventListener('animationend', () => label.remove(), { once: true });
}

function catchEffect(spider) {
  const group = new THREE.Group();
  group.position.set(spider.root.position.x, 0, spider.root.position.z);
  const bloodMaterials = ['#510b17', '#741320', '#921f2b'].map(color => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .96, depthWrite: false, toneMapped: false }));
  const droplets = [];
  for (let i = 0; i < 26; i++) {
    const angle = i / 26 * Math.PI * 2 + rand(-.15, .15);
    const radius = rand(.035, .085);
    const dot = mesh(sphere, pick(bloodMaterials), group, [0, .28, 0], [radius, radius, radius * 1.4]);
    const speed = rand(1.15, 3.3);
    const vy = rand(1.0, 2.7);
    const landingTime = (vy + Math.sqrt(vy * vy + 18 * .26)) / 9;
    dot.userData = { vx: Math.sin(angle) * speed, vz: Math.cos(angle) * speed, vy, landingTime, radius };
    dot.rotation.y = angle;
    dot.castShadow = false;
    droplets.push(dot);
  }
  // Keep the caught model briefly, then fling its head, body, and legs apart.
  // Clone only materials; shared geometries and other living spiders stay intact.
  const burst = spider.root;
  group.add(burst);
  burst.position.set(0, 0, 0);
  const cloned = new Map();
  burst.traverse(part => {
    if (!part.isMesh) return;
    if (!cloned.has(part.material)) {
      const material = part.material.clone();
      material.transparent = true;
      material.depthWrite = false;
      cloned.set(part.material, material);
    }
    part.material = cloned.get(part.material);
    part.castShadow = false;
  });
  const fragments = burst.children.map(part => {
    const angle = Math.atan2(part.position.x, part.position.z) + rand(-.4, .4);
    return { part, origin: part.position.clone(), vx: Math.sin(angle) * rand(1.5, 3), vz: Math.cos(angle) * rand(1.5, 3), spin: rand(-6, 6) };
  });
  const burstMaterials = [...cloned.values()];
  scene.add(group);
  effects.push({ group, burst, fragments, droplets, bloodMaterials, burstMaterials, materials: [...bloodMaterials, ...burstMaterials], age: 0 });
}

function animateCatchEffect(effect, dt) {
  effect.age += dt;
  const t = effect.age;
  effect.burst.scale.set(1 + Math.min(t, .07) * 5, Math.max(.35, 1 - t * 4), 1 + Math.min(t, .07) * 5);
  effect.burst.visible = t < .46;
  const burstTime = Math.max(0, t - .06);
  for (const { part, origin, vx, vz, spin } of effect.fragments) {
    part.position.set(origin.x + vx * burstTime, origin.y + burstTime * .65, origin.z + vz * burstTime);
    part.rotation.y += spin * dt;
  }
  for (const material of effect.burstMaterials) material.opacity = Math.max(0, 1 - burstTime / .4);
  for (const material of effect.bloodMaterials) material.opacity = .96 * Math.max(0, 1 - Math.max(0, t - .7) / .55);
  for (const dot of effect.droplets) {
    const { vx, vz, vy, landingTime, radius } = dot.userData;
    const flight = Math.min(t, landingTime);
    dot.position.set(vx * flight, Math.max(.02, .28 + vy * flight - 4.5 * flight * flight), vz * flight);
    if (t >= landingTime) dot.scale.set(radius * 1.8, .012, radius * 2.4);
  }
}

function onPointerDown(event) {
  if (event.button !== 0 || phase !== 'playing') return;
  // Enforce the deadline here too, including immediately after a background tab resumes.
  if (now() >= deadline) { endGame(); return; }
  const hit = intersections(event.clientX, event.clientY)[0];
  if (!hit) return;
  const target = owner(hit.object);
  if (target.userData.kind === 'leaf') {
    target.userData.rustle = .35;
    if (now() - lastLeafHint > 1200) {
      popLabel('쉿, 나뭇잎 아래예요', event.clientX, event.clientY, true);
      lastLeafHint = now();
    }
    return;
  }
  const spider = target.userData.spider;
  const index = spiders.indexOf(spider);
  if (index < 0) return;
  catchEffect(spider);
  spiders.splice(index, 1);
  score += spider.points;
  updateHUD();
  popLabel(`+${spider.points}`, event.clientX, event.clientY, false, spider.golden);
  $('score').classList.remove('score-bump');
  void $('score').offsetWidth;
  $('score').classList.add('score-bump');
  playTone(spider.golden ? 1180 : rand(670, 840), spider.golden ? .16 : .075, .055);
}

function playTone(frequency, duration, volume) {
  if (!soundEnabled) return;
  try {
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    void audioContext.resume().catch(() => {});
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * .58, audioContext.currentTime + duration);
    gain.gain.setValueAtTime(volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  } catch { /* Unsupported audio never prevents playing. */ }
}

function tick(timestamp, dt) {
  if (phase === 'playing') {
    remaining = Math.max(0, (deadline - timestamp) / 1000);
    if (remaining <= 0) { endGame(); return; }
    // Anchor to the round's start, so frame delays do not shift the 10s cadence.
    while (timestamp >= nextGoldSpawn) {
      spawnGoldenSpider(timestamp);
      nextGoldSpawn += GOLD_INTERVAL;
    }
    if (timestamp >= nextSpawn) {
      spawnBatch();
      nextSpawn = timestamp + rand(700, 2100);
    }
    if (goldNoticeUntil && timestamp >= goldNoticeUntil) {
      goldNoticeUntil = 0;
      $('game-status').textContent = '나뭇잎 밖으로 나오면, 톡!';
      $('game-status').classList.remove('gold-notice');
    }
    updateHUD();
  }
  if (phase !== 'ended') {
    moveSpiders(dt);
    for (const leaf of leaves) {
      leaf.userData.rustle = Math.max(0, leaf.userData.rustle - dt);
      leaf.rotation.y = leaf.userData.restY + Math.sin(leaf.userData.rustle * 38) * leaf.userData.rustle * .05;
    }
    for (let i = effects.length - 1; i >= 0; i--) {
      const effect = effects[i];
      animateCatchEffect(effect, dt);
      if (effect.age >= 1.25) {
        scene.remove(effect.group);
        effect.materials.forEach(material => material.dispose());
        effects.splice(i, 1);
      }
    }
  }
}

function resize() {
  const rect = $('scene').getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const oldWidth = view.width; const oldHeight = view.height;
  const aspect = rect.width / rect.height;
  // Keep spiders comfortably tappable on a phone, expand the forest on desktop.
  view.width = aspect < 1 ? 11.5 : 24;
  view.height = view.width / aspect;
  camera.left = -view.width / 2;
  camera.right = view.width / 2;
  camera.top = view.height / 2;
  camera.bottom = -view.height / 2;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(rect.width, rect.height);
  for (const spider of spiders) {
    spider.root.position.x *= view.width / oldWidth;
    spider.root.position.z *= view.height / oldHeight;
  }
  arrangeForest();
}

function exposeTestAPI() {
  // Only available with ?test=1. These hooks exercise the same game paths as input.
  window.__gameTest = {
    state: () => ({ phase, score, remaining, count: spiders.length, deadline, nextSpawn, nextGoldSpawn, goldenCount: spiders.filter(s => s.golden).length, view: { ...view }, effects: effects.length }),
    spiders: () => spiders.map(s => ({ id: s.id, x: s.root.position.x, z: s.root.position.z, angle: s.angle, targetAngle: s.targetAngle, speed: s.speed, golden: s.golden, points: s.points, legs: s.legs.map(l => l.object.rotation.y) })),
    effects: () => effects.map(e => ({ age: e.age, fragments: e.fragments.length, burstVisible: e.burst.visible, burstOpacity: e.burstMaterials[0].opacity, droplets: e.droplets.map(d => ({ x: d.position.x, y: d.position.y, z: d.position.z, color: d.material.color.getHexString(), opacity: d.material.opacity })) })),
    leaves: () => leaves.map(l => ({ x: l.position.x, z: l.position.z, y: l.position.y, angle: l.rotation.y, sx: l.scale.x, sz: l.scale.z })),
    screenPoint,
    rayAt: (x, y) => intersections(x, y).map(h => ({ kind: owner(h.object).userData.kind, id: owner(h.object).userData.spider?.id, distance: h.distance })),
    clearSpiders,
    spawnAt: (x, z) => makeSpider(x, z)?.id ?? null,
    place: (id, x, z, angle = 0) => {
      const spider = spiders.find(s => s.id === id);
      spider.root.position.set(x, 0, z);
      spider.angle = spider.targetAngle = angle;
      spider.root.rotation.y = angle;
      spider.turnIn = 100;
    },
    freeze: () => { testTime = performance.now(); testFrozen = true; },
    advance: seconds => {
      const end = testTime + seconds * 1000;
      while (testTime < end) {
        const delta = Math.min(1000 / 60, end - testTime);
        testTime += delta;
        tick(testTime, delta / 1000);
      }
    },
    render: () => renderer.render(scene, camera),
    geometry: () => ({ spiderParts: spiders[0]?.root.children.length, legCount: spiders[0]?.legs.length, spiderTop: spiders[0] ? new THREE.Box3().setFromObject(spiders[0].root).max.y : null, leafBottom: Math.min(...leaves.map(l => new THREE.Box3().setFromObject(l).min.y)) }),
  };
}

try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-label', '나뭇잎 사이로 이동하는 거미를 클릭하거나 터치하세요');
  $('scene').append(renderer.domElement);
  makeGround();
  resize();
  for (let i = 0; i < 5; i++) makeSpider(rand(-view.width * .43, view.width * .43), rand(-view.height * .42, view.height * .42));
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  $('start-button').addEventListener('click', startGame);
  $('sound-button').addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    $('sound-button').setAttribute('aria-pressed', String(soundEnabled));
    $('sound-button').setAttribute('aria-label', soundEnabled ? '효과음 끄기' : '효과음 켜기');
    $('sound-label').textContent = soundEnabled ? 'SOUND ON' : 'SOUND OFF';
    playTone(620, .1, .04);
  });
  new ResizeObserver(resize).observe($('scene'));
  document.addEventListener('visibilitychange', () => {
    if (phase === 'playing' && now() >= deadline) endGame();
    lastFrame = now();
  });
  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    if (phase === 'playing') endGame();
    $('game-status').textContent = '그래픽 연결이 끊어졌어요. 페이지를 새로고침해주세요.';
    $('start-button').disabled = true;
  });
  $('start-button').disabled = false;
  $('start-label').textContent = 'START';
  $('game-status').textContent = '작은 숲이 기다리고 있어요';
  if (testMode) exposeTestAPI();
  renderer.setAnimationLoop(() => {
    const timestamp = now();
    const dt = Math.min(.05, Math.max(0, (timestamp - lastFrame) / 1000));
    lastFrame = timestamp;
    if (!testFrozen) tick(timestamp, dt);
    renderer.render(scene, camera);
  });
} catch (error) {
  console.error(error);
  $('card-title').textContent = '숲을 불러오지 못했어요';
  $('card-description').textContent = 'WebGL을 지원하는 최신 브라우저에서 다시 열어주세요. 브라우저의 그래픽 가속 설정도 확인해주세요.';
  $('start-label').textContent = '실행할 수 없음';
  $('game-status').textContent = '3D 그래픽을 시작할 수 없어요';
}
