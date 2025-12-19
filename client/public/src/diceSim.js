import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { VISUAL_CONFIG } from './config.js';

const FACE_NORMALS = {
  1: new THREE.Vector3(0, 1, 0),
  6: new THREE.Vector3(0, -1, 0),
  2: new THREE.Vector3(1, 0, 0),
  5: new THREE.Vector3(-1, 0, 0),
  3: new THREE.Vector3(0, 0, 1),
  4: new THREE.Vector3(0, 0, -1)
};

export function createDiceSim(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
  // Position camera using base layout only. If the display is too narrow to fit the collision box,
  // we'll scale the canvas down (CSS transform) rather than changing FOV or camera distance.
  setCameraPos(camera, canvas);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dir = new THREE.DirectionalLight(0xffffff, 0.7);
  dir.position.set(6, 10, 6);
  scene.add(dir);

  // Utility: scale down canvas so that the board/collision width fits in the available display width
  const debugEl = canvas.parentElement && canvas.parentElement.querySelector('#canvasDebug');
  function updateDebug(data) {
    if (!debugEl) return;
    const lines = [];
    lines.push(`canvas: ${canvas.clientWidth}×${canvas.clientHeight}`);
    lines.push(`aspect: ${camera.aspect.toFixed(3)}  fov: ${camera.fov.toFixed(1)}°`);
    lines.push(`camera pos: y=${camera.position.y.toFixed(2)} z=${camera.position.z.toFixed(2)}`);
    if (data) {
      if (data.baseDistance !== undefined) lines.push(`baseDist: ${data.baseDistance.toFixed(2)}`);
      if (data.requiredDistance !== undefined) lines.push(`requiredDist: ${data.requiredDistance.toFixed(2)}`);
      if (data.scale !== undefined) lines.push(`appliedScale: ${data.scale.toFixed(3)} (${data.scaled ? 'yes' : 'no'})`);
      lines.push(`boardSize: ${data.boardSize}  tiles: ${data.tiles}`);
      lines.push(`tileSpreadX: ${data.spreadX}  tileSpreadY: ${data.spreadY}`);
    }
    debugEl.textContent = lines.join('\n');
  }

  function adjustCanvasScale() {
    const collisionSize = VISUAL_CONFIG.boardSize || 12; // world units
    const boardHalf = collisionSize / 2;

    // compute base camera distance to board center
    const baseDistY = camera.position.y;
    const baseDistZ = camera.position.z;
    const baseDistance = Math.sqrt(baseDistY * baseDistY + baseDistZ * baseDistZ);

    const fovRad = (camera.fov * Math.PI) / 180;
    const halfV = Math.tan(fovRad / 2);

    // distance required so that board width fits the camera frustum
    const requiredDistFromWidth = boardHalf / (halfV * camera.aspect);
    const requiredDistance = Math.max(requiredDistFromWidth, boardHalf / halfV) * (1 + (VISUAL_CONFIG.uiScaleMargin || 0.08));

    // If the required distance is larger than the current base distance, the board would be cropped.
    // Instead of moving the camera back, we scale the canvas down so the rendered scene fits the available area.
    if (requiredDistance > baseDistance) {
      const scale = baseDistance / requiredDistance; // < 1
      canvas.style.transformOrigin = 'center top';
      canvas.style.transform = `scale(${scale})`;
      // To avoid layout jumps, keep the canvas container height equal to the real canvas height
      canvas.style.display = 'block';
      canvas.parentElement.style.height = `${Math.round(canvas.clientHeight * scale)}px`;
      updateDebug({ baseDistance, requiredDistance, scale, scaled: true, boardSize: collisionSize, tiles: (VISUAL_CONFIG.tileSpreadX * 2 + 1) * (VISUAL_CONFIG.tileSpreadY * 2 + 1), spreadX: VISUAL_CONFIG.tileSpreadX, spreadY: VISUAL_CONFIG.tileSpreadY });
    } else {
      canvas.style.transform = '';
      canvas.parentElement.style.height = '';
      updateDebug({ baseDistance, requiredDistance, scale: 1, scaled: false, boardSize: collisionSize, tiles: (VISUAL_CONFIG.tileSpreadX * 2 + 1) * (VISUAL_CONFIG.tileSpreadY * 2 + 1), spreadX: VISUAL_CONFIG.tileSpreadX, spreadY: VISUAL_CONFIG.tileSpreadY });
    }
  }

  let diceTemplate = null;
  let diceEntities = [];
  let boardReady = false;
  let externalFrame = null;

  loadBoard(scene);
  loadDiceTemplate().then((tpl) => {
    diceTemplate = tpl;
  });

  function loadBoard(targetScene) {
    const loaderEl = canvas.parentElement && canvas.parentElement.querySelector('#canvasLoader');
    if (loaderEl) loaderEl.classList.remove('hidden');

    // Placeholder material and central collision board so we render immediately without black flash
    const boardSize = VISUAL_CONFIG.boardSize || 12;
    const placeholderColor = 0x0d1a30;
    const placeholderMat = new THREE.MeshBasicMaterial({ color: placeholderColor });
    const centerGeo = new THREE.PlaneGeometry(boardSize, boardSize);
    const centerMesh = new THREE.Mesh(centerGeo, placeholderMat);
    centerMesh.rotation.x = -Math.PI / 2;
    centerMesh.position.y = 0;
    targetScene.add(centerMesh);

    // Create instanced visual-only tiles around the central board, excluding the center tile
    const spreadX = VISUAL_CONFIG.tileSpreadX ?? 2; // number of tiles to extend in +X and -X
    const spreadY = VISUAL_CONFIG.tileSpreadY ?? 3; // number of tiles to extend in +Z and -Z

    const positions = [];
    for (let y = -spreadY; y <= spreadY; y++) {
      for (let x = -spreadX; x <= spreadX; x++) {
        if (x === 0 && y === 0) continue; // skip center to avoid overlap with collision board
        positions.push([x, y]);
      }
    }

    let inst = null;
    if (positions.length > 0) {
      const instGeo = new THREE.PlaneGeometry(boardSize, boardSize);
      const instMat = placeholderMat.clone();
      inst = new THREE.InstancedMesh(instGeo, instMat, positions.length);
      const tmp = new THREE.Object3D();
      tmp.rotation.x = -Math.PI / 2; // lay flat
      for (let i = 0; i < positions.length; i++) {
        const [px, py] = positions[i];
        tmp.position.set(px * boardSize, 0, py * boardSize);
        tmp.updateMatrix();
        inst.setMatrixAt(i, tmp.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = false;
      inst.receiveShadow = false;
      targetScene.add(inst);
    }

    // Start loading the texture asynchronously and swap it in when ready
    const texLoader = new THREE.TextureLoader();
    const prefer = './assets/board_1024.png';
    const fallback = './assets/board.png';

    function onLoaded(boardTex) {
      try { boardTex.colorSpace = THREE.SRGBColorSpace; } catch (e) {}
      boardTex.wrapS = THREE.RepeatWrapping;
      boardTex.wrapT = THREE.RepeatWrapping;
      boardTex.repeat.set(1, 1);
      try {
        boardTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      } catch (e) {}

      const mat = new THREE.MeshBasicMaterial({ map: boardTex });
      centerMesh.material = mat;
      if (inst) inst.material = mat;

      if (loaderEl) loaderEl.classList.add('hidden');
      requestAnimationFrame(() => adjustCanvasScale());
      boardReady = true;
    }

    // Try preferred texture, fall back if it fails
    texLoader.load(prefer, (tex) => onLoaded(tex), undefined, () => {
      texLoader.load(fallback, (tex2) => onLoaded(tex2), undefined, () => {
        // both failed; keep placeholder
        if (loaderEl) loaderEl.classList.add('hidden');
        boardReady = true;
        requestAnimationFrame(() => adjustCanvasScale());
      });
    });

    // Make sure canvas scale is computed even while loading
    requestAnimationFrame(() => adjustCanvasScale());
  }

  function loadDiceTemplate() {
    const texLoader = new THREE.TextureLoader();
    const diceTex = texLoader.load('./assets/dice_diffuse.png', () => {
      diceTex.colorSpace = THREE.SRGBColorSpace;
    });
    return new Promise((resolve) => {
      const objLoader = new OBJLoader();
      objLoader.load(
        './assets/Dice.obj',
        (obj) => {
          obj.traverse((child) => {
            if (child.isMesh) {
              child.material = new THREE.MeshBasicMaterial({ map: diceTex });
            }
          });
          resolve(obj);
        },
        undefined,
        () => {
          const geom = new THREE.BoxGeometry(2, 2, 2);
          const mat = new THREE.MeshBasicMaterial({ map: diceTex });
          resolve(new THREE.Mesh(geom, mat));
        }
      );
    });
  }

  function ensureDiceEntities(count) {
    while (diceEntities.length < count) {
      if (!diceTemplate) break;
      const mesh = diceTemplate.clone(true);
      scene.add(mesh);
      diceEntities.push({
        mesh,
        velocity: new THREE.Vector3(),
        angular: new THREE.Vector3(),
        target: 1,
        settleCounter: 0
      });
    }
    while (diceEntities.length > count) {
      const ent = diceEntities.pop();
      scene.remove(ent.mesh);
    }
  }

  function seeded(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
  }

  function randomSigned(rng, mag) {
    return (rng() * 2 - 1) * mag;
  }

  function setAuthoritativeTransforms(dice) {
    externalFrame = dice || [];
    ensureDiceEntities(externalFrame.length);
  }

  function setOutcome(visualSeed, diceValues) {
    if (!diceTemplate) return;
    ensureDiceEntities(diceValues.length);
    const rng = seeded(visualSeed || 1);
    for (let i = 0; i < diceValues.length; i++) {
      const ent = diceEntities[i];
      ent.target = diceValues[i];
      ent.seed = (visualSeed || 1) + i * 999;
      ent.velocity.set(randomSigned(rng, 3), rng() * 3 + 3, rng() * 3 + 6);
      ent.angular.set(randomSigned(rng, 8), randomSigned(rng, 8), randomSigned(rng, 8));
      ent.mesh.position.set(randomSigned(rng, 2), 4 + rng() * 1.5, randomSigned(rng, 2));
      ent.mesh.quaternion.copy(randomQuaternion(rng));
      ent.settleCounter = 0;
    }
  }

  function randomQuaternion(rng) {
    const u1 = rng();
    const u2 = rng();
    const u3 = rng();
    const sq1 = Math.sqrt(1 - u1);
    const sq2 = Math.sqrt(u1);
    return new THREE.Quaternion(
      sq1 * Math.sin(2 * Math.PI * u2),
      sq1 * Math.cos(2 * Math.PI * u2),
      sq2 * Math.sin(2 * Math.PI * u3),
      sq2 * Math.cos(2 * Math.PI * u3)
    );
  }

  function snapToResult(ent, rngFactory) {
    const up = new THREE.Vector3(0, 1, 0);
    const face = FACE_NORMALS[ent.target] || up;
    const q = new THREE.Quaternion().setFromUnitVectors(face.clone().normalize(), up);
    const rng = rngFactory || (() => Math.random());
    const yaw = (rng() * Math.PI * 2) || 0;
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(up, yaw);
    ent.mesh.quaternion.copy(yawQuat.multiply(q));
  }

  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(0.033, clock.getDelta());
    step(dt);
    renderer.render(scene, camera);
    // keep debug updated each frame so we reflect any camera changes
    if (typeof updateDebug === 'function') updateDebug();
  }
  animate();

  function step(dt) {
    if (!diceEntities.length || !boardReady) return;

    if (externalFrame && externalFrame.length) {
      ensureDiceEntities(externalFrame.length);
      for (let i = 0; i < externalFrame.length; i++) {
        const mesh = diceEntities[i].mesh;
        const target = externalFrame[i];
        if (!target) continue;
        const p = target.position;
        const q = target.quaternion;
        mesh.position.lerp(new THREE.Vector3(p[0], p[1], p[2]), 0.4);
        const targetQ = new THREE.Quaternion(q[0], q[1], q[2], q[3]);
        mesh.quaternion.slerp(targetQ, 0.4);
      }
      return;
    }

    // Simple pairwise separation to reduce visual overlap of dice in local mode.
    if (diceEntities.length >= 2) {
      const a = diceEntities[0];
      const b = diceEntities[1];
      const delta = new THREE.Vector3().subVectors(b.mesh.position, a.mesh.position);
      const dist = delta.length();
      const minDist = 2.0; // dice are roughly 2 units across
      if (dist > 0 && dist < minDist) {
        const push = delta.normalize().multiplyScalar((minDist - dist) * 0.5);
        a.mesh.position.addScaledVector(push, -1);
        b.mesh.position.add(push);
        // Nudge velocities apart
        a.velocity.addScaledVector(push, -4 * dt);
        b.velocity.addScaledVector(push, 4 * dt);
      }
    }

    for (const ent of diceEntities) {
      // linear motion
      ent.velocity.y += VISUAL_CONFIG.gravity * dt;
      ent.mesh.position.addScaledVector(ent.velocity, dt);
      ent.velocity.multiplyScalar(VISUAL_CONFIG.friction);

      // floor collision
      const halfSize = 1;
      if (ent.mesh.position.y < halfSize) {
        ent.mesh.position.y = halfSize;
        ent.velocity.y = -ent.velocity.y * VISUAL_CONFIG.restitution;
        ent.velocity.x *= 0.85;
        ent.velocity.z *= 0.85;
      }

      // angular motion
      const angMag = ent.angular.length();
      if (angMag > 0) {
        const axis = ent.angular.clone().normalize();
        const angle = angMag * dt;
        const dq = new THREE.Quaternion().setFromAxisAngle(axis, angle);
        ent.mesh.quaternion.multiply(dq);
        ent.angular.multiplyScalar(0.98);
      }

      const speed = ent.velocity.length();
      if (speed < VISUAL_CONFIG.stopThreshold && ent.angular.length() < VISUAL_CONFIG.stopThreshold) {
        ent.settleCounter += dt;
      } else {
        ent.settleCounter = 0;
      }

      if (ent.settleCounter > 0.4) {
        snapToResult(ent, seeded(ent.seed || ent.target * 1000));
        ent.angular.set(0, 0, 0);
        ent.velocity.set(0, 0, 0);
      }
    }
  }

  function handleResize() {
    const { clientWidth, clientHeight } = canvas;
    if (!clientWidth || !clientHeight) return;
    camera.aspect = clientWidth / clientHeight;
    setCameraPos(camera, canvas);
    renderer.setSize(clientWidth, clientHeight, false);
    adjustCanvasScale();
  }

  window.addEventListener('resize', handleResize);

  return {
    setOutcome,
    setAuthoritativeTransforms,
    resize: handleResize
  };
}

function setCameraPos(camera, canvas) {
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  const portrait = aspect < 0.75;
  const mid = aspect < 1.15;

  // Base FOV and base camera placement for visual style on different aspect ratios
  camera.fov = portrait ? 58 : mid ? 52 : 48;
  let baseDistZ = portrait ? 20 : mid ? 16 : 13;
  let baseDistY = portrait ? 17 : mid ? 13.5 : 11;

  // Ensure the board (12x12) fits in the camera frustum at the plane depth.
  // Compute required distance to fit width and height given current FOV/aspect.
  const boardSize = 12; // board is a 12x12 plane centered at origin
  const boardHalf = boardSize / 2;
  const fovRad = (camera.fov * Math.PI) / 180;
  const halfV = Math.tan(fovRad / 2);

  // We intentionally do NOT move the camera farther back here; instead we scale the
  // canvas when the display is too narrow so the collision area fits (handled by adjustCanvasScale).
  camera.position.set(0, baseDistY, baseDistZ);
  camera.updateProjectionMatrix();
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}
