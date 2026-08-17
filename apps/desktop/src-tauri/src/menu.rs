//! Native application menus (spec 10 §3, M7-PKG-7).
//!
//! Labels match the English catalogue. `SUPPORTED_LOCALES` is `en` only; a
//! second locale must build this menu from the frontend so the words stay
//! in the catalogue.

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

pub const EVENT: &str = "flowmap://menu";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let clear = MenuItem::with_id(app, "clear-local-data", "Clear local data…", true, None::<&str>)?;
    let undo = MenuItem::with_id(app, "undo", "Undo", true, Some("CmdOrCtrl+Z"))?;
    let redo = MenuItem::with_id(app, "redo", "Redo", true, Some("CmdOrCtrl+Shift+Z"))?;
    let palette = MenuItem::with_id(
        app,
        "command-palette",
        "Command palette",
        true,
        Some("CmdOrCtrl+K"),
    )?;
    let list = MenuItem::with_id(
        app,
        "list-companion",
        "List companion",
        true,
        Some("CmdOrCtrl+L"),
    )?;
    let present = MenuItem::with_id(
        app,
        "presentation",
        "Presentation mode",
        true,
        Some("CmdOrCtrl+Shift+P"),
    )?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, Some("CmdOrCtrl+,"))?;
    let shortcuts = MenuItem::with_id(app, "shortcuts", "Keyboard shortcuts", true, Some("Shift+?"))?;

    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &clear,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("Quit Flowmap"))?,
        ],
    )?;

    let edit = Submenu::with_items(app, "Edit", true, &[&undo, &redo])?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &palette,
            &list,
            &present,
            &PredefinedMenuItem::separator(app)?,
            &settings,
        ],
    )?;

    #[cfg(target_os = "macos")]
    {
        let app_menu = Submenu::with_items(
            app,
            "Flowmap",
            true,
            &[
                &PredefinedMenuItem::about(app, Some("About Flowmap"), Some(AboutMetadata::default()))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, Some("Quit Flowmap"))?,
            ],
        )?;
        let help = Submenu::with_items(app, "Help", true, &[&shortcuts])?;
        return Menu::with_items(app, &[&app_menu, &file, &edit, &view, &help]);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let about = MenuItem::with_id(app, "about", "About Flowmap", true, None::<&str>)?;
        let help = Submenu::with_items(app, "Help", true, &[&shortcuts, &about])?;
        Menu::with_items(app, &[&file, &edit, &view, &help])
    }
}

pub fn emit<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let _ = app.emit(EVENT, id);
}
