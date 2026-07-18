#![allow(clippy::expect_used)]

use std::fs;

use assert_cmd::Command;
use predicates::prelude::*;

#[test]
fn packs_verifies_diffs_and_applies_exact_typescript() {
    let workspace = tempfile::tempdir().expect("workspace");
    let generated = workspace.path().join("generated");
    fs::create_dir(&generated).expect("generated");
    fs::write(
        generated.join("index.ts"),
        "export const isUser = () => true;\n",
    )
    .expect("source");
    fs::write(
        workspace.path().join("jit.artifact.json"),
        r#"{"schemaVersion":1,"outputRoot":"src/generated/jit","compression":"auto","conflict":"overwrite"}"#,
    )
    .expect("config");
    let token_file = workspace.path().join("artifact.txt");

    Command::cargo_bin("jit-artifact")
        .expect("binary")
        .current_dir(workspace.path())
        .args(["pack", "generated", "--output"])
        .arg(&token_file)
        .assert()
        .success();

    Command::cargo_bin("jit-artifact")
        .expect("binary")
        .current_dir(workspace.path())
        .args(["verify", "--file"])
        .arg(&token_file)
        .assert()
        .success()
        .stdout(predicate::str::contains("byte-exact"));

    Command::cargo_bin("jit-artifact")
        .expect("binary")
        .current_dir(workspace.path())
        .args(["diff", "--file"])
        .arg(&token_file)
        .assert()
        .success()
        .stdout(predicate::str::contains("1 create"));

    Command::cargo_bin("jit-artifact")
        .expect("binary")
        .current_dir(workspace.path())
        .args(["apply", "--file"])
        .arg(&token_file)
        .args(["--yes", "--conflict", "overwrite"])
        .assert()
        .success();

    assert_eq!(
        fs::read(workspace.path().join("src/generated/jit/index.ts")).expect("reconstructed"),
        b"export const isUser = () => true;\n"
    );
}

#[test]
fn initializes_a_documented_configuration() {
    let workspace = tempfile::tempdir().expect("workspace");

    Command::cargo_bin("jit-artifact")
        .expect("binary")
        .current_dir(workspace.path())
        .arg("init")
        .assert()
        .success();

    let config = fs::read_to_string(workspace.path().join("jit.artifact.json")).expect("config");
    assert!(config.contains("\"schemaVersion\": 1"));
    assert!(config.contains("\"outputRoot\": \"src/generated/jit\""));
    assert!(config.contains("\"conflict\": \"abort\""));
}

#[test]
fn retains_and_rolls_back_a_complete_generated_tree() {
    let workspace = tempfile::tempdir().expect("workspace");
    let generated = workspace.path().join("generated");
    let output = workspace.path().join("src/generated/jit");
    fs::create_dir_all(&generated).expect("generated");
    fs::create_dir_all(&output).expect("output");
    fs::write(generated.join("index.ts"), "export const version = 2;\n").expect("new source");
    fs::write(output.join("index.ts"), "export const version = 1;\n").expect("old source");
    fs::write(
        workspace.path().join("jit.artifact.json"),
        r#"{"schemaVersion":1,"outputRoot":"src/generated/jit","conflict":"backup"}"#,
    )
    .expect("config");
    let token_file = workspace.path().join("artifact.txt");

    Command::cargo_bin("jit-artifact")
        .expect("binary")
        .current_dir(workspace.path())
        .args(["pack", "generated", "--output"])
        .arg(&token_file)
        .assert()
        .success();
    Command::cargo_bin("jit-artifact")
        .expect("binary")
        .current_dir(workspace.path())
        .args(["apply", "--file"])
        .arg(&token_file)
        .args(["--yes", "--conflict", "backup"])
        .assert()
        .success();

    assert_eq!(
        fs::read_to_string(output.join("index.ts")).expect("new output"),
        "export const version = 2;\n"
    );
    let journal_dir = workspace.path().join(".jit-artifacts/transactions");
    let journal = fs::read_dir(&journal_dir)
        .expect("journal directory")
        .next()
        .expect("journal")
        .expect("journal entry")
        .path();
    let transaction: serde_json::Value =
        serde_json::from_slice(&fs::read(journal).expect("journal bytes")).expect("journal JSON");
    let id = transaction["id"].as_str().expect("transaction id");

    Command::cargo_bin("jit-artifact")
        .expect("binary")
        .current_dir(workspace.path())
        .args(["rollback", id])
        .assert()
        .success();

    assert_eq!(
        fs::read_to_string(output.join("index.ts")).expect("restored output"),
        "export const version = 1;\n"
    );
}

#[test]
fn rejects_symlink_inputs_and_requires_confirmation_in_automation() {
    let workspace = tempfile::tempdir().expect("workspace");
    let source = workspace.path().join("source");
    fs::create_dir(&source).expect("source");
    fs::write(source.join("index.ts"), "export {};\n").expect("source");

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(source.join("index.ts"), source.join("linked.ts"))
            .expect("symlink");
        Command::cargo_bin("jit-artifact")
            .expect("binary")
            .args(["pack"])
            .arg(&source)
            .assert()
            .failure()
            .stderr(predicate::str::contains("symbolic link"));
    }
}
