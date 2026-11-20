import * as THREE from 'three';

/* =====================================================================
   Presentation compositor.

   The game always renders into the low-res Canvas2D buffer (#screen). In
   WebGL mode that buffer is uploaded every frame as a nearest-filtered
   CanvasTexture and drawn on a full-screen quad at an INTEGER scale, with a
   small post stack:
     1. bright-pass + 2x downsample            (half-res RT, linear)
     2. separable 9-tap gaussian, H then V     (half-res RTs)
     3. final: crisp source + bloom, per-art-pixel scanlines, vignette,
        chromatic aberration that only kicks in on screen flashes / hits.
   All render targets / materials are allocated once (and on resize only).
   If WebGL is unavailable, throws, or the context is lost — or the URL has
   ?renderer=canvas — the CSS-scaled 2D canvas is shown instead.
   ===================================================================== */

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BRIGHT = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThresh;
varying vec2 vUv;
void main() {
  // 4 taps = box-filtered 2x downsample of the pixel buffer
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, -0.5)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, 0.5)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(uThresh, 1.0, l);
  gl_FragColor = vec4(c * k, 1.0);
}`;

const BLUR = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tSrc, vUv).rgb * 0.2270;
  s += (texture2D(tSrc, vUv + uDir * 1.3846).rgb + texture2D(tSrc, vUv - uDir * 1.3846).rgb) * 0.3162;
  s += (texture2D(tSrc, vUv + uDir * 3.2308).rgb + texture2D(tSrc, vUv - uDir * 3.2308).rgb) * 0.0703;
  gl_FragColor = vec4(s, 1.0);
}`;

const FINAL = /* glsl */`
uniform sampler2D tSrc; uniform sampler2D tBloom;
uniform vec2 uSrcSize; uniform float uScale; uniform float uBloom; uniform float uCA; uniform float uScan; uniform float uVig;
varying vec2 vUv;
void main() {
  vec2 uv = vUv;
  vec3 c;
  if (uCA > 0.001) {
    vec2 d = (uv - 0.5) * uCA / uSrcSize * 2.0;
    c = vec3(texture2D(tSrc, uv + d).r, texture2D(tSrc, uv).g, texture2D(tSrc, uv - d).b);
  } else c = texture2D(tSrc, uv).rgb;
  vec3 b = texture2D(tBloom, uv).rgb;
  c += b * uBloom;
  // one dim line per art pixel row (only when each art pixel is >= 3 device px tall)
  float row = mod(gl_FragCoord.y, uScale);
  if (uScale >= 3.0 && row < 1.0) c *= 1.0 - uScan;
  vec2 q = uv - 0.5;
  c *= 1.0 - uVig * dot(q, q) * 2.2;
  gl_FragColor = vec4(c, 1.0);
}`;

function forceCanvas() { return /[?&]renderer=canvas\b/.test(location.search); }

/** active presentation path: 'webgl' | 'canvas' */
export function getRendererName() { return Compositor.mode === 'webgl' ? 'webgl' : 'canvas'; }

export const Compositor = {
  mode: 'canvas', name: 'CANVAS 2D', ready: false, failed: false,
  src: null, host: null, renderer: null, gl: null,
  settings: { bloom: 0.85, thresh: 0.55, scan: 0.12, vig: 0.35, ca: 0 },
  _frameMs: 0,

  /** try to start WebGL; safe to call once */
  init(host, srcCanvas) {
    if (this.ready) return this.mode;
    this.ready = true; this.host = host; this.src = srcCanvas;
    if (forceCanvas()) return this._fallback('forced (?renderer=canvas)');
    try {
      const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
      renderer.outputColorSpace = THREE.LinearSRGBColorSpace;          // pass-through: the buffer is already display-referred
      renderer.autoClear = false;
      const cv = renderer.domElement; cv.id = 'gl'; cv.className = 'gl-screen';
      cv.addEventListener('webglcontextlost', e => { e.preventDefault(); this._fallback('context lost'); });
      host.insertBefore(cv, srcCanvas.nextSibling);

      const tex = new THREE.CanvasTexture(srcCanvas);
      tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
      tex.colorSpace = THREE.NoColorSpace; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false, type: THREE.UnsignedByteType };
      const rtA = new THREE.WebGLRenderTarget(4, 4, rtOpts), rtB = new THREE.WebGLRenderTarget(4, 4, rtOpts);
      const mk = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
      const mBright = mk(BRIGHT, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThresh: { value: this.settings.thresh } });
      const mBlur = mk(BLUR, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
      const mFinal = mk(FINAL, {
        tSrc: { value: tex }, tBloom: { value: rtA.texture }, uSrcSize: { value: new THREE.Vector2(1, 1) }, uScale: { value: 3 },
        uBloom: { value: this.settings.bloom }, uCA: { value: 0 }, uScan: { value: this.settings.scan }, uVig: { value: this.settings.vig },
      });
      const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mFinal); quad.frustumCulled = false; scene.add(quad);
      this.gl = { renderer, tex, rtA, rtB, mBright, mBlur, mFinal, scene, cam, quad, W: 0, H: 0 };
      this.renderer = renderer;
      this.mode = 'webgl';
      const ctx = renderer.getContext();
      this.name = 'WEBGL' + (ctx instanceof WebGL2RenderingContext ? '2' : '1') + ' + BLOOM';
      document.body.classList.add('gl-on');
      srcCanvas.style.visibility = 'hidden';
    } catch (err) {
      return this._fallback('init failed: ' + (err && err.message));
    }
    this._label();
    return this.mode;
  },

  _fallback(why) {
    this.mode = 'canvas'; this.name = 'CANVAS 2D'; this.failed = why;
    document.body.classList.remove('gl-on');
    if (this.src) this.src.style.visibility = '';
    const G = this.gl;
    if (G) {                                                     // free every GPU resource we created
      for (const fn of [() => G.tex.dispose(), () => G.rtA.dispose(), () => G.rtB.dispose(), () => G.mBright.dispose(), () => G.mBlur.dispose(),
        () => G.mFinal.dispose(), () => G.quad.geometry.dispose(), () => G.renderer.renderLists.dispose(), () => G.renderer.dispose(),
        () => G.renderer.domElement.remove()]) { try { fn(); } catch (_) { /* context may already be gone */ } }
      this.gl = null; this.renderer = null;
    }
    this._label();
    return this.mode;
  },
  _label() { const el = document.getElementById('d-render'); if (el) el.textContent = this.name; },

  /** W×H art pixels, `dev` device pixels per art pixel (integer), css = CSS px per art pixel */
  resize(W, H, dev, css) {
    const G = this.gl; if (!G) return;
    G.W = W; G.H = H;
    G.renderer.setPixelRatio(1);
    G.renderer.setSize(W * dev, H * dev, false);
    const cv = G.renderer.domElement;
    cv.style.width = (W * css) + 'px'; cv.style.height = (H * css) + 'px';
    const hw = Math.max(1, W >> 1), hh = Math.max(1, H >> 1);
    G.rtA.setSize(hw, hh); G.rtB.setSize(hw, hh);
    G.mBright.uniforms.uTexel.value.set(1 / W, 1 / H);
    G.mFinal.uniforms.uSrcSize.value.set(W, H);
    G.mFinal.uniforms.uScale.value = dev;
    this._hw = hw; this._hh = hh;
    G.tex.dispose();                                             // texture size changed: re-upload at the new size
  },

  /** upload the 2D buffer and draw it with post-processing. fx: { flash 0..1, hit 0..1 } */
  present(fx) {
    const G = this.gl; if (!G || this.mode !== 'webgl') return;
    const t0 = performance.now();
    try {
      const r = G.renderer;
      G.tex.needsUpdate = true;
      // 1. bright pass -> rtA
      G.quad.material = G.mBright; G.mBright.uniforms.tSrc.value = G.tex;
      r.setRenderTarget(G.rtA); r.render(G.scene, G.cam);
      // 2. blur H rtA -> rtB, V rtB -> rtA
      G.quad.material = G.mBlur;
      G.mBlur.uniforms.tSrc.value = G.rtA.texture; G.mBlur.uniforms.uDir.value.set(1 / this._hw, 0);
      r.setRenderTarget(G.rtB); r.render(G.scene, G.cam);
      G.mBlur.uniforms.tSrc.value = G.rtB.texture; G.mBlur.uniforms.uDir.value.set(0, 1 / this._hh);
      r.setRenderTarget(G.rtA); r.render(G.scene, G.cam);
      // 3. final
      const flash = fx ? Math.max(fx.flash || 0, fx.hit || 0) : 0;
      G.quad.material = G.mFinal;
      G.mFinal.uniforms.uCA.value = Math.min(1.5, flash * 2) + this.settings.ca;
      G.mFinal.uniforms.uBloom.value = this.settings.bloom * (1 + 0.25 * Math.min(1, flash));
      r.setRenderTarget(null); r.render(G.scene, G.cam);
    } catch (err) {
      this._fallback('present failed: ' + (err && err.message));
    }
    this._frameMs = this._frameMs * 0.95 + (performance.now() - t0) * 0.05;
  },
};
