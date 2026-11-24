import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import date, datetime, time, timezone
from pathlib import Path
from unittest.mock import patch

from telemetry import database_path, details, open_database, options, sessions, usage, utc_bounds


class TelemetryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "store.db"
        with closing(sqlite3.connect(self.path)) as connection, connection:
            connection.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE sessions (id TEXT PRIMARY KEY, repository TEXT, branch TEXT, created_at TEXT, updated_at TEXT, cwd TEXT);
                CREATE TABLE assistant_usage_events (
                    session_id TEXT, model TEXT, created_at TEXT, input_tokens INTEGER,
                    output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER,
                    total_nano_aiu INTEGER, duration_ms INTEGER, time_to_first_token_ms INTEGER
                );
                CREATE TABLE turns (session_id TEXT, turn_index INTEGER, timestamp TEXT, user_message TEXT, assistant_response TEXT);
                CREATE TABLE session_files (session_id TEXT, file_path TEXT, tool_name TEXT, first_seen_at TEXT);
                CREATE TABLE forge_trajectory_events (
                    id INTEGER PRIMARY KEY, session_id TEXT, event_type TEXT, exit_code INTEGER,
                    created_at TEXT, command TEXT, output TEXT
                );
                INSERT INTO sessions (id, repository, branch, created_at, updated_at) VALUES
                    ('s1', 'repo1', 'main', '2026-01-01T10:00:00Z', '2026-01-01T10:00:00Z'),
                    ('s2', 'repo2', 'main', '2026-01-01T10:00:00Z', '2026-01-01T10:00:00Z');
                INSERT INTO assistant_usage_events VALUES
                    ('s1', 'model-a', '2026-01-01T10:00:00Z', 10, 2, 4, 1, 1000000000, 100, NULL),
                    ('s1', 'model-a', '2026-01-01T11:00:00Z', 20, 3, 5, 2, NULL, 200, 20),
                    ('s1', 'model-b', '2026-01-02T00:00:00Z', 100, 4, 0, 0, 0, 300, 30),
                    ('s2', 'model-a', '2026-01-01T10:00:00Z', 50, 5, 0, 0, 0, 400, 40);
                INSERT INTO turns VALUES ('s1', 1, '2026-01-01T10:00:00Z', 'private prompt', 'private response');
                INSERT INTO session_files VALUES
                    ('s1', 'first.py', 'edit', '2026-01-01T10:00:00Z'),
                    ('s1', 'second.py', 'edit', '2026-01-01T11:00:00Z');
                INSERT INTO forge_trajectory_events VALUES
                    (1, 's1', 'command', 0, '2026-01-01T10:00:00Z', 'private command', 'private output');
                """
            )
        self.start = "2026-01-01T00:00:00+00:00"
        self.end = "2026-01-02T00:00:00+00:00"

    def tearDown(self):
        self.temp.cleanup()

    def test_read_only(self):
        with open_database(self.path) as connection:
            with self.assertRaises(sqlite3.OperationalError):
                connection.execute("DELETE FROM sessions")
        with closing(sqlite3.connect(self.path)) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 2)

    def test_missing_database_does_not_create_file(self):
        missing = Path(self.temp.name) / "missing.db"
        with self.assertRaises(sqlite3.OperationalError):
            with open_database(missing):
                pass
        self.assertFalse(missing.exists())

    def test_default_database_follows_user_home(self):
        with patch.dict(os.environ, {"COPILOT_HOME": ""}), patch("telemetry.Path.home", return_value=self.path.parent):
            self.assertEqual(database_path(), self.path.parent / ".copilot" / "session-store.db")

    def test_copilot_home_override_is_used_read_only(self):
        custom_home = self.path.parent / "Copilot home # %"
        custom_home.mkdir()
        custom_database = custom_home / "session-store.db"
        with closing(sqlite3.connect(custom_database)) as connection, connection:
            connection.execute("CREATE TABLE sample (value TEXT)")
            connection.execute("INSERT INTO sample VALUES ('custom')")
        with patch.dict(os.environ, {"COPILOT_HOME": str(custom_home)}):
            self.assertEqual(database_path(), custom_database)
            with open_database() as connection:
                self.assertEqual(connection.execute("SELECT value FROM sample").fetchone()[0], "custom")
                with self.assertRaises(sqlite3.OperationalError):
                    connection.execute("DELETE FROM sample")

    def test_missing_override_is_reported_without_fallback(self):
        custom_home = self.path.parent / "missing copilot home"
        with patch.dict(os.environ, {"COPILOT_HOME": str(custom_home)}):
            with self.assertRaises(sqlite3.OperationalError) as error:
                with open_database():
                    pass
        self.assertIn(str(custom_home), str(error.exception))
        self.assertFalse(custom_home.exists())

    def test_usage_filters_and_does_not_multiply_events(self):
        with open_database(self.path) as connection:
            repos, models = options(connection)
            self.assertEqual(repos, ["repo1", "repo2"])
            self.assertEqual(models, ["model-a", "model-b"])
            rows = usage(connection, self.start, self.end, "repo1", "model-a", "s1")
            self.assertEqual(len(rows), 2)
            self.assertEqual(sum(row["input_tokens"] for row in rows), 30)
            self.assertIsNone(rows[0]["time_to_first_token_ms"])
            self.assertIsNone(rows[1]["total_nano_aiu"])
            self.assertEqual(usage(connection, self.start, self.end, model="model-b"), [])
            self.assertEqual(
                [row["id"] for row in sessions(connection, self.start, self.end, model="model-a")],
                ["s1", "s2"],
            )
            self.assertEqual(sessions(connection, self.start, self.end, model="model-b"), [])

    def test_details_content_is_explicit_and_date_bounded(self):
        with open_database(self.path) as connection:
            messages, files, commands = details(connection, "s1", self.start, self.end)
            self.assertNotIn("user_message", messages[0].keys())
            self.assertEqual(len(files), 2)
            self.assertNotIn("command", commands[0].keys())
            messages, _, _ = details(connection, "s1", self.start, self.end, True)
            self.assertEqual(messages[0]["user_message"], "private prompt")
            _, _, commands = details(connection, "s1", self.start, self.end, True)
            self.assertEqual(commands[0]["output"], "private output")
            messages, files, commands = details(connection, "s1", self.end, "2026-01-03T00:00:00Z", True)
            self.assertEqual((messages, files, commands), ([], [], []))

    def test_utc_bounds_use_local_midnights(self):
        start, end = utc_bounds(date(2026, 1, 1), date(2026, 1, 2))
        expected_start = datetime.combine(date(2026, 1, 1), time.min).astimezone(timezone.utc)
        expected_end = datetime.combine(date(2026, 1, 3), time.min).astimezone(timezone.utc)
        self.assertEqual(datetime.fromisoformat(start), expected_start)
        self.assertEqual(datetime.fromisoformat(end), expected_end)
        with self.assertRaises(ValueError):
            utc_bounds(date(2026, 1, 2), date(2026, 1, 1))

if __name__ == "__main__":
    unittest.main()
