//! Signed content-addressed Lab artifact client.

use std::io::Read as _;
use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ed25519_dalek::pkcs8::DecodePublicKey as _;
use ed25519_dalek::{Signature, Verifier as _, VerifyingKey};
use jit_artifact::ArtifactFile;
use rebyte_format::RelativeArtifactPath;
use reqwest::Url;
use reqwest::blocking::Client;
use serde::Deserialize;
use sha2::{Digest as _, Sha256};

use crate::CliError;

const REFERENCE_PREFIX: &str = "jlr1_";
const OFFICIAL_REGISTRY: &str = "https://jit-site.vercel.app";
const MAX_KEY_RESPONSE_BYTES: u64 = 16 * 1024;
const MAX_STORED_ARTIFACT_BYTES: u64 = 3 * 1024 * 1024;
const MAX_FILES: usize = 128;
const MAX_FILE_BYTES: usize = 512 * 1024;
const MAX_OUTPUT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug)]
pub(crate) struct RegistryArtifact {
    pub(crate) files: Vec<ArtifactFile>,
    pub(crate) output_root: String,
    pub(crate) hash: String,
    pub(crate) registry: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CompactReference {
    v: u8,
    h: String,
    o: String,
    r: String,
    k: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct KeyResponse {
    algorithm: String,
    key_id: String,
    public_key: String,
}

#[derive(Debug, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredArtifact {
    version: u8,
    output_root: String,
    files: Vec<StoredFile>,
}

#[derive(Debug, Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
struct StoredFile {
    path: String,
    source: String,
}

pub(crate) fn fetch(token: &str) -> Result<RegistryArtifact, CliError> {
    let (encoded_payload, encoded_signature) = split_reference(token)?;
    let payload_bytes = URL_SAFE_NO_PAD
        .decode(encoded_payload)
        .map_err(|_| CliError::integrity("artifact reference payload is not base64url"))?;
    let reference: CompactReference = serde_json::from_slice(&payload_bytes)
        .map_err(|error| CliError::integrity(format!("invalid artifact reference: {error}")))?;
    validate_reference(&reference)?;

    let trusted_registry = trusted_registry()?;
    if reference.r != trusted_registry {
        return Err(CliError::integrity(format!(
            "untrusted artifact registry {}; expected {}",
            reference.r, trusted_registry
        )));
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| CliError::io(format!("cannot create registry client: {error}")))?;
    let key_url = registry_url(&trusted_registry, &format!("/api/lab/keys/{}", reference.k))?;
    let key_bytes = get_bounded(&client, &key_url, MAX_KEY_RESPONSE_BYTES)?;
    let key: KeyResponse = serde_json::from_slice(&key_bytes)
        .map_err(|error| CliError::integrity(format!("invalid signing key response: {error}")))?;
    verify_signature(&reference, &key, encoded_payload, encoded_signature)?;

    let artifact_url = registry_url(
        &trusted_registry,
        &format!("/api/lab/artifacts/{}", reference.h),
    )?;
    let bytes = get_bounded(&client, &artifact_url, MAX_STORED_ARTIFACT_BYTES)?;
    let digest = URL_SAFE_NO_PAD.encode(Sha256::digest(&bytes));
    if digest != reference.h {
        return Err(CliError::integrity(
            "downloaded artifact hash does not match the signed reference",
        ));
    }

    let stored: StoredArtifact = serde_json::from_slice(&bytes)
        .map_err(|error| CliError::integrity(format!("invalid stored artifact: {error}")))?;
    validate_stored(&stored, &bytes, &reference)?;
    let files = stored
        .files
        .into_iter()
        .map(|file| ArtifactFile::new(file.path, file.source.into_bytes()))
        .collect();

    Ok(RegistryArtifact {
        files,
        output_root: stored.output_root,
        hash: reference.h,
        registry: trusted_registry,
    })
}

fn split_reference(token: &str) -> Result<(&str, &str), CliError> {
    let value = token.strip_prefix(REFERENCE_PREFIX).ok_or_else(|| {
        CliError::usage(format!(
            "artifact reference must start with {REFERENCE_PREFIX}"
        ))
    })?;
    let (payload, signature) = value
        .split_once('.')
        .ok_or_else(|| CliError::integrity("malformed artifact reference"))?;
    if payload.is_empty() || signature.is_empty() || signature.contains('.') {
        return Err(CliError::integrity("malformed artifact reference"));
    }
    Ok((payload, signature))
}

fn validate_reference(reference: &CompactReference) -> Result<(), CliError> {
    if reference.v != 1 {
        return Err(CliError::integrity(
            "unsupported artifact reference version",
        ));
    }
    if !is_base64url(&reference.h, 43) {
        return Err(CliError::integrity("artifact hash is invalid"));
    }
    if !is_base64url(&reference.k, 12) {
        return Err(CliError::integrity(
            "artifact signing key identifier is invalid",
        ));
    }
    RelativeArtifactPath::new(&reference.o)
        .map_err(|error| CliError::unsafe_path(format!("invalid output directory: {error}")))?;
    let url = Url::parse(&reference.r)
        .map_err(|_| CliError::integrity("artifact registry URL is invalid"))?;
    if url.as_str().trim_end_matches('/') != reference.r || url.path() != "/" {
        return Err(CliError::integrity(
            "artifact registry must be a bare origin",
        ));
    }
    Ok(())
}

pub(crate) fn trusted_registry() -> Result<String, CliError> {
    let configured =
        std::env::var("JIT_LAB_REGISTRY").unwrap_or_else(|_| OFFICIAL_REGISTRY.to_owned());
    let normalized = configured.trim_end_matches('/').to_owned();
    let url = Url::parse(&normalized)
        .map_err(|_| CliError::config("JIT_LAB_REGISTRY is not a valid URL"))?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if url.scheme() != "https" && !(local && url.scheme() == "http") {
        return Err(CliError::config(
            "JIT_LAB_REGISTRY must use HTTPS; HTTP is limited to localhost",
        ));
    }
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err(CliError::config("JIT_LAB_REGISTRY must be a bare origin"));
    }
    Ok(normalized)
}

fn registry_url(registry: &str, path: &str) -> Result<Url, CliError> {
    Url::parse(&format!("{registry}{path}"))
        .map_err(|_| CliError::integrity("cannot construct artifact registry URL"))
}

fn get_bounded(client: &Client, url: &Url, maximum: u64) -> Result<Vec<u8>, CliError> {
    let mut response = client
        .get(url.clone())
        .header("accept", "application/json")
        .send()
        .map_err(|error| CliError::io(format!("cannot fetch {url}: {error}")))?;
    if !response.status().is_success() {
        return Err(CliError::io(format!(
            "registry returned HTTP {} for {url}",
            response.status()
        )));
    }
    if response
        .content_length()
        .is_some_and(|length| length > maximum)
    {
        return Err(CliError::integrity(
            "registry response exceeds the configured limit",
        ));
    }
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take(maximum.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| CliError::io(format!("cannot read registry response: {error}")))?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > maximum {
        return Err(CliError::integrity(
            "registry response exceeds the configured limit",
        ));
    }
    Ok(bytes)
}

fn verify_signature(
    reference: &CompactReference,
    key: &KeyResponse,
    encoded_payload: &str,
    encoded_signature: &str,
) -> Result<(), CliError> {
    if key.algorithm != "Ed25519" || key.key_id != reference.k {
        return Err(CliError::integrity(
            "registry returned the wrong signing key",
        ));
    }
    let public_der = URL_SAFE_NO_PAD
        .decode(&key.public_key)
        .map_err(|_| CliError::integrity("registry signing key is not base64url"))?;
    let calculated_key_id = URL_SAFE_NO_PAD.encode(Sha256::digest(&public_der));
    if calculated_key_id.get(..12) != Some(reference.k.as_str()) {
        return Err(CliError::integrity(
            "registry signing key identifier does not match its bytes",
        ));
    }
    let verifying_key = VerifyingKey::from_public_key_der(&public_der)
        .map_err(|_| CliError::integrity("registry signing key is not a valid Ed25519 key"))?;
    let signature_bytes = URL_SAFE_NO_PAD
        .decode(encoded_signature)
        .map_err(|_| CliError::integrity("artifact signature is not base64url"))?;
    let signature = Signature::from_slice(&signature_bytes)
        .map_err(|_| CliError::integrity("artifact signature has an invalid length"))?;
    verifying_key
        .verify(encoded_payload.as_bytes(), &signature)
        .map_err(|_| CliError::integrity("artifact reference signature is invalid"))
}

fn validate_stored(
    artifact: &StoredArtifact,
    bytes: &[u8],
    reference: &CompactReference,
) -> Result<(), CliError> {
    if artifact.version != 1 || artifact.output_root != reference.o {
        return Err(CliError::integrity(
            "stored artifact metadata does not match its reference",
        ));
    }
    if artifact.files.is_empty() || artifact.files.len() > MAX_FILES {
        return Err(CliError::integrity(
            "stored artifact file count is outside the allowed range",
        ));
    }
    let mut previous: Option<&str> = None;
    let mut total = 0_usize;
    for file in &artifact.files {
        RelativeArtifactPath::new(&file.path)
            .map_err(|error| CliError::unsafe_path(format!("invalid artifact path: {error}")))?;
        if previous.is_some_and(|path| path >= file.path.as_str()) {
            return Err(CliError::integrity(
                "stored artifact paths are not unique and sorted",
            ));
        }
        previous = Some(&file.path);
        let length = file.source.len();
        if length > MAX_FILE_BYTES {
            return Err(CliError::integrity(
                "stored artifact file exceeds the allowed limit",
            ));
        }
        total = total
            .checked_add(length)
            .ok_or_else(|| CliError::integrity("stored artifact size overflow"))?;
    }
    if total > MAX_OUTPUT_BYTES {
        return Err(CliError::integrity(
            "stored artifact output exceeds the allowed limit",
        ));
    }
    let canonical = serde_json::to_vec(artifact).map_err(|error| {
        CliError::integrity(format!("cannot canonicalize stored artifact: {error}"))
    })?;
    if canonical != bytes {
        return Err(CliError::integrity("stored artifact is not canonical"));
    }
    Ok(())
}

fn is_base64url(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}
