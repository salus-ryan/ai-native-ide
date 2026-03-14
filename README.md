# Aria IDE — The Self-Aware AI Coding Agent

**Aria** is an AI-native IDE where the agent is aware of her own architecture, can introspect her own source code, and operates as a runtime-native system — not just a chatbot bolted onto an editor.

## Quick Start

One command. Needs [Node.js](https://nodejs.org/) (v18+) and an [OpenRouter API key](https://openrouter.ai/keys).

```bash
git clone https://github.com/salus-ryan/ai-native-ide.git
cd ai-native-ide
OPENROUTER_API_KEY=sk-or-v1-YOUR_KEY_HERE ./bootstrap.sh
```

This clones the repo, installs dependencies, writes your API key, starts the server, and **auto-opens the IDE in your browser**.

| | URL |
|---|---|
| **IDE + API** | http://localhost:3200 |
| **Braille WebSocket** | ws://localhost:3201 |
| **Mobile** | `http://<your-lan-ip>:3200` |
| **CLI** | `npm run aria` |

The server binds to `0.0.0.0` — open it on your phone from the same WiFi.

To stop: `kill $(cat /tmp/aria-server.pid)`

## What Makes This Different

Unlike Cursor, Windsurf, or other AI IDEs that wrap a chat interface around an editor, Aria is **architecture-aware from the ground up**:

- **Self-introspection** — Aria can read her own module graph, source code, and runtime state via built-in tools
- **Multi-model braiding** — queries all available LLMs in parallel via a braille-encoded swarm, braids their responses
- **Runtime loop engine** — plan → execute → observe → evaluate → repair cycle, not just chat
- **Persistent world model** — knowledge graph that survives across conversations
- **Context compaction** — automatic context window management using UEB braille compression
- **File operation feedback** — toast notifications, file tree highlights, and tab badges when Aria creates or edits files
- **Tauri desktop app** — native window with managed Node.js backend, not just a web page

## Architecture

Aria has a machine-readable architecture manifest at `ARCHITECTURE.json` that she can read herself. A single Node.js server (`aria-server.mjs`) serves both the API and the IDE frontend on port 3200.

```
┌─────────────────────────────────────────────────────┐
│  Desktop Shell (Tauri v2)                           │
│  src-tauri/src/main.rs — spawns & manages Node.js   │
│  desktop/ide.html + ide.js — Monaco-based IDE UI    │
├─────────────────────────────────────────────────────┤
│  Server (Node.js — single process, port 3200)       │
│  scripts/aria-server.mjs — HTTP API + SSE + static  │
│  Braille WebSocket on port 3201                     │
├─────────────────────────────────────────────────────┤
│  Agent                                              │
│  src/agent.js — multi-turn agentic loop with tools  │
│  src/tools.js — file ops, commands, browser, etc.   │
│  src/introspect.js — self-awareness tools           │
├─────────────────────────────────────────────────────┤
│  Intelligence                                       │
│  src/llm.cjs — OpenRouter client with streaming     │
│  src/compaction.js — context window management      │
│  src/world-model.js — persistent knowledge graph    │
├─────────────────────────────────────────────────────┤
│  Braille Communication                              │
│  src/braille.js — unified encoding (byte + char)    │
│  src/braille-swarm.js — multi-model orchestration   │
│  src/braided-llm.js — response braiding & fusion    │
│  src/braille-harness.js — UEB compression           │
│  src/braille-websocket.js — real-time streaming     │
├─────────────────────────────────────────────────────┤
│  Core Loop                                          │
│  src/core.js — plan/execute/observe/evaluate cycle  │
└─────────────────────────────────────────────────────┘
```

## Project Structure

```
src/
  agent.js            — Agentic loop with tool use and streaming
  tools.js            — Tool definitions and implementations
  introspect.js       — Self-awareness (architecture, module, runtime introspection)
  llm.cjs             — OpenRouter LLM client
  braille.js          — Consolidated braille encoding/decoding
  braille-swarm.js    — Multi-model swarm via OpenRouter
  braille-websocket.js — Real-time braille WebSocket server
  braided-llm.js      — Multi-model response braiding
  braille-harness.js  — UEB Grade-2 contractions
  compaction.js       — Context window management
  world-model.js      — Persistent knowledge graph
  file-history.js     — File operation history with undo/redo
  file-tracker.js     — Git-based file change tracking
  core.js             — Runtime loop engine
  bbid.js             — Behavioral biometrics identity
  index.js            — Public API exports

desktop/
  ide.html            — IDE interface
  ide.js              — Monaco editor, file tree, chat, terminal, toasts
  ide.css             — IDE styling (incl. toast & file change animations)
  js/file-changes.js  — File change tracker UI module
  styles/file-changes.css — File change indicator styles

scripts/
  aria-server.mjs     — HTTP server (API + IDE frontend + file tracking)
  aria-cli.mjs        — CLI interface

src-tauri/
  src/main.rs         — Tauri app (auto-starts Aria server, health check)
  tauri.conf.json     — Tauri v2 configuration (devUrl: :3200)
  Cargo.toml          — Rust dependencies

ARCHITECTURE.json     — Machine-readable architecture manifest (Aria reads this)
bootstrap.sh          — One-command setup & launch
```

## Install Options

### Option A — One-liner (recommended)

```bash
git clone https://github.com/salus-ryan/ai-native-ide.git
cd ai-native-ide
OPENROUTER_API_KEY=sk-or-v1-YOUR_KEY_HERE ./bootstrap.sh
```

### Option B — Manual

```bash
git clone https://github.com/salus-ryan/ai-native-ide.git
cd ai-native-ide
npm install
echo "OPENROUTER_API_KEY=sk-or-v1-YOUR_KEY_HERE" > .env
npm run aria:server
# Open http://localhost:3200 in your browser
```

### Option C — Tauri desktop app

Requires Rust toolchain and Tauri CLI (`cargo install tauri-cli --version '^2.0.0'`).

```bash
npm run tauri:dev     # Development mode (auto-starts server)
npm run tauri:build   # Production bundle
```

### Option D — Mobile (same WiFi)

Run the one-liner on any machine, then open `http://<that-machine-ip>:3200` on your phone. The bootstrap script prints your LAN IP at startup.

## UI Feedback

When Aria creates, edits, or deletes files, you get clear visual feedback:

- **Toast notifications** — slide-in banners (green for create, blue for edit, red for delete). Click to open the file.
- **File tree highlights** — pulse animation on the affected file, auto-scrolls into view
- **Tab badges** — glowing blue dot on open tabs that Aria modified
- **Human-readable chat messages** — `✨ Created file: config.js` instead of raw JSON

## Introspection API

Aria exposes her self-awareness via both tools (for the agent) and HTTP endpoints (for the frontend):

| Endpoint | Description |
|----------|-------------|
| `GET /introspect` | Architecture manifest summary |
| `GET /introspect/module?name=agent.js` | Module metadata + full source |
| `GET /introspect/runtime` | Process info, memory, ports, environment |
| `GET /introspect/dependencies` | Full dependency graph |

The agent can also use these as tools: `introspect_architecture`, `introspect_module`, `introspect_runtime`, `introspect_dependencies`, `introspect_capabilities`.

## Testing

```bash
npm test   # 36 tests
```

Covers the core loop engine, desktop scaffold contracts, installer behavior, socket monitoring, MCP server, and documentation completeness.

## Why This Exists

The goal is to build an AI coding agent that is genuinely **native** to its own runtime — not a chat wrapper on an editor, but a system that understands its own construction and can reason about, modify, and repair itself.
