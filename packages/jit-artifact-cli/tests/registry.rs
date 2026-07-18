use std::fs;
use std::io::{Read as _, Write as _};
use std::net::TcpListener;
use std::thread;

use assert_cmd::Command;
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ed25519_dalek::pkcs8::EncodePublicKey as _;
use ed25519_dalek::{Signer as _, SigningKey};
use predicates::prelude::*;
use serde_json::json;
use sha2::{Digest as _, Sha256};
use tempfile::tempdir;

#[test]
fn adds_an_authenticated_content_addressed_lab_artifact() -> Result<(), Box<dyn std::error::Error>>
{
    let workspace = tempdir()?;
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let registry = format!("http://{}", listener.local_addr()?);
    let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
    let public_key = signing_key.verifying_key().to_public_key_der()?;
    let public_key = public_key.as_bytes();
    let key_digest = URL_SAFE_NO_PAD.encode(Sha256::digest(public_key));
    let key_id = &key_digest[..12];

    let artifact = concat!(
        "{\"version\":1,\"outputRoot\":\"src/generated/jit\",\"files\":[",
        "{\"path\":\"user.generated.ts\",\"source\":\"export type User = { id: number };\\n\"}",
        "]}"
    );
    let hash = URL_SAFE_NO_PAD.encode(Sha256::digest(artifact.as_bytes()));
    let payload = serde_json::to_vec(&json!({
        "v": 1,
        "h": hash,
        "o": "src/generated/jit",
        "r": registry,
        "k": key_id,
    }))?;
    let encoded_payload = URL_SAFE_NO_PAD.encode(payload);
    let signature = signing_key.sign(encoded_payload.as_bytes());
    let token = format!(
        "jlr1_{encoded_payload}.{}",
        URL_SAFE_NO_PAD.encode(signature.to_bytes())
    );
    let key_response = serde_json::to_vec(&json!({
        "algorithm": "Ed25519",
        "keyId": key_id,
        "publicKey": URL_SAFE_NO_PAD.encode(public_key),
    }))?;
    let artifact_response = artifact.as_bytes().to_vec();

    let server = thread::spawn(move || -> std::io::Result<()> {
        serve_once(&listener, &key_response)?;
        serve_once(&listener, &artifact_response)
    });

    Command::cargo_bin("jit-artifact")?
        .env("JIT_LAB_REGISTRY", &registry)
        .args([
            "add",
            &token,
            "--root",
            workspace.path().to_string_lossy().as_ref(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("authenticated"))
        .stdout(predicate::str::contains("added 1 file(s)"));

    server.join().map_err(|_| "registry server panicked")??;
    assert_eq!(
        fs::read_to_string(workspace.path().join("src/generated/jit/user.generated.ts"))?,
        "export type User = { id: number };\n"
    );
    Ok(())
}

fn serve_once(listener: &TcpListener, body: &[u8]) -> std::io::Result<()> {
    let (mut stream, _) = listener.accept()?;
    let mut request = [0_u8; 4096];
    let _ = stream.read(&mut request)?;
    write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )?;
    stream.write_all(body)
}
