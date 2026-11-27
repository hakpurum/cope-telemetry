"""Read-only queries for Copilot's local session store."""

import os
import sqlite3
from collections import defaultdict
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path


def database_path() -> Path:
    copilot_home = os.environ.get("COPILOT_HOME")
    directory = Path(copilot_home).expanduser() if copilot_home else Path.home() / ".copilot"
    return directory / "session-store.db"


def utc_bounds(start: date, end: date) -> tuple[str, str]:
    if start > end:
        raise ValueError("Başlangıç tarihi bitiş tarihinden sonra olamaz.")
    if end == date.max:
        raise ValueError("Bitiş tarihi desteklenen aralığın dışında.")
    start_utc = datetime.combine(start, time.min).astimezone(timezone.utc)
    end_utc = datetime.combine(end + timedelta(days=1), time.min).astimezone(timezone.utc)
    return start_utc.isoformat(), end_utc.isoformat()


@contextmanager
def open_database(path: Path | None = None):
    resolved = (path if path is not None else database_path()).expanduser().resolve()
    try:
        connection = sqlite3.connect(resolved.as_uri() + "?mode=ro", uri=True, timeout=2)
    except sqlite3.OperationalError as error:
        raise sqlite3.OperationalError(f"{resolved}: {error}") from error
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA query_only=ON")
        connection.execute("BEGIN")
        yield connection
    finally:
        connection.close()


def options(connection):
    repos = [
        row[0] for row in connection.execute(
            "SELECT DISTINCT repository FROM sessions WHERE repository IS NOT NULL AND repository != '' ORDER BY repository"
        )
    ]
    models = [
        row[0] for row in connection.execute(
            "SELECT DISTINCT model FROM assistant_usage_events ORDER BY model"
        )
    ]
    return repos, models


def workspaces(connection):
    return [
        row[0] for row in connection.execute(
            "SELECT DISTINCT cwd FROM sessions WHERE cwd IS NOT NULL AND cwd != '' ORDER BY cwd"
        )
    ]


def sessions(connection, start, end, repo=None, model=None, workspace=None):
    params = {"start": start, "end": end, "repo": repo, "model": model, "workspace": workspace}
    return connection.execute(
        """
        SELECT s.id, s.repository, s.cwd, s.branch, s.created_at, s.updated_at
        FROM sessions s
        WHERE (:repo IS NULL OR s.repository = :repo)
          AND (:workspace IS NULL OR s.cwd = :workspace)
          AND (
            (julianday(s.created_at) >= julianday(:start) AND julianday(s.created_at) < julianday(:end))
            OR (julianday(s.updated_at) >= julianday(:start) AND julianday(s.updated_at) < julianday(:end))
            OR EXISTS (SELECT 1 FROM assistant_usage_events a WHERE a.session_id = s.id
                AND julianday(a.created_at) >= julianday(:start) AND julianday(a.created_at) < julianday(:end))
            OR EXISTS (SELECT 1 FROM turns t WHERE t.session_id = s.id
                AND julianday(t.timestamp) >= julianday(:start) AND julianday(t.timestamp) < julianday(:end))
            OR EXISTS (SELECT 1 FROM session_files f WHERE f.session_id = s.id
                AND julianday(f.first_seen_at) >= julianday(:start) AND julianday(f.first_seen_at) < julianday(:end))
            OR EXISTS (SELECT 1 FROM forge_trajectory_events e WHERE e.session_id = s.id
                AND julianday(e.created_at) >= julianday(:start) AND julianday(e.created_at) < julianday(:end))
          )
          AND (:model IS NULL OR EXISTS (
            SELECT 1 FROM assistant_usage_events a WHERE a.session_id = s.id AND a.model = :model
              AND julianday(a.created_at) >= julianday(:start) AND julianday(a.created_at) < julianday(:end)
          ))
        ORDER BY s.updated_at DESC, s.id
        """,
        params,
    ).fetchall()


def session_models(connection, session_ids):
    models = defaultdict(set)
    for offset in range(0, len(session_ids), 500):
        ids = session_ids[offset:offset + 500]
        markers = ",".join("?" for _ in ids)
        rows = connection.execute(
            f"""SELECT session_id, model FROM assistant_usage_events
                WHERE session_id IN ({markers}) AND model IS NOT NULL AND model != ''
                GROUP BY session_id, model ORDER BY session_id, model""",
            ids,
        )
        for row in rows:
            models[row["session_id"]].add(row["model"])
    return {session_id: sorted(names) for session_id, names in models.items()}


def usage(connection, start, end, repo=None, model=None, session_id=None, extended=False, workspace=None):
    optional_fields = ("id", "turn_index", "reasoning_tokens", "finish_reason",
                       "content_filter_triggered", "inter_token_latency_ms", "initiator",
                       "copilot_usage_model", "request_multiplier", "output_ttft_ms",
                       "reasoning_effort", "api_endpoint", "agent_id", "parent_tool_call_id")
    extra = ""
    if extended:
        available = {row["name"] for row in connection.execute("PRAGMA table_info(assistant_usage_events)")}
        extra = "".join(
            f", a.{field}" if field in available else f", NULL AS {field}"
            for field in optional_fields
        )
    return connection.execute(
        f"""
        SELECT a.session_id, a.model, a.created_at, a.input_tokens, a.output_tokens,
               a.cache_read_tokens, a.cache_write_tokens, a.total_nano_aiu,
               a.duration_ms, a.time_to_first_token_ms{extra}
        FROM assistant_usage_events a
        JOIN sessions s ON s.id = a.session_id
        WHERE julianday(a.created_at) >= julianday(:start)
          AND julianday(a.created_at) < julianday(:end)
          AND (:repo IS NULL OR s.repository = :repo)
          AND (:workspace IS NULL OR s.cwd = :workspace)
          AND (:model IS NULL OR a.model = :model)
          AND (:session_id IS NULL OR a.session_id = :session_id)
        ORDER BY a.created_at
        """,
        {"start": start, "end": end, "repo": repo, "model": model, "session_id": session_id, "workspace": workspace},
    ).fetchall()


def details(connection, session_id, start, end, include_content=False):
    params = {"session_id": session_id, "start": start, "end": end}
    message_fields = ", user_message, assistant_response" if include_content else ""
    command_fields = ", command, output" if include_content else ""
    messages = connection.execute(
        f"""SELECT turn_index, timestamp{message_fields} FROM turns
            WHERE session_id = :session_id
              AND julianday(timestamp) >= julianday(:start) AND julianday(timestamp) < julianday(:end)
            ORDER BY timestamp, turn_index""",
        params,
    ).fetchall()
    files = connection.execute(
        """SELECT file_path, tool_name, first_seen_at FROM session_files
           WHERE session_id = :session_id
             AND julianday(first_seen_at) >= julianday(:start) AND julianday(first_seen_at) < julianday(:end)
           ORDER BY first_seen_at""",
        params,
    ).fetchall()
    commands = connection.execute(
        f"""SELECT event_type, exit_code, created_at{command_fields} FROM forge_trajectory_events
            WHERE session_id = :session_id
              AND julianday(created_at) >= julianday(:start) AND julianday(created_at) < julianday(:end)
            ORDER BY created_at, id""",
        params,
    ).fetchall()
    return messages, files, commands


def session_credit_totals(connection, session_id):
    row = connection.execute(
        """SELECT COUNT(*) AS events, COUNT(total_nano_aiu) AS credit_count,
                  SUM(total_nano_aiu) AS nano_aiu
           FROM assistant_usage_events WHERE session_id = ?""",
        (session_id,),
    ).fetchone()
    return {
        "events": row["events"],
        "credit_count": row["credit_count"],
        "credits": row["nano_aiu"] / 1_000_000_000 if row["nano_aiu"] is not None else None,
    }
