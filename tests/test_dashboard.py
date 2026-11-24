import json
import os
import sqlite3
import unittest
from contextlib import closing
from unittest.mock import patch

from dashboard import app
from dashboard_data import aggregate, efficiency_data
from telemetry import open_database
from tests import test_telemetry


class DashboardTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_telemetry.TelemetryTests("test_read_only")
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.client = app.test_client()
        self.database = patch("dashboard_data.open_database", lambda: open_database(self.fixture.path))
        self.database.start()
        self.addCleanup(self.database.stop)
        self.query = "source=live&start=2026-01-01&end=2026-01-01"

    def test_pages_and_assets(self):
        for page in ("overview", "usage", "performance", "sessions", "activity", "agents", "efficiency"):
            response = self.client.get(f"/{page}")
            self.assertEqual(response.status_code, 200)
            self.assertIn(f"/static/css/{page}.css".encode(), response.data)
            self.assertIn(f"/static/js/{page}.js".encode(), response.data)
            with closing(self.client.get(f"/static/js/{page}.js")) as js:
                self.assertEqual(js.mimetype, "text/javascript")
            with closing(self.client.get(f"/static/css/{page}.css")) as css:
                self.assertEqual(css.mimetype, "text/css")
        self.assertEqual(self.client.get("/not-a-page").status_code, 404)

    def test_branding_and_logo_are_consistent(self):
        response = self.client.get("/efficiency")
        html = response.get_data(as_text=True)
        self.assertIn("<title>Efficiency Analysis · Cope Telemetry</title>", html)
        self.assertIn('aria-label="Cope Telemetry — Overview"', html)
        self.assertIn("COPE TELEMETRY", html)
        self.assertIn('rel="icon" type="image/svg+xml" href="/static/cope-mark.svg"', html)
        self.assertIn('class="brand-mark" src="/static/cope-mark.svg"', html)
        with closing(self.client.get("/static/cope-mark.svg")) as logo:
            self.assertEqual(logo.status_code, 200)
            self.assertEqual(logo.mimetype, "image/svg+xml")

    def test_language_cookie_translates_pages_and_api_errors(self):
        headings = {
            "overview": "Overview", "usage": "Usage", "agents": "Agents",
            "performance": "Performance", "efficiency": "Efficiency Analysis",
            "sessions": "Sessions", "activity": "Activity",
        }
        for page, title in headings.items():
            html = self.client.get(f"/{page}").get_data(as_text=True)
            self.assertIn('<html lang="en">', html)
            self.assertIn(f"<h1>{title}</h1>", html)
            self.assertIn(f"<title>{title} · Cope Telemetry</title>", html)
            self.assertIn('option value="en" selected', html)
        error = self.client.get("/api/data?source=invalid").get_json()
        self.assertEqual(error["error"], "Invalid data source.")
        error = self.client.get("/api/data?start=2026-02-01&end=2026-01-01").get_json()
        self.assertEqual(error["error"], "The start date cannot be after the end date.")
        self.assertIn("Invalid date:", self.client.get("/api/data?start=bad").get_json()["error"])
        with patch("dashboard_data.open_database", side_effect=sqlite3.OperationalError("details")), self.assertLogs(app.logger, level="ERROR"):
            response = self.client.get(f"/api/data?{self.query}")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"], "The local database could not be read: details")
        self.client.set_cookie("cope-language", "tr")
        html = self.client.get("/efficiency").get_data(as_text=True)
        self.assertIn('<html lang="tr">', html)
        self.assertIn("<h1>Verimlilik Analizi</h1>", html)
        self.assertIn('option value="tr" selected', html)
        self.assertEqual(self.client.get("/api/data?source=invalid").get_json()["error"], "Geçersiz veri kaynağı.")
        self.client.set_cookie("cope-language", "unsupported")
        self.assertIn('<html lang="en">', self.client.get("/").get_data(as_text=True))

    def test_english_translates_generated_metadata_not_recorded_names(self):
        with closing(sqlite3.connect(self.fixture.path)) as writer, writer:
            writer.execute("ALTER TABLE assistant_usage_events ADD COLUMN agent_id TEXT")
            writer.execute("UPDATE assistant_usage_events SET agent_id='agent-a' WHERE session_id='s1'")
        folder = self.fixture.path.parent / "session-state" / "s1"
        folder.mkdir(parents=True)
        event = {"type": "subagent.completed", "agentId": "agent-a",
                 "data": {"agentDisplayName": "Tamamlandı"}}
        (folder / "events.jsonl").write_text(json.dumps(event) + "\n{invalid}\n", encoding="utf-8")
        self.client.set_cookie("cope-language", "en")
        with patch("agent_metadata.database_path", return_value=self.fixture.path):
            info = self.client.get(f"/api/data?{self.query}&page=agents").get_json()["agents"]
        row = next(row for row in info["agents"] if row["session_id"] == "s1")
        self.assertEqual(row["name"], "Tamamlandı")
        self.assertEqual(row["status"], "Completed")
        self.assertIn("invalid or incomplete event lines", info["warnings"][0])
        demo = self.client.get("/api/data?source=demo&page=agents").get_json()
        self.assertEqual(demo["agents"]["agents"][0]["name"], "Demo research agent")
        shown = self.client.get(f"/api/session/s1?{self.query}&content=1").get_json()
        self.assertEqual(shown["messages"][0]["user_message"], "private prompt")

    def test_live_default_and_demo_is_not_real(self):
        live = self.client.get("/api/data?start=2026-01-01&end=2026-01-01").get_json()
        self.assertEqual(live["source"], "live")
        data = self.client.get("/api/data?source=demo&page=usage").get_json()
        self.assertEqual(data["source"], "demo")
        self.assertTrue(data["events"])
        self.assertTrue(all(row["session_id"].startswith("demo-") for row in data["events"]))

    def test_live_filters_and_aggregates(self):
        response = self.client.get(f"/api/data?{self.query}&repo=repo1&model=model-a&page=usage")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["source"], "live")
        self.assertEqual(data["totals"]["events"], 2)
        self.assertEqual(data["totals"]["input"], 30)
        self.assertEqual(data["totals"]["duration_avg"], 150)
        self.assertEqual(data["totals"]["ttft_count"], 1)
        self.assertEqual(data["totals"]["aiu"], 1)
        self.assertEqual(data["totals"]["aiu_count"], 1)
        self.assertEqual(len(data["sessions"]), 1)
        self.assertNotIn("user_message", response.get_data(as_text=True))

    def test_performance_model_credits_include_coverage_and_missing_values(self):
        with closing(sqlite3.connect(self.fixture.path)) as writer, writer:
            writer.executemany(
                "INSERT INTO assistant_usage_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    ("s1", "model-zero", "2026-01-01T10:00:00Z", 1, 1, 0, 0, 0, 100, 10),
                    ("s1", "model-missing", "2026-01-01T10:00:00Z", 1, 1, 0, 0, None, 100, 10),
                ],
            )
        response = self.client.get(f"/api/data?{self.query}&repo=repo1&page=performance")
        models = {row["model"]: row for row in response.get_json()["models"]}
        self.assertEqual((models["model-a"]["credits"], models["model-a"]["credit_count"], models["model-a"]["events"]), (1, 1, 2))
        self.assertEqual((models["model-zero"]["credits"], models["model-zero"]["credit_count"]), (0, 1))
        self.assertEqual((models["model-missing"]["credits"], models["model-missing"]["credit_count"]), (None, 0))

    def test_daily_credits_keep_partial_missing_and_zero_distinct(self):
        base = {"model": "m", "input_tokens": None, "output_tokens": None, "cache_read_tokens": None,
                "cache_write_tokens": None, "reasoning_tokens": None, "duration_ms": None,
                "time_to_first_token_ms": None, "finish_reason": None}
        events = [
            {**base, "created_at": day, "total_nano_aiu": nano}
            for day, nano in (("2026-01-01", 100000000), ("2026-01-01", None),
                              ("2026-01-02", None), ("2026-01-03", 0))
        ]
        with patch("dashboard_data.local_day", side_effect=lambda timestamp: timestamp):
            daily = aggregate(events)[2]
        self.assertEqual(
            [(row["credits"], row["credit_count"], row["events"]) for row in daily],
            [(0.1, 1, 2), (None, 0, 1), (0, 1, 1)],
        )

    def test_private_content_requires_explicit_request(self):
        url = f"/api/session/s1?{self.query}"
        hidden = self.client.get(url).get_json()
        self.assertNotIn("user_message", hidden["messages"][0])
        self.assertNotIn("command", hidden["commands"][0])
        shown = self.client.get(url + "&content=1").get_json()
        self.assertEqual(shown["messages"][0]["user_message"], "private prompt")
        self.assertEqual(shown["commands"][0]["command"], "private command")
        response = self.client.get(f"/api/data?{self.query}&page=activity")
        self.assertNotIn("private", response.get_data(as_text=True))
        self.assertEqual(len(response.get_json()["activity"]["files"]), 2)

    def test_session_credits_include_full_history_and_preserve_filtered_totals(self):
        response = self.client.get(f"/api/session/s1?{self.query}&model=model-a")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["session_credits"], {
            "events": 3, "credit_count": 2, "credits": 1,
        })
        filtered = self.client.get(f"/api/data?{self.query}&session=s1&model=model-a").get_json()
        self.assertEqual(filtered["totals"]["events"], 2)
        self.assertEqual(filtered["totals"]["aiu_count"], 1)
        self.assertEqual(filtered["totals"]["aiu"], 1)
        with closing(sqlite3.connect(self.fixture.path)) as writer, writer:
            writer.execute("UPDATE assistant_usage_events SET total_nano_aiu = NULL WHERE session_id = 's1'")
        missing = self.client.get(f"/api/session/s1?{self.query}").get_json()["session_credits"]
        self.assertEqual(missing, {"events": 3, "credit_count": 0, "credits": None})

    def test_invalid_filters_and_database_failures_are_explicit(self):
        self.assertEqual(self.client.get("/api/data?source=other").status_code, 400)
        self.assertEqual(self.client.get("/api/data?start=2026-01-02&end=2026-01-01").status_code, 400)
        self.assertEqual(self.client.get("/api/data?start=2026-01-01&end=9999-12-31").status_code, 400)
        self.assertEqual(self.client.get("/api/session/s1?" + self.query + "&repo=repo2").status_code, 404)
        self.assertEqual(self.client.get("/api/data", headers={"Host": "example.com"}).status_code, 403)
        with patch("dashboard_data.open_database", lambda: open_database(self.fixture.path.parent / "missing.db")):
            with self.assertLogs("dashboard", level="ERROR"):
                response = self.client.get(f"/api/data?{self.query}")
        self.assertEqual(response.status_code, 503)
        self.assertIn("error", response.get_json())

    def test_live_refresh_reads_new_wal_data(self):
        url = f"/api/data?{self.query}&session=s1"
        self.assertEqual(self.client.get(url).get_json()["totals"]["events"], 2)
        with closing(sqlite3.connect(self.fixture.path)) as writer, writer:
            writer.execute(
                "INSERT INTO assistant_usage_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ("s1", "model-a", "2026-01-01T12:00:00Z", 5, 1, 0, 0, 0, 50, 5),
            )
        self.assertEqual(self.client.get(url).get_json()["totals"]["events"], 3)

    def test_live_api_discovers_custom_copilot_home(self):
        destination = self.fixture.path.parent / "session-store.db"
        with closing(sqlite3.connect(self.fixture.path)) as source, closing(sqlite3.connect(destination)) as target:
            source.backup(target)
        with patch("dashboard_data.open_database", open_database), patch.dict(
            os.environ, {"COPILOT_HOME": str(self.fixture.path.parent)}
        ):
            response = self.client.get(f"/api/data?{self.query}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["totals"]["events"], 3)

    def test_missing_values_do_not_become_zero(self):
        row = {"model": "m", "created_at": "2026-01-01T10:00:00Z", "input_tokens": None,
               "output_tokens": None, "cache_read_tokens": None, "cache_write_tokens": None,
               "reasoning_tokens": None, "total_nano_aiu": None, "duration_ms": None,
               "time_to_first_token_ms": None, "finish_reason": None}
        totals, _, _, _ = aggregate([row])
        self.assertIsNone(totals["input"])
        self.assertIsNone(totals["aiu"])
        self.assertIsNone(totals["ttft_avg"])
        self.assertEqual(totals["ttft_count"], 0)

    def test_local_workspace_without_repository_is_filterable(self):
        with closing(sqlite3.connect(self.fixture.path)) as writer, writer:
            writer.execute(
                "INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?)",
                ("local", None, None, "2026-01-01T10:00:00Z", "2026-01-01T10:00:00Z", "local workspace"),
            )
            writer.execute(
                "INSERT INTO assistant_usage_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ("local", "model-a", "2026-01-01T10:00:00Z", 7, 3, 0, 0, 2000000000, 100, 10),
            )
        response = self.client.get("/api/data", query_string={
            "source": "live", "start": "2026-01-01", "end": "2026-01-01",
            "workspace": "local workspace", "page": "usage",
        })
        data = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(data["sessions"][0]["cwd"], "local workspace")
        self.assertIsNone(data["sessions"][0]["repository"])
        self.assertIn("local workspace", data["options"]["workspaces"])
        self.assertEqual(data["totals"]["input"], 7)
        self.assertEqual(data["totals"]["aiu"], 2)
        self.assertEqual(data["models"][0]["credits"], 2)

    def test_agent_names_credit_attribution_and_missing_measurements(self):
        with closing(sqlite3.connect(self.fixture.path)) as writer, writer:
            writer.execute("ALTER TABLE assistant_usage_events ADD COLUMN agent_id TEXT")
            writer.execute("UPDATE assistant_usage_events SET agent_id='agent-a' WHERE session_id='s1' AND input_tokens=10")
            writer.execute("UPDATE assistant_usage_events SET agent_id='agent-b' WHERE session_id='s1' AND input_tokens=20")
            writer.execute("UPDATE assistant_usage_events SET agent_id='agent-a' WHERE session_id='s2'")
        folder = self.fixture.path.parent / "session-state" / "s1"
        folder.mkdir(parents=True)
        log = folder / "events.jsonl"
        entries = [
            {"type": "subagent.started", "agentId": "agent-a", "timestamp": "2026-01-01T10:00:00Z",
             "data": {"agentDisplayName": "Research", "agentDescription": "private task"}},
            {"type": "subagent.started", "agentId": "no-usage", "timestamp": "2026-01-01T10:00:00Z",
             "data": {"agentName": "Unused", "model": "model-a"}},
            {"type": "user.message", "data": {"content": "private message"}},
        ]
        log.write_text("".join(json.dumps(entry) + "\n" for entry in entries) + "{invalid}\n", encoding="utf-8")
        with patch("agent_metadata.database_path", return_value=self.fixture.path):
            response = self.client.get(f"/api/data?{self.query}&page=agents")
            info = response.get_json()["agents"]
            rows = {(row["session_id"], row["agent_id"]): row for row in info["agents"]}
            self.assertEqual(rows[("s1", "agent-a")]["name"], "Research")
            self.assertEqual(rows[("s1", "agent-a")]["credits"], 1)
            self.assertEqual(rows[("s1", "agent-a")]["cache_write"], 1)
            self.assertIsNone(rows[("s1", "agent-a")]["reasoning"])
            self.assertIsNone(rows[("s1", "agent-b")]["credits"])
            self.assertIsNone(rows[("s1", "agent-b")]["name"])
            self.assertIsNone(rows[("s1", "no-usage")]["credits"])
            self.assertEqual(rows[("s1", "no-usage")]["events"], 0)
            self.assertIn(("s2", "agent-a"), rows)
            self.assertEqual(info["identified_events"], 3)
            self.assertEqual(info["identified_credits"]["credit_count"], 2)
            self.assertEqual(info["missing_logs"], 1)
            self.assertTrue(info["warnings"])
            self.assertNotIn("private", response.get_data(as_text=True))
            with log.open("a", encoding="utf-8") as file:
                file.write(json.dumps({"type": "subagent.completed", "agentId": "agent-a",
                                       "data": {"agentDisplayName": "Research"}}) + "\n")
            updated = self.client.get(f"/api/data?{self.query}&page=agents").get_json()
            agent = next(row for row in updated["agents"]["agents"] if row["session_id"] == "s1" and row["agent_id"] == "agent-a")
            self.assertEqual(agent["status"], "Completed")

    def test_selection_without_agent_id_is_not_a_corrupt_event(self):
        folder = self.fixture.path.parent / "session-state" / "s1"
        folder.mkdir(parents=True)
        event = {"type": "subagent.selected", "data": {"agentName": "Research"}}
        (folder / "events.jsonl").write_text(json.dumps(event) + "\n", encoding="utf-8")
        with patch("agent_metadata.database_path", return_value=self.fixture.path):
            info = self.client.get(f"/api/data?{self.query}&page=agents").get_json()["agents"]
        self.assertEqual(info["warnings"], [])

    def test_efficiency_keeps_missing_credit_and_agent_attribution_separate(self):
        sessions = [{"id": "s1", "repository": "repo", "cwd": "folder"},
                    {"id": "s2", "repository": None, "cwd": "local"}]
        base = {"created_at": "2026-01-01T10:00:00Z", "model": "m", "duration_ms": 100}
        events = [
            {**base, "session_id": "s1", "agent_id": "a", "total_nano_aiu": 500000000,
             "input_tokens": 10, "cache_read_tokens": 4},
            {**base, "session_id": "s1", "agent_id": "a", "total_nano_aiu": None,
             "input_tokens": 20, "cache_read_tokens": None},
            {**base, "session_id": "s2", "agent_id": None, "total_nano_aiu": 0,
             "input_tokens": 10, "cache_read_tokens": 11},
        ]
        result = efficiency_data(events, sessions, {("s1", "a"): {"name": "Research"}}, 0, [])
        self.assertEqual((result["credit_count"], result["total_events"], result["identified_events"]), (2, 3, 2))
        agent = result["agents"][0]
        self.assertEqual((agent["label"], agent["credits"], agent["credit_count"], agent["events"]),
                         ("Research", 0.5, 1, 2))
        self.assertEqual((agent["measured_runs"], agent["credits_per_run"]), (1, 0.5))
        self.assertEqual((result["cache"]["ratio"], result["cache"]["count"]), (40, 1))
        self.assertEqual({row["label"]: row["credits"] for row in result["projects"]},
                         {"Repo · repo": 0.5, "Klasör · local": 0})
        self.assertEqual(len(result["pairs"]), 1)
        self.assertEqual(result["pairs"][0]["model"], "m")

    def test_efficiency_compares_equal_periods_with_same_filters(self):
        query = {"source": "live", "page": "efficiency", "start": "2026-01-02", "end": "2026-01-02",
                 "repo": "repo1", "model": "model-a"}
        response = self.client.get("/api/data", query_string=query)
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        previous = data["efficiency"]["previous"]
        self.assertEqual((previous["start"], previous["end"]), ("2026-01-01", "2026-01-01"))
        self.assertEqual((previous["totals"]["events"], previous["totals"]["aiu"]), (2, 1))
        self.assertEqual(data["totals"]["events"], 0)
        self.assertIsNone(data["totals"]["aiu"])
        self.assertNotIn("private", response.get_data(as_text=True))

    def test_efficiency_missing_values_do_not_become_zero(self):
        event = {"session_id": "s1", "agent_id": "a", "model": "m",
                 "created_at": "2026-01-01T10:00:00Z", "total_nano_aiu": None,
                 "input_tokens": None, "cache_read_tokens": None, "duration_ms": None}
        result = efficiency_data([event], [{"id": "s1", "repository": None, "cwd": None}], {}, 1, [])
        self.assertIsNone(result["agents"][0]["credits"])
        self.assertIsNone(result["agents"][0]["credits_per_run"])
        self.assertIsNone(result["cache"]["ratio"])
        self.assertIsNone(result["projects"][0]["duration_total"])
        self.assertEqual(result["missing_logs"], 1)


if __name__ == "__main__":
    unittest.main()
