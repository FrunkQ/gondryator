// Look-around (spec section 7): mouse drag, touch drag, keyboard, device gyroscope, and an
// automatic "wandering viewer" used to measure the refocusing metric.

import type { GazeSource } from '../render/spawner';

const deg = Math.PI / 180;

export class LookController implements GazeSource {
  yaw = 0;
  pitch = 0;
  private targetYaw = 0;
  private targetPitch = 0;
  yawVel = 0;
  private prevYaw = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private keys = new Set<string>();
  private gyroBase: { alpha: number; beta: number } | null = null;
  gyroActive = false;
  wander = false;
  private wanderT = Math.random() * 100;

  constructor(private el: HTMLElement, private maxYaw: number, private maxPitch: number, private fovPerPixel: () => number) {
    el.addEventListener('pointerdown', e => {
      if ((e.target as HTMLElement).closest('.ui')) return;
      this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', e => {
      if (!this.dragging) return;
      const k = this.fovPerPixel();
      // Dragging moves the view like grabbing the scene: drag left to look right.
      this.targetYaw -= (e.clientX - this.lastX) * k;
      this.targetPitch += (e.clientY - this.lastY) * k;
      this.lastX = e.clientX; this.lastY = e.clientY;
      this.clampTarget();
    });
    const up = () => { this.dragging = false; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    window.addEventListener('keydown', e => { if (e.key.startsWith('Arrow')) { this.keys.add(e.key); e.preventDefault(); } });
    window.addEventListener('keyup', e => this.keys.delete(e.key));
  }

  get maxYawRad() { return this.maxYaw * deg; }

  private clampTarget() {
    const my = this.maxYaw * deg, mp = this.maxPitch * deg;
    this.targetYaw = Math.max(-my, Math.min(my, this.targetYaw));
    this.targetPitch = Math.max(-mp, Math.min(mp, this.targetPitch));
  }

  center() { this.targetYaw = 0; this.targetPitch = 0; }

  async enableGyro(): Promise<boolean> {
    const DOE = (window as any).DeviceOrientationEvent;
    if (!DOE) return false;
    if (typeof DOE.requestPermission === 'function') {
      try { if ((await DOE.requestPermission()) !== 'granted') return false; } catch { return false; }
    }
    window.addEventListener('deviceorientation', e => {
      if (e.alpha === null || e.beta === null) return;
      if (!this.gyroBase) this.gyroBase = { alpha: e.alpha, beta: e.beta };
      let da = e.alpha - this.gyroBase.alpha;
      if (da > 180) da -= 360;
      if (da < -180) da += 360;
      this.targetYaw = -da * deg;
      this.targetPitch = -(e.beta - this.gyroBase.beta) * deg;
      this.clampTarget();
    });
    this.gyroActive = true;
    return true;
  }

  update(dt: number) {
    const speed = 1.6 * dt;
    if (this.keys.has('ArrowLeft')) this.targetYaw -= speed;
    if (this.keys.has('ArrowRight')) this.targetYaw += speed;
    if (this.keys.has('ArrowUp')) this.targetPitch += speed * 0.6;
    if (this.keys.has('ArrowDown')) this.targetPitch -= speed * 0.6;
    if (this.wander) {
      // A viewer who keeps glancing around: slow sweeps plus occasional jumps.
      this.wanderT += dt;
      const t = this.wanderT;
      this.targetYaw = (Math.sin(t * 0.37) * 0.7 + Math.sin(t * 0.91 + 1.3) * 0.3) * this.maxYaw * deg * 0.95;
      this.targetPitch = Math.sin(t * 0.53) * this.maxPitch * deg * 0.6;
    }
    this.clampTarget();
    const k = 1 - Math.exp(-dt * 10);
    this.yaw += (this.targetYaw - this.yaw) * k;
    this.pitch += (this.targetPitch - this.pitch) * k;
    const v = dt > 0 ? (this.yaw - this.prevYaw) / dt : 0;
    this.yawVel += (v - this.yawVel) * (1 - Math.exp(-dt * 4));
    this.prevYaw = this.yaw;
  }

  /** Headset mode: the head is the gaze. */
  setFromHead(yaw: number, pitch: number, dt: number) {
    this.yaw = this.targetYaw = yaw;
    this.pitch = this.targetPitch = pitch;
    const v = dt > 0 ? (yaw - this.prevYaw) / dt : 0;
    this.yawVel += (v - this.yawVel) * (1 - Math.exp(-dt * 4));
    this.prevYaw = yaw;
  }

  predictYaw(ahead: number): number {
    // Where the viewer is heading, damped: people overshoot less than straight extrapolation.
    const p = this.targetYaw + this.yawVel * Math.min(ahead, 0.6) * 0.5;
    const m = this.maxYaw * deg;
    return Math.max(-m, Math.min(m, p));
  }
}
