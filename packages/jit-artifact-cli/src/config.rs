use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::{CliError, ConflictArgument};

pub(crate) const DEFAULT_CONFIG_FILE: &str = "jit.artifact.json";

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Config {
    #[serde(default = "schema_version")]
    pub(crate) schema_version: u16,
    pub(crate) output_root: Option<String>,
    pub(crate) compression: Option<String>,
    pub(crate) profile: Option<String>,
    pub(crate) dictionary: Option<bool>,
    pub(crate) conflict: Option<ConflictArgument>,
}

pub(crate) fn load(
    explicit: Option<&Path>,
    cwd: &Path,
) -> Result<(Config, Option<PathBuf>), CliError> {
    let path = explicit.map(Path::to_path_buf).or_else(|| {
        cwd.join(DEFAULT_CONFIG_FILE)
            .is_file()
            .then(|| cwd.join(DEFAULT_CONFIG_FILE))
    });
    let Some(path) = path else {
        return Ok((Config::default(), None));
    };
    let bytes = fs::read(&path)
        .map_err(|error| CliError::config(format!("cannot read {}: {error}", path.display())))?;
    let config: Config = serde_json::from_slice(&bytes)
        .map_err(|error| CliError::config(format!("invalid {}: {error}", path.display())))?;

    if config.schema_version != 1 {
        return Err(CliError::config(format!(
            "{} uses unsupported schemaVersion {}; expected 1",
            path.display(),
            config.schema_version
        )));
    }

    Ok((config, Some(path)))
}

const fn schema_version() -> u16 {
    1
}
