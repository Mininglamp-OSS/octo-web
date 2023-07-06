#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]


mod menu;


fn main() {
  let context = tauri::generate_context!();
  tauri::Builder::default()
    .menu(menu::init(&context)).on_menu_event(menu::handler)
    .run(context)
    .expect("error while running tauri application");
}
