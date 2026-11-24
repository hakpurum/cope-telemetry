"""Interface translations; never translate recorded user data."""

import json
from pathlib import Path


ENGLISH = json.loads((Path(__file__).parent / "translations.json").read_text(encoding="utf-8"))


def translate(text, language="tr", **values):
    template = ENGLISH.get(text, text) if language == "en" else text
    return template.format(**values) if values else template
