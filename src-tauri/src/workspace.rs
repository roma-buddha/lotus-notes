use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};

type Result<T> = std::result::Result<T, String>;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Serialize, Clone)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub children: Vec<Entry>,
    pub identity: Option<String>,
}
#[derive(Serialize)]
pub struct Snapshot {
    pub root: String,
    pub entries: Vec<Entry>,
    pub legacy_root: Option<String>,
}
#[derive(Serialize, Debug, Clone)]
pub struct Document {
    pub identity: Option<String>,
    pub path: String,
    pub content: String,
    pub revision: String,
    pub locked: bool,
}

/// A deliberately small search result. Sending note contents to the webview for
/// every result would make large workspaces slow and needlessly duplicate data.
#[derive(Serialize, Debug, Clone)]
pub struct SearchResult {
    pub path: String,
    pub snippet: String,
}

#[derive(Clone)]
pub struct Workspace {
    pub root: PathBuf,
    pub home: Option<PathBuf>,
}
pub fn valid_name(name: &str) -> Result<()> {
    let stem = name.split('.').next().unwrap_or("").to_uppercase();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if name.is_empty()
        || name.starts_with('.')
        || name.ends_with(['.', ' '])
        || name.len() > 180
        || reserved.contains(&stem.as_str())
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
    {
        return Err(
            "Choose a name without Windows reserved characters, trailing dots, or spaces.".into(),
        );
    }
    Ok(())
}
fn depth(p: &str) -> usize {
    p.split('/').filter(|s| !s.is_empty()).count()
}
fn is_note(p: &Path) -> bool {
    p.extension()
        .is_some_and(|s| s.eq_ignore_ascii_case("md") || s.eq_ignore_ascii_case("markdown"))
}
fn revision(content: &str) -> String {
    format!("{:x}", Sha256::digest(content.as_bytes()))
}

#[cfg(windows)]
fn file_identity(path: &Path) -> Option<String> {
    use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS,
    };
    let file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
        .ok()?;
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
        return None;
    }
    Some(format!(
        "{}:{}:{}",
        info.dwVolumeSerialNumber, info.nFileIndexHigh, info.nFileIndexLow
    ))
}
#[cfg(not(windows))]
fn file_identity(_path: &Path) -> Option<String> {
    None
}

impl Workspace {
    pub fn new(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(&root).map_err(err)?;
        let workspace = Self {
            root: root.canonicalize().map_err(err)?,
            home: None,
        };
        workspace.internal_dir(".notus-trash")?;
        workspace.migrate()?;
        Ok(workspace)
    }
    pub fn resolve(&self, relative: &str) -> Result<PathBuf> {
        if !relative.is_empty()
            && relative
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
        {
            return Err("Invalid workspace path.".into());
        }
        if relative.contains('\\') || relative.contains(':') || relative.starts_with('/') {
            return Err("Invalid workspace path.".into());
        }
        let mut path = self.root.clone();
        for component in Path::new(relative).components() {
            let Component::Normal(part) = component else {
                return Err("Path leaves the workspace.".into());
            };
            if part.to_string_lossy().starts_with('.') {
                return Err("Internal workspace paths are protected.".into());
            }
            path.push(part);
            if path.exists() {
                let canonical = path.canonicalize().map_err(err)?;
                if fs::symlink_metadata(&path)
                    .map_err(err)?
                    .file_type()
                    .is_symlink()
                    || !canonical.starts_with(&self.root)
                {
                    return Err("Linked folders are not supported inside the workspace.".into());
                }
            }
        }
        Ok(path)
    }
    fn walk(
        &self,
        relative: &str,
        orders: &std::collections::BTreeMap<String, Vec<String>>,
        include_identities: bool,
        levels: usize,
        check: &dyn Fn() -> Result<()>,
    ) -> Result<Vec<Entry>> {
        let mut entries = Vec::new();
        for child in fs::read_dir(self.resolve(relative)?).map_err(err)? {
            check()?;
            let child = child.map_err(err)?;
            let name = child.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name.ends_with(".lattice-tmp") {
                continue;
            }
            let kind = child.file_type().map_err(err)?;
            if kind.is_symlink() {
                continue;
            }
            let path = if relative.is_empty() {
                name.clone()
            } else {
                format!("{relative}/{name}")
            };
            if kind.is_dir() {
                entries.push(Entry {
                    // `read_dir` started from a validated workspace directory and
                    // symlinks are rejected above, so resolving every child again
                    // only repeats Windows canonicalisation work.  It is especially
                    // costly for vaults with thousands of notes.
                    identity: include_identities
                        .then(|| file_identity(&child.path()))
                        .flatten(),
                    name,
                    path: path.clone(),
                    kind: if relative.is_empty() {
                        "vault"
                    } else {
                        "folder"
                    }
                    .into(),
                    children: if levels > 1 {
                        self.walk(&path, orders, include_identities, levels - 1, check)?
                    } else {
                        vec![]
                    },
                });
            } else if !relative.is_empty() && is_note(&child.path()) {
                entries.push(Entry {
                    identity: include_identities
                        .then(|| file_identity(&child.path()))
                        .flatten(),
                    name,
                    path,
                    kind: "note".into(),
                    children: vec![],
                });
            }
        }
        let ranks = orders.get(relative).map(|paths| {
            paths
                .iter()
                .enumerate()
                .map(|(index, path)| (path.as_str(), index))
                .collect::<std::collections::HashMap<_, _>>()
        });
        entries.sort_by(|a, b| {
            (a.kind == "note").cmp(&(b.kind == "note")).then_with(|| {
                match (&ranks, a.kind.as_str(), b.kind.as_str()) {
                    (Some(ranks), "note", "note") => ranks
                        .get(a.path.as_str())
                        .cmp(&ranks.get(b.path.as_str()))
                        .then(a.name.to_lowercase().cmp(&b.name.to_lowercase())),
                    _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
                }
            })
        });
        Ok(entries)
    }
    pub fn snapshot(&self) -> Result<Snapshot> {
        let organizer = self.organizer()?;
        Ok(Snapshot {
            root: self
                .root
                .to_string_lossy()
                .trim_start_matches("\\\\?\\")
                .into(),
            entries: self.walk("", &organizer.orders, true, usize::MAX, &|| Ok(()))?,
            legacy_root: self.home.as_ref().map(|p| {
                p.to_string_lossy()
                    .trim_start_matches("\\\\?\\")
                    .to_string()
            }),
        })
    }
    /// Startup lists vaults only; descendants and identities are loaded independently.
    pub fn startup_snapshot(&self) -> Result<Snapshot> {
        let organizer = self.organizer()?;
        Ok(Snapshot {
            root: self
                .root
                .to_string_lossy()
                .trim_start_matches("\\\\?\\")
                .into(),
            entries: self.walk("", &organizer.orders, false, 1, &|| Ok(()))?,
            legacy_root: self.home.as_ref().map(|p| {
                p.to_string_lossy()
                    .trim_start_matches("\\\\?\\")
                    .to_string()
            }),
        })
    }
    pub fn directory(
        &self,
        path: &str,
        identities: bool,
        check: &dyn Fn() -> Result<()>,
    ) -> Result<Vec<Entry>> {
        check()?;
        let organizer = self.organizer()?;
        self.walk(path, &organizer.orders, identities, 1, check)
    }
    pub fn scan(&self, check: &dyn Fn() -> Result<()>) -> Result<Snapshot> {
        let mut result = self.startup_snapshot()?;
        let organizer = self.organizer()?;
        result.entries = self.walk("", &organizer.orders, true, usize::MAX, check)?;
        Ok(result)
    }
    fn search_walk(
        &self,
        relative: &str,
        query: &str,
        names: &mut Vec<SearchResult>,
        contents: &mut Vec<SearchResult>,
        limit: usize,
        check: &dyn Fn() -> Result<()>,
    ) -> Result<()> {
        for child in fs::read_dir(self.resolve(relative)?).map_err(err)? {
            check()?;
            let child = child.map_err(err)?;
            let name = child.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name.ends_with(".lattice-tmp") {
                continue;
            }
            let kind = child.file_type().map_err(err)?;
            if kind.is_symlink() {
                continue;
            }
            let path = if relative.is_empty() {
                name.clone()
            } else {
                format!("{relative}/{name}")
            };
            if self.resolve(&path).is_err() {
                continue;
            }
            if kind.is_dir() {
                self.search_walk(&path, query, names, contents, limit, check)?;
                continue;
            }
            if relative.is_empty()
                || !is_note(&child.path())
                || names.len() + contents.len() >= limit
            {
                continue;
            }
            if name.to_lowercase().contains(query) {
                names.push(SearchResult {
                    path,
                    snippet: relative.into(),
                });
                continue;
            }
            let content = match fs::read_to_string(child.path()) {
                Ok(content) => content,
                Err(_) => continue, // Files can disappear while an external app is moving them.
            };
            let haystack = content.to_lowercase();
            if let Some(index) = haystack.find(query) {
                let start = content[..index]
                    .char_indices()
                    .rev()
                    .nth(24)
                    .map(|(i, _)| i)
                    .unwrap_or(0);
                let end = content[index..]
                    .char_indices()
                    .nth(100)
                    .map(|(i, _)| index + i)
                    .unwrap_or(content.len());
                contents.push(SearchResult {
                    path,
                    snippet: content[start..end]
                        .split_whitespace()
                        .collect::<Vec<_>>()
                        .join(" "),
                });
            }
        }
        Ok(())
    }
    /// Search is intentionally native and batched: the old webview loop made a
    /// separate IPC read for every note on every keystroke.
    #[cfg(test)]
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>> {
        self.search_checked(query, limit, &|| Ok(()))
    }
    pub fn search_checked(
        &self,
        query: &str,
        limit: usize,
        check: &dyn Fn() -> Result<()>,
    ) -> Result<Vec<SearchResult>> {
        let query = query.trim().to_lowercase();
        if query.is_empty() {
            return Ok(vec![]);
        }
        let mut names = Vec::new();
        let mut contents = Vec::new();
        self.search_walk(
            "",
            &query,
            &mut names,
            &mut contents,
            limit.clamp(1, 100),
            check,
        )?;
        names.extend(contents);
        Ok(names)
    }
    pub fn read(&self, relative: &str) -> Result<Document> {
        let path = self.resolve(relative)?;
        if !is_note(&path) || depth(relative) != 3 {
            return Err("Open a Markdown note inside a folder in a vault.".into());
        }
        let content = fs::read_to_string(&path).map_err(err)?;
        Ok(Document {
            identity: file_identity(&path),
            path: relative.into(),
            revision: revision(&content),
            content,
            locked: self.locks()?.contains(relative),
        })
    }
    pub fn write(&self, relative: &str, content: &str, expected: &str) -> Result<Document> {
        let current = self.read(relative)?;
        if current.locked {
            return Err(
                "This note is locked. Unlock it before editing; your draft is kept.".into(),
            );
        }
        if current.revision != expected {
            return Err(
                "CONFLICT: This note changed outside Lotus. Your draft has been kept.".into(),
            );
        }
        let path = self.resolve(relative)?;
        let mut temp = tempfile::NamedTempFile::new_in(path.parent().unwrap()).map_err(err)?;
        temp.write_all(content.as_bytes()).map_err(err)?;
        temp.as_file().sync_all().map_err(err)?;
        // Keep the old contents until the atomic replacement completes.
        temp.persist(&path).map_err(err)?;
        self.read(relative)
    }
    pub fn create(&self, parent: &str, kind: &str, name: &str) -> Result<String> {
        valid_name(name)?;
        let parent_path = self.resolve(parent)?;
        if !parent_path.is_dir() {
            return Err("Select an existing folder.".into());
        }
        match kind {
            "vault" if parent.is_empty() => {}
            "folder" if depth(parent) == 1 => {}
            "note" if depth(parent) == 2 => {}
            _ => return Err("Select a vault or a folder inside a vault first.".into()),
        }
        let name = if kind == "note" && !is_note(Path::new(name)) {
            format!("{name}.md")
        } else {
            name.into()
        };
        let relative = if parent.is_empty() {
            name.clone()
        } else {
            format!("{parent}/{name}")
        };
        let target = self.resolve(&relative)?;
        if target.exists() {
            return Err("An item with this name already exists. Choose another name.".into());
        }
        if kind == "note" {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
                .map_err(err)?;
            file.write_all(
                format!(
                    "# {}\n\n",
                    Path::new(&name).file_stem().unwrap().to_string_lossy()
                )
                .as_bytes(),
            )
            .map_err(err)?;
        } else {
            fs::create_dir(&target).map_err(err)?;
        }
        Ok(relative)
    }
    /// Copy external Markdown files into an existing vault folder. Originals are
    /// never moved or modified, and source links are rejected before copying.
    pub fn import_markdown(&self, parent: &str, sources: &[String]) -> Result<Vec<String>> {
        if depth(parent) != 2 || sources.is_empty() {
            return Err("Drop Markdown files onto a folder inside a vault.".into());
        }
        if sources.len() > 100 {
            return Err("Drop up to 100 Markdown files at a time.".into());
        }
        let destination = self.resolve(parent)?;
        if !destination.is_dir() {
            return Err("Choose an existing folder.".into());
        }
        let mut imported = Vec::new();
        for source in sources {
            let source = PathBuf::from(source);
            let metadata = fs::symlink_metadata(&source).map_err(err)?;
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err("Only ordinary Markdown files can be imported.".into());
            }
            if !is_note(&source) {
                return Err("Only .md or .markdown files can be imported.".into());
            }
            if metadata.len() > 20 * 1024 * 1024 {
                return Err("Each imported Markdown file must be 20 MB or smaller.".into());
            }
            let source = source.canonicalize().map_err(err)?;
            if source.starts_with(&self.root) {
                return Err("This note is already inside the Lotus workspace.".into());
            }
            let original = source
                .file_name()
                .ok_or("Invalid Markdown filename.")?
                .to_string_lossy()
                .to_string();
            valid_name(&original)?;
            let stem = source
                .file_stem()
                .ok_or("Invalid Markdown filename.")?
                .to_string_lossy();
            let extension = source
                .extension()
                .ok_or("Invalid Markdown filename.")?
                .to_string_lossy();
            let mut number = 2usize;
            let mut name = original.clone();
            while destination.join(&name).exists() {
                name = format!("{stem} ({number}).{extension}");
                number += 1;
            }
            fs::copy(&source, destination.join(&name)).map_err(err)?;
            imported.push(format!("{parent}/{name}"));
        }
        Ok(imported)
    }
    pub fn relocate(&self, relative: &str, parent: &str, name: &str) -> Result<String> {
        valid_name(name)?;
        if relative.is_empty() {
            return Err("The workspace root cannot be moved.".into());
        }
        let source = self.resolve(relative)?;
        let destination_parent = self.resolve(parent)?;
        if !destination_parent.is_dir() {
            return Err("Select an existing destination folder.".into());
        }
        let file = source.is_file();
        if file && (!is_note(&source) || depth(parent) != 2) {
            return Err("Notes must be inside a folder in a vault.".into());
        }
        if !file
            && ((depth(relative) == 1 && !parent.is_empty())
                || (depth(relative) > 1 && depth(parent) != 1))
        {
            return Err("Keep vaults at the workspace root and subfolders inside vaults.".into());
        }
        let name = if file && !is_note(Path::new(name)) {
            format!("{name}.md")
        } else {
            name.into()
        };
        let next = if parent.is_empty() {
            name.clone()
        } else {
            format!("{parent}/{name}")
        };
        let destination = self.resolve(&next)?;
        if source == destination {
            return Ok(relative.into());
        }
        if destination.exists() {
            return Err("An item with this name already exists. Rename it first.".into());
        }
        if destination.starts_with(&source) {
            return Err("A folder cannot be moved inside itself.".into());
        }
        fs::rename(source, destination).map_err(err)?;
        self.move_locks(relative, &next)?;
        Ok(next)
    }
    pub fn remove(&self, relative: &str) -> Result<()> {
        if relative.is_empty() {
            return Err("The workspace root cannot be deleted.".into());
        }
        self.trash(relative)
    }
    pub fn import(&self, source: &Path) -> Result<String> {
        let source = source.canonicalize().map_err(err)?;
        if source.starts_with(&self.root) || self.root.starts_with(&source) {
            return Err("Choose a folder outside the current workspace.".into());
        }
        let original = source
            .file_name()
            .ok_or("Choose a vault folder.")?
            .to_string_lossy()
            .to_string();
        valid_name(&original)?;
        let mut name = original.clone();
        let mut n = 2;
        while self.root.join(&name).exists() {
            name = format!("{original} {n}");
            n += 1;
        }
        let staging = tempfile::tempdir_in(&self.root).map_err(err)?;
        copy_folder(&source, staging.path(), true)?;
        fs::rename(staging.path(), self.root.join(&name)).map_err(err)?;
        self.migrate()?;
        Ok(name)
    }
}
fn copy_folder(source: &Path, dest: &Path, root: bool) -> Result<()> {
    for entry in fs::read_dir(source).map_err(err)? {
        let entry = entry.map_err(err)?;
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let kind = entry.file_type().map_err(err)?;
        if kind.is_symlink() {
            return Err("Import contains a symbolic link. Import ordinary folders instead.".into());
        }
        let mut target = dest.join(&name);
        if kind.is_dir() {
            fs::create_dir_all(&target).map_err(err)?;
            copy_folder(&entry.path(), &target, false)?;
        } else {
            if root && is_note(&entry.path()) {
                let mut imported = "Imported root notes".to_string();
                while source.join(&imported).exists() {
                    imported.push('_');
                }
                target = dest.join(imported).join(&name);
                fs::create_dir_all(target.parent().unwrap()).map_err(err)?;
            }
            fs::copy(entry.path(), target).map_err(err)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hierarchy_and_cross_vault_moves() {
        let temp = tempfile::tempdir().unwrap();
        let w = Workspace::new(temp.path().into()).unwrap();
        w.create("", "vault", "Work").unwrap();
        w.create("", "vault", "Personal").unwrap();
        assert!(w.create("", "note", "Rogue").is_err());
        assert!(w.create("Work", "note", "Overview").is_err());
        w.create("Work", "folder", "Ideas").unwrap();
        assert!(w.create("Work/Ideas", "folder", "Nested").is_err());
        w.create("Personal", "folder", "Journal").unwrap();
        let note = w.create("Work/Ideas", "note", "First").unwrap();
        let original = w.read(&note).unwrap();
        let saved = w.write(&note, "# Changed", &original.revision).unwrap();
        assert!(w
            .write(&note, "stale", &original.revision)
            .unwrap_err()
            .contains("CONFLICT"));
        let moved = w.relocate(&note, "Personal/Journal", "First.md").unwrap();
        assert_eq!(w.read(&moved).unwrap().content, saved.content);
        assert!(!w.resolve(&note).unwrap().exists());
        assert!(w.relocate("Work/Ideas", "Work/Ideas", "Child").is_err());
        assert!(w.create("Personal/Journal", "note", "First").is_err());
    }
    #[test]
    fn validates_boundaries_and_names() {
        let temp = tempfile::tempdir().unwrap();
        let w = Workspace::new(temp.path().into()).unwrap();
        for path in [
            "../secret",
            "C:/secret",
            "/secret",
            "a/../../secret",
            "a\\b",
        ] {
            assert!(w.resolve(path).is_err());
        }
        for name in ["CON", "NUL.md", "bad:name", "trailing.", ".hidden", "a/b"] {
            assert!(valid_name(name).is_err());
        }
        assert!(w.remove("").is_err());
    }
    #[test]
    fn import_copies_without_touching_source() {
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let source = outside.path().join("Existing vault");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("Existing.md"), "my writing").unwrap();
        let w = Workspace::new(temp.path().into()).unwrap();
        let vault = w.import(&source).unwrap();
        assert_eq!(
            w.read(&format!("{vault}/Imported root notes/Existing.md"))
                .unwrap()
                .content,
            "my writing"
        );
        assert_eq!(
            fs::read_to_string(source.join("Existing.md")).unwrap(),
            "my writing"
        );
    }
    #[test]
    fn large_workspace_snapshot_and_search_are_bounded() {
        let temp = tempfile::tempdir().unwrap();
        let w = Workspace::new(temp.path().into()).unwrap();
        w.create("", "vault", "Research").unwrap();
        w.create("Research", "folder", "Notes").unwrap();
        let folder = w.resolve("Research/Notes").unwrap();
        for number in 0..2_000 {
            fs::write(
                folder.join(format!("Note {number}.md")),
                format!("# Note {number}\\nA searchable research record."),
            )
            .unwrap();
        }
        let snapshot = w.snapshot().unwrap();
        assert_eq!(snapshot.entries[0].children[0].children.len(), 2_000);
        let results = w.search("searchable", 80).unwrap();
        assert_eq!(results.len(), 80);
        assert!(results.iter().all(|result| result.path.ends_with(".md")));
    }
    #[test]
    fn importing_markdown_copies_external_files_and_renames_collisions() {
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let source = outside.path().join("Outline.md");
        fs::write(&source, "# Original").unwrap();
        let w = Workspace::new(temp.path().into()).unwrap();
        w.create("", "vault", "Research").unwrap();
        w.create("Research", "folder", "Notes").unwrap();
        let first = w
            .import_markdown("Research/Notes", &[source.to_string_lossy().into()])
            .unwrap();
        let second = w
            .import_markdown("Research/Notes", &[source.to_string_lossy().into()])
            .unwrap();
        assert_eq!(first, ["Research/Notes/Outline.md"]);
        assert_eq!(second, ["Research/Notes/Outline (2).md"]);
        assert_eq!(fs::read_to_string(source).unwrap(), "# Original");
    }
}

#[cfg(all(test, windows))]
mod identity_tests {
    use super::*;
    #[test]
    fn identities_follow_external_renames() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.md");
        let b = dir.path().join("b.md");
        fs::write(&a, "content").unwrap();
        let original = file_identity(&a);
        assert!(original.is_some());
        fs::rename(&a, &b).unwrap();
        assert_eq!(original, file_identity(&b));
        let folder = dir.path().join("folder");
        fs::create_dir(&folder).unwrap();
        let identity = file_identity(&folder);
        assert!(identity.is_some());
        let moved = dir.path().join("moved");
        fs::rename(&folder, &moved).unwrap();
        assert_eq!(identity, file_identity(&moved));
    }
}
