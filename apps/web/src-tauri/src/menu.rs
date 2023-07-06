extern crate rand;

use tauri::utils::assets::EmbeddedAssets;
use tauri::{Manager, Context,Wry, CustomMenuItem, Menu , Submenu, WindowMenuEvent};


use rand::Rng;

pub fn init(_context: &Context<EmbeddedAssets>) -> Menu {
    // 应用名称
    // let name = &context.package_info().name;
    // tauri::Menu::os_default(name)
   
    let menu = Submenu::new(
        "菜单",
        Menu::new()
            .add_item(CustomMenuItem::new("new_windows".to_string(), "多开"))
    );
    Menu::new()
        .add_submenu(menu)
}

// 应用菜单处理事件
pub fn handler(event: WindowMenuEvent<Wry>) {
    // 匹配菜单 id
    match event.menu_item_id() {
        "new_windows" => {
           let apphandle = event.window().app_handle();
            let mut rng = rand::thread_rng();
            let n2: u32 = rng.gen();

            std::thread::spawn(move || {
               let _newwin = tauri::WindowBuilder::new(
                    &apphandle,
                    n2.to_string(),
                    tauri::WindowUrl::App("/".into())
                ).title("唐僧叨叨").inner_size(1200.0,800.0).build();
            });
           
        }
        _ => {}
    }
}