# Technical documentation

## Architecture

The default interface is served by the [Flask application](../dashboard.py).
Pages are in [templates](../templates/), and client-side code and styles are
in [static](../static/). [dashboard_data.py](../dashboard_data.py) selects
demo or local sources and calculates view data. [telemetry.py](../telemetry.py)
provides SQLite queries, while [agent_metadata.py](../agent_metadata.py)
reads agent events from local JSONL logs. Translations are maintained in
[translations.json](../translations.json) and [localization.py](../localization.py).

## Data sources and privacy

The local source uses `$COPILOT_HOME/session-store.db`; if `COPILOT_HOME` is
unset or empty, it uses `~/.copilot/session-store.db`. The SQLite connection
uses `mode=ro` and `PRAGMA query_only=ON`. Agent names and statuses are read
from the corresponding `session-state/<session>/events.jsonl` files. The demo
source uses generated records instead of the real database.

Message and command contents are not shown unless explicitly requested for the
selected session. File paths, repository names, and other metadata may still
be sensitive. The application depends on the local database schema; schema
differences can cause read errors.

## Flask endpoints

- `/` and `/<page>`: dashboard pages. Page names are `overview`, `usage`,
  `agents`, `performance`, `efficiency`, `sessions`, and `activity`.
- `/api/data`: returns dashboard data for `page` and the common filters.
- `/api/session/<session_id>`: returns details for a session matching the
  filters. Message and command contents are requested only with `content=1`.

Common query parameters are `source` (`live` or `demo`), `start`, `end`,
`repo`, `model`, `workspace`, and `session`. Dates use the `YYYY-MM-DD`
format and are evaluated by local day. Invalid filters return HTTP 400, and
local data read errors return HTTP 503. A missing session or a session that
does not match the filters returns HTTP 404.

## Metrics and limitations

Usage events are filtered by their own timestamps. The model filter limits
usage events and matching sessions; it does not attribute messages, files, or
commands to a model. One billion nano-AIU is displayed as one AI credit.
Missing credit measurements may make totals partial. This value is not a
monetary amount or account balance. P95 uses the nearest-rank method; missing
measurements are excluded from averages. Request durations are not actual
working time or a measure of result quality.

## Running and testing

See the [README](../README.md) for installation, demo selection, and test
commands. Tests are in [tests](../tests/).
