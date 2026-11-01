/* STACK-UP — page motion: Lenis smooth scroll + GSAP (ScrollTrigger, SplitText, ScrambleText).
   Only transform / opacity / clip-path are animated, so scrolling stays on the compositor. */
gsap.registerPlugin(ScrollTrigger, SplitText, ScrambleTextPlugin);

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ---------------- film grain: 1-bit noise tile, generated once ---------------- */
(function grain() {
  const size = 128, c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d'), img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const r = Math.random();
    if (r >= 0.28) continue;
    const v = r < 0.14 ? 0 : 255;
    img.data.set([v, v, v, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  document.documentElement.style.setProperty('--grain-tile', `url(${c.toDataURL()})`);
})();

/* ---------------- micro-interaction markup ---------------- */
// [LABEL] → brackets that spread on hover
$$('.bracket').forEach((el) => {
  if (el.children.length) return;
  const m = el.textContent.trim().match(/^\[(.*)\]$/s);
  if (!m) return;
  el.innerHTML = `<span class="bl">[</span>${m[1]}<span class="br">]</span>`;
});
// nav labels roll to a red copy on hover
$$('.roll').forEach((el) => {
  const t = el.textContent;
  el.innerHTML = `<span class="r1">${t}</span><span class="r2" aria-hidden="true">${t}</span>`;
});

/* ---------------- smooth scroll ---------------- */
const lenis = new Lenis({
  duration: 1.1,
  easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  smoothWheel: !reduceMotion,
  syncTouch: false,
  autoRaf: false
});
window.lenis = lenis;
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((t) => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);
lenis.stop();

$$('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href');
    const target = id === '#top' || id === '#' ? 0 : $(id);
    if (target === null) return;
    e.preventDefault();
    closeMenu();
    lenis.scrollTo(target, { duration: 1.6 });
  });
});

/* ---------------- fit display words to their box width ---------------- */
function fitAll() {
  $$('[data-fit]').forEach((el) => {
    el.style.fontSize = '100px';
    const range = document.createRange();
    range.selectNodeContents(el);
    const scale = el.getBoundingClientRect().width / (el.offsetWidth || 1) || 1;   // ignore any scale transform
    const textW = range.getBoundingClientRect().width / scale;
    const cs = getComputedStyle(el);
    const avail = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (textW) el.style.fontSize = (100 * avail / textW).toFixed(2) + 'px';
  });
}
fitAll();
let fitTimer;
window.addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(() => { fitAll(); ScrollTrigger.refresh(); }, 150); });

/* Hand a wordmark to the WebGL ink pass once its intro animation has finished. */
function glWord(sel) {
  const el = $(sel);
  if (!el) return;
  el.dataset.glready = '1';
  el.dispatchEvent(new Event('glword'));
}
if (reduceMotion) document.addEventListener('site:ready', () => glWord('.footer__word'));

/* ---------------- loader → intro ---------------- */
function intro() {
  fitAll();
  const word = new SplitText('.hero__word', { type: 'chars', charsClass: 'char' });
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
  const count = { v: 0 };
  if (!reduceMotion) {
    tl.from('.lm1', { y: 40, opacity: 0, duration: 0.7 }, 0)
      .from('.lm2', { y: 40, opacity: 0, duration: 0.7 }, 0.12)
      .from('.lm3', { y: 50, opacity: 0, duration: 0.8 }, 0.24)
      .to('.loader__label', { duration: 1, scrambleText: { text: '[ STACKING UP ]', chars: 'upperCase', speed: 0.5 } }, 0)
      .to(count, { v: 100, duration: 1.1, ease: 'power2.inOut', onUpdate: () => ($('#loaderCount').textContent = Math.round(count.v)) }, 0)
      .to('.lm3', { y: -120, duration: 0.6, ease: 'expo.in' }, 1.15)
      .to('.loader', { clipPath: 'inset(0 0 100% 0)', duration: 0.9, ease: 'expo.inOut' }, 1.35);
  }
  tl.add(() => {
      $('#loader').style.display = 'none';
      document.body.classList.remove('is-loading');
      lenis.start();
      window.__siteReady = true;
      document.dispatchEvent(new Event('site:ready'));
    })
    .from(word.chars, { yPercent: 105, duration: 1.3, stagger: 0.045, onComplete: () => glWord('.hero__word') }, reduceMotion ? 0 : 1.7)
    .from('.header > *', { y: -20, opacity: 0, duration: 1, stagger: 0.08 }, '<0.2')
    .from('.hero__intro', { opacity: 0, y: 16, duration: 1.1 }, '<0.2')
    .from('.hud', { opacity: 0, duration: 1 }, '<');
  scramble($('.hero__hint'), 2.4);
}
// Wait for the expanded display face itself (fonts.ready alone can resolve before it is requested).
const fontsReady = document.fonts
  ? Promise.all([document.fonts.load('900 100px Archivo'), document.fonts.load('500 12px Archivo')]).then(() => document.fonts.ready).catch(() => {})
  : Promise.resolve();
fontsReady.then(intro);
// Safety net for cold caches: refit a few times while late font files settle.
[600, 1500, 3000, 6000].forEach((t) => setTimeout(fitAll, t));
if (document.fonts) document.fonts.addEventListener('loadingdone', () => { fitAll(); ScrollTrigger.refresh(); });

/* ---------------- scramble-in labels ---------------- */
function scramble(el, delay = 0) {
  if (reduceMotion || !el) return;
  const text = el.textContent;
  gsap.set(el, { opacity: 0 });
  gsap.to(el, { opacity: 1, duration: 0.01, delay });
  gsap.to(el, { delay, duration: Math.min(1.6, 0.4 + text.length * 0.035), scrambleText: { text, chars: 'upperCase', speed: 0.6, revealDelay: 0.15 } });
}
$$('[data-scramble]').forEach((el) => {
  if (el.closest('.hero')) return;
  ScrollTrigger.create({ trigger: el, start: 'top 92%', once: true, onEnter: () => scramble(el) });
});

/* ---------------- header + HUD ---------------- */
const header = $('#header'), hud = $('.hud'), hudPct = $('#hudPct');
let lastY = 0;
lenis.on('scroll', ({ scroll, limit }) => {
  header.classList.toggle('is-hidden', scroll > lastY && scroll > window.innerHeight * 1.4 && !menuOpen);
  header.classList.toggle('is-compact', scroll > 40);
  lastY = scroll;
  const pct = String(Math.round((scroll / (limit || 1)) * 100)).padStart(3, '0');
  if (pct !== hudPct.textContent) hudPct.textContent = pct;
});
function clock() {
  $('#hudTime').textContent = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
}
clock(); setInterval(clock, 20000);
$('#year').textContent = new Date().getFullYear();

/* ---------------- menu ---------------- */
let menuOpen = false;
const menu = $('#menu'), menuBtn = $('#menuBtn');
function openMenu() {
  menuOpen = true; menu.classList.add('is-open'); menu.setAttribute('aria-hidden', 'false');
  menuBtn.textContent = 'CLOSE'; menuBtn.setAttribute('aria-expanded', 'true'); lenis.stop();
  gsap.timeline()
    .to(menu, { clipPath: 'inset(0 0 0% 0)', duration: 0.8, ease: 'expo.inOut' })
    .fromTo('.menu__links a', { yPercent: 105 }, { yPercent: 0, duration: 0.8, stagger: 0.05, ease: 'expo.out' }, '-=0.35');
}
function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false; menu.setAttribute('aria-hidden', 'true');
  menuBtn.textContent = 'MENU'; menuBtn.setAttribute('aria-expanded', 'false'); lenis.start();
  gsap.to(menu, { clipPath: 'inset(100% 0 0% 0)', duration: 0.7, ease: 'expo.inOut',
    onComplete: () => { menu.classList.remove('is-open'); gsap.set(menu, { clipPath: 'inset(0 0 100% 0)' }); } });
}
menuBtn.addEventListener('click', () => (menuOpen ? closeMenu() : openMenu()));
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu());

if (!reduceMotion) {
  /* ---------------- hero + reel ---------------- */
  gsap.to('.hero__intro', { opacity: 0, y: -30, ease: 'none', scrollTrigger: { trigger: '.reel', start: 'top bottom', end: 'top 40%', scrub: true } });
  gsap.fromTo('.reel__media img', { scale: 1.25 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: '.reel', start: 'top bottom', end: 'bottom top', scrub: true } });
  // showreel card: rises narrower than the screen and widens to full bleed as it lands;
  // its title rides from the top of the card down to the bottom.
  gsap.fromTo('.reel', { '--reel-in': '6%' }, { '--reel-in': '0%', ease: 'none', scrollTrigger: { trigger: '.reel', start: 'top 85%', end: 'top top', scrub: true } });
  gsap.fromTo('.reel__title', { y: 0 }, { y: () => $('.reel').offsetHeight - $('.reel__title').offsetHeight - parseFloat(getComputedStyle($('.reel__title')).top) - window.innerWidth * 0.06 - 24, ease: 'none',
    scrollTrigger: { trigger: '.reel', start: 'top bottom', end: 'top top', scrub: true, invalidateOnRefresh: true } });
  gsap.fromTo('.reel__title', { scale: 0.88 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: '.reel', start: 'top 85%', end: 'top top', scrub: true } });

  /* ---------------- headings: characters rise with the scroll ---------------- */
  $$('[data-chars]').forEach((h) => {
    const s = new SplitText(h, { type: 'chars', mask: 'chars' });
    gsap.fromTo(s.chars, { yPercent: 110 }, { yPercent: 0, ease: 'none', stagger: 0.04,
      scrollTrigger: { trigger: h, start: 'top 96%', end: 'top 58%', scrub: 0.6 } });
  });

  /* ---------------- big statements fill in word by word ---------------- */
  $$('[data-words]').forEach((p) => {
    p.innerHTML = p.textContent.trim().split(/\s+/).map((w) => `<span class="w">${w}</span>`).join(' ');
    gsap.to($$('.w', p), { opacity: 1, ease: 'none', stagger: 0.1,
      scrollTrigger: { trigger: p, start: 'top 78%', end: 'bottom 52%', scrub: 0.5 } });
  });

  /* ---------------- services: pinned horizontal run ---------------- */
  const track = $('#servicesTrack');
  const dist = () => Math.max(0, track.scrollWidth - window.innerWidth);
  const run = gsap.to(track, {
    x: () => -dist(), ease: 'none',
    scrollTrigger: { trigger: '.services__pin', pin: '.services', start: 'bottom bottom', end: () => `+=${dist()}`, scrub: 0.6, invalidateOnRefresh: true }
  });
  $$('.look').forEach((look) => {
    gsap.to($('img', look), { scale: 1, ease: 'none', scrollTrigger: { trigger: look, containerAnimation: run, start: 'left right', end: 'right left', scrub: true } });
  });
  gsap.from('.look', { y: 80, opacity: 0, duration: 1.2, stagger: 0.07, ease: 'expo.out', scrollTrigger: { trigger: '.services__track', start: 'top 88%' } });

  /* ---------------- what we make: index scrolls past a fixed card ---------------- */
  (function index() {
    const lists = $$('.wm__list'), rowsA = $$('li', lists[0]), rowsB = $$('li', lists[1]);
    const imgs = $$('.wm__card img'), n = rowsA.length, card = $('.wm__card'), pin = $('.wm__pin');
    let current = -1;
    const setY = lists.map((l) => gsap.quickTo(l, 'y', { duration: 0.6, ease: 'power3' }));
    function clip() {                                    // card rect from layout (ignores its scale-in transform)
      const W = pin.clientWidth, H = pin.clientHeight, w = card.offsetWidth, h = card.offsetHeight;
      const l = (W - w) / 2, t = (H - h) / 2;
      pin.style.setProperty('--ct', t + 'px'); pin.style.setProperty('--cb', (H - t - h) + 'px');
      pin.style.setProperty('--cl', l + 'px'); pin.style.setProperty('--cr', (W - l - w) + 'px');
    }
    function activate(i) {
      if (i === current) return;
      current = i;
      rowsA.forEach((r, k) => r.classList.toggle('is-on', k === i));
      rowsB.forEach((r, k) => r.classList.toggle('is-on', k === i));
      imgs.forEach((im, k) => im.classList.toggle('is-on', k === i));
      gsap.to('#wmNow', { duration: 0.5, scrambleText: { text: String(i + 1).padStart(2, '0'), chars: '0123456789' } });
    }
    activate(0);
    ScrollTrigger.create({
      trigger: '.wm', pin: '.wm__pin', start: 'top top', end: () => '+=' + window.innerHeight * (n * 0.45), invalidateOnRefresh: true,
      onRefresh: clip,
      onUpdate: (st) => {
        const f = st.progress * (n - 1);
        const row = rowsA[0].offsetHeight;
        setY.forEach((q) => q(-f * row));
        activate(Math.round(f));
      }
    });
    clip(); window.addEventListener('resize', clip);
    gsap.from(card, { scale: 0.6, opacity: 0, duration: 1.4, ease: 'expo.out', scrollTrigger: { trigger: '.wm', start: 'top 60%' } });
  })();

  /* ---------------- B/: giant marquee rows with an opening image window ---------------- */
  gsap.timeline({ scrollTrigger: { trigger: '.window', pin: '.window__pin', start: 'top top', end: '+=150%', scrub: 0.8 } })
    .fromTo('.window__row--a', { xPercent: 0 }, { xPercent: -30, ease: 'none' }, 0)
    .fromTo('.window__row--b', { xPercent: -30 }, { xPercent: 0, ease: 'none' }, 0)
    .fromTo('.window__media', { clipPath: 'inset(38% 41% 38% 41%)' }, { clipPath: 'inset(0% 0% 0% 0%)', ease: 'power2.inOut' }, 0.15)
    .fromTo('.window__media img', { scale: 1.25 }, { scale: 1, ease: 'none' }, 0.15);

  /* ---------------- process: earlier layers sink back ---------------- */
  const layers = $$('.layer');
  layers.forEach((layer, i) => {
    const next = layers[i + 1];
    if (!next) return;
    gsap.to(layer, { scale: 0.92 + i * 0.015, ease: 'none', scrollTrigger: { trigger: next, start: 'top bottom', end: 'top 25%', scrub: true } });
  });

  /* ---------------- C/ approach ---------------- */
  gsap.fromTo('[data-parallax]', { yPercent: -12 }, { yPercent: 0, ease: 'none', scrollTrigger: { trigger: '.approach__img', start: 'top bottom', end: 'bottom top', scrub: true } });
  gsap.from('.approach__img', { clipPath: 'inset(100% 0 0 0)', duration: 1.4, ease: 'expo.inOut', scrollTrigger: { trigger: '.approach__img', start: 'top 85%' } });
  gsap.from('.tags li', { y: 24, opacity: 0, duration: 0.8, stagger: 0.05, ease: 'expo.out', scrollTrigger: { trigger: '.tags', start: 'top 90%' } });

  /* ---------------- capabilities grid ---------------- */
  gsap.from('.cell', { opacity: 0, y: 20, duration: 0.8, stagger: { each: 0.04, from: 'random' }, ease: 'expo.out', scrollTrigger: { trigger: '.tools__grid', start: 'top 85%' } });

  /* ---------------- footer wordmark: letters rise into view ---------------- */
  const fw = new SplitText('.footer__word', { type: 'chars', charsClass: 'char', mask: 'chars' });
  gsap.from(fw.chars, { yPercent: 100, duration: 1.2, stagger: 0.05, ease: 'expo.out', onComplete: () => glWord('.footer__word'), scrollTrigger: { trigger: '.footer__word', start: 'top 98%' } });
  gsap.from('.footer__big', { yPercent: 30, opacity: 0, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: '.footer__big', start: 'top 90%' } });
}

/* ---------------- gallery strip: endless, speeds up with scroll velocity ---------------- */
(function strip() {
  const row = $('[data-strip]');
  row.appendChild(row.children[0].cloneNode(true));
  let unit = 0, x = 0, dir = 1, visible = false;
  const measure = () => (unit = row.children[0].offsetWidth);
  window.addEventListener('load', measure);
  window.addEventListener('resize', measure);
  measure();
  const setX = gsap.quickSetter(row, 'x', 'px');
  ScrollTrigger.create({ trigger: '.strip', start: 'top bottom', end: 'bottom top', onToggle: (st) => (visible = st.isActive) });
  gsap.ticker.add(() => {
    if (!visible || !unit || reduceMotion) return;
    const v = lenis.velocity || 0;
    if (Math.abs(v) > 0.5) dir = v > 0 ? 1 : -1;
    x -= (0.6 + Math.abs(v) * 0.5) * dir;
    x = ((x % unit) + unit) % unit - unit;
    setX(x);
  });
})();

/* ---------------- reel buttons ---------------- */
(function reel() {
  const v = $('.reel video'), play = $('.reel__ctl--l'), mute = $('.reel__ctl--r');
  const label = (el, t) => gsap.to(el, { duration: 0.5, scrambleText: { text: t, chars: 'upperCase' } });
  play.addEventListener('click', () => {
    if (!v.querySelector('source')) { label(play, '[REEL SOON]'); return; }
    if (v.paused) { v.play(); $('.reel').classList.add('is-playing'); label(play, '[PAUSE]'); } else { v.pause(); $('.reel').classList.remove('is-playing'); label(play, '[PLAY REEL]'); }
  });
  mute.addEventListener('click', () => { v.muted = !v.muted; label(mute, v.muted ? '[UNMUTE]' : '[MUTE]'); });
})();

/* ---------------- FAQ accordion ---------------- */
$$('.qa').forEach((d) => {
  const sum = $('summary', d), body = $('div', d);
  sum.addEventListener('click', (e) => {
    e.preventDefault();
    if (d.open) {
      gsap.to(body, { height: 0, duration: 0.5, ease: 'expo.inOut', onComplete: () => { d.open = false; ScrollTrigger.refresh(); } });
    } else {
      d.open = true;
      gsap.fromTo(body, { height: 0 }, { height: 'auto', duration: 0.6, ease: 'expo.out', onComplete: () => ScrollTrigger.refresh() });
    }
  });
});

/* ---------------- contact form (same Google Apps Script endpoint as v1) ---------------- */
const FORM_ENDPOINT = 'https://script.google.com/macros/s/AKfycbx6dTuTqHj5s2yvoIlZhosoBfotIZx6lEe2tY-yUqPnIeT-yZqpPkKHBpK10sv0rQY2/exec';
$('#contactForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, status = $('#formStatus'), btnText = $('#formBtnText');
  const say = (el, t) => gsap.to(el, { duration: 0.6, scrambleText: { text: t, chars: 'upperCase' } });
  const data = Object.fromEntries(new FormData(f));
  if (!data.name || !data.phone || !data.email || !data.service) { say(status, '[ PLEASE FILL NAME, PHONE, EMAIL & SERVICE ]'); return; }
  say(btnText, '[SENDING…]');
  try {
    const res = await fetch(FORM_ENDPOINT, { method: 'POST', body: JSON.stringify(data) });
    const out = await res.json();
    if (out.result !== 'success') throw new Error('bad result');
    f.reset();
    say(status, "[ RECEIVED — WE'LL BE IN TOUCH SOON ]");
    say(btnText, '[SENT]');
  } catch {
    say(status, '[ SOMETHING WENT WRONG — PLEASE USE WHATSAPP OR EMAIL ]');
    say(btnText, '[SEND IT OVER]');
  }
});

/* Header + HUD colour by section. Created last with low priority so their positions
   are measured after every pinned section has added its spacing. */
$$('[data-theme="dark"]').forEach((sec) => {
  ScrollTrigger.create({ trigger: sec, start: 'top 40px', end: 'bottom 40px', refreshPriority: -1, onToggle: (st) => header.classList.toggle('is-dark', st.isActive) });
  ScrollTrigger.create({ trigger: sec, start: 'top 50%', end: 'bottom 50%', refreshPriority: -1, onToggle: (st) => hud.classList.toggle('is-dark', st.isActive) });
});
ScrollTrigger.sort();

/* Keep ScrollTrigger positions correct as lazy images and fonts settle. */
window.addEventListener('load', () => { fitAll(); ScrollTrigger.refresh(); });
// Lazy images all have reserved boxes, so page height is stable: no ResizeObserver-driven
// ScrollTrigger.refresh() mid-scroll (that was causing 80–260 ms hitches).
document.querySelectorAll('img[loading="lazy"]').forEach((img) => img.decode && img.decode().catch(() => {}));
