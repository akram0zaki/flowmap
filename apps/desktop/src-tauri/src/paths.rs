//! Portable data-directory resolution (spec 10 §3.1).
//!
//! Order:
//!   1. `FLOWMAP_DATA_DIR`, if set
//!   2. a writable `data/` folder beside the executable — fully portable
//!   3. the per-user application-data directory (`…/Flowmap`)
//!
//! Database and snapshots live under `workspaces/`. Logs live under `logs/`
//! except on macOS in per-user mode, where they go to `~/Library/Logs/Flowmap`.
//! OS-secure credential storage is never relocated into a portable folder.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DataSource {
    Env,
    BesideExe,
    AppData,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DataLayout {
    pub root: PathBuf,
    pub workspaces_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub portable: bool,
    pub source: DataSource,
}

pub fn dir_is_writable(dir: &Path) -> bool {
    let probe = dir.join(".flowmap-write-probe");
    if fs::write(&probe, b"1").is_ok() {
        let _ = fs::remove_file(&probe);
        return true;
    }
    false
}

fn layout(root: PathBuf, portable: bool, source: DataSource) -> DataLayout {
    let workspaces_dir = root.join("workspaces");
    let logs_dir = default_logs_dir(&root, portable);
    DataLayout {
        root,
        workspaces_dir,
        logs_dir,
        portable,
        source,
    }
}

pub fn default_logs_dir(root: &Path, portable: bool) -> PathBuf {
    if portable {
        return root.join("logs");
    }
    if cfg!(target_os = "macos") {
        if let Some(app_support) = root.parent() {
            if let Some(library) = app_support.parent() {
                return library.join("Logs").join("Flowmap");
            }
        }
    }
    root.join("logs")
}

/// Tauri's default data dir uses the bundle identifier. Spec 10 §3.1 names the
/// folder `Flowmap` so a lead can find it, and so deleting the folder removes
/// the instance.
pub fn spec_app_data(tauri_app_data: &Path) -> PathBuf {
    tauri_app_data
        .parent()
        .map(|parent| parent.join("Flowmap"))
        .unwrap_or_else(|| tauri_app_data.to_path_buf())
}

pub fn resolve_layout(
    tauri_app_data: PathBuf,
    env_data_dir: Option<String>,
    exe_parent: Option<PathBuf>,
    dir_writable: impl Fn(&Path) -> bool,
) -> DataLayout {
    if let Some(explicit) = env_data_dir.filter(|value| !value.is_empty()) {
        return layout(PathBuf::from(explicit), true, DataSource::Env);
    }
    if let Some(parent) = exe_parent {
        let candidate = parent.join("data");
        if candidate.is_dir() && dir_writable(&candidate) {
            return layout(candidate, true, DataSource::BesideExe);
        }
    }
    layout(spec_app_data(&tauri_app_data), false, DataSource::AppData)
}

fn sqlite_sidecars(path: &Path) -> [PathBuf; 2] {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "flowmap.db".to_string());
    [
        path.with_file_name(format!("{name}-wal")),
        path.with_file_name(format!("{name}-shm")),
    ]
}

fn move_sqlite(src: &Path, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create workspaces directory: {e}"))?;
    }
    match fs::rename(src, dest) {
        Ok(()) => {}
        Err(_) => {
            fs::copy(src, dest).map_err(|e| format!("Cannot move database: {e}"))?;
            fs::remove_file(src).map_err(|e| format!("Cannot remove old database: {e}"))?;
        }
    }
    for from in sqlite_sidecars(src) {
        if from.exists() {
            let name = from
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            let to = dest.with_file_name(name);
            let _ = fs::rename(&from, &to).or_else(|_| {
                fs::copy(&from, &to).and_then(|_| fs::remove_file(&from))
            });
        }
    }
    Ok(())
}

/// Move a database left at the previous locations so an upgrade does not look
/// like an empty workspace.
pub fn migrate_legacy_db(layout: &DataLayout, legacy_dirs: &[PathBuf]) -> Result<(), String> {
    let dest = layout.workspaces_dir.join("flowmap.db");
    if dest.exists() {
        return Ok(());
    }

    let mut candidates = vec![layout.root.join("flowmap.db")];
    for dir in legacy_dirs {
        let path = dir.join("flowmap.db");
        if path != dest && path != candidates[0] {
            candidates.push(path);
        }
    }

    for src in candidates {
        if src.exists() {
            return move_sqlite(&src, &dest);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT: AtomicU64 = AtomicU64::new(0);

    fn scratch() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "flowmap-paths-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn writable(_: &Path) -> bool {
        true
    }

    fn not_writable(_: &Path) -> bool {
        false
    }

    #[test]
    fn env_wins_over_beside_exe_and_app_data() {
        let app_data = scratch().join("com.flowmap.desktop");
        let exe_parent = scratch();
        fs::create_dir_all(exe_parent.join("data")).unwrap();
        let chosen = scratch().join("from-env");

        let layout = resolve_layout(
            app_data,
            Some(chosen.to_string_lossy().into_owned()),
            Some(exe_parent),
            writable,
        );
        assert_eq!(layout.root, chosen);
        assert!(layout.portable);
        assert_eq!(layout.source, DataSource::Env);
        assert_eq!(layout.workspaces_dir, chosen.join("workspaces"));
    }

    #[test]
    fn empty_env_falls_through() {
        let app_data = scratch().join("com.flowmap.desktop");
        let layout = resolve_layout(app_data.clone(), Some(String::new()), None, writable);
        assert_eq!(layout.root, spec_app_data(&app_data));
        assert!(!layout.portable);
        assert_eq!(layout.source, DataSource::AppData);
    }

    #[test]
    fn writable_data_beside_exe_is_fully_portable() {
        let app_data = scratch().join("com.flowmap.desktop");
        let exe_parent = scratch();
        let data = exe_parent.join("data");
        fs::create_dir_all(&data).unwrap();

        let layout = resolve_layout(app_data, None, Some(exe_parent), writable);
        assert_eq!(layout.root, data);
        assert!(layout.portable);
        assert_eq!(layout.source, DataSource::BesideExe);
        assert_eq!(layout.logs_dir, data.join("logs"));
    }

    #[test]
    fn unwritable_data_beside_exe_is_ignored() {
        let app_data = scratch().join("com.flowmap.desktop");
        let exe_parent = scratch();
        fs::create_dir_all(exe_parent.join("data")).unwrap();

        let layout = resolve_layout(app_data.clone(), None, Some(exe_parent), not_writable);
        assert_eq!(layout.root, spec_app_data(&app_data));
        assert!(!layout.portable);
        assert_eq!(layout.source, DataSource::AppData);
    }

    #[test]
    fn missing_data_folder_is_not_portable() {
        let app_data = scratch().join("com.flowmap.desktop");
        let exe_parent = scratch();
        let layout = resolve_layout(app_data.clone(), None, Some(exe_parent), writable);
        assert_eq!(layout.root, spec_app_data(&app_data));
        assert_eq!(layout.source, DataSource::AppData);
    }

    #[test]
    fn spec_folder_is_flowmap_not_the_bundle_id() {
        let tauri = PathBuf::from("/Users/x/Library/Application Support/com.flowmap.desktop");
        assert_eq!(
            spec_app_data(&tauri),
            PathBuf::from("/Users/x/Library/Application Support/Flowmap")
        );
    }

    #[test]
    fn macos_logs_leave_application_support() {
        let root = PathBuf::from("/Users/x/Library/Application Support/Flowmap");
        let logs = default_logs_dir(&root, false);
        if cfg!(target_os = "macos") {
            assert_eq!(logs, PathBuf::from("/Users/x/Library/Logs/Flowmap"));
        } else {
            assert_eq!(logs, root.join("logs"));
        }
        assert_eq!(
            default_logs_dir(&PathBuf::from("/media/usb/data"), true),
            PathBuf::from("/media/usb/data/logs")
        );
    }

    #[test]
    fn migrate_moves_a_root_database_into_workspaces() {
        let root = scratch();
        let src = root.join("flowmap.db");
        fs::write(&src, b"db").unwrap();
        fs::write(root.join("flowmap.db-wal"), b"wal").unwrap();
        let layout = layout(root.clone(), true, DataSource::BesideExe);

        migrate_legacy_db(&layout, &[]).unwrap();

        assert!(layout.workspaces_dir.join("flowmap.db").exists());
        assert!(layout.workspaces_dir.join("flowmap.db-wal").exists());
        assert!(!src.exists());
    }

    #[test]
    fn migrate_moves_a_legacy_identifier_database() {
        let root = scratch();
        let legacy = scratch();
        fs::write(legacy.join("flowmap.db"), b"old").unwrap();
        let layout = layout(root, false, DataSource::AppData);

        migrate_legacy_db(&layout, &[legacy.clone()]).unwrap();

        assert_eq!(
            fs::read(layout.workspaces_dir.join("flowmap.db")).unwrap(),
            b"old"
        );
        assert!(!legacy.join("flowmap.db").exists());
    }

    #[test]
    fn migrate_is_a_noop_when_the_destination_exists() {
        let root = scratch();
        let layout = layout(root.clone(), false, DataSource::AppData);
        fs::create_dir_all(&layout.workspaces_dir).unwrap();
        fs::write(layout.workspaces_dir.join("flowmap.db"), b"kept").unwrap();
        fs::write(root.join("flowmap.db"), b"stale").unwrap();

        migrate_legacy_db(&layout, &[]).unwrap();

        assert_eq!(
            fs::read(layout.workspaces_dir.join("flowmap.db")).unwrap(),
            b"kept"
        );
    }
}
