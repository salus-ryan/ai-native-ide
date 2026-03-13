# Aria IDE — The Self-Aware AI Coding Agent

**Aria** is an AI-native IDE where the agent is aware of her own architecture, can introspect her own source code, and operates as a runtime-native system — not just a chatbot bolted onto an editor.

## What makes this different

Unlike Cursor, Windsurf, or other AI IDEs that wrap a chat interface around an editor, Aria is **architecture-aware from the ground up**:

- **Self-introspection** — Aria can read her own module graph, source code, and runtime state via built-in tools
- **Multi-model braiding** — queries all available LLMs in parallel via a braille-encoded swarm, braids their responses
- **Runtime loop engine** — plan → execute → observe → evaluate → repair cycle, not just chat
- **Persistent world model** — knowledge graph that survives across conversations
- **Context compaction** — automatic context window management using UEB braille compression
- **Tauri desktop app** — native window with managed Node.js backend, not just a web page

## Quick Start

```bash
git clone https://github.com/elevate-foundry/ai-native-ide.git
cd ai-native-ide
./bootstrap.sh
```

The bootstrap script installs dependencies, sets up your OpenRouter API key, and starts everything.

| Service | URL |
|---------|-----|
| **IDE** | http://localhost:4173 |
| **API** | http://localhost:3200 |
| **WebSocket** | ws://localhost:3201 |
| **CLI** | `npm run aria` |

To stop: `./stop.sh`

## Architecture

Aria has a machine-readable architecture manifest at `ARCHITECTURE.json` that she can read herself. The system is organized in layers:

```
┌─────────────────────────────────────────────────────┐
│  Desktop Shell (Tauri v2)                           │
│  src-tauri/src/main.rs — spawns & manages Node.js   │
│  desktop/ide.html + ide.js — Monaco-based IDE UI    │
├─────────────────────────────────────────────────────┤
│  Server (Node.js)                                   │
│  scripts/aria-server.mjs — HTTP + SSE streaming     │
│  Port 3200 (API) + 3201 (WebSocket)                 │
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
  core.js             — Runtime loop engine
  bbid.js             — Behavioral biometrics identity
  index.js            — Public API exports

desktop/
  ide.html            — IDE interface
  ide.js              — Monaco editor, file tree, chat, terminal
  ide.css             — IDE styling

scripts/
  aria-server.mjs     — HTTP/WebSocket server (the agent's brain)
  aria-cli.mjs        — CLI interface
  serve-desktop.mjs   — Static dev server for the frontend
  start-aria.sh       — Full startup script
  install.sh          — One-line installer

src-tauri/
  src/main.rs         — Tauri commands (server lifecycle, health, introspection)
  tauri.conf.json     — Tauri v2 configuration
  Cargo.toml          — Rust dependencies

ARCHITECTURE.json     — Machine-readable architecture manifest (Aria reads this)
```

## Install Options

### Option A — bootstrap (recommended)

```bash
git clone https://github.com/elevate-foundry/ai-native-ide.git
cd ai-native-ide
./bootstrap.sh
```

### Option B — manual

```bash
git clone https://github.com/elevate-foundry/ai-native-ide.git
cd ai-native-ide
npm install
npm run aria:server   # Start the backend
npm run ide           # Start the frontend (separate terminal)
```

### Option C — Tauri desktop app

Requires Rust toolchain and Tauri CLI (`cargo install tauri-cli --version '^2.0.0'`).

```bash
npm run tauri:dev     # Development mode
npm run tauri:build   # Production bundles
```

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
npm test
```

The test suite covers the core loop engine, desktop scaffold contracts, installer behavior, socket monitoring, MCP server, and documentation completeness.

## Why This Exists

The goal is to build an AI coding agent that is genuinely **native** to its own runtime — not a chat wrapper on an editor, but a system that understands its own construction and can reason about, modify, and repair itself.
