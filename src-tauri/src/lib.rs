//! Duly desktop: the Rust half of the Tauri app.
//!
//! Three jobs, the plan's item 2: SQLite through tauri-plugin-sql (the web
//! JSON export imports into it), the native file system through
//! tauri-plugin-fs, and the two things the web build cannot do at all —
//! sending SMTP through lettre and holding email credentials in the OS
//! keychain.
//!
//! The commands are thin: they validate, then delegate to the crates. The
//! frontend feature-detects this whole half via `window.__TAURI__` and falls
//! back to IndexedDB, downloads and mailto: when it is absent.

use lettre::message::header::ContentType;
use lettre::message::{Attachment, Mailbox, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::client::{Tls, TlsParameters};
use lettre::{Message, SmtpTransport, Transport};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
struct SendArgs {
    host: String,
    port: u16,
    /// Implicit TLS (port 465). Proton Mail Bridge uses STARTTLS instead.
    secure: bool,
    starttls: bool,
    username: String,
    /// Resolved from the keychain by the caller, never stored here.
    password: String,
    from_name: String,
    from_email: String,
    to: Vec<String>,
    subject: String,
    body: String,
    /// (fileName, base64) pairs — lettre takes bytes.
    attachments: Vec<AttachmentArg>,
    /// Proton Mail Bridge presents its own certificate; trusting it is the
    /// plan's "trusted Bridge certificate".
    accept_invalid_certs: bool,
}

#[derive(Debug, Deserialize)]
struct AttachmentArg {
    file_name: String,
    /// base64-encoded.
    data: String,
    mime_type: String,
}

#[derive(Debug, Serialize)]
struct SendResult {
    ok: bool,
    error: Option<String>,
}

/// Send one message through SMTP. Nothing is stored; the outbox lives in the
/// database and the caller marks entries sent or failed.
#[tauri::command]
fn send_smtp(args: SendArgs) -> SendResult {
    // Recipients first: a bad address fails before a connection is made.
    let mut mailboxes = Vec::new();
    for address in &args.to {
        match address.parse::<Mailbox>() {
            Ok(mailbox) => mailboxes.push(mailbox),
            Err(_) => {
                return SendResult {
                    ok: false,
                    error: Some(format!("\"{}\" is not a valid email address.", address)),
                }
            }
        }
    }
    if mailboxes.is_empty() {
        return SendResult {
            ok: false,
            error: Some("Add at least one recipient.".into()),
        };
    }

    let from: Mailbox = format!("{} <{}>", args.from_name, args.from_email)
        .parse()
        .unwrap_or_else(|_| args.from_email.parse().unwrap());

    let transport = match smtp_transport(&args) {
        Ok(transport) => transport,
        Err(error) => return SendResult { ok: false, error: Some(error) },
    };

    let mut message = Message::builder().from(from).to(mailboxes[0].clone());
    for extra in &mailboxes[1..] {
        message = message.cc(extra.clone());
    }
    let message = message.subject(args.subject.clone());

    let mut multipart =
        MultiPart::mixed().singlepart(SinglePart::builder().header(ContentType::TEXT_PLAIN).body(args.body.clone()));
    for attachment in &args.attachments {
        let Some(decoded) = base64_decode(&attachment.data) else {
            continue;
        };
        let content_type = attachment
            .mime_type
            .parse()
            .unwrap_or(ContentType::TEXT_PLAIN);
        multipart =
            multipart.singlepart(Attachment::new(attachment.file_name.clone()).body(decoded, content_type));
    }

    let email = match message.multipart(multipart) {
        Ok(email) => email,
        Err(error) => {
            return SendResult {
                ok: false,
                error: Some(format!("The message could not be built: {}", error)),
            }
        }
    };

    match transport.send(&email) {
        Ok(_) => SendResult { ok: true, error: None },
        Err(error) => SendResult {
            ok: false,
            error: Some(format!("The message could not be sent: {}", error)),
        },
    }
}

/// The transport for one send: implicit TLS, STARTTLS, or plain — with the
/// Bridge's own certificate accepted when the account says so.
fn smtp_transport(args: &SendArgs) -> Result<SmtpTransport, String> {
    let wants_tls = args.secure || args.starttls;

    let mut builder = if args.accept_invalid_certs && wants_tls {
        let mut tls_builder = TlsParameters::builder(args.host.clone());
        tls_builder = tls_builder.dangerous_accept_invalid_certs(true);
        let params = tls_builder
            .build()
            .map_err(|error| format!("TLS could not be set up: {}", error))?;
        let tls = if args.secure { Tls::Wrapper(params) } else { Tls::Required(params) };
        SmtpTransport::builder_dangerous(&args.host).tls(tls)
    } else if args.secure {
        SmtpTransport::relay(&args.host).map_err(|error| format!("Could not reach {}: {}", args.host, error))?
    } else if args.starttls {
        SmtpTransport::starttls_relay(&args.host)
            .map_err(|error| format!("Could not reach {}: {}", args.host, error))?
    } else {
        SmtpTransport::builder_dangerous(&args.host)
    };

    builder = builder.port(args.port);
    if !args.username.is_empty() {
        builder = builder.credentials(Credentials::new(args.username.clone(), args.password.clone()));
    }
    Ok(builder.build())
}

/// Minimal base64 decoder — attachments arrive base64 from the webview.
fn base64_decode(input: &str) -> Option<Vec<u8>> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let input: Vec<u8> = input.bytes().filter(|b| !b.is_ascii_whitespace() && *b != b'=').collect();
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    for chunk in input.chunks(4) {
        let mut value: u32 = 0;
        for (i, byte) in chunk.iter().enumerate() {
            let index = TABLE.iter().position(|t| t == byte)?;
            value |= (index as u32) << (18 - 6 * i);
        }
        out.push((value >> 16) as u8);
        if chunk.len() > 2 {
            out.push((value >> 8) as u8);
        }
        if chunk.len() > 3 {
            out.push(value as u8);
        }
    }
    Some(out)
}

/* ------------------------------------------------------------------ */
/* Keychain — email credentials never live in the database.            */
/* ------------------------------------------------------------------ */

const SERVICE: &str = "com.duly.app";

/// Reveal a written file in the OS file manager — "open containing folder".
#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|error| error.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|error| error.to_string())?;
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = path;
        Err("Revealing a folder is only supported on macOS and Windows.".into())
    }
}

#[tauri::command]
fn keychain_set(account: String, secret: String) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, &account).map_err(|e| e.to_string())?;
    entry.set_password(&secret).map_err(|e| e.to_string())
}

#[tauri::command]
fn keychain_get(account: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(SERVICE, &account).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn keychain_delete(account: String) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, &account).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    // Autostart is a desktop login item; Android has no equivalent.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_autostart::init(
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        None,
    ));

    builder
        .invoke_handler(tauri::generate_handler![
            send_smtp,
            keychain_set,
            keychain_get,
            keychain_delete,
            reveal_in_folder
        ])
        .setup(|app| {
            // Android has no tray; the param is only used by the desktop block.
            #[cfg(not(desktop))]
            let _ = app;
            // The tray keeps schedules and reminders firing while the window is
            // closed; the plan's item 5.
            #[cfg(desktop)]
            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::TrayIconBuilder;
                use tauri::Manager;
                let open = MenuItem::with_id(app, "open", "Open Duly", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&open, &quit])?;
                TrayIconBuilder::with_id("duly-tray")
                    .icon(app.default_window_icon().unwrap().clone())
                    .menu(&menu)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "open" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .build(app)?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
