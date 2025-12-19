class DiceInterpolator {
  constructor(dieId) {
    this.dieId = dieId;
    this.stateBuffer = [];
    this.maxBufferSize = 3;
    this.currentState = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 }
    };
    this.interpolationDelay = 100; // ms
    this.isSettled = false;
  }

  addState(state, timestamp) {
    this.stateBuffer.push({ ...state, timestamp });
    if (this.stateBuffer.length > this.maxBufferSize) {
      this.stateBuffer.shift();
    }
    if (this.stateBuffer.length === 1) {
      this.currentState = {
        position: { ...state.position },
        rotation: { ...state.rotation }
      };
    }
  }

  update(currentTime) {
    if (this.isSettled || this.stateBuffer.length < 2) return this.currentState;
    const renderTime = currentTime - this.interpolationDelay;
    let from = null;
    let to = null;
    for (let i = 0; i < this.stateBuffer.length - 1; i++) {
      if (this.stateBuffer[i].timestamp <= renderTime && this.stateBuffer[i + 1].timestamp >= renderTime) {
        from = this.stateBuffer[i];
        to = this.stateBuffer[i + 1];
        break;
      }
    }
    if (!from || !to) {
      const latest = this.stateBuffer[this.stateBuffer.length - 1];
      this.currentState = { position: { ...latest.position }, rotation: { ...latest.rotation } };
      return this.currentState;
    }
    const t = (renderTime - from.timestamp) / (to.timestamp - from.timestamp);
    const smoothT = this.smoothstep(t);
    this.currentState.position = {
      x: this.lerp(from.position.x, to.position.x, smoothT),
      y: this.lerp(from.position.y, to.position.y, smoothT),
      z: this.lerp(from.position.z, to.position.z, smoothT)
    };
    this.currentState.rotation = this.slerp(from.rotation, to.rotation, smoothT);
    return this.currentState;
  }

  setSettled(finalState) {
    this.isSettled = true;
    this.currentState = { position: { ...finalState.position }, rotation: { ...finalState.rotation } };
    this.stateBuffer = [];
  }

  reset() {
    this.stateBuffer = [];
    this.isSettled = false;
  }

  lerp(a, b, t) {
    return a + (b - a) * t;
  }

  smoothstep(t) {
    const clamped = Math.max(0, Math.min(1, t));
    return clamped * clamped * (3 - 2 * clamped);
  }

  slerp(q1, q2, t) {
    let cosHalfTheta = q1.x * q2.x + q1.y * q2.y + q1.z * q2.z + q1.w * q2.w;
    if (cosHalfTheta < 0) {
      q2 = { x: -q2.x, y: -q2.y, z: -q2.z, w: -q2.w };
      cosHalfTheta = -cosHalfTheta;
    }
    if (Math.abs(cosHalfTheta) >= 1.0) return { ...q1 };
    const halfTheta = Math.acos(Math.min(1, Math.max(-1, cosHalfTheta)));
    const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);
    if (Math.abs(sinHalfTheta) < 0.001) {
      return {
        x: (q1.x * 0.5 + q2.x * 0.5),
        y: (q1.y * 0.5 + q2.y * 0.5),
        z: (q1.z * 0.5 + q2.z * 0.5),
        w: (q1.w * 0.5 + q2.w * 0.5)
      };
    }
    const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
    const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;
    return {
      x: q1.x * ratioA + q2.x * ratioB,
      y: q1.y * ratioA + q2.y * ratioB,
      z: q1.z * ratioA + q2.z * ratioB,
      w: q1.w * ratioA + q2.w * ratioB
    };
  }
}

export default DiceInterpolator;
