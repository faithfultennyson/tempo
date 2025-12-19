const CANNON = require('cannon-es');

class DicePhysicsSimulation {
  constructor() {
    this.world = new CANNON.World();
    this.world.gravity.set(0, -25, 0); // stronger gravity for snappier falls
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.solver.iterations = 12;
    this.world.allowSleep = true; // allow natural settling; reduces mid-air stickiness
    this.world.defaultContactMaterial.contactEquationRelaxation = 2;
    this.tableSize = 10; // physical bounds; keep in sync with client board size
    this.dice = [];
    this.isRolling = false;
    this.settlementTimer = 0;
    this.boundaryType = 'box'; // 'box' or 'dome' for curved containment
    this.diceMaterial = new CANNON.Material('dice');
    this.tableMaterial = new CANNON.Material('table');
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.diceMaterial, this.tableMaterial, {
        friction: 0.5,
        restitution: 0.12,
        contactEquationRelaxation: 4,
        frictionEquationRelaxation: 4
      })
    );
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.diceMaterial, this.diceMaterial, {
        friction: 0.45,
        restitution: 0.12
      })
    );
    this.setupTable();
  }

  setupTable() {
    const groundShape = new CANNON.Plane();
    const groundBody = new CANNON.Body({
      mass: 0,
      shape: groundShape,
      material: this.tableMaterial
    });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(groundBody);

    const wallMaterial = this.tableMaterial;
    const tableSize = this.tableSize;
    const wallThickness = 0.4;
    const wallHeight = 3.5; // avoid tall walls that can catch dice mid-air

    if (this.boundaryType === 'box') {
      const walls = [
        { pos: [0, wallHeight / 2, tableSize / 2], rot: [0, 0, 0] },
        { pos: [0, wallHeight / 2, -tableSize / 2], rot: [0, 0, 0] },
        { pos: [tableSize / 2, wallHeight / 2, 0], rot: [0, Math.PI / 2, 0] },
        { pos: [-tableSize / 2, wallHeight / 2, 0], rot: [0, Math.PI / 2, 0] }
      ];
      walls.forEach((wall) => {
        const shape = new CANNON.Box(new CANNON.Vec3(wallThickness, wallHeight / 2, tableSize / 2));
        const body = new CANNON.Body({ mass: 0, shape, material: wallMaterial });
        body.position.set(...wall.pos);
        body.quaternion.setFromEuler(...wall.rot);
        this.world.addBody(body);
      });
    } else {
      // Dome-style containment: use multiple slightly tilted planes to push dice toward center
      const tilt = (20 * Math.PI) / 180;
      const radius = tableSize / 2;
      const planes = [
        { rot: [tilt, 0, 0], pos: [0, 0, radius] }, // north
        { rot: [-tilt, 0, 0], pos: [0, 0, -radius] }, // south
        { rot: [0, 0, tilt], pos: [radius, 0, 0] }, // east
        { rot: [0, 0, -tilt], pos: [-radius, 0, 0] } // west
      ];
      planes.forEach((p) => {
        const planeShape = new CANNON.Plane();
        const planeBody = new CANNON.Body({ mass: 0, shape: planeShape, material: wallMaterial });
        planeBody.quaternion.setFromEuler(p.rot[0], p.rot[1], p.rot[2]);
        planeBody.position.set(p.pos[0], p.pos[1], p.pos[2]);
        this.world.addBody(planeBody);
      });
    }
  }

  createDie(id, initialPos, initialVel, initialAngVel) {
    const size = 2; // matches client OBJ fallback (2 units per side)
    const shape = new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2));
    const body = new CANNON.Body({
      mass: 2.6,
      shape,
      material: this.diceMaterial,
      linearDamping: 0.12,
      angularDamping: 0.12
    });
    body.position.set(initialPos.x, initialPos.y, initialPos.z);
    body.velocity.set(initialVel.x, initialVel.y, initialVel.z);
    body.angularVelocity.set(initialAngVel.x, initialAngVel.y, initialAngVel.z);
    this.world.addBody(body);
    const die = { id, body, settled: false };
    this.dice.push(die);
    return die;
  }

  rollDice(numberOfDice = 2) {
    this.cleanup();
    this.dice = [];
    // Keep bodies awake during active roll to avoid mid-air pauses
    this.world.allowSleep = false;
    // Spawn near the center of the collision area to reduce escape/instability.
    const halfTable = this.tableSize / 2;
    const spawnRadiusMin = 0.2;
    const spawnRadiusMax = 1.1; // keep well inside bounds
    const spawnHeightMin = 3.0;
    const spawnHeightMax = 4.0;
    const minSeparation = 1.8; // enough to avoid immediate overlap
    const randInRing = () => {
      const r = Math.sqrt(Math.random()) * (spawnRadiusMax - spawnRadiusMin) + spawnRadiusMin;
      const theta = Math.random() * Math.PI * 2;
      return { x: r * Math.cos(theta), z: r * Math.sin(theta) };
    };
    const randBetween = (min, max) => min + Math.random() * (max - min);
    const clampWithinBounds = (v) => Math.max(-halfTable + 1.6, Math.min(halfTable - 1.6, v)); // half die size + buffer

    const spawnPoints = [];

    for (let i = 0; i < numberOfDice; i++) {
      let pos = randInRing();
      let attempts = 0;
      while (attempts < 10) {
        const tooClose = spawnPoints.some((p) => {
          const dx = p.x - pos.x;
          const dz = p.z - pos.z;
          return Math.sqrt(dx * dx + dz * dz) < minSeparation;
        });
        if (!tooClose) break;
        pos = randInRing();
        attempts++;
      }
      pos.x = clampWithinBounds(pos.x);
      pos.z = clampWithinBounds(pos.z);
      spawnPoints.push(pos);

      const upward = randBetween(spawnHeightMin, spawnHeightMax);
      // Drop straight down; no initial linear velocity to avoid arc/launch
      this.createDie(
        `die_${i}`,
        { x: pos.x, y: upward, z: pos.z },
        { x: 0, y: 0, z: 0 },
        { x: randBetween(-8, 8), y: randBetween(-8, 8), z: randBetween(-8, 8) }
      );
    }
    this.isRolling = true;
    this.settlementTimer = 0;
  }

  step(deltaTime) {
    this.world.step(1 / 60, deltaTime, 3);
  }

  getDiceState() {
    return this.dice.map((die) => ({
      id: die.id,
      position: {
        x: die.body.position.x,
        y: die.body.position.y,
        z: die.body.position.z
      },
      rotation: {
        x: die.body.quaternion.x,
        y: die.body.quaternion.y,
        z: die.body.quaternion.z,
        w: die.body.quaternion.w
      },
      velocity: {
        x: die.body.velocity.x,
        y: die.body.velocity.y,
        z: die.body.velocity.z
      },
      angularVelocity: {
        x: die.body.angularVelocity.x,
        y: die.body.angularVelocity.y,
        z: die.body.angularVelocity.z
      }
    }));
  }

  checkSettlement() {
    const velocityThreshold = 0.05;
    const angularVelocityThreshold = 0.05;
    const allSettled = this.dice.every((die) => {
      const linVel = die.body.velocity.length();
      const angVel = die.body.angularVelocity.length();
      return linVel < velocityThreshold && angVel < angularVelocityThreshold;
    });
    if (allSettled) {
      this.settlementTimer += 1 / 60;
      if (this.settlementTimer > 0.3) {
        this.isRolling = false;
        this.world.allowSleep = true; // allow sleep again after settling
        return true;
      }
    } else {
      this.settlementTimer = 0;
    }
    return false;
  }

  getFinalResults() {
    return this.dice.map((die) => ({
      id: die.id,
      value: this.getDieFaceUp(die.body),
      position: {
        x: die.body.position.x,
        y: die.body.position.y,
        z: die.body.position.z
      },
      rotation: {
        x: die.body.quaternion.x,
        y: die.body.quaternion.y,
        z: die.body.quaternion.z,
        w: die.body.quaternion.w
      }
    }));
  }

  getDieFaceUp(body) {
    const faces = [
      { value: 1, normal: new CANNON.Vec3(1, 0, 0) },
      { value: 2, normal: new CANNON.Vec3(0, -1, 0) },
      { value: 3, normal: new CANNON.Vec3(0, 0, 1) },
      { value: 4, normal: new CANNON.Vec3(0, 0, -1) },
      { value: 5, normal: new CANNON.Vec3(0, 1, 0) },
      { value: 6, normal: new CANNON.Vec3(-1, 0, 0) }
    ];
    const worldUp = new CANNON.Vec3(0, 1, 0);
    let maxDot = -Infinity;
    let topFace = 1;
    faces.forEach((face) => {
      const worldNormal = body.quaternion.vmult(face.normal);
      const dot = worldNormal.dot(worldUp);
      if (dot > maxDot) {
        maxDot = dot;
        topFace = face.value;
      }
    });
    return topFace;
  }

  cleanup() {
    this.dice.forEach((die) => this.world.removeBody(die.body));
    this.dice = [];
  }
}

module.exports = DicePhysicsSimulation;
