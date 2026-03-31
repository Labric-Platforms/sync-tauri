use base64::{engine::general_purpose, Engine as _};
use chrono::{DateTime, Utc};
use crc32c::crc32c;
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;
use tokio::sync::Semaphore;
use tokio::time::sleep;

use crate::http_client::{check_response, SharedHttpClient};
use crate::{EVENT_TYPE_INITIAL, EVENT_TYPE_MODIFIED};

// Upload processing constants
const MAX_BATCH_SIZE: usize = 1000;
const QUEUE_POLL_INTERVAL: Duration = Duration::from_millis(200);
const MAX_RETRY_COUNT: u32 = 3;
const RETRY_DELAY: Duration = Duration::from_secs(5);
const DEFAULT_UPLOAD_DELAY_MS: u64 = 2000;
const DEFAULT_MAX_CONCURRENT_UPLOADS: usize = 5;
const UPLOAD_SPAWN_DELAY: Duration = Duration::from_millis(10);
const BATCH_PROCESSING_DELAY: Duration = Duration::from_millis(100);
const DISABLED_CHECK_INTERVAL: Duration = Duration::from_millis(1000);

// File status constants
const STATUS_EXISTS: &str = "exists";
const STATUS_NEEDS_UPLOAD: &str = "needs_upload";
const STATUS_IGNORED: &str = "ignored";
pub const STATUS_DIRECTORY: &str = "directory";
const STATUS_QUEUED: &str = "queued";
const STATUS_UPLOADING: &str = "uploading";
const STATUS_UPLOADED: &str = "uploaded";
const STATUS_FAILED: &str = "failed";

// Store filename constant
const SETTINGS_STORE_FILENAME: &str = "settings.json";

// ── Data types ──────────────────────────────────────────────────────────

#[derive(Clone, Serialize, Deserialize)]
pub struct UploadConfig {
    pub enabled: bool,
    pub server_url: String,
    pub ignored_patterns: Vec<String>,
    pub upload_delay_ms: u64,
    pub max_concurrent_uploads: usize,
    pub ignore_existing_files: bool,
}

impl Default for UploadConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            server_url: "https://platform.labric.co".to_string(),
            ignored_patterns: vec![
                "*.tmp".to_string(),
                ".git/**".to_string(),
                "node_modules/**".to_string(),
                ".DS_Store".to_string(),
            ],
            upload_delay_ms: DEFAULT_UPLOAD_DELAY_MS,
            max_concurrent_uploads: DEFAULT_MAX_CONCURRENT_UPLOADS,
            ignore_existing_files: false,
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
    pub status: String,
    pub error: Option<String>,
}

pub type UploadQueue = Arc<Mutex<VecDeque<UploadItem>>>;
pub type UploadConfigState = Arc<Mutex<UploadConfig>>;
pub type UploadProgressState = Arc<Mutex<UploadProgress>>;

// ── API request/response types ──────────────────────────────────────────

#[derive(Serialize, Deserialize)]
struct FileCheckItem {
    #[serde(rename = "fileName")]
    file_name: String,
    #[serde(rename = "contentType")]
    content_type: String,
    #[serde(rename = "crc32c")]
    crc32c: Option<String>,
    #[serde(rename = "fileCreatedAt", skip_serializing_if = "Option::is_none")]
    file_created_at: Option<String>,
    #[serde(rename = "fileModifiedAt", skip_serializing_if = "Option::is_none")]
    file_modified_at: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct GetPresignedBatchBody {
    files: Vec<FileCheckItem>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct FileCheckResult {
    file_name: String,
    crc32c: Option<String>,
    status: String,
    file_id: String,
    upload_url: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct GetPresignedBatchResponse {
    success: bool,
    message: String,
    files: Vec<FileCheckResult>,
}

/// An upload item paired with its already-read file content, to avoid reading twice.
struct PreparedUpload {
    item: UploadItem,
    file_content: Vec<u8>,
    content_type: String,
}

// ── Small helpers ───────────────────────────────────────────────────────

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
        warn!("Failed to emit file upload status event: {e}");
    }
}

pub fn should_ignore_file(file_path: &str, ignored_patterns: &[String]) -> bool {
    ignored_patterns.iter().any(|pattern| {
        glob::Pattern::new(pattern)
            .map(|p| p.matches(file_path))
            .unwrap_or(false)
    })
}

fn get_content_type(file_path: &str) -> String {
    mime_guess::from_path(file_path)
        .first_or_octet_stream()
        .to_string()
}

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
        return absolute_path
            .trim_start_matches(base_path)
            .trim_start_matches('/')
            .trim_start_matches('\\')
            .to_string();
    }

    absolute_path.to_string()
}

fn compute_crc32c_hash(data: &[u8]) -> String {
    let hash = crc32c(data);
    general_purpose::STANDARD.encode(hash.to_be_bytes())
}

fn system_time_to_iso8601(time: SystemTime) -> Option<String> {
    let duration = time.duration_since(UNIX_EPOCH).ok()?;
    let datetime: DateTime<Utc> =
        DateTime::from_timestamp(duration.as_secs() as i64, duration.subsec_nanos())?;
    Some(datetime.to_rfc3339())
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn get_auth_token(app_handle: &AppHandle) -> Result<Option<String>, String> {
    let store = app_handle
        .store(SETTINGS_STORE_FILENAME)
        .map_err(|e| format!("Failed to access store: {e}"))?;
    Ok(store
        .get("token")
        .and_then(|v| v.as_str().map(String::from)))
}

// ── Queue management ────────────────────────────────────────────────────

pub fn add_to_upload_queue_sync(
    file_path: String,
    base_path: String,
    upload_queue: &UploadQueue,
    upload_config: &UploadConfigState,
    app_handle: &AppHandle,
) {
    add_to_upload_queue_with_event_type(
        file_path,
        base_path,
        upload_queue,
        upload_config,
        EVENT_TYPE_MODIFIED,
        app_handle,
    );
}

pub fn add_to_upload_queue_with_event_type(
    file_path: String,
    base_path: String,
    upload_queue: &UploadQueue,
    upload_config: &UploadConfigState,
    event_type: &str,
    app_handle: &AppHandle,
) {
    let config = upload_config.lock().unwrap().clone();
    let relative_path = get_relative_path(&file_path, &base_path);

    if !config.enabled {
        debug!("Upload is disabled, skipping file: {file_path}");
        emit_file_upload_status(&relative_path, STATUS_IGNORED, None, app_handle);
        return;
    }

    if config.ignore_existing_files && event_type == EVENT_TYPE_INITIAL {
        debug!("Ignoring existing file due to ignore_existing_files setting: {file_path}");
        emit_file_upload_status(&relative_path, STATUS_IGNORED, None, app_handle);
        return;
    }

    if should_ignore_file(&relative_path, &config.ignored_patterns) {
        debug!("File '{relative_path}' matches ignore pattern, skipping upload");
        emit_file_upload_status(&relative_path, STATUS_IGNORED, None, app_handle);
        return;
    }

    // Only queue actual files, not directories
    match std::fs::metadata(&file_path) {
        Ok(metadata) if metadata.is_file() => {
            let upload_item = UploadItem {
                path: file_path.clone(),
                relative_path: relative_path.clone(),
                timestamp: now_millis(),
                retry_count: 0,
            };

            let mut queue = upload_queue.lock().unwrap();
            let had_duplicate = queue.iter().any(|item| item.path == file_path);
            queue.retain(|item| item.path != file_path);
            queue.push_back(upload_item);

            if had_duplicate {
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

            emit_file_upload_status(&relative_path, STATUS_QUEUED, None, app_handle);
        }
        Ok(_) => {
            debug!("Path '{relative_path}' is not a file, skipping upload");
            emit_file_upload_status(&relative_path, STATUS_DIRECTORY, None, app_handle);
        }
        Err(e) => {
            warn!("Failed to get metadata for file '{relative_path}': {e}");
        }
    }
}

// ── Batch presigned URL request ─────────────────────────────────────────

async fn prepare_batch_items(items: Vec<UploadItem>) -> Vec<(PreparedUpload, FileCheckItem)> {
    let mut prepared = Vec::with_capacity(items.len());

    for item in items {
        let file_content = match tokio::fs::read(&item.path).await {
            Ok(content) => content,
            Err(e) => {
                warn!(
                    "Failed to read file '{}' for batch request: {}",
                    item.relative_path, e
                );
                continue;
            }
        };

        let content_type = get_content_type(&item.path);
        let crc32c_hash = compute_crc32c_hash(&file_content);

        let (file_created_at, file_modified_at) = match tokio::fs::metadata(&item.path).await {
            Ok(metadata) => (
                metadata.created().ok().and_then(system_time_to_iso8601),
                metadata.modified().ok().and_then(system_time_to_iso8601),
            ),
            Err(e) => {
                warn!("Failed to get file timestamps for '{}': {}", item.path, e);
                (None, None)
            }
        };

        let check_item = FileCheckItem {
            file_name: item.relative_path.clone(),
            content_type: content_type.clone(),
            crc32c: Some(crc32c_hash),
            file_created_at,
            file_modified_at,
        };

        let upload = PreparedUpload {
            item,
            file_content,
            content_type,
        };

        prepared.push((upload, check_item));
    }

    prepared
}

async fn get_presigned_urls_batch(
    prepared: &[(PreparedUpload, FileCheckItem)],
    config: &UploadConfig,
    client: &SharedHttpClient,
    app_handle: &AppHandle,
) -> Result<Vec<FileCheckResult>, String> {
    if prepared.is_empty() {
        return Ok(vec![]);
    }

    info!(
        "Requesting presigned URLs for {} files in batch",
        prepared.len()
    );

    let file_check_items: Vec<FileCheckItem> = prepared
        .iter()
        .map(|(_, check)| FileCheckItem {
            file_name: check.file_name.clone(),
            content_type: check.content_type.clone(),
            crc32c: check.crc32c.clone(),
            file_created_at: check.file_created_at.clone(),
            file_modified_at: check.file_modified_at.clone(),
        })
        .collect();

    let token = get_auth_token(app_handle)?;
    let batch_url = format!("{}/api/sync/get_presigned_batch", config.server_url);

    debug!(
        "Sending batch request to: {} with {} files",
        batch_url,
        file_check_items.len()
    );

    let mut request = client.post(&batch_url).json(&GetPresignedBatchBody {
        files: file_check_items,
    });

    if let Some(token_str) = &token {
        request = request.header("Authorization", format!("Bearer {token_str}"));
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Failed to send batch presigned request: {e}"))?;

    let response = check_response(response, "Batch presigned request").await?;

    let batch_response: GetPresignedBatchResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse batch presigned response: {e}"))?;

    info!(
        "Batch request successful: {} files processed",
        batch_response.files.len()
    );

    Ok(batch_response.files)
}

// ── Single file upload ──────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
async fn upload_file(
    item: &UploadItem,
    file_content: Vec<u8>,
    content_type: &str,
    upload_url: &str,
    file_id: &str,
    config: &UploadConfig,
    client: &SharedHttpClient,
    app_handle: &AppHandle,
) -> Result<String, String> {
    info!(
        "Starting upload for file: {} (attempt: {})",
        item.relative_path,
        item.retry_count + 1
    );

    emit_file_upload_status(&item.relative_path, STATUS_UPLOADING, None, app_handle);

    let file_size = file_content.len();
    debug!(
        "Uploading {} bytes for file: {}",
        file_size, item.relative_path
    );

    let response = client
        .put(upload_url)
        .header("Content-Type", content_type)
        .body(file_content)
        .send()
        .await
        .map_err(|e| {
            format!(
                "Failed to upload file '{}' to presigned URL: {}",
                item.relative_path, e
            )
        })?;

    check_response(response, &format!("Upload for '{}'", item.relative_path)).await?;

    info!(
        "Successfully uploaded file: {} ({} bytes)",
        item.relative_path, file_size
    );

    // Update file metadata (non-fatal if it fails)
    if let Err(e) = update_file_metadata(file_id, config, client, app_handle).await {
        warn!(
            "Failed to update metadata for file '{}' (file_id: {}): {}",
            item.relative_path, file_id, e
        );
    }

    let _ = app_handle.emit("file_uploaded", &item.relative_path);
    emit_file_upload_status(&item.relative_path, STATUS_UPLOADED, None, app_handle);

    Ok(file_id.to_string())
}

async fn update_file_metadata(
    file_id: &str,
    config: &UploadConfig,
    client: &SharedHttpClient,
    app_handle: &AppHandle,
) -> Result<(), String> {
    let token = get_auth_token(app_handle)?;
    let metadata_url = format!("{}/api/sync/{}/update_metadata", config.server_url, file_id);

    debug!("Sending metadata update request to: {metadata_url}");

    let mut request = client.post(&metadata_url);
    if let Some(token_str) = &token {
        request = request.header("Authorization", format!("Bearer {token_str}"));
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Failed to send metadata update for file ID '{file_id}': {e}"))?;

    check_response(
        response,
        &format!("Metadata update for file ID '{file_id}'"),
    )
    .await?;

    info!("Successfully updated metadata for file ID: {file_id}");
    Ok(())
}

// ── Background queue processor ──────────────────────────────────────────

/// Drain up to MAX_BATCH_SIZE items that have aged past the upload delay.
fn collect_ready_items(queue: &mut VecDeque<UploadItem>, delay_ms: u64) -> Vec<UploadItem> {
    let now_ms = now_millis();

    let mut ready = Vec::new();
    let mut indices_to_remove = Vec::new();

    for (index, item) in queue.iter().enumerate() {
        let item_age_ms = now_ms.saturating_sub(item.timestamp);
        if item_age_ms >= delay_ms {
            ready.push(item.clone());
            indices_to_remove.push(index);
            if ready.len() >= MAX_BATCH_SIZE {
                break;
            }
        }
    }

    for index in indices_to_remove.iter().rev() {
        queue.remove(*index);
    }

    if !ready.is_empty() || !queue.is_empty() {
        debug!(
            "Collected {} ready files for batch processing (queue remaining: {})",
            ready.len(),
            queue.len()
        );
    }

    ready
}

fn emit_progress(
    upload_progress: &UploadProgressState,
    upload_queue: &UploadQueue,
    app_handle: &AppHandle,
) {
    let mut progress = upload_progress.lock().unwrap();
    progress.total_queued = upload_queue.lock().unwrap().len();
    let _ = app_handle.emit("upload_progress", &*progress);
}

pub async fn process_upload_queue(
    upload_queue: UploadQueue,
    upload_config: UploadConfigState,
    upload_progress: UploadProgressState,
    http_client: SharedHttpClient,
    app_handle: AppHandle,
) {
    let mut semaphore = Arc::new(Semaphore::new(DEFAULT_MAX_CONCURRENT_UPLOADS));
    let mut last_max_concurrent = DEFAULT_MAX_CONCURRENT_UPLOADS;

    loop {
        let config = upload_config.lock().unwrap().clone();

        if !config.enabled {
            sleep(DISABLED_CHECK_INTERVAL).await;
            continue;
        }

        // Recreate semaphore if concurrency setting changed
        if config.max_concurrent_uploads != last_max_concurrent {
            semaphore = Arc::new(Semaphore::new(config.max_concurrent_uploads));
            last_max_concurrent = config.max_concurrent_uploads;
        }

        let ready_items = {
            let mut queue = upload_queue.lock().unwrap();
            collect_ready_items(&mut queue, config.upload_delay_ms)
        };

        if ready_items.is_empty() {
            sleep(QUEUE_POLL_INTERVAL).await;
            continue;
        }

        emit_progress(&upload_progress, &upload_queue, &app_handle);

        // Read files and prepare batch request
        let prepared = prepare_batch_items(ready_items.clone()).await;

        // Get presigned URLs for the batch
        let batch_results =
            match get_presigned_urls_batch(&prepared, &config, &http_client, &app_handle).await {
                Ok(results) => results,
                Err(e) => {
                    error!("Batch presigned request failed: {e}");
                    {
                        let mut queue = upload_queue.lock().unwrap();
                        for item in ready_items {
                            queue.push_back(item);
                        }
                    }
                    sleep(RETRY_DELAY).await;
                    continue;
                }
            };

        // Process each result
        for result in batch_results {
            // Find the matching prepared upload
            let prepared_upload = prepared
                .iter()
                .find(|(upload, _)| upload.item.relative_path == result.file_name);

            let Some((prepared, _)) = prepared_upload else {
                warn!("No matching prepared upload for: {}", result.file_name);
                continue;
            };

            if result.status == STATUS_EXISTS {
                info!(
                    "File '{}' already exists (file_id: {}), skipping upload",
                    prepared.item.relative_path, result.file_id
                );
                let _ = app_handle.emit("file_uploaded", &prepared.item.relative_path);
                let _ = app_handle.emit("upload_success", &prepared.item.relative_path);
                emit_file_upload_status(
                    &prepared.item.relative_path,
                    STATUS_UPLOADED,
                    None,
                    &app_handle,
                );
                {
                    let mut progress = upload_progress.lock().unwrap();
                    progress.total_uploaded += 1;
                    let _ = app_handle.emit("upload_progress", &*progress);
                }
                continue;
            }

            if result.status != STATUS_NEEDS_UPLOAD {
                continue;
            }

            let upload_url = match result.upload_url {
                Some(url) => url,
                None => {
                    warn!(
                        "File '{}' needs upload but no URL provided, re-queuing",
                        prepared.item.relative_path
                    );
                    upload_queue
                        .lock()
                        .unwrap()
                        .push_back(prepared.item.clone());
                    continue;
                }
            };

            // Spawn concurrent upload task
            let permit = semaphore.clone().acquire_owned().await.unwrap();
            let config_clone = config.clone();
            let client_clone = http_client.clone();
            let app_clone = app_handle.clone();
            let queue_clone = upload_queue.clone();
            let progress_clone = upload_progress.clone();
            let file_id = result.file_id.clone();
            let mut item = prepared.item.clone();
            let file_content = prepared.file_content.clone();
            let content_type = prepared.content_type.clone();

            tauri::async_runtime::spawn(async move {
                let result = upload_file(
                    &item,
                    file_content,
                    &content_type,
                    &upload_url,
                    &file_id,
                    &config_clone,
                    &client_clone,
                    &app_clone,
                )
                .await;

                match result {
                    Ok(file_id) => {
                        debug!(
                            "Upload completed for: {} (file_id: {})",
                            item.relative_path, file_id
                        );
                        let _ = app_clone.emit("upload_success", &item.relative_path);
                        {
                            let mut progress = progress_clone.lock().unwrap();
                            progress.total_uploaded += 1;
                            progress.total_queued = queue_clone.lock().unwrap().len();
                            let _ = app_clone.emit("upload_progress", &*progress);
                        }
                    }
                    Err(e) => {
                        item.retry_count += 1;
                        if item.retry_count < MAX_RETRY_COUNT {
                            warn!(
                                "Upload failed for '{}' (attempt {}/{}), will retry: {}",
                                item.relative_path, item.retry_count, MAX_RETRY_COUNT, e
                            );
                            item.timestamp = now_millis();
                            queue_clone.lock().unwrap().push_back(item);
                        } else {
                            error!(
                                "Upload permanently failed for '{}' after {} attempts: {}",
                                item.relative_path, MAX_RETRY_COUNT, e
                            );
                            let _ =
                                app_clone.emit("upload_failed", (&item.relative_path, e.clone()));
                            emit_file_upload_status(
                                &item.relative_path,
                                STATUS_FAILED,
                                Some(e),
                                &app_clone,
                            );
                            {
                                let mut progress = progress_clone.lock().unwrap();
                                progress.total_failed += 1;
                                progress.total_queued = queue_clone.lock().unwrap().len();
                                let _ = app_clone.emit("upload_progress", &*progress);
                            }
                        }
                    }
                }

                drop(permit);
            });

            sleep(UPLOAD_SPAWN_DELAY).await;
        }

        sleep(BATCH_PROCESSING_DELAY).await;
    }
}

// ── Tauri commands ──────────────────────────────────────────────────────

#[tauri::command]
pub fn get_upload_config(
    upload_config: tauri::State<'_, UploadConfigState>,
) -> Result<UploadConfig, String> {
    Ok(upload_config.lock().unwrap().clone())
}

#[tauri::command]
pub fn set_upload_config(
    config: UploadConfig,
    upload_config: tauri::State<'_, UploadConfigState>,
) -> Result<String, String> {
    *upload_config.lock().unwrap() = config;
    Ok("Upload configuration updated".to_string())
}

#[tauri::command]
pub fn get_upload_progress(
    upload_progress: tauri::State<'_, UploadProgressState>,
) -> Result<UploadProgress, String> {
    Ok(upload_progress.lock().unwrap().clone())
}

#[tauri::command]
pub fn clear_upload_queue(upload_queue: tauri::State<'_, UploadQueue>) -> Result<String, String> {
    upload_queue.lock().unwrap().clear();
    Ok("Upload queue cleared".to_string())
}

#[tauri::command]
pub fn get_queue_size(upload_queue: tauri::State<'_, UploadQueue>) -> Result<usize, String> {
    Ok(upload_queue.lock().unwrap().len())
}

#[tauri::command]
pub async fn trigger_manual_upload(
    file_path: String,
    base_path: String,
    upload_queue: tauri::State<'_, UploadQueue>,
    upload_config: tauri::State<'_, UploadConfigState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    add_to_upload_queue_sync(
        file_path.clone(),
        base_path,
        upload_queue.inner(),
        upload_config.inner(),
        &app_handle,
    );
    Ok(format!("File queued for upload: {file_path}"))
}
