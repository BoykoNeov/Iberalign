//! Tauri application entry: builds the app, registers managed state, and wires
//! the command handlers. Compute lives in `align-core`; this file is the seam.

mod commands;
mod state;

use state::AppState;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(Mutex::new(AppState::default()))
        .invoke_handler(tauri::generate_handler![
            commands::parse_summary,
            commands::load_alignment,
            commands::get_alignment_meta,
            commands::get_render_buffer,
            commands::clear_cells,
            commands::cut_shorten,
            commands::paste_overwrite,
            commands::paste_insert,
            commands::paste_sequences,
            commands::delete_rows,
            commands::delete_columns,
            commands::pairwise_align,
            commands::msa_align,
            commands::undo_edit,
            commands::redo_edit
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
