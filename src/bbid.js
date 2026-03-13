/**
 * BBID Integration for Aria
 * Behavioral Biometrics Identity Detection
 * 
 * Captures device fingerprints, behavioral signals, and encodes them
 * using braille-based encoding for identity inference.
 */

// ============================================================================
// Device Fingerprinting
// ============================================================================

async function getDeviceFingerprint() {
  const fp = {
    // Screen
    screen: {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      colorDepth: screen.colorDepth,
      pixelRatio: window.devicePixelRatio || 1,
    },
    
    // Platform
    platform: navigator.platform,
    userAgent: navigator.userAgent,
    language: navigator.language,
    languages: navigator.languages?.join(',') || navigator.language,
    cookieEnabled: navigator.cookieEnabled,
    doNotTrack: navigator.doNotTrack,
    
    // Hardware
    hardwareConcurrency: navigator.hardwareConcurrency || 'unknown',
    deviceMemory: navigator.deviceMemory || 'unknown',
    maxTouchPoints: navigator.maxTouchPoints || 0,
    
    // Timezone
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezoneOffset: new Date().getTimezoneOffset(),
    
    // Canvas fingerprint
    canvas: await getCanvasFingerprint(),
    
    // WebGL fingerprint
    webgl: getWebGLFingerprint(),
    
    // Audio fingerprint
    audio: await getAudioFingerprint(),
    
    // Math timing (hardware-specific)
    mathTiming: getMathTiming(),
    
    // Fonts (basic detection)
    fonts: detectFonts(),
  };
  
  // Generate hash
  fp.hash = await hashObject(fp);
  
  return fp;
}

async function getCanvasFingerprint() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    
    // Draw text with specific styling
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('Aria BBID 🎭', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('Aria BBID 🎭', 4, 17);
    
    // Get data URL and hash it
    const dataUrl = canvas.toDataURL();
    return await sha256(dataUrl);
  } catch (e) {
    return 'canvas-not-supported';
  }
}

function getWebGLFingerprint() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    
    if (!gl) return { supported: false };
    
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    
    return {
      supported: true,
      vendor: gl.getParameter(gl.VENDOR),
      renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'unknown',
      version: gl.getParameter(gl.VERSION),
      shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxViewportDims: gl.getParameter(gl.MAX_VIEWPORT_DIMS)?.join('x') || 'unknown',
    };
  } catch (e) {
    return { supported: false, error: e.message };
  }
}

async function getAudioFingerprint() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return 'audio-not-supported';
    
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const analyser = context.createAnalyser();
    const gain = context.createGain();
    const scriptProcessor = context.createScriptProcessor(4096, 1, 1);
    
    gain.gain.value = 0; // Mute
    oscillator.type = 'triangle';
    oscillator.frequency.value = 10000;
    
    oscillator.connect(analyser);
    analyser.connect(scriptProcessor);
    scriptProcessor.connect(gain);
    gain.connect(context.destination);
    
    oscillator.start(0);
    
    // Get frequency data
    const frequencyData = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(frequencyData);
    
    oscillator.stop();
    await context.close();
    
    // Hash the frequency data
    const sum = frequencyData.reduce((a, b) => a + b, 0);
    return sum.toFixed(6);
  } catch (e) {
    return 'audio-error';
  }
}

function getMathTiming() {
  const iterations = 1000;
  const results = {};
  
  // Sin timing
  let start = performance.now();
  for (let i = 0; i < iterations; i++) Math.sin(i);
  results.sin = performance.now() - start;
  
  // Cos timing
  start = performance.now();
  for (let i = 0; i < iterations; i++) Math.cos(i);
  results.cos = performance.now() - start;
  
  // Tan timing
  start = performance.now();
  for (let i = 0; i < iterations; i++) Math.tan(i);
  results.tan = performance.now() - start;
  
  // Sqrt timing
  start = performance.now();
  for (let i = 0; i < iterations; i++) Math.sqrt(i);
  results.sqrt = performance.now() - start;
  
  // Log timing
  start = performance.now();
  for (let i = 1; i <= iterations; i++) Math.log(i);
  results.log = performance.now() - start;
  
  return results;
}

function detectFonts() {
  const testFonts = [
    'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Verdana',
    'Courier New', 'Comic Sans MS', 'Impact', 'Trebuchet MS',
    'Monaco', 'Menlo', 'SF Pro', 'Segoe UI', 'Roboto'
  ];
  
  const baseFonts = ['monospace', 'sans-serif', 'serif'];
  const testString = 'mmmmmmmmmmlli';
  const testSize = '72px';
  
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  const getWidth = (font) => {
    ctx.font = `${testSize} ${font}`;
    return ctx.measureText(testString).width;
  };
  
  const baseWidths = baseFonts.map(getWidth);
  
  return testFonts.filter(font => {
    return baseFonts.some((baseFont, i) => {
      ctx.font = `${testSize} '${font}', ${baseFont}`;
      return ctx.measureText(testString).width !== baseWidths[i];
    });
  });
}

// ============================================================================
// Behavioral Biometrics
// ============================================================================

class BehavioralTracker {
  constructor() {
    this.mouseMovements = [];
    this.keystrokes = [];
    this.scrollEvents = [];
    this.touchEvents = [];
    this.startTime = Date.now();
    this.isTracking = false;
  }
  
  start() {
    if (this.isTracking) return;
    this.isTracking = true;
    
    // Mouse tracking
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('click', this.handleClick);
    
    // Keyboard tracking
    document.addEventListener('keydown', this.handleKeyDown);
    document.addEventListener('keyup', this.handleKeyUp);
    
    // Scroll tracking
    document.addEventListener('scroll', this.handleScroll);
    window.addEventListener('wheel', this.handleWheel);
    
    // Touch tracking
    document.addEventListener('touchstart', this.handleTouch);
    document.addEventListener('touchmove', this.handleTouch);
    document.addEventListener('touchend', this.handleTouch);
  }
  
  stop() {
    this.isTracking = false;
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('click', this.handleClick);
    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('keyup', this.handleKeyUp);
    document.removeEventListener('scroll', this.handleScroll);
    window.removeEventListener('wheel', this.handleWheel);
    document.removeEventListener('touchstart', this.handleTouch);
    document.removeEventListener('touchmove', this.handleTouch);
    document.removeEventListener('touchend', this.handleTouch);
  }
  
  handleMouseMove = (e) => {
    this.mouseMovements.push({
      x: e.clientX,
      y: e.clientY,
      t: Date.now() - this.startTime,
    });
    // Keep last 1000 movements
    if (this.mouseMovements.length > 1000) {
      this.mouseMovements.shift();
    }
  };
  
  handleClick = (e) => {
    this.mouseMovements.push({
      x: e.clientX,
      y: e.clientY,
      t: Date.now() - this.startTime,
      click: true,
    });
  };
  
  handleKeyDown = (e) => {
    this.keystrokes.push({
      key: e.key.length === 1 ? 'char' : e.key, // Don't log actual characters
      t: Date.now() - this.startTime,
      type: 'down',
    });
  };
  
  handleKeyUp = (e) => {
    this.keystrokes.push({
      key: e.key.length === 1 ? 'char' : e.key,
      t: Date.now() - this.startTime,
      type: 'up',
    });
  };
  
  handleScroll = (e) => {
    this.scrollEvents.push({
      x: window.scrollX,
      y: window.scrollY,
      t: Date.now() - this.startTime,
    });
  };
  
  handleWheel = (e) => {
    this.scrollEvents.push({
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      t: Date.now() - this.startTime,
    });
  };
  
  handleTouch = (e) => {
    const touch = e.touches[0] || e.changedTouches[0];
    if (touch) {
      this.touchEvents.push({
        x: touch.clientX,
        y: touch.clientY,
        force: touch.force || 0,
        t: Date.now() - this.startTime,
        type: e.type,
      });
    }
  };
  
  getMetrics() {
    return {
      mouseMovements: this.mouseMovements.length,
      mouseVelocity: this.calculateMouseVelocity(),
      mouseEntropy: this.calculateMouseEntropy(),
      keystrokeRhythm: this.calculateKeystrokeRhythm(),
      scrollVelocity: this.calculateScrollVelocity(),
      touchPressure: this.calculateTouchPressure(),
      timeOnPage: (Date.now() - this.startTime) / 1000,
      interactionEntropy: this.calculateInteractionEntropy(),
    };
  }
  
  calculateMouseVelocity() {
    if (this.mouseMovements.length < 2) return 0;
    
    let totalVelocity = 0;
    for (let i = 1; i < this.mouseMovements.length; i++) {
      const prev = this.mouseMovements[i - 1];
      const curr = this.mouseMovements[i];
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const dt = curr.t - prev.t || 1;
      totalVelocity += Math.sqrt(dx * dx + dy * dy) / dt;
    }
    
    return totalVelocity / (this.mouseMovements.length - 1);
  }
  
  calculateMouseEntropy() {
    if (this.mouseMovements.length < 10) return 0;
    
    // Calculate direction changes
    let directionChanges = 0;
    for (let i = 2; i < this.mouseMovements.length; i++) {
      const prev = this.mouseMovements[i - 2];
      const mid = this.mouseMovements[i - 1];
      const curr = this.mouseMovements[i];
      
      const angle1 = Math.atan2(mid.y - prev.y, mid.x - prev.x);
      const angle2 = Math.atan2(curr.y - mid.y, curr.x - mid.x);
      
      if (Math.abs(angle2 - angle1) > 0.5) directionChanges++;
    }
    
    return directionChanges / this.mouseMovements.length;
  }
  
  calculateKeystrokeRhythm() {
    const downEvents = this.keystrokes.filter(k => k.type === 'down');
    if (downEvents.length < 2) return 'waiting...';
    
    const intervals = [];
    for (let i = 1; i < downEvents.length; i++) {
      intervals.push(downEvents[i].t - downEvents[i - 1].t);
    }
    
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum, i) => sum + Math.pow(i - avg, 2), 0) / intervals.length;
    
    return `${avg.toFixed(0)}ms ±${Math.sqrt(variance).toFixed(0)}`;
  }
  
  calculateScrollVelocity() {
    if (this.scrollEvents.length < 2) return 0;
    
    const recent = this.scrollEvents.slice(-10);
    let totalVelocity = 0;
    
    for (let i = 1; i < recent.length; i++) {
      const prev = recent[i - 1];
      const curr = recent[i];
      const dy = Math.abs((curr.deltaY || curr.y) - (prev.deltaY || prev.y));
      const dt = curr.t - prev.t || 1;
      totalVelocity += dy / dt;
    }
    
    return (totalVelocity / (recent.length - 1) * 1000).toFixed(0);
  }
  
  calculateTouchPressure() {
    if (this.touchEvents.length === 0) return 'n/a';
    
    const pressures = this.touchEvents.filter(t => t.force > 0).map(t => t.force);
    if (pressures.length === 0) return 'n/a';
    
    const avg = pressures.reduce((a, b) => a + b, 0) / pressures.length;
    return avg.toFixed(2);
  }
  
  calculateInteractionEntropy() {
    const totalEvents = this.mouseMovements.length + this.keystrokes.length + 
                       this.scrollEvents.length + this.touchEvents.length;
    if (totalEvents === 0) return 0;
    
    const proportions = [
      this.mouseMovements.length / totalEvents,
      this.keystrokes.length / totalEvents,
      this.scrollEvents.length / totalEvents,
      this.touchEvents.length / totalEvents,
    ].filter(p => p > 0);
    
    // Shannon entropy
    return -proportions.reduce((sum, p) => sum + p * Math.log2(p), 0).toFixed(2);
  }
}

// ============================================================================
// Braille Encoding (delegated to src/braille.js)
// ============================================================================

// bbid.js runs in browser context too, so we conditionally import
let _textToBraille;
try {
  _textToBraille = require('./braille').textToBraille;
} catch {
  // Browser context fallback — inline minimal implementation
  const BRAILLE_MAP = {
    '0': '⠚', '1': '⠁', '2': '⠃', '3': '⠉', '4': '⠙',
    '5': '⠑', '6': '⠋', '7': '⠛', '8': '⠓', '9': '⠊',
    'a': '⠁', 'b': '⠃', 'c': '⠉', 'd': '⠙', 'e': '⠑',
    'f': '⠋', 'g': '⠛', 'h': '⠓', 'i': '⠊', 'j': '⠚',
    'k': '⠅', 'l': '⠇', 'm': '⠍', 'n': '⠝', 'o': '⠕',
    'p': '⠏', 'q': '⠟', 'r': '⠗', 's': '⠎', 't': '⠞',
    'u': '⠥', 'v': '⠧', 'w': '⠺', 'x': '⠭', 'y': '⠽',
    'z': '⠵', ' ': '⠀', '-': '⠤', '.': '⠲', ',': '⠂',
  };
  _textToBraille = (text) => text.toLowerCase().split('').map(c => BRAILLE_MAP[c] || c).join('');
}

function encodeFingerprintAsBraille(hash) {
  return _textToBraille(hash.substring(0, 16));
}

// ============================================================================
// Utilities
// ============================================================================

async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashObject(obj) {
  return sha256(JSON.stringify(obj));
}

// ============================================================================
// Main BBID Class
// ============================================================================

class AriaBBID {
  constructor() {
    this.fingerprint = null;
    this.tracker = new BehavioralTracker();
    this.visitorId = null;
  }
  
  async initialize() {
    this.fingerprint = await getDeviceFingerprint();
    this.visitorId = this.fingerprint.hash.substring(0, 12);
    this.tracker.start();
    return this;
  }
  
  getVisitorId() {
    return this.visitorId;
  }
  
  getBrailleId() {
    return encodeFingerprintAsBraille(this.fingerprint?.hash || '');
  }
  
  getFingerprint() {
    return this.fingerprint;
  }
  
  getBehavioralMetrics() {
    return this.tracker.getMetrics();
  }
  
  getFullIdentity() {
    return {
      visitorId: this.visitorId,
      brailleId: this.getBrailleId(),
      fingerprint: this.fingerprint,
      behavioral: this.getBehavioralMetrics(),
      timestamp: new Date().toISOString(),
    };
  }
  
  stop() {
    this.tracker.stop();
  }
}

// Export for browser and Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AriaBBID, BehavioralTracker, getDeviceFingerprint, toBraille };
}

if (typeof window !== 'undefined') {
  window.AriaBBID = AriaBBID;
  window.BehavioralTracker = BehavioralTracker;
}
