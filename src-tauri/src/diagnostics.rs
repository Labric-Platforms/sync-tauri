use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::error::Error as StdError;
use std::time::{Duration, Instant};
use tauri::AppHandle;

#[derive(Clone, Serialize, Deserialize)]
pub struct DiagnosticCheck {
    pub name: String,
    pub label: String,
    pub passed: bool,
    pub duration_ms: u64,
    pub detail: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct NetworkDiagnostics {
    pub checks: Vec<DiagnosticCheck>,
    pub proxy_env: Vec<(String, String)>,
    pub server_url: String,
    pub app_version: String,
    pub timestamp: String,
}

fn describe_error(err: &(dyn StdError + 'static)) -> String {
    let mut parts = vec![err.to_string()];
    let mut source = err.source();
    while let Some(e) = source {
        parts.push(e.to_string());
        source = e.source();
    }
    parts.join(" -> ")
}

fn classify_reqwest_error(e: &reqwest::Error) -> String {
    let mut tags = Vec::new();
    if e.is_timeout() {
        tags.push("timeout");
    }
    if e.is_connect() {
        tags.push("connect");
    }
    let chain = describe_error(e).to_lowercase();
    if chain.contains("certificate")
        || chain.contains("tls")
        || chain.contains("ssl")
        || chain.contains("handshake")
    {
        tags.push("tls");
    }
    if tags.is_empty() {
        String::new()
    } else {
        format!("[{}] ", tags.join(","))
    }
}

async fn check_dns(host: &str) -> DiagnosticCheck {
    let start = Instant::now();
    let result = tokio::net::lookup_host((host, 443)).await;
    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(addrs) => {
            let ips: Vec<String> = addrs.map(|a| a.ip().to_string()).collect();
            let detail = if ips.is_empty() {
                "Resolved but no addresses returned".to_string()
            } else {
                format!("Resolved to: {}", ips.join(", "))
            };
            DiagnosticCheck {
                name: "dns_resolve".to_string(),
                label: format!("DNS resolution for {host}"),
                passed: !ips.is_empty(),
                duration_ms,
                detail,
            }
        }
        Err(e) => DiagnosticCheck {
            name: "dns_resolve".to_string(),
            label: format!("DNS resolution for {host}"),
            passed: false,
            duration_ms,
            detail: describe_error(&e),
        },
    }
}

async fn check_server_reach(server_url: &str) -> DiagnosticCheck {
    let client = match reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return DiagnosticCheck {
                name: "server_reach".to_string(),
                label: "Reach Labric server".to_string(),
                passed: false,
                duration_ms: 0,
                detail: format!("Failed to build HTTP client: {}", describe_error(&e)),
            };
        }
    };

    let base = server_url.trim_end_matches('/');
    let start = Instant::now();
    let result = client.get(base).send().await;
    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(resp) => {
            let status = resp.status();
            DiagnosticCheck {
                name: "server_reach".to_string(),
                label: "Reach Labric server".to_string(),
                passed: !status.is_server_error(),
                duration_ms,
                detail: format!("HTTP {status}"),
            }
        }
        Err(e) => DiagnosticCheck {
            name: "server_reach".to_string(),
            label: "Reach Labric server".to_string(),
            passed: false,
            duration_ms,
            detail: format!("{}{}", classify_reqwest_error(&e), describe_error(&e)),
        },
    }
}

async fn check_pair_endpoint(server_url: &str) -> DiagnosticCheck {
    let url = format!("{}/api/sync/get-code", server_url.trim_end_matches('/'));
    let client = match reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return DiagnosticCheck {
                name: "pair_endpoint".to_string(),
                label: "Pair code endpoint reachable".to_string(),
                passed: false,
                duration_ms: 0,
                detail: format!("Failed to build HTTP client: {}", describe_error(&e)),
            };
        }
    };

    let start = Instant::now();
    // Intentionally send an empty body — we only care whether the request reaches the server.
    // A 4xx response still proves connectivity.
    let result = client
        .post(&url)
        .header("Content-Type", "application/json")
        .body("{}")
        .send()
        .await;
    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(resp) => {
            let status = resp.status();
            DiagnosticCheck {
                name: "pair_endpoint".to_string(),
                label: "Pair code endpoint reachable".to_string(),
                passed: !status.is_server_error(),
                duration_ms,
                detail: format!(
                    "HTTP {status} (any non-5xx response means the request reached the server)"
                ),
            }
        }
        Err(e) => DiagnosticCheck {
            name: "pair_endpoint".to_string(),
            label: "Pair code endpoint reachable".to_string(),
            passed: false,
            duration_ms,
            detail: format!("{}{}", classify_reqwest_error(&e), describe_error(&e)),
        },
    }
}

fn collect_proxy_env() -> Vec<(String, String)> {
    let keys = [
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "no_proxy",
        "ALL_PROXY",
        "all_proxy",
    ];
    keys.iter()
        .filter_map(|k| std::env::var(k).ok().map(|v| (k.to_string(), v)))
        .collect()
}

#[tauri::command]
pub async fn run_network_diagnostics(
    server_url: String,
    app_handle: AppHandle,
) -> Result<NetworkDiagnostics, String> {
    let parsed = Url::parse(&server_url)
        .map_err(|e| format!("Invalid server URL {server_url:?}: {e}"))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| format!("Server URL has no host: {server_url}"))?
        .to_string();

    let (dns, reach, pair) = tokio::join!(
        check_dns(&host),
        check_server_reach(&server_url),
        check_pair_endpoint(&server_url),
    );

    Ok(NetworkDiagnostics {
        checks: vec![dns, reach, pair],
        proxy_env: collect_proxy_env(),
        server_url,
        app_version: app_handle.package_info().version.to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
    })
}
