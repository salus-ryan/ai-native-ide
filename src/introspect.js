/**
 * Aria Self-Introspection Module
 * 
 * Gives Aria the ability to examine her own:
 * - Architecture and module graph
 * - Source code of any of her own modules
 * - Runtime state (processes, memory, connections)
 * - Capabilities and tool definitions
 * - Dependency relationships
 * 
 * This is what makes Aria fundamentally different from other AI IDEs:
 * she is aware of her own construction.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ARCHITECTURE_PATH = path.join(PROJECT_ROOT, 'ARCHITECTURE.json');

// ============================================================================
// Architecture Manifest
// ============================================================================

let _architecture = null;

function getArchitecture() {
  if (!_architecture) {
    try {
      _architecture = JSON.parse(fs.readFileSync(ARCHITECTURE_PATH, 'utf-8'));
    } catch (e) {
      return { error: `Failed to load ARCHITECTURE.json: ${e.message}` };
    }
  }
  return _architecture;
}

function reloadArchitecture() {
  _architecture = null;
  return getArchitecture();
}

// ============================================================================
// Introspection Functions
// ============================================================================

/**
 * Get the full architecture manifest
 */
function introspectArchitecture() {
  const arch = getArchitecture();
  if (arch.error) return { success: false, error: arch.error };

  return {
    success: true,
    identity: arch.identity,
    layers: Object.keys(arch.layers).map(key => ({
      name: key,
      description: arch.layers[key].description,
      entrypoint: arch.layers[key].entrypoint,
    })),
    moduleCount: Object.keys(arch.modules).length,
    differentiators: arch.what_makes_this_different,
  };
}

/**
 * Introspect a specific module — read its metadata AND source code
 */
function introspectModule(modulePath) {
  const arch = getArchitecture();
  if (arch.error) return { success: false, error: arch.error };

  // Normalize path
  let key = modulePath;
  if (!key.includes('/')) key = `src/${key}`;
  if (!key.endsWith('.js') && !key.endsWith('.cjs') && !key.endsWith('.mjs')) {
    key += '.js';
  }

  const meta = arch.modules[key];
  if (!meta) {
    // List available modules as suggestion
    return {
      success: false,
      error: `Module '${key}' not found in architecture manifest`,
      available: Object.keys(arch.modules),
    };
  }

  // Read actual source
  const fullPath = path.join(PROJECT_ROOT, key);
  let source = null;
  let lineCount = 0;
  try {
    source = fs.readFileSync(fullPath, 'utf-8');
    lineCount = source.split('\n').length;
  } catch (e) {
    source = `(could not read: ${e.message})`;
  }

  return {
    success: true,
    path: key,
    ...meta,
    lineCount,
    source,
  };
}

/**
 * Get runtime state — what processes are running, memory usage, connections
 */
function introspectRuntime() {
  const arch = getArchitecture();
  const runtime = arch.error ? {} : arch.runtime;

  // Current process info
  const processInfo = {
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    uptime: Math.round(process.uptime()),
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
    },
    cwd: process.cwd(),
  };

  // Check what ports are in use
  let ports = {};
  try {
    const portCheck = execSync('ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo "unavailable"', {
      encoding: 'utf-8',
      timeout: 3000,
    });
    if (!portCheck.includes('unavailable')) {
      if (portCheck.includes(':3200')) ports['3200'] = 'aria-server (HTTP)';
      if (portCheck.includes(':3201')) ports['3201'] = 'braille-websocket';
      if (portCheck.includes(':4173')) ports['4173'] = 'desktop-preview';
    }
  } catch {
    ports = { note: 'Could not check ports' };
  }

  // Check environment
  const env = {
    hasApiKey: !!process.env.OPENROUTER_API_KEY,
    ariaPort: process.env.ARIA_PORT || '3200',
    brailleWsPort: process.env.BRAILLE_WS_PORT || '3201',
  };

  return {
    success: true,
    process: processInfo,
    ports,
    env,
    architecture: runtime,
  };
}

/**
 * Get the full dependency graph as a structured object
 */
function introspectDependencies() {
  const arch = getArchitecture();
  if (arch.error) return { success: false, error: arch.error };

  const graph = {};
  for (const [modPath, meta] of Object.entries(arch.modules)) {
    if (meta.imports && meta.imports.length > 0) {
      graph[modPath] = meta.imports;
    }
  }

  return {
    success: true,
    graph,
    externalDependencies: {
      dotenv: 'Environment variable loading',
      playwright: 'Browser automation',
      ws: 'WebSocket server for braille streaming',
    },
    dependencyFlow: arch.dependency_graph,
  };
}

/**
 * List all available tools with their categories
 */
function introspectCapabilities() {
  const arch = getArchitecture();
  if (arch.error) return { success: false, error: arch.error };

  const tools = arch.layers?.tools?.categories || {};

  return {
    success: true,
    toolCategories: tools,
    totalTools: Object.values(tools).flat().length,
    layers: Object.entries(arch.layers).map(([name, layer]) => ({
      name,
      description: layer.description,
    })),
  };
}

// ============================================================================
// Tool Definitions (OpenAI function calling format)
// ============================================================================

const INTROSPECT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'introspect_architecture',
      description: 'Read Aria\'s own architecture manifest — layers, modules, and what makes her different. Use this to understand your own construction.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'introspect_module',
      description: 'Read the metadata AND full source code of any of Aria\'s own modules. Use this to understand how you work internally.',
      parameters: {
        type: 'object',
        properties: {
          module: {
            type: 'string',
            description: 'Module path (e.g. "agent.js", "src/tools.js", "braille-swarm.js")',
          },
        },
        required: ['module'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'introspect_runtime',
      description: 'Check Aria\'s current runtime state — process info, memory, active ports, environment.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'introspect_dependencies',
      description: 'Get Aria\'s full dependency graph — which modules import which, and external packages.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'introspect_capabilities',
      description: 'List all of Aria\'s tools and capabilities by category.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
];

// ============================================================================
// Tool Executor
// ============================================================================

class IntrospectTools {
  execute(toolName, params) {
    switch (toolName) {
      case 'introspect_architecture':
        return introspectArchitecture();
      case 'introspect_module':
        return introspectModule(params.module);
      case 'introspect_runtime':
        return introspectRuntime();
      case 'introspect_dependencies':
        return introspectDependencies();
      case 'introspect_capabilities':
        return introspectCapabilities();
      default:
        return { success: false, error: `Unknown introspect tool: ${toolName}` };
    }
  }
}

module.exports = {
  INTROSPECT_TOOLS,
  IntrospectTools,
  introspectArchitecture,
  introspectModule,
  introspectRuntime,
  introspectDependencies,
  introspectCapabilities,
  getArchitecture,
  reloadArchitecture,
};
