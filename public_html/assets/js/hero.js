/* STACK-UP ink — Three.js
   createInk() turns any section into a fluid-ink surface:
   1. A small Navier–Stokes sim: the cursor pours ink across the section's base colour.
   2. (optional) A finely stippled 3D STACK-UP mark — stacked slabs pierced by an up-arrow —
      engraved in tens of thousands of tiny dots. Dots are dragged by the fluid and spray where ink pools.
   3. A composite pass blends the dots over base/ink with a difference blend, so the mark reads dark
      on paper and light inside the ink.
   Each surface sleeps when nothing moves and stops entirely when off screen. */
import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

THREE.ColorManagement.enabled = false;            // raw sRGB so colours match the CSS

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const css = (v) => new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(v).trim());
const STEP = 1 / 60;
const VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function createInk({ container, canvas, base, ink, mark = false, wordmark = null, coveredBy = null, introPour = false, word = null, wordColor = null, wordInkColor = null, scrollWord = false }) {
  const CFG = { sim: 128, dye: 512, velDiss: 0.962, dyeDiss: 0.988, iters: 18, radius: 6e-5, force: 5900, reveal: 3.9, edge: 0.5,
                flow: 7 / 128, maxFlow: 0.12, scatter: 0.9 };

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.autoClear = false;
  const fluidOK = renderer.capabilities.isWebGL2 && !!renderer.extensions.get('EXT_color_buffer_float');

  /* ---------- fullscreen passes ---------- */
  const quadScene = new THREE.Scene(), quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); quad.frustumCulled = false; quadScene.add(quad);
  const pass = (fragmentShader, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false });
  const run = (mat, target) => { quad.material = mat; renderer.setRenderTarget(target); renderer.render(quadScene, quadCam); };
  const rt = (w, h, filter, depth = false) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat,
    minFilter: filter, magFilter: filter, depthBuffer: depth, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
  const pingPong = (s, f) => { const o = { read: rt(s, s, f), write: rt(s, s, f), swap() { [o.read, o.write] = [o.write, o.read]; } }; return o; };
  const clearTarget = (t) => { renderer.setRenderTarget(t); renderer.setClearColor(0x000000, 0); renderer.clear(); };

  /* ---------- fluid ---------- */
  const simTexel = new THREE.Vector2(1 / CFG.sim, 1 / CFG.sim), dyeTexel = new THREE.Vector2(1 / CFG.dye, 1 / CFG.dye);
  let velocity, dye, pressure, divergence, advect, splat, divergenceMat, pressureMat, gradientMat;
  if (fluidOK) {
    velocity = pingPong(CFG.sim, THREE.LinearFilter);
    dye = pingPong(CFG.dye, THREE.LinearFilter);
    pressure = pingPong(CFG.sim, THREE.NearestFilter);
    divergence = rt(CFG.sim, CFG.sim, THREE.NearestFilter);
    advect = pass(`uniform sampler2D uVelocity, uSource; uniform vec2 uTexel; uniform float uDiss; varying vec2 vUv;
      void main(){ vec2 c = vUv - texture2D(uVelocity, vUv).xy * uTexel; gl_FragColor = uDiss * texture2D(uSource, c); }`,
      { uVelocity: { value: null }, uSource: { value: null }, uTexel: { value: simTexel }, uDiss: { value: 1 } });
    splat = pass(`uniform sampler2D uTarget; uniform float uAspect, uRadius; uniform vec2 uPoint; uniform vec3 uColor; varying vec2 vUv;
      void main(){ vec2 p = vUv - uPoint; p.x *= uAspect; vec3 s = exp(-dot(p, p) / uRadius) * uColor; gl_FragColor = vec4(texture2D(uTarget, vUv).xyz + s, 1.0); }`,
      { uTarget: { value: null }, uAspect: { value: 1 }, uRadius: { value: CFG.radius }, uPoint: { value: new THREE.Vector2() }, uColor: { value: new THREE.Vector3() } });
    divergenceMat = pass(`uniform sampler2D uVelocity; uniform vec2 uTexel; varying vec2 vUv;
      void main(){ float L = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.0)).x, R = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.0)).x;
        float T = texture2D(uVelocity, vUv + vec2(0.0, uTexel.y)).y, B = texture2D(uVelocity, vUv - vec2(0.0, uTexel.y)).y;
        gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0); }`, { uVelocity: { value: null }, uTexel: { value: simTexel } });
    pressureMat = pass(`uniform sampler2D uPressure, uDivergence; uniform vec2 uTexel; varying vec2 vUv;
      void main(){ float L = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x, R = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
        float T = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x, B = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
        gl_FragColor = vec4((L + R + B + T - texture2D(uDivergence, vUv).x) * 0.25, 0.0, 0.0, 1.0); }`,
      { uPressure: { value: null }, uDivergence: { value: divergence.texture }, uTexel: { value: simTexel } });
    gradientMat = pass(`uniform sampler2D uPressure, uVelocity; uniform vec2 uTexel; varying vec2 vUv;
      void main(){ float L = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x, R = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
        float T = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x, B = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
        gl_FragColor = vec4(texture2D(uVelocity, vUv).xy - 0.5 * vec2(R - L, T - B), 0.0, 1.0); }`,
      { uPressure: { value: null }, uVelocity: { value: null }, uTexel: { value: simTexel } });
    [velocity.read, velocity.write, dye.read, dye.write, pressure.read, pressure.write].forEach(clearTarget);
  }
  function addSplat(target, x, y, r, g, b) {
    splat.uniforms.uTarget.value = target.read.texture; splat.uniforms.uPoint.value.set(x, y); splat.uniforms.uColor.value.set(r, g, b);
    run(splat, target.write); target.swap();
  }

  const pointer = { x: 0, y: 0, px: 0, py: 0, active: false, moved: false };
  const pours = [];
  let idleSteps = 300;
  function simStep(fade) {
    const k = 1 - fade;
    if (pointer.moved && pointer.active) {
      const dx = pointer.x - pointer.px, dy = pointer.y - pointer.py;
      if ((dx || dy) && k > 0.001) { addSplat(velocity, pointer.x, pointer.y, dx * CFG.force * k, dy * CFG.force * k, 0); addSplat(dye, pointer.x, pointer.y, k, k, k); idleSteps = 0; }
      pointer.px = pointer.x; pointer.py = pointer.y;
    }
    pointer.moved = false;
    for (const [x, y, vx, vy] of pours.splice(0)) { addSplat(velocity, x, y, vx * CFG.force, vy * CFG.force, 0); addSplat(dye, x, y, 1, 1, 1); idleSteps = 0; }
    advect.uniforms.uTexel.value = simTexel; advect.uniforms.uVelocity.value = velocity.read.texture; advect.uniforms.uSource.value = velocity.read.texture;
    advect.uniforms.uDiss.value = CFG.velDiss; run(advect, velocity.write); velocity.swap();
    advect.uniforms.uTexel.value = dyeTexel; advect.uniforms.uVelocity.value = velocity.read.texture; advect.uniforms.uSource.value = dye.read.texture;
    advect.uniforms.uDiss.value = CFG.dyeDiss + (0.97 - CFG.dyeDiss) * fade; run(advect, dye.write); dye.swap();
    divergenceMat.uniforms.uVelocity.value = velocity.read.texture; run(divergenceMat, divergence);
    clearTarget(pressure.read);
    for (let i = 0; i < CFG.iters; i++) { pressureMat.uniforms.uPressure.value = pressure.read.texture; run(pressureMat, pressure.write); pressure.swap(); }
    gradientMat.uniforms.uPressure.value = pressure.read.texture; gradientMat.uniforms.uVelocity.value = velocity.read.texture;
    run(gradientMat, velocity.write); velocity.swap();
    idleSteps++;
  }

  /* ---------- stippled mark ---------- */
  let scene, camera, pivot, pointsMat;
  const OBJ_H = 4.3, OBJ_W = 4.2;
  if (mark) {
    pointsMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uSize: { value: 0.014 }, uScale: { value: 1 }, uVel: { value: null }, uDye: { value: null }, uFluid: { value: fluidOK ? 1 : 0 },
        uFlow: { value: CFG.flow }, uMaxFlow: { value: CFG.maxFlow }, uScatter: { value: reduceMotion ? 0 : CFG.scatter },
        uTanHalf: { value: Math.tan(THREE.MathUtils.degToRad(15)) }, uAspect: { value: 1 }, uAssemble: { value: 0 },
        uLight: { value: new THREE.Vector3(-0.5, 0.8, 0.6).normalize() }
      },
      vertexShader: /* glsl */`
        attribute vec3 aColor; attribute vec3 aScatter; attribute float aPhase;
        uniform float uTime, uSize, uScale, uFlow, uMaxFlow, uScatter, uTanHalf, uAspect, uAssemble, uFluid;
        uniform sampler2D uVel, uDye; uniform vec3 uLight;
        varying vec3 vColor; varying float vAlpha;
        void main(){
          vec3 p = position + normal * sin(uTime * 1.4 + aPhase) * 0.004;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vec4 clip = projectionMatrix * mv;
          vec2 suv = clamp(clip.xy / clip.w * 0.5 + 0.5, 0.0, 1.0);
          vec2 vel = texture2D(uVel, suv).xy * uFluid;
          float ink = clamp(texture2D(uDye, suv).r, 0.0, 1.5) * uFluid;
          vec2 flow = vel * uFlow; float len = length(flow);
          if (len > uMaxFlow) flow *= uMaxFlow / len;
          float viewH = 2.0 * uTanHalf * -mv.z;
          mv.xy += flow * vec2(viewH * uAspect, viewH);
          mv.xyz += aScatter * (ink * uScatter + pow(1.0 - uAssemble, 2.0) * 9.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = max(uSize * uScale / -mv.z, 1.0);
          // engraving shade: surfaces turned from the light keep more ink; edges facing the camera thin out
          vec3 nn = normalize(normalMatrix * normal);
          float lit = clamp(dot(nn, uLight) * 0.5 + 0.5, 0.0, 1.0);
          float rim = 1.0 - abs(nn.z);
          float tone = clamp((1.0 - lit) * 0.85 + rim * 0.35 + 0.12, 0.0, 1.0);
          float keep = step(fract(aPhase * 7.13), tone);
          vAlpha = keep * (0.55 + 0.45 * tone) * (1.0 - 0.45 * clamp(ink, 0.0, 1.0)) * smoothstep(0.0, 0.4, uAssemble);
          vColor = aColor;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vColor; varying float vAlpha;
        void main(){
          if (vAlpha < 0.01) discard;
          float r = length(gl_PointCoord - 0.5);
          if (r > 0.5) discard;
          float a = smoothstep(0.5, 0.2, r) * vAlpha;
          gl_FragColor = vec4(vColor * a, a);
        }`,
      transparent: true, depthTest: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor
    });
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    const pts = new THREE.Points(buildMark(base), pointsMat); pts.frustumCulled = false;
    pivot = new THREE.Group(); pivot.add(pts); scene.add(pivot);
  }

  /* ---------- wordmark drawn into the composite, so it can invert inside the ink ---------- */
  const wordCanvas = document.createElement('canvas');
  const wordCtx = wordCanvas.getContext('2d');
  const wordTex = new THREE.CanvasTexture(wordCanvas);
  wordTex.minFilter = wordTex.magFilter = THREE.LinearFilter; wordTex.generateMipmaps = false;
  let wordOn = false;
  function drawWord() {
    if (!word || !wordOn) return;
    const r = container.getBoundingClientRect(), cs = getComputedStyle(word);
    const cw = Math.round(W * DPR), ch = Math.round(H * DPR);
    if (wordCanvas.width !== cw || wordCanvas.height !== ch) {   // GPU texture size is fixed: re-allocate on resize
      wordCanvas.width = cw; wordCanvas.height = ch; wordTex.dispose();
    }
    wordCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    wordCtx.clearRect(0, 0, W, H);
    wordCtx.font = `${cs.fontWeight} expanded ${cs.fontSize} ${cs.fontFamily}`;
    if ('fontStretch' in wordCtx) wordCtx.fontStretch = 'expanded';
    wordCtx.fillStyle = '#fff';
    wordCtx.textBaseline = 'alphabetic';
    const asc = wordCtx.measureText('H').fontBoundingBoxAscent;
    const range = document.createRange();
    const chars = word.querySelectorAll('.char');
    (chars.length ? chars : [word]).forEach((el) => {
      range.selectNodeContents(el);
      const b = range.getBoundingClientRect();
      // Safari's canvas ignores font-stretch, so squeeze/stretch each glyph to its real on-page width.
      const w = wordCtx.measureText(el.textContent).width || 1;
      wordCtx.save();
      wordCtx.translate(b.left - r.left, b.top - r.top + asc + composite.uniforms.uWordShift.value * H); // undo the scroll offset
      wordCtx.scale(b.width / w, 1);
      wordCtx.fillText(el.textContent, 0, 0);
      wordCtx.restore();
    });
    wordTex.needsUpdate = true;
    wake();
  }
  function enableWord() {
    if (!word || wordOn) return;
    wordOn = true;
    composite.uniforms.uWordOn.value = 1;
    drawWord();
    word.style.color = 'transparent';               // the GL copy takes over
  }
  if (word) {
    word.addEventListener('glword', enableWord);
    if (word.dataset.glready) requestAnimationFrame(enableWord);
    // refit (font-size changes) or resize → redraw
    let lastFont = '';
    new MutationObserver(() => { if (word.style.fontSize !== lastFont) { lastFont = word.style.fontSize; requestAnimationFrame(drawWord); } }).observe(word, { attributes: true, attributeFilter: ['style'] });
    if (document.fonts) document.fonts.addEventListener('loadingdone', () => requestAnimationFrame(drawWord));
  }

  /* ---------- composite ---------- */
  let overlay;
  const composite = pass(`uniform sampler2D uDye, uOverlay, uWord; uniform vec3 uBase, uInk, uWordC, uWordInkC; uniform float uReveal, uEdge, uFluid, uHasOverlay, uWordOn, uWordShift; varying vec2 vUv;
    void main(){
      float raw = texture2D(uDye, vUv).r * uReveal * uFluid;
      float aa = max(fwidth(raw), 0.01);
      float mask = smoothstep(uEdge - aa, uEdge + aa, raw);
      vec3 top = mix(uBase, uInk, mask);
      vec3 over = min(texture2D(uOverlay, vUv).rgb, 1.0) * uHasOverlay;
      vec3 col = top + over - 2.0 * top * over;
      vec2 wuv = vec2(vUv.x, vUv.y - uWordShift);            // wordmark scrolls up over the mark
      float wa = (wuv.y < 0.0 ? 0.0 : texture2D(uWord, wuv).a) * uWordOn;
      col = mix(col, mix(uWordC, uWordInkC, mask), wa);   // wordmark flips colour inside the ink
      gl_FragColor = vec4(col, 1.0);
    }`,
    { uDye: { value: null }, uOverlay: { value: null }, uBase: { value: base }, uInk: { value: ink }, uReveal: { value: CFG.reveal },
      uEdge: { value: CFG.edge }, uFluid: { value: fluidOK ? 1 : 0 }, uHasOverlay: { value: mark ? 1 : 0 },
      uWord: { value: wordTex }, uWordOn: { value: 0 }, uWordShift: { value: 0 }, uWordC: { value: wordColor || new THREE.Color(0, 0, 0) }, uWordInkC: { value: wordInkColor || new THREE.Color(0, 0, 0) } });

  /* ---------- sizing ---------- */
  let W = 1, H = 1, DPR = 1;
  function resize() {
    const r = container.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    DPR = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(2.3e6 / (W * H)));
    renderer.setPixelRatio(DPR); renderer.setSize(W, H, false);
    if (overlay) overlay.dispose();
    overlay = rt(Math.round(W * DPR), Math.round(H * DPR), THREE.LinearFilter, true);
    if (splat) splat.uniforms.uAspect.value = W / H;
    if (mark) {
      // Fit the mark between the header and the wordmark; its base tucks behind the wordmark like a seal.
      const top = 150;
      const wTop = wordmark ? wordmark.getBoundingClientRect().top - r.top : H * 0.8;
      const bottom = wTop + (wordmark ? wordmark.offsetHeight * 0.55 : 0);
      const regionH = Math.max(bottom - top, H * 0.35);
      const pxPerUnit = Math.min(regionH * 0.98 / OBJ_H, W * 0.78 / OBJ_W);
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(15));
      const shift = (H / 2 - (top + regionH / 2)) / pxPerUnit;
      camera.aspect = W / H;
      camera.position.set(0, -shift, (H / pxPerUnit) / (2 * tanHalf));
      camera.lookAt(0, -shift, 0);
      camera.updateProjectionMatrix();
      pointsMat.uniforms.uAspect.value = W / H;
      pointsMat.uniforms.uScale.value = H * DPR / (2 * tanHalf);
    }
    drawWord();
    wake();
  }

  /* ---------- input ---------- */
  const rot = { tx: 0, ty: 0, x: { x: 0, v: 0 }, y: { x: 0, v: 0 } };
  let lastMove = -Infinity;
  window.addEventListener('pointermove', (e) => {
    if (reduceMotion || e.pointerType === 'touch' || !visible) return;
    const r = container.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = 1 - (e.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) { pointer.active = false; return; }
    if (!pointer.active) { pointer.px = x; pointer.py = y; pointer.active = true; }
    pointer.x = x; pointer.y = y; pointer.moved = true;
    rot.tx = x * 2 - 1; rot.ty = y * 2 - 1;
    lastMove = performance.now();
    wake();
  }, { passive: true });
  const spring = (s, target, k, dt) => { s.v += (-2 * k * s.v - k * k * (s.x - target)) * dt; s.x += s.v * dt; };

  /* ---------- loop ---------- */
  let raf = 0, running = false, visible = true, covered = false, last = 0, acc = 0, time = 0, frameAvg = 16, throttled = false, lastDraw = 0;
  const assemble = { v: mark && !reduceMotion ? 0 : 1 };
  const fadeOut = () => { const r = container.getBoundingClientRect(); const t = THREE.MathUtils.clamp(-r.top / (r.height || 1), 0, 1); return t * t; };
  function quiet() {
    const fluidQuiet = !fluidOK || (idleSteps >= 300 && !(pointer.moved && pointer.active) && pours.length === 0);
    const turning = mark && (Math.abs(rot.x.v) > 1e-3 || Math.abs(rot.y.v) > 1e-3 || performance.now() - lastMove < 1500);
    return fluidQuiet && assemble.v >= 1 && !turning;
  }
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 20); last = now; time += dt;
    if (mark) {
      pointsMat.uniforms.uTime.value = time; pointsMat.uniforms.uAssemble.value = assemble.v;
      let tx = rot.tx, ty = rot.ty;
      spring(rot.x, tx * 0.32, 2.4, dt); spring(rot.y, ty * 0.12, 2.4, dt);
      pivot.rotation.set(0.16 - rot.y.x, -0.32 + rot.x.x, 0);
    }
    if (fluidOK) {
      if (idleSteps < 300 || (pointer.moved && pointer.active) || pours.length) {
        const fade = fadeOut();
        acc = Math.min(acc + dt, STEP * 3);
        while (acc >= STEP) { simStep(fade); acc -= STEP; }
      } else acc = 0;
    }
    draw();
    if (quiet()) { running = false; return; }
    raf = requestAnimationFrame(frame);
  }
  function draw() {
    if (mark) {
      if (fluidOK) { pointsMat.uniforms.uVel.value = velocity.read.texture; pointsMat.uniforms.uDye.value = dye.read.texture; }
      renderer.setRenderTarget(overlay); renderer.setClearColor(0x000000, 0); renderer.clear(true, true, false);
      renderer.render(scene, camera);
    }
    composite.uniforms.uDye.value = fluidOK ? dye.read.texture : null;
    composite.uniforms.uOverlay.value = overlay.texture;
    run(composite, null);
  }
  function wake() {
    if (running || !visible || covered || document.hidden) return;
    running = true; last = performance.now(); raf = requestAnimationFrame(frame);
  }
  const sleep = () => { running = false; cancelAnimationFrame(raf); };

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? wake() : sleep(); }).observe(container);
  document.addEventListener('visibilitychange', () => (document.hidden ? sleep() : wake()));
  if (coveredBy) addEventListener('scroll', () => {
    const c = coveredBy.getBoundingClientRect().top <= 0;
    if (c !== covered) { covered = c; covered ? sleep() : wake(); }
  }, { passive: true });
  if (word && scrollWord) {
    let queued = false;
    const onScroll = () => {
      const off = Math.min(Math.max(window.scrollY, 0), H * 1.2);
      word.style.transform = `translate3d(0,${-off}px,0)`;
      composite.uniforms.uWordShift.value = off / H;
      if (!running && !queued && visible && !covered) { queued = true; requestAnimationFrame(() => { queued = false; draw(); }); }
    };
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  function start() {
    if (reduceMotion) { draw(); return; }
    if (mark) gsap.to(assemble, { v: 1, duration: 2.4, ease: 'expo.out', onUpdate: wake });
    if (!fluidOK || !introPour) return;
    const path = Array.from({ length: 27 }, (_, i) => [0.2 + (i / 26) * 0.62, 0.42 + Math.sin((i / 26) * Math.PI * 1.6) * 0.16]);
    path.forEach(([x, y], i) => setTimeout(() => {
      const [nx, ny] = path[Math.min(i + 1, path.length - 1)];
      pours.push([x, y, (nx - x) * 0.9, (ny - y) * 0.9]); wake();
    }, 600 + i * 22));
  }
  draw();
  return { start };
}

/* The STACK-UP mark: three soft slabs pierced by a thin up-arrow, engraved in dots. */
function buildMark(base) {
  const small = innerWidth < 760;
  const SLABS = 3, PER = small ? 14000 : 30000, ARROW = small ? 6000 : 12000;
  const total = SLABS * PER + ARROW;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  const scatter = new Float32Array(total * 3), phase = new Float32Array(total);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  // Pick dot colours so that, after the difference blend over the base, they land on the target colour.
  const solve = (target) => [0, 1, 2].map((i) => { const b = base.toArray()[i]; return THREE.MathUtils.clamp((target[i] - b) / (1 - 2 * b), 0, 1); });
  const SLAB_C = solve([0.14, 0.14, 0.14]);
  const ARROW_C = solve([0.88, 0.2, 0.11]);
  let i = 0;
  const sample = (geo, count, color, dy = 0) => {
    const s = new MeshSurfaceSampler(new THREE.Mesh(geo)).build();
    for (let k = 0; k < count; k++, i++) {
      s.sample(p, n);
      pos.set([p.x, p.y + dy, p.z], i * 3); nor.set([n.x, n.y, n.z], i * 3); col.set(color, i * 3);
      phase[i] = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, c = Math.sqrt(1 - u * u), l = 0.35 + Math.random() * 0.65;
      scatter.set([c * Math.cos(t) * l, c * Math.sin(t) * l, (Math.abs(u) * 1.6 + 0.2) * l], i * 3);
    }
  };
  const slab = new RoundedBoxGeometry(3.7, 0.72, 2.0, 8, 0.34);
  for (let l = 0; l < SLABS; l++) sample(slab, PER, SLAB_C, (l - 1) * 0.86 - 0.35);
  const shaft = new THREE.CylinderGeometry(0.045, 0.045, 3.9, 14, 1, true); shaft.translate(0, -0.3, 0);
  const head = new THREE.ConeGeometry(0.3, 0.75, 24, 1, true); head.translate(0, 1.65 + 0.37, 0);
  const shaftN = Math.round(ARROW * 0.45);
  sample(shaft, shaftN, ARROW_C);
  sample(head, ARROW - shaftN, ARROW_C);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aScatter', new THREE.BufferAttribute(scatter, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  return geo;
}

/* ---------------- surfaces ---------------- */
const heroEl = document.querySelector('[data-hero]');
const hero = createInk({
  container: heroEl, canvas: heroEl.querySelector('canvas'),
  base: css('--paper'), ink: new THREE.Color('#111111'),
  mark: true, wordmark: heroEl.querySelector('[data-wordmark]'),
  coveredBy: document.querySelector('.reel'), introPour: true,
  word: heroEl.querySelector('[data-wordmark]'), wordColor: css('--red'), wordInkColor: css('--paper'), scrollWord: true
});
const footEl = document.querySelector('[data-ink-footer]');
const footer = footEl && createInk({
  container: footEl, canvas: footEl.querySelector('canvas'),
  base: css('--dark'), ink: css('--paper'),
  word: footEl.querySelector('.footer__word'), wordColor: css('--red'), wordInkColor: css('--ink')
});
const go = () => { hero.start(); footer && footer.start(); };
window.__siteReady ? go() : document.addEventListener('site:ready', go, { once: true });
