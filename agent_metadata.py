"""Read agent identity and lifecycle metadata from local session event logs."""

import json
import re
from functools import lru_cache
from pathlib import Path

from telemetry import database_path
from localization import translate


@lru_cache(maxsize=256)
def _read_events(path: str, modified_ns: int, size: int):
    agents = {}
    invalid = 0
    with open(path, encoding="utf-8-sig") as source:
        for line in source:
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                invalid += 1
                continue
            if not isinstance(event, dict) or event.get("type") not in (
                "subagent.started", "subagent.selected", "subagent.completed", "subagent.failed"
            ):
                continue
            agent_id = event.get("agentId")
            data = event.get("data")
            if event["type"] == "subagent.selected" and not agent_id:
                continue
            if not isinstance(agent_id, str) or not agent_id or not isinstance(data, dict):
                invalid += 1
                continue
            agent = agents.setdefault(agent_id, {"id": agent_id, "name": None, "model": None,
                                                  "started_at": None, "status": None})
            name = data.get("agentDisplayName") or data.get("agentName")
            if isinstance(name, str) and name:
                agent["name"] = name
            if isinstance(data.get("model"), str):
                agent["model"] = data["model"]
            if event["type"] == "subagent.started":
                if isinstance(event.get("timestamp"), str) and agent["started_at"] is None:
                    agent["started_at"] = event["timestamp"]
                agent["status"] = "Çalışıyor"
            elif event["type"] == "subagent.completed":
                agent["status"] = "Tamamlandı"
            elif event["type"] == "subagent.failed":
                agent["status"] = "Başarısız"
    return agents, invalid


def load_agent_metadata(session_ids, language="tr"):
    root = (database_path().parent / "session-state").resolve()
    result = {}
    missing = 0
    errors = []
    for session_id in session_ids:
        if not isinstance(session_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", session_id):
            errors.append(translate("Geçersiz oturum kimliği nedeniyle agent kaydı okunamadı.", language))
            continue
        path = (root / session_id / "events.jsonl").resolve()
        if not path.is_relative_to(root):
            errors.append(translate("Agent kayıt yolu oturum klasörünün dışında.", language))
            continue
        try:
            stat = path.stat()
            agents, invalid = _read_events(str(path), stat.st_mtime_ns, stat.st_size)
        except FileNotFoundError:
            missing += 1
            continue
        except (OSError, UnicodeError) as error:
            errors.append(translate("{session} agent kayıtları okunamadı: {error}", language, session=session_id, error=error))
            continue
        if invalid:
            errors.append(translate("{session}: {count} geçersiz veya eksik olay satırı okunamadı.", language, session=session_id, count=invalid))
        for agent_id, agent in agents.items():
            result[(session_id, agent_id)] = {**agent, "status": translate(agent["status"], language) if agent["status"] else None}
    return result, missing, errors
