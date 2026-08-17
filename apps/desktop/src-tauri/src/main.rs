#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebView2 is checked inside `run` before the window is created, so a
    // missing runtime explains itself instead of failing as an opaque crash.
    flowmap_lib::run()
}
