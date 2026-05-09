use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::io::{BufRead, BufReader, Read};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::process::Command;
use std::process::Stdio;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use rand::{distributions::Alphanumeric, Rng};

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

#[derive(Default)]
struct GatewayState {
    service: Mutex<Option<GatewayService>>,
}

struct GatewayService {
    host: String,
    port: u16,
    token: String,
    lan_ip: Option<String>,
    stop: Arc<AtomicBool>,
}

#[derive(Clone)]
struct GatewayShared {
    db: Arc<Mutex<GatewayDb>>,
    subscribers: Arc<Mutex<Vec<mpsc::Sender<GatewayEventRecord>>>>,
}

impl Default for GatewayShared {
    fn default() -> Self {
        Self {
            db: Arc::new(Mutex::new(GatewayDb::default())),
            subscribers: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

#[derive(Default)]
struct GatewayDb {
    threads: HashMap<String, GatewayThread>,
    messages_by_thread: HashMap<String, Vec<GatewayMessage>>,
    events_by_thread: HashMap<String, Vec<GatewayEventRecord>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct GatewayThread {
    id: String,
    title: String,
    status: String,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct GatewayMessage {
    id: String,
    #[serde(rename = "threadId")]
    thread_id: String,
    kind: String,
    source: GatewayMessageSource,
    #[serde(rename = "targetAgents")]
    target_agents: Vec<String>,
    content: String,
    #[serde(rename = "createdAt")]
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct GatewayMessageSource {
    #[serde(rename = "type")]
    source_type: String,
    id: String,
    name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct GatewayEventRecord {
    id: String,
    #[serde(rename = "threadId")]
    thread_id: String,
    #[serde(rename = "type")]
    event_type: String,
    cursor: usize,
    payload: Value,
    #[serde(rename = "createdAt")]
    created_at: String,
}

#[derive(Debug, Deserialize)]
struct GatewayStartRequest {
    #[serde(rename = "exposeLan")]
    expose_lan: Option<bool>,
    port: Option<u16>,
}

#[derive(Debug, Serialize, Clone)]
struct GatewayStatus {
    running: bool,
    host: String,
    port: u16,
    #[serde(rename = "localUrl")]
    local_url: String,
    #[serde(rename = "lanUrl")]
    lan_url: Option<String>,
    token: String,
    #[serde(rename = "exposeLan")]
    expose_lan: bool,
    message: String,
}

#[derive(Debug, Serialize)]
struct CliSmokeResult {
    codex: CliSmokeAgentResult,
    copilot: CliSmokeAgentResult,
    ready: bool,
}

#[derive(Debug, Serialize)]
struct CliSmokeAgentResult {
    ok: bool,
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
fn gateway_status(state: tauri::State<GatewayState>) -> Result<GatewayStatus, OpenAiError> {
    let guard = state.service.lock().map_err(|_| OpenAiError {
        message: "gateway state lock poisoned".to_string(),
    })?;

    Ok(match guard.as_ref() {
        Some(service) => build_gateway_status(service, "Gateway is running"),
        None => stopped_gateway_status(),
    })
}

#[tauri::command]
fn start_gateway_service(
    request: GatewayStartRequest,
    state: tauri::State<GatewayState>,
) -> Result<GatewayStatus, OpenAiError> {
    start_gateway_service_inner(&state, request)
}

fn start_gateway_service_inner(
    state: &GatewayState,
    request: GatewayStartRequest,
) -> Result<GatewayStatus, OpenAiError> {
    let mut guard = state.service.lock().map_err(|_| OpenAiError {
        message: "gateway state lock poisoned".to_string(),
    })?;

    if let Some(service) = guard.as_ref() {
        return Ok(build_gateway_status(service, "Gateway is already running"));
    }

    let expose_lan = request.expose_lan.unwrap_or(false);
    let bind_host = if expose_lan { "0.0.0.0" } else { "127.0.0.1" };
    let port = request.port.unwrap_or(17321);
    let listener = TcpListener::bind((bind_host, port)).map_err(|error| OpenAiError {
        message: format!("failed to bind gateway on {bind_host}:{port}: {error}"),
    })?;
    listener.set_nonblocking(true).map_err(|error| OpenAiError {
        message: format!("failed to configure gateway listener: {error}"),
    })?;

    let actual_port = listener
        .local_addr()
        .map_err(|error| OpenAiError {
            message: format!("failed to read gateway listener address: {error}"),
        })?
        .port();
    let token = generate_gateway_token();
    let stop = Arc::new(AtomicBool::new(false));
    let shared = GatewayShared::default();
    let thread_stop = Arc::clone(&stop);
    let thread_token = token.clone();
    let thread_shared = shared.clone();

    thread::spawn(move || run_gateway_listener(listener, thread_token, thread_stop, thread_shared));

    let service = GatewayService {
        host: bind_host.to_string(),
        port: actual_port,
        token,
        lan_ip: if expose_lan { detect_lan_ip() } else { None },
        stop,
    };
    let status = build_gateway_status(&service, "Gateway started");
    *guard = Some(service);

    Ok(status)
}

#[tauri::command]
fn stop_gateway_service(state: tauri::State<GatewayState>) -> Result<GatewayStatus, OpenAiError> {
    let mut guard = state.service.lock().map_err(|_| OpenAiError {
        message: "gateway state lock poisoned".to_string(),
    })?;

    if let Some(service) = guard.take() {
        service.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(("127.0.0.1", service.port));
    }

    Ok(stopped_gateway_status())
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

#[tauri::command]
async fn cli_smoke_test() -> CliSmokeResult {
    let codex = tauri::async_runtime::spawn_blocking(|| {
        run_codex_exec(
            "gpt-5.4".to_string(),
            "Reply with exactly CODEX_SMOKE_OK.".to_string(),
        )
        .map(|payload| smoke_agent_result(payload, "CODEX_SMOKE_OK", "Codex CLI returned CODEX_SMOKE_OK"))
        .unwrap_or_else(|error| CliSmokeAgentResult {
            ok: false,
            message: truncate_message(&error.message),
        })
    })
    .await
    .unwrap_or_else(|error| CliSmokeAgentResult {
        ok: false,
        message: format!("failed to join Codex smoke task: {error}"),
    });

    let copilot = tauri::async_runtime::spawn_blocking(|| {
        run_copilot_exec(
            "gpt-5.4-mini".to_string(),
            "Reply with exactly COPILOT_SMOKE_OK.".to_string(),
        )
        .map(|payload| smoke_agent_result(payload, "COPILOT_SMOKE_OK", "Copilot CLI returned COPILOT_SMOKE_OK"))
        .unwrap_or_else(|error| CliSmokeAgentResult {
            ok: false,
            message: truncate_message(&error.message),
        })
    })
    .await
    .unwrap_or_else(|error| CliSmokeAgentResult {
        ok: false,
        message: format!("failed to join Copilot smoke task: {error}"),
    });

    CliSmokeResult {
        ready: codex.ok && copilot.ok,
        codex,
        copilot,
    }
}

fn smoke_agent_result(payload: Value, expected: &str, success_message: &str) -> CliSmokeAgentResult {
    let text = payload
        .get("output_text")
        .and_then(Value::as_str)
        .unwrap_or_default();
    CliSmokeAgentResult {
        ok: text.contains(expected),
        message: if text.contains(expected) {
            success_message.to_string()
        } else {
            truncate_message(text)
        },
    }
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

fn run_gateway_listener(listener: TcpListener, token: String, stop: Arc<AtomicBool>, shared: GatewayShared) {
    while !stop.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _)) => {
                let request_token = token.clone();
                let request_shared = shared.clone();
                thread::spawn(move || handle_gateway_stream(stream, &request_token, request_shared));
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(40));
            }
            Err(_) => {
                thread::sleep(Duration::from_millis(120));
            }
        }
    }
}

fn handle_gateway_stream(mut stream: TcpStream, token: &str, shared: GatewayShared) {
    let cloned = match stream.try_clone() {
        Ok(value) => value,
        Err(_) => return,
    };
    let mut reader = BufReader::new(cloned);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }

    let mut headers = Vec::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() || line == "\r\n" || line == "\n" || line.is_empty() {
            break;
        }
        headers.push(line);
    }
    let body = read_http_body(&mut reader, &headers);

    let parts = request_line.split_whitespace().collect::<Vec<_>>();
    if parts.len() < 2 {
        write_http_json(&mut stream, 400, serde_json::json!({
            "error": { "code": "BAD_REQUEST", "message": "invalid request line" }
        }));
        return;
    }

    let method = parts[0];
    let target = parts[1];
    let path = target.split('?').next().unwrap_or(target);
    if method == "OPTIONS" {
        write_http_options(&mut stream);
        return;
    }

    if method == "GET" && path == "/api/health" {
        write_http_json(&mut stream, 200, serde_json::json!({
            "ok": true,
            "service": "tauri-gateway",
            "mobileReady": true
        }));
        return;
    }

    if !headers_authorized(&headers, token) && !query_authorized(target, token) {
        write_http_json(&mut stream, 401, serde_json::json!({
            "error": { "code": "UNAUTHORIZED", "message": "missing or invalid gateway token" }
        }));
        return;
    }

    if method == "GET" && path == "/api/stream" {
        open_gateway_sse_stream(stream, shared);
        return;
    }

    match handle_gateway_api(method, path, &body, shared) {
        Ok((status, payload)) => write_http_json(&mut stream, status, payload),
        Err(error) => write_http_json(&mut stream, 500, serde_json::json!({
            "error": { "code": "INTERNAL_ERROR", "message": error }
        })),
    }
}

fn read_http_body(reader: &mut BufReader<TcpStream>, headers: &[String]) -> String {
    let content_length = headers
        .iter()
        .find_map(|header| {
            let trimmed = header.trim();
            trimmed
                .strip_prefix("Content-Length:")
                .or_else(|| trimmed.strip_prefix("content-length:"))
                .and_then(|value| value.trim().parse::<usize>().ok())
        })
        .unwrap_or(0);
    if content_length == 0 {
        return String::new();
    }

    let mut buffer = vec![0; content_length];
    if reader.read_exact(&mut buffer).is_err() {
        return String::new();
    }
    String::from_utf8_lossy(&buffer).to_string()
}

fn handle_gateway_api(
    method: &str,
    path: &str,
    body: &str,
    shared: GatewayShared,
) -> Result<(u16, Value), String> {
    if method == "GET" && path == "/api/threads" {
        let db = shared.db.lock().map_err(|_| "gateway db lock poisoned".to_string())?;
        let mut threads = db.threads.values().cloned().collect::<Vec<_>>();
        threads.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        return Ok((200, serde_json::json!({ "threads": threads })));
    }

    if method == "POST" && path == "/api/threads" {
        let payload = parse_json_body(body)?;
        let title = payload
            .get("title")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("New discussion");
        let now = now_iso();
        let thread = GatewayThread {
            id: create_gateway_id("thread"),
            title: title.to_string(),
            status: "active".to_string(),
            created_at: now.clone(),
            updated_at: now,
        };

        let event = {
            let mut db = shared.db.lock().map_err(|_| "gateway db lock poisoned".to_string())?;
            db.threads.insert(thread.id.clone(), thread.clone());
            append_gateway_event_locked(
                &mut db,
                &thread.id,
                "thread.created",
                serde_json::json!({ "threadId": thread.id }),
            )
        };
        publish_gateway_event(&shared, event.clone());
        return Ok((201, serde_json::json!({ "thread": thread, "event": event })));
    }

    if let Some(thread_id) = match_path(path, "/api/threads/", "") {
        if method == "GET" {
            let db = shared.db.lock().map_err(|_| "gateway db lock poisoned".to_string())?;
            if let Some(thread) = db.threads.get(&thread_id) {
                return Ok((200, serde_json::json!({
                    "thread": thread,
                    "messages": db.messages_by_thread.get(&thread_id).cloned().unwrap_or_default(),
                    "events": db.events_by_thread.get(&thread_id).cloned().unwrap_or_default(),
                    "invocations": []
                })));
            }
            return Ok((404, not_found_payload("thread")));
        }
    }

    if let Some(thread_id) = match_path(path, "/api/threads/", "/messages") {
        if method == "POST" {
            let payload = parse_json_body(body)?;
            let content = payload
                .get("content")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "message.content is required".to_string())?;
            let target_agents = payload
                .get("targetAgents")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let now = now_iso();
            let message = GatewayMessage {
                id: create_gateway_id("msg"),
                thread_id: thread_id.clone(),
                kind: payload
                    .get("kind")
                    .and_then(Value::as_str)
                    .unwrap_or("user")
                    .to_string(),
                source: gateway_message_source_from_payload(&payload),
                target_agents,
                content: content.to_string(),
                created_at: now.clone(),
            };

            let event = {
                let mut db = shared.db.lock().map_err(|_| "gateway db lock poisoned".to_string())?;
                if !db.threads.contains_key(&thread_id) {
                    return Ok((404, not_found_payload("thread")));
                }
                if let Some(thread) = db.threads.get_mut(&thread_id) {
                    thread.updated_at = now;
                }
                db.messages_by_thread
                    .entry(thread_id.clone())
                    .or_default()
                    .push(message.clone());
                append_gateway_event_locked(
                    &mut db,
                    &thread_id,
                    "message.created",
                    serde_json::json!({ "messageId": message.id, "source": message.source }),
                )
            };
            publish_gateway_event(&shared, event.clone());
            return Ok((201, serde_json::json!({ "message": message, "event": event, "dispatch": null })));
        }
    }

    if let Some(thread_id) = match_path(path, "/api/threads/", "/events") {
        if method == "GET" {
            let db = shared.db.lock().map_err(|_| "gateway db lock poisoned".to_string())?;
            if !db.threads.contains_key(&thread_id) {
                return Ok((404, not_found_payload("thread")));
            }
            return Ok((200, serde_json::json!({
                "events": db.events_by_thread.get(&thread_id).cloned().unwrap_or_default()
            })));
        }
    }

    Ok((404, not_found_payload("route")))
}

fn parse_json_body(body: &str) -> Result<Value, String> {
    if body.trim().is_empty() {
        return Ok(serde_json::json!({}));
    }
    serde_json::from_str(body).map_err(|error| format!("request body must be valid JSON: {error}"))
}

fn gateway_message_source_from_payload(payload: &Value) -> GatewayMessageSource {
    let source = payload.get("source").and_then(Value::as_object);
    let source_type = source
        .and_then(|value| value.get("type"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("human");
    let id = source
        .and_then(|value| value.get("id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("user");
    let name = source
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(id);

    GatewayMessageSource {
        source_type: source_type.to_string(),
        id: id.to_string(),
        name: name.to_string(),
    }
}

fn match_path(path: &str, prefix: &str, suffix: &str) -> Option<String> {
    if !path.starts_with(prefix) || !path.ends_with(suffix) {
        return None;
    }
    let end = path.len().checked_sub(suffix.len())?;
    let value = &path[prefix.len()..end];
    if value.is_empty() || value.contains('/') {
        None
    } else {
        Some(value.to_string())
    }
}

fn append_gateway_event_locked(
    db: &mut GatewayDb,
    thread_id: &str,
    event_type: &str,
    payload: Value,
) -> GatewayEventRecord {
    let events = db.events_by_thread.entry(thread_id.to_string()).or_default();
    let cursor = events.len() + 1;
    let event = GatewayEventRecord {
        id: create_gateway_id("event"),
        thread_id: thread_id.to_string(),
        event_type: event_type.to_string(),
        cursor,
        payload,
        created_at: now_iso(),
    };
    events.push(event.clone());
    event
}

fn publish_gateway_event(shared: &GatewayShared, event: GatewayEventRecord) {
    if let Ok(mut subscribers) = shared.subscribers.lock() {
        subscribers.retain(|subscriber| subscriber.send(event.clone()).is_ok());
    }
}

fn open_gateway_sse_stream(mut stream: TcpStream, shared: GatewayShared) {
    let response = concat!(
        "HTTP/1.1 200 OK\r\n",
        "Content-Type: text/event-stream; charset=utf-8\r\n",
        "Cache-Control: no-store\r\n",
        "Connection: keep-alive\r\n",
        "Access-Control-Allow-Origin: *\r\n",
        "\r\n"
    );
    if stream.write_all(response.as_bytes()).is_err() {
        return;
    }
    let _ = stream.write_all(b"id: connected\nevent: gateway.connected\ndata: {\"ok\":true}\n\n");

    let (sender, receiver) = mpsc::channel::<GatewayEventRecord>();
    if let Ok(mut subscribers) = shared.subscribers.lock() {
        subscribers.push(sender);
    }

    loop {
        match receiver.recv_timeout(Duration::from_secs(15)) {
            Ok(event) => {
                let event_id = format!("{}:{}", event.thread_id, event.cursor);
                let payload = match serde_json::to_string(&event) {
                    Ok(value) => value,
                    Err(_) => continue,
                };
                let frame = format!(
                    "id: {event_id}\nevent: {}\ndata: {payload}\n\n",
                    event.event_type
                );
                if stream.write_all(frame.as_bytes()).is_err() {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if stream.write_all(b": keepalive\n\n").is_err() {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn not_found_payload(resource: &str) -> Value {
    serde_json::json!({
        "error": { "code": "NOT_FOUND", "message": format!("{resource} not found") }
    })
}

fn headers_authorized(headers: &[String], token: &str) -> bool {
    let expected = format!("bearer {}", token.to_ascii_lowercase());
    headers.iter().any(|header| {
        let lower = header.trim().to_ascii_lowercase();
        lower.strip_prefix("authorization:")
            .map(|value| value.trim() == expected)
            .unwrap_or(false)
    })
}

fn query_authorized(target: &str, token: &str) -> bool {
    target
        .split_once('?')
        .map(|(_, query)| {
            query.split('&').any(|part| {
                part.split_once('=')
                    .map(|(key, value)| key == "token" && value == token)
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

fn write_http_options(stream: &mut TcpStream) {
    let response = concat!(
        "HTTP/1.1 204 No Content\r\n",
        "Access-Control-Allow-Origin: *\r\n",
        "Access-Control-Allow-Headers: authorization, content-type\r\n",
        "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n",
        "Content-Length: 0\r\n",
        "\r\n"
    );
    let _ = stream.write_all(response.as_bytes());
}

fn write_http_json(stream: &mut TcpStream, status: u16, payload: Value) {
    let status_text = match status {
        200 => "OK",
        201 => "Created",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        _ => "Internal Server Error",
    };
    let body = payload.to_string();
    let response = format!(
        "HTTP/1.1 {status} {status_text}\r\n\
         Content-Type: application/json; charset=utf-8\r\n\
         Cache-Control: no-store\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         \r\n\
         {}",
        body.as_bytes().len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
}

fn build_gateway_status(service: &GatewayService, message: &str) -> GatewayStatus {
    let local_url = format!("http://127.0.0.1:{}", service.port);
    let lan_url = service
        .lan_ip
        .as_ref()
        .map(|ip| format!("http://{}:{}", ip, service.port));
    GatewayStatus {
        running: true,
        host: service.host.clone(),
        port: service.port,
        local_url,
        lan_url,
        token: service.token.clone(),
        expose_lan: service.host == "0.0.0.0",
        message: message.to_string(),
    }
}

fn stopped_gateway_status() -> GatewayStatus {
    GatewayStatus {
        running: false,
        host: "".to_string(),
        port: 0,
        local_url: "".to_string(),
        lan_url: None,
        token: "".to_string(),
        expose_lan: false,
        message: "Gateway is stopped".to_string(),
    }
}

fn generate_gateway_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

fn create_gateway_id(prefix: &str) -> String {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let suffix: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(6)
        .map(char::from)
        .collect();
    format!("{prefix}_{nonce}_{suffix}")
}

fn now_iso() -> String {
    let total_seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or_default();
    let days = total_seconds.div_euclid(86_400);
    let seconds_of_day = total_seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn civil_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 }.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096).div_euclid(365);
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2).div_euclid(153);
    let day = doy - (153 * mp + 2).div_euclid(5) + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if month <= 2 { 1 } else { 0 };
    (year, month, day)
}

fn detect_lan_ip() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    let _ = socket.connect("8.8.8.8:80");
    socket.local_addr().ok().map(|addr| addr.ip().to_string())
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

fn truncate_message(value: &str) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        "empty output".to_string()
    } else if normalized.chars().count() > 420 {
        normalized.chars().take(420).collect::<String>() + "..."
    } else {
        normalized
    }
}

fn main() {
    tauri::Builder::default()
        .manage(GatewayState::default())
        .setup(|app| {
            use tauri::Manager;
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::TrayIconBuilder;

            let gateway_state = app.state::<GatewayState>();
            if let Err(error) = start_gateway_service_inner(
                &gateway_state,
                GatewayStartRequest {
                    expose_lan: Some(false),
                    port: Some(17321),
                },
            ) {
                eprintln!("failed to auto-start local gateway: {}", error.message);
            }
            
            let show_item = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "隐藏窗口", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            
            let menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;
            
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                window.show().unwrap();
                                window.set_focus().unwrap();
                            }
                        }
                        "hide" => {
                            if let Some(window) = app.get_webview_window("main") {
                                window.hide().unwrap();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            openai_health,
            start_agent_auth,
            codex_exec_response,
            copilot_exec_response,
            openai_response,
            chat_with_agent,
            cli_smoke_test,
            gateway_status,
            start_gateway_service,
            stop_gateway_service
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(Debug, Deserialize)]
struct ChatRequest {
    agent: String,
    model: String,
    message: String,
}

#[tauri::command]
async fn chat_with_agent(request: ChatRequest) -> Result<Value, OpenAiError> {
    let prompt = format!("user: {}", request.message);
    
    match request.agent.as_str() {
        "codex" => run_codex_exec(request.model, prompt),
        "copilot" => run_copilot_exec(request.model, prompt),
        _ => Err(OpenAiError {
            message: format!("unsupported agent: {}", request.agent),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gateway_api_persists_thread_message_source_and_snapshot() {
        let shared = GatewayShared::default();
        let (status, created) = handle_gateway_api(
            "POST",
            "/api/threads",
            r#"{"title":"Rust gateway room"}"#,
            shared.clone(),
        )
        .expect("thread should be created");
        assert_eq!(status, 201);

        let thread_id = created["thread"]["id"].as_str().expect("thread id");
        let message_path = format!("/api/threads/{thread_id}/messages");
        let (message_status, sent) = handle_gateway_api(
            "POST",
            &message_path,
            r#"{"kind":"agent","source":{"type":"agent","id":"codex","name":"Codex"},"content":"hello from codex","dispatch":false}"#,
            shared.clone(),
        )
        .expect("message should be created");
        assert_eq!(message_status, 201);
        assert_eq!(sent["message"]["source"]["type"], "agent");
        assert_eq!(sent["message"]["source"]["id"], "codex");

        let snapshot_path = format!("/api/threads/{thread_id}");
        let (snapshot_status, snapshot) =
            handle_gateway_api("GET", &snapshot_path, "", shared).expect("snapshot should load");
        assert_eq!(snapshot_status, 200);
        assert_eq!(snapshot["thread"]["title"], "Rust gateway room");
        assert_eq!(snapshot["messages"][0]["content"], "hello from codex");
        assert_eq!(snapshot["events"].as_array().expect("events").len(), 2);
    }
}
