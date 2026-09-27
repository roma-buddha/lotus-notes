use crate::{storage::TrashItem, workspace::Document, Store};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{Emitter, Manager};
static SEQUENCE: AtomicU64 = AtomicU64::new(1);
pub fn check_other_views(
    app: &tauri::AppHandle,
    store: &Store,
    caller: &str,
    path: &str,
) -> Result<(), String> {
    let mut views = store.views.lock().map_err(|e| e.to_string())?;
    views.retain(|label, _| app.get_window(label).is_some());
    if views.iter().any(|(label, paths)| {
        label != caller
            && paths
                .iter()
                .any(|p| p == path || p.starts_with(&format!("{path}/")))
    }) {
        return Err(
            "This item is open in another window. Close that view before moving or deleting it."
                .into(),
        );
    }
    Ok(())
}
#[tauri::command]
pub async fn register_view(
    app: tauri::AppHandle,
    window: tauri::Webview,
    path: Option<String>,
    additional: Option<Vec<String>>,
    generation: Option<u64>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();
        let _activation = state.activation.read().map_err(|e| e.to_string())?;
        state.jobs.validate(generation)?;
        register_view_blocking(window, app.state::<Store>(), path, additional)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn register_view_blocking(
    window: tauri::Webview,
    state: tauri::State<Store>,
    path: Option<String>,
    additional: Option<Vec<String>>,
) -> Result<(), String> {
    if let Some(path) = &path {
        state
            .workspace
            .lock()
            .map_err(|e| e.to_string())?
            .read(path)?;
    }
    let mut paths = additional.unwrap_or_default();
    if let Some(path) = path {
        paths.push(path);
    }
    for path in &paths {
        state
            .workspace
            .lock()
            .map_err(|e| e.to_string())?
            .read(path)?;
    }
    let mut views = state.views.lock().map_err(|e| e.to_string())?;
    if !paths.is_empty() {
        views.insert(window.label().into(), paths);
    } else {
        views.remove(window.label());
    }
    Ok(())
}
#[tauri::command]
pub async fn list_trash(
    app: tauri::AppHandle,
    generation: Option<u64>,
) -> Result<Vec<TrashItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();
        let _activation = state.activation.read().map_err(|e| e.to_string())?;
        state.jobs.validate(generation)?;
        list_trash_blocking(app.state::<Store>())
    })
    .await
    .map_err(|e| e.to_string())?
}
fn list_trash_blocking(state: tauri::State<Store>) -> Result<Vec<TrashItem>, String> {
    state
        .workspace
        .lock()
        .map_err(|e| e.to_string())?
        .list_trash()
}
#[tauri::command]
pub async fn restore_trash(
    app: tauri::AppHandle,
    id: String,
    generation: Option<u64>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();
        let _activation = state.activation.read().map_err(|e| e.to_string())?;
        state.jobs.validate(generation)?;
        restore_trash_blocking(app.state::<Store>(), id)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn restore_trash_blocking(state: tauri::State<Store>, id: String) -> Result<String, String> {
    // Restoring copies the item back to the vaults folder, which can block
    // on cloud-synced drives; do it without holding the workspace lock.
    let workspace = state.workspace.lock().map_err(|e| e.to_string())?.clone();
    workspace.restore(&id)
}
#[tauri::command]
pub async fn purge_trash(
    app: tauri::AppHandle,
    ids: Vec<String>,
    generation: Option<u64>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();
        let _activation = state.activation.read().map_err(|e| e.to_string())?;
        state.jobs.validate(generation)?;
        purge_trash_blocking(app.state::<Store>(), ids)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn purge_trash_blocking(state: tauri::State<Store>, ids: Vec<String>) -> Result<(), String> {
    state
        .workspace
        .lock()
        .map_err(|e| e.to_string())?
        .purge(&ids)
}
#[tauri::command]
pub async fn set_locked(
    path: String,
    locked: bool,
    revision: String,
    app: tauri::AppHandle,
    generation: Option<u64>,
) -> Result<Document, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();
        let _activation = state.activation.read().map_err(|e| e.to_string())?;
        state.jobs.validate(generation)?;
        set_locked_blocking(app.state::<Store>(), path, locked, revision, app.clone())
    })
    .await
    .map_err(|e| e.to_string())?
}
fn set_locked_blocking(
    state: tauri::State<Store>,
    path: String,
    locked: bool,
    revision: String,
    app: tauri::AppHandle,
) -> Result<Document, String> {
    let next = state
        .workspace
        .lock()
        .map_err(|e| e.to_string())?
        .set_locked(&path, locked, &revision)?;
    let _ = app.emit("notus-note-changed", &path);
    Ok(next)
}
fn note_url(path: &str) -> std::path::PathBuf {
    // Percent-encode bytes, not characters; filenames may contain non-ASCII or #/?/&.
    let encoded = path
        .as_bytes()
        .iter()
        .map(|byte| format!("%{byte:02X}"))
        .collect::<String>();
    format!("index.html?note={encoded}").into()
}
#[tauri::command]
pub async fn detach_note(
    app: tauri::AppHandle,
    window: tauri::Webview,
    state: tauri::State<'_, Store>,
    path: String,
    at_cursor: bool,
) -> Result<String, String> {
    let host = window.window();
    if at_cursor {
        let cursor = host.cursor_position().map_err(|e| e.to_string())?;
        let origin = host.outer_position().map_err(|e| e.to_string())?;
        let size = host.outer_size().map_err(|e| e.to_string())?;
        if cursor.x >= origin.x as f64
            && cursor.y >= origin.y as f64
            && cursor.x < origin.x as f64 + size.width as f64
            && cursor.y < origin.y as f64 + size.height as f64
        {
            return Ok(String::new());
        }
    }
    state
        .workspace
        .lock()
        .map_err(|e| e.to_string())?
        .read(&path)?;
    let label = format!("note-{}", SEQUENCE.fetch_add(1, Ordering::Relaxed));
    let next =
        tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App(note_url(&path)))
            .title("Lotus")
            .inner_size(920.0, 720.0)
            .min_inner_size(680.0, 520.0)
            .decorations(false)
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?;
    if at_cursor {
        if let Ok(p) = host.cursor_position() {
            let _ = next.set_position(tauri::PhysicalPosition::new(
                p.x as i32 - 100,
                p.y as i32 - 20,
            ));
        }
    } else if let Ok(p) = host.outer_position() {
        let _ = next.set_position(tauri::PhysicalPosition::new(p.x + 40, p.y + 40));
    }
    if let Some(icon) = app.default_window_icon() {
        next.set_icon(icon.clone()).map_err(|e| e.to_string())?;
    }
    next.show().map_err(|e| e.to_string())?;
    next.set_focus().map_err(|e| e.to_string())?;
    Ok(label)
}
#[tauri::command]
pub async fn focus_main(
    app: tauri::AppHandle,
    state: tauri::State<'_, Store>,
    path: String,
) -> Result<bool, String> {
    state
        .workspace
        .lock()
        .map_err(|e| e.to_string())?
        .read(&path)?;
    if let Some(main) = app.get_window("main") {
        main.unminimize().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
        Ok(false)
    } else {
        tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::App(note_url(&path)))
            .title("Lotus")
            .inner_size(1280.0, 840.0)
            .min_inner_size(680.0, 520.0)
            .decorations(false)
            .build()
            .map_err(|e| e.to_string())?;
        Ok(true)
    }
}
