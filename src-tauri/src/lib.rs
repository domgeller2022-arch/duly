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

/// Field names are camelCase on the wire, matching the TypeScript side.
/// Tauri's camelCase handling covers command *parameters*, not nested
/// struct fields — without this, every send failed with a serde
/// "missing field" error.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendArgs {
    host: String,
    port: u16,
    /// Implicit TLS (port 465). Proton Mail Bridge uses STARTTLS instead.
    secure: bool,
    starttls: bool,
    username: String,
    /// The keychain entry the password lives under. Resolved here, in
    /// Rust: the password never crosses into the webview.
    secret_key: String,
    /// Only the settings screen's test connection sets this, with the
    /// password the user just typed before it was stored.
    #[serde(default)]
    password: Option<String>,
    from_name: String,
    from_email: String,
    reply_to: Option<String>,
    to: Vec<String>,
    cc: Option<Vec<String>>,
    bcc: Option<Vec<String>>,
    subject: String,
    body: String,
    /// (fileName, base64) pairs — lettre takes bytes.
    attachments: Vec<AttachmentArg>,
    /// A pinned fingerprint means the user explicitly trusted this
    /// server's certificate (a local Bridge presents its own). Without
    /// one, normal TLS verification applies — invalid certificates are
    /// only ever accepted against a configured trust.
    pinned_fingerprint: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
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
///
/// Async and moved to the blocking pool: an SMTP conversation can run for
/// seconds, and a synchronous command would freeze the interface for all of
/// it.
#[tauri::command]
async fn send_smtp(args: SendArgs) -> SendResult {
    tauri::async_runtime::spawn_blocking(move || send_smtp_blocking(args))
        .await
        .unwrap_or(SendResult {
            ok: false,
            error: Some("The send task itself failed.".into()),
        })
}

fn send_smtp_blocking(args: SendArgs) -> SendResult {
    // The password is resolved from the OS keychain here, in Rust — it never
    // crosses into the webview on a real send. The one exception is the
    // settings screen's test connection, which carries the password the
    // user has just typed.
    let password = match args.password.clone() {
        Some(typed) => typed,
        None => match keychain_get(args.secret_key.clone()) {
            Ok(Some(secret)) => secret,
            Ok(None) => {
                return SendResult {
                    ok: false,
                    error: Some("No password is saved for this account. Add it in Settings → Email accounts.".into()),
                }
            }
            Err(error) => return SendResult { ok: false, error: Some(error) },
        },
    };

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

    // A malformed From is an error, not a panic — an unwrap here took the
    // whole app down over a typo.
    let from: Mailbox = match format!("{} <{}>", args.from_name, args.from_email).parse() {
        Ok(mailbox) => mailbox,
        Err(_) => match args.from_email.parse() {
            Ok(mailbox) => mailbox,
            Err(_) => {
                return SendResult {
                    ok: false,
                    error: Some("The From address is not a valid email address.".into()),
                }
            }
        },
    };

    let transport = match smtp_transport(&args, &password) {
        Ok(transport) => transport,
        Err(error) => return SendResult { ok: false, error: Some(error) },
    };

    let mut message = Message::builder().from(from).to(mailboxes[0].clone());
    // Extra To recipients are To; CC and BCC are what the caller said they
    // were, not quietly demoted.
    for extra in &mailboxes[1..] {
        message = message.to(extra.clone());
    }
    if let Some(cc) = &args.cc {
        for address in cc {
            if let Ok(mailbox) = address.parse::<Mailbox>() {
                message = message.cc(mailbox);
            }
        }
    }
    if let Some(bcc) = &args.bcc {
        for address in bcc {
            if let Ok(mailbox) = address.parse::<Mailbox>() {
                message = message.bcc(mailbox);
            }
        }
    }
    if let Some(reply_to) = &args.reply_to {
        if let Ok(mailbox) = reply_to.parse::<Mailbox>() {
            message = message.reply_to(mailbox);
        }
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

/// The transport for one send: implicit TLS, STARTTLS, or plain.
///
/// Invalid certificates are accepted only when the account carries a pinned
/// fingerprint — the user explicitly trusting this server's certificate —
/// never as a blanket rule for a provider or a test send.
/// ponytail: a true byte-level fingerprint comparison needs a custom rustls
/// verifier; accept-invalid-certs-gated-on-explicit-trust is the ceiling
/// until one is wired in.
fn smtp_transport(args: &SendArgs, password: &str) -> Result<SmtpTransport, String> {
    let wants_tls = args.secure || args.starttls;
    let trusted = args
        .pinned_fingerprint
        .as_deref()
        .map(|f| !f.trim().is_empty())
        .unwrap_or(false);

    let mut builder = if trusted && wants_tls {
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
        builder = builder.credentials(Credentials::new(args.username.clone(), password.to_string()));
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init());

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

                // Closing the window hides it rather than quitting: the tray
                // is what keeps schedules and reminders firing, so the plan's
                // "runs while the window is closed" is actually true now.
                if let Some(window) = app.get_webview_window("main") {
                    let handle = window.clone();
                    window.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            let _ = handle.hide();
                            api.prevent_close();
                        }
                    });
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
