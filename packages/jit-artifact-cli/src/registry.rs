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

/// Where the published Lab signs from.
const PRODUCTION_REGISTRY: &str = "https://jit-site.vercel.app";
/// Where it signs from while it is being developed.
const LOCAL_REGISTRY: &str = "http://localhost:3000";

/// The two places a reference can legitimately come from.
///
/// A token carries the origin that signed it, and the CLI refuses a token from
/// anywhere it does not trust. That check is right and it is also the thing
/// that makes a locally generated token unusable against a production default,
/// so which origin is trusted has to be a decision the caller can state rather
/// than a constant compiled into the binary.
#[derive(Clone, Copy, Debug, Eq, PartialEq, clap::ValueEnum)]
pub(crate) enum Environment {
    /// The published Lab.
    Production,
    /// A Lab running on this machine.
    Local,
}

impl Environment {
    const fn origin(self) -> &'static str {
        match self {
            Self::Production => PRODUCTION_REGISTRY,
            Self::Local => LOCAL_REGISTRY,
        }
    }

    fn parse(value: &str) -> Result<Self, CliError> {
        match value.trim().to_ascii_lowercase().as_str() {
            "production" | "prod" => Ok(Self::Production),
            "local" | "development" | "dev" => Ok(Self::Local),
            other => Err(CliError::config(format!(
                "unknown environment {other:?}; expected production or local"
            ))),
        }
    }

    /// The environment an origin belongs to, when it is one of the known two.
    fn of(origin: &str) -> Option<Self> {
        [Self::Production, Self::Local]
            .into_iter()
            .find(|environment| environment.origin() == origin)
    }
}

/// The registry in effect, and what decided it.
#[derive(Clone, Debug)]
pub(crate) struct Registry {
    pub(crate) origin: String,
    pub(crate) source: &'static str,
}
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

pub(crate) fn fetch(token: &str, registry: &Registry) -> Result<RegistryArtifact, CliError> {
    let (encoded_payload, encoded_signature) = split_reference(token)?;
    let payload_bytes = URL_SAFE_NO_PAD
        .decode(encoded_payload)
        .map_err(|_| CliError::integrity("artifact reference payload is not base64url"))?;
    let reference: CompactReference = serde_json::from_slice(&payload_bytes)
        .map_err(|error| CliError::integrity(format!("invalid artifact reference: {error}")))?;
    validate_reference(&reference)?;

    let trusted_registry = registry.origin.clone();
    if reference.r != trusted_registry {
        // The commonest mismatch by far is an environment mismatch, and it has
        // an exact fix, so the error says it rather than leaving the reader to
        // work out that the token came from the Lab they are running locally.
        let hint = Environment::of(&reference.r).map_or_else(
            || " Pass --registry with the origin that signed it.".to_owned(),
            |environment| {
                format!(
                    " That token was signed by the {} Lab; re-run with --env {}.",
                    match environment {
                        Environment::Production => "published",
                        Environment::Local => "local",
                    },
                    match environment {
                        Environment::Production => "production",
                        Environment::Local => "local",
                    }
                )
            },
        );

        return Err(CliError::integrity(format!(
            "untrusted artifact registry {}; this run trusts {trusted_registry} (from {}).{hint}",
            reference.r, registry.source
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

/// Which registry this invocation trusts, in one documented order.
///
/// An explicit flag beats a named environment, a named environment beats the
/// environment variables, and production is what a machine that says nothing
/// gets. Every step is reported, because "untrusted registry" is impossible to
/// act on without knowing which one the CLI decided to trust and why.
pub(crate) fn resolve(
    explicit: Option<&str>,
    environment: Option<Environment>,
) -> Result<Registry, CliError> {
    if let Some(origin) = explicit {
        return normalize(origin, "--registry");
    }
    if let Some(environment) = environment {
        return normalize(environment.origin(), "--env");
    }
    if let Ok(origin) = std::env::var("JIT_LAB_REGISTRY") {
        return normalize(&origin, "JIT_LAB_REGISTRY");
    }
    if let Ok(value) = std::env::var("JIT_LAB_ENV") {
        return normalize(Environment::parse(&value)?.origin(), "JIT_LAB_ENV");
    }

    normalize(PRODUCTION_REGISTRY, "default")
}

fn normalize(origin: &str, source: &'static str) -> Result<Registry, CliError> {
    let normalized = origin.trim().trim_end_matches('/').to_owned();
    let url = Url::parse(&normalized)
        .map_err(|_| CliError::config(format!("{source} is not a valid URL: {normalized}")))?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if url.scheme() != "https" && !(local && url.scheme() == "http") {
        return Err(CliError::config(format!(
            "{source} must use HTTPS; HTTP is limited to localhost"
        )));
    }
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err(CliError::config(format!(
            "{source} must be a bare origin, with no path"
        )));
    }

    Ok(Registry {
        origin: normalized,
        source,
    })
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
