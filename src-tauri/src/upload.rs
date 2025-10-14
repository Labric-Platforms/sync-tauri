use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;
use tokio::sync::Semaphore;
use tokio::time::sleep;
use crc32c::crc32c;
use base64::{engine::general_purpose, Engine as _};

// Upload processing constants
const MAX_BATCH_SIZE: usize = 1000;
const QUEUE_PROCESSING_INTERVAL_MS: u64 = 200;
const MAX_RETRY_COUNT: u32 = 3;
const RETRY_DELAY_SECS: u64 = 5;
const DEFAULT_UPLOAD_DELAY_MS: u64 = 2000;
const DEFAULT_MAX_CONCURRENT_UPLOADS: usize = 5;
const UPLOAD_SPAWN_DELAY_MS: u64 = 10;
const BATCH_PROCESSING_DELAY_MS: u64 = 100;
const DISABLED_CHECK_INTERVAL_MS: u64 = 1000;

// File status constants
const STATUS_EXISTS: &str = "exists";
const STATUS_NEEDS_UPLOAD: &str = "needs_upload";
const STATUS_IGNORED: &str = "ignored";
const STATUS_QUEUED: &str = "queued";
const STATUS_UPLOADING: &str = "uploading";
const STATUS_UPLOADED: &str = "uploaded";
const STATUS_FAILED: &str = "failed";

// Event type constants
const EVENT_TYPE_INITIAL: &str = "initial";
const EVENT_TYPE_MODIFIED: &str = "modified";

// Store filename constant
const SETTINGS_STORE_FILENAME: &str = "settings.json";

#[derive(Clone, Serialize, Deserialize)]
pub struct UploadConfig {
    pub enabled: bool,
    pub server_url: String,
    pub ignored_patterns: Vec<String>,
    pub upload_delay_ms: u64, // Delay before uploading to batch changes
    pub max_concurrent_uploads: usize, // Maximum number of concurrent uploads
    pub ignore_existing_files: bool, // Whether to ignore existing files when a folder is selected
}

impl Default for UploadConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            server_url: "http://localhost:3000".to_string(),
            ignored_patterns: vec![
                "*.tmp".to_string(),
                ".git/**".to_string(),
                "node_modules/**".to_string(),
                ".DS_Store".to_string(),
            ],
            upload_delay_ms: DEFAULT_UPLOAD_DELAY_MS,
            max_concurrent_uploads: DEFAULT_MAX_CONCURRENT_UPLOADS,
            ignore_existing_files: false, // By default, existing files should be uploaded
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
    #[serde(rename = "crc32c")]
    crc32c: String,
}

#[derive(Serialize, Deserialize)]
struct PresignedUrlResponse {
    success: bool,
    message: String,
    #[serde(rename = "upload_url")]
    upload_url: Option<String>,
    #[serde(rename = "file_id")]
    file_id: String,
    #[serde(rename = "uploadUrl")]
    upload_url_alt: Option<String>, // Alternative field name in response
    #[serde(rename = "fileId")]
    file_id_alt: Option<String>, // Alternative field name in response
}

// Batch request/response structs for /api/sync/get_presigned_batch
#[derive(Serialize, Deserialize)]
struct FileCheckItem {
    #[serde(rename = "fileName")]
    file_name: String,
    #[serde(rename = "contentType")]
    content_type: String,
    #[serde(rename = "crc32c")]
    crc32c: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct GetPresignedBatchBody {
    files: Vec<FileCheckItem>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct FileCheckResult {
    file_name: String,
    crc32c: Option<String>,
    status: String, // "exists" or "needs_upload"
    file_id: String,
    upload_url: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct GetPresignedBatchResponse {
    success: bool,
    message: String,
    files: Vec<FileCheckResult>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct UploadProgress {
    pub total_queued: usize,
    pub total_uploaded: usize,
    pub total_failed: usize,
    pub current_uploading: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct FileUploadStatus {
    pub relative_path: String,
    pub status: String, // "pending" | "queued" | "uploading" | "uploaded" | "failed"
    pub error: Option<String>,
}

pub type UploadQueue = Arc<Mutex<VecDeque<UploadItem>>>;
pub type UploadConfigState = Arc<Mutex<UploadConfig>>;
pub type UploadProgressState = Arc<Mutex<UploadProgress>>;

// Helper function to emit file upload status events
pub fn emit_file_upload_status(
    relative_path: &str,
    status: &str,
    error: Option<String>,
    app_handle: &AppHandle,
) {
    let upload_status = FileUploadStatus {
        relative_path: relative_path.to_string(),
        status: status.to_string(),
        error,
    };
    
    if let Err(e) = app_handle.emit("file_upload_status", &upload_status) {
        warn!("Failed to emit file upload status event: {}", e);
    }
}

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

// Helper function to compute CRC32C hash of file content
// Returns base64-encoded big-endian bytes to match Google Cloud Storage format
fn compute_crc32c_hash(data: &[u8]) -> String {
    let hash = crc32c(data);
    let hash_bytes = hash.to_be_bytes(); // Convert to big-endian byte order
    general_purpose::STANDARD.encode(&hash_bytes) // Base64 encode
}

// Batch function to get presigned URLs for multiple files
async fn get_presigned_urls_batch(
    items: Vec<UploadItem>,
    config: &UploadConfig,
    app_handle: &AppHandle,
) -> Result<Vec<(UploadItem, FileCheckResult)>, String> {
    if items.is_empty() {
        return Ok(vec![]);
    }

    info!("Requesting presigned URLs for {} files in batch", items.len());

    // Prepare batch request - read files and compute CRC32C
    let mut file_check_items = Vec::new();
    let mut valid_items = Vec::new();

    for item in items {
        // Read file content to compute CRC32C
        match tokio::fs::read(&item.path).await {
            Ok(file_content) => {
                let content_type = get_content_type(&item.path);
                let crc32c_hash = compute_crc32c_hash(&file_content);

                file_check_items.push(FileCheckItem {
                    file_name: item.relative_path.clone(),
                    content_type,
                    crc32c: Some(crc32c_hash),
                });
                valid_items.push(item);
            }
            Err(e) => {
                warn!("Failed to read file '{}' for batch request: {}", item.relative_path, e);
                // Skip this file, continue with others
            }
        }
    }

    if file_check_items.is_empty() {
        return Ok(vec![]);
    }

    // Get token from store
    let token = {
        let store = app_handle.store(SETTINGS_STORE_FILENAME)
            .map_err(|e| format!("Failed to access store: {}", e))?;
        store.get("token").unwrap_or_default()
    };

    // Make batch request
    let client = reqwest::Client::new();
    let batch_url = format!("{}/api/sync/get_presigned_batch", config.server_url);
    let batch_body = GetPresignedBatchBody {
        files: file_check_items,
    };

    debug!("Sending batch request to: {} with {} files", batch_url, batch_body.files.len());

    let mut request_builder = client
        .post(&batch_url)
        .json(&batch_body);

    // Add Authorization header if token exists
    if let Some(token_str) = token.as_str() {
        request_builder = request_builder.header("Authorization", format!("Bearer {}", token_str));
    }

    let response = request_builder
        .send()
        .await
        .map_err(|e| {
            let error_msg = format!("Failed to send batch presigned request: {}", e);
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
            "Batch presigned request failed with status {}: {}",
            status, response_text
        );
        error!("{}", error_msg);
        return Err(error_msg);
    }

    let batch_response: GetPresignedBatchResponse = response.json().await.map_err(|e| {
        let error_msg = format!("Failed to parse batch presigned response: {}", e);
        error!("{}", error_msg);
        error_msg
    })?;

    info!(
        "Batch request successful: {} files processed",
        batch_response.files.len()
    );

    // Match results back to upload items
    let mut results = Vec::new();
    for result in batch_response.files {
        if let Some(item) = valid_items.iter().find(|i| i.relative_path == result.file_name) {
            results.push((item.clone(), result));
        }
    }

    Ok(results)
}

// Synchronous function to add file to upload queue (for file watcher callback)
pub fn add_to_upload_queue_sync(
    file_path: String,
    base_path: String,
    upload_queue: &UploadQueue,
    upload_config: &UploadConfigState,
    app_handle: &AppHandle,
) {
    add_to_upload_queue_with_event_type(file_path, base_path, upload_queue, upload_config, EVENT_TYPE_MODIFIED, app_handle);
}

// Enhanced function that accepts event type for more granular control
pub fn add_to_upload_queue_with_event_type(
    file_path: String,
    base_path: String,
    upload_queue: &UploadQueue,
    upload_config: &UploadConfigState,
    event_type: &str,
    app_handle: &AppHandle,
) {
    let config = upload_config.lock().unwrap().clone();

    if !config.enabled {
        debug!("Upload is disabled, skipping file: {}", file_path);
        
        let relative_path = get_relative_path(&file_path, &base_path);
        // Emit ignored status for this file since uploads are disabled
        emit_file_upload_status(&relative_path, STATUS_IGNORED, None, app_handle);
        return;
    }

    // Skip initial files if ignore_existing_files is enabled
    if config.ignore_existing_files && event_type == EVENT_TYPE_INITIAL {
        debug!("Ignoring existing file due to ignore_existing_files setting: {}", file_path);

        let relative_path = get_relative_path(&file_path, &base_path);
        // Emit ignored status for this file
        emit_file_upload_status(&relative_path, STATUS_IGNORED, None, app_handle);
        return;
    }

    let relative_path = get_relative_path(&file_path, &base_path);

    // Check if file should be ignored
    if should_ignore_file(&relative_path, &config.ignored_patterns) {
        debug!(
            "File '{}' matches ignore pattern, skipping upload",
            relative_path
        );

        // Emit ignored status for this file
        emit_file_upload_status(&relative_path, STATUS_IGNORED, None, app_handle);
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

                // Emit queued status for this file
                emit_file_upload_status(&relative_path, STATUS_QUEUED, None, app_handle);
            } else {
                debug!("Path '{}' is not a file, skipping upload", relative_path);
                // Emit ignored status for non-files (directories, etc.)
                emit_file_upload_status(&relative_path, STATUS_IGNORED, None, app_handle);
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
    app_handle: &AppHandle,
) {
    add_to_upload_queue_sync(file_path, base_path, upload_queue, upload_config, app_handle);
}

// Function to upload a single file with presigned URL
async fn upload_file(
    upload_item: &UploadItem,
    upload_url: &str,
    file_id: &str,
    config: &UploadConfig,
    app_handle: &AppHandle,
) -> Result<String, String> {
    info!(
        "Starting upload for file: {} (attempt: {})",
        upload_item.relative_path,
        upload_item.retry_count + 1
    );

    // Emit uploading status
    emit_file_upload_status(&upload_item.relative_path, STATUS_UPLOADING, None, app_handle);

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

    // Upload file to presigned URL
    debug!(
        "Uploading {} bytes to presigned URL for file: {}",
        file_size, upload_item.relative_path
    );

    let client = reqwest::Client::new();
    let upload_response = client
        .put(upload_url)
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

    // Update file metadata after successful upload
    if let Err(e) = update_file_metadata(&file_id, config, app_handle).await {
        warn!(
            "Failed to update metadata for file '{}' (file_id: {}): {}",
            upload_item.relative_path, file_id, e
        );
        // Don't fail the entire upload if metadata update fails
        // Just log the warning and continue
    }

    // Emit upload success event
    let _ = app_handle.emit("file_uploaded", &upload_item.relative_path);

    // Emit uploaded status
    emit_file_upload_status(&upload_item.relative_path, STATUS_UPLOADED, None, app_handle);

    Ok(file_id.to_string())
}

// Function to update file metadata after successful upload
async fn update_file_metadata(
    file_id: &str,
    config: &UploadConfig,
    app_handle: &AppHandle,
) -> Result<(), String> {
    info!("Updating metadata for file ID: {}", file_id);

    // Get token from store
    let token = {
        let store = app_handle.store(SETTINGS_STORE_FILENAME)
            .map_err(|e| format!("Failed to access store: {}", e))?;
        store.get("token").unwrap_or_default()
    };

    let client = reqwest::Client::new();
    let metadata_url = format!("{}/api/sync/{}/update_metadata", config.server_url, file_id);
    
    debug!("Sending metadata update request to: {}", metadata_url);

    let mut request_builder = client.post(&metadata_url);

    // Add Authorization header if token exists
    if let Some(token_str) = token.as_str() {
        request_builder = request_builder.header("Authorization", format!("Bearer {}", token_str));
        debug!("Added Bearer token to metadata update request");
    }

    let response = request_builder
        .send()
        .await
        .map_err(|e| {
            let error_msg = format!(
                "Failed to send metadata update request for file ID '{}': {}",
                file_id, e
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
            "Metadata update failed for file ID '{}' with status {}: {}",
            file_id, status, response_text
        );
        error!("{}", error_msg);
        return Err(error_msg);
    }

    info!("Successfully updated metadata for file ID: {}", file_id);
    Ok(())
}

// Background upload processor with batch presigned URLs and concurrent uploads
pub async fn process_upload_queue(
    upload_queue: UploadQueue,
    upload_config: UploadConfigState,
    upload_progress: UploadProgressState,
    app_handle: AppHandle,
) {
    // Start with default concurrency, will be updated when config changes
    let mut semaphore = Arc::new(Semaphore::new(DEFAULT_MAX_CONCURRENT_UPLOADS));
    let mut last_max_concurrent = DEFAULT_MAX_CONCURRENT_UPLOADS;

    loop {
        let config = upload_config.lock().unwrap().clone();

        if !config.enabled {
            sleep(Duration::from_millis(DISABLED_CHECK_INTERVAL_MS)).await;
            continue;
        }

        // Update semaphore if concurrency setting changed
        if config.max_concurrent_uploads != last_max_concurrent {
            semaphore = Arc::new(Semaphore::new(config.max_concurrent_uploads));
            last_max_concurrent = config.max_concurrent_uploads;
        }

        // Collect up to 1000 ready items for batch processing
        let ready_items = {
            let mut queue = upload_queue.lock().unwrap();
            let current_time = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64;

            let mut ready = Vec::new();
            let mut indices_to_remove = Vec::new();

            for (index, item) in queue.iter().enumerate() {
                let item_age_ms = current_time - (item.timestamp * 1000);
                if item_age_ms >= config.upload_delay_ms {
                    ready.push(item.clone());
                    indices_to_remove.push(index);

                    if ready.len() >= MAX_BATCH_SIZE {
                        break; // Batch endpoint limit
                    }
                }
            }

            // Remove ready items from queue (in reverse order to maintain indices)
            for index in indices_to_remove.iter().rev() {
                queue.remove(*index);
            }

            // Only log when we have files to process or files waiting
            if !ready.is_empty() || queue.len() > 0 {
                debug!(
                    "Collected {} ready files for batch processing (queue remaining: {})",
                    ready.len(),
                    queue.len()
                );
            }

            ready
        };

        // If we have ready items, process them as a batch
        if !ready_items.is_empty() {
            // Update progress to show queue size
            {
                let mut progress = upload_progress.lock().unwrap();
                let queue_len = upload_queue.lock().unwrap().len();
                progress.total_queued = queue_len;
                let _ = app_handle.emit("upload_progress", &*progress);
            }

            // Get batch presigned URLs
            let batch_results = match get_presigned_urls_batch(
                ready_items.clone(),
                &config,
                &app_handle,
            )
            .await
            {
                Ok(results) => results,
                Err(e) => {
                    error!("Batch presigned request failed: {}", e);

                    // Re-queue all items for retry
                    {
                        let mut queue = upload_queue.lock().unwrap();
                        for item in ready_items {
                            queue.push_back(item);
                        }
                    } // Drop mutex guard before await

                    sleep(Duration::from_secs(RETRY_DELAY_SECS)).await;
                    continue;
                }
            };

            // Process batch results
            for (item, result) in batch_results {
                // Handle "exists" status - file already synced
                if result.status == STATUS_EXISTS {
                    info!(
                        "File '{}' already exists (file_id: {}), skipping upload",
                        item.relative_path, result.file_id
                    );

                    // Emit upload success event
                    let _ = app_handle.emit("file_uploaded", &item.relative_path);
                    let _ = app_handle.emit("upload_success", &item.relative_path);

                    // Emit uploaded status
                    emit_file_upload_status(&item.relative_path, STATUS_UPLOADED, None, &app_handle);

                    // Update progress
                    {
                        let mut progress = upload_progress.lock().unwrap();
                        progress.total_uploaded += 1;
                        let _ = app_handle.emit("upload_progress", &*progress);
                    }

                    continue;
                }

                // Handle "needs_upload" status - proceed with actual upload
                if result.status == STATUS_NEEDS_UPLOAD {
                    let upload_url = match result.upload_url {
                        Some(url) => url,
                        None => {
                            warn!(
                                "File '{}' needs upload but no URL provided, re-queuing",
                                item.relative_path
                            );
                            let mut queue = upload_queue.lock().unwrap();
                            queue.push_back(item);
                            continue;
                        }
                    };

                    // Wait for a semaphore permit before uploading
                    let permit = semaphore.clone().acquire_owned().await.unwrap();

                    // Spawn concurrent upload task
                    let config_clone = config.clone();
                    let app_handle_clone = app_handle.clone();
                    let upload_queue_clone = upload_queue.clone();
                    let upload_progress_clone = upload_progress.clone();
                    let file_id = result.file_id.clone();
                    let mut item = item.clone();

                    tauri::async_runtime::spawn(async move {
                        let upload_result = upload_file(
                            &item,
                            &upload_url,
                            &file_id,
                            &config_clone,
                            &app_handle_clone,
                        )
                        .await;

                        match upload_result {
                            Ok(file_id) => {
                                debug!(
                                    "Upload completed successfully for: {} (file_id: {})",
                                    item.relative_path, file_id
                                );
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
                                if item.retry_count < MAX_RETRY_COUNT {
                                    warn!(
                                        "Upload failed for '{}' (attempt {}/{}), will retry: {}",
                                        item.relative_path, item.retry_count, MAX_RETRY_COUNT, e
                                    );

                                    // Re-queue for retry with updated timestamp
                                    item.timestamp = SystemTime::now()
                                        .duration_since(UNIX_EPOCH)
                                        .unwrap()
                                        .as_secs();

                                    let mut queue = upload_queue_clone.lock().unwrap();
                                    queue.push_back(item);
                                } else {
                                    error!(
                                        "Upload permanently failed for '{}' after {} attempts. Final error: {}",
                                        item.relative_path, MAX_RETRY_COUNT, e
                                    );

                                    let _ = app_handle_clone
                                        .emit("upload_failed", (&item.relative_path, e.clone()));

                                    // Emit failed status
                                    emit_file_upload_status(
                                        &item.relative_path,
                                        STATUS_FAILED,
                                        Some(e),
                                        &app_handle_clone,
                                    );

                                    // Update failed count
                                    {
                                        let mut progress = upload_progress_clone.lock().unwrap();
                                        progress.total_failed += 1;
                                        let queue_len = upload_queue_clone.lock().unwrap().len();
                                        progress.total_queued = queue_len;
                                        let _ =
                                            app_handle_clone.emit("upload_progress", &*progress);
                                    }
                                }
                            }
                        }

                        // Release the permit when upload is done
                        drop(permit);
                    });

                    // Small delay between spawning uploads
                    sleep(Duration::from_millis(UPLOAD_SPAWN_DELAY_MS)).await;
                }
            }

            // Small delay after processing batch
            sleep(Duration::from_millis(BATCH_PROCESSING_DELAY_MS)).await;
        } else {
            // No ready items, wait before checking again
            sleep(Duration::from_millis(QUEUE_PROCESSING_INTERVAL_MS)).await;
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
    app_handle: AppHandle,
) -> Result<String, String> {
    add_to_upload_queue_async(
        file_path.clone(),
        base_path,
        upload_queue.inner(),
        upload_config.inner(),
        &app_handle,
    )
    .await;
    Ok(format!("File queued for upload: {}", file_path))
}
