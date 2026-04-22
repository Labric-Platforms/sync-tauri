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

async fn check_dns(host: &str, port: u16) -> (DiagnosticCheck, Vec<std::net::SocketAddr>) {
    let start = Instant::now();
    // Port is only required by the SocketAddr returned from lookup_host; DNS resolution itself
    // doesn't use it, so any valid port works here.
    let result = tokio::net::lookup_host((host, port)).await;
    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(addrs) => {
            let addrs: Vec<std::net::SocketAddr> = addrs.collect();
            let ips: Vec<String> = addrs.iter().map(|a| a.ip().to_string()).collect();
            let detail = if ips.is_empty() {
                "Resolved but no addresses returned".to_string()
            } else {
                format!("Resolved to: {}", ips.join(", "))
            };
            let check = DiagnosticCheck {
                name: "dns_resolve".to_string(),
                label: format!("DNS resolution for {host}"),
                passed: !ips.is_empty(),
                duration_ms,
                detail,
            };
            (check, addrs)
        }
        Err(e) => (
            DiagnosticCheck {
                name: "dns_resolve".to_string(),
                label: format!("DNS resolution for {host}"),
                passed: false,
                duration_ms,
                detail: describe_error(&e),
            },
            Vec::new(),
        ),
    }
}

async fn check_tcp_connect(host: &str, port: u16, addrs: &[std::net::SocketAddr]) -> DiagnosticCheck {
    let label = format!("TCP connect to {host}:{port}");
    if addrs.is_empty() {
        return DiagnosticCheck {
            name: "tcp_connect".to_string(),
            label,
            passed: false,
            duration_ms: 0,
            detail: "Skipped: DNS did not resolve any addresses".to_string(),
        };
    }

    let start = Instant::now();
    // Try each resolved address in order; pass on the first success. This mirrors how a
    // client library would walk the list, and surfaces the case where IPv6 resolves but
    // only IPv4 is reachable (or vice versa).
    let mut last_err: Option<String> = None;
    for addr in addrs {
        let attempt = tokio::time::timeout(
            Duration::from_secs(5),
            tokio::net::TcpStream::connect(addr),
        )
        .await;
        match attempt {
            Ok(Ok(_)) => {
                let duration_ms = start.elapsed().as_millis() as u64;
                return DiagnosticCheck {
                    name: "tcp_connect".to_string(),
                    label,
                    passed: true,
                    duration_ms,
                    detail: format!("Connected to {addr}"),
                };
            }
            Ok(Err(e)) => last_err = Some(format!("{addr}: {}", describe_error(&e))),
            Err(_) => last_err = Some(format!("{addr}: timeout after 5s")),
        }
    }

    let duration_ms = start.elapsed().as_millis() as u64;
    DiagnosticCheck {
        name: "tcp_connect".to_string(),
        label,
        passed: false,
        duration_ms,
        detail: last_err.unwrap_or_else(|| "No addresses attempted".to_string()),
    }
}

async fn check_server_reach(client: &reqwest::Client, server_url: &str) -> DiagnosticCheck {
    let base = server_url.trim_end_matches('/');
    let start = Instant::now();
    let result = client.get(base).timeout(Duration::from_secs(10)).send().await;
    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(resp) => {
            let status = resp.status();
            DiagnosticCheck {
                name: "server_reach".to_string(),
                label: "Labric server responds (HTTPS)".to_string(),
                passed: !status.is_server_error(),
                duration_ms,
                detail: format!(
                    "HTTP {status} (any non-5xx response means TLS + the server are working)"
                ),
            }
        }
        Err(e) => DiagnosticCheck {
            name: "server_reach".to_string(),
            label: "Labric server responds (HTTPS)".to_string(),
            passed: false,
            duration_ms,
            detail: format!("{}{}", classify_reqwest_error(&e), describe_error(&e)),
        },
    }
}

async fn check_pair_endpoint(client: &reqwest::Client, server_url: &str) -> DiagnosticCheck {
    let url = format!("{}/api/sync/get-code", server_url.trim_end_matches('/'));
    let start = Instant::now();
    // Intentionally send an empty body — we only care whether the request reaches the server.
    // A 4xx response still proves connectivity.
    let result = client
        .post(&url)
        .header("Content-Type", "application/json")
        .body("{}")
        .timeout(Duration::from_secs(15))
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
    let port = parsed.port_or_known_default().unwrap_or(443);
    // Strip any path/query/fragment so credentials or tokens never land in the copied report.
    let sanitized_url = format!("{}://{}", parsed.scheme(), parsed.authority());

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", describe_error(&e)))?;

    // DNS runs first because the TCP check reuses its resolved addresses. The two HTTPS
    // checks run in parallel alongside TCP.
    let (dns_check, addrs) = check_dns(&host, port).await;
    let (tcp, reach, pair) = tokio::join!(
        check_tcp_connect(&host, port, &addrs),
        check_server_reach(&client, &server_url),
        check_pair_endpoint(&client, &server_url),
    );

    Ok(NetworkDiagnostics {
        checks: vec![dns_check, tcp, reach, pair],
        proxy_env: collect_proxy_env(),
        server_url: sanitized_url,
        app_version: app_handle.package_info().version.to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
    })
}
