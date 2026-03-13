const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

test('desktop IDE files exist', () => {
  assert.equal(fs.existsSync('desktop/ide.html'), true);
  assert.equal(fs.existsSync('desktop/ide.js'), true);
  assert.equal(fs.existsSync('desktop/ide.css'), true);
});

test('package scripts include tauri entrypoints', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(typeof pkg.scripts['tauri:web'], 'string');
  assert.equal(typeof pkg.scripts['tauri:dev'], 'string');
  assert.equal(typeof pkg.scripts['tauri:build'], 'string');
});

test('tauri config points to desktop frontend and dev url', () => {
  const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.equal(conf.build.devUrl, 'http://127.0.0.1:4173');
  assert.equal(conf.build.frontendDist, '../desktop');
});

test('rust backend declares tauri commands', () => {
  const rust = read('src-tauri/src/main.rs');
  assert.match(rust, /tauri::command/);
  assert.match(rust, /invoke_handler\(tauri::generate_handler!\[/);
});
