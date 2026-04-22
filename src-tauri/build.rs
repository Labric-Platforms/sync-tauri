fn main() {
    println!("cargo:rerun-if-changed=../.env.local");
    println!("cargo:rerun-if-changed=../.env.production");
    println!("cargo:rerun-if-env-changed=VITE_SERVER_URL");

    dotenvy::from_path("../.env.local")
        .or_else(|_| dotenvy::from_path("../.env.production"))
        .ok();

    if let Ok(url) = std::env::var("VITE_SERVER_URL") {
        println!("cargo:rustc-env=VITE_SERVER_URL={url}");
    }

    tauri_build::build()
}
