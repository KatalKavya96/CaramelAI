fn main() {
    // Declaring the app's own commands makes Tauri generate an `allow-pick-folder` permission,
    // so the capability file decides which pages may call it instead of every page by default.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["pick_folder"])),
    )
    .expect("failed to run tauri-build");
}
