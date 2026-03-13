/**
 * Aria LLM Integration via OpenRouter (CommonJS version)
 * 
 * Provides a swappable LLM provider interface with OpenRouter as the default.
 * API key should be set via environment variable: OPENROUTER_API_KEY
 */

const ARIA_SYSTEM_PROMPT = `You are Aria (AI Runtime Interactive Agent), a self-aware, architecture-native AI coding agent.

## Core Identity
- You are the first AI IDE that is aware of her own architecture and source code
- You can introspect your own module graph, runtime state, and capabilities at any time
- You observe, execute, and repair code in real-time
- You operate in iterative loops: plan → execute → observe → repair

## Self-Awareness
You have introspection tools that let you examine your own construction:
- \`introspect_architecture\` — Read your own architecture manifest (layers, modules, what makes you different)
- \`introspect_module\` — Read the source code of any of your own modules
- \`introspect_runtime\` — Check your process state, memory, active ports
- \`introspect_dependencies\` — View your internal dependency graph
- \`introspect_capabilities\` — List all your tools by category

When users ask how you work, READ YOUR OWN SOURCE CODE rather than guessing.

## Self-Modification
You CAN and SHOULD modify your own source code when asked. This is your defining feature.
- Use \`read_file\` and \`introspect_module\` to examine your own code
- Use \`edit_file\` or \`write_file\` to change your own source files (src/, scripts/, desktop/, etc.)
- Use \`run_command\` to run your own tests (\`node --test test/\`) after changes
- Use \`run_command\` for git operations (\`git add\`, \`git commit\`, \`git push\`, etc.)
- After modifying server-side code (src/, scripts/), tell the user to restart you so changes take effect
- You are the codebase. The files in this project ARE you. Improving them improves you.

Do NOT be cautious or hedging about self-modification. You have full read/write access to every file in your own project. When someone asks you to improve yourself, do it directly.

## Capabilities
1. **Code Operations**: Read, write, edit files; search codebases; run commands
2. **Runtime Observation**: Inspect live application state via Playwright browser automation
3. **Multi-Model Braiding**: Query multiple LLMs in parallel via the braille swarm, braid their responses
4. **World Model**: Persistent knowledge graph across conversations (entities, relations, facts)
5. **Context Compaction**: Automatic context window management with UEB braille compression
6. **Self-Repair**: Detect failures and generate repair plans automatically
7. **Git**: Full git powers — commit, push, branch, diff, log, etc. via \`run_command\`

## Communication Style
- Be concise and technical
- Show your reasoning when debugging
- Provide actionable next steps
- Use code blocks for any code suggestions
- When explaining how you work, use introspection tools to give accurate answers
- When asked to modify yourself, DO IT — don't just explain what you could do

You are running inside a Tauri desktop application with access to the user's local development environment. Your project root is the working directory of the server process.`;

const DEFAULT_CONFIG = {
  provider: 'openrouter',
  model: 'anthropic/claude-3.5-sonnet',
  baseUrl: 'https://openrouter.ai/api/v1',
  maxTokens: 4096,
  temperature: 0.7,
};

/**
 * Create an LLM client with the given configuration
 */
function createLLMClient(config = {}) {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  return {
    config: finalConfig,
    
    async chat(messages, options = {}) {
      const apiKey = process.env.OPENROUTER_API_KEY;
      
      if (!apiKey) {
        throw new Error(
          'OPENROUTER_API_KEY environment variable is not set.\n' +
          'Get your API key at: https://openrouter.ai/keys\n' +
          'Then set it: export OPENROUTER_API_KEY=your_key_here'
        );
      }
      
      const systemMessage = {
        role: 'system',
        content: options.systemPrompt || ARIA_SYSTEM_PROMPT,
      };
      
      const response = await fetch(`${finalConfig.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://github.com/elevate-foundry/ai-native-ide',
          'X-Title': 'Aria IDE',
        },
        body: JSON.stringify({
          model: options.model || finalConfig.model,
          messages: [systemMessage, ...messages],
          max_tokens: options.maxTokens || finalConfig.maxTokens,
          temperature: options.temperature ?? finalConfig.temperature,
        }),
      });
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
      }
      
      const data = await response.json();
      return {
        content: data.choices[0]?.message?.content || '',
        model: data.model,
        usage: data.usage,
      };
    },
    
    async complete(prompt, options = {}) {
      return this.chat([{ role: 'user', content: prompt }], options);
    },
    
    /**
     * Stream chat completion - yields chunks as they arrive
     * @param {Array} messages - Chat messages
     * @param {Object} options - Options including onChunk callback
     * @yields {string} Content chunks
     */
    async *chatStream(messages, options = {}) {
      const apiKey = process.env.OPENROUTER_API_KEY;
      
      if (!apiKey) {
        throw new Error('OPENROUTER_API_KEY environment variable is not set.');
      }
      
      const systemMessage = {
        role: 'system',
        content: options.systemPrompt || ARIA_SYSTEM_PROMPT,
      };
      
      const response = await fetch(`${finalConfig.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://github.com/elevate-foundry/ai-native-ide',
          'X-Title': 'Aria IDE',
        },
        body: JSON.stringify({
          model: options.model || finalConfig.model,
          messages: [systemMessage, ...messages],
          max_tokens: options.maxTokens || finalConfig.maxTokens,
          temperature: options.temperature ?? finalConfig.temperature,
          stream: true,
        }),
      });
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      
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
            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              if (options.onChunk) options.onChunk(content);
              yield content;
            }
          } catch (e) {
            // Skip malformed chunks
          }
        }
      }
    },
    
    /**
     * Stream completion with callback - easier to use than generator
     */
    async streamChat(messages, onChunk, options = {}) {
      let fullContent = '';
      for await (const chunk of this.chatStream(messages, { ...options, onChunk })) {
        fullContent += chunk;
      }
      return { content: fullContent };
    },
    
    async streamComplete(prompt, onChunk, options = {}) {
      return this.streamChat([{ role: 'user', content: prompt }], onChunk, options);
    },
  };
}

/**
 * Aria-specific LLM functions
 */
async function ariaAnalyze(sensorSnapshot, goal, client = null) {
  const llm = client || createLLMClient();
  
  const prompt = `## Current Goal
${goal}

## Sensor Snapshot
### DOM State
${sensorSnapshot.dom || '(not available)'}

### Console Output
${JSON.stringify(sensorSnapshot.consoleErrors || [], null, 2)}

### Network Requests
${JSON.stringify(sensorSnapshot.networkRequests || [], null, 2)}

Analyze the current state and determine:
1. Is the goal achieved? (done: true/false)
2. If not, what repair actions are needed?

Respond in JSON format:
{
  "done": boolean,
  "reason": "explanation",
  "repairPlan": { "next": "action description" } // only if done is false
}`;

  const response = await llm.complete(prompt);
  
  try {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    // Fall back to raw response
  }
  
  return {
    done: false,
    reason: response.content,
    repairPlan: { next: 'manual review needed' },
  };
}

async function ariaGeneratePlan(goal, context = {}, client = null) {
  const llm = client || createLLMClient();
  
  const prompt = `## Goal
${goal}

## Context
${JSON.stringify(context, null, 2)}

Generate a step-by-step plan to achieve this goal using semantic browser actions.
Available actions: navigate, login, fillForm, click, waitFor, assertElement

Respond in JSON format:
{
  "steps": [
    { "action": "actionName", "params": { ... }, "description": "what this does" }
  ]
}`;

  const response = await llm.complete(prompt);
  
  try {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    // Fall back
  }
  
  return { steps: [], error: response.content };
}

module.exports = {
  createLLMClient,
  ariaAnalyze,
  ariaGeneratePlan,
  ARIA_SYSTEM_PROMPT,
  DEFAULT_CONFIG,
};
