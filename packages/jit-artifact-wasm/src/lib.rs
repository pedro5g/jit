//! Browser-safe JIT token packing and inspection.
//!
//! This module exposes no filesystem, command, network, private-key or trust
//! store API. Browser tokens are integrity-checked but publisher-unauthenticated.

#![forbid(unsafe_code)]

use jit_artifact::{ArtifactFile, Compression, PackOptions, Profile, decode, pack};
use serde::Deserialize;
use wasm_bindgen::prelude::*;

/// Packs exact generated files into an unsigned `jit1_` token.
///
/// `files` is an array of `{ path, source }`. Browser output intentionally uses
/// verbatim storage: server/native tooling can repack with Zstandard when token
/// size matters.
///
/// # Errors
///
/// Returns a JavaScript string error for malformed inputs, unsafe paths,
/// resource-limit violations or failed self-verification.
#[wasm_bindgen]
pub fn pack_typescript(files: JsValue, output_root: String) -> Result<JsValue, JsValue> {
    let files: Vec<FileInput> = serde_wasm_bindgen::from_value(files).map_err(js_error)?;
    let files = files
        .into_iter()
        .map(|file| ArtifactFile::new(file.path, file.source.into_bytes()))
        .collect::<Vec<_>>();
    let options = PackOptions {
        suggested_path: Some(output_root),
        compression: Compression::None,
        profile: Profile::Fast,
        dictionary: false,
    };
    let (token, report) = pack(&files, &options).map_err(js_error)?;

    serde_wasm_bindgen::to_value(&PackOutput { token, report }).map_err(js_error)
}

/// Fully verifies and returns bounded metadata for an unsigned token.
///
/// # Errors
///
/// Returns a JavaScript string error for non-canonical text, decompression,
/// limit or digest failures.
#[wasm_bindgen]
pub fn inspect_token(token: &str) -> Result<JsValue, JsValue> {
    let verified = decode(token).map_err(js_error)?;
    serde_wasm_bindgen::to_value(&verified.report()).map_err(js_error)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FileInput {
    path: String,
    source: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PackOutput {
    token: String,
    report: jit_artifact::ArtifactReport,
}

fn js_error(error: impl core::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}
