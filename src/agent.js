/**
 * Aria Agent - Agentic loop with tool use and streaming
 * 
 * This is the core of Aria's intelligence - a multi-turn agent that can
 * use tools, reason about results, and stream responses.
 */

const { TOOL_DEFINITIONS, AriaTools } = require('./tools');
const { createLLMClient, ARIA_SYSTEM_PROMPT } = require('./llm.cjs');
const { ContextManager, estimateHistoryTokens } = require('./compaction');
const { ConversationStore } = require('./conversation-store');

const ARIA_AGENT_PROMPT = `${ARIA_SYSTEM_PROMPT}

## Tools Available
You have access to tools for file operations, command execution, and browser automation.
When you need to take an action, use the appropriate tool. Always explain what you're doing.

## Response Style
- Be conversational and helpful, like a pair programmer
- Explain your reasoning as you work
- Show progress as you go
- Ask clarifying questions if the request is ambiguous
- When you complete a task, summarize what you did

## Important
- Use tools to gather information before making assumptions
- Read files before editing them
- Test changes when possible
- If something fails, explain why and try an alternative approach`;

class AriaAgent {
  constructor(options = {}) {
    this.llm = options.llmClient || createLLMClient(options.llmConfig);
    this.tools = new AriaTools({ workingDirectory: options.workingDirectory });
    this.conversationHistory = [];
    this.maxIterations = options.maxIterations || 10;
    this.onChunk = options.onChunk || (() => {});
    this.onToolCall = options.onToolCall || (() => {});
    this.onToolResult = options.onToolResult || (() => {});
    this.onCompaction = options.onCompaction || (() => {});
    
    // Unique conversation ID 
    this.conversationId = options.conversationId || 
      `conv_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    
    // Persistent conversation store with braille compaction
    this.store = new ConversationStore({
      storageDir: options.storageDir,
      maxSize: options.maxConversationSize || 1000000,
      compactionThreshold: options.compactionThreshold || 0.7
    });
    
    // Context compaction
    this.contextManager = new ContextManager({
      maxTokens: options.maxTokens || 100000,
      slidingWindowSize: options.slidingWindowSize || 10,
      summaryTrigger: options.summaryTrigger || 50000,
      llmClient: this.llm,
      autoCompact: options.autoCompact !== false,
    });

    // Initialize store and load existing conversation if available
    this.initialized = false;
  }

  async maybeCompact() {
    if (this.contextManager.needsCompaction(this.conversationHistory)) {
      const result = await this.contextManager.compact(this.conversationHistory);
      if (result.compacted) {
        this.conversationHistory = result.history;
        // Persist compacted history
        await this.store.saveConversation(this.conversationId, this.conversationHistory);
        
        this.onCompaction({
          tokensBefore: result.tokensBefore,
          tokensAfter: result.tokensAfter,
          reduction: result.reduction,
        });
      }
    }
  }

  getContextStats() {
    return {
      messageCount: this.conversationHistory.length,
      estimatedTokens: estimateHistoryTokens(this.conversationHistory),
      needsCompaction: this.contextManager.needsCompaction(this.conversationHistory),
    };
  }

  async initialize() {
    if (this.initialized) return;
    
    // Initialize conversation store
    await this.store.initialize();
    
    // Load existing conversation if available
    const history = await this.store.getConversation(this.conversationId);
    if (history) {
      this.conversationHistory = history;
      await this.maybeCompact(); // Compact if needed
    }
    
    this.initialized = true;
  }

  async chat(userMessage) {
    // Ensure initialized
    if (!this.initialized) {
      await this.initialize();
    }
    // Add user message to history
    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
    });

    let iterations = 0;
    let finalResponse = '';

    while (iterations < this.maxIterations) {
      iterations++;

      // Call LLM with tools
      const response = await this.callLLMWithTools();

      // Check if we got tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        // First, add the assistant message with tool_calls
        this.conversationHistory.push({
          role: 'assistant',
          content: response.content || null,
          tool_calls: response.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        });

        // Execute tools and add results to history
        for (const toolCall of response.toolCalls) {
          this.onToolCall(toolCall);
          
          const result = await this.tools.execute(toolCall.name, toolCall.arguments);
          
          this.onToolResult(toolCall.name, result);

          // Add tool result to history
          this.conversationHistory.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolCall.name,
            content: JSON.stringify(result),
          });
        }

        // Continue the loop to get the next response
        continue;
      }

      // No tool calls - this is the final response
      finalResponse = response.content;
      
      // Add assistant response to history
      this.conversationHistory.push({
        role: 'assistant',
        content: finalResponse,
      });

      break;
    }

    // Check if compaction is needed after response
    await this.maybeCompact();
    
    return finalResponse;
  }

  async chatStream(userMessage, options = {}) {
    // Check for compaction before adding new message
    await this.maybeCompact();
    
    // Build user message content (text + images)
    const { images } = options;
    let userContent;
    
    if (images && images.length > 0) {
      // Multi-modal message with images
      userContent = [
        { type: 'text', text: userMessage || 'What do you see in this image?' },
        ...images.map(img => ({
          type: 'image_url',
          image_url: { url: img }, // Base64 data URL
        })),
      ];
    } else {
      userContent = userMessage;
    }
    
    // Add user message to history
    this.conversationHistory.push({
      role: 'user',
      content: userContent,
    });

    let iterations = 0;
    let fullResponse = '';

    while (iterations < this.maxIterations) {
      iterations++;

      // Stream LLM response
      const response = await this.streamLLMWithTools();

      // Check if we got tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        // First, add the assistant message with tool_calls
        this.conversationHistory.push({
          role: 'assistant',
          content: response.content || null,
          tool_calls: response.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        });

        // Execute tool calls — notify via dedicated callbacks (not onChunk)
        for (const toolCall of response.toolCalls) {
          this.onToolCall(toolCall);

          const result = await this.tools.execute(toolCall.name, toolCall.arguments);
          this.onToolResult(toolCall.name, result);

          // Add tool result to history
          this.conversationHistory.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolCall.name,
            content: JSON.stringify(result),
          });
        }

        continue;
      }

      // Final response
      fullResponse = response.content;
      
      this.conversationHistory.push({
        role: 'assistant',
        content: fullResponse,
      });

      break;
    }

    // Check if compaction is needed after response
    await this.maybeCompact();
    
    return fullResponse;
  }

  async callLLMWithTools() {
    const apiKey = process.env.OPENROUTER_API_KEY;
    
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY not set');
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/elevate-foundry/ai-native-ide',
        'X-Title': 'Aria IDE',
      },
      body: JSON.stringify({
        model: this.llm.config.model,
        messages: [
          { role: 'system', content: ARIA_AGENT_PROMPT },
          ...this.conversationHistory,
        ],
        tools: TOOL_DEFINITIONS,
        tool_choice: 'auto',
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const message = data.choices[0]?.message;

    if (message.tool_calls) {
      return {
        content: message.content || '',
        toolCalls: message.tool_calls.map(tc => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        })),
      };
    }

    return { content: message.content || '' };
  }

  async streamLLMWithTools() {
    const apiKey = process.env.OPENROUTER_API_KEY;
    
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY not set');
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/elevate-foundry/ai-native-ide',
        'X-Title': 'Aria IDE',
      },
      body: JSON.stringify({
        model: this.llm.config.model,
        messages: [
          { role: 'system', content: ARIA_AGENT_PROMPT },
          ...this.conversationHistory,
        ],
        tools: TOOL_DEFINITIONS,
        tool_choice: 'auto',
        max_tokens: 4096,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${response.status} - ${error}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let toolCalls = [];
    let currentToolCall = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta;

          if (delta?.content) {
            fullContent += delta.content;
            this.onChunk(delta.content);
          }

          // Handle tool calls in streaming
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.index !== undefined) {
                if (!toolCalls[tc.index]) {
                  toolCalls[tc.index] = {
                    id: tc.id || '',
                    name: '',
                    arguments: '',
                  };
                }
                if (tc.id) toolCalls[tc.index].id = tc.id;
                if (tc.function?.name) toolCalls[tc.index].name = tc.function.name;
                if (tc.function?.arguments) toolCalls[tc.index].arguments += tc.function.arguments;
              }
            }
          }
        } catch (e) {
          // Skip malformed chunks
        }
      }
    }

    // Parse tool call arguments
    const parsedToolCalls = toolCalls
      .filter(tc => tc.name)
      .map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments ? JSON.parse(tc.arguments) : {},
      }));

    if (parsedToolCalls.length > 0) {
      return { content: fullContent, toolCalls: parsedToolCalls };
    }

    return { content: fullContent };
  }

  async clearHistory() {
    this.conversationHistory = [];
    await this.store.deleteConversation(this.conversationId);
  }

  getHistory() {
    return this.conversationHistory;
  }

  async getAllConversations() {
    return this.store.getAllConversations();
  }

  async loadConversation(conversationId) {
    const history = await this.store.getConversation(conversationId);
    if (history) {
      this.conversationId = conversationId;
      this.conversationHistory = history;
      await this.maybeCompact();
      return true;
    }
    return false;
  }

  getConversationStats() {
    return {
      ...this.getContextStats(),
      ...this.store.getStats(),
      currentConversationId: this.conversationId
    };
  }

  /**
   * Get performance metrics for the agent
   * @returns {Object} Performance metrics including:
   *   - totalIterations: Number of tool-use iterations
   *   - averageResponseTime: Average time per response
   *   - toolUsageStats: Count of each tool used
   */
  getMetrics() {
    const metrics = {
      totalIterations: 0,
      toolUsageStats: {},
      averageResponseTime: 0,
      totalResponses: this.conversationHistory.filter(msg => msg.role === 'assistant').length
    };

    // Calculate tool usage stats
    this.conversationHistory.forEach(msg => {
      if (msg.tool_calls) {
        metrics.totalIterations++;
        msg.tool_calls.forEach(tc => {
          metrics.toolUsageStats[tc.function.name] = (metrics.toolUsageStats[tc.function.name] || 0) + 1;
        });
      }
    });

    return metrics;
  }
}

module.exports = { AriaAgent, ARIA_AGENT_PROMPT };
