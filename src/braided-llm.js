/**
 * Braided LLM Responses with Braille Encoding
 * 
 * This module enables Aria to:
 * 1. Query multiple LLMs in parallel
 * 2. Braid their responses together (interleave tokens/sentences)
 * 3. Encode the braided response in braille
 * 4. Translate the braille back to English
 * 
 * The braille encoding serves as a unique "fingerprint" of the combined
 * multi-model response, creating a novel form of model fusion.
 */

const { BRAILLE_MAP, REVERSE_BRAILLE_MAP, textToBraille, brailleToText } = require('./braille');

// ============================================================================
// Braiding Strategies
// ============================================================================

/**
 * Interleave responses word by word
 */
function braidByWord(responses) {
  const wordArrays = responses.map(r => r.split(/\s+/));
  const maxLen = Math.max(...wordArrays.map(a => a.length));
  const braided = [];
  
  for (let i = 0; i < maxLen; i++) {
    for (const words of wordArrays) {
      if (words[i]) {
        braided.push(words[i]);
      }
    }
  }
  
  return braided.join(' ');
}

/**
 * Interleave responses sentence by sentence
 */
function braidBySentence(responses) {
  const sentenceArrays = responses.map(r => 
    r.split(/(?<=[.!?])\s+/).filter(s => s.trim())
  );
  const maxLen = Math.max(...sentenceArrays.map(a => a.length));
  const braided = [];
  
  for (let i = 0; i < maxLen; i++) {
    for (const sentences of sentenceArrays) {
      if (sentences[i]) {
        braided.push(sentences[i]);
      }
    }
  }
  
  return braided.join(' ');
}

/**
 * Interleave responses character by character (creates interesting patterns)
 */
function braidByChar(responses) {
  const maxLen = Math.max(...responses.map(r => r.length));
  const braided = [];
  
  for (let i = 0; i < maxLen; i++) {
    for (const response of responses) {
      if (response[i]) {
        braided.push(response[i]);
      }
    }
  }
  
  return braided.join('');
}

/**
 * Weighted blend - take more from higher-weighted models
 */
function braidWeighted(responses, weights) {
  const wordArrays = responses.map(r => r.split(/\s+/));
  const braided = [];
  
  // Normalize weights
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const normalizedWeights = weights.map(w => w / totalWeight);
  
  // Calculate how many words to take from each
  const maxLen = Math.max(...wordArrays.map(a => a.length));
  
  for (let i = 0; i < maxLen; i++) {
    for (let j = 0; j < wordArrays.length; j++) {
      // Take word based on weight probability
      if (wordArrays[j][i] && Math.random() < normalizedWeights[j] * wordArrays.length) {
        braided.push(wordArrays[j][i]);
      }
    }
  }
  
  return braided.join(' ');
}

// ============================================================================
// Multi-Model Query
// ============================================================================

const DEFAULT_MODELS = [
  'anthropic/claude-3.5-sonnet',
  'openai/gpt-4o',
  'meta-llama/llama-3.1-70b-instruct',
];

async function queryModel(apiKey, model, prompt, systemPrompt = '') {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/elevate-foundry/ai-native-ide',
      'X-Title': 'Aria Braided LLM',
    },
    body: JSON.stringify({
      model,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: prompt },
      ],
      max_tokens: 500,
      temperature: 0.7,
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`${model} error: ${error}`);
  }
  
  const data = await response.json();
  return {
    model,
    content: data.choices?.[0]?.message?.content || '',
  };
}

async function queryMultipleModels(apiKey, prompt, models = DEFAULT_MODELS, systemPrompt = '') {
  const results = await Promise.allSettled(
    models.map(model => queryModel(apiKey, model, prompt, systemPrompt))
  );
  
  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
}

// ============================================================================
// Braided Response Pipeline
// ============================================================================

/**
 * Main braiding function
 * 
 * @param {string} apiKey - OpenRouter API key
 * @param {string} prompt - User prompt
 * @param {object} options - Configuration options
 * @returns {object} - Braided response with braille encoding
 */
async function braidedResponse(apiKey, prompt, options = {}) {
  const {
    models = DEFAULT_MODELS,
    strategy = 'sentence', // 'word', 'sentence', 'char', 'weighted'
    weights = null,
    systemPrompt = 'Be concise and direct. Respond in 2-3 sentences.',
    translateBack = true,
  } = options;
  
  // Query all models in parallel
  const responses = await queryMultipleModels(apiKey, prompt, models, systemPrompt);
  
  if (responses.length === 0) {
    throw new Error('No models responded successfully');
  }
  
  // Extract content
  const contents = responses.map(r => r.content);
  
  // Braid responses
  let braided;
  switch (strategy) {
    case 'word':
      braided = braidByWord(contents);
      break;
    case 'char':
      braided = braidByChar(contents);
      break;
    case 'weighted':
      braided = braidWeighted(contents, weights || models.map(() => 1));
      break;
    case 'sentence':
    default:
      braided = braidBySentence(contents);
      break;
  }
  
  // Encode to braille
  const brailleEncoded = textToBraille(braided);
  
  // Translate back to English (decode braille)
  const translated = translateBack ? brailleToText(brailleEncoded) : null;
  
  return {
    // Original responses from each model
    sources: responses,
    
    // Braided combination
    braided,
    
    // Braille encoding
    braille: brailleEncoded,
    
    // Translated back (should match braided, but lowercase)
    translated,
    
    // Metadata
    metadata: {
      models: responses.map(r => r.model),
      strategy,
      brailleLength: brailleEncoded.length,
      timestamp: new Date().toISOString(),
    },
  };
}

// ============================================================================
// Semantic Braille Fusion
// ============================================================================

/**
 * Advanced fusion: Use an LLM to synthesize the braided braille
 * into a coherent response
 */
async function semanticBrailleFusion(apiKey, prompt, options = {}) {
  const {
    models = DEFAULT_MODELS,
    fusionModel = 'anthropic/claude-3.5-sonnet',
  } = options;
  
  // Get braided response
  const braided = await braidedResponse(apiKey, prompt, {
    ...options,
    models,
    translateBack: true,
  });
  
  // Use fusion model to synthesize
  const fusionPrompt = `You are synthesizing multiple AI perspectives into one coherent response.

Original question: "${prompt}"

Multiple AI models responded, and their responses were braided together and encoded in braille.

Braided braille encoding:
${braided.braille.slice(0, 500)}...

Decoded text:
${braided.translated.slice(0, 1000)}...

Individual model responses:
${braided.sources.map(s => `[${s.model}]: ${s.content}`).join('\n\n')}

Synthesize these perspectives into a single, coherent, high-quality response that captures the best insights from all models. Be concise but comprehensive.`;

  const fusionResponse = await queryModel(apiKey, fusionModel, fusionPrompt);
  
  return {
    ...braided,
    fusion: fusionResponse.content,
    fusionModel,
  };
}

// ============================================================================
// Tool Definitions for Aria
// ============================================================================

const BRAIDED_LLM_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'braided_query',
      description: 'Query multiple LLMs, braid their responses together, encode in braille, and translate back. Creates a unique multi-model fusion.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'The prompt to send to all models',
          },
          models: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of model IDs to query (default: Claude, GPT-4o, Llama)',
          },
          strategy: {
            type: 'string',
            enum: ['word', 'sentence', 'char', 'weighted'],
            description: 'How to braid responses together',
          },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'braided_fusion',
      description: 'Advanced multi-model fusion: query multiple LLMs, braid in braille, then use a fusion model to synthesize a coherent response.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'The prompt to send to all models',
          },
          models: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of model IDs to query',
          },
          fusionModel: {
            type: 'string',
            description: 'Model to use for final synthesis',
          },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'text_to_braille',
      description: 'Convert text to braille encoding',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Text to convert to braille',
          },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'braille_to_text',
      description: 'Convert braille back to text',
      parameters: {
        type: 'object',
        properties: {
          braille: {
            type: 'string',
            description: 'Braille to convert to text',
          },
        },
        required: ['braille'],
      },
    },
  },
];

// ============================================================================
// Tool Executor
// ============================================================================

class BraidedLLMTools {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }
  
  async execute(toolName, args) {
    try {
      switch (toolName) {
        case 'braided_query':
          return await braidedResponse(this.apiKey, args.prompt, {
            models: args.models,
            strategy: args.strategy || 'sentence',
          });
          
        case 'braided_fusion':
          return await semanticBrailleFusion(this.apiKey, args.prompt, {
            models: args.models,
            fusionModel: args.fusionModel,
          });
          
        case 'text_to_braille':
          return {
            success: true,
            text: args.text,
            braille: textToBraille(args.text),
          };
          
        case 'braille_to_text':
          return {
            success: true,
            braille: args.braille,
            text: brailleToText(args.braille),
          };
          
        default:
          return { success: false, error: `Unknown tool: ${toolName}` };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  
  getToolDefinitions() {
    return BRAIDED_LLM_TOOLS;
  }
}

module.exports = {
  textToBraille,
  brailleToText,
  braidByWord,
  braidBySentence,
  braidByChar,
  braidWeighted,
  braidedResponse,
  semanticBrailleFusion,
  BraidedLLMTools,
  BRAIDED_LLM_TOOLS,
};
