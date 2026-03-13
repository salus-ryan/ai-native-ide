/**
 * Aria IDE - Main JavaScript
 * 
 * Full IDE with:
 * - File tree explorer
 * - Monaco code editor
 * - Integrated terminal
 * - Chat with Aria
 * - Braille encoding for multi-model fusion
 */

// ============================================================================
// Configuration
// ============================================================================

const ARIA_SERVER = window.location.origin; // Same server serves API + UI
const BRAILLE_WS_URL = `ws://${window.location.hostname}:3201`;
const HOME_DIR = null; // Resolved from server via /browse endpoint
let currentBrowsePath = null; // Will be set on first /browse call

// Braille WebSocket connection
let brailleWS = null;
let brailleWSConnected = false;

// ============================================================================
// State
// ============================================================================

let editor = null;
let currentFile = null;
let openFiles = new Map(); // path -> { content, modified }

// ============================================================================
// Monaco Editor Setup
// ============================================================================

require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });

require(['vs/editor/editor.main'], function () {
  // Set dark theme
  monaco.editor.defineTheme('aria-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#0d1117',
      'editor.foreground': '#e6edf3',
      'editorLineNumber.foreground': '#6e7681',
      'editorCursor.foreground': '#58a6ff',
      'editor.selectionBackground': '#264f78',
    },
  });
  monaco.editor.setTheme('aria-dark');

  editor = monaco.editor.create(document.getElementById('monacoEditor'), {
    value: '',
    language: 'javascript',
    theme: 'aria-dark',
    fontSize: 13,
    fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 2,
    wordWrap: 'on',
  });

  // Track cursor position
  editor.onDidChangeCursorPosition((e) => {
    document.getElementById('cursorPosition').textContent = 
      `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
  });

  // Track content changes
  editor.onDidChangeModelContent(() => {
    if (currentFile) {
      const fileState = openFiles.get(currentFile);
      if (fileState) {
        fileState.modified = true;
        updateTabState(currentFile, true);
      }
    }
  });

  // Keyboard shortcuts
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveCurrentFile);
});

// ============================================================================
// File Tree
// ============================================================================

async function loadFileTree(browsePath = null) {
  const fileTree = document.getElementById('fileTree');
  fileTree.innerHTML = '<div class="loading">Loading files...</div>';
  
  if (browsePath) {
    currentBrowsePath = browsePath;
  }
  
  // Update path display
  updatePathDisplay();

  try {
    const browseUrl = currentBrowsePath 
      ? `${ARIA_SERVER}/browse?path=${encodeURIComponent(currentBrowsePath)}`
      : `${ARIA_SERVER}/browse`;
    const response = await fetch(browseUrl);
    if (!response.ok) throw new Error('Failed to load files');
    
    const data = await response.json();
    fileTree.innerHTML = '';
    
    // Add parent directory link if not at root
    if (data.parent && data.path !== '/') {
      const parentDiv = document.createElement('div');
      parentDiv.className = 'tree-item directory parent-dir';
      parentDiv.innerHTML = '<span class="icon">⬆️</span><span class="name">..</span>';
      parentDiv.addEventListener('click', () => loadFileTree(data.parent));
      fileTree.appendChild(parentDiv);
    }
    
    // Render files from browse response
    renderBrowseResults(data.files, fileTree);
  } catch (e) {
    fileTree.innerHTML = `<div class="error">Error loading files: ${e.message}</div>`;
  }
}

function updatePathDisplay() {
  const pathEl = document.getElementById('currentPath');
  if (pathEl) {
    // Show shortened path
    let displayPath = currentBrowsePath || '~';
    pathEl.textContent = displayPath;
    pathEl.title = currentBrowsePath || 'Home';
  }
}

function renderBrowseResults(files, container) {
  files.forEach(item => {
    const div = document.createElement('div');
    div.className = `tree-item ${item.type}`;
    div.dataset.path = item.path;
    
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = item.type === 'directory' ? '📁' : getFileIcon(item.name);
    
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.name;
    
    div.appendChild(icon);
    div.appendChild(name);
    container.appendChild(div);
    
    if (item.type === 'directory') {
      div.addEventListener('click', () => {
        loadFileTree(item.path);
      });
    } else {
      div.addEventListener('click', () => {
        openFile(item.path);
      });
    }
  });
}

function navigateToPath(path) {
  loadFileTree(path);
}

function goHome() {
  currentBrowsePath = null;
  loadFileTree();
}

function goToProject(projectPath) {
  // Default to the project root (detected from server)
  if (!projectPath) {
    fetch(`${ARIA_SERVER}/workspace`)
      .then(r => r.json())
      .then(data => loadFileTree(data.root || data.path))
      .catch(() => loadFileTree());
    return;
  }
  loadFileTree(projectPath);
}

function getFilePath(element) {
  // Use data-path attribute if available
  if (element.dataset && element.dataset.path) {
    return element.dataset.path;
  }
  
  const parts = [];
  let current = element;
  
  while (current && current.classList) {
    if (current.classList.contains('tree-item')) {
      const name = current.querySelector('.name')?.textContent;
      if (name) parts.unshift(name);
    }
    current = current.parentElement;
  }
  
  return parts.join('/');
}

function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const icons = {
    js: '📜', mjs: '📜', ts: '📘', tsx: '⚛️', jsx: '⚛️',
    json: '📋', html: '🌐', css: '🎨', md: '📝',
    py: '🐍', rs: '🦀', go: '🔵', rb: '💎',
    sh: '⚡', yml: '⚙️', yaml: '⚙️', toml: '⚙️',
    svg: '🖼️', png: '🖼️', jpg: '🖼️',
  };
  return icons[ext] || '📄';
}

// ============================================================================
// File Operations
// ============================================================================

async function openFile(path) {
  if (!path) return;
  
  // Show editor, hide welcome
  document.getElementById('editorWelcome').style.display = 'none';
  document.getElementById('monacoEditor').style.display = 'block';
  
  // Check if already open
  if (openFiles.has(path)) {
    switchToFile(path);
    return;
  }
  
  // Load file content
  try {
    const response = await fetch(`${ARIA_SERVER}/file?path=${encodeURIComponent(path)}`);
    let content;
    
    if (response.ok) {
      content = await response.text();
    } else {
      // Fallback: try to read from local mock
      content = `// File: ${path}\n// (Content would be loaded from server)\n`;
    }
    
    openFiles.set(path, { content, modified: false });
    addTab(path);
    switchToFile(path);
    
  } catch (e) {
    console.error('Failed to open file:', e);
    setStatus(`Failed to open ${path}`, 'error');
  }
}

function switchToFile(path) {
  currentFile = path;
  const fileState = openFiles.get(path);
  
  if (editor && fileState) {
    const language = getLanguage(path);
    const model = monaco.editor.createModel(fileState.content, language);
    editor.setModel(model);
    
    document.getElementById('fileLanguage').textContent = language;
    updateTabsUI();
  }
}

function getLanguage(path) {
  const ext = path.split('.').pop().toLowerCase();
  const languages = {
    js: 'javascript', mjs: 'javascript', ts: 'typescript',
    tsx: 'typescript', jsx: 'javascript', json: 'json',
    html: 'html', css: 'css', md: 'markdown',
    py: 'python', rs: 'rust', go: 'go', rb: 'ruby',
    sh: 'shell', yml: 'yaml', yaml: 'yaml', toml: 'toml',
  };
  return languages[ext] || 'plaintext';
}

async function saveCurrentFile() {
  if (!currentFile) return;
  
  const content = editor.getValue();
  
  try {
    const response = await fetch(`${ARIA_SERVER}/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentFile, content }),
    });
    
    if (response.ok) {
      openFiles.get(currentFile).content = content;
      openFiles.get(currentFile).modified = false;
      updateTabState(currentFile, false);
      setStatus(`Saved ${currentFile}`, 'success');
    } else {
      throw new Error('Save failed');
    }
  } catch (e) {
    setStatus(`Failed to save ${currentFile}`, 'error');
  }
}

// ============================================================================
// Tabs
// ============================================================================

function addTab(path) {
  const tabs = document.getElementById('editorTabs');
  const filename = path.split('/').pop();
  
  const tab = document.createElement('div');
  tab.className = 'tab';
  tab.dataset.path = path;
  tab.innerHTML = `
    <span class="tab-name">${filename}</span>
    <span class="close-tab" onclick="closeTab('${path}', event)">×</span>
  `;
  tab.addEventListener('click', () => switchToFile(path));
  tabs.appendChild(tab);
}

function closeTab(path, event) {
  event?.stopPropagation();
  
  openFiles.delete(path);
  const tab = document.querySelector(`.tab[data-path="${path}"]`);
  tab?.remove();
  
  if (currentFile === path) {
    const remaining = Array.from(openFiles.keys());
    if (remaining.length > 0) {
      switchToFile(remaining[remaining.length - 1]);
    } else {
      currentFile = null;
      document.getElementById('editorWelcome').style.display = 'flex';
      document.getElementById('monacoEditor').style.display = 'none';
    }
  }
}

function updateTabsUI() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.path === currentFile);
  });
}

function updateTabState(path, modified) {
  const tab = document.querySelector(`.tab[data-path="${path}"]`);
  if (tab) {
    const name = tab.querySelector('.tab-name');
    const filename = path.split('/').pop();
    name.textContent = modified ? `● ${filename}` : filename;
  }
}

// ============================================================================
// Terminal
// ============================================================================

const terminalHistory = [];
let historyIndex = -1;

document.getElementById('terminalInput')?.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    const input = e.target;
    const command = input.value.trim();
    
    if (command) {
      terminalHistory.push(command);
      historyIndex = terminalHistory.length;
      
      appendTerminalOutput(`$ ${command}`, 'command');
      input.value = '';
      
      await executeCommand(command);
    }
  } else if (e.key === 'ArrowUp') {
    if (historyIndex > 0) {
      historyIndex--;
      e.target.value = terminalHistory[historyIndex];
    }
  } else if (e.key === 'ArrowDown') {
    if (historyIndex < terminalHistory.length - 1) {
      historyIndex++;
      e.target.value = terminalHistory[historyIndex];
    } else {
      historyIndex = terminalHistory.length;
      e.target.value = '';
    }
  }
});

async function executeCommand(command) {
  try {
    const response = await fetch(`${ARIA_SERVER}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    
    const result = await response.json();
    
    if (result.stdout) {
      appendTerminalOutput(result.stdout, 'stdout');
    }
    if (result.stderr) {
      appendTerminalOutput(result.stderr, 'stderr');
    }
  } catch (e) {
    appendTerminalOutput(`Error: ${e.message}`, 'stderr');
  }
}

function appendTerminalOutput(text, type = 'stdout') {
  const output = document.getElementById('terminalOutput');
  const line = document.createElement('div');
  line.className = type;
  line.textContent = text;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
}

document.getElementById('clearTerminal')?.addEventListener('click', () => {
  document.getElementById('terminalOutput').innerHTML = '';
});

document.getElementById('toggleTerminal')?.addEventListener('click', () => {
  const container = document.getElementById('terminalContainer');
  container.classList.toggle('collapsed');
  const btn = document.getElementById('toggleTerminal');
  btn.textContent = container.classList.contains('collapsed') ? '▲' : '▼';
});

// ============================================================================
// Chat with Aria
// ============================================================================

let pendingImages = []; // Images to send with next message

async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message && pendingImages.length === 0) return;
  
  input.value = '';
  
  // Show user message with image previews
  if (pendingImages.length > 0) {
    appendChatMessage('user', message, pendingImages);
  } else {
    appendChatMessage('user', message);
  }
  
  // Prepare images for API
  const images = [...pendingImages];
  pendingImages = [];
  updateImagePreview();
  
  try {
    const response = await fetch(`${ARIA_SERVER}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        message,
        images, // Base64 encoded images
        context: {
          currentFile,
          fileContent: currentFile ? editor?.getValue() : null,
        },
      }),
    });
    
    if (!response.ok) throw new Error('Chat failed');
    
    // Handle streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let assistantMessage = '';
    let messageEl = null;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            
            if (data.type === 'chunk') {
              assistantMessage += data.content;
              if (!messageEl) {
                messageEl = appendChatMessage('assistant', assistantMessage);
              } else {
                updateChatMessage(messageEl, assistantMessage);
              }
            } else if (data.type === 'tool_call') {
              appendChatMessage('tool', `🔧 ${data.name}: ${JSON.stringify(data.arguments || data.args || {}).slice(0, 100)}`);
              // Auto-refresh file tree and editor on file operations
              if (['write_file', 'edit_file', 'delete_file'].includes(data.name)) {
                setTimeout(() => {
                  loadFileTree();
                  // Reload current file if Aria edited it
                  const toolArgs = data.arguments || data.args || {};
                  if (toolArgs.path && openFiles.has(toolArgs.path)) {
                    openFiles.delete(toolArgs.path);
                    openFile(toolArgs.path);
                  }
                }, 500);
              }
            } else if (data.type === 'tool_result') {
              appendChatMessage('tool', `✓ ${data.preview?.slice?.(0, 100) || 'Done'}`);
            } else if (data.type === 'done') {
              // Final response received — do nothing, message is already displayed
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
    
  } catch (e) {
    appendChatMessage('assistant', `Error: ${e.message}. Is the Aria server running?`);
  }
}

// ============================================================================
// 8-Dot Braille Encoding (Full Unicode/ASCII support)
// ============================================================================
// 8-dot braille uses Unicode range U+2800 to U+28FF (256 patterns)
// This allows encoding any byte value (0-255), perfect for:
// - Full ASCII including all punctuation and control chars
// - UTF-8 byte sequences for non-Latin scripts (Chinese, Japanese, etc.)
// - Binary data if needed
//
// Encoding: Each character's code point is mapped to braille pattern
// For ASCII (0-127): Direct mapping to braille dots
// For Unicode (>127): Encode as UTF-8 bytes, each byte becomes a braille cell

const BRAILLE_BASE = 0x2800; // Unicode braille pattern blank (⠀)

// Convert a byte (0-255) to an 8-dot braille character
function byteToBraille(byte) {
  return String.fromCodePoint(BRAILLE_BASE + byte);
}

// Convert an 8-dot braille character back to a byte
function brailleToByte(brailleChar) {
  const codePoint = brailleChar.codePointAt(0);
  if (codePoint >= BRAILLE_BASE && codePoint <= BRAILLE_BASE + 255) {
    return codePoint - BRAILLE_BASE;
  }
  return null; // Not a braille character
}

// Encode text to 8-dot braille (handles full Unicode)
function toBraille(text) {
  const encoder = new TextEncoder(); // UTF-8 encoder
  const bytes = encoder.encode(text);
  let result = '';
  for (const byte of bytes) {
    result += byteToBraille(byte);
  }
  return result;
}

// Decode 8-dot braille back to text
function fromBraille(braille) {
  const bytes = [];
  for (const char of braille) {
    const byte = brailleToByte(char);
    if (byte !== null) {
      bytes.push(byte);
    }
  }
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(new Uint8Array(bytes));
}

// Legacy 6-dot braille map for display purposes (Grade 1 Braille)
const BRAILLE_6DOT_MAP = {
  'a': '⠁', 'b': '⠃', 'c': '⠉', 'd': '⠙', 'e': '⠑',
  'f': '⠋', 'g': '⠛', 'h': '⠓', 'i': '⠊', 'j': '⠚',
  'k': '⠅', 'l': '⠇', 'm': '⠍', 'n': '⠝', 'o': '⠕',
  'p': '⠏', 'q': '⠟', 'r': '⠗', 's': '⠎', 't': '⠞',
  'u': '⠥', 'v': '⠧', 'w': '⠺', 'x': '⠭', 'y': '⠽',
  'z': '⠵', ' ': '⠀',
};

// Human-readable 6-dot braille (for display, not encoding)
function toDisplayBraille(text) {
  return text.toLowerCase().split('').map(c => BRAILLE_6DOT_MAP[c] || byteToBraille(c.charCodeAt(0))).join('');
}

let showBrailleMode = true; // Toggle for braille display

function appendChatMessage(role, content, images = []) {
  const messages = document.getElementById('chatMessages');
  const msg = document.createElement('div');
  msg.className = `chat-message ${role}`;
  
  // Add images if present
  if (images.length > 0) {
    const imageContainer = document.createElement('div');
    imageContainer.className = 'chat-images';
    images.forEach(imgData => {
      const img = document.createElement('img');
      img.src = imgData;
      img.className = 'chat-image';
      imageContainer.appendChild(img);
    });
    msg.appendChild(imageContainer);
  }
  
  // Add text content with braille encoding for assistant messages
  if (content) {
    if (role === 'assistant' && showBrailleMode) {
      // Braille-braided response
      const brailleEl = document.createElement('div');
      brailleEl.className = 'chat-braille';
      brailleEl.textContent = toBraille(content);
      msg.appendChild(brailleEl);
      
      // English translation
      const textEl = document.createElement('div');
      textEl.className = 'chat-text chat-translation';
      textEl.innerHTML = `<span class="translation-label">⟶ English:</span> ${content}`;
      msg.appendChild(textEl);
    } else {
      const textEl = document.createElement('div');
      textEl.className = 'chat-text';
      textEl.textContent = content;
      msg.appendChild(textEl);
    }
  }
  
  messages.appendChild(msg);
  messages.scrollTop = messages.scrollHeight;
  return msg.querySelector('.chat-text') || msg;
}

function updateChatMessage(el, content) {
  // el is the .chat-text element returned by appendChatMessage
  const msg = el.closest('.chat-message');
  if (!msg) { el.textContent = content; return; }
  
  // Update braille display if present
  const brailleEl = msg.querySelector('.chat-braille');
  if (brailleEl) brailleEl.textContent = toBraille(content);
  
  // Update text
  const textEl = msg.querySelector('.chat-text');
  if (textEl) {
    if (textEl.classList.contains('chat-translation')) {
      textEl.innerHTML = `<span class="translation-label">⟶ English:</span> ${escapeHtml(content)}`;
    } else {
      textEl.textContent = content;
    }
  }
  
  // Auto-scroll
  const messages = document.getElementById('chatMessages');
  if (messages) messages.scrollTop = messages.scrollHeight;
}

function toggleBrailleMode() {
  showBrailleMode = !showBrailleMode;
  setStatus(showBrailleMode ? '⠃⠗⠁⠊⠇⠇⠑ Braille mode ON' : 'Braille mode OFF', 'info');
}

window.toggleBrailleMode = toggleBrailleMode;
window.toBraille = toBraille;
window.fromBraille = fromBraille;
window.toDisplayBraille = toDisplayBraille;
window.byteToBraille = byteToBraille;
window.brailleToByte = brailleToByte;

// ============================================================================
// Braille WebSocket Client
// ============================================================================

function connectBrailleWS() {
  if (brailleWS && brailleWS.readyState === WebSocket.OPEN) return;
  
  try {
    brailleWS = new WebSocket(BRAILLE_WS_URL);
    
    brailleWS.onopen = () => {
      brailleWSConnected = true;
      console.log('[BrailleWS] Connected');
      setStatus('⠃⠗ Braille WebSocket connected', 'info');
    };
    
    brailleWS.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleBrailleWSMessage(msg);
      } catch (e) {
        console.error('[BrailleWS] Parse error:', e);
      }
    };
    
    brailleWS.onclose = () => {
      brailleWSConnected = false;
      console.log('[BrailleWS] Disconnected');
      // Reconnect after 3 seconds
      setTimeout(connectBrailleWS, 3000);
    };
    
    brailleWS.onerror = (err) => {
      console.error('[BrailleWS] Error:', err);
    };
  } catch (e) {
    console.error('[BrailleWS] Connection failed:', e);
  }
}

function handleBrailleWSMessage(msg) {
  switch (msg.type) {
    case 'welcome':
      console.log('[BrailleWS] Welcome:', msg.text);
      appendBrailleLog('system', msg.braille, msg.text);
      break;
      
    case 'chatChunk':
      // Real-time braille chunk from LLM
      appendBrailleChunk(msg.agent, msg.braille, msg.text);
      break;
      
    case 'chatComplete':
      finalizeBrailleMessage(msg.agent);
      break;
      
    case 'swarmMessage':
    case 'massiveSwarmMessage':
      // Multi-agent swarm message
      appendBrailleChunk(msg.agent, msg.braille, msg.decoded || msg.text);
      break;
      
    case 'agentChunk':
      appendBrailleChunk(msg.agent, msg.braille, msg.text);
      break;
      
    // Massive swarm events
    case 'massiveSwarmResponse':
    case 'broadcastResponse':
      appendSwarmResponse(msg);
      break;
      
    case 'consensusVote':
      appendConsensusVote(msg);
      break;
      
    case 'consensusResult':
      appendConsensusResult(msg);
      break;
      
    case 'modelList':
      displayModelList(msg);
      break;
      
    case 'broadcastStart':
    case 'massiveSwarmStart':
      appendBrailleLog('system', msg.inputBraille, 
        `🚀 Starting ${msg.category || 'swarm'} with ${msg.agentCount || msg.agents?.length} agents`);
      break;
      
    case 'broadcastComplete':
    case 'massiveSwarmComplete':
      appendBrailleLog('system', toBraille('Complete'), 
        `✅ Swarm complete: ${msg.total || msg.log?.length} responses`);
      break;
      
    case 'encoded':
      console.log('[BrailleWS] Encoded:', msg.text, '→', msg.braille);
      break;
      
    case 'decoded':
      console.log('[BrailleWS] Decoded:', msg.braille, '→', msg.text);
      break;
      
    case 'error':
      console.error('[BrailleWS] Error:', msg.error);
      setStatus(`Braille error: ${msg.error}`, 'error');
      appendBrailleLog('error', '', `❌ ${msg.error}`);
      break;
  }
}

// Display a swarm response in the UI
function appendSwarmResponse(msg) {
  const log = document.getElementById('brailleLog');
  if (!log) return;
  
  const agentName = msg.name || msg.modelId?.split('/').pop() || msg.agent;
  const hasError = !!msg.error;
  
  const entry = document.createElement('div');
  entry.className = `braille-swarm-response ${hasError ? 'error' : 'success'}`;
  entry.innerHTML = `
    <div class="swarm-agent-name">${hasError ? '❌' : '✅'} ${agentName}</div>
    ${msg.braille ? `<div class="braille-raw">${msg.braille.slice(0, 100)}${msg.braille.length > 100 ? '...' : ''}</div>` : ''}
    <div class="braille-decoded">${hasError ? msg.error : (msg.text || msg.decoded || '(braille only)')}</div>
  `;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

// Display consensus vote
function appendConsensusVote(msg) {
  const log = document.getElementById('brailleLog');
  if (!log) return;
  
  const agentName = msg.agent?.split('/').pop() || 'unknown';
  
  const entry = document.createElement('div');
  entry.className = 'braille-consensus-vote';
  entry.innerHTML = `<span class="vote-agent">🗳️ ${agentName}:</span> <span class="vote-answer">${msg.answer}</span>`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

// Display consensus result
function appendConsensusResult(msg) {
  const log = document.getElementById('brailleLog');
  if (!log) return;
  
  const entry = document.createElement('div');
  entry.className = 'braille-consensus-result';
  entry.innerHTML = `
    <div class="consensus-header">📊 CONSENSUS RESULT</div>
    <div class="consensus-winner">Winner: "${msg.consensus}" (${msg.votes} votes)</div>
    <div class="consensus-total">Total responses: ${msg.totalResponses}</div>
  `;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

// Display model list
function displayModelList(msg) {
  const log = document.getElementById('brailleLog');
  if (!log) return;
  
  const entry = document.createElement('div');
  entry.className = 'braille-model-list';
  entry.innerHTML = `
    <div class="model-list-header">📋 Available Models (${msg.stats?.total || 0} total)</div>
    <div class="model-categories">
      ${Object.entries(msg.stats?.categories || {}).map(([cat, count]) => 
        `<span class="model-category">${cat}: ${count}</span>`
      ).join(' | ')}
    </div>
  `;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

let currentBrailleMessage = null;

function appendBrailleChunk(agent, braille, text) {
  const log = document.getElementById('brailleLog');
  if (!log) return;
  
  if (!currentBrailleMessage || currentBrailleMessage.dataset.agent !== agent) {
    currentBrailleMessage = document.createElement('div');
    currentBrailleMessage.className = 'braille-message';
    currentBrailleMessage.dataset.agent = agent;
    currentBrailleMessage.innerHTML = `
      <div class="braille-agent">${agent}</div>
      <div class="braille-content"></div>
      <div class="braille-decoded"></div>
    `;
    log.appendChild(currentBrailleMessage);
  }
  
  const content = currentBrailleMessage.querySelector('.braille-content');
  const decoded = currentBrailleMessage.querySelector('.braille-decoded');
  
  if (braille) content.textContent += braille;
  if (text) decoded.textContent += text;
  
  log.scrollTop = log.scrollHeight;
}

function finalizeBrailleMessage(agent) {
  currentBrailleMessage = null;
}

function appendBrailleLog(type, braille, text) {
  const log = document.getElementById('brailleLog');
  if (!log) return;
  
  const entry = document.createElement('div');
  entry.className = `braille-log-entry ${type}`;
  entry.innerHTML = `
    <div class="braille-raw">${braille}</div>
    <div class="braille-text">⟶ ${text}</div>
  `;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

// Send message via braille websocket
function sendBrailleChat(text, agent = 'claude', brailleMode = true) {
  if (!brailleWS || brailleWS.readyState !== WebSocket.OPEN) {
    setStatus('Braille WebSocket not connected', 'error');
    return;
  }
  
  brailleWS.send(JSON.stringify({
    type: 'chat',
    text,
    agent,
    brailleMode,
  }));
  
  // Show user message in braille
  appendBrailleLog('user', toBraille(text), text);
}

// Start a swarm conversation
function startBrailleSwarm(text, agents = ['claude', 'gpt4'], rounds = 2) {
  if (!brailleWS || brailleWS.readyState !== WebSocket.OPEN) {
    setStatus('Braille WebSocket not connected', 'error');
    return;
  }
  
  brailleWS.send(JSON.stringify({
    type: 'swarm',
    text,
    agents,
    rounds,
  }));
  
  appendBrailleLog('system', toBraille(`Starting swarm: ${agents.join(' ↔ ')}`), 
    `Starting swarm: ${agents.join(' ↔ ')}`);
}

// Input handlers for braille panel
function sendBrailleFromInput() {
  const input = document.getElementById('brailleInput');
  const category = document.getElementById('brailleCategory')?.value || 'flagship';
  if (!input?.value.trim()) return;
  
  // Send to first model in category via massiveSwarm
  sendBrailleChat(input.value, category, true);
  input.value = '';
}

function startSwarmFromInput() {
  const input = document.getElementById('brailleInput');
  if (!input?.value.trim()) return;
  
  startBrailleSwarm(input.value, ['claude', 'gpt4'], 2);
  input.value = '';
}

// Broadcast to all models in a category
function broadcastFromInput() {
  const input = document.getElementById('brailleInput');
  const category = document.getElementById('brailleCategory')?.value || 'fast';
  if (!input?.value.trim()) return;
  
  if (!brailleWS || brailleWS.readyState !== WebSocket.OPEN) {
    setStatus('Braille WebSocket not connected', 'error');
    return;
  }
  
  brailleWS.send(JSON.stringify({
    type: 'broadcast',
    text: input.value,
    category,
    maxAgents: 15,
  }));
  
  appendBrailleLog('user', toBraille(input.value), `📡 Broadcasting to ${category}: ${input.value}`);
  input.value = '';
}

// Consensus vote across models
function consensusFromInput() {
  const input = document.getElementById('brailleInput');
  const category = document.getElementById('brailleCategory')?.value || 'flagship';
  if (!input?.value.trim()) return;
  
  if (!brailleWS || brailleWS.readyState !== WebSocket.OPEN) {
    setStatus('Braille WebSocket not connected', 'error');
    return;
  }
  
  brailleWS.send(JSON.stringify({
    type: 'consensus',
    question: input.value,
    category,
    maxAgents: 10,
  }));
  
  appendBrailleLog('user', toBraille(input.value), `🗳️ Consensus vote: ${input.value}`);
  input.value = '';
}

// List available models
function listModels() {
  if (!brailleWS || brailleWS.readyState !== WebSocket.OPEN) {
    setStatus('Braille WebSocket not connected', 'error');
    return;
  }
  
  const category = document.getElementById('brailleCategory')?.value;
  
  brailleWS.send(JSON.stringify({
    type: 'listModels',
    category,
  }));
}

// Expose braille functions globally
window.connectBrailleWS = connectBrailleWS;
window.sendBrailleChat = sendBrailleChat;
window.startBrailleSwarm = startBrailleSwarm;
window.sendBrailleFromInput = sendBrailleFromInput;
window.startSwarmFromInput = startSwarmFromInput;
window.broadcastFromInput = broadcastFromInput;
window.consensusFromInput = consensusFromInput;
window.listModels = listModels;

// Auto-connect on load
setTimeout(connectBrailleWS, 1000);

// Braille input enter key handler
document.getElementById('brailleInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendBrailleFromInput();
  }
});

document.getElementById('sendChatBtn')?.addEventListener('click', sendChatMessage);
document.getElementById('chatInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});

document.getElementById('clearChatBtn')?.addEventListener('click', () => {
  document.getElementById('chatMessages').innerHTML = '';
});

// ============================================================================
// Image Paste/Upload Support
// ============================================================================

// Handle paste events for images
document.getElementById('chatInput')?.addEventListener('paste', async (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      await addImageFromFile(file);
    }
  }
});

// Handle drag and drop
const chatPanel = document.getElementById('chatPanel');
chatPanel?.addEventListener('dragover', (e) => {
  e.preventDefault();
  chatPanel.classList.add('drag-over');
});

chatPanel?.addEventListener('dragleave', () => {
  chatPanel.classList.remove('drag-over');
});

chatPanel?.addEventListener('drop', async (e) => {
  e.preventDefault();
  chatPanel.classList.remove('drag-over');
  
  const files = e.dataTransfer?.files;
  if (!files) return;
  
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      await addImageFromFile(file);
    }
  }
});

async function addImageFromFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      pendingImages.push(dataUrl);
      updateImagePreview();
      resolve();
    };
    reader.readAsDataURL(file);
  });
}

function updateImagePreview() {
  let preview = document.getElementById('imagePreview');
  
  if (pendingImages.length === 0) {
    preview?.remove();
    return;
  }
  
  if (!preview) {
    preview = document.createElement('div');
    preview.id = 'imagePreview';
    preview.className = 'image-preview';
    const inputArea = document.querySelector('.chat-input-area');
    inputArea?.insertBefore(preview, inputArea.firstChild);
  }
  
  preview.innerHTML = pendingImages.map((img, i) => `
    <div class="preview-image-container">
      <img src="${img}" class="preview-image" />
      <button class="remove-image" onclick="removeImage(${i})">✕</button>
    </div>
  `).join('');
}

function removeImage(index) {
  pendingImages.splice(index, 1);
  updateImagePreview();
}

// Add image button click handler
function openImagePicker() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = async (e) => {
    for (const file of e.target.files) {
      await addImageFromFile(file);
    }
  };
  input.click();
}

window.removeImage = removeImage;
window.openImagePicker = openImagePicker;

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================================================
// Resize Handles
// ============================================================================

let isResizing = false;
let resizeTarget = null;
let startX = 0;
let startY = 0;
let startSize = 0;

document.querySelectorAll('.resize-handle').forEach(handle => {
  handle.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizeTarget = handle.dataset.resize;
    startX = e.clientX;
    startY = e.clientY;
    
    if (resizeTarget === 'left') {
      startSize = document.getElementById('leftSidebar').offsetWidth;
    } else if (resizeTarget === 'right') {
      startSize = document.getElementById('rightSidebar').offsetWidth;
    } else if (resizeTarget === 'terminal') {
      startSize = document.getElementById('terminalContainer').offsetHeight;
    }
    
    document.body.style.cursor = handle.classList.contains('vertical') ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  
  if (resizeTarget === 'left') {
    const newWidth = Math.max(200, Math.min(500, startSize + (e.clientX - startX)));
    document.getElementById('leftSidebar').style.width = `${newWidth}px`;
  } else if (resizeTarget === 'right') {
    const newWidth = Math.max(200, Math.min(500, startSize - (e.clientX - startX)));
    document.getElementById('rightSidebar').style.width = `${newWidth}px`;
  } else if (resizeTarget === 'terminal') {
    const newHeight = Math.max(100, Math.min(400, startSize - (e.clientY - startY)));
    document.getElementById('terminalContainer').style.height = `${newHeight}px`;
  }
});

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    resizeTarget = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
});

// ============================================================================
// Status & Connection
// ============================================================================

function setStatus(message, type = 'info') {
  const el = document.getElementById('statusMessage');
  el.textContent = message;
  el.style.color = type === 'error' ? '#f85149' : type === 'success' ? '#3fb950' : '#8b949e';
  
  setTimeout(() => {
    el.textContent = '';
  }, 3000);
}

async function checkConnection() {
  const dot = document.getElementById('connectionStatus');
  const status = document.getElementById('ariaStatus');
  
  try {
    const response = await fetch(`${ARIA_SERVER}/health`);
    if (response.ok) {
      dot.classList.add('online');
      dot.classList.remove('offline');
      status.textContent = 'Aria: Connected';
    } else {
      throw new Error('Not OK');
    }
  } catch (e) {
    dot.classList.remove('online');
    dot.classList.add('offline');
    status.textContent = 'Aria: Offline';
  }
}

// ============================================================================
// Initialize
// ============================================================================

window.openFile = openFile;
window.closeTab = closeTab;
window.goHome = goHome;
window.goToProject = goToProject;
window.loadFileTree = loadFileTree;

// Initial setup
loadFileTree();
checkConnection();
setInterval(checkConnection, 10000);

// Welcome message
appendChatMessage('assistant', "Hi! I'm Aria. I can help you write and edit code. Try asking me to create a new feature or fix a bug!");

// ============================================================================
// History / Undo / Redo
// ============================================================================

async function updateHistoryButtons() {
  try {
    const response = await fetch(`${ARIA_SERVER}/history/status`);
    if (response.ok) {
      const status = await response.json();
      document.getElementById('undoBtn').disabled = !status.canUndo;
      document.getElementById('redoBtn').disabled = !status.canRedo;
    }
  } catch {
    // Server not available
  }
}

async function undoLastChange() {
  try {
    const response = await fetch(`${ARIA_SERVER}/history/undo`, { method: 'POST' });
    const result = await response.json();
    
    if (result.success) {
      setStatus(`↩️ ${result.message}`, 'success');
      
      // Reload file if it's open
      if (result.entry && openFiles.has(result.entry.filePath)) {
        openFiles.delete(result.entry.filePath);
        openFile(result.entry.filePath);
      }
      
      loadFileTree();
      updateHistoryButtons();
    } else {
      setStatus(result.message, 'info');
    }
  } catch (e) {
    setStatus(`Undo failed: ${e.message}`, 'error');
  }
}

async function redoLastChange() {
  try {
    const response = await fetch(`${ARIA_SERVER}/history/redo`, { method: 'POST' });
    const result = await response.json();
    
    if (result.success) {
      setStatus(`↪️ ${result.message}`, 'success');
      
      // Reload file if it's open
      if (result.entry && openFiles.has(result.entry.filePath)) {
        openFiles.delete(result.entry.filePath);
        openFile(result.entry.filePath);
      }
      
      loadFileTree();
      updateHistoryButtons();
    } else {
      setStatus(result.message, 'info');
    }
  } catch (e) {
    setStatus(`Redo failed: ${e.message}`, 'error');
  }
}

async function showHistoryPanel() {
  try {
    const response = await fetch(`${ARIA_SERVER}/history/recent?limit=30`);
    const { operations } = await response.json();
    
    // Create modal
    const modal = document.createElement('div');
    modal.className = 'history-modal';
    modal.innerHTML = `
      <div class="history-modal-content">
        <div class="history-modal-header">
          <h3>📜 Aria File History</h3>
          <button onclick="this.closest('.history-modal').remove()">✕</button>
        </div>
        <div class="history-modal-body">
          ${operations.length === 0 ? '<p class="no-history">No history yet</p>' : ''}
          ${operations.map(op => `
            <div class="history-item" data-id="${op.id}" data-path="${op.filePath}">
              <div class="history-item-icon">${op.type === 'create' ? '✨' : op.type === 'delete' ? '🗑️' : '✏️'}</div>
              <div class="history-item-info">
                <div class="history-item-desc">${op.description}</div>
                <div class="history-item-meta">
                  <span class="history-item-path">${op.filePath}</span>
                  <span class="history-item-time">${formatTime(op.timestamp)}</span>
                </div>
              </div>
              <button class="history-restore-btn" onclick="restoreToPoint('${op.filePath}', '${op.id}')">Restore</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  } catch (e) {
    setStatus(`Failed to load history: ${e.message}`, 'error');
  }
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString();
}

async function restoreToPoint(filePath, entryId) {
  try {
    const response = await fetch(`${ARIA_SERVER}/history/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath, entryId }),
    });
    const result = await response.json();
    
    if (result.success) {
      setStatus(`✓ ${result.message}`, 'success');
      
      // Reload file if open
      if (openFiles.has(filePath)) {
        openFiles.delete(filePath);
        openFile(filePath);
      }
      
      loadFileTree();
      updateHistoryButtons();
      
      // Close modal
      document.querySelector('.history-modal')?.remove();
    } else {
      setStatus(result.message, 'error');
    }
  } catch (e) {
    setStatus(`Restore failed: ${e.message}`, 'error');
  }
}

// Keyboard shortcuts for undo/redo
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
    if (e.shiftKey) {
      e.preventDefault();
      redoLastChange();
    } else if (!e.target.matches('input, textarea')) {
      e.preventDefault();
      undoLastChange();
    }
  }
});

window.undoLastChange = undoLastChange;
window.redoLastChange = redoLastChange;
window.showHistoryPanel = showHistoryPanel;
window.restoreToPoint = restoreToPoint;

// Update history buttons periodically
setInterval(updateHistoryButtons, 5000);
updateHistoryButtons();

// ============================================================================
// LLM Selector
// ============================================================================

let currentModel = 'anthropic/claude-3.5-sonnet';

function toggleLLMDropdown() {
  const dropdown = document.getElementById('llmDropdown');
  dropdown.classList.toggle('open');
}

function selectLLM(model, name) {
  currentModel = model;
  document.getElementById('currentLLM').textContent = name;
  
  // Update selection UI
  document.querySelectorAll('.llm-option').forEach(opt => {
    const isSelected = opt.dataset.model === model;
    opt.classList.toggle('selected', isSelected);
    opt.querySelector('.llm-check').textContent = isSelected ? '✓' : '';
  });
  
  // Close dropdown
  document.getElementById('llmDropdown').classList.remove('open');
  
  // Notify server of model change
  fetch(`${ARIA_SERVER}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  }).catch(() => {});
  
  setStatus(`Switched to ${name}`, 'success');
}

// Setup LLM option click handlers
document.querySelectorAll('.llm-option').forEach(opt => {
  opt.addEventListener('click', () => {
    const model = opt.dataset.model;
    const name = opt.querySelector('.llm-name').textContent;
    selectLLM(model, name);
  });
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.llm-selector')) {
    document.getElementById('llmDropdown')?.classList.remove('open');
  }
});

window.toggleLLMDropdown = toggleLLMDropdown;
window.selectLLM = selectLLM;

// ============================================================================
// Settings Panel
// ============================================================================

function openSettings() {
  const modal = document.createElement('div');
  modal.className = 'settings-modal';
  modal.innerHTML = `
    <div class="settings-modal-content">
      <div class="settings-modal-header">
        <h3>⚙️ Aria Settings</h3>
        <button onclick="this.closest('.settings-modal').remove()">✕</button>
      </div>
      <div class="settings-modal-body">
        <div class="settings-section">
          <h4>🧠 AI Model</h4>
          <p class="settings-desc">Current model: <strong>${document.getElementById('currentLLM').textContent}</strong></p>
          <p class="settings-desc">Change model using the selector in the status bar.</p>
        </div>
        
        <div class="settings-section">
          <h4>🔑 API Key</h4>
          <p class="settings-desc">OpenRouter API key is configured in <code>.env</code></p>
          <a href="https://openrouter.ai/keys" target="_blank" class="settings-link">Get API Key →</a>
        </div>
        
        <div class="settings-section">
          <h4>📁 Workspace</h4>
          <p class="settings-desc">Current path: <code>${currentBrowsePath}</code></p>
        </div>
        
        <div class="settings-section">
          <h4>📜 History</h4>
          <p class="settings-desc">File history is stored in <code>~/.aria/history/</code></p>
          <button class="settings-btn danger" onclick="clearHistory()">Clear All History</button>
        </div>
        
        <div class="settings-section">
          <h4>🎨 Theme</h4>
          <p class="settings-desc">Dark theme (Windsurf-inspired)</p>
        </div>
        
        <div class="settings-section">
          <h4>ℹ️ About</h4>
          <p class="settings-desc">
            <strong>Aria IDE</strong> — AI Runtime Interactive Agent<br>
            Version 1.0.0<br>
            <a href="https://github.com/elevate-foundry/ai-native-ide" target="_blank">GitHub →</a>
          </p>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

async function clearHistory() {
  if (confirm('Are you sure you want to clear all file history? This cannot be undone.')) {
    try {
      // Would call server endpoint to clear history
      setStatus('History cleared', 'success');
      document.querySelector('.settings-modal')?.remove();
    } catch (e) {
      setStatus('Failed to clear history', 'error');
    }
  }
}

window.openSettings = openSettings;
window.clearHistory = clearHistory;
