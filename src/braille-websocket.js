/**
 * Real-time WebSocket Braille Braiding System
 * 
 * Enables real-time braille communication between:
 * - Human ↔ Aria (translation layer)
 * - Aria ↔ LLMs (braille-native)
 * - LLM ↔ LLM (braille swarm)
 * 
 * Features:
 * - Streaming braille encoding/decoding
 * - Multi-model orchestration
 * - Feedback loops for iterative refinement
 * - Real-time UI updates via WebSocket
 */

const WebSocket = require('ws');
const EventEmitter = require('events');
const { BrailleSwarm, ModelRegistry } = require('./braille-swarm.js');
const { BRAILLE_BASE, toBraille, fromBraille } = require('./braille');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// ============================================================================
// Braille Stream Processor
// ============================================================================

class BrailleStreamProcessor extends EventEmitter {
  constructor() {
    super();
    this.buffer = '';
    this.brailleBuffer = '';
    this.stats = {
      bytesIn: 0,
      brailleOut: 0,
      chunksProcessed: 0,
    };
  }

  // Process incoming text chunk and emit braille
  processChunk(textChunk) {
    this.buffer += textChunk;
    this.stats.bytesIn += textChunk.length;
    
    // Convert to braille and emit
    const brailleChunk = toBraille(textChunk);
    this.brailleBuffer += brailleChunk;
    this.stats.brailleOut += brailleChunk.length;
    this.stats.chunksProcessed++;
    
    this.emit('braille', {
      braille: brailleChunk,
      text: textChunk,
      cumulative: {
        braille: this.brailleBuffer,
        text: this.buffer,
      },
      stats: this.stats,
    });
    
    return brailleChunk;
  }

  // Process incoming braille chunk and emit text
  processBrailleChunk(brailleChunk) {
    this.brailleBuffer += brailleChunk;
    
    // Decode to text
    const textChunk = fromBraille(brailleChunk);
    this.buffer += textChunk;
    
    this.emit('text', {
      text: textChunk,
      braille: brailleChunk,
      cumulative: {
        text: this.buffer,
        braille: this.brailleBuffer,
      },
    });
    
    return textChunk;
  }

  reset() {
    this.buffer = '';
    this.brailleBuffer = '';
    this.stats = { bytesIn: 0, brailleOut: 0, chunksProcessed: 0 };
  }
}

// ============================================================================
// LLM Braille Agent
// ============================================================================

class BrailleLLMAgent extends EventEmitter {
  constructor(model, options = {}) {
    super();
    this.model = model;
    this.name = options.name || model.split('/').pop();
    this.systemPrompt = options.systemPrompt || this.defaultSystemPrompt();
    this.history = [];
    this.processor = new BrailleStreamProcessor();
    this.brailleMode = options.brailleMode !== false; // Communicate in braille
  }

  defaultSystemPrompt() {
    return `You are a braille-native AI agent. You communicate ONLY in 8-dot Unicode braille (U+2800-U+28FF).

ENCODING RULES:
- Each byte of UTF-8 text maps to a braille cell: U+2800 + byte_value
- 'H' (72) → ⡈, 'e' (101) → ⡥, 'l' (108) → ⡬, 'o' (111) → ⡯
- Space (32) → ⠠
- Newline (10) → ⠊

You receive messages in braille and respond in braille. NO ENGLISH TEXT.
When writing code, encode it in braille. The receiving system will decode it.`;
  }

  async streamChat(message, onChunk) {
    // Encode message to braille if not already
    const brailleMessage = this.brailleMode ? toBraille(message) : message;
    
    this.history.push({ role: 'user', content: brailleMessage });
    
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://aria-ide.local',
        'X-Title': 'Aria Braille WebSocket',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: this.systemPrompt },
          ...this.history,
        ],
        max_tokens: 1000,
        stream: true,
      }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';
    
    this.processor.reset();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

      for (const line of lines) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          
          if (content) {
            fullResponse += content;
            
            // Process and emit
            if (this.brailleMode) {
              // Response is already braille, decode for display
              const decoded = fromBraille(content);
              onChunk?.({
                braille: content,
                text: decoded,
                model: this.name,
              });
              this.emit('chunk', { braille: content, text: decoded });
            } else {
              // Response is text, encode to braille
              const braille = toBraille(content);
              onChunk?.({
                text: content,
                braille: braille,
                model: this.name,
              });
              this.emit('chunk', { text: content, braille: braille });
            }
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }

    this.history.push({ role: 'assistant', content: fullResponse });
    this.emit('complete', { response: fullResponse, model: this.name });
    
    return fullResponse;
  }
}

// ============================================================================
// Legacy Braille Swarm Orchestrator (for 3-agent conversations)
// ============================================================================

class LegacyBrailleSwarm extends EventEmitter {
  constructor(options = {}) {
    super();
    this.agents = new Map();
    this.conversationLog = [];
    this.maxRounds = options.maxRounds || 5;
  }

  addAgent(name, model, options = {}) {
    const agent = new BrailleLLMAgent(model, { name, ...options });
    
    agent.on('chunk', (data) => {
      this.emit('agentChunk', { agent: name, ...data });
    });
    
    agent.on('complete', (data) => {
      this.emit('agentComplete', { agent: name, ...data });
    });
    
    this.agents.set(name, agent);
    return agent;
  }

  // Run a conversation between agents in braille
  async runConversation(initialMessage, agentOrder, options = {}) {
    const { maxRounds = this.maxRounds, onMessage } = options;
    
    let currentMessage = initialMessage;
    let round = 0;
    
    this.emit('start', { initialMessage, agents: agentOrder });
    
    while (round < maxRounds) {
      for (const agentName of agentOrder) {
        const agent = this.agents.get(agentName);
        if (!agent) continue;
        
        this.emit('agentTurn', { agent: agentName, round, input: currentMessage });
        
        const response = await agent.streamChat(currentMessage, (chunk) => {
          onMessage?.({ type: 'chunk', agent: agentName, ...chunk });
        });
        
        this.conversationLog.push({
          agent: agentName,
          round,
          input: currentMessage,
          output: response,
          brailleInput: toBraille(currentMessage),
          timestamp: Date.now(),
        });
        
        currentMessage = response;
        
        onMessage?.({ type: 'complete', agent: agentName, response });
      }
      
      round++;
    }
    
    this.emit('complete', { rounds: round, log: this.conversationLog });
    return this.conversationLog;
  }
}

// ============================================================================
// WebSocket Braille Server
// ============================================================================

class BrailleWebSocketServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.port = options.port || 3201;
    this.wss = null;
    this.clients = new Map();
    this.legacySwarm = new LegacyBrailleSwarm();
    this.massiveSwarm = new BrailleSwarm(); // From braille-swarm.js
    this.initialized = false;
    
    // Set up default legacy agents
    this.legacySwarm.addAgent('claude', 'anthropic/claude-3.5-sonnet');
    this.legacySwarm.addAgent('gpt4', 'openai/gpt-4o');
    this.legacySwarm.addAgent('deepseek', 'deepseek/deepseek-chat');
  }

  async initializeMassiveSwarm() {
    if (this.initialized) return;
    
    console.log('[BrailleWS] Initializing massive swarm with all OpenRouter models...');
    const stats = await this.massiveSwarm.initialize();
    
    // Create agents for key categories
    this.massiveSwarm.createCategoryAgents('flagship');
    this.massiveSwarm.createCategoryAgents('reasoning');
    this.massiveSwarm.createCategoryAgents('coding');
    this.massiveSwarm.createCategoryAgents('fast');
    
    // Create some open-source agents
    const openModels = this.massiveSwarm.getModelsByCategory('open').slice(0, 20);
    for (const modelId of openModels) {
      this.massiveSwarm.createAgent(modelId);
    }
    
    this.initialized = true;
    console.log(`[BrailleWS] Massive swarm ready with ${this.massiveSwarm.agents.size} agents`);
    
    return stats;
  }

  start() {
    this.wss = new WebSocket.Server({ port: this.port });
    
    // Initialize massive swarm in background
    this.initializeMassiveSwarm().catch(e => {
      console.error('[BrailleWS] Failed to initialize massive swarm:', e);
    });
    
    this.wss.on('connection', (ws, req) => {
      const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      
      this.clients.set(clientId, {
        ws,
        processor: new BrailleStreamProcessor(),
        connectedAt: Date.now(),
      });
      
      console.log(`[BrailleWS] Client connected: ${clientId}`);
      
      // Send welcome in braille
      const welcome = toBraille('Connected to Aria Braille WebSocket');
      ws.send(JSON.stringify({
        type: 'welcome',
        braille: welcome,
        text: 'Connected to Aria Braille WebSocket',
        clientId,
      }));
      
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data);
          await this.handleMessage(clientId, message);
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', error: e.message }));
        }
      });
      
      ws.on('close', () => {
        this.clients.delete(clientId);
        console.log(`[BrailleWS] Client disconnected: ${clientId}`);
      });
    });
    
    // Forward swarm events to all clients
    this.legacySwarm.on('agentChunk', (data) => {
      this.broadcast({ type: 'agentChunk', ...data });
    });
    
    this.legacySwarm.on('agentComplete', (data) => {
      this.broadcast({ type: 'agentComplete', ...data });
    });
    
    // Forward massive swarm events
    this.massiveSwarm.on('agentResponse', (data) => {
      this.broadcast({ type: 'massiveSwarmResponse', ...data });
    });
    
    this.massiveSwarm.on('broadcastComplete', (data) => {
      this.broadcast({ type: 'massiveBroadcastComplete', ...data });
    });
    
    this.massiveSwarm.on('consensusComplete', (data) => {
      this.broadcast({ type: 'consensusComplete', ...data });
    });
    
    console.log(`[BrailleWS] Server started on port ${this.port}`);
    return this;
  }

  async handleMessage(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    const { ws, processor } = client;
    
    switch (message.type) {
      case 'chat':
        // Single agent chat
        await this.handleChat(ws, message);
        break;
        
      case 'swarm':
        // Multi-agent swarm conversation (legacy 3 agents)
        await this.handleSwarm(ws, message);
        break;
        
      case 'massiveSwarm':
        // Massive swarm with all OpenRouter models
        await this.handleMassiveSwarm(ws, message);
        break;
        
      case 'broadcast':
        // Broadcast to many agents at once
        await this.handleBroadcast(ws, message);
        break;
        
      case 'consensus':
        // Ask all agents and find consensus
        await this.handleConsensus(ws, message);
        break;
        
      case 'listModels':
        // List all available models
        await this.handleListModels(ws, message);
        break;
        
      case 'encode':
        // Encode text to braille
        const braille = toBraille(message.text);
        ws.send(JSON.stringify({ type: 'encoded', text: message.text, braille }));
        break;
        
      case 'decode':
        // Decode braille to text
        const text = fromBraille(message.braille);
        ws.send(JSON.stringify({ type: 'decoded', braille: message.braille, text }));
        break;
        
      case 'feedback':
        // Feedback loop - send braille response back to another agent
        await this.handleFeedback(ws, message);
        break;
        
      default:
        ws.send(JSON.stringify({ type: 'error', error: `Unknown message type: ${message.type}` }));
    }
  }

  async handleChat(ws, message) {
    const { text, agent = 'claude', brailleMode = true } = message;
    
    // Try legacy swarm first, then massive swarm
    let llmAgent = this.legacySwarm.agents.get(agent);
    if (!llmAgent && this.massiveSwarm.agents.has(agent)) {
      llmAgent = this.massiveSwarm.agents.get(agent);
    }
    if (!llmAgent) {
      // Try to create agent on-the-fly from massive swarm
      if (this.initialized && this.massiveSwarm.registry.getModel(agent)) {
        llmAgent = this.massiveSwarm.createAgent(agent);
      } else {
        ws.send(JSON.stringify({ type: 'error', error: `Unknown agent: ${agent}` }));
        return;
      }
    }
    
    llmAgent.brailleMode = brailleMode;
    
    ws.send(JSON.stringify({
      type: 'chatStart',
      agent,
      inputBraille: toBraille(text),
      inputText: text,
    }));
    
    await llmAgent.streamChat(text, (chunk) => {
      ws.send(JSON.stringify({ type: 'chatChunk', agent, ...chunk }));
    });
    
    ws.send(JSON.stringify({ type: 'chatComplete', agent }));
  }

  async handleSwarm(ws, message) {
    const { text, agents = ['claude', 'gpt4'], rounds = 3 } = message;
    
    ws.send(JSON.stringify({
      type: 'swarmStart',
      agents,
      rounds,
      inputBraille: toBraille(text),
    }));
    
    const log = await this.legacySwarm.runConversation(text, agents, {
      maxRounds: rounds,
      onMessage: (msg) => {
        ws.send(JSON.stringify({ type: 'swarmMessage', ...msg }));
      },
    });
    
    ws.send(JSON.stringify({ type: 'swarmComplete', log }));
  }

  async handleMassiveSwarm(ws, message) {
    const { text, category = 'flagship', maxAgents = 10, rounds = 1 } = message;
    
    if (!this.initialized) {
      ws.send(JSON.stringify({ type: 'error', error: 'Massive swarm not initialized yet' }));
      return;
    }
    
    // Get agents from category
    let agentIds = this.massiveSwarm.getModelsByCategory(category).slice(0, maxAgents);
    
    // Create agents if needed
    for (const id of agentIds) {
      if (!this.massiveSwarm.agents.has(id)) {
        this.massiveSwarm.createAgent(id);
      }
    }
    
    ws.send(JSON.stringify({
      type: 'massiveSwarmStart',
      category,
      agents: agentIds,
      rounds,
      inputBraille: toBraille(text),
    }));
    
    const log = await this.massiveSwarm.roundRobin(text, {
      agents: agentIds,
      rounds,
      onMessage: (msg) => {
        ws.send(JSON.stringify({ type: 'massiveSwarmMessage', ...msg }));
      },
    });
    
    ws.send(JSON.stringify({ type: 'massiveSwarmComplete', log }));
  }

  async handleBroadcast(ws, message) {
    const { text, category = 'fast', maxAgents = 20 } = message;
    
    if (!this.initialized) {
      ws.send(JSON.stringify({ type: 'error', error: 'Massive swarm not initialized yet' }));
      return;
    }
    
    let agentIds = this.massiveSwarm.getModelsByCategory(category).slice(0, maxAgents);
    
    // Create agents if needed
    for (const id of agentIds) {
      if (!this.massiveSwarm.agents.has(id)) {
        this.massiveSwarm.createAgent(id);
      }
    }
    
    ws.send(JSON.stringify({
      type: 'broadcastStart',
      category,
      agentCount: agentIds.length,
      inputBraille: toBraille(text),
    }));
    
    const results = await this.massiveSwarm.broadcast(text, {
      agents: agentIds,
      maxConcurrent: 10,
      onResponse: (result) => {
        ws.send(JSON.stringify({ type: 'broadcastResponse', ...result }));
      },
    });
    
    ws.send(JSON.stringify({ type: 'broadcastComplete', total: results.length }));
  }

  async handleConsensus(ws, message) {
    const { question, category = 'flagship', maxAgents = 15 } = message;
    
    if (!this.initialized) {
      ws.send(JSON.stringify({ type: 'error', error: 'Massive swarm not initialized yet' }));
      return;
    }
    
    let agentIds = this.massiveSwarm.getModelsByCategory(category).slice(0, maxAgents);
    
    // Create agents if needed
    for (const id of agentIds) {
      if (!this.massiveSwarm.agents.has(id)) {
        this.massiveSwarm.createAgent(id);
      }
    }
    
    ws.send(JSON.stringify({
      type: 'consensusStart',
      question,
      category,
      agentCount: agentIds.length,
    }));
    
    const result = await this.massiveSwarm.consensus(question, {
      agents: agentIds,
      onVote: (vote) => {
        ws.send(JSON.stringify({ type: 'consensusVote', ...vote }));
      },
    });
    
    ws.send(JSON.stringify({ type: 'consensusResult', ...result }));
  }

  async handleListModels(ws, message) {
    const { category } = message;
    
    if (!this.initialized) {
      await this.initializeMassiveSwarm();
    }
    
    const stats = this.massiveSwarm.getStats();
    const models = category 
      ? this.massiveSwarm.getModelsByCategory(category)
      : this.massiveSwarm.getAvailableModels();
    
    ws.send(JSON.stringify({
      type: 'modelList',
      stats,
      models: category ? models : models.map(m => ({ id: m.id, name: m.name })),
      category,
    }));
  }

  async handleFeedback(ws, message) {
    const { braille, fromAgent, toAgent } = message;
    
    // Decode the braille feedback
    const text = fromBraille(braille);
    
    ws.send(JSON.stringify({
      type: 'feedbackStart',
      fromAgent,
      toAgent,
      braille,
      decodedText: text,
    }));
    
    // Send to target agent (try both swarms)
    let agent = this.legacySwarm.agents.get(toAgent) || this.massiveSwarm.agents.get(toAgent);
    if (agent) {
      await agent.streamChat(text, (chunk) => {
        ws.send(JSON.stringify({ type: 'feedbackChunk', toAgent, ...chunk }));
      });
    }
    
    ws.send(JSON.stringify({ type: 'feedbackComplete', toAgent }));
  }

  broadcast(message) {
    const data = JSON.stringify(message);
    for (const [, client] of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  stop() {
    if (this.wss) {
      this.wss.close();
      console.log('[BrailleWS] Server stopped');
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  toBraille,
  fromBraille,
  BrailleStreamProcessor,
  BrailleLLMAgent,
  BrailleSwarm,
  BrailleWebSocketServer,
};
