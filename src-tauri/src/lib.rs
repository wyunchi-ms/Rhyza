use serde::Serialize;
use std::{
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::Manager;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarEndpoint {
    base_url: String,
    token: String,
}

struct SidecarState {
    endpoint: SidecarEndpoint,
    child: Mutex<Child>,
}

#[tauri::command]
fn sidecar_endpoint(state: tauri::State<'_, SidecarState>) -> SidecarEndpoint {
    state.endpoint.clone()
}

#[tauri::command]
fn choose_workspace() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn choose_sources() -> Vec<String> {
    rfd::FileDialog::new()
        .pick_folders()
        .into_iter()
        .flatten()
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

fn resolve_sidecar() -> Result<(PathBuf, PathBuf, PathBuf), String> {
    if let Ok(executable) = std::env::current_exe() {
        if let Some(executable_dir) = executable.parent() {
            let resources = executable_dir.join("resources");
            let entrypoint = resources.join("sidecar").join("index.js");
            let node = resources.join(if cfg!(windows) { "node.exe" } else { "node" });
            if entrypoint.is_file() && node.is_file() {
                return Ok((entrypoint, node, resources));
            }
        }
    }

    let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or("Missing project root")?
        .to_path_buf();
    let entrypoint = project_root
        .join("dist-sidecar")
        .join("sidecar")
        .join("index.js");
    if !entrypoint.is_file() {
        return Err(format!(
            "Node sidecar was not found at {}. Run `npm run sidecar:compile`.",
            entrypoint.display()
        ));
    }
    let node =
        PathBuf::from(std::env::var("RHYZA_NODE_BINARY").unwrap_or_else(|_| "node".to_string()));
    Ok((entrypoint, node, project_root))
}

fn start_sidecar() -> Result<SidecarState, String> {
    let (entrypoint, node, working_directory) = resolve_sidecar()?;
    let mut child = Command::new(node)
        .arg(entrypoint)
        .current_dir(working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| format!("Unable to start Node sidecar: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Node sidecar did not expose stdout")?;
    let mut handshake = String::new();
    BufReader::new(stdout)
        .read_line(&mut handshake)
        .map_err(|error| error.to_string())?;
    let value: serde_json::Value = serde_json::from_str(handshake.trim())
        .map_err(|error| format!("Invalid sidecar handshake: {error}"))?;
    let port = value
        .get("port")
        .and_then(|value| value.as_u64())
        .ok_or("Sidecar handshake omitted port")?;
    let token = value
        .get("token")
        .and_then(|value| value.as_str())
        .ok_or("Sidecar handshake omitted token")?
        .to_string();
    Ok(SidecarState {
        endpoint: SidecarEndpoint {
            base_url: format!("http://127.0.0.1:{port}"),
            token,
        },
        child: Mutex::new(child),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let sidecar = start_sidecar().expect("Node sidecar failed to start");
    tauri::Builder::default()
        .manage(sidecar)
        .invoke_handler(tauri::generate_handler![
            sidecar_endpoint,
            choose_workspace,
            choose_sources
        ])
        .build(tauri::generate_context!())
        .expect("error while building Rhyza")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                if let Some(state) = app.try_state::<SidecarState>() {
                    if let Ok(mut child) = state.child.lock() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        });
}
