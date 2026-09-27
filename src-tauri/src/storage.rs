//! Internal metadata is isolated from ordinary vault paths. Never follow links.
use crate::workspace::{move_item, Document, Workspace};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
type Result<T> = std::result::Result<T, String>;
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct OrganizerState {
    pub revision: u64,
    pub areas: Vec<Area>,
    pub assignments: std::collections::BTreeMap<String, String>,
    /// Optional user-defined note order, keyed by the containing folder.
    /// Folders not present here continue to use the ordinary alphabetical order.
    #[serde(default)]
    pub orders: std::collections::BTreeMap<String, Vec<String>>,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Area {
    pub id: String,
    pub name: String,
    pub icon: String,
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn now() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
fn atomic(path: &Path, value: &impl Serialize) -> Result<()> {
    let mut file = tempfile::NamedTempFile::new_in(path.parent().unwrap()).map_err(err)?;
    file.write_all(&serde_json::to_vec_pretty(value).map_err(err)?)
        .map_err(err)?;
    file.as_file().sync_all().map_err(err)?;
    file.persist(path).map_err(err)?;
    Ok(())
}
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TrashItem {
    pub id: String,
    pub name: String,
    pub original: String,
    pub kind: String,
    pub deleted: u128,
    #[serde(default)]
    locks: Vec<String>,
}
impl Workspace {
    pub fn organizer(&self) -> Result<OrganizerState> {
        let path = self.metadata_path("organizer.json")?;
        if !path.exists() {
            return Ok(OrganizerState::default());
        }
        serde_json::from_slice(&fs::read(path).map_err(err)?).map_err(err)
    }
    pub fn save_organizer(&self, mut value: OrganizerState) -> Result<OrganizerState> {
        if self.organizer()?.revision != value.revision {
            return Err("Organizer changed in another window. Please try again.".into());
        }
        let mut ids = BTreeSet::new();
        let mut names = BTreeSet::new();
        for area in &mut value.areas {
            area.name = area.name.trim().into();
            if area.name.is_empty()
                || area.name.len() > 100
                || area.id.is_empty()
                || !ids.insert(area.id.clone())
                || !names.insert(area.name.to_lowercase())
                || ![
                    "briefcase",
                    "home",
                    "book",
                    "heart",
                    "leaf",
                    "compass",
                    "graduation",
                    "science",
                    "art",
                    "music",
                    "camera",
                    "travel",
                    "globe",
                    "fitness",
                    "coffee",
                    "people",
                    "calendar",
                    "goals",
                    "ideas",
                    "code",
                    "technology",
                    "outdoors",
                    "cycling",
                    "car",
                    "money",
                    "business",
                    "growth",
                    "pets",
                    "star",
                    "food",
                ]
                .contains(&area.icon.as_str())
            {
                return Err("Areas need unique names and a valid icon.".into());
            }
        }
        value
            .assignments
            .retain(|vault, _| !vault.is_empty() && self.resolve(vault).is_ok_and(|p| p.is_dir()));
        for (vault, area) in &value.assignments {
            if vault.contains('/') || !self.resolve(vault)?.is_dir() || !ids.contains(area) {
                return Err("Choose an existing vault and area.".into());
            }
        }
        // Ordering is presentation metadata only. Keep only existing notes that
        // belong directly to the stored folder, and discard duplicates.
        value.orders.retain(|parent, paths| {
            if !self.resolve(parent).is_ok_and(|p| p.is_dir()) {
                return false;
            }
            let mut seen = BTreeSet::new();
            paths.retain(|path| {
                path.strip_prefix(&format!("{parent}/"))
                    .is_some_and(|tail| !tail.contains('/'))
                    && self.resolve(path).is_ok_and(|p| p.is_file())
                    && seen.insert(path.clone())
            });
            !paths.is_empty()
        });
        value.revision += 1;
        atomic(&self.metadata_path("organizer.json")?, &value)?;
        Ok(value)
    }
    pub(crate) fn internal_dir(&self, name: &str) -> Result<PathBuf> {
        let base = self.home.as_ref().unwrap_or(&self.root);
        let mapped = if self.home.is_some() {
            name.replace(".notus-", ".lotus-")
        } else {
            name.to_string()
        };
        let path = base.join(mapped);
        if path.exists() {
            if fs::symlink_metadata(&path)
                .map_err(err)?
                .file_type()
                .is_symlink()
                || !path.canonicalize().map_err(err)?.starts_with(base)
                || !path.is_dir()
            {
                return Err("Internal metadata directory is not a safe ordinary folder.".into());
            }
        } else {
            fs::create_dir(&path).map_err(err)?;
        }
        Ok(path)
    }
    fn metadata_path(&self, name: &str) -> Result<PathBuf> {
        let path = self.internal_dir(".notus-state")?.join(name);
        if path.exists()
            && fs::symlink_metadata(&path)
                .map_err(err)?
                .file_type()
                .is_symlink()
        {
            return Err("Linked metadata files are not supported.".into());
        }
        Ok(path)
    }
    pub(crate) fn locks(&self) -> Result<BTreeSet<String>> {
        let path = self.metadata_path("locks.json")?;
        if !path.exists() {
            return Ok(BTreeSet::new());
        }
        serde_json::from_slice(&fs::read(path).map_err(err)?).map_err(err)
    }
    fn save_locks(&self, locks: &BTreeSet<String>) -> Result<()> {
        atomic(&self.metadata_path("locks.json")?, locks)
    }
    pub fn set_locked(&self, path: &str, locked: bool, revision: &str) -> Result<Document> {
        let note = self.read(path)?;
        if note.revision != revision {
            return Err(
                "CONFLICT: Note changed in another window. Review it before changing its lock."
                    .into(),
            );
        }
        let mut locks = self.locks()?;
        if locked {
            locks.insert(path.into());
        } else {
            locks.remove(path);
        }
        self.save_locks(&locks)?;
        self.read(path)
    }
    pub(crate) fn move_locks(&self, old: &str, next: &str) -> Result<()> {
        let mut organizer = self.organizer()?;
        let mut changed = false;
        let ordered_note = organizer
            .orders
            .values()
            .any(|paths| paths.iter().any(|path| path == old));
        if !old.contains('/') && !next.contains('/') {
            if let Some(area) = organizer.assignments.remove(old) {
                organizer.assignments.insert(next.into(), area);
                changed = true;
            }
        }
        let mut orders = std::collections::BTreeMap::new();
        for (parent, paths) in organizer.orders {
            let mapped_parent = if parent == old || parent.starts_with(&format!("{old}/")) {
                changed = true;
                format!("{next}{}", &parent[old.len()..])
            } else {
                parent
            };
            let mapped_paths = paths
                .into_iter()
                .map(|path| {
                    if path == old || path.starts_with(&format!("{old}/")) {
                        changed = true;
                        format!("{next}{}", &path[old.len()..])
                    } else {
                        path
                    }
                })
                .collect();
            orders.insert(mapped_parent, mapped_paths);
        }
        organizer.orders = orders;
        let old_parent = old.rsplit_once('/').map(|(parent, _)| parent).unwrap_or("");
        let next_parent = next
            .rsplit_once('/')
            .map(|(parent, _)| parent)
            .unwrap_or("");
        if ordered_note && old_parent != next_parent && old.ends_with(".md") {
            if let Some(paths) = organizer.orders.get_mut(old_parent) {
                paths.retain(|path| path != next);
                if paths.is_empty() {
                    organizer.orders.remove(old_parent);
                }
            }
            organizer
                .orders
                .entry(next_parent.into())
                .or_default()
                .push(next.into());
            changed = true;
        }
        if changed {
            self.save_organizer(organizer)?;
        }
        let locks = self
            .locks()?
            .into_iter()
            .map(|path| {
                if path == old || path.starts_with(&format!("{old}/")) {
                    format!("{next}{}", &path[old.len()..])
                } else {
                    path
                }
            })
            .collect();
        self.save_locks(&locks)
    }
    pub(crate) fn trash(&self, relative: &str) -> Result<()> {
        let source = self.resolve(relative)?;
        if !source.exists() {
            return Err("This item no longer exists.".into());
        }
        // Remove deleted paths from manual presentation order immediately. A
        // restored or imported note is then treated as a newly discovered note
        // and appears alphabetically after the saved ordered notes.
        let mut organizer = self.organizer()?;
        let previous_orders = organizer.orders.clone();
        organizer.orders.retain(|parent, paths| {
            if parent == relative || parent.starts_with(&format!("{relative}/")) {
                return false;
            }
            paths.retain(|path| path != relative && !path.starts_with(&format!("{relative}/")));
            !paths.is_empty()
        });
        if organizer.orders != previous_orders {
            self.save_organizer(organizer)?;
        }
        let root = self.internal_dir(".notus-trash")?;
        let directory = tempfile::Builder::new()
            .prefix("item-")
            .tempdir_in(&root)
            .map_err(err)?;
        let id = directory
            .path()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let locks = self.locks()?;
        let item = TrashItem {
            id,
            name: source.file_name().unwrap().to_string_lossy().into_owned(),
            original: relative.into(),
            kind: if source.is_file() {
                "note"
            } else if relative.contains('/') {
                "folder"
            } else {
                "vault"
            }
            .into(),
            deleted: now(),
            locks: locks
                .iter()
                .filter(|p| *p == relative || p.starts_with(&format!("{relative}/")))
                .cloned()
                .collect(),
        };
        atomic(&directory.path().join("entry.json"), &item)?;
        // Keep the recovery directory before moving anything into it: no RAII deletion of user data.
        let directory = directory.keep();
        move_item(&source, &directory.join("content"))?;
        self.save_locks(
            &locks
                .difference(&item.locks.into_iter().collect())
                .cloned()
                .collect(),
        )
    }
    fn trash_directory(&self, id: &str) -> Result<PathBuf> {
        if !id.starts_with("item-") || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            return Err("Invalid Trash item.".into());
        }
        let root = self.internal_dir(".notus-trash")?;
        let dir = root.join(id);
        if !dir.is_dir()
            || fs::symlink_metadata(&dir)
                .map_err(err)?
                .file_type()
                .is_symlink()
            || !dir
                .canonicalize()
                .map_err(err)?
                .starts_with(root.canonicalize().map_err(err)?)
        {
            return Err("Trash item is not a safe ordinary folder.".into());
        }
        for name in ["entry.json", "content"] {
            let path = dir.join(name);
            if path.exists()
                && fs::symlink_metadata(path)
                    .map_err(err)?
                    .file_type()
                    .is_symlink()
            {
                return Err("Linked Trash entries are not supported.".into());
            }
        }
        Ok(dir)
    }
    pub fn list_trash(&self) -> Result<Vec<TrashItem>> {
        let mut items = Vec::new();
        for entry in fs::read_dir(self.internal_dir(".notus-trash")?).map_err(err)? {
            let entry = entry.map_err(err)?;
            let id = entry.file_name().to_string_lossy().into_owned();
            if !id.starts_with("item-") {
                continue;
            }
            let dir = self.trash_directory(&id)?;
            if !dir.join("content").exists() {
                continue;
            }
            let item: TrashItem =
                serde_json::from_slice(&fs::read(dir.join("entry.json")).map_err(err)?)
                    .map_err(err)?;
            if item.id != id {
                return Err("Trash metadata does not match its folder.".into());
            }
            items.push(item);
        }
        items.sort_by_key(|item| std::cmp::Reverse(item.deleted));
        Ok(items)
    }
    pub fn restore(&self, id: &str) -> Result<String> {
        let item = self
            .list_trash()?
            .into_iter()
            .find(|i| i.id == id)
            .ok_or("Trash item not found.")?;
        let directory = self.trash_directory(id)?;
        let destination = self.resolve(&item.original)?;
        if destination.exists() {
            return Err("An item already exists at the original location. Rename or move it before restoring; nothing was overwritten.".into());
        }
        let count = item.original.split('/').count();
        if !matches!(
            (item.kind.as_str(), count),
            ("vault", 1) | ("folder", 2) | ("note", 2 | 3)
        ) {
            return Err("The original location must be inside a vault.".into());
        }
        if !destination.parent().is_some_and(|p| p.is_dir()) {
            return Err("Restore or recreate the original vault and folder first.".into());
        }
        let mut locks = self.locks()?;
        locks.extend(item.locks);
        self.save_locks(&locks)?;
        move_item(&directory.join("content"), &destination)?;
        // Retain the tiny metadata record as a recovery/audit record. Not listed once restored.
        Ok(item.original)
    }
    pub fn purge(&self, ids: &[String]) -> Result<()> {
        // Resolve and validate the complete explicit target list before deleting any payload.
        let items = self.list_trash()?;
        let mut targets = Vec::new();
        for id in ids {
            if !items.iter().any(|item| &item.id == id) {
                return Err("Trash changed. Refresh and confirm again.".into());
            }
            targets.push(self.trash_directory(id)?);
        }
        for target in targets {
            fs::remove_dir_all(target).map_err(err)?;
        }
        Ok(())
    }
    pub(crate) fn migrate(&self) -> Result<()> {
        // Deepest first, rename only, never merge/overwrite or change Markdown bytes.
        let snapshot = self.snapshot()?;
        fn nested(entry: &crate::workspace::Entry, moves: &mut Vec<(String, String)>) {
            for child in &entry.children {
                nested(child, moves);
            }
            if entry.kind == "folder" && entry.path.split('/').count() > 2 {
                let parts: Vec<_> = entry.path.split('/').collect();
                moves.push((
                    entry.path.clone(),
                    format!("{}/{}", parts[0], parts[1..].join(" - ")),
                ));
            }
        }
        let mut moves = Vec::new();
        for vault in &snapshot.entries {
            nested(vault, &mut moves);
        }
        if moves.is_empty() {
            return Ok(());
        }
        let journal = self.metadata_path(&format!("migration-{}.json", now()))?;
        let mut records = Vec::<(String, String)>::new();
        for (old, base) in moves {
            let mut next = base.clone();
            let mut i = 2;
            while self.resolve(&next)?.exists() {
                next = format!("{base} {i}");
                i += 1;
            }
            records.push((old.clone(), next.clone()));
            atomic(&journal, &records)?; // durable intent; a crash leaves the source OR destination intact.
            fs::rename(self.resolve(&old)?, self.resolve(&next)?).map_err(err)?;
            self.move_locks(&old, &next)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn organizer_is_metadata_only_and_rejects_stale_updates() {
        let t = tempfile::tempdir().unwrap();
        let w = Workspace::new(t.path().into()).unwrap();
        w.create("", "vault", "V").unwrap();
        w.create("V", "folder", "F").unwrap();
        let note = w.create("V/F", "note", "N").unwrap();
        let before = fs::read(w.resolve(&note).unwrap()).unwrap();
        let mut value = w.organizer().unwrap();
        value.areas.push(Area {
            id: "work".into(),
            name: "Work".into(),
            icon: "briefcase".into(),
        });
        value.assignments.insert("V".into(), "work".into());
        let saved = w.save_organizer(value.clone()).unwrap();
        assert!(w.save_organizer(value).is_err());
        assert_eq!(fs::read(w.resolve(&note).unwrap()).unwrap(), before);
        assert_eq!(w.snapshot().unwrap().entries.len(), 1);
        let mut invalid = saved.clone();
        invalid.areas.push(invalid.areas[0].clone());
        assert!(w.save_organizer(invalid).is_err());
        let mut invalid = saved;
        invalid
            .assignments
            .insert("../escape".into(), "work".into());
        // Invalid paths are discarded; no access outside the workspace is permitted.
        let clean = w.save_organizer(invalid).unwrap();
        assert!(!clean.assignments.contains_key("../escape"));
        w.relocate("V", "", "Renamed").unwrap();
        assert_eq!(
            w.organizer().unwrap().assignments.get("Renamed").unwrap(),
            "work"
        );
        assert_eq!(fs::read(w.root.join("Renamed/F/N.md")).unwrap(), before);
    }
    #[test]
    fn manual_note_order_survives_moves_and_prunes_deleted_notes() {
        let t = tempfile::tempdir().unwrap();
        let w = Workspace::new(t.path().into()).unwrap();
        w.create("", "vault", "V").unwrap();
        w.create("V", "folder", "F").unwrap();
        w.create("V", "folder", "G").unwrap();
        let a = w.create("V/F", "note", "A").unwrap();
        let b = w.create("V/F", "note", "B").unwrap();
        let mut state = w.organizer().unwrap();
        state
            .orders
            .insert("V/F".into(), vec![b.clone(), a.clone()]);
        w.save_organizer(state).unwrap();
        let snapshot = w.snapshot().unwrap();
        let names: Vec<_> = snapshot.entries[0].children[0]
            .children
            .iter()
            .map(|entry| entry.name.as_str())
            .collect();
        assert_eq!(names, ["B.md", "A.md"]);
        let moved = w.relocate(&b, "V/G", "B.md").unwrap();
        let state = w.organizer().unwrap();
        assert_eq!(state.orders.get("V/F").unwrap(), &vec![a.clone()]);
        assert_eq!(state.orders.get("V/G").unwrap(), &vec![moved.clone()]);
        w.remove(&moved).unwrap();
        assert!(!w.organizer().unwrap().orders.contains_key("V/G"));
    }
    #[test]
    fn trash_restore_collision_and_purge() {
        let t = tempfile::tempdir().unwrap();
        let w = Workspace::new(t.path().into()).unwrap();
        w.create("", "vault", "V").unwrap();
        w.create("V", "folder", "F").unwrap();
        let p = w.create("V/F", "note", "N").unwrap();
        let original = w.read(&p).unwrap();
        w.set_locked(&p, true, &original.revision).unwrap();
        assert!(w.write(&p, "cannot write", &original.revision).is_err());
        w.remove(&p).unwrap();
        let item = w.list_trash().unwrap().remove(0);
        w.create("V/F", "note", "N").unwrap();
        assert!(w.restore(&item.id).is_err());
        w.remove(&p).unwrap();
        w.restore(&item.id).unwrap();
        assert!(w.read(&p).unwrap().locked);
        assert_eq!(w.read(&p).unwrap().content, original.content);
        let ids = w
            .list_trash()
            .unwrap()
            .into_iter()
            .map(|i| i.id)
            .collect::<Vec<_>>();
        w.purge(&ids).unwrap();
        assert!(w.list_trash().unwrap().is_empty());
        assert!(w.purge(&["../V".into()]).is_err());
        assert!(w.resolve(".notus-trash").is_err());
    }
    #[test]
    fn migration_preserves_bytes_and_is_idempotent() {
        let t = tempfile::tempdir().unwrap();
        fs::create_dir_all(t.path().join("V/F/Sub/Deep")).unwrap();
        fs::create_dir_all(t.path().join("V/F - Sub")).unwrap();
        fs::write(t.path().join("V/F/Sub/N.md"), b"original\r\nbytes").unwrap();
        fs::write(t.path().join("V/root.md"), b"root note").unwrap();
        let w = Workspace::new(t.path().into()).unwrap();
        assert_eq!(
            fs::read(w.root.join("V/F - Sub 2/N.md")).unwrap(),
            b"original\r\nbytes"
        );
        assert!(w.root.join("V/F - Sub - Deep").is_dir());
        assert_eq!(w.read("V/root.md").unwrap().content, "root note");
        let before = serde_json::to_string(&w.snapshot().unwrap()).unwrap();
        w.migrate().unwrap();
        assert_eq!(
            before,
            serde_json::to_string(&w.snapshot().unwrap()).unwrap()
        );
    }
}
