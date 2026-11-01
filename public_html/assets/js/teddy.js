/* Teddy — floating STACK-UP AI agent: chat, eye tracking, blinking, lip-sync (ready for ElevenLabs voice),
   and section-aware nudges. Replies come from /api/teddy (Gemini, Vercel function);
   if that endpoint is unavailable, a local knowledge base answers instead. */
(function () {
  const API = '/api/teddy';
  const WHATSAPP = 'https://wa.me/919279745034?text=' + encodeURIComponent("Hi STACK-UP! Teddy sent me. I'd like a free consultation.");
  const SECTIONS = ['services', 'work', 'process', 'about', 'faq', 'contact'];

  const $ = (s) => document.querySelector(s);
  const root = $('#teddy'), btn = $('#teddyBtn'), bubble = $('#teddyBubble');
  const chat = $('#chat'), body = $('#chatBody'), form = $('#chatForm'), input = $('#chatInput');
  const face = root.querySelector('.bot__face'), eyes = [...root.querySelectorAll('.bot__eye')];
  const mouth = root.querySelector('.bot__mouth'), botBody = root.querySelector('.bot__body');

  const history = [];
  let open = false, greeted = false, busy = false;

  /* ---------------- personality: face follows the cursor, blinks, squints when hovered ---------------- */
  const lookX = gsap.quickTo(face, 'x', { duration: 0.5, ease: 'power3' });
  const lookY = gsap.quickTo(face, 'y', { duration: 0.5, ease: 'power3' });
  const tilt = gsap.quickTo(botBody, 'rotation', { duration: 0.8, ease: 'power3' });
  window.addEventListener('pointermove', (e) => {
    const r = btn.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const d = Math.min(1, Math.hypot(dx, dy) / 500);
    const a = Math.atan2(dy, dx);
    lookX(Math.cos(a) * d * 7); lookY(Math.sin(a) * d * 5);
    tilt(gsap.utils.clamp(-8, 8, dx / 60));
  }, { passive: true });
  let happy = false;
  function blink() {
    if (!happy) gsap.timeline().to(eyes, { scaleY: 0.1, duration: 0.07, ease: 'power2.in' }).to(eyes, { scaleY: 1, duration: 0.14, ease: 'power2.out' });
    setTimeout(blink, 2200 + Math.random() * 3200);
  }
  setTimeout(blink, 1800);
  btn.addEventListener('pointerenter', () => { happy = true; gsap.to(eyes, { scaleY: 0.45, y: -2, duration: 0.3, ease: 'back.out(3)' }); });
  btn.addEventListener('pointerleave', () => { happy = false; gsap.to(eyes, { scaleY: 1, y: 0, duration: 0.35, ease: 'back.out(2)' }); });
  btn.addEventListener('pointerdown', () => gsap.fromTo(botBody, { scaleY: 0.9, scaleX: 1.06 }, { scaleY: 1, scaleX: 1, duration: 0.7, ease: 'elastic.out(1.2, 0.35)' }));

  let bubbleTimer;
  function say(html, ms = 6000) {
    if (open) return;
    bubble.innerHTML = html;
    bubble.classList.add('is-on');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubble.classList.remove('is-on'), ms);
    gsap.fromTo(botBody, { y: -14 }, { y: 0, duration: 1, ease: 'bounce.out' }); // little hop
  }
  bubble.addEventListener('click', () => toggle(true));

  document.addEventListener('site:ready', () => {
    gsap.from(root, { y: 160, duration: 1.4, ease: 'elastic.out(1, 0.6)' });
    setTimeout(() => say("Hi, I'm <b>Teddy</b>, STACK-UP's assistant. Tell me what you're building."), 1200);
  });

  // One-time nudges as the visitor reaches key sections.
  const nudges = {
    services: 'Not sure which service fits? Tell me your idea and I\'ll point you to one.',
    work: 'Got something like this in mind? Tell me about it.',
    contact: 'Prefer chatting? I can set up a <b>free intro call</b>.'
  };
  const seen = new Set();
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    const id = e.target.id;
    if (e.isIntersecting && nudges[id] && !seen.has(id)) { seen.add(id); setTimeout(() => say(nudges[id]), 900); }
  }), { threshold: 0.35 });
  Object.keys(nudges).forEach((id) => document.getElementById(id) && io.observe(document.getElementById(id)));

  /* ---------------- open / close ---------------- */
  function toggle(force) {
    open = typeof force === 'boolean' ? force : !open;
    root.classList.toggle('is-open', open);
    chat.setAttribute('aria-hidden', String(!open));
    bubble.classList.remove('is-on');
    if (open) {
      if (!greeted) {
        greeted = true;
        bot("Hey, I'm Teddy, your guide to STACK-UP.\nWe build websites, apps, AI agents, custom software and video. What are you planning to build?");
      }
      setTimeout(() => input.focus({ preventScroll: true }), 400);
    } else {
      stopSpeaking();
    }
  }
  btn.addEventListener('click', () => toggle());
  $('#chatClose').addEventListener('click', () => toggle(false));

  /* ---------------- messages ---------------- */
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function add(role, html) {
    const el = document.createElement('div');
    const me = role.startsWith('me');
    el.className = `msg msg--${role}`;
    el.innerHTML = `<span class="msg__who">${me ? 'YOU' : 'TEDDY'}</span><span class="msg__text">${html}</span>`;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }
  function bot(raw) {
    // Action tokens the model may emit: [[CTA]] → WhatsApp button, [[GO:section]] → scroll the site there.
    let goTo = null, cta = false;
    let text = raw.replace(/\[\[GO:([a-z]+)\]\]/gi, (_, s) => { if (SECTIONS.includes(s.toLowerCase())) goTo = s.toLowerCase(); return ''; })
                  .replace(/\[\[CTA\]\]/gi, () => { cta = true; return ''; })
                  .replace(/\*\*(.+?)\*\*/g, '$1').trim();
    let html = esc(text)
      .replace(/(https?:\/\/[^\s)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/([\w.+-]+@stackup\.digital)/g, '<a href="mailto:$1">$1</a>');
    if (cta) html += `<br><a class="msg__cta" href="${WHATSAPP}" target="_blank" rel="noopener">[ BOOK A FREE CALL → ]</a>`;
    add('bot', html);
    history.push({ role: 'assistant', content: raw });
    speak(text);
    if (goTo && window.lenis) setTimeout(() => window.lenis.scrollTo('#' + goTo, { duration: 1.8, offset: -20 }), 700);
  }

  async function send(text) {
    text = text.trim();
    if (!text || busy) return;
    busy = true;
    stopSpeaking();
    add('me', esc(text));
    history.push({ role: 'user', content: text });
    input.value = '';
    const typing = add('bot msg--typing', '<i></i><i></i><i></i>');
    let reply;
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.slice(-12) })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data.reply) throw new Error('empty');
      reply = data.reply;
    } catch {
      reply = localBrain(text);
    }
    typing.remove();
    bot(reply);
    busy = false;
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
  $('#chatChips').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) send(b.textContent.replace(/[\[\]]/g, '').toLowerCase()); });

  /* ---------------- voice (ElevenLabs — to be wired later) ----------------
     Teddy is text-only for now. To add ElevenLabs later, implement speak() to:
       1. POST the text to a server endpoint (e.g. api/voice.php) that calls ElevenLabs
          text-to-speech with the API key kept server-side, and returns audio/mpeg.
       2. Play it with an <audio> element: talkAnim(true) on 'play', talkAnim(false) on 'ended'.
     The lip-sync animation below is already hooked up and ready. */
  let mouthTween = null, currentAudio = null;
  function talkAnim(on) {
    root.classList.toggle('is-talking', on);
    if (mouthTween) { mouthTween.kill(); mouthTween = null; }
    if (on) {
      mouthTween = gsap.to(mouth, { scaleY: () => 1.4 + Math.random() * 1.6, duration: 0.11, repeat: -1, yoyo: true, repeatRefresh: true, ease: 'sine.inOut' });
    } else {
      gsap.to(mouth, { scaleY: 1, duration: 0.2 });
    }
  }
  function speak(text) { /* ElevenLabs hook — intentionally a no-op for now */ }
  function stopSpeaking() {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    talkAnim(false);
  }

  /* ---------------- offline knowledge base ---------------- */
  function localBrain(q) {
    const s = q.toLowerCase();
    // Whole-word match so "ai" doesn't fire on "email" or "hi" on "this".
    const has = (...w) => w.some((x) => new RegExp(`\\b${x}\\b`, 'i').test(s));
    if (has('price', 'pricing', 'cost', 'budget', 'charge', 'kitna', 'rate', 'fee'))
      return "Every project is priced by scope and written into a fixed proposal before work starts, so the number never moves without you agreeing. The quickest way to get yours is a free intro call. [[CTA]]";
    if (has('how long', 'time', 'timeline', 'days', 'weeks', 'deadline', 'kab'))
      return "It depends on scope. A focused website moves much faster than a full app or platform. After a short call we'll give you a timeline in writing.";
    if (has('ai', 'agent', 'chatbot', 'automation', 'bot'))
      return "Assistants like me are one of the things we build: agents that answer questions, qualify leads, book meetings and plug into your CRM or WhatsApp. What would you like to automate? [[GO:services]]";
    if (has('app', 'android', 'ios', 'mobile', 'flutter'))
      return "We build iOS and Android apps from one codebase, so they feel native and launch on both stores together.";
    if (has('video', 'reel', 'edit', 'youtube', 'motion'))
      return "We cut reels, ads and launch films with proper sound design and colour. Do you have footage already, or do you need help with the idea too?";
    if (has('seo', 'ads', 'meta', 'marketing', 'instagram', 'growth'))
      return "Our growth work covers paid social, search and SEO, measured on leads and revenue. Want us to look at what you're running now? [[CTA]]";
    if (has('erp', 'crm', 'software', 'inventory', 'billing', 'dashboard'))
      return "We build custom dashboards, CRMs and internal tools around how your team actually works, so you can stop living in spreadsheets.";
    if (has('what do you build', 'what you build', 'services', 'offer'))
      return "We design and build websites, mobile apps, AI agents, custom software, video and brand systems, plus growth marketing to bring people in. What's on your mind? [[GO:services]]";
    if (has('work', 'make', 'portfolio', 'project', 'example', 'show'))
      return "Here's what we make: websites, apps and platforms, and AI agents. [[GO:work]]";
    if (has('who', 'team', 'founder', 'about', 'studio'))
      return "STACK-UP is a small, senior studio. Design, engineering, AI and video sit in one team, so nothing gets lost in hand-offs. [[GO:about]]";
    if (has('contact', 'call', 'book', 'whatsapp', 'email', 'phone', 'talk'))
      return "The fastest route is WhatsApp at +91 92797 45034, or email support@stackup.digital. [[CTA]]";
    if (has('website', 'web', 'site', 'landing', 'ecommerce', 'shop', 'store'))
      return "We design and build fast, accessible websites and web apps, from a single landing page up to full platforms. Is this a new build or a redesign?";
    if (has('llm', 'model', 'gpt', 'gemini', 'chatgpt', 'which ai', 'what ai'))
      return "I'm Teddy, STACK-UP's assistant, running on Google's Gemini. We build assistants like me for clients too. Want one for your business? [[GO:services]]";
    if (has('hi', 'hello', 'hey', 'namaste'))
      return "Hey there! What are you planning to build: a website, an app, an AI agent, or something else?";
    return "Good question. That's best answered on a quick intro call. Meanwhile, I can tell you about what we build or how we work. [[CTA]]";
  }
})();
