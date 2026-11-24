# Security policy

## Reporting a vulnerability

Do not disclose vulnerabilities in public issues, pull requests, or
discussions. Submit a private report using **Report a vulnerability** in the
GitHub repository's **Security** tab. If that option is unavailable, the
repository owner needs to enable private vulnerability reporting.

Include the affected version or commit, reproduction steps, potential impact,
and any suggested fix. Do not send real session content, credentials, or other
personal data; demonstrate the issue with sample data. The repository owner
can review the report and respond privately.

## Local data security

By default, the Flask dashboard listens only on `127.0.0.1` and opens the
SQLite database read-only. This does not provide access control against other
applications on the same computer. Do not expose the dashboard directly to the
internet. Session data, file paths, and messages may be sensitive; review
screenshots, logs, and bug reports before sharing them.
