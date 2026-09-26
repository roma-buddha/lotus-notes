//! Startup and cancellable read jobs never hold the workspace mutation lock.
use crate::{Store, Workspace};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::Manager;

#[derive(Default)]
pub struct Jobs {
    pub generation: AtomicU64,
    pub ready: AtomicBool,
    pub initialize: Mutex<()>,
    jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
}
impl Jobs {
    pub fn validate(&self, generation: Option<u64>) -> Result<(), String> {
        if !self.ready.load(Ordering::Acquire) {
            return Err("Workspace is not ready.".into());
        }
        if generation.is_some_and(|v| v != self.generation.load(Ordering::Acquire)) {
            return Err("Workspace changed. Discard this request.".into());
        }
        Ok(())
    }
    pub fn activate(&self) -> u64 {
        for token in self.jobs.lock().unwrap().values() {
            token.store(true, Ordering::Release);
        }
        self.ready.store(true, Ordering::Release);
        self.generation.fetch_add(1, Ordering::AcqRel) + 1
    }
    pub fn cancel(&self, id: &str) {
        let mut jobs = self.jobs.lock().unwrap();
        if jobs.len() >= 4096 {
            jobs.retain(|_, token| Arc::strong_count(token) > 1);
        }
        let token = jobs
            .entry(id.to_string())
            .or_insert_with(|| Arc::new(AtomicBool::new(false)));
        token.store(true, Ordering::Release);
    }
    pub fn begin(&self, id: String) -> Job<'_> {
        let token = Arc::new(AtomicBool::new(false));
        if let Some(old) = self.jobs.lock().unwrap().insert(id.clone(), token.clone()) {
            token.store(old.swap(true, Ordering::AcqRel), Ordering::Release);
        }
        Job {
            owner: self,
            id,
            token,
            generation: self.generation.load(Ordering::Acquire),
        }
    }
}
pub struct Job<'a> {
    owner: &'a Jobs,
    id: String,
    token: Arc<AtomicBool>,
    generation: u64,
}
impl Job<'_> {
    pub fn check(&self) -> Result<(), String> {
        if self.token.load(Ordering::Acquire) {
            return Err("Request cancelled.".into());
        }
        self.owner.validate(Some(self.generation))
    }
}
impl Drop for Job<'_> {
    fn drop(&mut self) {
        let mut jobs = self.owner.jobs.lock().unwrap();
        if jobs
            .get(&self.id)
            .is_some_and(|v| Arc::ptr_eq(v, &self.token))
        {
            jobs.remove(&self.id);
        }
    }
}

#[derive(Serialize)]
pub struct Bootstrap {
    root: String,
    legacy_root: Option<String>,
    generation: u64,
}
fn display(path: &std::path::Path) -> String {
    path.to_string_lossy().trim_start_matches("\\\\?\\").into()
}

#[tauri::command]
pub async fn workspace_bootstrap(app: tauri::AppHandle) -> Result<Bootstrap, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();
        // Repeated bootstrap calls share initialization; they never duplicate migration.
        let _initializing =
            if state.jobs.ready.load(Ordering::Acquire) {
                None
            } else {
                Some(
                    state.jobs.initialize.try_lock().map_err(|_| {
                        "Workspace is still opening. You can choose another workspace."
                    })?,
                )
            };
        if !state.jobs.ready.load(Ordering::Acquire) {
            let configured = if std::env::var_os("NOTUS_ROOT").is_none() {
                match std::fs::read_to_string(&state.config) {
                    Ok(value) => Some(serde_json::from_str::<std::path::PathBuf>(&value).map_err(|_| "Workspace settings could not be read. Choose your workspace again.")?),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                    Err(error) => return Err(format!("Workspace settings are unavailable: {error}")),
                }
            } else { None };
            if configured.as_ref().is_some_and(|root| !root.exists()) {
                return Err("Your workspace folder is unavailable. Reconnect its drive or choose another workspace.".into());
            }
            let root = std::env::var_os("NOTUS_ROOT")
                .map(std::path::PathBuf::from)
                .or(configured)
                .unwrap_or_else(|| {
                    let documents = app
                        .path()
                        .document_dir()
                        .unwrap_or_else(|_| std::path::PathBuf::from("."));
                    let legacy = documents.join("Notus");
                    if legacy.exists() {
                        legacy
                    } else {
                        documents.join("Lotus")
                    }
                });
            if std::env::var_os("NOTUS_ROOT").is_none() && !state.config.exists() && !root.exists()
            {
                return Err("Choose a folder for your Lotus workspace.".into());
            }
            let next = if std::env::var_os("NOTUS_ROOT").is_some()
                && !root.join(".lotus-state/layout.json").exists()
            {
                Workspace::new(root)
            } else {
                Workspace::open(root)
            }?;
            let _activation = state.activation.write().map_err(|e| e.to_string())?;
            // Choosing another workspace may have completed while this initialization ran.
            if !state.jobs.ready.load(Ordering::Acquire) {
                *state.workspace.lock().map_err(|e| e.to_string())? = next;
                state.jobs.activate();
            }
        }
        let _activation = state.activation.read().map_err(|e| e.to_string())?;
        let workspace = state.workspace.lock().map_err(|e| e.to_string())?.clone();
        let result = Bootstrap {
            root: display(&workspace.root),
            legacy_root: workspace.home.as_deref().map(display),
            generation: state.jobs.generation.load(Ordering::Acquire),
        };
        drop(_activation);
        crate::start_workspace_watcher(app.clone());
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct Directory {
    generation: u64,
    path: String,
    revision: String,
    entries: Vec<crate::workspace::Entry>,
}
#[tauri::command]
pub async fn list_directory(
    app: tauri::AppHandle,
    generation: u64,
    path: String,
    request_id: String,
    identities: bool,
) -> Result<Directory, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();
        let workspace = {
            let _activation = state.activation.read().map_err(|e| e.to_string())?;
            state.jobs.validate(Some(generation))?;
            state.workspace.lock().map_err(|e| e.to_string())?.clone()
        };
        let job = state.jobs.begin(request_id);
        let _scan = if identities {
            Some(state.scan.lock().map_err(|e| e.to_string())?)
        } else {
            None
        };
        state.jobs.validate(Some(generation))?;
        job.check()?;
        let entries = workspace.directory(&path, identities, &|| job.check())?;
        job.check()?;
        use sha2::{Digest, Sha256};
        let revision = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&entries).map_err(|e| e.to_string())?)
        );
        Ok(Directory {
            generation,
            path,
            revision,
            entries,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn cancel_workspace_request(state: tauri::State<Store>, request_id: String) {
    state.jobs.cancel(&request_id);
}
#[tauri::command]
pub fn retry_workspace_watcher(app: tauri::AppHandle) {
    crate::start_workspace_watcher(app);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::mpsc, time::Duration};
    #[test]
    fn cancelled_and_obsolete_jobs_never_publish() {
        let jobs = Jobs::default();
        jobs.activate();
        let first = jobs.begin("scan".into());
        let _replacement = jobs.begin("scan".into());
        assert!(first.check().is_err());
        let second = jobs.begin("search".into());
        jobs.activate();
        assert!(second.check().is_err());
        assert!(jobs.validate(Some(1)).is_err());
    }
    #[test]
    fn reading_and_saving_do_not_wait_for_a_paused_scan() {
        let temp = tempfile::tempdir().unwrap();
        let workspace = Workspace::new(temp.path().into()).unwrap();
        workspace.create("", "vault", "V").unwrap();
        workspace.create("V", "folder", "F").unwrap();
        let path = workspace.create("V/F", "note", "N").unwrap();
        let store = Arc::new(Store {
            workspace: Mutex::new(workspace),
            activation: std::sync::RwLock::new(()),
            jobs: Jobs::default(),
            scan: Mutex::new(()),
            config: temp.path().join("config.json"),
            views: Mutex::new(HashMap::new()),
            watcher: Mutex::new(None),
            watcher_started: AtomicBool::new(false),
            tab_strips: Mutex::new(HashMap::new()),
        });
        store.jobs.activate();
        let scan_workspace = store.handle(Some(1)).unwrap();
        let (started_tx, started_rx) = mpsc::channel();
        let (resume_tx, resume_rx) = mpsc::channel();
        let first = AtomicBool::new(true);
        let scan = std::thread::spawn(move || {
            scan_workspace.scan(&|| {
                if first.swap(false, Ordering::SeqCst) {
                    started_tx.send(()).unwrap();
                    resume_rx.recv().unwrap();
                }
                Ok(())
            })
        });
        started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let (done_tx, done_rx) = mpsc::channel();
        let writer = store.clone();
        let io = std::thread::spawn(move || {
            let note = writer.handle(Some(1)).unwrap().read(&path).unwrap();
            let changed = writer
                .workspace
                .lock()
                .unwrap()
                .write(&path, "still responsive", &note.revision)
                .unwrap();
            done_tx.send(changed.content).unwrap();
        });
        let result = done_rx.recv_timeout(Duration::from_secs(2));
        resume_tx.send(()).unwrap();
        io.join().unwrap();
        scan.join().unwrap().unwrap();
        assert_eq!(result.unwrap(), "still responsive");
    }
    #[test]
    fn immediate_listing_does_not_visit_unloaded_descendants() {
        let temp = tempfile::tempdir().unwrap();
        let workspace = Workspace::new(temp.path().into()).unwrap();
        workspace.create("", "vault", "V").unwrap();
        workspace.create("V", "folder", "F").unwrap();
        workspace.create("V/F", "note", "N").unwrap();
        let count = std::cell::Cell::new(0);
        let result = workspace
            .directory("", false, &|| {
                count.set(count.get() + 1);
                Ok(())
            })
            .unwrap();
        assert_eq!(result.len(), 1);
        assert!(result[0].children.is_empty());
        // One check before walking, one per immediate entry (including internal entries).
        assert!(count.get() < 6);
    }
}
