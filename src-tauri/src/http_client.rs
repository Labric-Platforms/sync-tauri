use reqwest::{Client, Response};
use std::sync::Arc;

/// Shared HTTP client for connection pooling across all modules.
pub type SharedHttpClient = Arc<Client>;

pub fn create_shared_client() -> SharedHttpClient {
    Arc::new(Client::new())
}

/// Check an HTTP response status and return a descriptive error if it failed.
/// On success, returns the response unchanged for further processing.
pub async fn check_response(response: Response, context: &str) -> Result<Response, String> {
    if response.status().is_success() {
        return Ok(response);
    }

    let status = response.status();
    let body = response
        .text()
        .await
        .unwrap_or_else(|_| "Unable to read response".to_string());
    Err(format!("{context} failed with status {status}: {body}"))
}
