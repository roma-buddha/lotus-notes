#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod ai;
mod conversion;
mod layout;
mod startup;
mod storage;
mod transfer;
mod windows;
mod workspace;
mod storage_config;
use notify::{event::ModifyKind, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{Emitter, Manager};
use workspace::{Document, Snapshot, Workspace};
struct Store {
    workspace: Mutex<Workspace>,
    activation: std::sync::RwLock<()>,
    jobs: startup::Jobs,
    scan: Mutex<()>,
    config: PathBuf,
    views: Mutex<std::collections::HashMap<String, Vec<String>>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
    watcher_started: AtomicBool,
    tab_strips: Mutex<std::collections::HashMap<String, TabStripBounds>>,
}

impl Store {
    fn handle(&self, generation: Option<u64>) -> Result<Workspace, String> {
        let _activation = self.activation.read().map_err(|e| e.to_string())?;
        self.jobs.validate(generation)?;
        Ok(self.workspace.lock().map_err(|e| e.to_string())?.clone())
    }
}

#[derive(Clone, serde::Deserialize)]
struct TabStripBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    scale: f64,
    client_origin_x: f64,
}

#[derive(serde::Deserialize)]
struct TabStripInput {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(serde::Serialize)]
struct TabDropTarget {
    label: String,
    client_x: f64,
}

#[tauri::command]
fn register_tab_strip(
    window: tauri::Webview,
    state: tauri::State<Store>,
    bounds: TabStripInput,
) -> Result<(), String> {
    if bounds.width <= 0.0 || bounds.height <= 0.0 || !bounds.x.is_finite() || !bounds.y.is_finite()
    {
        return Err("Invalid tab strip bounds.".into());
    }
    let host = window.window();
    let origin = host.inner_position().map_err(|e| e.to_string())?;
    let scale = host.scale_factor().map_err(|e| e.to_string())?;
    let physical = TabStripBounds {
        x: origin.x as f64 + bounds.x * scale,
        y: origin.y as f64 + bounds.y * scale,
        width: bounds.width * scale,
        height: bounds.height * scale,
        scale,
        client_origin_x: origin.x as f64,
    };
    state
        .tab_strips
        .lock()
        .map_err(|e| e.to_string())?
        .insert(host.label().into(), physical);
    Ok(())
}

#[tauri::command]
fn tab_drop_target(
    window: tauri::Webview,
    app: tauri::AppHandle,
    state: tauri::State<Store>,
) -> Result<Option<TabDropTarget>, String> {
    let host = window.window();
    let cursor = host.cursor_position().map_err(|e| e.to_string())?;
    let source = host.label();
    let mut strips = state.tab_strips.lock().map_err(|e| e.to_string())?;
    strips.retain(|label, _| app.get_window(label).is_some());
    Ok(strips.iter().find_map(|(label, bounds)| {
        (label != source
            && cursor.x >= bounds.x
            && cursor.y >= bounds.y
            && cursor.x < bounds.x + bounds.width
            && cursor.y < bounds.y + bounds.height)
            .then(|| TabDropTarget {
                label: label.clone(),
                client_x: (cursor.x - bounds.client_origin_x) / bounds.scale,
            })
    }))
}

#[tauri::command]
fn release_history(app: tauri::AppHandle) -> Result<String, String> {
    let path = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("resources")
        .join("RELEASE-HISTORY.md");
    fs::read_to_string(path)
        .map_err(|_| "Lotus release history is unavailable. Reinstall Lotus and try again.".into())
}
fn browser_label(label: &str) -> Result<(), String> {
    let Some(suffix) = label.strip_prefix("browser-") else {
        return Err("Invalid browser tab.".into());
    };
    if suffix.is_empty()
        || label.len() > 80
        || !suffix
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '-')
    {
        return Err("Invalid browser tab.".into());
    }
    Ok(())
}
fn browser_url(value: &str) -> Result<tauri::webview::Url, String> {
    let url = tauri::webview::Url::parse(value.trim()).map_err(|_| "Enter a valid web address.")?;
    if !["http", "https"].contains(&url.scheme()) || url.host_str().is_none() {
        return Err("Browser tabs can open only normal HTTP or HTTPS web addresses.".into());
    }
    Ok(url)
}
fn browser_view(app: &tauri::AppHandle, label: &str) -> Result<tauri::Webview, String> {
    browser_label(label)?;
    app.get_webview(label)
        .ok_or("Browser tab is no longer open.".into())
}
fn browser_command_source(webview: &tauri::Webview) -> Result<(), String> {
    if webview.label().starts_with("browser-") {
        return Err("Browser pages cannot access Lotus browser controls.".into());
    }
    Ok(())
}
#[tauri::command]
fn browser_navigate(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    label: String,
    url: String,
) -> Result<String, String> {
    browser_command_source(&webview)?;
    let url = browser_url(&url)?;
    browser_view(&app, &label)?
        .navigate(url.clone())
        .map_err(|_| "Could not open that web address.")?;
    Ok(url.to_string())
}
#[tauri::command]
fn browser_reload(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    label: String,
) -> Result<(), String> {
    browser_command_source(&webview)?;
    browser_view(&app, &label)?
        .reload()
        .map_err(|_| "Could not reload this page.".into())
}
#[tauri::command]
fn browser_history(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    label: String,
    forward: bool,
) -> Result<(), String> {
    browser_command_source(&webview)?;
    let script = if forward {
        "history.forward()"
    } else {
        "history.back()"
    };
    browser_view(&app, &label)?
        .eval(script)
        .map_err(|_| "Could not navigate browser history.".into())
}
#[tauri::command]
fn browser_url_current(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    label: String,
) -> Result<String, String> {
    browser_command_source(&webview)?;
    browser_view(&app, &label)?
        .url()
        .map(|url| url.to_string())
        .map_err(|_| "Could not read the current browser address.".into())
}

#[derive(Clone, serde::Serialize)]
struct WorkspaceChange {
    structural: bool,
    generation: u64,
    paths: Vec<String>,
}

fn watch_workspace(app: &tauri::AppHandle, state: &Store) -> Result<(), String> {
    let (root, generation) = {
        let _activation = state.activation.read().map_err(|e| e.to_string())?;
        (
            state
                .workspace
                .lock()
                .map_err(|e| e.to_string())?
                .root
                .clone(),
            state.jobs.generation.load(Ordering::Acquire),
        )
    };
    let event_root = root.clone();
    let emitter = app.clone();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let event = match event {
            Ok(event) => event,
            Err(error) => {
                let state = emitter.state::<Store>();
                if generation == state.jobs.generation.load(Ordering::Acquire) {
                    state.watcher_started.store(false, Ordering::Release);
                    let _ = emitter.emit("lotus-watcher-error", error.to_string());
                }
                return;
            }
        };
        {
            if matches!(event.kind, EventKind::Access(_)) {
                return;
            }
            let paths: Vec<String> = event
                .paths
                .iter()
                .filter_map(|p| p.strip_prefix(&event_root).ok())
                .filter(|p| {
                    !p.components()
                        .any(|c| c.as_os_str().to_string_lossy().starts_with('.'))
                })
                .filter(|p| !p.to_string_lossy().ends_with(".lattice-tmp"))
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .collect();
            if paths.is_empty() {
                return;
            }
            // Content changes only reconcile open notes. A full tree walk is for
            // creates, deletes, and renames, rather than every autosave.
            let structural = matches!(
                event.kind,
                EventKind::Create(_)
                    | EventKind::Remove(_)
                    | EventKind::Modify(ModifyKind::Name(_))
            );
            let _ = emitter.emit(
                "lotus-workspace-changed",
                WorkspaceChange {
                    structural,
                    generation,
                    paths,
                },
            );
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    if generation != state.jobs.generation.load(Ordering::Acquire) {
        return Ok(());
    }
    *state.watcher.lock().map_err(|e| e.to_string())? = Some(watcher);
    Ok(())
}
#[tauri::command]
async fn get_organizer(
    app: tauri::AppHandle,
    generation: Option<u64>,
) -> Result<storage::OrganizerState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();

        let workspace = state.handle(generation)?;
        let result = get_organizer_blocking(workspace, app.state::<Store>());
        state.jobs.validate(generation)?;
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
fn get_organizer_blocking(
    workspace: Workspace,
    _state: tauri::State<Store>,
) -> Result<storage::OrganizerState, String> {
    workspace.organizer()
}
#[tauri::command]
async fn save_organizer(
    app: tauri::AppHandle,
    value: storage::OrganizerState,
    generation: Option<u64>,
) -> Result<storage::OrganizerState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();
        let _activation = state.activation.read().map_err(|e| e.to_string())?;
        state.jobs.validate(generation)?;
        save_organizer_blocking(app.state::<Store>(), value)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn save_organizer_blocking(
    state: tauri::State<Store>,
    value: storage::OrganizerState,
) -> Result<storage::OrganizerState, String> {
    state
        .workspace
        .lock()
        .map_err(|e| e.to_string())?
        .save_organizer(value)
}
#[tauri::command]
async fn snapshot(
    app: tauri::AppHandle,
    generation: Option<u64>,
    request_id: Option<String>,
) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();

        let workspace = state.handle(generation)?;
        let result = snapshot_blocking(workspace, app.state::<Store>(), request_id);
        state.jobs.validate(generation)?;
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
fn snapshot_blocking(
    workspace: Workspace,
    state: tauri::State<Store>,
    request_id: Option<String>,
) -> Result<Snapshot, String> {
    let job = state
        .jobs
        .begin(request_id.unwrap_or_else(|| "full-snapshot".into()));
    let _scan = state.scan.lock().map_err(|e| e.to_string())?;
    job.check()?;
    workspace.scan(&|| job.check())
}
fn start_workspace_watcher(app: tauri::AppHandle) {
    let started = app
        .state::<Store>()
        .watcher_started
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_ok();
    if !started {
        return;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();
        if let Err(error) = watch_workspace(&app, &state) {
            eprintln!("Lotus could not start workspace watching: {error}");
            let _ = app.emit("lotus-watcher-error", error);
            state.watcher_started.store(false, Ordering::Release);
        }
    });
}

#[tauri::command]
async fn startup_snapshot(
    app: tauri::AppHandle,
    generation: Option<u64>,
) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();

        let workspace = state.handle(generation)?;
        let result = startup_snapshot_blocking(workspace, app.clone(), app.state::<Store>());
        state.jobs.validate(generation)?;
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
fn startup_snapshot_blocking(
    workspace: Workspace,
    app: tauri::AppHandle,
    _state: tauri::State<Store>,
) -> Result<Snapshot, String> {
    let snapshot = workspace.startup_snapshot()?;
    start_workspace_watcher(app);
    Ok(snapshot)
}
#[tauri::command]
async fn search_notes(
    app: tauri::AppHandle,
    query: String,
    request_id: Option<String>,
    generation: Option<u64>,
) -> Result<Vec<workspace::SearchResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();

        let workspace = state.handle(generation)?;
        let result = search_notes_blocking(workspace, app.state::<Store>(), query, request_id);
        state.jobs.validate(generation)?;
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
fn search_notes_blocking(
    workspace: Workspace,
    state: tauri::State<Store>,
    query: String,
    request_id: Option<String>,
) -> Result<Vec<workspace::SearchResult>, String> {
    let job = state
        .jobs
        .begin(request_id.unwrap_or_else(|| "search".into()));
    workspace.search_checked(&query, 80, &|| job.check())
}
#[tauri::command]
async fn read_note(
    app: tauri::AppHandle,
    path: String,
    generation: Option<u64>,
) -> Result<Document, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();

        let workspace = state.handle(generation)?;
        let result = read_note_blocking(workspace, app.state::<Store>(), path);
        state.jobs.validate(generation)?;
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
fn read_note_blocking(
    workspace: Workspace,
    _state: tauri::State<Store>,
    path: String,
) -> Result<Document, String> {
    workspace.read(&path)
}
#[tauri::command]
async fn write_note(
    app: tauri::AppHandle,
    path: String,
    content: String,
    revision: String,
    generation: Option<u64>,
) -> Result<Document, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();
        let _activation = state.activation.read().map_err(|e| e.to_string())?;
        state.jobs.validate(generation)?;
        write_note_blocking(app.state::<Store>(), path, content, revision)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn write_note_blocking(
    state: tauri::State<Store>,
    path: String,
    content: String,
    revision: String,
) -> Result<Document, String> {
    state
        .workspace
        .lock()
        .map_err(|e| e.to_string())?
        .write(&path, &content, &revision)
}
#[tauri::command]
async fn create_entry(
    app: tauri::AppHandle,
    parent: String,
    kind: String,
    name: String,
    generation: Option<u64>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();
        let _activation = state.activation.read().map_err(|e| e.to_string())?;
        state.jobs.validate(generation)?;
        create_entry_blocking(app.state::<Store>(), parent, kind, name)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn create_entry_blocking(
    state: tauri::State<Store>,
    parent: String,
    kind: String,
    name: String,
) -> Result<String, String> {
    state
        .workspace
        .lock()
        .map_err(|e| e.to_string())?
        .create(&parent, &kind, &name)
}
#[tauri::command]
async fn import_markdown(
    app: tauri::AppHandle,
    parent: String,
    sources: Vec<String>,
    generation: Option<u64>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();
        let _activation = state.activation.read().map_err(|e| e.to_string())?;
        state.jobs.validate(generation)?;
        import_markdown_blocking(app.state::<Store>(), parent, sources)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn import_markdown_blocking(
    state: tauri::State<Store>,
    parent: String,
    sources: Vec<String>,
) -> Result<Vec<String>, String> {
    state
        .workspace
        .lock()
        .map_err(|e| e.to_string())?
        .import_markdown(&parent, &sources)
}
#[tauri::command]
async fn relocate_entry(
    window: tauri::Webview,
    app: tauri::AppHandle,
    path: String,
    parent: String,
    name: String,
    generation: Option<u64>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();
        let _activation = state.activation.read().map_err(|e| e.to_string())?;
        state.jobs.validate(generation)?;
        relocate_entry_blocking(
            window,
            app.clone(),
            app.state::<Store>(),
            path,
            parent,
            name,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
fn relocate_entry_blocking(
    window: tauri::Webview,
    app: tauri::AppHandle,
    state: tauri::State<Store>,
    path: String,
    parent: String,
    name: String,
) -> Result<String, String> {
    windows::check_other_views(&app, &state, window.label(), &path)?;
    let next = state
        .workspace
        .lock()
        .map_err(|e| e.to_string())?
        .relocate(&path, &parent, &name)?;
    let _ = app.emit(
        "notus-path-moved",
        serde_json::json!({ "old": path, "next": next, "source": window.label() }),
    );
    Ok(next)
}
#[tauri::command]
async fn delete_entry(
    window: tauri::Webview,
    app: tauri::AppHandle,
    path: String,
    generation: Option<u64>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();
        let _activation = state.activation.read().map_err(|e| e.to_string())?;
        state.jobs.validate(generation)?;
        delete_entry_blocking(window, app.clone(), app.state::<Store>(), path)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn delete_entry_blocking(
    window: tauri::Webview,
    app: tauri::AppHandle,
    state: tauri::State<Store>,
    path: String,
) -> Result<(), String> {
    windows::check_other_views(&app, &state, window.label(), &path)?;
    state
        .workspace
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&path)
}
#[tauri::command]
async fn reveal_vault(
    app: tauri::AppHandle,
    path: String,
    generation: Option<u64>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();
        let _activation = state.activation.read().map_err(|e| e.to_string())?;
        state.jobs.validate(generation)?;
        reveal_vault_blocking(app.state::<Store>(), path)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn reveal_vault_blocking(state: tauri::State<Store>, path: String) -> Result<(), String> {
    let workspace = state.workspace.lock().map_err(|e| e.to_string())?;
    if path.contains('/') {
        return Err("Choose a vault.".into());
    }
    let folder = workspace.resolve(&path)?;
    if !folder.is_dir() {
        return Err("This vault no longer exists.".into());
    }
    // Pass a validated path as one argument, never a shell command string.
    std::process::Command::new("explorer.exe")
        .arg(folder.to_string_lossy().trim_start_matches("\\\\?\\"))
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
async fn choose_root(app: tauri::AppHandle) -> Result<bool, String> {
    if app.webview_windows().len() > 1 {
        return Err("Close detached windows before changing the workspace.".into());
    }
    let Some(folder) = rfd::AsyncFileDialog::new()
        .set_title("Open vaults folder — existing files stay in place")
        .pick_folder()
        .await
    else {
        return Ok(false);
    };
    let folder = folder.path().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();
        let next = storage_config::select_vaults(&folder, state.config.parent().ok_or("Invalid app-data location")?)?;
        let _activation = state.activation.write().map_err(|e| e.to_string())?;
        storage_config::StorageConfig::from_workspace(&next).save(&state.config)?;
        *state.workspace.lock().map_err(|e| e.to_string())? = next;
        state.jobs.activate();
        state.watcher_started.store(false, Ordering::Release);
        drop(_activation);
        start_workspace_watcher(app.clone());
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[derive(serde::Serialize)]
struct StorageLocations {
    app_data: String,
    browser_data: String,
    workspace_data: String,
    trash: String,
}
#[tauri::command]
async fn storage_locations(app: tauri::AppHandle, reveal: Option<String>) -> Result<StorageLocations, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();
        let workspace = state.handle(None)?;
        let app_data = state.config.parent().ok_or("Invalid app-data location")?;
        let browser_data = std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").map(PathBuf::from)
            .unwrap_or(app.path().app_local_data_dir().map_err(|e| e.to_string())?);
        let workspace_data = workspace.internal_dir(".notus-state")?;
        let trash = workspace.internal_dir(".notus-trash")?;
        if let Some(reveal) = reveal {
            let path = match reveal.as_str() {
                "app_data" => app_data,
                "browser_data" => &browser_data,
                "workspace_data" => &workspace_data,
                "trash" => &trash,
                _ => return Err("Unknown storage location".into()),
            };
            fs::create_dir_all(path).map_err(|e| e.to_string())?;
            std::process::Command::new("explorer.exe")
                .arg(path.to_string_lossy().trim_start_matches("\\\\?\\"))
                .spawn().map_err(|e| e.to_string())?;
        }
        let display = |path: &std::path::Path| path.to_string_lossy().trim_start_matches("\\\\?\\").to_string();
        Ok(StorageLocations { app_data: display(app_data), browser_data: display(&browser_data), workspace_data: display(&workspace_data), trash: display(&trash) })
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn import_vault(
    app: tauri::AppHandle,
    generation: Option<u64>,
) -> Result<Option<String>, String> {
    let Some(folder) = rfd::AsyncFileDialog::new()
        .set_title("Import a vault (copies files; originals stay in place)")
        .pick_folder()
        .await
    else {
        return Ok(None);
    };
    let folder = folder.path().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();
        let _activation = state.activation.read().map_err(|e| e.to_string())?;
        state.jobs.validate(generation)?;
        let result = state
            .workspace
            .lock()
            .map_err(|e| e.to_string())?
            .import(&folder)
            .map(Some);
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
    if !["https", "http"].contains(&parsed.scheme()) || parsed.host_str().is_none() {
        return Err("Only http and https website links can be opened.".into());
    }
    #[cfg(windows)]
    {
        let verb: Vec<u16> = "open\0".encode_utf16().collect();
        let target: Vec<u16> = parsed.as_str().encode_utf16().chain(Some(0)).collect();
        let result = unsafe {
            windows_sys::Win32::UI::Shell::ShellExecuteW(
                std::ptr::null_mut(),
                verb.as_ptr(),
                target.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        };
        if result as isize <= 32 {
            return Err(format!(
                "Windows could not open the default browser (error {}).",
                result as isize
            ));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    Err("Opening websites is supported on Windows.".into())
}
#[tauri::command]
async fn preview_conversion(
    app: tauri::AppHandle,
    source: String,
    parent: String,
    name: String,
    generation: Option<u64>,
) -> Result<conversion::Conversion, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();

        let workspace = state.handle(generation)?;
        let result =
            preview_conversion_blocking(workspace, app.state::<Store>(), source, parent, name);
        state.jobs.validate(generation)?;
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
fn preview_conversion_blocking(
    workspace: Workspace,
    _state: tauri::State<Store>,
    source: String,
    parent: String,
    name: String,
) -> Result<conversion::Conversion, String> {
    workspace.conversion_preview(&source, &parent, &name)
}
#[tauri::command]
async fn convert_vault(
    window: tauri::Webview,
    app: tauri::AppHandle,
    source: String,
    parent: String,
    name: String,
    revision: String,
    generation: Option<u64>,
) -> Result<conversion::Conversion, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();
        let _activation = state.activation.read().map_err(|e| e.to_string())?;
        state.jobs.validate(generation)?;
        convert_vault_blocking(
            window,
            app.clone(),
            app.state::<Store>(),
            source,
            parent,
            name,
            revision,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
fn convert_vault_blocking(
    window: tauri::Webview,
    app: tauri::AppHandle,
    state: tauri::State<Store>,
    source: String,
    parent: String,
    name: String,
    revision: String,
) -> Result<conversion::Conversion, String> {
    windows::check_other_views(&app, &state, window.label(), &source)?;
    state
        .workspace
        .lock()
        .map_err(|e| e.to_string())?
        .convert_vault(&source, &parent, &name, &revision)
}
#[tauri::command]
fn read_clipboard() -> Result<String, String> {
    arboard::Clipboard::new()
        .map_err(|e| e.to_string())?
        .get_text()
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn write_clipboard(text: String) -> Result<(), String> {
    arboard::Clipboard::new()
        .map_err(|e| e.to_string())?
        .set_text(text)
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn export_backup(
    state: tauri::State<'_, Store>,
    settings: std::collections::BTreeMap<String, String>,
    vaults: bool,
    trash: bool,
) -> Result<Option<String>, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title("Export Lotus backup")
        .add_filter("Lotus ZIP backup", &["zip"])
        .set_file_name("Lotus-backup.zip")
        .save_file()
        .await
    else {
        return Ok(None);
    };
    transfer::export(
        &*state.workspace.lock().map_err(|e| e.to_string())?,
        file.path(),
        settings,
        vaults,
        trash,
    )?;
    Ok(Some(file.path().to_string_lossy().into()))
}
#[tauri::command]
async fn preview_backup() -> Result<Option<transfer::Preview>, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title("Import Lotus backup")
        .add_filter("Lotus ZIP backup", &["zip"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    transfer::preview(file.path()).map(Some)
}
#[tauri::command]
async fn import_backup(
    app: tauri::AppHandle,
    state: tauri::State<'_, Store>,
    plan: transfer::Preview,
    settings: bool,
) -> Result<Option<transfer::Restored>, String> {
    if app.webview_windows().len() > 1 {
        return Err("Close detached windows before importing.".into());
    }
    let Some(folder) = rfd::AsyncFileDialog::new()
        .set_title("Choose parent folder for a separate restored Lotus workspace")
        .pick_folder()
        .await
    else {
        return Ok(None);
    };
    let restored = transfer::restore(&plan, folder.path(), settings)?;
    let root = PathBuf::from(&restored.root);
    let next = Workspace::open(root.parent().ok_or("Invalid restore path")?.into())?;
    fs::write(
        &state.config,
        serde_json::to_vec(next.home.as_ref().unwrap()).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let _activation = state.activation.write().map_err(|e| e.to_string())?;
    *state.workspace.lock().map_err(|e| e.to_string())? = next;
    state.jobs.activate();
    state.watcher_started.store(false, Ordering::Release);
    drop(_activation);
    start_workspace_watcher(app.clone());
    Ok(Some(restored))
}

#[cfg(test)]
mod tests {
    use super::{browser_label, browser_url};

    #[test]
    fn browser_tabs_accept_only_safe_labels_and_web_addresses() {
        assert!(browser_label("browser-12").is_ok());
        assert!(browser_label("browser-tab-12").is_ok());
        for label in ["browser-", "note-12", "browser-12/other", "browser-💥"] {
            assert!(browser_label(label).is_err(), "{label}");
        }

        assert_eq!(
            browser_url("https://example.com/path").unwrap().as_str(),
            "https://example.com/path"
        );
        for address in [
            "file:///C:/secret.txt",
            "javascript:alert(1)",
            "mailto:hello@example.com",
            "https://",
        ] {
            assert!(browser_url(address).is_err(), "{address}");
        }
    }
}

fn main() {
    // Do not inherit the launching application's taskbar identity (e.g. Codex).
    #[cfg(windows)]
    unsafe {
        let id: Vec<u16> = "app.notus.desktop\0".encode_utf16().collect();
        windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(id.as_ptr());
    }
    // Explicit workspace overrides support isolated UI tests alongside the user's app.
    // Ordinary launches still enforce a single instance and never open a debug port.
    let builder = tauri::Builder::default();
    let builder = if std::env::var_os("NOTUS_ROOT").is_none() {
        builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app
                .get_webview_window("main")
                .or_else(|| app.webview_windows().into_values().next())
            {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
    } else {
        builder
    };
    builder
        .setup(|app| {
            // Set both window/taskbar icons explicitly, including debug builds.
            if let Some(icon) = app.default_window_icon() {
                for window in app.webview_windows().into_values() {
                    window.set_icon(icon.clone())?;
                }
            }
            let config_dir = app.path().app_data_dir()?;
            let config = config_dir.join("workspace.json");
            let store = Store {
                workspace: Mutex::new(Workspace {
                    root: PathBuf::new(),
                    home: None,
                }),
                activation: std::sync::RwLock::new(()),
                jobs: startup::Jobs::default(),
                scan: Mutex::new(()),
                config,
                views: Mutex::new(std::collections::HashMap::new()),
                watcher: Mutex::new(None),
                watcher_started: AtomicBool::new(false),
                tab_strips: Mutex::new(std::collections::HashMap::new()),
            };
            app.manage(store);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ai::ai_connections,
            ai::ai_models,
            ai::ai_save,
            ai::ai_remove,
            ai::ai_run_lotus,
            ai::ai_stop_lotus,
            ai::ai_computer_specs,
            ai::model_library,
            ai::model_library_choose_root,
            ai::model_library_add_root,
            ai::model_library_files,
            ai::model_library_reveal,
            ai::model_library_rename,
            ai::model_library_move,
            ai::model_library_delete,
            ai::hf_search,
            ai::hf_files,
            ai::hf_download,
            ai::hf_cancel,
            ai::ai_chat,
            ai::ai_stop,
            export_backup,
            preview_backup,
            import_backup,
            read_clipboard,
            write_clipboard,
            get_organizer,
            save_organizer,
            snapshot,
            startup_snapshot,
            startup::workspace_bootstrap,
            storage_locations,
            startup::list_directory,
            startup::cancel_workspace_request,
            startup::retry_workspace_watcher,
            search_notes,
            read_note,
            write_note,
            create_entry,
            import_markdown,
            relocate_entry,
            open_external,
            preview_conversion,
            convert_vault,
            delete_entry,
            reveal_vault,
            choose_root,
            import_vault,
            windows::register_view,
            windows::detach_note,
            windows::focus_main,
            register_tab_strip,
            tab_drop_target,
            release_history,
            browser_navigate,
            browser_reload,
            browser_history,
            browser_url_current,
            windows::list_trash,
            windows::restore_trash,
            windows::purge_trash,
            windows::set_locked
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start Lotus");
}
