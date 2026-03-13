#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::State;

// ============================================================================
// Aria Server Process Manager
// ============================================================================

struct AriaServer(Mutex<Option<Child>>);

impl AriaServer {
    fn new() -> Self {
        Self(Mutex::new(None))
    }

    fn start(&self, project_root: &str) -> Result<u16, String> {
        let mut guard = self.0.lock().map_err(|e| e.to_string())?;

        // Already running
        if let Some(ref mut child) = *guard {
            match child.try_wait() {
                Ok(None) => return Ok(3200), // still alive
                _ => {} // exited, restart below
            }
        }

        let child = Command::new("node")
            .arg("scripts/aria-server.mjs")
            .current_dir(project_root)
            .spawn()
            .map_err(|e| format!("Failed to start aria-server: {}", e))?;

        *guard = Some(child);
        Ok(3200)
    }

    fn stop(&self) -> Result<(), String> {
        let mut guard = self.0.lock().map_err(|e| e.to_string())?;
        if let Some(ref mut child) = *guard {
            child.kill().ok();
            child.wait().ok();
        }
        *guard = None;
        Ok(())
    }
}

impl Drop for AriaServer {
    fn drop(&mut self) {
        self.stop().ok();
    }
}

// ============================================================================
// Tauri Commands
// ============================================================================

#[derive(Serialize)]
struct ServerStatus {
    running: bool,
    port: u16,
    url: String,
}

#[tauri::command]
fn start_aria_server(server: State<AriaServer>) -> Result<ServerStatus, String> {
    let project_root = std::env::current_dir()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();

    let port = server.start(&project_root)?;
    Ok(ServerStatus {
        running: true,
        port,
        url: format!("http://localhost:{}", port),
    })
}

#[tauri::command]
fn stop_aria_server(server: State<AriaServer>) -> Result<(), String> {
    server.stop()
}

#[derive(Serialize)]
struct HealthResponse {
    server_running: bool,
    api_reachable: bool,
}

#[tauri::command]
async fn check_health() -> Result<HealthResponse, String> {
    let reachable = reqwest::get("http://localhost:3200/health")
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false);

    Ok(HealthResponse {
        server_running: reachable,
        api_reachable: reachable,
    })
}

#[derive(Deserialize)]
struct ChatRequest {
    message: String,
}

#[derive(Serialize)]
struct AriaInfo {
    version: String,
    project_root: String,
    modules: Vec<String>,
}

#[tauri::command]
fn get_aria_info() -> Result<AriaInfo, String> {
    let project_root = std::env::current_dir()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();

    Ok(AriaInfo {
        version: "0.1.0".to_string(),
        project_root,
        modules: vec![
            "agent.js".to_string(),
            "tools.js".to_string(),
            "llm.cjs".to_string(),
            "braille.js".to_string(),
            "braille-swarm.js".to_string(),
            "braille-websocket.js".to_string(),
            "braided-llm.js".to_string(),
            "braille-harness.js".to_string(),
            "compaction.js".to_string(),
            "world-model.js".to_string(),
            "file-history.js".to_string(),
            "core.js".to_string(),
            "bbid.js".to_string(),
        ],
    })
}

// ============================================================================
// Main
// ============================================================================

fn main() {
    tauri::Builder::default()
        .manage(AriaServer::new())
        .invoke_handler(tauri::generate_handler![
            start_aria_server,
            stop_aria_server,
            check_health,
            get_aria_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
