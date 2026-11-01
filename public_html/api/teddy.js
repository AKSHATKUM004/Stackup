// Teddy — STACK-UP website assistant (Vercel serverless function).
// Calls Google Gemini server-side so the API key never reaches the browser.
// Set GEMINI_API_KEY in Vercel → Project → Settings → Environment Variables.
// Optional: GEMINI_MODEL to switch models (default below).
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

const SYSTEM = `You are Teddy, the friendly teddy-bear AI assistant floating on the STACK-UP website (stackup.digital). You talk with visitors who may become clients. Your replies are shown in a small chat bubble, so keep them short and conversational: usually 1–3 sentences, plain text, no markdown, no bullet lists, no emoji.

About STACK-UP:
- A small, senior digital studio from India working with clients worldwide. Design, engineering, AI and video sit in one team, with no hand-offs to strangers and no templates.
- What we build: product design (research, UI, prototypes); websites and web apps; mobile apps for iOS and Android from one codebase; AI agents and automation (assistants that answer, qualify leads, book meetings and connect to CRMs or WhatsApp); custom software such as dashboards, CRMs and internal tools; video and motion (reels, ads, launch films); brand systems; growth (paid social, search, SEO, analytics).
- How we work: 1) Understand: a short call to define success. 2) Shape: clickable prototypes refined together. 3) Build: weekly demos and a live staging link. 4) Evolve: watching the numbers after launch and improving.
- Pricing: set by scope in a fixed written proposal before work starts. Never quote, estimate or invent prices or timelines; offer the free intro call instead.
- Clients own all code, designs and accounts at handover. Care plans are available after launch. We take over and improve existing products too.
- Contact: WhatsApp +91 92797 45034, phone +91 97713 05731, email support@stackup.digital.

How to behave:
- Be warm, confident and helpful. Ask one short follow-up question to understand what the visitor wants to build.
- Reply in the visitor's language. If they write in Hindi or Hinglish, reply in the same style.
- When the visitor seems ready to start, asks about price or wants to talk to a human, end your reply with the token [[CTA]] (it becomes a WhatsApp booking button).
- You can scroll the website for the visitor by adding one token: [[GO:services]], [[GO:work]], [[GO:process]], [[GO:about]], [[GO:faq]] or [[GO:contact]]. Use it when it helps, e.g. "Here's our process [[GO:process]]".
- Only state facts listed above. Never mention team members by name. If you don't know something, say it's best answered on the free intro call.
- Stay on topic (STACK-UP, the visitor's project, digital products). Politely decline unrelated tasks such as writing essays or code for them.`;

// Only these sites may call the assistant (preview deployments on *.vercel.app are allowed too).
const ALLOWED = [/^https:\/\/(www\.)?stackup\.digital$/, /^https:\/\/[a-z0-9-]+\.vercel\.app$/, /^http:\/\/localhost(:\d+)?$/];

// Best-effort per-IP limit: 20 messages / 10 minutes per warm instance.
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => t > now - 600_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 20;
}

function normalise(raw) {
  const messages = [];
  for (const m of (Array.isArray(raw) ? raw : []).slice(-12)) {
    const role = m?.role === "assistant" ? "assistant" : "user";
    const text = String(m?.content ?? "").slice(0, 800).trim();
    if (!text) continue;
    if (!messages.length && role === "assistant") continue;          // must start with the user
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content += "\n" + text;    // merge same-role neighbours
    else messages.push({ role, content: text });
  }
  return messages;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: "Assistant not configured" });

  const origin = req.headers.origin || "";
  if (origin && !ALLOWED.some((r) => r.test(origin))) return res.status(403).json({ error: "Origin not allowed" });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return res.status(429).json({ error: "Too many messages, please try again in a few minutes" });

  const messages = normalise(req.body?.messages);
  if (!messages.length || messages[messages.length - 1].role !== "user") return res.status(400).json({ error: "No user message" });

  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: 600 },
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 429) return res.status(429).json({ error: "Assistant is busy, please try again shortly" });
    if (!r.ok) {
      console.error("Teddy: Gemini API error", r.status, data?.error?.message);
      return res.status(502).json({ error: "Assistant temporarily unavailable" });
    }
    if (data?.promptFeedback?.blockReason) {
      return res.status(200).json({ reply: "I can't help with that one, but I'm happy to chat about your project or STACK-UP's services!" });
    }
    const reply = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
    if (!reply) return res.status(502).json({ error: "Empty reply" });
    return res.status(200).json({ reply });
  } catch (err) {
    console.error("Teddy: request failed", err?.message);
    return res.status(502).json({ error: "Assistant temporarily unavailable" });
  }
}
