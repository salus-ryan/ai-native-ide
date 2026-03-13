const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  IntrospectTools,
  introspectArchitecture,
  introspectModule,
  introspectRuntime,
  introspectDependencies,
  introspectCapabilities,
} = require('../src/introspect');

test('ARCHITECTURE.json exists and is valid JSON', () => {
  assert.equal(fs.existsSync('ARCHITECTURE.json'), true);
  const content = JSON.parse(fs.readFileSync('ARCHITECTURE.json', 'utf-8'));
  assert.equal(content.name, 'aria-ide');
  assert.ok(content.identity);
  assert.ok(content.layers);
  assert.ok(content.modules);
});

test('introspectArchitecture returns identity and layers', () => {
  const result = introspectArchitecture();
  assert.equal(result.success, true);
  assert.equal(result.identity.name, 'Aria');
  assert.ok(result.layers.length > 0);
  assert.ok(result.moduleCount > 0);
  assert.ok(result.differentiators.length > 0);
});

test('introspectModule reads agent.js metadata and source', () => {
  const result = introspectModule('agent.js');
  assert.equal(result.success, true);
  assert.equal(result.path, 'src/agent.js');
  assert.equal(result.type, 'core');
  assert.ok(result.source.includes('class AriaAgent'));
  assert.ok(result.lineCount > 0);
});

test('introspectModule returns error for unknown module', () => {
  const result = introspectModule('nonexistent.js');
  assert.equal(result.success, false);
  assert.ok(result.available.length > 0);
});

test('introspectRuntime returns process info', () => {
  const result = introspectRuntime();
  assert.equal(result.success, true);
  assert.ok(result.process.pid > 0);
  assert.ok(result.process.nodeVersion.startsWith('v'));
  assert.equal(result.process.platform, process.platform);
  assert.ok(result.env.ariaPort);
});

test('introspectDependencies returns module graph', () => {
  const result = introspectDependencies();
  assert.equal(result.success, true);
  assert.ok(Object.keys(result.graph).length > 0);
  assert.ok(result.graph['src/agent.js'].includes('src/tools.js'));
});

test('introspectCapabilities lists tool categories', () => {
  const result = introspectCapabilities();
  assert.equal(result.success, true);
  assert.ok(result.totalTools > 0);
  assert.ok(result.toolCategories.introspection);
  assert.ok(result.toolCategories.filesystem);
});

test('IntrospectTools.execute dispatches correctly', () => {
  const tools = new IntrospectTools();
  
  const arch = tools.execute('introspect_architecture', {});
  assert.equal(arch.success, true);
  
  const mod = tools.execute('introspect_module', { module: 'braille.js' });
  assert.equal(mod.success, true);
  assert.ok(mod.source.includes('toBraille'));
  
  const unknown = tools.execute('introspect_unknown', {});
  assert.equal(unknown.success, false);
});

test('braille.js is listed in architecture manifest', () => {
  const result = introspectModule('braille.js');
  assert.equal(result.success, true);
  assert.equal(result.type, 'foundation');
  assert.ok(result.exports.includes('toBraille'));
  assert.ok(result.exports.includes('fromBraille'));
});
