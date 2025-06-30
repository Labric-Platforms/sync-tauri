use machine_uid;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use sysinfo::System;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)]
struct FileChangeEvent {
    path: String,
    event_type: String,
    timestamp: u64,
}

#[derive(Clone, Serialize, Deserialize)]
struct DeviceInfo {
    hostname: String,
    platform: String,
    release: String,
    arch: String,
    cpus: usize,
    total_memory: u64, // in GB
    os_type: String,
    device_id: String,
    device_fingerprint: String,
}

// Global watcher state
type WatcherState = Arc<Mutex<Option<RecommendedWatcher>>>;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn read_folder_contents(folder_path: String) -> Result<Vec<String>, String> {
    let path = Path::new(&folder_path);

    if !path.exists() {
        return Err("Folder does not exist".to_string());
    }

    if !path.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    match fs::read_dir(path) {
        Ok(entries) => {
            let mut contents = Vec::new();
            for entry in entries {
                match entry {
                    Ok(entry) => {
                        let file_name = entry.file_name().to_string_lossy().to_string();
                        let is_dir = entry.path().is_dir();
                        let entry_type = if is_dir { "📁" } else { "📄" };
                        contents.push(format!("{} {}", entry_type, file_name));
                    }
                    Err(_) => continue,
                }
            }
            contents.sort();
            Ok(contents)
        }
        Err(e) => Err(format!("Failed to read directory: {}", e)),
    }
}

#[tauri::command]
async fn start_watching(
    folder_path: String,
    app_handle: AppHandle,
    watcher_state: tauri::State<'_, WatcherState>,
) -> Result<String, String> {
    // Stop any existing watcher
    {
        let mut watcher = watcher_state.lock().unwrap();
        *watcher = None;
    }

    // First, capture initial folder contents
    capture_initial_contents(&folder_path, &app_handle)?;

    let app_handle_clone = app_handle.clone();

    // Create file watcher
    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            let event_type = match event.kind {
                notify::EventKind::Create(_) => "created",
                notify::EventKind::Modify(_) => "modified",
                notify::EventKind::Remove(_) => "deleted",
                _ => "other",
            };

            for path in event.paths {
                let file_change = FileChangeEvent {
                    path: path.to_string_lossy().to_string(),
                    event_type: event_type.to_string(),
                    timestamp: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs(),
                };

                // Send to frontend
                let _ = app_handle_clone.emit("file_change", &file_change);
            }
        }
    })
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    // Start watching the folder
    watcher
        .watch(Path::new(&folder_path), RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch folder: {}", e))?;

    // Store the watcher
    {
        let mut watcher_state = watcher_state.lock().unwrap();
        *watcher_state = Some(watcher);
    }

    Ok(format!("Started watching: {}", folder_path))
}

fn capture_initial_contents(folder_path: &str, app_handle: &AppHandle) -> Result<(), String> {
    use std::fs;

    fn walk_directory(dir: &Path, app_handle: &AppHandle) -> std::io::Result<()> {
        if dir.is_dir() {
            for entry in fs::read_dir(dir)? {
                let entry = entry?;
                let path = entry.path();

                // Emit initial file as "initial" event type
                let file_change = FileChangeEvent {
                    path: path.to_string_lossy().to_string(),
                    event_type: "initial".to_string(),
                    timestamp: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs(),
                };

                let _ = app_handle.emit("file_change", &file_change);

                if path.is_dir() {
                    walk_directory(&path, app_handle)?;
                }
            }
        }
        Ok(())
    }

    let path = Path::new(folder_path);
    walk_directory(path, app_handle)
        .map_err(|e| format!("Failed to capture initial contents: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn stop_watching(watcher_state: tauri::State<'_, WatcherState>) -> Result<String, String> {
    let mut watcher = watcher_state.lock().unwrap();
    *watcher = None;
    Ok("Stopped watching".to_string())
}

fn get_device_id_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    if !app_data_dir.exists() {
        fs::create_dir_all(&app_data_dir)
            .map_err(|e| format!("Failed to create app directory: {}", e))?;
    }

    Ok(app_data_dir.join("device_id.txt"))
}

fn get_device_id(app_handle: &AppHandle) -> Result<String, String> {
    let id_file_path = get_device_id_path(app_handle)?;

    if id_file_path.exists() {
        fs::read_to_string(&id_file_path)
            .map_err(|e| format!("Failed to read device ID file: {}", e))
    } else {
        let new_id = Uuid::new_v4().to_string();
        fs::write(&id_file_path, &new_id)
            .map_err(|e| format!("Failed to write device ID file: {}", e))?;
        Ok(new_id)
    }
}

fn get_device_fingerprint() -> Result<String, String> {
    let machine_id = machine_uid::get().map_err(|e| format!("Failed to get machine ID: {}", e))?;

    let mut hasher = Sha256::new();
    hasher.update(machine_id.as_bytes());
    let result = hasher.finalize();

    Ok(format!("{:x}", result))
}

#[tauri::command]
fn get_hostname() -> Result<String, String> {
    use std::env;

    // Try different environment variables for hostname
    if let Ok(hostname) = env::var("HOSTNAME") {
        return Ok(hostname);
    }
    if let Ok(hostname) = env::var("COMPUTERNAME") {
        return Ok(hostname);
    }

    // Try using sysinfo
    let mut sys = System::new();
    sys.refresh_all();

    // Fallback to "Unknown"
    Ok("Unknown".to_string())
}

#[tauri::command]
fn get_device_info(app_handle: AppHandle) -> Result<DeviceInfo, String> {
    let mut sys = System::new_all();
    sys.refresh_all();

    let device_id = get_device_id(&app_handle)?;
    let device_fingerprint = get_device_fingerprint()?;

    // Get hostname from environment variables
    let hostname = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "Unknown".to_string());

    let platform = if cfg!(target_os = "windows") {
        "Windows"
    } else if cfg!(target_os = "macos") {
        "macOS"
    } else if cfg!(target_os = "linux") {
        "Linux"
    } else {
        "Unknown"
    };

    let arch = if cfg!(target_arch = "x86_64") {
        "x64"
    } else if cfg!(target_arch = "aarch64") {
        "arm64"
    } else if cfg!(target_arch = "x86") {
        "x86"
    } else {
        std::env::consts::ARCH
    };

    // Get OS version using standard library
    let release = if cfg!(target_os = "macos") {
        std::process::Command::new("sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| "Unknown".to_string())
    } else if cfg!(target_os = "windows") {
        std::env::var("OS").unwrap_or_else(|_| "Windows".to_string())
    } else {
        // Linux - try to read from /etc/os-release
        std::fs::read_to_string("/etc/os-release")
            .ok()
            .and_then(|content| {
                content
                    .lines()
                    .find(|line| line.starts_with("PRETTY_NAME="))
                    .map(|line| {
                        line.split('=')
                            .nth(1)
                            .unwrap_or("Unknown")
                            .trim_matches('"')
                            .to_string()
                    })
            })
            .unwrap_or_else(|| "Linux".to_string())
    };

    Ok(DeviceInfo {
        hostname,
        platform: platform.to_string(),
        release,
        arch: arch.to_string(),
        cpus: sys.cpus().len(),
        total_memory: sys.total_memory() / (1024 * 1024 * 1024), // Convert to GB
        os_type: platform.to_string(),
        device_id,
        device_fingerprint,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let watcher_state: WatcherState = Arc::new(Mutex::new(None));

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(watcher_state)
        .invoke_handler(tauri::generate_handler![
            greet,
            read_folder_contents,
            start_watching,
            stop_watching,
            get_hostname,
            get_device_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
