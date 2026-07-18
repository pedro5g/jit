use std::fs::{self, File};
use std::io::{self, Write as _};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use jit_artifact::VerifiedArtifact;
use rebyte_artifact_token::{ArtifactEntry, ArtifactEntryKind};
use rebyte_format::RelativeArtifactPath;
use serde::{Deserialize, Serialize};
use similar::TextDiff;

use crate::{CliError, ConflictArgument};

const CONTROL_DIR: &str = ".jit-artifacts";
const TRANSACTIONS_DIR: &str = "transactions";

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiffReport {
    pub(crate) creates: usize,
    pub(crate) updates: usize,
    pub(crate) unchanged: usize,
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
    pub(crate) transaction_id: String,
    pub(crate) output: String,
    pub(crate) files_written: usize,
    pub(crate) bytes_written: u64,
    pub(crate) backup: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Transaction {
    pub(crate) schema_version: u16,
    pub(crate) id: String,
    pub(crate) state: String,
    pub(crate) output: String,
    pub(crate) backup: Option<String>,
    pub(crate) envelope_digest: String,
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
            CliError::usage("no output root: pass --output-root or configure outputRoot")
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
        files: Vec::new(),
    };

    for entry in artifact.entries() {
        if entry.kind() != ArtifactEntryKind::File {
            continue;
        }
        let relative = entry_path(entry)?;
        let local = output.join(portable_path(relative));
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

pub(crate) fn apply(
    artifact: &VerifiedArtifact,
    output: &Path,
    project_root: &Path,
    conflict: ConflictArgument,
) -> Result<ApplyReport, CliError> {
    let project_root = canonical_project_root(project_root)?;
    validate_absolute_below(&project_root, output)?;
    let parent = output
        .parent()
        .ok_or_else(|| CliError::unsafe_path("output has no parent"))?;
    fs::create_dir_all(parent)
        .map_err(|error| CliError::io(format!("cannot create {}: {error}", parent.display())))?;
    validate_existing_components(parent, Path::new(""))?;

    let transaction_id = transaction_id()?;
    let staging = tempfile::Builder::new()
        .prefix(".jit-artifact-stage-")
        .tempdir_in(parent)
        .map_err(|error| CliError::io(format!("cannot create staging directory: {error}")))?;
    stage_entries(artifact.entries(), staging.path())?;
    verify_staged(artifact.entries(), staging.path())?;

    let existing = fs::symlink_metadata(output).ok();
    if let Some(metadata) = &existing {
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(CliError::unsafe_path(format!(
                "output is not a real directory: {}",
                output.display()
            )));
        }
        if conflict == ConflictArgument::Abort {
            return Err(CliError::conflict(format!(
                "output already exists: {}; use --conflict overwrite or backup",
                output.display()
            )));
        }
    }

    let backup = existing.map(|_| backup_path(output, &transaction_id));
    let mut transaction = Transaction {
        schema_version: 1,
        id: transaction_id.clone(),
        state: "prepared".to_owned(),
        output: output.to_string_lossy().into_owned(),
        backup: backup
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned()),
        envelope_digest: artifact.envelope_digest_hex(),
    };
    persist_transaction(&project_root, &transaction)?;

    if let Some(backup) = &backup {
        fs::rename(output, backup)
            .map_err(|error| CliError::io(format!("cannot stage existing output: {error}")))?;
    }

    "committing".clone_into(&mut transaction.state);
    persist_transaction(&project_root, &transaction)?;
    let staging_path = staging.keep();
    if let Err(error) = fs::rename(&staging_path, output) {
        if let Some(backup) = &backup {
            let _restore = fs::rename(backup, output);
        }
        let _cleanup = fs::remove_dir_all(&staging_path);
        "rolledBack".clone_into(&mut transaction.state);
        let _persist = persist_transaction(&project_root, &transaction);
        return Err(CliError::io(format!(
            "cannot commit generated output: {error}"
        )));
    }
    sync_directory(parent)?;
    verify_staged(artifact.entries(), output)?;

    let retained_backup = if conflict == ConflictArgument::Backup {
        backup.clone()
    } else {
        if let Some(backup) = &backup {
            fs::remove_dir_all(backup).map_err(|error| {
                CliError::io(format!("cannot remove temporary backup: {error}"))
            })?;
        }
        None
    };
    "committed".clone_into(&mut transaction.state);
    transaction.backup = retained_backup
        .as_ref()
        .map(|path| path.to_string_lossy().into_owned());
    persist_transaction(&project_root, &transaction)?;

    let files_written = artifact
        .entries()
        .iter()
        .filter(|entry| entry.kind() == ArtifactEntryKind::File)
        .count();
    let bytes_written = artifact.entries().iter().try_fold(0_u64, |total, entry| {
        let size =
            u64::try_from(entry.bytes().len()).map_err(|_| CliError::io("file size overflow"))?;
        total
            .checked_add(size)
            .ok_or_else(|| CliError::io("artifact size overflow"))
    })?;

    Ok(ApplyReport {
        transaction_id,
        output: output.to_string_lossy().into_owned(),
        files_written,
        bytes_written,
        backup: retained_backup.map(|path| path.to_string_lossy().into_owned()),
    })
}

pub(crate) fn list_transactions(project_root: &Path) -> Result<Vec<Transaction>, CliError> {
    let root = canonical_project_root(project_root)?;
    let directory = root.join(CONTROL_DIR).join(TRANSACTIONS_DIR);
    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(CliError::io(format!(
                "cannot read {}: {error}",
                directory.display()
            )));
        }
    };
    let mut transactions = Vec::new();

    for entry in entries {
        let path = entry
            .map_err(|error| CliError::io(format!("cannot read transaction entry: {error}")))?
            .path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let bytes = fs::read(&path)
            .map_err(|error| CliError::io(format!("cannot read {}: {error}", path.display())))?;
        let transaction = serde_json::from_slice(&bytes)
            .map_err(|error| CliError::io(format!("invalid {}: {error}", path.display())))?;
        transactions.push(transaction);
    }
    transactions.sort_by(|left: &Transaction, right: &Transaction| left.id.cmp(&right.id));
    Ok(transactions)
}

pub(crate) fn rollback(project_root: &Path, id: &str) -> Result<Transaction, CliError> {
    let root = canonical_project_root(project_root)?;
    let path = root
        .join(CONTROL_DIR)
        .join(TRANSACTIONS_DIR)
        .join(format!("{id}.json"));
    let bytes = fs::read(&path)
        .map_err(|error| CliError::io(format!("cannot read {}: {error}", path.display())))?;
    let mut transaction: Transaction = serde_json::from_slice(&bytes)
        .map_err(|error| CliError::io(format!("invalid {}: {error}", path.display())))?;
    let backup = transaction
        .backup
        .as_ref()
        .map(PathBuf::from)
        .ok_or_else(|| CliError::conflict("transaction has no retained backup"))?;
    let output = PathBuf::from(&transaction.output);
    validate_absolute_below(&root, &output)?;
    validate_absolute_below(&root, &backup)?;

    if !backup.is_dir() {
        return Err(CliError::conflict("retained backup no longer exists"));
    }
    let displaced = backup_path(&output, &format!("rollback-{id}"));
    if output.exists() {
        fs::rename(&output, &displaced)
            .map_err(|error| CliError::io(format!("cannot stage current output: {error}")))?;
    }
    if let Err(error) = fs::rename(&backup, &output) {
        if displaced.exists() {
            let _restore = fs::rename(&displaced, &output);
        }
        return Err(CliError::io(format!("cannot restore backup: {error}")));
    }
    if displaced.exists() {
        fs::remove_dir_all(displaced)
            .map_err(|error| CliError::io(format!("cannot remove displaced output: {error}")))?;
    }
    "rolledBack".clone_into(&mut transaction.state);
    transaction.backup = None;
    write_json_atomic(&path, &transaction)?;
    Ok(transaction)
}

fn stage_entries(entries: &[ArtifactEntry], staging: &Path) -> Result<(), CliError> {
    for entry in entries {
        let relative = entry_path(entry)?;
        let destination = staging.join(portable_path(relative));
        match entry.kind() {
            ArtifactEntryKind::Directory => {
                fs::create_dir_all(&destination)
                    .map_err(|error| CliError::io(format!("cannot stage {relative}: {error}")))?;
            }
            ArtifactEntryKind::File => {
                let parent = destination
                    .parent()
                    .ok_or_else(|| CliError::unsafe_path("artifact entry has no parent"))?;
                fs::create_dir_all(parent)
                    .map_err(|error| CliError::io(format!("cannot stage {relative}: {error}")))?;
                let mut file = File::options()
                    .write(true)
                    .create_new(true)
                    .open(&destination)
                    .map_err(|error| {
                        CliError::io(format!("cannot create staged {relative}: {error}"))
                    })?;
                file.write_all(entry.bytes()).map_err(|error| {
                    CliError::io(format!("cannot write staged {relative}: {error}"))
                })?;
                file.sync_all().map_err(|error| {
                    CliError::io(format!("cannot sync staged {relative}: {error}"))
                })?;
                set_executable(&destination, entry.executable())?;
            }
        }
    }
    Ok(())
}

fn verify_staged(entries: &[ArtifactEntry], root: &Path) -> Result<(), CliError> {
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
                "staged bytes differ for {relative}"
            )));
        }
    }
    Ok(())
}

fn entry_path(entry: &ArtifactEntry) -> Result<&str, CliError> {
    entry
        .path()
        .map(RelativeArtifactPath::as_str)
        .ok_or_else(|| CliError::unsafe_path("directory artifact entry has no path"))
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
            Ok(metadata) if !metadata.is_dir() && current != root.join(relative) => {
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
        return Err(CliError::unsafe_path(
            "transaction path escaped the project root",
        ));
    }
    Ok(())
}

fn persist_transaction(project_root: &Path, transaction: &Transaction) -> Result<(), CliError> {
    let directory = project_root.join(CONTROL_DIR).join(TRANSACTIONS_DIR);
    fs::create_dir_all(&directory)
        .map_err(|error| CliError::io(format!("cannot create transaction directory: {error}")))?;
    write_json_atomic(
        &directory.join(format!("{}.json", transaction.id)),
        transaction,
    )
}

fn write_json_atomic(path: &Path, value: &impl Serialize) -> Result<(), CliError> {
    let parent = path
        .parent()
        .ok_or_else(|| CliError::io("journal path has no parent"))?;
    let mut temporary = tempfile::Builder::new()
        .prefix(".jit-journal-")
        .tempfile_in(parent)
        .map_err(|error| CliError::io(format!("cannot stage journal: {error}")))?;
    serde_json::to_writer_pretty(&mut temporary, value)
        .map_err(|error| CliError::io(format!("cannot encode journal: {error}")))?;
    temporary
        .write_all(b"\n")
        .map_err(|error| CliError::io(format!("cannot write journal: {error}")))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| CliError::io(format!("cannot sync journal: {error}")))?;
    temporary
        .persist(path)
        .map_err(|error| CliError::io(format!("cannot commit journal: {}", error.error)))?;
    Ok(())
}

fn transaction_id() -> Result<String, CliError> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| CliError::io(format!("system clock error: {error}")))?
        .as_nanos();
    Ok(format!("{nanos:x}-{:x}", std::process::id()))
}

fn backup_path(output: &Path, id: &str) -> PathBuf {
    let name = output
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("generated");
    output.with_file_name(format!(".{name}.jit-backup-{id}"))
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
