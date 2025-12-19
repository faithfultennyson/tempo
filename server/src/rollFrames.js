/**
 * Generate low-tick dice transforms for streaming to clients.
 * This is a lightweight kinematic approximation (not full physics) intended
 * for visual guidance and interpolation.
 */

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

/**
 * Build an array of frames:
 * [{ dice: [{ position:[x,y,z], quaternion:[x,y,z,w] }], settled: bool, turnId }]
 */
function buildRollFrames(seed, diceValues) {
  const rng = seeded(seed || 1);
  const frameCount = 36; // ~2.4s at 15 Hz
  const frames = [];

  const faceTarget = (value, rng) => {
    // Map desired face value to a world-up orientation.
        const faceMap = {
  1: [1, 0, 0],
  2: [0, -1, 0],
  3: [0, 0, 1],
  4: [0, 0, -1],
  5: [0, 1, 0],
  6: [-1, 0, 0]
};
    const dir = faceMap[value] || [0, 1, 0];
    const up = [0, 1, 0];
    const dot = dir[0] * up[0] + dir[1] * up[1] + dir[2] * up[2];
    let axis = [dir[1] * up[2] - dir[2] * up[1], dir[2] * up[0] - dir[0] * up[2], dir[0] * up[1] - dir[1] * up[0]];
    const axisLen = Math.hypot(axis[0], axis[1], axis[2]);
    if (axisLen < 1e-5) axis = [1, 0, 0];
    else axis = axis.map((v) => v / axisLen);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    const sin = Math.sin(angle / 2);
    const baseQ = [axis[0] * sin, axis[1] * sin, axis[2] * sin, Math.cos(angle / 2)];
    // Add a random yaw around Y to avoid identical orientation every time.
    const yaw = rng() * Math.PI * 2;
    const ys = Math.sin(yaw / 2);
    const yawQ = [0, ys, 0, Math.cos(yaw / 2)];
    return multiplyQuat(yawQ, baseQ);
  };

  const dice = diceValues.map((val, i) => ({
    value: val,
    pos: [randomSigned(rng, 0.5), 3.6 + rng() * 0.7, randomSigned(rng, 0.5)],
    vel: [randomSigned(rng, 1.8), rng() * 3 + 2.4, rng() * 5 + 5],
    quat: randomQuat(rng),
    ang: [randomSigned(rng, 5), randomSigned(rng, 5), randomSigned(rng, 5)]
  }));

  for (let f = 0; f < frameCount; f++) {
    const dt = 1 / 15;
    const diceFrame = [];
    for (const d of dice) {
      // integrate
      d.vel[1] += -25 * dt;
      d.pos[0] += d.vel[0] * dt;
      d.pos[1] += d.vel[1] * dt;
      d.pos[2] += d.vel[2] * dt;

      // ground collision
      const halfSize = 1;
      if (d.pos[1] < halfSize) {
        d.pos[1] = halfSize;
        d.vel[1] = -d.vel[1] * 0.55;
        d.vel[0] *= 0.86;
        d.vel[2] *= 0.86;
      }

      // clamp within a 5x5 board
      const limit = 5 - halfSize;
      if (d.pos[0] < -limit) {
        d.pos[0] = -limit;
        d.vel[0] = -d.vel[0] * 0.5;
      } else if (d.pos[0] > limit) {
        d.pos[0] = limit;
        d.vel[0] = -d.vel[0] * 0.5;
      }
      if (d.pos[2] < -limit) {
        d.pos[2] = -limit;
        d.vel[2] = -d.vel[2] * 0.5;
      } else if (d.pos[2] > limit) {
        d.pos[2] = limit;
        d.vel[2] = -d.vel[2] * 0.5;
      }

      // angular damp
      d.ang[0] *= 0.97;
      d.ang[1] *= 0.97;
      d.ang[2] *= 0.97;

      // simple quaternion integrate
      const angMag = Math.hypot(d.ang[0], d.ang[1], d.ang[2]);
      if (angMag > 0.0001) {
        const nx = d.ang[0] / angMag;
        const ny = d.ang[1] / angMag;
        const nz = d.ang[2] / angMag;
        const angle = angMag * dt;
        const sin = Math.sin(angle / 2);
        const dq = [nx * sin, ny * sin, nz * sin, Math.cos(angle / 2)];
        d.quat = multiplyQuat(d.quat, dq);
      }

      diceFrame.push({
        position: d.pos.slice(),
        quaternion: d.quat.slice()
      });
    }
    // simple dice separation to reduce overlap
    for (let i = 0; i < dice.length; i++) {
      for (let j = i + 1; j < dice.length; j++) {
        const a = dice[i];
        const b = dice[j];
        const dx = b.pos[0] - a.pos[0];
        const dy = b.pos[1] - a.pos[1];
        const dz = b.pos[2] - a.pos[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const minDist = 2.0;
        if (dist > 0 && dist < minDist) {
          const push = (minDist - dist) * 0.5;
          const nx = dx / dist;
          const ny = dy / dist;
          const nz = dz / dist;
          a.pos[0] -= nx * push;
          a.pos[1] -= ny * push;
          a.pos[2] -= nz * push;
          b.pos[0] += nx * push;
          b.pos[1] += ny * push;
          b.pos[2] += nz * push;
          a.vel[0] -= nx * 0.6;
          a.vel[2] -= nz * 0.6;
          b.vel[0] += nx * 0.6;
          b.vel[2] += nz * 0.6;
        }
      }
    }

    // steer final frames to lie flat on the target face
    const settleStart = frameCount - 6;
    if (f >= settleStart) {
      const t = (f - settleStart + 1) / (frameCount - settleStart);
      for (let i = 0; i < diceFrame.length; i++) {
        const targetQ = faceTarget(diceValues[i], rng);
        const qCurrent = diceFrame[i].quaternion;
        diceFrame[i].quaternion = slerpQuat(qCurrent, targetQ, t);
        // gently bring to rest height
        diceFrame[i].position[1] = Math.max(diceFrame[i].position[1], 1);
      }
    }

    const settled = f === frameCount - 1;
    frames.push({ dice: diceFrame, settled });
  }
  return frames;
}

function randomQuat(rng) {
  const u1 = rng();
  const u2 = rng();
  const u3 = rng();
  const sq1 = Math.sqrt(1 - u1);
  const sq2 = Math.sqrt(u1);
  return [
    sq1 * Math.sin(2 * Math.PI * u2),
    sq1 * Math.cos(2 * Math.PI * u2),
    sq2 * Math.sin(2 * Math.PI * u3),
    sq2 * Math.cos(2 * Math.PI * u3)
  ];
}

function multiplyQuat(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz
  ];
}

function slerpQuat(q1, q2, t) {
  let cosHalfTheta = q1[0] * q2[0] + q1[1] * q2[1] + q1[2] * q2[2] + q1[3] * q2[3];
  if (cosHalfTheta < 0) {
    q2 = q2.map((v) => -v);
    cosHalfTheta = -cosHalfTheta;
  }
  if (Math.abs(cosHalfTheta) >= 1.0) return q1.slice();
  const halfTheta = Math.acos(Math.min(1, Math.max(-1, cosHalfTheta)));
  const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);
  if (Math.abs(sinHalfTheta) < 0.001) {
    return [
      q1[0] * 0.5 + q2[0] * 0.5,
      q1[1] * 0.5 + q2[1] * 0.5,
      q1[2] * 0.5 + q2[2] * 0.5,
      q1[3] * 0.5 + q2[3] * 0.5
    ];
  }
  const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
  const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;
  return [
    q1[0] * ratioA + q2[0] * ratioB,
    q1[1] * ratioA + q2[1] * ratioB,
    q1[2] * ratioA + q2[2] * ratioB,
    q1[3] * ratioA + q2[3] * ratioB
  ];
}

module.exports = { buildRollFrames };
