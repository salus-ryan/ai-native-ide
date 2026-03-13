const {
  SensorSnapshot,
  RuntimeNativeIDE,
  PlaywrightInterfaceObserver,
} = require('./core');
const { createLLMClient, ariaAnalyze, ariaGeneratePlan, ARIA_SYSTEM_PROMPT, DEFAULT_CONFIG } = require('./llm.cjs');
const { AriaAgent, ARIA_AGENT_PROMPT } = require('./agent');
const { TOOL_DEFINITIONS, AriaTools } = require('./tools');
const { IntrospectTools, INTROSPECT_TOOLS, introspectArchitecture, introspectModule, introspectRuntime } = require('./introspect');

module.exports = {
  // Core loop engine
  SensorSnapshot,
  RuntimeNativeIDE,
  PlaywrightInterfaceObserver,
  // Agent
  AriaAgent,
  ARIA_AGENT_PROMPT,
  // LLM
  createLLMClient,
  ariaAnalyze,
  ariaGeneratePlan,
  ARIA_SYSTEM_PROMPT,
  DEFAULT_CONFIG,
  // Tools
  TOOL_DEFINITIONS,
  AriaTools,
  // Introspection (self-awareness)
  IntrospectTools,
  INTROSPECT_TOOLS,
  introspectArchitecture,
  introspectModule,
  introspectRuntime,
};
