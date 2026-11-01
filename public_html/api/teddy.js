// Teddy — STACK-UP website assistant (Vercel serverless function).
// Calls Claude server-side so the API key never reaches the browser.
// Set ANTHROPIC_API_KEY in Vercel → Project → Settings → Environment Variables.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

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
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "Assistant not configured" });

  const origin = req.headers.origin || "";
  if (origin && !ALLOWED.some((r) => r.test(origin))) return res.status(403).json({ error: "Origin not allowed" });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return res.status(429).json({ error: "Too many messages, please try again in a few minutes" });

  const messages = normalise(req.body?.messages);
  if (!messages.length || messages[messages.length - 1].role !== "user") return res.status(400).json({ error: "No user message" });

  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4096,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages,
      output_config: { effort: "low" },                 // quick, chatty replies
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",                             // retry on another model if a safety classifier declines
    });

    if (response.stop_reason === "refusal") {
      return res.status(200).json({ reply: "I can't help with that one, but I'm happy to chat about your project or STACK-UP's services!" });
    }
    const reply = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    if (!reply) return res.status(502).json({ error: "Empty reply" });
    return res.status(200).json({ reply });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "Assistant is busy, please try again shortly" });
    }
    if (err instanceof Anthropic.APIConnectionError) {
      console.error("Teddy: connection error", err.message);
      return res.status(502).json({ error: "Assistant temporarily unavailable" });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("Teddy: Claude API error", err.status, err.message);
      return res.status(502).json({ error: "Assistant temporarily unavailable" });
    }
    throw err;
  }
}
