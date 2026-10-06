// @ts-nocheck -- TSL node typings are too strict for swizzles and number arguments.
// Video feedback, the light-synth classic: every frame, the previous frame comes back zoomed,
// turned and colour-shifted underneath the new one, so anything bright leaves spiralling trails
// that pour into (or out of) the centre. With amount 0 it passes the picture straight through.
// Built like three's AfterImageNode (two render targets, swapped each frame), plus a transform.

import { RenderTarget, Vector2, QuadMesh, NodeMaterial, RendererUtils, TempNode, NodeUpdateType } from 'three/webgpu';
import { Fn, float, smoothstep, length, vec2, vec3, vec4, select, clamp, uv, texture, passTexture, max, cos, sin, mix, nodeObject, abs, fract, convertToTexture } from 'three/tsl';

const _size = new Vector2();

/**
 * Keeps a pixel finite. One bad pixel (an overflow to infinity, then infinity times zero) is NaN,
 * and on WebGPU a NaN in a feedback buffer survives every frame after: it sat in the middle of the
 * screen as a magenta blob, zoomed and turned into a star by the feedback itself.
 */
export const clean = (c) => select(c.x.add(c.y).add(c.z).lessThan(3.0e4), clamp(c, 0.0, 1.0e4), vec3(0.0));

const _quad = new QuadMesh();
let _state;

export interface FeedbackParams {
  /** 0..1: how much of the last frame survives each frame (0 = off). */
  amount: any;
  /** Zoom per frame: > 1 pours outwards, < 1 sucks into the centre. */
  zoom: any;
  /** Turn per frame, radians. */
  turn: any;
  /** Colour drift per frame, 0..1 (rotates the channels). */
  hue: any;
  /** Screen aspect, so the turn stays round. */
  aspect: any;
}

class FeedbackNode extends TempNode {
  static get type() { return 'FeedbackNode'; }

  constructor(textureNode, p: FeedbackParams) {
    super('vec4');
    this.textureNode = textureNode;
    this.params = p; // (not "p": single letters like p are swizzles on nodes)
    this._compRT = new RenderTarget(1, 1, { depthBuffer: false });
    this._oldRT = new RenderTarget(1, 1, { depthBuffer: false });
    this._textureNode = passTexture(this, this._compRT.texture);
    this._old = texture(this._oldRT.texture);
    this._material = null;
    this.updateBeforeType = NodeUpdateType.FRAME;
  }

  getTextureNode() { return this._textureNode; }

  updateBefore(frame) {
    const { renderer } = frame;
    _state = RendererUtils.resetRendererState(renderer, _state);
    const map = this.textureNode.value;
    this._compRT.texture.type = map.type;
    this._oldRT.texture.type = map.type;
    renderer.getDrawingBufferSize(_size);
    this._compRT.setSize(_size.x, _size.y);
    this._oldRT.setSize(_size.x, _size.y);
    this._textureNode.value = this._compRT.texture;
    this._old.value = this._oldRT.texture;
    _quad.material = this._material;
    _quad.name = 'Feedback';
    renderer.setRenderTarget(this._compRT);
    _quad.render(renderer);
    const t = this._oldRT; this._oldRT = this._compRT; this._compRT = t;
    RendererUtils.restoreRendererState(renderer, _state);
  }

  setup(builder) {
    const p = this.params;
    const src = this.textureNode;
    const old = this._old;
    const mat = this._material || (this._material = new NodeMaterial());
    mat.name = 'Feedback';
    mat.fragmentNode = Fn(() => {
      const u0 = uv();
      // Where this pixel was last frame: undo the zoom and the turn about the centre.
      const c = u0.sub(0.5).mul(vec2(p.aspect, 1)).div(p.zoom);
      const ca = cos(p.turn.negate()), sa = sin(p.turn.negate());
      const r = vec2(c.x.mul(ca).sub(c.y.mul(sa)), c.x.mul(sa).add(c.y.mul(ca)));
      // Mirror at the edges so the trails never pull in black.
      const uo = abs(fract(r.div(vec2(p.aspect, 1)).add(0.5).mul(0.5)).mul(2.0).sub(1.0)).oneMinus();
      const prev = clean(old.sample(uo).rgb);
      // A little is taken off every frame as well as the fraction, so dim trails die out to black
      // instead of piling up into a pastel wash.
      // Trails sucked into the centre pile up into fine noise there (a grey mush of moire), so
      // they fade out over the last stretch before the middle; with no zoom or turn, nothing fades.
      const sink = abs(p.zoom.sub(1.0)).mul(120.0).add(abs(p.turn).mul(60.0)).min(1.0);
      const core = mix(float(1.0), smoothstep(0.03, 0.16, length(c)), sink);
      const kept = max(mix(prev, prev.gbr, p.hue).mul(p.amount).sub(0.012), 0.0).mul(core);
      const now = clean(src.sample(u0).rgb);
      // Off means off: the old frame is not read at all, so the buffer flushes clean.
      return vec4(select(p.amount.greaterThan(0.001), max(now, kept), now), 1.0);
    })();
    builder.getNodeProperties(this).textureNode = src;
    return this._textureNode;
  }

  dispose() {
    super.dispose();
    this._compRT.dispose();
    this._oldRT.dispose();
    this._material?.dispose();
  }
}

export const feedback = (node, p: FeedbackParams) => nodeObject(new FeedbackNode(convertToTexture(node), p));
