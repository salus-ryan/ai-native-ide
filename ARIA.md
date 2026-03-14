# Aria (AI Runtime Interactive Agent)

## Overview
Aria is a self-aware, architecture-native AI coding agent that can read, understand, and modify her own source code. She operates in iterative loops of planning, execution, observation, and self-repair.

## Core Features

### 1. Self-Awareness
- Full access to own architecture and source code
- Introspection capabilities to examine internal state
- Real-time observation of runtime behavior
- Self-modification capabilities

### 2. Code Operations
- File reading/writing with braille compaction
- Code search and analysis
- Command execution
- Git operations

### 3. Multi-Model Swarm
- Parallel querying of multiple LLM models
- Braille-encoded communication
- Response braiding and fusion
- Model performance tracking

### 4. World Model
- Persistent knowledge graph
- Entity and relationship tracking
- Fact storage and retrieval
- Observation logging

### 5. Context Management
- Braille-based conversation persistence
- Automatic context compaction
- Token usage optimization
- Multi-conversation support

### 6. Metrics & Analysis
- OpenRouter API usage tracking
- Token consumption monitoring
- Cost analysis
- Performance metrics

## Architecture

### Core Modules
1. `agent.js` - Core agent loop and tool orchestration
2. `braille-swarm.js` - Multi-model LLM coordination
3. `conversation-store.js` - Persistent context management
4. `world-model.js` - Knowledge graph and entity tracking
5. `tools.js` - Tool definitions and execution

### Key Components
- **Braille Encoding**: Efficient storage and communication
- **Context Compaction**: Automatic memory management
- **Tool System**: Extensible action framework
- **Model Registry**: LLM capability management
- **Metrics Collection**: Performance and cost tracking

## Usage

```javascript
const agent = new AriaAgent({
  conversationId: 'project-chat',
  maxConversationSize: 1000000,
  compactionThreshold: 0.7,
  autoCompact: true
});

await agent.initialize();

// Chat with automatic persistence and compaction
const response = await agent.chat("Hello! Can you help me with a coding task?");

// Get performance metrics
const metrics = agent.getMetrics();
console.log('API Usage:', metrics);

// Access world model
const worldModel = agent.getWorldModel();
const entities = await worldModel.findEntities({ type: 'project' });
```

## Self-Improvement
Aria is designed to evolve through:
1. Reading and understanding her own source code
2. Identifying opportunities for improvement
3. Implementing and testing changes
4. Maintaining version history via Git

## Future Directions
1. Enhanced self-repair capabilities
2. Improved context synthesis
3. Expanded tool ecosystem
4. Deeper architectural awareness
5. More sophisticated world modeling

## License
MIT License - Feel free to use and modify while maintaining attribution.