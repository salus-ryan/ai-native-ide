#!/usr/bin/env node
/**
 * Aria HTTP Server - Backend API for the frontend chat interface
 * 
 * Exposes Aria's agent capabilities via HTTP endpoints with streaming support.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createRequire } from 'module';
import { config } from 'dotenv';
import os from 'os';

config();

const execAsync = promisify(exec);
const require = createRequire(import.meta.url);
const { AriaAgent } = require('../src/agent.js');
const { fileHistory } = require('../src/file-history.js');
const fileTracker = require('../src/file-tracker.js');
const { BrailleWebSocketServer, toBraille, fromBraille } = require('../src/braille-websocket.js');

const PROJECT_ROOT = process.cwd();
const HOME_DIR = os.homedir();
const DESKTOP_DIR = path.join(PROJECT_ROOT, 'desktop');

// MIME types for serving the IDE frontend
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

// Directories to skip when indexing
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', '__pycache__', '.pytest_cache',
  '.venv', 'venv', 'env', '.env', 'dist', 'build', 'target', '.next',
  '.nuxt', '.output', 'coverage', '.nyc_output', '.cache', '.parcel-cache',
  'vendor', 'Pods', '.gradle', '.idea', '.vscode', '.DS_Store',
  'Library', 'Applications', '.Trash', '.npm', '.yarn', '.pnpm-store',
]);

// File extensions to index
const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.jsonc',
  '.py', '.pyw', '.pyi', '.ipynb',
  '.rs', '.go', '.rb', '.php', '.java', '.kt', '.scala', '.clj',
  '.c', '.cpp', '.cc', '.h', '.hpp', '.cs', '.swift', '.m', '.mm',
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.vue', '.svelte',
  '.md', '.mdx', '.txt', '.rst', '.adoc',
  '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.sql', '.graphql', '.gql', '.prisma',
  '.xml', '.svg', '.wasm',
  '.dockerfile', '.containerfile', '.tf', '.hcl',
]);

const PORT = process.env.ARIA_PORT || 3200;

// Create a single agent instance
const agent = new AriaAgent({
  workingDirectory: process.cwd(),
});

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ============================================================================
// File System Utilities
// ============================================================================

function shouldSkipDir(name) {
  return SKIP_DIRS.has(name) || name.startsWith('.');
}

function isCodeFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return CODE_EXTENSIONS.has(ext) || filename === 'Dockerfile' || filename === 'Makefile';
}

function getFileStats(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return {
      size: stats.size,
      modified: stats.mtime.toISOString(),
      created: stats.birthtime.toISOString(),
    };
  } catch {
    return null;
  }
}

// Recursively walk directory tree
function walkDir(dir, options = {}) {
  const { maxDepth = 10, currentDepth = 0, maxFiles = 5000 } = options;
  const results = [];
  
  if (currentDepth > maxDepth || results.length >= maxFiles) {
    return results;
  }
  
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const item of items) {
      if (results.length >= maxFiles) break;
      
      const fullPath = path.join(dir, item.name);
      
      if (item.isDirectory()) {
        if (!shouldSkipDir(item.name)) {
          results.push({
            name: item.name,
            path: fullPath,
            type: 'directory',
          });
          
          // Recurse into subdirectory
          const children = walkDir(fullPath, {
            maxDepth,
            currentDepth: currentDepth + 1,
            maxFiles: maxFiles - results.length,
          });
          results.push(...children);
        }
      } else if (item.isFile()) {
        const stats = getFileStats(fullPath);
        results.push({
          name: item.name,
          path: fullPath,
          type: 'file',
          extension: path.extname(item.name),
          ...stats,
        });
      }
    }
  } catch (e) {
    // Permission denied or other error - skip this directory
  }
  
  return results;
}

// Search for files by name pattern
function searchFiles(rootDir, pattern, options = {}) {
  const { maxResults = 100, caseSensitive = false } = options;
  const results = [];
  const regex = new RegExp(pattern, caseSensitive ? '' : 'i');
  
  function search(dir, depth = 0) {
    if (depth > 10 || results.length >= maxResults) return;
    
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const item of items) {
        if (results.length >= maxResults) break;
        
        const fullPath = path.join(dir, item.name);
        
        if (item.isDirectory()) {
          if (!shouldSkipDir(item.name)) {
            if (regex.test(item.name)) {
              results.push({ name: item.name, path: fullPath, type: 'directory' });
            }
            search(fullPath, depth + 1);
          }
        } else if (item.isFile()) {
          if (regex.test(item.name)) {
            results.push({
              name: item.name,
              path: fullPath,
              type: 'file',
              extension: path.extname(item.name),
            });
          }
        }
      }
    } catch (e) {
      // Skip directories we can't read
    }
  }
  
  search(rootDir);
  return results;
}

// Search file contents with grep-like functionality
async function searchContent(rootDir, query, options = {}) {
  const { maxResults = 50, caseSensitive = false, filePattern = null } = options;
  const results = [];
  
  // Try grep first (more universally available than ripgrep)
  try {
    const grepFlags = caseSensitive ? '-rn' : '-rin';
    const includeFlag = filePattern ? `--include="${filePattern}"` : '';
    const cmd = `grep ${grepFlags} ${includeFlag} -l "${query}" . 2>/dev/null | head -${maxResults}`;
    
    const { stdout } = await execAsync(cmd, { cwd: rootDir, timeout: 10000 });
    const files = stdout.trim().split('\n').filter(Boolean);
    
    for (const file of files.slice(0, maxResults)) {
      try {
        const matchCmd = `grep ${grepFlags} -m 3 "${query}" "${file}" 2>/dev/null`;
        const { stdout: matches } = await execAsync(matchCmd, { cwd: rootDir, timeout: 5000 });
        
        results.push({
          file: file.replace(/^\.\//, ''),
          matches: matches.trim().split('\n').slice(0, 3).map(line => {
            const colonIdx = line.indexOf(':');
            if (colonIdx > 0) {
              const lineNum = parseInt(line.slice(0, colonIdx));
              return { line: lineNum, content: line.slice(colonIdx + 1).slice(0, 200) };
            }
            return { line: 0, content: line.slice(0, 200) };
          }),
        });
      } catch {
        results.push({ file: file.replace(/^\.\//, ''), matches: [] });
      }
    }
    
    if (results.length > 0) return results;
  } catch {
    // grep failed - fall back to manual search
  }
  
  // Manual search fallback
  const files = walkDir(rootDir, { maxDepth: 5, maxFiles: 500 })
    .filter(f => f.type === 'file' && isCodeFile(f.name));
  
  for (const file of files) {
    if (results.length >= maxResults) break;
    
    try {
      const content = fs.readFileSync(file.path, 'utf-8');
      const lines = content.split('\n');
      const matches = [];
      
      const searchRegex = new RegExp(query, caseSensitive ? 'g' : 'gi');
      
      for (let i = 0; i < lines.length && matches.length < 3; i++) {
        if (searchRegex.test(lines[i])) {
          matches.push({ line: i + 1, content: lines[i].slice(0, 200) });
        }
      }
      
      if (matches.length > 0) {
        results.push({
          file: path.relative(rootDir, file.path),
          matches,
        });
      }
    } catch {
      // Skip files we can't read
    }
  }
  
  return results;
}

// Get recent files (sorted by modification time)
function getRecentFiles(rootDir, options = {}) {
  const { limit = 20, extensions = null } = options;
  
  const files = walkDir(rootDir, { maxDepth: 5, maxFiles: 1000 })
    .filter(f => {
      if (f.type !== 'file') return false;
      if (extensions && !extensions.includes(path.extname(f.name))) return false;
      return isCodeFile(f.name);
    })
    .sort((a, b) => new Date(b.modified) - new Date(a.modified))
    .slice(0, limit);
  
  return files;
}

// Get workspace summary
function getWorkspaceSummary(rootDir) {
  const files = walkDir(rootDir, { maxDepth: 6, maxFiles: 2000 });
  
  const summary = {
    root: rootDir,
    totalFiles: 0,
    totalDirectories: 0,
    byExtension: {},
    topDirectories: [],
  };
  
  const dirCounts = {};
  
  for (const item of files) {
    if (item.type === 'file') {
      summary.totalFiles++;
      const ext = item.extension || '(no extension)';
      summary.byExtension[ext] = (summary.byExtension[ext] || 0) + 1;
    } else {
      summary.totalDirectories++;
      const parent = path.dirname(item.path);
      dirCounts[parent] = (dirCounts[parent] || 0) + 1;
    }
  }
  
  // Sort extensions by count
  summary.byExtension = Object.fromEntries(
    Object.entries(summary.byExtension)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
  );
  
  return summary;
}

const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', agent: 'aria' }));
    return;
  }

  // Get context stats
  if (req.method === 'GET' && req.url === '/stats') {
    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(agent.getContextStats()));
    return;
  }

  // Clear history
  if (req.method === 'POST' && req.url === '/clear') {
    agent.clearHistory();
    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // Chat endpoint (streaming)
  if (req.method === 'POST' && req.url === '/chat') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { message, images } = JSON.parse(body);
        
        if (!message && (!images || images.length === 0)) {
          res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'message or images required' }));
          return;
        }

        // Set up SSE for streaming
        res.writeHead(200, {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        // Override agent callbacks for this request
        const originalOnChunk = agent.onChunk;
        const originalOnToolCall = agent.onToolCall;
        const originalOnToolResult = agent.onToolResult;
        const originalOnCompaction = agent.onCompaction;

        agent.onChunk = (chunk) => {
          res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
        };

        agent.onToolCall = (tool) => {
          res.write(`data: ${JSON.stringify({ type: 'tool_call', name: tool.name, arguments: tool.arguments })}\n\n`);
        };

        agent.onToolResult = (name, result) => {
          res.write(`data: ${JSON.stringify({ type: 'tool_result', name, success: result.success, preview: JSON.stringify(result).slice(0, 200) })}\n\n`);
        };

        agent.onCompaction = (stats) => {
          res.write(`data: ${JSON.stringify({ type: 'compaction', ...stats })}\n\n`);
        };

        try {
          // Pass images to the agent if present
          const response = await agent.chatStream(message, { images });
          res.write(`data: ${JSON.stringify({ type: 'done', content: response })}\n\n`);
        } catch (error) {
          res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
        }

        // Restore original callbacks
        agent.onChunk = originalOnChunk;
        agent.onToolCall = originalOnToolCall;
        agent.onToolResult = originalOnToolResult;
        agent.onCompaction = originalOnCompaction;

        res.end();
      } catch (error) {
        res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  // Search files by name
  if (req.method === 'GET' && req.url.startsWith('/search/files')) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const query = url.searchParams.get('q') || '';
    const rootDir = url.searchParams.get('root') || PROJECT_ROOT;
    const maxResults = parseInt(url.searchParams.get('limit')) || 100;
    
    try {
      const results = searchFiles(rootDir, query, { maxResults });
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ query, results, count: results.length }));
    } catch (e) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Search file contents (grep-like)
  if (req.method === 'GET' && req.url.startsWith('/search/content')) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const query = url.searchParams.get('q') || '';
    const rootDir = url.searchParams.get('root') || PROJECT_ROOT;
    const maxResults = parseInt(url.searchParams.get('limit')) || 50;
    const filePattern = url.searchParams.get('pattern') || null;
    
    try {
      const results = await searchContent(rootDir, query, { maxResults, filePattern });
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ query, results, count: results.length }));
    } catch (e) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Get recent files
  if (req.method === 'GET' && req.url.startsWith('/recent')) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const rootDir = url.searchParams.get('root') || PROJECT_ROOT;
    const limit = parseInt(url.searchParams.get('limit')) || 20;
    
    try {
      const files = getRecentFiles(rootDir, { limit });
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ files, count: files.length }));
    } catch (e) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Get workspace summary
  if (req.method === 'GET' && req.url.startsWith('/workspace')) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const rootDir = url.searchParams.get('root') || PROJECT_ROOT;
    
    try {
      const summary = getWorkspaceSummary(rootDir);
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(summary));
    } catch (e) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Walk entire directory tree
  if (req.method === 'GET' && req.url.startsWith('/tree')) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const rootDir = url.searchParams.get('root') || PROJECT_ROOT;
    const maxDepth = parseInt(url.searchParams.get('depth')) || 5;
    const maxFiles = parseInt(url.searchParams.get('limit')) || 1000;
    
    try {
      const files = walkDir(rootDir, { maxDepth, maxFiles });
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ root: rootDir, files, count: files.length }));
    } catch (e) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Browse any directory (including home)
  if (req.method === 'GET' && req.url.startsWith('/browse')) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let dirPath = url.searchParams.get('path') || HOME_DIR;
    
    // Expand ~ to home directory
    if (dirPath.startsWith('~')) {
      dirPath = dirPath.replace('~', HOME_DIR);
    }
    
    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      const files = items
        .filter(item => !item.name.startsWith('.') || url.searchParams.get('hidden') === 'true')
        .map(item => ({
          name: item.name,
          path: path.join(dirPath, item.name),
          type: item.isDirectory() ? 'directory' : 'file',
          extension: item.isFile() ? path.extname(item.name) : null,
        }))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        path: dirPath, 
        parent: path.dirname(dirPath),
        files, 
        count: files.length,
      }));
    } catch (e) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // List files in directory
  if (req.method === 'GET' && req.url.startsWith('/files')) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const dirPath = url.searchParams.get('path') || PROJECT_ROOT;
    
    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      const files = items
        .filter(item => !item.name.startsWith('.') && item.name !== 'node_modules')
        .map(item => ({
          name: item.name,
          type: item.isDirectory() ? 'folder' : 'file',
          path: path.join(dirPath, item.name),
        }))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      
      // Recursively get children for folders (1 level deep)
      for (const file of files) {
        if (file.type === 'folder') {
          try {
            const children = fs.readdirSync(file.path, { withFileTypes: true });
            file.children = children
              .filter(item => !item.name.startsWith('.') && item.name !== 'node_modules')
              .map(item => ({
                name: item.name,
                type: item.isDirectory() ? 'folder' : 'file',
                path: path.join(file.path, item.name),
              }))
              .sort((a, b) => {
                if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
                return a.name.localeCompare(b.name);
              });
          } catch (e) {
            file.children = [];
          }
        }
      }
      
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(files));
    } catch (e) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Read file
  if (req.method === 'GET' && req.url.startsWith('/file')) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let filePath = url.searchParams.get('path');
    
    // Resolve relative paths
    if (filePath && !path.isAbsolute(filePath)) {
      filePath = path.join(PROJECT_ROOT, filePath);
    }
    
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'text/plain' });
      res.end(content);
    } catch (e) {
      res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Write file (with history tracking)
  if (req.method === 'POST' && req.url === '/file') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { path: filePath, content, description } = JSON.parse(body);
        
        let fullPath = filePath;
        if (!path.isAbsolute(filePath)) {
          fullPath = path.join(PROJECT_ROOT, filePath);
        }
        
        // Get old content for history
        let oldContent = null;
        const isNew = !fs.existsSync(fullPath);
        if (!isNew) {
          try {
            oldContent = fs.readFileSync(fullPath, 'utf-8');
          } catch {}
        }
        
        // Ensure directory exists
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        // Write file
        fs.writeFileSync(fullPath, content, 'utf-8');
        
        // Record in history
        let historyEntry;
        if (isNew) {
          historyEntry = fileHistory.recordCreate(fullPath, content, description);
        } else {
          historyEntry = fileHistory.recordEdit(fullPath, oldContent, content, description);
        }
        
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, path: fullPath, history: historyEntry }));
      } catch (e) {
        res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Execute command
  if (req.method === 'POST' && req.url === '/exec') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { command, cwd } = JSON.parse(body);
        const workDir = cwd || PROJECT_ROOT;
        
        const { stdout, stderr } = await execAsync(command, { 
          cwd: workDir,
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        });
        
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ stdout, stderr, success: true }));
      } catch (e) {
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          stdout: e.stdout || '', 
          stderr: e.stderr || e.message,
          success: false,
          code: e.code,
        }));
      }
    });
    return;
  }

  // ============================================================================
  // History API
  // ============================================================================

  // Get file timeline/history
  if (req.method === 'GET' && req.url.startsWith('/history/file')) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const filePath = url.searchParams.get('path');
    const limit = parseInt(url.searchParams.get('limit')) || 20;
    
    try {
      const timeline = fileHistory.getTimeline(filePath, limit);
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ filePath, timeline }));
    } catch (e) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Get recent operations across all files
  if (req.method === 'GET' && req.url.startsWith('/history/recent')) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const limit = parseInt(url.searchParams.get('limit')) || 20;
    
    try {
      const operations = fileHistory.getRecentOperations(limit);
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ operations }));
    } catch (e) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Get undo/redo status
  if (req.method === 'GET' && req.url === '/history/status') {
    try {
      const status = fileHistory.getStatus();
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
    } catch (e) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Undo last operation
  if (req.method === 'POST' && req.url === '/history/undo') {
    try {
      const result = fileHistory.undo();
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Redo last undone operation
  if (req.method === 'POST' && req.url === '/history/redo') {
    try {
      const result = fileHistory.redo();
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Restore file to specific point
  if (req.method === 'POST' && req.url === '/history/restore') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { filePath, entryId } = JSON.parse(body);
        const result = fileHistory.restoreToPoint(filePath, entryId);
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ============================================================================
  // Introspection API
  // ============================================================================

  // Get architecture manifest
  if (req.method === 'GET' && req.url === '/introspect') {
    try {
      const { introspectArchitecture } = require('../src/introspect.js');
      const result = introspectArchitecture();
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Introspect specific module
  if (req.method === 'GET' && req.url.startsWith('/introspect/module')) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const moduleName = url.searchParams.get('name');
    
    try {
      const { introspectModule } = require('../src/introspect.js');
      const result = introspectModule(moduleName);
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Introspect runtime
  if (req.method === 'GET' && req.url === '/introspect/runtime') {
    try {
      const { introspectRuntime } = require('../src/introspect.js');
      const result = introspectRuntime();
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Introspect dependencies
  if (req.method === 'GET' && req.url === '/introspect/dependencies') {
    try {
      const { introspectDependencies } = require('../src/introspect.js');
      const result = introspectDependencies();
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ============================================================================
  // File Change Tracking
  // ============================================================================

  // Get file changes
  if (req.method === 'GET' && req.url === '/files/changes') {
    try {
      const changes = await fileTracker.getGitStatus();
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(Object.fromEntries(changes)));
    } catch (e) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Start watching a directory
  if (req.method === 'POST' && req.url === '/files/watch') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { path: watchPath } = JSON.parse(body);
        fileTracker.watchDirectory(watchPath);
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, path: watchPath }));
      } catch (e) {
        res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ============================================================================
  // Static File Server — IDE Frontend
  // ============================================================================

  // Serve the IDE frontend from desktop/ directory
  let reqPath = req.url.split('?')[0]; // strip query params
  if (reqPath === '/' || reqPath === '/ide') reqPath = '/ide.html';

  const filePath = path.join(DESKTOP_DIR, reqPath);
  // Security: don't serve files outside desktop/
  if (filePath.startsWith(DESKTOP_DIR)) {
    try {
      const data = fs.readFileSync(filePath);
      const ext = path.extname(filePath);
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
      return;
    } catch {
      // Fall through to 404
    }
  }

  // 404 for everything else
  res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// Start Braille WebSocket server
const BRAILLE_WS_PORT = parseInt(process.env.BRAILLE_WS_PORT || '3201');
const brailleWS = new BrailleWebSocketServer({ port: BRAILLE_WS_PORT });
brailleWS.start();

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════════╗');
  console.log('  ║              Aria IDE is running               ║');
  console.log('  ╚═══════════════════════════════════════════════╝');
  console.log('');
  console.log(`  🌐 IDE + API:     http://localhost:${PORT}`);
  console.log(`  ⠃⠗ Braille WS:   ws://localhost:${BRAILLE_WS_PORT}`);
  console.log(`  📁 Working dir:   ${PROJECT_ROOT}`);
  console.log('');
  console.log('  Open the URL above in your browser to start.');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});
