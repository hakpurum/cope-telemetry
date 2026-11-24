# Contributing

Bug reports, documentation improvements, and code contributions are welcome.
Do not report security vulnerabilities in public issues; follow the
[security policy](SECURITY.md).

## Getting started

1. Open an issue or review an existing one to discuss the change.
2. Fork and clone the repository, then create a branch for your change.
3. Follow the [installation instructions](README.md#installation-and-running).

## Changes and verification

- Keep changes focused and preserve existing interface, privacy, and read-only
  data behavior. Update the relevant documentation if behavior changes.
- Add appropriate tests for new behavior and bug fixes.
- Run the tests before opening a pull request:

  ```powershell
  .\.venv\Scripts\python -m unittest discover -s tests -v
  ```

  On macOS or Linux, use
  `./.venv/bin/python -m unittest discover -s tests -v`.
- Do not share real sessions, messages, commands, file paths, tokens, or other
  sensitive information in test data or screenshots. Use demo data.

## Pull requests

Describe the purpose of the change, how it was verified, and any related issue.
For interface changes, include screenshots taken with demo data.
Contributions are shared under the [MIT license](LICENSE); submit only content
you have the right to share.
