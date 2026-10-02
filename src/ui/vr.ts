// WebXR: sit in the carriage (or by the stage) in a headset. Head tracking replaces drag-to-look,
// and the same refocusing steers the music's objects to wherever you turn your head.
// three's WebXR path needs the WebGL2 backend, so on WebGPU the button first switches renderer.

import * as THREE from 'three/webgpu';

export class VR {
  supported = false;
  session: XRSession | null = null;
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(private getRenderer: () => THREE.WebGPURenderer, private button: HTMLButtonElement, private onToast: (t: string) => void) {}

  async init() {
    const xr = (navigator as any).xr as XRSystem | undefined;
    if (!xr) return;
    try { this.supported = await xr.isSessionSupported('immersive-vr'); } catch { this.supported = false; }
    this.button.hidden = !this.supported;
    this.button.addEventListener('click', () => void this.toggle());
    // Arrived here from the WebGPU renderer: one more tap enters the headset.
    if (this.supported && new URLSearchParams(location.search).has('vr')) this.onToast('Ready for VR: tap the headset button');
  }

  get presenting() { return !!this.getRenderer().xr?.isPresenting; }

  private async toggle() {
    if (this.session) { await this.session.end(); return; }
    const r = this.getRenderer();
    if ((r.backend as any).isWebGPUBackend && typeof (globalThis as any).XRGPUBinding === 'undefined') {
      const p = new URLSearchParams(location.search);
      p.set('webgl', ''); p.set('vr', '');
      location.search = p.toString().replace(/=(&|$)/g, '$1');
      return;
    }
    const xr = (navigator as any).xr as XRSystem;
    const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    r.xr.enabled = true;
    // 'local': the headset starts at the carriage's eye height, wherever you are sitting.
    r.xr.setReferenceSpaceType('local');
    await r.xr.setSession(session);
    this.session = session;
    this.button.classList.add('on');
    session.addEventListener('end', () => { this.session = null; r.xr.enabled = false; this.button.classList.remove('on'); });
  }

  /** Head direction relative to the carriage (yaw right-positive, pitch up-positive), or null. */
  headLook(parent: THREE.Object3D): { yaw: number; pitch: number } | null {
    if (!this.presenting) return null;
    const cam = this.getRenderer().xr.getCamera();
    parent.getWorldQuaternion(this.q).invert().multiply(cam.quaternion);
    this.e.setFromQuaternion(this.q, 'YXZ');
    return { yaw: -this.e.y, pitch: this.e.x };
  }
}
