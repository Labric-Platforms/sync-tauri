use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::time::{interval, MissedTickBehavior};
use tokio::task::JoinHandle;

// Heartbeat configuration constants
const HEARTBEAT_INTERVAL_SECS: u64 = 30;
const OFFLINE_STATUS: &str = "offline";

#[derive(Clone, Serialize, Deserialize)]
pub struct HeartbeatRequest {
    device_fingerprint: String,
    app_version: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct HeartbeatResponse {
    // Define based on your API response structure
    status: String,
    first_seen: String,
    last_seen: String,
    app_version: String,
    // Add other fields as needed
}

#[derive(Clone, Serialize, Deserialize)]
pub struct HeartbeatStatus {
    pub status: Option<HeartbeatResponse>,
    pub is_loading: bool,
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct HeartbeatConfig {
    pub url: String,
    pub token: String,
    pub device_fingerprint: String,
    pub app_version: String,
}

pub type HeartbeatState = Arc<Mutex<Option<HeartbeatConfig>>>;
pub type HeartbeatStatusState = Arc<Mutex<HeartbeatStatus>>;
pub type HeartbeatTaskState = Arc<Mutex<Option<JoinHandle<()>>>>;

/// Initialize heartbeat with configuration
pub async fn start_heartbeat(
    config: HeartbeatConfig,
    heartbeat_state: HeartbeatState,
    status_state: HeartbeatStatusState,
    task_state: HeartbeatTaskState,
    app_handle: AppHandle,
) -> Result<(), String> {
    // Stop any existing task first
    stop_heartbeat(heartbeat_state.clone(), status_state.clone(), task_state.clone()).await?;
    
    // Store the config
    {
        let mut state = heartbeat_state.lock().await;
        *state = Some(config.clone());
    }

    // Start the background heartbeat task
    let heartbeat_state_clone = heartbeat_state.clone();
    let status_state_clone = status_state.clone();
    let app_handle_clone = app_handle.clone();

    let task_handle = tokio::spawn(async move {
        let mut interval = interval(Duration::from_secs(HEARTBEAT_INTERVAL_SECS));
        interval.set_missed_tick_behavior(MissedTickBehavior::Skip);

        loop {
            // Check if we still have config (heartbeat not stopped)
            let config = {
                let state = heartbeat_state_clone.lock().await;
                state.clone()
            };

            if let Some(config) = config {
                match make_heartbeat_request(&config).await {
                    Ok(response) => {
                        let status = HeartbeatStatus {
                            status: Some(response.clone()),
                            is_loading: false,
                            error: None,
                        };
                        
                        // Update status
                        {
                            let mut state = status_state_clone.lock().await;
                            *state = status.clone();
                        }
                        
                        // Emit to frontend
                        let _ = app_handle_clone.emit("heartbeat_status", &status);
                        
                        log::info!("Heartbeat successful");
                    }
                    Err(e) => {
                        // Get previous status to preserve successful response data
                        let previous_response = {
                            let state = status_state_clone.lock().await;
                            state.status.clone()
                        };
                        
                        // Create failed status, preserving previous response if it exists
                        let failed_response = if let Some(mut prev_response) = previous_response {
                            // Keep previous data but update status to indicate failure
                            prev_response.status = OFFLINE_STATUS.to_string();
                            Some(prev_response)
                        } else {
                            None
                        };
                        
                        let status = HeartbeatStatus {
                            status: failed_response,
                            is_loading: false,
                            error: Some(e.clone()),
                        };
                        
                        // Update status
                        {
                            let mut state = status_state_clone.lock().await;
                            *state = status.clone();
                        }
                        
                        // Emit to frontend
                        let _ = app_handle_clone.emit("heartbeat_status", &status);
                        
                        log::error!("Heartbeat failed: {}", e);
                    }
                }
            } else {
                // No config, heartbeat was stopped
                break;
            }

            interval.tick().await;
        }
    });

    // Store the task handle so we can cancel it later
    {
        let mut task = task_state.lock().await;
        *task = Some(task_handle);
    }

    Ok(())
}

/// Stop heartbeat by clearing the config
pub async fn stop_heartbeat(
    heartbeat_state: HeartbeatState,
    status_state: HeartbeatStatusState,
    task_state: HeartbeatTaskState,
) -> Result<(), String> {
    // Cancel existing task if any
    {
        let mut task = task_state.lock().await;
        if let Some(handle) = task.take() {
            handle.abort();
            log::info!("Previous heartbeat task cancelled");
        }
    }
    
    {
        let mut state = heartbeat_state.lock().await;
        *state = None;
    }
    
    // Clear status
    {
        let mut status = status_state.lock().await;
        *status = HeartbeatStatus {
            status: None,
            is_loading: false,
            error: None,
        };
    }
    
    log::info!("Heartbeat stopped");
    Ok(())
}

/// Make a single heartbeat request
async fn make_heartbeat_request(config: &HeartbeatConfig) -> Result<HeartbeatResponse, String> {
    let client = Client::new();
    
    let request_body = HeartbeatRequest {
        device_fingerprint: config.device_fingerprint.clone(),
        app_version: config.app_version.clone(),
    };

    log::info!("Making heartbeat request to: {}", config.url);
    
    let response = client
        .post(&config.url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", config.token))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("HTTP {}: {}", status, error_text));
    }

    let result: HeartbeatResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(result)
}

/// Get current heartbeat status
pub async fn get_heartbeat_status(status_state: HeartbeatStatusState) -> HeartbeatStatus {
    let state = status_state.lock().await;
    state.clone()
}

/// Update heartbeat config (will restart with new config)
pub async fn update_heartbeat_config(
    new_config: HeartbeatConfig,
    heartbeat_state: HeartbeatState,
    status_state: HeartbeatStatusState,
    task_state: HeartbeatTaskState,
    app_handle: AppHandle,
) -> Result<(), String> {
    // Stop current heartbeat
    stop_heartbeat(heartbeat_state.clone(), status_state.clone(), task_state.clone()).await?;
    
    // Start with new config
    start_heartbeat(new_config, heartbeat_state, status_state, task_state, app_handle).await
}
