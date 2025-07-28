use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::sync::Semaphore;
use tokio::time::sleep;

#[derive(Clone, Serialize, Deserialize)]
pub struct UploadConfig {
    pub enabled: bool,
    pub server_url: String,
    pub ignored_patterns: Vec<String>,
    pub upload_delay_ms: u64, // Delay before uploading to batch changes
    pub max_concurrent_uploads: usize, // Maximum number of concurrent uploads
}

impl Default for UploadConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            server_url: "https://platform.labric.co".to_string(),
            ignored_patterns: vec![
                "*.tmp".to_string(),
                "*.log".to_string(),
                ".git/**".to_string(),
                "node_modules/**".to_string(),
                ".DS_Store".to_string(),
            ],
            upload_delay_ms: 2000,     // 2 seconds delay 
            max_concurrent_uploads: 5, // Default to 5 concurrent uploads
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct UploadItem {
    pub path: String,
    pub relative_path: String,
    pub timestamp: u64,
    pub retry_count: u32,
}

#[derive(Serialize, Deserialize)]
struct PresignedUrlRequest {
    #[serde(rename = "fileName")]
    file_name: String,
    #[serde(rename = "contentType")]
    content_type: String,
}

#[derive(Serialize, Deserialize)]
struct PresignedUrlResponse {
    #[serde(rename = "uploadUrl")]
    upload_url: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct UploadProgress {
    pub total_queued: usize,
    pub total_uploaded: usize,
    pub total_failed: usize,
    pub current_uploading: Option<String>,
}

pub type UploadQueue = Arc<Mutex<VecDeque<UploadItem>>>;
pub type UploadConfigState = Arc<Mutex<UploadConfig>>;
pub type UploadProgressState = Arc<Mutex<UploadProgress>>;

// Helper function to check if a file should be ignored
pub fn should_ignore_file(file_path: &str, ignored_patterns: &[String]) -> bool {
    for pattern in ignored_patterns {
        if let Ok(glob_pattern) = glob::Pattern::new(pattern) {
            if glob_pattern.matches(file_path) {
                return true;
            }
        }
    }
    false
}

// Helper function to get content type from file path
fn get_content_type(file_path: &str) -> String {
    mime_guess::from_path(file_path)
        .first_or_octet_stream()
        .to_string()
}

// Helper function to get relative path
pub fn get_relative_path(absolute_path: &str, base_path: &str) -> String {
    if let Ok(abs) = std::path::Path::new(absolute_path).canonicalize() {
        if let Ok(base) = std::path::Path::new(base_path).canonicalize() {
            if let Ok(relative) = abs.strip_prefix(&base) {
                return relative.to_string_lossy().to_string();
            }
        }
    }

    // Fallback to simple string manipulation
    if absolute_path.starts_with(base_path) {
        let relative = absolute_path.trim_start_matches(base_path);
        return relative
            .trim_start_matches('/')
            .trim_start_matches('\\')
            .to_string();
    }

    absolute_path.to_string()
}

// Synchronous function to add file to upload queue (for file watcher callback)
pub fn add_to_upload_queue_sync(
    file_path: String,
    base_path: String,
    upload_queue: &UploadQueue,
    upload_config: &UploadConfigState,
) {
    let config = upload_config.lock().unwrap().clone();

    if !config.enabled {
        debug!("Upload is disabled, skipping file: {}", file_path);
        return;
    }

    let relative_path = get_relative_path(&file_path, &base_path);

    // Check if file should be ignored
    if should_ignore_file(&relative_path, &config.ignored_patterns) {
        debug!(
            "File '{}' matches ignore pattern, skipping upload",
            relative_path
        );
        return;
    }

    // Check if file exists and is not a directory
    match std::fs::metadata(&file_path) {
        Ok(metadata) => {
            if metadata.is_file() {
                let upload_item = UploadItem {
                    path: file_path.clone(),
                    relative_path: relative_path.clone(),
                    timestamp: SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap()
                        .as_secs(),
                    retry_count: 0,
                };

                let mut queue = upload_queue.lock().unwrap();
                let queue_len_before = queue.len();

                // Remove existing item with same path to avoid duplicates
                queue.retain(|item| item.path != upload_item.path);
                let was_duplicate = queue.len() < queue_len_before;

                queue.push_back(upload_item);

                if was_duplicate {
                    debug!(
                        "Updated existing queue item for file: {} (queue size: {})",
                        relative_path,
                        queue.len()
                    );
                } else {
                    info!(
                        "Added file to upload queue: {} (queue size: {})",
                        relative_path,
                        queue.len()
                    );
                }
            } else {
                debug!("Path '{}' is not a file, skipping upload", relative_path);
            }
        }
        Err(e) => {
            warn!("Failed to get metadata for file '{}': {}", relative_path, e);
        }
    }
}

// Async function to add file to upload queue (for manual triggers)
pub async fn add_to_upload_queue_async(
    file_path: String,
    base_path: String,
    upload_queue: &UploadQueue,
    upload_config: &UploadConfigState,
) {
    add_to_upload_queue_sync(file_path, base_path, upload_queue, upload_config);
}

// Function to upload a single file
async fn upload_file(
    upload_item: &UploadItem,
    config: &UploadConfig,
    app_handle: &AppHandle,
) -> Result<(), String> {
    info!(
        "Starting upload for file: {} (attempt: {})",
        upload_item.relative_path,
        upload_item.retry_count + 1
    );

    // Read file content
    let file_content = tokio::fs::read(&upload_item.path).await.map_err(|e| {
        let error_msg = format!("Failed to read file '{}': {}", upload_item.relative_path, e);
        error!("{}", error_msg);
        error_msg
    })?;

    let file_size = file_content.len();
    debug!(
        "Read {} bytes from file: {}",
        file_size, upload_item.relative_path
    );

    let content_type = get_content_type(&upload_item.path);
    debug!(
        "Detected content type '{}' for file: {}",
        content_type, upload_item.relative_path
    );

    // Get presigned URL
    let client = reqwest::Client::new();
    let presigned_request = PresignedUrlRequest {
        file_name: upload_item.relative_path.clone(),
        content_type: content_type.clone(),
    };

    let presigned_url = format!("{}/api/sync/get_presigned", config.server_url);
    debug!(
        "Requesting presigned URL from: {} for file: {}",
        presigned_url, upload_item.relative_path
    );

    let response = client
        .post(&presigned_url)
        .json(&presigned_request)
        .send()
        .await
        .map_err(|e| {
            let error_msg = format!(
                "Failed to get presigned URL for '{}' from '{}': {}",
                upload_item.relative_path, presigned_url, e
            );
            error!("{}", error_msg);
            error_msg
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let response_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unable to read response".to_string());
        let error_msg = format!(
            "Presigned URL request failed for '{}' with status {}: {}",
            upload_item.relative_path, status, response_text
        );
        error!("{}", error_msg);
        return Err(error_msg);
    }

    let presigned_response: PresignedUrlResponse = response.json().await.map_err(|e| {
        let error_msg = format!(
            "Failed to parse presigned URL response for '{}': {}",
            upload_item.relative_path, e
        );
        error!("{}", error_msg);
        error_msg
    })?;

    debug!(
        "Got presigned URL for file: {} (URL length: {})",
        upload_item.relative_path,
        presigned_response.upload_url.len()
    );

    // Upload file to presigned URL
    debug!(
        "Uploading {} bytes to presigned URL for file: {}",
        file_size, upload_item.relative_path
    );

    let upload_response = client
        .put(&presigned_response.upload_url)
        .header("Content-Type", content_type)
        .body(file_content)
        .send()
        .await
        .map_err(|e| {
            let error_msg = format!(
                "Failed to upload file '{}' to presigned URL: {}",
                upload_item.relative_path, e
            );
            error!("{}", error_msg);
            error_msg
        })?;

    if !upload_response.status().is_success() {
        let status = upload_response.status();
        let response_text = upload_response
            .text()
            .await
            .unwrap_or_else(|_| "Unable to read response".to_string());
        let error_msg = format!(
            "Upload failed for '{}' with status {}: {}",
            upload_item.relative_path, status, response_text
        );
        error!("{}", error_msg);
        return Err(error_msg);
    }

    info!(
        "Successfully uploaded file: {} ({} bytes)",
        upload_item.relative_path, file_size
    );

    // Emit upload success event
    let _ = app_handle.emit("file_uploaded", &upload_item.relative_path);

    Ok(())
}

// Background upload processor with concurrent uploads and proper debouncing
pub async fn process_upload_queue(
    upload_queue: UploadQueue,
    upload_config: UploadConfigState,
    upload_progress: UploadProgressState,
    app_handle: AppHandle,
) {
    // Start with default concurrency, will be updated when config changes
    let mut semaphore = Arc::new(Semaphore::new(5));
    let mut last_max_concurrent = 5;

    loop {
        let config = upload_config.lock().unwrap().clone();

        if !config.enabled {
            sleep(Duration::from_millis(1000)).await;
            continue;
        }

        // Update semaphore if concurrency setting changed
        if config.max_concurrent_uploads != last_max_concurrent {
            semaphore = Arc::new(Semaphore::new(config.max_concurrent_uploads));
            last_max_concurrent = config.max_concurrent_uploads;
        }

        // Try to acquire a permit for concurrent upload
        if let Ok(permit) = semaphore.clone().try_acquire_owned() {
            let ready_item = {
                let mut queue = upload_queue.lock().unwrap();
                let current_time = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64;

                // Find the first item that has waited long enough (debounce delay)
                let mut ready_index = None;
                let mut waiting_files = 0;

                for (index, item) in queue.iter().enumerate() {
                    let item_age_ms = current_time - (item.timestamp * 1000);
                    if item_age_ms >= config.upload_delay_ms {
                        if ready_index.is_none() {
                            ready_index = Some(index);
                            debug!(
                                "File '{}' is ready for upload after {}ms debounce",
                                item.relative_path, item_age_ms
                            );
                        }
                    } else {
                        waiting_files += 1;
                        let remaining_ms = config.upload_delay_ms - item_age_ms;
                        debug!(
                            "File '{}' still debouncing, {}ms remaining",
                            item.relative_path, remaining_ms
                        );
                    }
                }

                if waiting_files > 0 && ready_index.is_none() {
                    debug!(
                        "{} files in queue, all still waiting for debounce",
                        waiting_files
                    );
                }

                // Remove and return the ready item
                ready_index.and_then(|index| {
                    if index < queue.len() {
                        Some(queue.remove(index).unwrap())
                    } else {
                        None
                    }
                })
            };

            if let Some(mut item) = ready_item {
                // Update progress to show queue size
                {
                    let mut progress = upload_progress.lock().unwrap();
                    let queue_len = upload_queue.lock().unwrap().len();
                    progress.total_queued = queue_len;
                    let _ = app_handle.emit("upload_progress", &*progress);
                }

                // Spawn concurrent upload task
                let config_clone = config.clone();
                let app_handle_clone = app_handle.clone();
                let upload_queue_clone = upload_queue.clone();
                let upload_progress_clone = upload_progress.clone();

                tauri::async_runtime::spawn(async move {
                    let upload_result = upload_file(&item, &config_clone, &app_handle_clone).await;

                    match upload_result {
                        Ok(()) => {
                            debug!("Upload completed successfully for: {}", item.relative_path);
                            let _ = app_handle_clone.emit("upload_success", &item.relative_path);

                            // Update progress
                            {
                                let mut progress = upload_progress_clone.lock().unwrap();
                                progress.total_uploaded += 1;
                                let queue_len = upload_queue_clone.lock().unwrap().len();
                                progress.total_queued = queue_len;
                                let _ = app_handle_clone.emit("upload_progress", &*progress);
                            }
                        }
                        Err(e) => {
                            item.retry_count += 1;
                            if item.retry_count < 3 {
                                warn!(
                                    "Upload failed for '{}' (attempt {}/3), will retry: {}",
                                    item.relative_path, item.retry_count, e
                                );

                                // Re-queue for retry with updated timestamp for debouncing
                                item.timestamp = SystemTime::now()
                                    .duration_since(UNIX_EPOCH)
                                    .unwrap()
                                    .as_secs();

                                let mut queue = upload_queue_clone.lock().unwrap();
                                queue.push_back(item);
                            } else {
                                error!(
                                    "Upload permanently failed for '{}' after 3 attempts. Final error: {}",
                                    item.relative_path, e
                                );

                                let _ = app_handle_clone
                                    .emit("upload_failed", (&item.relative_path, e));

                                // Update failed count
                                {
                                    let mut progress = upload_progress_clone.lock().unwrap();
                                    progress.total_failed += 1;
                                    let queue_len = upload_queue_clone.lock().unwrap().len();
                                    progress.total_queued = queue_len;
                                    let _ = app_handle_clone.emit("upload_progress", &*progress);
                                }
                            }
                        }
                    }

                    // Release the permit when upload is done
                    drop(permit);
                });

                // Small delay to prevent overwhelming the system
                sleep(Duration::from_millis(10)).await;
            } else {
                // No ready items, release permit and wait a bit longer
                drop(permit);
                sleep(Duration::from_millis(200)).await;
            }
        } else {
            // All upload slots are busy, wait before checking again
            sleep(Duration::from_millis(100)).await;
        }
    }
}

// Tauri Commands
#[tauri::command]
pub fn get_upload_config(
    upload_config: tauri::State<'_, UploadConfigState>,
) -> Result<UploadConfig, String> {
    let config = upload_config.lock().unwrap().clone();
    Ok(config)
}

#[tauri::command]
pub fn set_upload_config(
    config: UploadConfig,
    upload_config: tauri::State<'_, UploadConfigState>,
) -> Result<String, String> {
    let mut current_config = upload_config.lock().unwrap();
    *current_config = config;
    Ok("Upload configuration updated".to_string())
}

#[tauri::command]
pub fn get_upload_progress(
    upload_progress: tauri::State<'_, UploadProgressState>,
) -> Result<UploadProgress, String> {
    let progress = upload_progress.lock().unwrap().clone();
    Ok(progress)
}

#[tauri::command]
pub fn clear_upload_queue(upload_queue: tauri::State<'_, UploadQueue>) -> Result<String, String> {
    let mut queue = upload_queue.lock().unwrap();
    queue.clear();
    Ok("Upload queue cleared".to_string())
}

#[tauri::command]
pub fn get_queue_size(upload_queue: tauri::State<'_, UploadQueue>) -> Result<usize, String> {
    let queue = upload_queue.lock().unwrap();
    Ok(queue.len())
}

#[tauri::command]
pub async fn trigger_manual_upload(
    file_path: String,
    base_path: String,
    upload_queue: tauri::State<'_, UploadQueue>,
    upload_config: tauri::State<'_, UploadConfigState>,
) -> Result<String, String> {
    add_to_upload_queue_async(
        file_path.clone(),
        base_path,
        upload_queue.inner(),
        upload_config.inner(),
    )
    .await;
    Ok(format!("File queued for upload: {}", file_path))
}
