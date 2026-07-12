# Security Policy

## Supported Versions

Security fixes are provided for the latest published major version. Before the
first stable release, fixes target the latest published version only.

## Reporting A Vulnerability

Do not open a public issue for suspected vulnerabilities. Use GitHub private
vulnerability reporting from the repository's **Security** tab. If that option
is unavailable, email `pedro.env5@gmail.com` with the subject
`[JIT SECURITY]`.

Include the affected version, execution mode, minimal reproduction, expected
impact, and whether generated source, AOT artifacts, codecs, streaming inputs,
or CLI file discovery are involved. Remove secrets and personal data from the
report.

You should receive an acknowledgement within seven days. The maintainer will
coordinate validation, remediation, release timing, and disclosure. Please do
not publish details before a fix or an agreed disclosure date.

## Security Boundaries

JIT generates JavaScript with `new Function` only in the runtime compilation
path. Runtime predicates, transforms, regular expressions, comparators, and
unsafe literals must travel as external bindings rather than source text. AOT
generation must not execute or embed untrusted application values.

Treat parser boundaries, generated source, path/property emission, binary wire
formats, prototype-related object keys, schema discovery, and CLI filesystem
access as security-sensitive code.
