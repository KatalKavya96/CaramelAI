// No console window next to the app on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;

use serde::Deserialize;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::UpdaterExt;
use url::Url;

/// The ready line the backend prints once it listens (src/server/local-main.ts).
const READY_PREFIX: &str = "CARAMEL_READY ";

/// Defined before any page script runs, so the UI can detect the desktop window and show Browse.
const BRIDGE_SCRIPT: &str = r#"
window.caramelShell = Object.freeze({
  pickFolder: () => window.__TAURI_INTERNALS__.invoke("pick_folder"),
});
"#;

#[derive(Deserialize)]
struct Ready {
    url: String,
}

/// Kept so the backend can be stopped when the app quits.
struct Backend(Mutex<Option<CommandChild>>);

/// Opens the OS folder picker. Returns an absolute path, or None when the user cancels.
#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .set_title("Choose a project folder")
        .blocking_pick_folder()
        .and_then(|folder| folder.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

/// The same scheme, host and port as the backend. Anything else opens in the user's browser,
/// so a link in a run log can never load a foreign page inside the window that holds our session.
fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme() && a.host() == b.host() && a.port_or_known_default() == b.port_or_known_default()
}

fn open_window(app: &tauri::AppHandle, launch: Url) -> tauri::Result<()> {
    let handle = app.clone();
    let origin = launch.clone();
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(launch))
        .title("Caramel")
        .inner_size(1200.0, 800.0)
        .min_inner_size(720.0, 480.0)
        .initialization_script(BRIDGE_SCRIPT)
        .on_navigation(move |target| {
            if same_origin(target, &origin) {
                return true;
            }
            if matches!(target.scheme(), "http" | "https") {
                let _ = handle.opener().open_url(target.as_str(), None::<&str>);
            }
            false
        })
        .build()?;
    Ok(())
}

fn fail(app: &tauri::AppHandle, message: String) {
    app.dialog()
        .message(message)
        .title("Caramel could not start")
        .kind(MessageDialogKind::Error)
        .blocking_show();
    app.exit(1);
}

fn start_backend(app: &tauri::AppHandle) -> Result<(), String> {
    let web_dist = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("web-dist");
    let (mut events, child) = app
        .shell()
        .sidecar("caramel-backend")
        .map_err(|error| error.to_string())?
        // --watch-stdin: if this shell dies without a clean exit, the closed pipe stops the backend.
        .args(["--no-open", "--watch-stdin"])
        .env("CARAMEL_WEB_DIST", web_dist.to_string_lossy().into_owned())
        .spawn()
        .map_err(|error| error.to_string())?;
    app.manage(Backend(Mutex::new(Some(child))));

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut ready = false;
        let mut errors = String::new();
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(line) if !ready => {
                    let line = String::from_utf8_lossy(&line);
                    let Some(json) = line.trim().strip_prefix(READY_PREFIX) else { continue };
                    let launch = serde_json::from_str::<Ready>(json)
                        .map_err(|error| error.to_string())
                        .and_then(|ready| Url::parse(&ready.url).map_err(|error| error.to_string()));
                    match launch {
                        Ok(url) => {
                            ready = true;
                            if let Err(error) = open_window(&app, url) {
                                fail(&app, format!("The window could not open: {error}"));
                            }
                        }
                        Err(error) => fail(&app, format!("The backend sent an unreadable ready line: {error}")),
                    }
                }
                // Keep the tail of stderr so a startup failure can say why.
                CommandEvent::Stderr(line) => {
                    errors.push_str(&String::from_utf8_lossy(&line));
                    if errors.len() > 2_000 {
                        errors.drain(..errors.len() - 2_000);
                    }
                }
                CommandEvent::Terminated(status) => {
                    let when = if ready { "stopped unexpectedly" } else { "exited before it was ready" };
                    fail(&app, format!("The Caramel backend {when} (exit code {:?}).\n\n{}", status.code, errors.trim()));
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(())
}

/// Stops the backend now rather than waiting for it to notice the closed pipe.
fn stop_backend(app: &tauri::AppHandle) {
    if let Some(backend) = app.try_state::<Backend>() {
        if let Some(child) = backend.0.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
}

/// Asks once per launch whether to install a newer release. Offline, up to date, or a failed
/// check all mean "try again next launch": a missing update must never stop the app opening.
/// The update's signature is checked against the public key in tauri.conf.json before installing.
fn check_for_update(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let Ok(updater) = app.updater() else { return };
        let Ok(Some(update)) = updater.check().await else { return };
        let message = format!(
            "Caramel {} is available (you have {}).\n\nInstalling restarts Caramel and stops any run in progress.",
            update.version, update.current_version
        );
        let handle = app.clone();
        app.dialog()
            .message(message)
            .title("Update available")
            .buttons(MessageDialogButtons::OkCancelCustom("Install and restart".into(), "Later".into()))
            .show(move |install| {
                if !install {
                    return;
                }
                tauri::async_runtime::spawn(async move {
                    match update.download_and_install(|_, _| {}, || {}).await {
                        Ok(()) => {
                            stop_backend(&handle);
                            handle.restart();
                        }
                        Err(error) => {
                            handle
                                .dialog()
                                .message(format!("The update could not be installed: {error}"))
                                .title("Update failed")
                                .kind(MessageDialogKind::Error)
                                .show(|_| {});
                        }
                    }
                });
            });
    });
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![pick_folder])
        .setup(|app| {
            if let Err(error) = start_backend(app.handle()) {
                fail(app.handle(), format!("The backend could not be started: {error}"));
            }
            // Dev builds are not released, so there is nothing to update them to.
            if !cfg!(debug_assertions) {
                check_for_update(app.handle().clone());
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build the Caramel app");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            stop_backend(app);
        }
    });
}
