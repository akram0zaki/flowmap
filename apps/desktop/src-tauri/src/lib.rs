//! Flowmap desktop shell.
//!
//! The IPC surface is deliberately tiny: database access, and nothing else.
//! There is **no network command at all** — Flowmap makes no outbound requests
//! of any kind. The only way anything leaves the machine is the system browser
//! opening an `https:` link. See docs/spec/10-desktop-security.md §2.

mod db;
mod menu;
mod paths;
mod webview;

use tauri::Manager;

use db::{DbState, OpenInfo, Param};

pub fn prepare_webview() -> Result<webview::WebviewKind, String> {
    webview::prepare_webview(env!("CARGO_PKG_VERSION"))
}

#[tauri::command]
fn db_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, DbState>,
    webview: tauri::State<'_, webview::WebviewKind>,
) -> Result<OpenInfo, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve the application data directory: {e}"))?;

    let exe_parent = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|parent| parent.to_path_buf()));
    let layout = paths::resolve_layout(
        app_data.clone(),
        std::env::var("FLOWMAP_DATA_DIR").ok(),
        exe_parent,
        paths::dir_is_writable,
    );
    paths::migrate_legacy_db(&layout, &[app_data])?;

    let (conn, info) = db::open_at(&layout, *webview)?;

    *state
        .conn
        .lock()
        .map_err(|_| "database lock poisoned".to_string())? = Some(conn);
    *state
        .path
        .lock()
        .map_err(|_| "database path lock poisoned".to_string())? =
        Some(layout.workspaces_dir.join("flowmap.db"));
    Ok(info)
}

#[tauri::command]
fn db_exec(state: tauri::State<'_, DbState>, sql: String) -> Result<(), String> {
    db::exec(&state, &sql)
}

#[tauri::command]
fn db_run(state: tauri::State<'_, DbState>, sql: String, params: Vec<Param>) -> Result<(), String> {
    db::run(&state, &sql, &params)
}

#[tauri::command]
fn db_query(
    state: tauri::State<'_, DbState>,
    sql: String,
    params: Vec<Param>,
) -> Result<Vec<serde_json::Map<String, serde_json::Value>>, String> {
    db::query(&state, &sql, &params)
}

#[tauri::command]
fn db_begin(state: tauri::State<'_, DbState>) -> Result<(), String> {
    db::exec(&state, "BEGIN IMMEDIATE")
}

#[tauri::command]
fn db_commit(state: tauri::State<'_, DbState>) -> Result<(), String> {
    db::exec(&state, "COMMIT")
}

#[tauri::command]
fn db_rollback(state: tauri::State<'_, DbState>) -> Result<(), String> {
    db::exec(&state, "ROLLBACK")
}

#[tauri::command]
fn db_close(state: tauri::State<'_, DbState>) -> Result<(), String> {
    let mut guard = state
        .conn
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    *guard = None;
    *state
        .path
        .lock()
        .map_err(|_| "database path lock poisoned".to_string())? = None;
    Ok(())
}

#[tauri::command]
fn db_backup(state: tauri::State<'_, DbState>, version: u32) -> Result<String, String> {
    db::backup(&state, version)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let webview = prepare_webview().unwrap_or_else(|message| {
        eprintln!("{message}");
        std::process::exit(1);
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(DbState::default())
        .manage(webview)
        .setup(|app| {
            let menu = menu::build(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            menu::emit(app, event.id().as_ref());
        })
        .invoke_handler(tauri::generate_handler![
            db_open,
            db_exec,
            db_run,
            db_query,
            db_begin,
            db_commit,
            db_rollback,
            db_backup,
            db_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running Flowmap");
}
