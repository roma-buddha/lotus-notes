//! Vault selection never moves the user's files. Legacy storage homes stay valid.
use crate::workspace::Workspace;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Serialize, Deserialize)]
#[serde(untagged)]
pub enum StorageConfig {
    Legacy(PathBuf),
    Separate { vaults: PathBuf, data: PathBuf },
}
impl StorageConfig {
    pub fn open(&self) -> Result<Workspace, String> {
        match self {
            Self::Legacy(home) => {
                if !home.is_dir() {
                    return Err("Your workspace folder is unavailable. Reconnect its drive or choose another vaults folder.".into());
                }
                Workspace::open(home.clone())
            }
            Self::Separate { vaults, data } => attach(vaults, data),
        }
    }
    pub fn from_workspace(workspace: &Workspace) -> Self {
        Self::Separate {
            vaults: workspace.root.clone(),
            data: workspace
                .home
                .clone()
                .unwrap_or_else(|| workspace.root.clone()),
        }
    }
    pub fn save(&self, path: &Path) -> Result<(), String> {
        let parent = path.parent().ok_or("Invalid settings location")?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec(self).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.as_file().sync_all().map_err(|e| e.to_string())?;
        file.persist(path).map_err(|e| e.to_string())?;
        Ok(())
    }
}
fn ordinary_dir(path: &Path) -> Result<PathBuf, String> {
    let meta = fs::symlink_metadata(path)
        .map_err(|e| format!("Folder unavailable: {} ({e})", path.display()))?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("Choose an ordinary folder, not a file or linked folder.".into());
    }
    path.canonicalize().map_err(|e| e.to_string())
}
fn attach(vaults: &Path, data: &Path) -> Result<Workspace, String> {
    // Never recreate a disconnected vaults folder during startup.
    let root = ordinary_dir(vaults)?;
    fs::create_dir_all(data).map_err(|e| e.to_string())?;
    let home = ordinary_dir(data)?;
    let workspace = Workspace {
        root,
        home: Some(home),
    };
    workspace.internal_dir(".notus-state")?;
    workspace.internal_dir(".notus-trash")?;
    Ok(workspace)
}
pub fn select_vaults(selected: &Path, app_data: &Path) -> Result<Workspace, String> {
    let root = ordinary_dir(selected)?;
    // Accept either the old storage home or its displayed Vaults folder.
    if root.join(".lotus-state/layout.json").is_file() || root.join(".notus-state").is_dir() {
        return Workspace::open(root);
    }
    if root
        .file_name()
        .is_some_and(|v| v.eq_ignore_ascii_case("Vaults"))
    {
        if let Some(home) = root.parent() {
            if home.join(".lotus-state/layout.json").is_file() {
                return Workspace::open(home.into());
            }
        }
    }
    if root
        .file_name()
        .is_some_and(|v| v.to_string_lossy().starts_with('.'))
    {
        return Err(
            "Choose the folder containing your vaults, not an internal state or Trash folder."
                .into(),
        );
    }
    fs::create_dir_all(app_data).map_err(|e| e.to_string())?;
    let app_data = ordinary_dir(app_data)?;
    if app_data.starts_with(&root) || root.starts_with(app_data.join("workspaces")) {
        return Err("Choose a vaults subfolder or a separate folder, not the app-data folder or its parent.".into());
    }
    let identity = root.to_string_lossy().to_lowercase();
    let key = format!("{:x}", Sha256::digest(identity.as_bytes()));
    attach(&root, &app_data.join("workspaces").join(key))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn existing_vaults_are_not_moved_and_state_survives_restart() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("My vaults");
        fs::create_dir_all(root.join("Work/Deep/Untouched")).unwrap();
        fs::write(root.join("Work/note.md"), "original").unwrap();
        let app_data = temp.path().join("App data");
        let workspace = select_vaults(&root, &app_data).unwrap();
        fs::write(
            workspace.internal_dir(".notus-state").unwrap().join("test"),
            "state",
        )
        .unwrap();
        let config = app_data.join("workspace.json");
        StorageConfig::from_workspace(&workspace)
            .save(&config)
            .unwrap();
        StorageConfig::from_workspace(&workspace)
            .save(&config)
            .unwrap();
        let saved: StorageConfig = serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
        let reopened = saved.open().unwrap();
        assert_eq!(workspace.root, reopened.root);
        assert_eq!(workspace.home, reopened.home);
        assert!(root.join("Work/Deep/Untouched").is_dir());
        assert_eq!(
            fs::read_to_string(root.join("Work/note.md")).unwrap(),
            "original"
        );
        assert!(!root.join("Vaults").exists());
        let other = temp.path().join("Other vaults");
        fs::create_dir(&other).unwrap();
        assert_ne!(
            select_vaults(&other, &app_data).unwrap().home,
            workspace.home
        );
        assert_eq!(
            select_vaults(&root, &app_data).unwrap().home,
            workspace.home
        );
    }
    #[test]
    fn legacy_home_and_displayed_vaults_keep_metadata_and_trash() {
        let temp = tempfile::tempdir().unwrap();
        let old = Workspace::open(temp.path().join("Lotus")).unwrap();
        let trash = old.internal_dir(".notus-trash").unwrap();
        fs::write(trash.join("kept"), "safe").unwrap();
        let data = temp.path().join("App data");
        for chosen in [&old.root, old.home.as_ref().unwrap()] {
            let opened = select_vaults(chosen, &data).unwrap();
            assert_eq!(opened.root, old.root);
            assert_eq!(opened.home, old.home);
            assert!(opened
                .internal_dir(".notus-trash")
                .unwrap()
                .join("kept")
                .exists());
        }
        let legacy: StorageConfig =
            serde_json::from_value(serde_json::json!(old.home.unwrap())).unwrap();
        assert_eq!(legacy.open().unwrap().root, old.root);
    }
    #[test]
    fn vaults_can_share_the_app_data_parent_but_missing_roots_are_not_created() {
        let temp = tempfile::tempdir().unwrap();
        let data = temp.path().join("Lotus");
        let root = data.join("Vaults");
        fs::create_dir_all(&root).unwrap();
        let workspace = select_vaults(&root, &data).unwrap();
        assert!(workspace
            .home
            .unwrap()
            .starts_with(data.canonicalize().unwrap()));
        assert!(select_vaults(&data, &data).is_err());
        let missing = temp.path().join("Disconnected");
        assert!(StorageConfig::Separate {
            vaults: missing.clone(),
            data
        }
        .open()
        .is_err());
        assert!(!missing.exists());
    }
}
