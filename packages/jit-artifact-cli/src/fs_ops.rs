use std::fs::{self, File};
use std::io::{self, Write as _};
use std::path::{Component, Path, PathBuf};

use jit_artifact::VerifiedArtifact;
use rebyte_artifact_token::{ArtifactEntry, ArtifactEntryKind};
use rebyte_format::RelativeArtifactPath;
use serde::Serialize;
use similar::TextDiff;

use crate::{CliError, ConflictArgument};

/// What reconstruction does to the project, before it does it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiffReport {
    pub(crate) creates: usize,
    pub(crate) updates: usize,
    pub(crate) unchanged: usize,
    /// Directories the artifact declares that do not exist yet.
    pub(crate) directories: Vec<String>,
    pub(crate) files: Vec<FileDiff>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileDiff {
    pub(crate) path: String,
    pub(crate) change: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) patch: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApplyReport {
    pub(crate) output: String,
    pub(crate) files_written: usize,
    pub(crate) directories_created: usize,
    pub(crate) bytes_written: u64,
}

pub(crate) fn resolve_output(
    project_root: &Path,
    configured: Option<&str>,
    artifact: &VerifiedArtifact,
) -> Result<PathBuf, CliError> {
    let relative = configured
        .map(str::to_owned)
        .or_else(|| {
            artifact
                .suggested_path()
                .map(|path| path.as_str().to_owned())
        })
        .ok_or_else(|| {
            CliError::usage(
                "no output directory: pass --output-root, or run without --yes to be asked",
            )
        })?;
    let portable = RelativeArtifactPath::new(&relative)
        .map_err(|error| CliError::unsafe_path(format!("invalid output root: {error}")))?;
    let root = canonical_project_root(project_root)?;

    validate_existing_components(&root, Path::new(portable.as_str()))?;
    Ok(root.join(portable_path(portable.as_str())))
}

pub(crate) fn diff(artifact: &VerifiedArtifact, output: &Path) -> Result<DiffReport, CliError> {
    let mut report = DiffReport {
        creates: 0,
        updates: 0,
        unchanged: 0,
        directories: Vec::new(),
        files: Vec::new(),
    };

    for entry in artifact.entries() {
        let relative = entry_path(entry)?;
        let local = output.join(portable_path(relative));

        if entry.kind() == ArtifactEntryKind::Directory {
            if !local.is_dir() {
                report.directories.push(relative.to_owned());
            }
            continue;
        }

        let metadata = match fs::symlink_metadata(&local) {
            Ok(metadata) => Some(metadata),
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(error) => {
                return Err(CliError::io(format!(
                    "cannot inspect {}: {error}",
                    local.display()
                )));
            }
        };

        match metadata {
            None => {
                report.creates += 1;
                report.files.push(FileDiff {
                    path: relative.to_owned(),
                    change: "create",
                    patch: text_patch(&[], entry.bytes()),
                });
            }
            Some(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                return Err(CliError::unsafe_path(format!(
                    "output entry is not a regular file: {}",
                    local.display()
                )));
            }
            Some(_) => {
                let current = fs::read(&local).map_err(|error| {
                    CliError::io(format!("cannot read {}: {error}", local.display()))
                })?;
                if current == entry.bytes() {
                    report.unchanged += 1;
                    report.files.push(FileDiff {
                        path: relative.to_owned(),
                        change: "unchanged",
                        patch: None,
                    });
                } else {
                    report.updates += 1;
                    report.files.push(FileDiff {
                        path: relative.to_owned(),
                        change: "update",
                        patch: text_patch(&current, entry.bytes()),
                    });
                }
            }
        }
    }

    Ok(report)
}

/// Writes the verified tree into the project.
///
/// Reconstruction merges rather than replaces. An earlier version swapped the
/// whole output directory for a staged copy, which is atomic and wrong for
/// what this is used for: the destination is a generated folder inside a
/// project, and anything a reader put beside the generated files disappeared.
/// Every file is written through a temporary in its own directory and renamed
/// into place, so each file lands whole or not at all, and nothing the
/// artifact does not name is touched.
pub(crate) fn apply(
    artifact: &VerifiedArtifact,
    output: &Path,
    project_root: &Path,
    conflict: ConflictArgument,
) -> Result<ApplyReport, CliError> {
    let project_root = canonical_project_root(project_root)?;
    validate_absolute_below(&project_root, output)?;
    create_directory(output)?;

    let mut report = ApplyReport {
        output: output.to_string_lossy().into_owned(),
        files_written: 0,
        directories_created: 0,
        bytes_written: 0,
    };

    // Directories first: a declared directory may be the parent of nothing at
    // all, and it is still part of the shape that was declared.
    for entry in artifact.entries() {
        if entry.kind() != ArtifactEntryKind::Directory {
            continue;
        }
        let relative = entry_path(entry)?;
        let destination = output.join(portable_path(relative));
        if !destination.is_dir() {
            report.directories_created += 1;
        }
        create_directory(&destination)?;
    }

    for entry in artifact.entries() {
        if entry.kind() != ArtifactEntryKind::File {
            continue;
        }
        let relative = entry_path(entry)?;
        let destination = output.join(portable_path(relative));
        let parent = destination
            .parent()
            .ok_or_else(|| CliError::unsafe_path("artifact entry has no parent"))?;
        create_directory(parent)?;

        match fs::symlink_metadata(&destination) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                return Err(CliError::unsafe_path(format!(
                    "output entry is not a regular file: {}",
                    destination.display()
                )));
            }
            Ok(_) => {
                let current = fs::read(&destination).map_err(|error| {
                    CliError::io(format!("cannot read {}: {error}", destination.display()))
                })?;
                if current == entry.bytes() {
                    continue;
                }
                if conflict == ConflictArgument::Abort {
                    return Err(CliError::conflict(format!(
                        "{relative} already exists and differs; re-run with --conflict overwrite"
                    )));
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(CliError::io(format!(
                    "cannot inspect {}: {error}",
                    destination.display()
                )));
            }
        }

        write_atomic(&destination, entry.bytes(), entry.executable())?;
        report.files_written += 1;
        report.bytes_written = report
            .bytes_written
            .checked_add(u64::try_from(entry.bytes().len()).unwrap_or(u64::MAX))
            .ok_or_else(|| CliError::io("artifact size overflow"))?;
    }

    verify_written(artifact.entries(), output)?;
    sync_directory(output)?;
    Ok(report)
}

/// Reads back every file the artifact names and compares it byte for byte.
fn verify_written(entries: &[ArtifactEntry], root: &Path) -> Result<(), CliError> {
    for entry in entries {
        if entry.kind() != ArtifactEntryKind::File {
            continue;
        }
        let relative = entry_path(entry)?;
        let path = root.join(portable_path(relative));
        let bytes = fs::read(&path)
            .map_err(|error| CliError::io(format!("cannot verify {relative}: {error}")))?;
        if bytes != entry.bytes() {
            return Err(CliError::integrity(format!(
                "written bytes differ for {relative}"
            )));
        }
    }
    Ok(())
}

/// One file, landing whole or not at all.
fn write_atomic(destination: &Path, bytes: &[u8], executable: bool) -> Result<(), CliError> {
    let parent = destination
        .parent()
        .ok_or_else(|| CliError::unsafe_path("output entry has no parent"))?;
    let mut temporary = tempfile::Builder::new()
        .prefix(".jit-artifact-")
        .tempfile_in(parent)
        .map_err(|error| {
            CliError::io(format!("cannot stage {}: {error}", destination.display()))
        })?;

    temporary
        .write_all(bytes)
        .and_then(|()| temporary.as_file().sync_all())
        .map_err(|error| {
            CliError::io(format!("cannot write {}: {error}", destination.display()))
        })?;
    set_executable(temporary.path(), executable)?;
    temporary.persist(destination).map_err(|error| {
        CliError::io(format!(
            "cannot commit {}: {}",
            destination.display(),
            error.error
        ))
    })?;

    Ok(())
}

fn create_directory(path: &Path) -> Result<(), CliError> {
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() {
            return Err(CliError::unsafe_path(format!(
                "output crosses symbolic link {}",
                path.display()
            )));
        }
        if !metadata.is_dir() {
            return Err(CliError::unsafe_path(format!(
                "output is not a directory: {}",
                path.display()
            )));
        }
        return Ok(());
    }

    fs::create_dir_all(path)
        .map_err(|error| CliError::io(format!("cannot create {}: {error}", path.display())))
}

fn entry_path(entry: &ArtifactEntry) -> Result<&str, CliError> {
    entry
        .path()
        .map(RelativeArtifactPath::as_str)
        .ok_or_else(|| CliError::unsafe_path("artifact entry has no path"))
}

fn canonical_project_root(path: &Path) -> Result<PathBuf, CliError> {
    fs::create_dir_all(path).map_err(|error| {
        CliError::io(format!(
            "cannot create project root {}: {error}",
            path.display()
        ))
    })?;
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        CliError::io(format!(
            "cannot inspect project root {}: {error}",
            path.display()
        ))
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(CliError::unsafe_path(
            "project root must be a real directory",
        ));
    }
    fs::canonicalize(path).map_err(|error| {
        CliError::io(format!(
            "cannot resolve project root {}: {error}",
            path.display()
        ))
    })
}

fn validate_existing_components(root: &Path, relative: &Path) -> Result<(), CliError> {
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(value) = component else {
            return Err(CliError::unsafe_path("output contains an unsafe component"));
        };
        current.push(value);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(CliError::unsafe_path(format!(
                    "output crosses symbolic link {}",
                    current.display()
                )));
            }
            Ok(metadata) if !metadata.is_dir() => {
                return Err(CliError::unsafe_path(format!(
                    "output crosses non-directory {}",
                    current.display()
                )));
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => break,
            Err(error) => {
                return Err(CliError::io(format!(
                    "cannot inspect {}: {error}",
                    current.display()
                )));
            }
        }
    }
    Ok(())
}

fn validate_absolute_below(root: &Path, value: &Path) -> Result<(), CliError> {
    if !value.is_absolute() || !value.starts_with(root) {
        return Err(CliError::unsafe_path("output escaped the project root"));
    }
    Ok(())
}

fn portable_path(value: &str) -> PathBuf {
    value.split('/').collect()
}

fn text_patch(before: &[u8], after: &[u8]) -> Option<String> {
    let before = std::str::from_utf8(before).ok()?;
    let after = std::str::from_utf8(after).ok()?;
    Some(
        TextDiff::from_lines(before, after)
            .unified_diff()
            .header("local", "artifact")
            .to_string(),
    )
}

fn sync_directory(path: &Path) -> Result<(), CliError> {
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|error| CliError::io(format!("cannot sync {}: {error}", path.display())))
}

#[cfg(unix)]
fn set_executable(path: &Path, executable: bool) -> Result<(), CliError> {
    use std::os::unix::fs::PermissionsExt as _;

    let mut permissions = fs::metadata(path)
        .map_err(|error| CliError::io(format!("cannot read permissions: {error}")))?
        .permissions();
    let current = permissions.mode();
    permissions.set_mode(if executable {
        current | 0o111
    } else {
        current & !0o111
    });
    fs::set_permissions(path, permissions)
        .map_err(|error| CliError::io(format!("cannot set permissions: {error}")))
}

#[cfg(not(unix))]
fn set_executable(_path: &Path, _executable: bool) -> Result<(), CliError> {
    Ok(())
}
