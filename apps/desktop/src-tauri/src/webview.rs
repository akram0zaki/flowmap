//! WebView2 presence (spec 10 §3.2).
//!
//! Evergreen builds use the system runtime. Standalone builds ship a fixed
//! version next to the executable. If neither is available the process explains
//! itself and names the standalone ZIP — it does not try to install anything.

use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WebviewKind {
    Evergreen,
    Fixed,
    WkWebView,
}

impl WebviewKind {
    pub fn as_str(self) -> &'static str {
        match self {
            WebviewKind::Evergreen => "evergreen",
            WebviewKind::Fixed => "fixed",
            WebviewKind::WkWebView => "wkwebview",
        }
    }
}

/// A folder that contains `msedgewebview2.exe` is a usable fixed runtime.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn find_fixed_runtime(exe_parent: &Path) -> Option<PathBuf> {
    let direct = exe_parent.join("webview2");
    if direct.join("msedgewebview2.exe").is_file() {
        return Some(direct);
    }

    let entries = std::fs::read_dir(exe_parent).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with("Microsoft.WebView2.FixedVersionRuntime")
            && path.join("msedgewebview2.exe").is_file()
        {
            return Some(path);
        }
    }
    None
}

#[cfg_attr(not(windows), allow(dead_code))]
pub fn standalone_zip_name(version: &str) -> String {
    format!("Flowmap-{version}-win-x64-standalone.zip")
}

#[cfg(windows)]
mod win {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;

    const MB_OK: u32 = 0x0000_0000;
    const MB_ICONERROR: u32 = 0x0000_0010;
    const KEY_READ: u32 = 0x0002_0019;
    const ERROR_SUCCESS: i32 = 0;
    const HKEY_LOCAL_MACHINE: isize = 0x8000_0002u32 as i32 as isize;
    const HKEY_CURRENT_USER: isize = 0x8000_0001u32 as i32 as isize;
    const WEBVIEW_GUID: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(
            hwnd: *mut core::ffi::c_void,
            text: *const u16,
            caption: *const u16,
            ty: u32,
        ) -> i32;
    }

    #[link(name = "advapi32")]
    extern "system" {
        fn RegOpenKeyExW(
            hkey: isize,
            sub_key: *const u16,
            options: u32,
            sam: u32,
            result: *mut isize,
        ) -> i32;
        fn RegQueryValueExW(
            hkey: isize,
            value_name: *const u16,
            reserved: *mut u32,
            ty: *mut u32,
            data: *mut u8,
            data_len: *mut u32,
        ) -> i32;
        fn RegCloseKey(hkey: isize) -> i32;
    }

    fn wide(value: &str) -> Vec<u16> {
        OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    pub fn show_error(caption: &str, text: &str) {
        let caption_w = wide(caption);
        let text_w = wide(text);
        unsafe {
            MessageBoxW(
                ptr::null_mut(),
                text_w.as_ptr(),
                caption_w.as_ptr(),
                MB_OK | MB_ICONERROR,
            );
        }
    }

    fn key_has_version(hive: isize, sub_key: &str) -> bool {
        let sub = wide(sub_key);
        let mut handle = 0isize;
        let opened = unsafe { RegOpenKeyExW(hive, sub.as_ptr(), 0, KEY_READ, &mut handle) };
        if opened != ERROR_SUCCESS {
            return false;
        }
        let name = wide("pv");
        let mut kind = 0u32;
        let mut len = 0u32;
        let queried = unsafe {
            RegQueryValueExW(
                handle,
                name.as_ptr(),
                ptr::null_mut(),
                &mut kind,
                ptr::null_mut(),
                &mut len,
            )
        };
        unsafe {
            RegCloseKey(handle);
        }
        queried == ERROR_SUCCESS && len > 2
    }

    pub fn evergreen_present() -> bool {
        let machine = format!(r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{WEBVIEW_GUID}");
        let machine_native = format!(r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{WEBVIEW_GUID}");
        let user = format!(r"Software\Microsoft\EdgeUpdate\Clients\{WEBVIEW_GUID}");
        key_has_version(HKEY_LOCAL_MACHINE, &machine)
            || key_has_version(HKEY_LOCAL_MACHINE, &machine_native)
            || key_has_version(HKEY_CURRENT_USER, &user)
            || std::path::Path::new(r"C:\Program Files (x86)\Microsoft\EdgeWebView\Application")
                .is_dir()
    }
}

#[cfg(not(windows))]
#[allow(dead_code)]
pub fn evergreen_present() -> bool {
    false
}

#[cfg(windows)]
pub fn evergreen_present() -> bool {
    win::evergreen_present()
}

#[cfg_attr(not(windows), allow(dead_code))]
pub fn missing_runtime_message(version: &str) -> String {
    format!(
        "Flowmap needs the Microsoft WebView2 runtime, which is not installed on this computer.\n\n\
         Download {zip}. That build includes the runtime and does not need anything installed.\n\n\
         Or install the Evergreen WebView2 Runtime from Microsoft, then run this build again.",
        zip = standalone_zip_name(version)
    )
}

/// Point the process at a bundled runtime, or refuse to start on Windows when
/// the system runtime is missing. Safe to call before the Tauri builder.
pub fn prepare_webview(version: &str) -> Result<WebviewKind, String> {
    #[cfg(not(windows))]
    {
        let _ = version;
        return Ok(WebviewKind::WkWebView);
    }

    #[cfg(windows)]
    {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                if let Some(fixed) = find_fixed_runtime(parent) {
                    std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", &fixed);
                    return Ok(WebviewKind::Fixed);
                }
            }
        }
        if evergreen_present() {
            return Ok(WebviewKind::Evergreen);
        }
        let message = missing_runtime_message(version);
        win::show_error("Flowmap", &message);
        Err(message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT: AtomicU64 = AtomicU64::new(0);

    fn scratch() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "flowmap-webview-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn finds_a_webview2_folder_beside_the_exe() {
        let parent = scratch();
        let runtime = parent.join("webview2");
        std::fs::create_dir_all(&runtime).unwrap();
        std::fs::write(runtime.join("msedgewebview2.exe"), b"stub").unwrap();
        assert_eq!(find_fixed_runtime(&parent), Some(runtime));
    }

    #[test]
    fn finds_the_microsoft_fixed_runtime_folder_name() {
        let parent = scratch();
        let runtime = parent.join("Microsoft.WebView2.FixedVersionRuntime.130.0.2849.80.x64");
        std::fs::create_dir_all(&runtime).unwrap();
        std::fs::write(runtime.join("msedgewebview2.exe"), b"stub").unwrap();
        assert_eq!(find_fixed_runtime(&parent), Some(runtime));
    }

    #[test]
    fn ignores_a_folder_without_the_runtime_binary() {
        let parent = scratch();
        std::fs::create_dir_all(parent.join("webview2")).unwrap();
        assert_eq!(find_fixed_runtime(&parent), None);
    }

    #[test]
    fn names_the_standalone_zip_in_the_missing_runtime_message() {
        let message = missing_runtime_message("0.1.0");
        assert!(message.contains("Flowmap-0.1.0-win-x64-standalone.zip"));
        assert!(message.contains("WebView2"));
        assert!(!message.contains("install Flowmap"));
    }

    #[test]
    fn standalone_zip_name_matches_the_distribution_contract() {
        assert_eq!(
            standalone_zip_name("1.2.3"),
            "Flowmap-1.2.3-win-x64-standalone.zip"
        );
    }
}
