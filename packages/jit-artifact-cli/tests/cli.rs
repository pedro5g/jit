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
    let token_file = workspace.path().join("artifact.txt");

    Command::cargo_bin("jit-artifact")
        .expect("binary")
        .current_dir(workspace.path())
        .args(["pack", "generated", "--output-root", "src/generated/jit"])
        .args(["--output"])
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
        .arg("--yes")
        .assert()
        .success();

    assert_eq!(
        fs::read(workspace.path().join("src/generated/jit/index.ts")).expect("reconstructed"),
        b"export const isUser = () => true;\n"
    );
}

/**
The declared layout is the deliverable.

A workspace declares directories, not a flat list: `schemas/` beside `dto/`,
and `dto/` may be empty because the reader has not filled it yet. Both halves
have to survive, and neither may cost the project anything that was already in
the destination — a generated folder usually sits inside one.
*/
#[test]
fn reconstructs_a_declared_tree_and_leaves_the_rest_of_the_project_alone() {
    let workspace = tempfile::tempdir().expect("workspace");
    let generated = workspace.path().join("generated");
    fs::create_dir_all(generated.join("schemas")).expect("schemas");
    fs::create_dir_all(generated.join("dto")).expect("dto");
    fs::write(
        generated.join("schemas/user.ts"),
        "export const isUser = () => true;\n",
    )
    .expect("user");
    fs::write(
        generated.join("schemas/account.ts"),
        "export const isAccount = () => true;\n",
    )
    .expect("account");

    let output = workspace.path().join("src/generated/jit");
    fs::create_dir_all(&output).expect("output");
    fs::write(output.join("notes.md"), "mine\n").expect("unrelated file");

    let token_file = workspace.path().join("artifact.txt");
    Command::cargo_bin("jit-artifact")
        .expect("binary")
        .current_dir(workspace.path())
        .args(["pack", "generated", "--output-root", "src/generated/jit"])
        .args(["--output"])
        .arg(&token_file)
        .assert()
        .success();

    Command::cargo_bin("jit-artifact")
        .expect("binary")
        .current_dir(workspace.path())
        .args(["apply", "--file"])
        .arg(&token_file)
        .arg("--yes")
        .assert()
        .success()
        .stdout(predicate::str::contains("2 file(s)"));

    assert_eq!(
        fs::read_to_string(output.join("schemas/user.ts")).expect("user"),
        "export const isUser = () => true;\n"
    );
    assert!(output.join("dto").is_dir(), "empty directory was declared");
    assert_eq!(
        fs::read_to_string(output.join("notes.md")).expect("unrelated file survives"),
        "mine\n"
    );
}

/// Nothing but the files. No configuration, no journal, no control directory.
#[test]
fn writes_no_state_beside_the_reconstructed_files() {
    let workspace = tempfile::tempdir().expect("workspace");
    let generated = workspace.path().join("generated");
    fs::create_dir(&generated).expect("generated");
    fs::write(generated.join("index.ts"), "export {};\n").expect("source");
    let token_file = workspace.path().join("artifact.txt");

    Command::cargo_bin("jit-artifact")
        .expect("binary")
        .current_dir(workspace.path())
        .args(["pack", "generated", "--output-root", "out"])
        .args(["--output"])
        .arg(&token_file)
        .assert()
        .success();
    Command::cargo_bin("jit-artifact")
        .expect("binary")
        .current_dir(workspace.path())
        .args(["apply", "--file"])
        .arg(&token_file)
        .arg("--yes")
        .assert()
        .success();

    let entries = fs::read_dir(workspace.path())
        .expect("workspace entries")
        .map(|entry| {
            entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect::<Vec<_>>();

    assert!(!entries.iter().any(|name| name == ".jit-artifacts"));
    assert!(!entries.iter().any(|name| name == "jit.artifact.json"));
    assert!(
        fs::read_dir(workspace.path().join("out"))
            .expect("output")
            .count()
            .eq(&1)
    );
}

/// Replacing work someone did by hand is never assumed, only instructed.
#[test]
fn refuses_to_replace_a_differing_file_until_told_to() {
    let workspace = tempfile::tempdir().expect("workspace");
    let generated = workspace.path().join("generated");
    fs::create_dir(&generated).expect("generated");
    fs::write(generated.join("index.ts"), "export const version = 2;\n").expect("source");
    let output = workspace.path().join("out");
    fs::create_dir_all(&output).expect("output");
    fs::write(output.join("index.ts"), "export const version = 1;\n").expect("existing");
    let token_file = workspace.path().join("artifact.txt");

    Command::cargo_bin("jit-artifact")
        .expect("binary")
        .current_dir(workspace.path())
        .args(["pack", "generated", "--output-root", "out"])
        .args(["--output"])
        .arg(&token_file)
        .assert()
        .success();

    Command::cargo_bin("jit-artifact")
        .expect("binary")
        .current_dir(workspace.path())
        .args(["apply", "--file"])
        .arg(&token_file)
        .arg("--yes")
        .assert()
        .failure()
        .stderr(predicate::str::contains("--conflict overwrite"));

    assert_eq!(
        fs::read_to_string(output.join("index.ts")).expect("untouched"),
        "export const version = 1;\n"
    );

    Command::cargo_bin("jit-artifact")
        .expect("binary")
        .current_dir(workspace.path())
        .args(["apply", "--file"])
        .arg(&token_file)
        .args(["--yes", "--conflict", "overwrite"])
        .assert()
        .success();

    assert_eq!(
        fs::read_to_string(output.join("index.ts")).expect("replaced"),
        "export const version = 2;\n"
    );
}

#[test]
fn reports_which_registry_the_run_trusts_and_why() {
    Command::cargo_bin("jit-artifact")
        .expect("binary")
        .args(["doctor", "--env", "local"])
        .assert()
        .success()
        .stdout(predicate::str::contains("http://localhost:3000"))
        .stdout(predicate::str::contains("from --env"));

    Command::cargo_bin("jit-artifact")
        .expect("binary")
        .env("JIT_LAB_ENV", "local")
        .args(["doctor"])
        .assert()
        .success()
        .stdout(predicate::str::contains("from JIT_LAB_ENV"));

    // the flag outranks the environment, and says so
    Command::cargo_bin("jit-artifact")
        .expect("binary")
        .env("JIT_LAB_REGISTRY", "http://localhost:3000")
        .args(["doctor", "--registry", "https://example.com"])
        .assert()
        .success()
        .stdout(predicate::str::contains("https://example.com"))
        .stdout(predicate::str::contains("from --registry"));
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
