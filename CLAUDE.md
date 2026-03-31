# CLAUDE.md — SaintSalLabs-Web
# SaintSal™ Labs — Web Platform Frontend
# Saint Vision Technologies LLC | US Patent #10,290,222 (HACP™)
# Owner: Ryan "Cap" Capatosto

---

## IDENTITY

This is the **SaintSal™ Labs web frontend** — the HTML/CSS/JS interface for `https://www.saintsallabs.com`.
It is served as static files FROM the SaintSalLabs-Backend (`/static` directory).
All API calls go to the same origin (`/api/...`). No cross-origin requests needed.

---

## STACK

| Layer | Technology |
|-------|-----------|
| HTML | Semantic HTML5 |
| CSS | Custom properties (CSS variables) — NO frameworks |
| JS | Vanilla ES2022+ — NO React, NO Vue, NO bundler |
| Fonts | Inter (UI) + SF Mono (code) |
| Icons | Inline SVG or Unicode only |
| Deployment | Files go in `/static` folder of SaintSalLabs-Backend |

---

## GOLDEN RULES — VIOLATE NONE

1. **ZERO NEW DESIGN SYSTEMS** — Use ONLY the CSS variables below. Every color, every spacing, every shadow uses these tokens. No Tailwind, no Bootstrap, no design frameworks.

2. **SSE FOR STREAMING** — All AI streaming uses `EventSource` or `fetch` with `ReadableStream`. Same pattern everywhere.

3. **ALL API CALLS USE THE GATEWAY KEY** — Every `fetch('/api/...')` includes `x-sal-key: saintvision_gateway_2025`. No exceptions.

4. **MATCH THE AESTHETIC** — Dark backgrounds, gold accents, subtle borders. JP Morgan-tier polish. Every pixel intentional.

5. **NO HARDCODED KEYS IN JS** — Zero API keys in any JS file. Everything goes through `/api/...` endpoints.

6. **ONE FILE PER SECTION** — Keep feature code in separate JS files. Don't put everything in app.js.

7. **ADDITIVE ONLY** — Add to existing files. Never delete working code. New sections go in new blocks.

---

## CSS DESIGN SYSTEM (NEVER CHANGE THESE)

```css
:root {
  /* Backgrounds */
  --bg:  #0b0b0f;
  --bg2: #131318;
  --bg3: #1a1a22;

  /* Text */
  --t1: #e8e6e1;
  --t2: #999;
  --t3: #666;

  /* Borders */
  --brd: #1e1e28;

  /* Accents */
  --gold:   #f59e0b;
  --green:  #00ff88;
  --purple: #a78bfa;
  --blue:   #60a5fa;
  --coral:  #f87171;
  --teal:   #2dd4bf;
  --amber:  #fbbf24;
  --pink:   #f472b6;

  /* Typography */
  --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --mono: 'SF Mono', Monaco, Consolas, monospace;

  /* Spacing */
  --r4:  4px;
  --r8:  8px;
  --r12: 12px;
  --r16: 16px;
}
```

---

## API CALL PATTERN

```javascript
// Standard API call
const response = await fetch('/api/mcp/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-sal-key': 'saintvision_gateway_2025',
  },
  body: JSON.stringify({ message, vertical, user_id }),
});

// SSE Streaming (AI chat)
async function streamSAL(endpoint, body, onChunk, onDone) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sal-key': 'saintvision_gateway_2025',
    },
    body: JSON.stringify(body),
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) { onDone?.(); break; }

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'chunk') onChunk(data.content);
          if (data.type === 'done' || data.type === 'complete') { onDone?.(data); break; }
        } catch (e) { /* skip malformed */ }
      }
    }
  }
}
```

---

## FILE STRUCTURE

```
SaintSalLabs-Web/
├── CLAUDE.md
├── index.html              — Main shell: sidebar, nav, auth modals
├── style.css               — Global styles (variables, layout, components)
├── app.js                  — Core app: auth, routing, tab switching
├── chat.js                 — Main chat + 8 verticals + SSE streaming
├── builder.js              — Builder v2: 5-agent IDE, design approval, deploy
├── career.js               — Career Suite: resume, jobs, cover letter, etc.
├── cards.js                — CookinCards: scan, grade, collection
├── creative.js             — Creative Studio: content, images, social
├── launchpad.js            — Launch Pad: formation wizard
├── ghl.js                  — GHL Intel Hub: pipelines, contacts, leads
├── finance.js              — Finance vertical
├── settings.js             — Settings, API keys, business DNA, billing
└── assets/
    ├── logo.png            — SaintSal™ Labs logo
    ├── logo-sm.png         — 32px icon
    └── favicon.ico
```

---

## LAYOUT SHELL (PERMANENT — DO NOT CHANGE)

```
┌─ Sidebar (240px) ──┬─ Main Content ──────────────────────────────────┐
│ [LOGO]             │                                                  │
│ ─────────────────  │  [Topbar: page title + user menu]               │
│ 🏠 Headquarters    │                                                  │
│ 🔍 SAL Search      │  [Active screen content]                        │
│ 🔨 Builder         │                                                  │
│ 🎯 Career Suite    │                                                  │
│ 🃏 CookinCards     │                                                  │
│ 🎨 Creative Studio │                                                  │
│ 🚀 Launch Pad      │                                                  │
│ 📊 GHL Intel       │                                                  │
│ 💰 Finance         │                                                  │
│ 🏠 Real Estate     │                                                  │
│ ─────────────────  │                                                  │
│ ⚙️ Settings        │                                                  │
│ [USER AVATAR]      │                                                  │
└────────────────────┴──────────────────────────────────────────────────┘
```

---

## CHAT VERTICAL PILLS

```
[ 🔍 Search ] [ ⚽ Sports ] [ 💰 Finance ] [ 🏠 Real Estate ]
[ 🏥 Medical ] [ ⚖️ Legal ] [ 💻 Tech ] [ 🛡️ Gov/Defense ]
```

Clicking a pill sets `activeVertical` and loads the vertical landing state.
Each vertical shows relevant trending content before the user types.

---

## BUILDER IDE LAYOUT

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Model: Grok 4.20 ▼] [Build #2] [⏱ 0:00]              [Deploy ▼]  │
├─────────────────┬───────────────────┬──────────────────────────────┤
│ CHAT + AGENTS   │ FILE TREE + CODE  │ LIVE PREVIEW / DESIGNS        │
│ (35%)           │ (35%)             │ (30%)                         │
├─────────────────┴───────────────────┴──────────────────────────────┤
│ [Agents] [Lint] [Deploy] terminal                                    │
└──────────────────────────────────────────────────────────────────────┘
```

5 Agent cards (pulse when active, green when complete):
- 🟠 Grok 4.20 — Architect
- 🔵 Stitch — Designer
- 🟣 Claude Sonnet — Engineer
- 🟣 Claude Opus — Synthesizer
- 🟢 GPT-5 Core — Validator

---

## SUPABASE AUTH

```javascript
// Auth is handled via Supabase JS client
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(
  'https://euxrlpuegeiggedqbkiv.supabase.co',
  SUPABASE_ANON_KEY // loaded from meta tag or config
);

// Auth state
supabase.auth.onAuthStateChange((event, session) => {
  if (session) renderApp(session.user);
  else renderAuth();
});
```

---

## COMPONENT PATTERNS

### Card
```html
<div class="card">
  <div class="card-header">
    <span class="badge badge-gold">PRO</span>
    <h3>Card Title</h3>
  </div>
  <p class="text-muted">Description</p>
</div>
```

### Badge
```html
<span class="badge badge-gold">Pro</span>
<span class="badge badge-green">Live</span>
<span class="badge badge-blue">New</span>
<span class="badge badge-coral">Beta</span>
```

### Button
```html
<button class="btn btn-primary">Primary Action</button>
<button class="btn btn-ghost">Ghost Action</button>
<button class="btn btn-gold">Gold CTA</button>
```

### Agent Status Card
```html
<div class="agent-card" data-status="idle|active|complete|error">
  <div class="agent-dot"></div>
  <div class="agent-info">
    <span class="agent-name">Grok 4.20</span>
    <span class="agent-role">Architect</span>
  </div>
  <span class="agent-status-text">Idle</span>
</div>
```

---

## VERIFICATION BEFORE EVERY COMMIT

```bash
# 1. No hardcoded API keys
grep -rn "sk-ant\|sk-proj\|tvly-\|xai-\|Bearer " *.js | grep -v "saintvision_gateway_2025" | head -5
# MUST return nothing

# 2. No direct external API calls
grep -rn "api.anthropic\|api.openai\|api.x.ai\|api.google" *.js | head -5
# MUST return nothing (all calls go through /api/...)

# 3. Check all fetch() calls use x-sal-key
grep -n "fetch(" *.js | grep -v "x-sal-key" | head -10
# Review any that don't have the key
```

---

## DEPLOYMENT

Files in this repo map to the `/static` folder in SaintSalLabs-Backend.

```bash
# Deploy: copy to backend static dir + push backend
cp -r . ../SaintSalLabs-Backend/static/
cd ../SaintSalLabs-Backend
git add static/
git commit -m "feat: update web frontend"
git push origin main
# Render picks up and redeploys
```

---

## THE STANDARD

Every screen should feel like it was built for Goldman Sachs.
Dark and gold. Clean spacing. No dead ends. No placeholder text.
Every button does something real. Every API call returns real data.
This is a patented platform (HACP™ US #10,290,222) serving 175+ countries.
Build it accordingly.
