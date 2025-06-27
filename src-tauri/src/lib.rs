use std::fs;
use std::path::Path;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![greet, read_folder_contents])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
