//! SQLite behind the IPC boundary.
//!
//! The web layer has no filesystem, network, or database access. It reaches
//! SQLite only through the `db_*` commands here, and every value it supplies is
//! **bound as a parameter** — never interpolated into SQL text.
//!
//! Data-directory resolution lives in `paths` (spec 10 §3.1). This module
//! opens the database at `{workspaces}/flowmap.db` and reports the resolved
//! layout so Settings can show it.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::types::{Value, ValueRef};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::paths::{DataLayout, DataSource};
use crate::webview::WebviewKind;

#[derive(Default)]
pub struct DbState {
    pub conn: Mutex<Option<Connection>>,
    pub path: Mutex<Option<PathBuf>>,
}

#[derive(Serialize)]
pub struct OpenInfo {
    #[serde(rename = "dataDir")]
    pub data_dir: String,
    #[serde(rename = "workspacesDir")]
    pub workspaces_dir: String,
    #[serde(rename = "logsDir")]
    pub logs_dir: String,
    pub portable: bool,
    #[serde(rename = "portableSource")]
    pub portable_source: DataSource,
    pub version: String,
    pub webview: String,
    #[serde(rename = "corruptCacheRecovered")]
    pub corrupt_cache_recovered: bool,
}

/// JSON-compatible parameter. `bigint` and byte arrays are converted on the JS
/// side before they get here.
#[derive(Deserialize, Debug, Clone)]
#[serde(untagged)]
pub enum Param {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Text(String),
    Blob(Vec<u8>),
}

impl Param {
    fn to_sql_value(&self) -> Value {
        match self {
            Param::Null => Value::Null,
            Param::Bool(b) => Value::Integer(i64::from(*b)),
            Param::Int(i) => Value::Integer(*i),
            Param::Float(f) => Value::Real(*f),
            Param::Text(s) => Value::Text(s.clone()),
            Param::Blob(b) => Value::Blob(b.clone()),
        }
    }
}

/// Cloud-sync roots. A SQLite file opened from two machines is corrupted
/// silently, so the database never lives in one — the shared *workspace
/// document* does. See docs/spec/07-persistence-sync.md §1.
const CLOUD_MARKERS: [&str; 6] = [
    "onedrive",
    "icloud drive",
    "com~apple~clouddocs",
    "dropbox",
    "google drive",
    "box sync",
];

fn is_cloud_synced(path: &Path) -> Option<String> {
    let lower = path.to_string_lossy().to_lowercase();
    CLOUD_MARKERS
        .iter()
        .find(|marker| lower.contains(*marker))
        .map(|marker| (*marker).to_string())
}

fn configure(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;",
    )
    .map_err(|e| e.to_string())
}

fn integrity_ok(conn: &Connection) -> Result<bool, String> {
    let result: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    Ok(result.eq_ignore_ascii_case("ok"))
}

pub fn open_at(
    layout: &DataLayout,
    webview: WebviewKind,
) -> Result<(Connection, OpenInfo), String> {
    fs::create_dir_all(&layout.workspaces_dir)
        .map_err(|e| format!("Cannot create workspaces directory: {e}"))?;
    fs::create_dir_all(&layout.logs_dir).map_err(|e| format!("Cannot create logs directory: {e}"))?;

    let path = layout.workspaces_dir.join("flowmap.db");

    if std::env::var("FLOWMAP_ALLOW_SYNCED_DB").is_err() {
        if let Some(marker) = is_cloud_synced(&path) {
            return Err(format!(
                "Refusing to open a Flowmap database inside a cloud-synced folder (matched \"{marker}\"). \
                 SQLite must never be opened by two machines. Move it, or set FLOWMAP_ALLOW_SYNCED_DB=1."
            ));
        }
    }

    let mut conn = Connection::open(&path).map_err(|e| e.to_string())?;
    configure(&conn)?;
    // A local cache is recoverable, but it is never silently discarded. Keep
    // the original beside the rebuilt cache so support can restore a snapshot
    // or inspect it; shared-provider rebuilding is added with M8.
    let corrupt_cache_recovered = if integrity_ok(&conn)? {
        false
    } else {
        drop(conn);
        let backup = layout.workspaces_dir.join(format!(
            "flowmap.corrupt-{}.db",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_secs()
        ));
        fs::rename(&path, backup).map_err(|e| format!("Cannot preserve corrupt cache: {e}"))?;
        conn = Connection::open(&path).map_err(|e| e.to_string())?;
        configure(&conn)?;
        true
    };

    Ok((
        conn,
        OpenInfo {
            data_dir: layout.root.to_string_lossy().to_string(),
            workspaces_dir: layout.workspaces_dir.to_string_lossy().to_string(),
            logs_dir: layout.logs_dir.to_string_lossy().to_string(),
            portable: layout.portable,
            portable_source: layout.source,
            version: env!("CARGO_PKG_VERSION").to_string(),
            webview: webview.as_str().to_string(),
            corrupt_cache_recovered,
        },
    ))
}

fn with_conn<T>(
    state: &DbState,
    f: impl FnOnce(&Connection) -> Result<T, rusqlite::Error>,
) -> Result<T, String> {
    let guard = state.conn.lock().map_err(|_| "database lock poisoned".to_string())?;
    let conn = guard.as_ref().ok_or_else(|| "database is not open".to_string())?;
    f(conn).map_err(|e| e.to_string())
}

pub fn exec(state: &DbState, sql: &str) -> Result<(), String> {
    with_conn(state, |conn| conn.execute_batch(sql))
}

/** Preserves the database before a forward-only migration. Never overwrites a backup. */
pub fn backup(state: &DbState, version: u32) -> Result<String, String> {
    // Flush WAL first; copying only the main file while WAL contains committed
    // pages would create a backup that cannot be restored independently.
    with_conn(state, |conn| conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)"))?;
    let path = state
        .path
        .lock()
        .map_err(|_| "database path lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| "database is not open".to_string())?;
    let target = path.with_file_name(format!("flowmap.pre-migration-{version}.db"));
    if !target.exists() {
        fs::copy(&path, &target).map_err(|e| format!("Cannot write pre-migration backup: {e}"))?;
    }
    Ok(target.to_string_lossy().to_string())
}

pub fn run(state: &DbState, sql: &str, params: &[Param]) -> Result<(), String> {
    with_conn(state, |conn| {
        let values: Vec<Value> = params.iter().map(Param::to_sql_value).collect();
        let refs: Vec<&dyn rusqlite::ToSql> =
            values.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
        conn.execute(sql, refs.as_slice()).map(|_| ())
    })
}

pub fn query(
    state: &DbState,
    sql: &str,
    params: &[Param],
) -> Result<Vec<serde_json::Map<String, serde_json::Value>>, String> {
    with_conn(state, |conn| {
        let mut stmt = conn.prepare(sql)?;
        let columns: Vec<String> = stmt.column_names().iter().map(|c| (*c).to_string()).collect();

        let values: Vec<Value> = params.iter().map(Param::to_sql_value).collect();
        let refs: Vec<&dyn rusqlite::ToSql> =
            values.iter().map(|v| v as &dyn rusqlite::ToSql).collect();

        let mut rows = stmt.query(refs.as_slice())?;
        let mut out = Vec::new();

        while let Some(row) = rows.next()? {
            let mut map = serde_json::Map::new();
            for (index, name) in columns.iter().enumerate() {
                let json = match row.get_ref(index)? {
                    ValueRef::Null => serde_json::Value::Null,
                    ValueRef::Integer(i) => serde_json::Value::from(i),
                    ValueRef::Real(f) => serde_json::Value::from(f),
                    ValueRef::Text(t) => {
                        serde_json::Value::from(String::from_utf8_lossy(t).to_string())
                    }
                    ValueRef::Blob(b) => serde_json::Value::from(b.to_vec()),
                };
                map.insert(name.clone(), json);
            }
            out.push(map);
        }
        Ok(out)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_memory() -> DbState {
        let state = DbState::default();
        let conn = Connection::open_in_memory().unwrap();
        *state.conn.lock().unwrap() = Some(conn);
        state
    }

    #[test]
    fn rejects_a_cloud_synced_path() {
        assert_eq!(
            is_cloud_synced(Path::new("/Users/x/OneDrive - Co/flowmap.db")),
            Some("onedrive".to_string())
        );
        assert_eq!(
            is_cloud_synced(Path::new("/Users/x/Library/Application Support/Flowmap/flowmap.db")),
            None
        );
    }

    #[test]
    fn binds_parameters_rather_than_interpolating() {
        let state = open_memory();
        exec(&state, "CREATE TABLE t (a TEXT, b INTEGER)").unwrap();

        // A value that would be catastrophic if interpolated.
        let injection = "'); DROP TABLE t; --";
        run(
            &state,
            "INSERT INTO t (a, b) VALUES (?, ?)",
            &[Param::Text(injection.to_string()), Param::Int(42)],
        )
        .unwrap();

        let rows = query(&state, "SELECT a, b FROM t", &[]).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["a"], serde_json::Value::from(injection));
        assert_eq!(rows[0]["b"], serde_json::Value::from(42));
    }

    #[test]
    fn returns_null_and_typed_values() {
        let state = open_memory();
        exec(&state, "CREATE TABLE t (a TEXT, b REAL, c INTEGER)").unwrap();
        run(
            &state,
            "INSERT INTO t VALUES (?, ?, ?)",
            &[Param::Null, Param::Float(1.5), Param::Bool(true)],
        )
        .unwrap();

        let rows = query(&state, "SELECT * FROM t", &[]).unwrap();
        assert_eq!(rows[0]["a"], serde_json::Value::Null);
        assert_eq!(rows[0]["b"], serde_json::Value::from(1.5));
        assert_eq!(rows[0]["c"], serde_json::Value::from(1));
    }

    #[test]
    fn refuses_to_work_when_closed() {
        let state = DbState::default();
        assert!(exec(&state, "SELECT 1").is_err());
    }

    #[test]
    fn integrity_check_accepts_a_new_database() {
        let conn = Connection::open_in_memory().unwrap();
        assert!(integrity_ok(&conn).unwrap());
    }
}
