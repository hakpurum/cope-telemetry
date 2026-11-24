"""Dashboard data sources and calculations; no database writes."""

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from math import ceil

from agent_metadata import load_agent_metadata
from localization import translate
from telemetry import details, open_database, options, session_credit_totals, sessions, usage, workspaces


def local_day(value):
    timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    return timestamp.astimezone().date().isoformat()


def sum_field(rows, name):
    values = [row[name] for row in rows if row.get(name) is not None]
    return sum(values) if values else None


def average(rows, name):
    values = [row[name] for row in rows if row.get(name) is not None]
    return sum(values) / len(values) if values else None


def percentile(rows, name, fraction):
    values = sorted(row[name] for row in rows if row.get(name) is not None)
    return values[max(0, ceil(len(values) * fraction) - 1)] if values else None


def credit_fields(rows):
    nano_aiu = sum_field(rows, "total_nano_aiu")
    return {
        "credits": nano_aiu / 1_000_000_000 if nano_aiu is not None else None,
        "credit_count": sum(row.get("total_nano_aiu") is not None for row in rows),
    }


def aggregate(events):
    groups = defaultdict(list)
    days = defaultdict(list)
    for row in events:
        groups[row["model"]].append(row)
        days[local_day(row["created_at"])].append(row)
    totals = {
        "events": len(events),
        "input": sum_field(events, "input_tokens"),
        "output": sum_field(events, "output_tokens"),
        "cache_read": sum_field(events, "cache_read_tokens"),
        "cache_write": sum_field(events, "cache_write_tokens"),
        "reasoning": sum_field(events, "reasoning_tokens"),
        "aiu": None,
        "duration_avg": average(events, "duration_ms"),
        "duration_p95": percentile(events, "duration_ms", .95),
        "ttft_avg": average(events, "time_to_first_token_ms"),
        "ttft_p95": percentile(events, "time_to_first_token_ms", .95),
        "duration_count": sum(row["duration_ms"] is not None for row in events),
        "ttft_count": sum(row["time_to_first_token_ms"] is not None for row in events),
        "aiu_count": sum(row["total_nano_aiu"] is not None for row in events),
    }
    for field in ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "reasoning_tokens"):
        totals[f"{field}_count"] = sum(row[field] is not None for row in events)
    nano_aiu = sum_field(events, "total_nano_aiu")
    if nano_aiu is not None:
        totals["aiu"] = nano_aiu / 1_000_000_000
    by_model = [
        {"model": name, "events": len(rows), "input": sum_field(rows, "input_tokens"),
         "output": sum_field(rows, "output_tokens"), "duration_avg": average(rows, "duration_ms"),
         "duration_count": sum(row["duration_ms"] is not None for row in rows),
         "ttft_avg": average(rows, "time_to_first_token_ms"),
         "ttft_count": sum(row["time_to_first_token_ms"] is not None for row in rows),
         **credit_fields(rows)}
        for name, rows in groups.items()
    ]
    by_model.sort(key=lambda item: (-item["events"], item["model"] or ""))
    daily = [
        {"day": day, "input": sum_field(rows, "input_tokens"), "output": sum_field(rows, "output_tokens"),
         "duration": average(rows, "duration_ms"), "ttft": average(rows, "time_to_first_token_ms"),
         "events": len(rows), **credit_fields(rows)}
        for day, rows in sorted(days.items())
    ]
    finish = Counter(row["finish_reason"] for row in events if row.get("finish_reason"))
    return totals, by_model, daily, [{"name": k, "count": v} for k, v in finish.most_common()]


def demo_records(language="tr"):
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    session_rows, events, messages, files, commands = [], [], [], [], []
    for i in range(12):
        created = (now - timedelta(days=i)).isoformat()
        sid = f"demo-session-{i + 1:02}"
        repo = "demo/atlas" if i % 2 == 0 else None
        session_rows.append({"id": sid, "repository": repo, "cwd": f"/demo/workspace-{i % 3 + 1}",
                             "branch": "main" if repo else None,
                             "created_at": created, "updated_at": created})
        messages.append({"session_id": sid, "turn_index": 1, "timestamp": created,
                         "user_message": translate("Örnek kullanıcı mesajı.", language), "assistant_response": translate("Örnek asistan yanıtı.", language)})
        files.append({"session_id": sid, "file_path": "demo/example.py", "tool_name": "edit", "first_seen_at": created})
        if i % 3 == 0:
            commands.append({"session_id": sid, "id": i, "event_type": "command", "exit_code": 0,
                             "created_at": created, "command": "demo-command", "output": translate("Örnek çıktı", language)})
        for j in range(3 + i % 3):
            events.append({
                "id": i * 10 + j, "session_id": sid, "turn_index": j + 1, "created_at": created,
                "model": ("demo-model-a", "demo-model-b", "demo-model-c")[(i + j) % 3],
                "input_tokens": 2100 + i * 120 + j * 340, "output_tokens": 320 + j * 90,
                "cache_read_tokens": 1100 + j * 120, "cache_write_tokens": 180 + j * 20,
                "reasoning_tokens": 100 + j * 20, "total_nano_aiu": 120000000 + i * 1000000,
                "duration_ms": 1800 + i * 100 + j * 150, "time_to_first_token_ms": 250 + i * 20,
                "inter_token_latency_ms": 20 + j, "finish_reason": "stop", "initiator": "demo",
                "content_filter_triggered": 0, "agent_id": f"demo-agent-{i:02}" if j else None,
            })
    return session_rows, events, messages, files, commands


def in_range(value, start, end):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(start) <= parsed < datetime.fromisoformat(end)


def activity_rows(connection, selected, start, end):
    result = {"messages": [], "files": [], "commands": []}
    definitions = (
        ("messages", "turns", "timestamp", "session_id, turn_index, timestamp"),
        ("files", "session_files", "first_seen_at", "session_id, file_path, tool_name, first_seen_at"),
        ("commands", "forge_trajectory_events", "created_at", "session_id, event_type, exit_code, created_at"),
    )
    for offset in range(0, len(selected), 500):
        ids = selected[offset:offset + 500]
        markers = ",".join("?" for _ in ids)
        for key, table, time_field, columns in definitions:
            query = (f"SELECT {columns} FROM {table} WHERE session_id IN ({markers}) "
                     f"AND julianday({time_field}) >= julianday(?) AND julianday({time_field}) < julianday(?)")
            result[key].extend(dict(row) for row in connection.execute(query, [*ids, start, end]))
    for key, field in (("messages", "timestamp"), ("files", "first_seen_at"), ("commands", "created_at")):
        result[key].sort(key=lambda row: row[field] or "", reverse=True)
    return result


def agent_usage(events, metadata, start, end, model=None, language="tr"):
    groups = defaultdict(list)
    for row in events:
        if row.get("agent_id"):
            groups[(row["session_id"], row["agent_id"])].append(row)
    errors = []
    for key, agent in metadata.items():
        if key in groups or not agent.get("started_at") or (model and agent.get("model") != model):
            continue
        try:
            if in_range(agent["started_at"], start, end):
                groups[key] = []
        except ValueError:
            errors.append(translate("{session}: agent başlangıç zamanı geçersiz.", language, session=key[0]))
    rows = []
    for (session_id, agent_id), records in groups.items():
        agent = metadata.get((session_id, agent_id), {})
        rows.append({
            "session_id": session_id, "agent_id": agent_id, "name": agent.get("name"),
            "started_at": agent.get("started_at"), "status": agent.get("status"),
            "models": sorted({row["model"] for row in records if row.get("model")}),
            "events": len(records), "input": sum_field(records, "input_tokens"),
            "output": sum_field(records, "output_tokens"),
            "cache_read": sum_field(records, "cache_read_tokens"),
            "cache_write": sum_field(records, "cache_write_tokens"),
            "reasoning": sum_field(records, "reasoning_tokens"),
            **credit_fields(records),
        })
    rows.sort(key=lambda row: (row["started_at"] or "", row["session_id"], row["agent_id"]), reverse=True)
    identified = [row for row in events if row.get("agent_id")]
    unidentified = [row for row in events if not row.get("agent_id")]
    return {"agents": rows, "identified_events": len(identified), "unidentified_events": len(unidentified),
            "identified_credits": credit_fields(identified), "unidentified_credits": credit_fields(unidentified),
            "warnings": errors}


def efficiency_data(events, session_rows, metadata, missing, warnings, language="tr"):
    models, agents, projects, pairs, days = (defaultdict(list) for _ in range(5))
    sessions_by_id = {row["id"]: row for row in session_rows}
    for row in events:
        model = row.get("model") or translate("Model bilinmiyor", language)
        session = sessions_by_id[row["session_id"]]
        project = (f"Repo · {session['repository']}" if session.get("repository")
                   else f"{translate('Klasör', language)} · {session['cwd']}" if session.get("cwd") else translate("Proje bilinmiyor", language))
        models[model].append(row)
        projects[project].append(row)
        days[local_day(row["created_at"])].append(row)
        if row.get("agent_id"):
            key = (row["session_id"], row["agent_id"])
            name = metadata.get(key, {}).get("name")
            agent = name or f"{translate('İsimsiz agent', language)} · {key[1]} · {key[0]}"
            agents[agent].append(row)
            pairs[(agent, model)].append(row)

    def summarize(label, records):
        credits = credit_fields(records)
        duration_count = sum(row.get("duration_ms") is not None for row in records)
        measured_runs = {(row["session_id"], row.get("agent_id")) for row in records
                         if row.get("agent_id") and row.get("total_nano_aiu") is not None}
        return {
            "label": label, "events": len(records), **credits,
            "credits_per_event": credits["credits"] / credits["credit_count"] if credits["credit_count"] else None,
            "measured_runs": len(measured_runs),
            "credits_per_run": credits["credits"] / len(measured_runs) if measured_runs else None,
            "duration_avg": average(records, "duration_ms"),
            "duration_total": sum_field(records, "duration_ms"), "duration_count": duration_count,
        }

    def summaries(groups):
        return sorted((summarize(label, records) for label, records in groups.items()),
                      key=lambda row: (-(row["credits"] if row["credits"] is not None else -1), row["label"]))

    def cache_ratio(records):
        paired = [row for row in records if row.get("input_tokens") is not None
                  and row.get("cache_read_tokens") is not None and row["input_tokens"] > 0
                  and 0 <= row["cache_read_tokens"] <= row["input_tokens"]]
        inputs = sum(row["input_tokens"] for row in paired)
        return {"ratio": 100 * sum(row["cache_read_tokens"] for row in paired) / inputs if inputs else None,
                "count": len(paired), "events": len(records)}

    daily = []
    for day, records in sorted(days.items()):
        daily.append({"day": day, **credit_fields(records), "events": len(records), **{
            f"cache_{key}": value for key, value in cache_ratio(records).items()
        }})
    return {
        "models": summaries(models), "agents": summaries(agents), "projects": summaries(projects),
        "pairs": [{**summarize(agent, records), "model": model}
                  for (agent, model), records in sorted(pairs.items())],
        "daily": daily, "cache": cache_ratio(events),
        "identified_events": sum(bool(row.get("agent_id")) for row in events),
        "total_events": len(events),
        "credit_count": sum(row.get("total_nano_aiu") is not None for row in events),
        "duration_count": sum(row.get("duration_ms") is not None for row in events),
        "missing_logs": missing, "warnings": warnings,
    }


def snapshot(source, start, end, repo=None, model=None, session_id=None, workspace=None, page=None, language="tr"):
    if source == "demo":
        all_sessions, all_events, messages, files, commands = demo_records(language)
        repos = sorted({row["repository"] for row in all_sessions if row["repository"]})
        paths = sorted({row["cwd"] for row in all_sessions})
        models = sorted({row["model"] for row in all_events})
        filtered_events = [row for row in all_events if in_range(row["created_at"], start, end)
                           and (not model or row["model"] == model)]
        matching = {row["session_id"] for row in filtered_events}
        filtered_sessions = [row for row in all_sessions if in_range(row["created_at"], start, end)
                             and (not repo or row["repository"] == repo)
                             and (not workspace or row["cwd"] == workspace)
                             and (not model or row["id"] in matching)]
        ids = {row["id"] for row in filtered_sessions if not session_id or row["id"] == session_id}
        selected_events = [row for row in filtered_events if row["session_id"] in ids]
        activity = {}
        if page == "activity":
            activity = {
                "messages": [{k: v for k, v in row.items() if k not in ("user_message", "assistant_response")}
                             for row in messages if row["session_id"] in ids and in_range(row["timestamp"], start, end)],
                "files": [row for row in files if row["session_id"] in ids and in_range(row["first_seen_at"], start, end)],
                "commands": [{k: v for k, v in row.items() if k not in ("command", "output")}
                             for row in commands if row["session_id"] in ids and in_range(row["created_at"], start, end)],
            }
    else:
        with open_database() as connection:
            repos, models = options(connection)
            paths = workspaces(connection)
            filtered_sessions = [dict(row) for row in sessions(connection, start, end, repo, model, workspace)]
            ids = {row["id"] for row in filtered_sessions if not session_id or row["id"] == session_id}
            selected_events = [dict(row) for row in usage(connection, start, end, repo, model, session_id, extended=True, workspace=workspace)
                               if row["session_id"] in ids]
            activity = activity_rows(connection, sorted(ids), start, end) if page == "activity" else {}
    selected_sessions = [row for row in filtered_sessions if row["id"] in ids]
    selected_events.sort(key=lambda row: row["created_at"] or "", reverse=True)
    totals, by_model, daily, finish = aggregate(selected_events)
    agents = None
    if page in ("agents", "efficiency"):
        if source == "demo":
            metadata = {
                (row["session_id"], row["agent_id"]): {
                    "name": translate("Demo araştırma agentı", language), "started_at": row["created_at"],
                    "model": row["model"], "status": translate("Tamamlandı", language)
                }
                for row in selected_events if row.get("agent_id")
            }
            missing, warnings = 0, []
        else:
            metadata, missing, warnings = load_agent_metadata(sorted(ids), language)
        if page == "agents":
            agents = agent_usage(selected_events, metadata, start, end, model, language)
            agents["missing_logs"] = missing
            agents["warnings"].extend(warnings)
    efficiency = (efficiency_data(selected_events, selected_sessions, metadata, missing, warnings, language)
                  if page == "efficiency" else None)
    result = {"source": source, "options": {"repos": repos, "models": models, "workspaces": paths, "sessions": filtered_sessions},
            "sessions": selected_sessions, "events": selected_events if page == "usage" else [], "totals": totals,
            "models": by_model, "daily": daily, "finish": finish, "activity": activity, "agents": agents}
    if page == "efficiency":
        result["efficiency"] = efficiency
    return result


def session_details(source, session_id, start, end, repo=None, model=None, workspace=None, include_content=False, language="tr"):
    if source == "demo":
        data = snapshot(source, start, end, repo, model, session_id, workspace)
        if not data["sessions"]:
            return None
        _, events, messages, files, commands = demo_records(language)
        session_events = [row for row in events if row["session_id"] == session_id]
        credits = {"events": len(session_events), **credit_fields(session_events)}
        messages = [row for row in messages if row["session_id"] == session_id and in_range(row["timestamp"], start, end)]
        files = [row for row in files if row["session_id"] == session_id and in_range(row["first_seen_at"], start, end)]
        commands = [row for row in commands if row["session_id"] == session_id and in_range(row["created_at"], start, end)]
        if not include_content:
            messages = [{k: v for k, v in row.items() if k not in ("user_message", "assistant_response")} for row in messages]
            commands = [{k: v for k, v in row.items() if k not in ("command", "output")} for row in commands]
    else:
        with open_database() as connection:
            if not any(row["id"] == session_id for row in sessions(connection, start, end, repo, model, workspace)):
                return None
            messages, files, commands = (
                [dict(row) for row in rows] for rows in details(connection, session_id, start, end, include_content)
            )
            credits = session_credit_totals(connection, session_id)
    return {"messages": messages, "files": files, "commands": commands, "content": include_content,
            "session_credits": credits}
