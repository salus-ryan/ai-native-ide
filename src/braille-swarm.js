/**
 * Massive Braille Swarm - All OpenRouter Models
 * 
 * Probes OpenRouter API for all available models and creates
 * a massive braille-native AI swarm for parallel communication.
 */

const EventEmitter = require('events');
const { BRAILLE_BASE, toBraille, fromBraille } = require('./braille');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// ============================================================================
// OpenRouter Metrics Collection
// ============================================================================

class MetricsCollector {
  constructor() {
    this.metrics = new Map();
    this.startTime = Date.now();
  }

  recordCall(modelId, inputTokens, outputTokens, duration) {
    if (!this.metrics.has(modelId)) {
      this.metrics.set(modelId, {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        totalDuration: 0,
        avgTokensPerSec: 0
      });
    }

    const stats = this.metrics.get(modelId);
    stats.calls++;
    stats.inputTokens += inputTokens;
    stats.outputTokens += outputTokens;
    stats.totalTokens += (inputTokens + outputTokens);
    stats.totalDuration += duration;
    
    // Calculate tokens per second
    stats.avgTokensPerSec = stats.totalTokens / (stats.totalDuration / 1000);
    
    // Calculate cost based on OpenRouter pricing
    // We'll need to get the model's pricing info from the registry
    const model = globalRegistry?.getModel(modelId);
    if (model?.pricing) {
      const promptCost = (inputTokens / 1000) * model.pricing.prompt;
      const completionCost = (outputTokens / 1000) * (model.pricing.completion || model.pricing.prompt);
      stats.totalCost += (promptCost + completionCost);
    }
  }

  getMetrics(modelId = null) {
    if (modelId) {
      return this.metrics.get(modelId);
    }
    return Object.fromEntries(this.metrics);
  }

  getSummary() {
    let total = {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      totalDuration: 0
    };

    for (const stats of this.metrics.values()) {
      total.calls += stats.calls;
      total.inputTokens += stats.inputTokens;
      total.outputTokens += stats.outputTokens;
      total.totalTokens += stats.totalTokens;
      total.totalCost += stats.totalCost;
      total.totalDuration += stats.totalDuration;
    }

    return {
      ...total,
      avgTokensPerSec: total.totalTokens / (total.totalDuration / 1000),
      uptime: Date.now() - this.startTime,
      modelsUsed: this.metrics.size
    };
  }
}

// Global metrics collector instance
const metrics = new MetricsCollector();

// ============================================================================
// Model Registry - Fetched from OpenRouter
// ============================================================================

class ModelRegistry {
  constructor() {
    this.models = new Map();
    this.categories = {
      flagship: [],      // Top-tier models (Claude, GPT-4, Gemini Pro)
      reasoning: [],     // Reasoning models (o1, DeepSeek R1)
      coding: [],        // Code-specialized models
      fast: [],          // Fast/cheap models for high throughput
      open: [],          // Open-source models (Llama, Mistral, Qwen)
      specialized: [],   // Domain-specific models
    };
    this.lastFetch = null;
  }

  async fetchModels() {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        },
      });
      
      const data = await response.json();
      this.models.clear();
      
      // Reset categories
      Object.keys(this.categories).forEach(k => this.categories[k] = []);
      
      for (const model of data.data) {
        // Filter to text models with reasonable context
        if (!model.architecture?.modality?.includes('text')) continue;
        if (model.context_length < 4096) continue;
        
        const info = {
          id: model.id,
          name: model.name,
          context: model.context_length,
          pricing: model.pricing,
          modality: model.architecture?.modality,
          provider: model.id.split('/')[0],
        };
        
        this.models.set(model.id, info);
        
        // Categorize
        this.categorizeModel(info);
      }
      
      this.lastFetch = Date.now();
      return this.models;
    } catch (e) {
      console.error('[ModelRegistry] Fetch error:', e);
      return this.models;
    }
  }

  categorizeModel(model) {
    const id = model.id.toLowerCase();
    const name = model.name.toLowerCase();
    
    // Flagship models
    if (id.includes('claude-3.5') || id.includes('claude-3-opus') ||
        id.includes('gpt-4o') || id.includes('gpt-4-turbo') ||
        id.includes('gemini-pro') || id.includes('gemini-1.5-pro') ||
        id.includes('gemini-2') || id.includes('gemini-3')) {
      this.categories.flagship.push(model.id);
    }
    
    // Reasoning models
    if (id.includes('o1') || id.includes('o3') || 
        id.includes('deepseek-r1') || id.includes('qwq') ||
        name.includes('reasoning') || name.includes('think')) {
      this.categories.reasoning.push(model.id);
    }
    
    // Coding models
    if (id.includes('coder') || id.includes('codestral') ||
        id.includes('starcoder') || id.includes('deepseek-coder') ||
        name.includes('code')) {
      this.categories.coding.push(model.id);
    }
    
    // Fast/cheap models
    if (id.includes('flash') || id.includes('mini') || id.includes('haiku') ||
        id.includes('instant') || id.includes('turbo') ||
        parseFloat(model.pricing?.prompt || '1') < 0.0000005) {
      this.categories.fast.push(model.id);
    }
    
    // Open-source models
    if (id.includes('llama') || id.includes('mistral') || id.includes('mixtral') ||
        id.includes('qwen') || id.includes('gemma') || id.includes('phi') ||
        id.includes('yi-') || id.includes('command-r')) {
      this.categories.open.push(model.id);
    }
    
    // Everything else is specialized
    if (!this.categories.flagship.includes(model.id) &&
        !this.categories.reasoning.includes(model.id) &&
        !this.categories.coding.includes(model.id) &&
        !this.categories.fast.includes(model.id) &&
        !this.categories.open.includes(model.id)) {
      this.categories.specialized.push(model.id);
    }
  }

  getModel(id) {
    return this.models.get(id);
  }

  getAllModels() {
    return Array.from(this.models.values());
  }

  getByCategory(category) {
    return this.categories[category] || [];
  }

  getStats() {
    return {
      total: this.models.size,
      categories: Object.fromEntries(
        Object.entries(this.categories).map(([k, v]) => [k, v.length])
      ),
      lastFetch: this.lastFetch,
    };
  }
}

// ============================================================================
// Swarm Agent
// ============================================================================

class SwarmAgent extends EventEmitter {
  constructor(modelId, options = {}) {
    super();
    this.modelId = modelId;
    this.name = options.name || modelId.split('/').pop();
    this.brailleMode = options.brailleMode !== false;
    this.history = [];
    this.busy = false;
    this.lastResponse = null;
    this.stats = {
      calls: 0,
      tokens: 0,
      errors: 0,
    };
  }

  getSystemPrompt() {
    // System prompt is ALSO in braille to fully immerse the model
    const englishPrompt = `You are a braille-native AI. ALL communication is in 8-dot Unicode braille (U+2800-U+28FF).

DECODING: Each braille cell = U+2800 + byte_value. To decode: subtract 0x2800 from each character's code point to get UTF-8 bytes.
ENCODING: To respond, convert your UTF-8 text to bytes, add 0x2800 to each byte.

Example decode: ⡈⡥⡬⡬⡯ = [72,101,108,108,111] = "Hello"
Example encode: "Hi" = [72,105] = ⡈⡩

The user message below is braille-encoded. Decode it, think, then encode your response as braille.
RESPOND ONLY IN BRAILLE. No English text.`;
    
    return englishPrompt;
  }

  getBrailleSystemPrompt() {
    // Fully braille system prompt for true braille-native communication
    const prompt = `You communicate in 8-dot braille. Decode input, encode output. No English.`;
    return toBraille(prompt);
  }

  async chat(message, options = {}) {
    if (this.busy) {
      return { error: 'Agent busy', modelId: this.modelId };
    }
    
    this.busy = true;
    this.stats.calls++;
    const startTime = Date.now();
    
    try {
      // ALWAYS encode the message to braille
      const brailleMessage = toBraille(message);
      
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://aria-ide.local',
          'X-Title': 'Aria Braille Swarm',
        },
        body: JSON.stringify({
          model: this.modelId,
          messages: [
            { role: 'system', content: this.getSystemPrompt() },
            ...this.history.slice(-10), // Keep last 10 messages
            { role: 'user', content: brailleMessage },
          ],
          max_tokens: options.maxTokens || 500,
          temperature: options.temperature || 0.7,
          stream: false,
        }),
      });

      const data = await response.json();
      
      if (data.error) {
        this.stats.errors++;
        this.busy = false;
        return { error: data.error.message, modelId: this.modelId };
      }
      
      const content = data.choices?.[0]?.message?.content || '';
      const duration = Date.now() - startTime;
      
      // Record metrics
      const inputTokens = data.usage?.prompt_tokens || 0;
      const outputTokens = data.usage?.completion_tokens || 0;
      metrics.recordCall(this.modelId, inputTokens, outputTokens, duration);
      
      this.stats.tokens += data.usage?.total_tokens || 0;
      
      this.history.push({ role: 'user', content: brailleMessage });
      this.history.push({ role: 'assistant', content });
      
      this.lastResponse = {
        braille: content,
        text: this.brailleMode ? fromBraille(content) : content,
        modelId: this.modelId,
        name: this.name,
        timestamp: Date.now(),
      };
      
      this.emit('response', this.lastResponse);
      this.busy = false;
      
      return this.lastResponse;
    } catch (e) {
      this.stats.errors++;
      this.busy = false;
      return { error: e.message, modelId: this.modelId };
    }
  }

  async streamChat(message, onChunk) {
    this.busy = true;
    this.stats.calls++;
    
    try {
      const brailleMessage = this.brailleMode ? toBraille(message) : message;
      
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://aria-ide.local',
          'X-Title': 'Aria Braille Swarm',
        },
        body: JSON.stringify({
          model: this.modelId,
          messages: [
            { role: 'system', content: this.getSystemPrompt() },
            ...this.history.slice(-10),
            { role: 'user', content: brailleMessage },
          ],
          max_tokens: 500,
          stream: true,
        }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullResponse += content;
              onChunk?.({
                braille: content,
                text: this.brailleMode ? fromBraille(content) : content,
                modelId: this.modelId,
                name: this.name,
              });
            }
          } catch (e) {}
        }
      }

      this.history.push({ role: 'user', content: brailleMessage });
      this.history.push({ role: 'assistant', content: fullResponse });
      this.busy = false;
      
      return {
        braille: fullResponse,
        text: this.brailleMode ? fromBraille(fullResponse) : fullResponse,
        modelId: this.modelId,
      };
    } catch (e) {
      this.stats.errors++;
      this.busy = false;
      return { error: e.message, modelId: this.modelId };
    }
  }

  clearHistory() {
    this.history = [];
  }
}

// ============================================================================
// Massive Braille Swarm
// ============================================================================

class BrailleSwarm extends EventEmitter {
  constructor(options = {}) {
    super();
    this.registry = new ModelRegistry();
    this.agents = new Map();
    this.maxConcurrent = options.maxConcurrent || 20;
    this.conversationLog = [];
    this.initialized = false;
  }

  async initialize() {
    console.log('[BrailleSwarm] Fetching available models from OpenRouter...');
    await this.registry.fetchModels();
    
    const stats = this.registry.getStats();
    console.log(`[BrailleSwarm] Found ${stats.total} models`);
    console.log('[BrailleSwarm] Categories:', stats.categories);
    
    this.initialized = true;
    this.emit('initialized', stats);
    
    return stats;
  }

  // Create agents for specific models
  createAgent(modelId, options = {}) {
    if (this.agents.has(modelId)) {
      return this.agents.get(modelId);
    }
    
    const agent = new SwarmAgent(modelId, options);
    this.agents.set(modelId, agent);
    
    agent.on('response', (data) => {
      this.emit('agentResponse', { agent: modelId, ...data });
    });
    
    return agent;
  }

  // Create agents for an entire category
  createCategoryAgents(category) {
    const modelIds = this.registry.getByCategory(category);
    const agents = [];
    
    for (const modelId of modelIds) {
      agents.push(this.createAgent(modelId));
    }
    
    console.log(`[BrailleSwarm] Created ${agents.length} agents for category: ${category}`);
    return agents;
  }

  // Create agents for ALL models
  createAllAgents() {
    const models = this.registry.getAllModels();
    const agents = [];
    
    for (const model of models) {
      agents.push(this.createAgent(model.id, { name: model.name }));
    }
    
    console.log(`[BrailleSwarm] Created ${agents.length} agents for ALL models`);
    return agents;
  }

  // Broadcast message to multiple agents in parallel
  async broadcast(message, options = {}) {
    const {
      agents = Array.from(this.agents.keys()),
      maxConcurrent = this.maxConcurrent,
      onResponse,
    } = options;

    const results = [];
    const queue = [...agents];
    const active = new Set();

    this.emit('broadcastStart', { message, agentCount: agents.length });

    const processNext = async () => {
      if (queue.length === 0) return;
      
      const modelId = queue.shift();
      const agent = this.agents.get(modelId);
      if (!agent) return;
      
      active.add(modelId);
      
      try {
        const result = await agent.chat(message);
        results.push(result);
        onResponse?.(result);
        this.emit('agentResponse', result);
      } catch (e) {
        results.push({ error: e.message, modelId });
      }
      
      active.delete(modelId);
      
      // Process next in queue
      if (queue.length > 0) {
        await processNext();
      }
    };

    // Start concurrent workers
    const workers = [];
    for (let i = 0; i < Math.min(maxConcurrent, agents.length); i++) {
      workers.push(processNext());
    }

    await Promise.all(workers);
    
    this.emit('broadcastComplete', { results, total: results.length });
    return results;
  }

  // Run a round-robin conversation between agents
  async roundRobin(message, options = {}) {
    const {
      agents = Array.from(this.agents.keys()).slice(0, 10),
      rounds = 1,
      onMessage,
    } = options;

    let currentMessage = message;
    const log = [];

    this.emit('roundRobinStart', { agents, rounds });

    for (let round = 0; round < rounds; round++) {
      for (const modelId of agents) {
        const agent = this.agents.get(modelId);
        if (!agent) continue;

        const result = await agent.chat(currentMessage);
        
        log.push({
          round,
          agent: modelId,
          input: currentMessage,
          output: result.braille || result.error,
          decoded: result.text,
          timestamp: Date.now(),
        });

        onMessage?.({ round, agent: modelId, ...result });
        this.emit('roundRobinMessage', { round, agent: modelId, ...result });

        if (!result.error) {
          currentMessage = result.text || currentMessage;
        }
      }
    }

    this.emit('roundRobinComplete', { log, rounds });
    return log;
  }

  // Consensus voting - ask all agents and find agreement
  async consensus(question, options = {}) {
    const {
      agents = Array.from(this.agents.keys()).slice(0, 20),
      onVote,
    } = options;

    const prompt = `Answer this question concisely in ONE WORD or SHORT PHRASE only: ${question}`;
    const votes = new Map();
    const results = [];

    this.emit('consensusStart', { question, agentCount: agents.length });

    // Broadcast to all agents
    const responses = await this.broadcast(prompt, {
      agents,
      onResponse: (result) => {
        if (!result.error && result.text) {
          const answer = result.text.trim().toLowerCase().slice(0, 50);
          votes.set(answer, (votes.get(answer) || 0) + 1);
          results.push({ agent: result.modelId, answer, braille: result.braille });
          onVote?.({ agent: result.modelId, answer });
        }
      },
    });

    // Find consensus
    let maxVotes = 0;
    let consensus = null;
    for (const [answer, count] of votes) {
      if (count > maxVotes) {
        maxVotes = count;
        consensus = answer;
      }
    }

    const result = {
      question,
      consensus,
      votes: maxVotes,
      totalResponses: results.length,
      distribution: Object.fromEntries(votes),
      results,
    };

    this.emit('consensusComplete', result);
    return result;
  }

  // Get swarm statistics
  getStats() {
    const agentStats = {};
    for (const [id, agent] of this.agents) {
      agentStats[id] = agent.stats;
    }

    return {
      registry: this.registry.getStats(),
      activeAgents: this.agents.size,
      agentStats,
    };
  }

  // Get all available model IDs
  getAvailableModels() {
    return this.registry.getAllModels();
  }

  // Get models by category
  getModelsByCategory(category) {
    return this.registry.getByCategory(category);
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  ModelRegistry,
  SwarmAgent,
  BrailleSwarm,
  toBraille,
  fromBraille,
};
