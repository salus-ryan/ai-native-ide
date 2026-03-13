/**
 * Aria Tools - File system, command execution, and browser automation
 * 
 * These tools give Aria the ability to actually do things, not just talk.
 */

const fs = require('fs').promises;
const path = require('path');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const { WorldModelTools, WORLD_MODEL_TOOLS } = require('./world-model');
const { BraidedLLMTools, BRAIDED_LLM_TOOLS } = require('./braided-llm');
const { IntrospectTools, INTROSPECT_TOOLS } = require('./introspect');

const execAsync = promisify(exec);

// ============================================================================
// Tool Definitions (OpenAI function calling format)
// ============================================================================

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file at the specified path',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute or relative path to the file',
          },
          start_line: {
            type: 'integer',
            description: 'Optional: start reading from this line (1-indexed)',
          },
          end_line: {
            type: 'integer',
            description: 'Optional: stop reading at this line',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file, creating it if it does not exist',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file to write',
          },
          content: {
            type: 'string',
            description: 'Content to write to the file',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Replace a specific string in a file with new content',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file to edit',
          },
          old_string: {
            type: 'string',
            description: 'The exact string to find and replace',
          },
          new_string: {
            type: 'string',
            description: 'The string to replace it with',
          },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and directories in a path',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path to list',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search for files matching a pattern using grep',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query (regex supported)',
          },
          path: {
            type: 'string',
            description: 'Directory to search in',
          },
          file_pattern: {
            type: 'string',
            description: 'Optional: file pattern like "*.js" or "*.py"',
          },
        },
        required: ['query', 'path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a shell command and return the output',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The command to execute',
          },
          cwd: {
            type: 'string',
            description: 'Working directory for the command',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_navigate',
      description: 'Navigate to a URL in the browser',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL to navigate to',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description: 'Click an element on the page',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector or text content to click',
          },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_type',
      description: 'Type text into an input field',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector for the input field',
          },
          text: {
            type: 'string',
            description: 'Text to type',
          },
        },
        required: ['selector', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_snapshot',
      description: 'Get the current page accessibility snapshot (DOM structure)',
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
      name: 'browser_screenshot',
      description: 'Take a screenshot of the current page',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to save the screenshot',
          },
        },
        required: [],
      },
    },
  },
  // Add World Model tools
  ...WORLD_MODEL_TOOLS,
  // Add Braided LLM tools
  ...BRAIDED_LLM_TOOLS,
  // Add Introspection tools (self-awareness)
  ...INTROSPECT_TOOLS,
];

// ============================================================================
// Tool Implementations
// ============================================================================

class AriaTools {
  constructor(options = {}) {
    this.workingDirectory = options.workingDirectory || process.cwd();
    this.browser = null; // Playwright browser instance
    this.page = null;    // Current page
    this.worldModel = new WorldModelTools(options.worldModelPath);
    this.braidedLLM = new BraidedLLMTools(options.apiKey || process.env.OPENROUTER_API_KEY);
    this.introspect = new IntrospectTools();
  }

  async initBrowser() {
    if (this.browser) return;
    
    try {
      const { chromium } = require('playwright');
      this.browser = await chromium.launch({ headless: false });
      const context = await this.browser.newContext();
      this.page = await context.newPage();
    } catch (e) {
      console.warn('Playwright not available:', e.message);
    }
  }

  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  resolvePath(filePath) {
    if (path.isAbsolute(filePath)) return filePath;
    return path.resolve(this.workingDirectory, filePath);
  }

  // File operations
  async read_file({ path: filePath, start_line, end_line }) {
    try {
      const fullPath = this.resolvePath(filePath);
      const content = await fs.readFile(fullPath, 'utf-8');
      
      if (start_line || end_line) {
        const lines = content.split('\n');
        const start = (start_line || 1) - 1;
        const end = end_line || lines.length;
        return {
          success: true,
          content: lines.slice(start, end).map((line, i) => `${start + i + 1}: ${line}`).join('\n'),
          total_lines: lines.length,
        };
      }
      
      return { success: true, content };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async write_file({ path: filePath, content }) {
    try {
      const fullPath = this.resolvePath(filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');
      return { success: true, path: fullPath };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async edit_file({ path: filePath, old_string, new_string }) {
    try {
      const fullPath = this.resolvePath(filePath);
      const content = await fs.readFile(fullPath, 'utf-8');
      
      if (!content.includes(old_string)) {
        return { success: false, error: 'old_string not found in file' };
      }
      
      const newContent = content.replace(old_string, new_string);
      await fs.writeFile(fullPath, newContent, 'utf-8');
      return { success: true, path: fullPath };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async list_directory({ path: dirPath }) {
    try {
      const fullPath = this.resolvePath(dirPath);
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      
      const items = entries.map(entry => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
      }));
      
      return { success: true, items };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async search_files({ query, path: searchPath, file_pattern }) {
    try {
      const fullPath = this.resolvePath(searchPath);
      let cmd = `grep -rn "${query}" "${fullPath}"`;
      
      if (file_pattern) {
        cmd = `grep -rn --include="${file_pattern}" "${query}" "${fullPath}"`;
      }
      
      const { stdout } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
      const lines = stdout.trim().split('\n').slice(0, 50); // Limit results
      
      return { success: true, matches: lines };
    } catch (e) {
      if (e.code === 1) {
        return { success: true, matches: [] }; // No matches
      }
      return { success: false, error: e.message };
    }
  }

  async run_command({ command, cwd }) {
    try {
      const workDir = cwd ? this.resolvePath(cwd) : this.workingDirectory;
      const { stdout, stderr } = await execAsync(command, { 
        cwd: workDir,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30000,
      });
      
      return { 
        success: true, 
        stdout: stdout.slice(0, 10000), // Limit output
        stderr: stderr.slice(0, 2000),
      };
    } catch (e) {
      return { 
        success: false, 
        error: e.message,
        stdout: e.stdout?.slice(0, 5000) || '',
        stderr: e.stderr?.slice(0, 2000) || '',
      };
    }
  }

  // Browser operations
  async browser_navigate({ url }) {
    try {
      await this.initBrowser();
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
      return { success: true, url: this.page.url(), title: await this.page.title() };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async browser_click({ selector }) {
    try {
      await this.initBrowser();
      
      // Try CSS selector first, then text
      try {
        await this.page.click(selector, { timeout: 5000 });
      } catch {
        await this.page.getByText(selector).click({ timeout: 5000 });
      }
      
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async browser_type({ selector, text }) {
    try {
      await this.initBrowser();
      await this.page.fill(selector, text);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async browser_snapshot() {
    try {
      await this.initBrowser();
      const snapshot = await this.page.accessibility.snapshot();
      return { success: true, snapshot };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async browser_screenshot({ path: screenshotPath }) {
    try {
      await this.initBrowser();
      const savePath = screenshotPath || `/tmp/aria-screenshot-${Date.now()}.png`;
      await this.page.screenshot({ path: savePath, fullPage: true });
      return { success: true, path: savePath };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // Execute a tool by name
  async execute(toolName, params) {
    // Check if it's a world model tool
    if (toolName.startsWith('world_')) {
      return this.worldModel.execute(toolName, params);
    }
    
    // Check if it's a braided LLM tool
    if (toolName.startsWith('braided_') || toolName === 'text_to_braille' || toolName === 'braille_to_text') {
      return this.braidedLLM.execute(toolName, params);
    }
    
    // Check if it's an introspection tool
    if (toolName.startsWith('introspect_')) {
      return this.introspect.execute(toolName, params);
    }
    
    const method = this[toolName];
    if (!method) {
      return { success: false, error: `Unknown tool: ${toolName}` };
    }
    return method.call(this, params);
  }
}

module.exports = {
  TOOL_DEFINITIONS,
  AriaTools,
};
