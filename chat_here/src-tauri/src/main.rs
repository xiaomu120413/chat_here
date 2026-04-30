use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::process::Command;
use std::process::Stdio;
use std::time::{SystemTime, UNIX_EPOCH};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! This message comes from the Tauri Rust backend.", name)
}

#[derive(Debug, Deserialize)]
struct OpenAiResponseRequest {
    agent: String,
    #[serde(rename = "baseUrl")]
    base_url: String,
    model: String,
    input: Value,
}

#[derive(Debug, Deserialize)]
struct CodexExecRequest {
    model: String,
    input: Value,
}

#[derive(Debug, Deserialize)]
struct CopilotExecRequest {
    model: String,
    input: Value,
}

#[derive(Debug, Serialize)]
struct OpenAiError {
    message: String,
}

#[derive(Debug, Deserialize)]
struct AuthStartRequest {
    agent: String,
}

#[derive(Debug, Serialize)]
struct AuthStartResult {
    agent: String,
    started: bool,
    message: String,
}

#[derive(Debug, Serialize)]
struct OpenAiHealth {
    provider: String,
    ready: bool,
    message: String,
    agents: OpenAiAgentHealth,
}

#[derive(Debug, Serialize)]
struct OpenAiAgentHealth {
    codex: OpenAiAgentAuth,
    copilot: OpenAiAgentAuth,
}

#[derive(Debug, Serialize)]
struct OpenAiAgentAuth {
    ready: bool,
    message: String,
}

#[tauri::command]
fn openai_health() -> OpenAiHealth {
    let codex = agent_auth_status("codex");
    let copilot = agent_auth_status("copilot");
    let ready = codex.ready && copilot.ready;
    let message = if ready {
        "OpenAI auth is ready for Codex and Copilot"
    } else {
        "OpenAI auth is missing for one or more agents"
    };

    OpenAiHealth {
        provider: "tauri_openai".to_string(),
        ready,
        message: message.to_string(),
        agents: OpenAiAgentHealth { codex, copilot },
    }
}

#[tauri::command]
fn start_agent_auth(request: AuthStartRequest) -> Result<AuthStartResult, OpenAiError> {
    let (title, command) = match request.agent.as_str() {
        "codex" => ("Codex Login", "cmd /C codex login"),
        "copilot" => ("GitHub Copilot Login", "cmd /C copilot login"),
        _ => {
            return Err(OpenAiError {
                message: format!("unsupported auth agent: {}", request.agent),
            });
        }
    };

    let script = format!(
        "Start-Process powershell -ArgumentList @('-NoExit','-Command','{}')",
        command
    );

    Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .spawn()
        .map_err(|error| OpenAiError {
            message: format!("failed to start {title}: {error}"),
        })?;

    Ok(AuthStartResult {
        agent: request.agent,
        started: true,
        message: format!("started {command}"),
    })
}

#[tauri::command]
async fn openai_response(request: OpenAiResponseRequest) -> Result<Value, OpenAiError> {
    let api_key = resolve_agent_api_key(&request.agent)?;

    let base_url = request.base_url.trim_end_matches('/');
    let url = format!("{base_url}/responses");

    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": request.model,
            "input": request.input,
        }))
        .send()
        .await
        .map_err(|error| OpenAiError {
            message: format!("OpenAI request failed: {error}"),
        })?;

    let status = response.status();
    let payload = response.json::<Value>().await.map_err(|error| OpenAiError {
        message: format!("OpenAI response was not valid JSON: {error}"),
    })?;

    if !status.is_success() {
        let message = payload
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("OpenAI request failed");
        return Err(OpenAiError {
            message: format!("{message} (status {status})"),
        });
    }

    Ok(payload)
}

#[tauri::command]
async fn codex_exec_response(request: CodexExecRequest) -> Result<Value, OpenAiError> {
    let prompt = input_to_prompt(&request.input);
    let model = request.model;

    tauri::async_runtime::spawn_blocking(move || run_codex_exec(model, prompt))
        .await
        .map_err(|error| OpenAiError {
            message: format!("failed to join codex exec task: {error}"),
        })?
}

#[tauri::command]
async fn copilot_exec_response(request: CopilotExecRequest) -> Result<Value, OpenAiError> {
    let prompt = input_to_prompt(&request.input);
    let model = request.model;

    tauri::async_runtime::spawn_blocking(move || run_copilot_exec(model, prompt))
        .await
        .map_err(|error| OpenAiError {
            message: format!("failed to join copilot CLI task: {error}"),
        })?
}

fn agent_auth_status(agent: &str) -> OpenAiAgentAuth {
    if agent == "codex" {
        if read_codex_auth_token().is_some() {
            return OpenAiAgentAuth {
                ready: true,
                message: "codex login is ready".to_string(),
            };
        }
    }

    if agent == "copilot" {
        if is_copilot_auth_ready() {
            return OpenAiAgentAuth {
                ready: true,
                message: "copilot login is ready".to_string(),
            };
        }
    }

    match resolve_agent_api_key(agent) {
        Ok(_) => OpenAiAgentAuth {
            ready: true,
            message: format!("{agent} OpenAI auth is ready"),
        },
        Err(error) => OpenAiAgentAuth { ready: false, message: error.message },
    }
}

fn is_copilot_auth_ready() -> bool {
    if read_env_secret("COPILOT_GITHUB_TOKEN").is_some()
        || read_env_secret("GH_TOKEN").is_some()
        || read_env_secret("GITHUB_TOKEN").is_some()
    {
        return true;
    }

    Command::new("gh")
        .args(["auth", "status"])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn resolve_agent_api_key(agent: &str) -> Result<String, OpenAiError> {
    let specific_key = match agent {
        "codex" => "CODEX_OPENAI_API_KEY",
        "copilot" => "COPILOT_OPENAI_API_KEY",
        _ => {
            return Err(OpenAiError {
                message: format!("unsupported OpenAI agent: {agent}"),
            });
        }
    };

    read_env_secret(specific_key)
        .or_else(|| read_env_secret("OPENAI_API_KEY"))
        .ok_or_else(|| OpenAiError {
            message: format!("{specific_key} or OPENAI_API_KEY is not available for API requests"),
        })
}

fn read_env_secret(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn read_codex_auth_token() -> Option<String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()?;
    let auth_path = std::path::Path::new(&home).join(".codex").join("auth.json");
    let raw = std::fs::read_to_string(auth_path).ok()?;
    let payload: Value = serde_json::from_str(&raw).ok()?;
    payload
        .get("OPENAI_API_KEY")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            payload
                .pointer("/tokens/access_token")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
}

fn input_to_prompt(input: &Value) -> String {
    let mut parts = Vec::new();
    if let Some(items) = input.as_array() {
        for item in items {
            let role = item.get("role").and_then(Value::as_str).unwrap_or("user");
            let content = item.get("content").and_then(Value::as_str).unwrap_or("");
            if !content.trim().is_empty() {
                parts.push(format!("{role}: {content}"));
            }
        }
    }

    if parts.is_empty() {
        input.to_string()
    } else {
        parts.join("\n\n")
    }
}

fn run_codex_exec(model: String, prompt: String) -> Result<Value, OpenAiError> {
    let output_path = create_temp_output_path("codex-last-message", "txt")?;
    let mut child = Command::new("cmd")
        .args([
            "/C",
            "codex",
            "exec",
            "--skip-git-repo-check",
            "--model",
            &model,
            "--output-last-message",
            output_path.to_string_lossy().as_ref(),
            "-",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| OpenAiError {
            message: format!("failed to start codex exec: {error}"),
        })?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .map_err(|error| OpenAiError {
                message: format!("failed to write codex prompt: {error}"),
            })?;
    }

    let output = child.wait_with_output().map_err(|error| OpenAiError {
        message: format!("failed to wait for codex exec: {error}"),
    })?;

    let file_output = read_and_cleanup_output_file(&output_path);
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if output.status.success() {
        if let Some(text) = file_output {
            if !text.is_empty() {
                return Ok(serde_json::json!({ "output_text": text }));
            }
        }

        if !stdout.is_empty() {
            return Ok(serde_json::json!({ "output_text": stdout }));
        }
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        return Err(OpenAiError {
            message: if stderr.is_empty() {
                format!("codex exec failed with status {}", output.status)
            } else {
                stderr
            },
        });
    }

    Err(OpenAiError {
        message: "codex exec returned empty output".to_string(),
    })
}

fn run_copilot_exec(model: String, prompt: String) -> Result<Value, OpenAiError> {
    let copilot_loader = resolve_copilot_loader()?;
    let output = Command::new("node")
        .args([
            copilot_loader.to_string_lossy().as_ref(),
            "-p",
            &prompt,
            "--model",
            &model,
            "--allow-all-tools",
            "--silent",
        ])
        .output()
        .map_err(|error| OpenAiError {
            message: format!("failed to start copilot CLI: {error}"),
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(OpenAiError {
            message: if stderr.is_empty() {
                format!("copilot CLI failed with status {}", output.status)
            } else {
                stderr
            },
        });
    }

    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        return Err(OpenAiError {
            message: "copilot CLI returned empty output".to_string(),
        });
    }

    Ok(serde_json::json!({ "output_text": text }))
}

fn resolve_copilot_loader() -> Result<std::path::PathBuf, OpenAiError> {
    let app_data = std::env::var("APPDATA").map_err(|error| OpenAiError {
        message: format!("failed to resolve APPDATA for Copilot CLI: {error}"),
    })?;
    let loader = std::path::Path::new(&app_data)
        .join("npm")
        .join("node_modules")
        .join("@github")
        .join("copilot")
        .join("npm-loader.js");

    if loader.is_file() {
        Ok(loader)
    } else {
        Err(OpenAiError {
            message: format!("Copilot CLI loader was not found at {}", loader.display()),
        })
    }
}

fn create_temp_output_path(prefix: &str, extension: &str) -> Result<std::path::PathBuf, OpenAiError> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| OpenAiError {
            message: format!("failed to build temp path timestamp: {error}"),
        })?
        .as_nanos();

    Ok(std::env::temp_dir().join(format!("{prefix}-{nonce}.{extension}")))
}

fn read_and_cleanup_output_file(path: &std::path::Path) -> Option<String> {
    let content = fs::read_to_string(path)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let _ = fs::remove_file(path);
    content
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            greet,
            openai_health,
            start_agent_auth,
            codex_exec_response,
            copilot_exec_response,
            openai_response
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
