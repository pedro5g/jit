//! Browser-safe, filesystem-free JIT artifact protocol.
//!
//! Version 1 wraps Rebyte's canonical unsigned artifact envelope with a
//! JIT-specific text prefix. The envelope reconstructs exact bytes, validates
//! portable paths, bounds decompression and verifies BLAKE3 digests.

#![forbid(unsafe_code)]

use rebyte_artifact_token::{
    Artifact, ArtifactCompression, ArtifactDictionary, ArtifactEntry, ArtifactEntryKind,
    ArtifactKind, ArtifactOptions, CompressionProfile, DecodedArtifact, encode_artifact,
};
use rebyte_format::{CompressionAlgorithm, RelativeArtifactPath, SecurityLimits};
use serde::Serialize;
use thiserror::Error;

/// Text prefix for a byte-exact JIT artifact token.
pub const TOKEN_PREFIX: &str = "jit1_";
const REBYTE_PREFIX: &str = "ra1_";

/// One exact file included in a generated artifact.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArtifactFile {
    /// Portable relative destination below the artifact root.
    pub path: String,
    /// Exact source bytes.
    pub bytes: Vec<u8>,
    /// Whether Unix executable bits should be retained.
    pub executable: bool,
}

impl ArtifactFile {
    /// Creates a non-executable file.
    #[must_use]
    pub fn new(path: impl Into<String>, bytes: impl Into<Vec<u8>>) -> Self {
        Self {
            path: path.into(),
            bytes: bytes.into(),
            executable: false,
        }
    }

    /// Marks this file executable.
    #[must_use]
    pub const fn executable(mut self, value: bool) -> Self {
        self.executable = value;
        self
    }
}

/// Compression policy exposed by the JIT protocol.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum Compression {
    /// Keep Zstandard only when the complete envelope is smaller.
    #[default]
    Auto,
    /// Always use Zstandard.
    Zstd,
    /// Store bytes verbatim.
    None,
}

/// Encoder effort exposed by the JIT protocol.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum Profile {
    /// Favor encoding latency.
    Fast,
    /// Balance token size and encoding latency.
    #[default]
    Balanced,
    /// Favor token size.
    Maximum,
}

/// Configuration for one deterministic token.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PackOptions {
    /// Optional relative directory suggested to the native CLI.
    pub suggested_path: Option<String>,
    /// Compression selection policy.
    pub compression: Compression,
    /// Compression effort.
    pub profile: Profile,
    /// Train an embedded dictionary when it reduces the complete envelope.
    pub dictionary: bool,
}

impl Default for PackOptions {
    fn default() -> Self {
        Self {
            suggested_path: None,
            compression: Compression::Auto,
            profile: Profile::Balanced,
            dictionary: true,
        }
    }
}

/// Stable metadata returned after packing or verification.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactReport {
    /// Report schema version.
    pub schema_version: u16,
    /// Token protocol version.
    pub protocol_version: u16,
    /// Whether a publisher identity was authenticated.
    pub authenticated: bool,
    /// Canonical content digest in lowercase hex.
    pub content_digest: String,
    /// Complete envelope digest in lowercase hex.
    pub envelope_digest: String,
    /// Compression selected by the encoder.
    pub compression: &'static str,
    /// Number of entries.
    pub entries: usize,
    /// Reconstructed file bytes.
    pub original_bytes: u64,
    /// Compressed or verbatim payload bytes.
    pub stored_bytes: u64,
    /// Embedded dictionary bytes.
    pub dictionary_bytes: u32,
    /// Untrusted relative destination suggestion.
    pub suggested_path: Option<String>,
    /// Verified files in canonical path order.
    pub files: Vec<ArtifactFileReport>,
}

/// Stable metadata for one verified file.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactFileReport {
    /// Portable relative path.
    pub path: String,
    /// Exact byte length.
    pub bytes: u64,
    /// Portable executable flag.
    pub executable: bool,
}

/// A fully decoded and digest-verified token.
#[derive(Clone, Debug)]
pub struct VerifiedArtifact {
    decoded: DecodedArtifact,
}

impl VerifiedArtifact {
    /// Returns verified protocol metadata.
    #[must_use]
    pub fn report(&self) -> ArtifactReport {
        report(&self.decoded)
    }

    /// Returns the verified artifact entries.
    #[must_use]
    pub fn entries(&self) -> &[ArtifactEntry] {
        self.decoded.artifact().entries()
    }

    /// Returns the untrusted destination suggestion after portable-path validation.
    #[must_use]
    pub fn suggested_path(&self) -> Option<&RelativeArtifactPath> {
        self.decoded.artifact().suggested_path()
    }

    /// Returns whether the token represents one file or a directory tree.
    #[must_use]
    pub const fn kind(&self) -> ArtifactKind {
        self.decoded.artifact().kind()
    }

    /// Returns the verified envelope digest.
    #[must_use]
    pub fn envelope_digest_hex(&self) -> String {
        hex::encode(self.decoded.envelope_digest().as_bytes())
    }
}

/// Protocol failures.
#[derive(Debug, Error)]
pub enum ArtifactError {
    /// No file was supplied.
    #[error("an artifact must contain at least one file")]
    Empty,
    /// A path or canonical envelope failed validation.
    #[error("{0}")]
    Format(String),
    /// The token has another protocol prefix.
    #[error("expected a {TOKEN_PREFIX} token")]
    InvalidPrefix,
}

/// Packs exact generated files into a deterministic URL-safe token.
///
/// # Errors
///
/// Returns an error for empty input, unsafe or duplicate paths, resource-limit
/// violations, compression failures or failed encoder self-verification.
pub fn pack(
    files: &[ArtifactFile],
    options: &PackOptions,
) -> Result<(String, ArtifactReport), ArtifactError> {
    if files.is_empty() {
        return Err(ArtifactError::Empty);
    }

    let entries = files
        .iter()
        .map(|file| {
            RelativeArtifactPath::new(&file.path)
                .map(|path| ArtifactEntry::file(path, file.bytes.clone(), file.executable))
                .map_err(format_error)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut artifact = Artifact::directory(entries);

    if let Some(path) = &options.suggested_path {
        artifact =
            artifact.with_suggested_path(RelativeArtifactPath::new(path).map_err(format_error)?);
    }

    let encode_options = ArtifactOptions::default()
        .with_compression(match options.compression {
            Compression::Auto => ArtifactCompression::Auto,
            Compression::Zstd => ArtifactCompression::Zstd,
            Compression::None => ArtifactCompression::None,
        })
        .with_profile(match options.profile {
            Profile::Fast => CompressionProfile::Fast,
            Profile::Balanced => CompressionProfile::Balanced,
            Profile::Maximum => CompressionProfile::Maximum,
        })
        .with_dictionary(if options.dictionary {
            ArtifactDictionary::Auto
        } else {
            ArtifactDictionary::None
        })
        .with_limits(SecurityLimits::SIMPLE_ARTIFACT);
    let encoded = encode_artifact(&artifact, &encode_options).map_err(format_error)?;
    let rebyte_token = encoded
        .to_token(&SecurityLimits::SIMPLE_ARTIFACT)
        .map_err(format_error)?;
    let token = format!(
        "{TOKEN_PREFIX}{}",
        rebyte_token.strip_prefix(REBYTE_PREFIX).unwrap_or_default()
    );
    let decoded = decode(&token)?;

    Ok((token, decoded.report()))
}

/// Decodes, bounds, decompresses and verifies a JIT token.
///
/// # Errors
///
/// Returns an error before exposing file bytes when any canonicalization,
/// size, decompression or digest check fails.
pub fn decode(token: &str) -> Result<VerifiedArtifact, ArtifactError> {
    let payload = token
        .strip_prefix(TOKEN_PREFIX)
        .ok_or(ArtifactError::InvalidPrefix)?;
    let rebyte_token = format!("{REBYTE_PREFIX}{payload}");
    let decoded = rebyte_artifact_token::decode_artifact_token(
        &rebyte_token,
        &SecurityLimits::SIMPLE_ARTIFACT,
    )
    .map_err(format_error)?;

    Ok(VerifiedArtifact { decoded })
}

fn report(decoded: &DecodedArtifact) -> ArtifactReport {
    ArtifactReport {
        schema_version: 1,
        protocol_version: 1,
        authenticated: false,
        content_digest: hex::encode(decoded.content_digest().as_bytes()),
        envelope_digest: hex::encode(decoded.envelope_digest().as_bytes()),
        compression: compression_name(decoded.compression()),
        entries: decoded.artifact().entries().len(),
        original_bytes: decoded.original_size(),
        stored_bytes: decoded.stored_size(),
        dictionary_bytes: decoded.dictionary_size(),
        suggested_path: decoded
            .artifact()
            .suggested_path()
            .map(|path| path.as_str().to_string()),
        files: decoded
            .artifact()
            .entries()
            .iter()
            .filter(|entry| entry.kind() == ArtifactEntryKind::File)
            .map(|entry| ArtifactFileReport {
                path: entry
                    .path()
                    .map_or_else(|| "index.ts".to_string(), |path| path.as_str().to_string()),
                bytes: u64::try_from(entry.bytes().len()).unwrap_or(u64::MAX),
                executable: entry.executable(),
            })
            .collect(),
    }
}

const fn compression_name(value: CompressionAlgorithm) -> &'static str {
    match value {
        CompressionAlgorithm::None => "none",
        CompressionAlgorithm::Zstd => "zstd",
    }
}

fn format_error(error: impl core::fmt::Display) -> ArtifactError {
    ArtifactError::Format(error.to_string())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use rebyte_format::RelativeArtifactPath;

    use super::{ArtifactFile, Compression, PackOptions, decode, pack};

    #[test]
    fn round_trips_exact_files_deterministically() {
        let files = vec![
            ArtifactFile::new("index.ts", b"export const isUser = () => true;\n".to_vec()),
            ArtifactFile::new(
                "user.ts",
                b"export { isUser } from \"./index.js\";\n".to_vec(),
            ),
        ];
        let options = PackOptions {
            suggested_path: Some("src/generated/jit".to_string()),
            compression: Compression::Auto,
            ..PackOptions::default()
        };
        let (first, report) = pack(&files, &options).expect("pack");
        let (second, _) = pack(&files, &options).expect("pack");
        let decoded = decode(&first).expect("decode");

        assert_eq!(first, second);
        assert!(first.starts_with("jit1_"));
        assert_eq!(report.files.len(), 2);
        assert_eq!(decoded.entries()[0].bytes(), files[0].bytes);
        assert_eq!(
            decoded.suggested_path().map(RelativeArtifactPath::as_str),
            Some("src/generated/jit")
        );
    }

    #[test]
    fn rejects_unsafe_paths_and_mutated_tokens() {
        let error = pack(
            &[ArtifactFile::new("../package.json", b"no".to_vec())],
            &PackOptions::default(),
        )
        .expect_err("unsafe path");
        assert!(error.to_string().contains("parent-directory"));

        let (mut token, _) = pack(
            &[ArtifactFile::new("index.ts", b"export {};\n".to_vec())],
            &PackOptions::default(),
        )
        .expect("pack");
        token.push('A');
        assert!(decode(&token).is_err());
    }
}
