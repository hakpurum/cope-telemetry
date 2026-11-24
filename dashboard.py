"""Local Flask telemetry dashboard."""

import sqlite3
from datetime import date, timedelta
from functools import wraps

from flask import Flask, abort, jsonify, render_template, request

from dashboard_data import session_details, snapshot
from localization import ENGLISH, translate
from telemetry import utc_bounds


PAGES = {
    "overview": "Genel bakış",
    "usage": "Kullanım",
    "performance": "Performans",
    "sessions": "Oturumlar",
    "activity": "Etkinlik",
    "agents": "Agentlar",
    "efficiency": "Verimlilik Analizi",
}

app = Flask(__name__)


def language():
    return "tr" if request.cookies.get("cope-language") == "tr" else "en"


@app.context_processor
def localization_context():
    return {"language": language(), "translations": ENGLISH,
            "_": lambda text: translate(text, language())}


@app.before_request
def local_host_only():
    if request.host.split(":", 1)[0].lower() not in ("127.0.0.1", "localhost"):
        abort(403)


@app.after_request
def prevent_caching(response):
    if request.path.startswith("/static/js/") and request.path.endswith(".js"):
        response.mimetype = "text/javascript"
    elif request.path.startswith("/static/css/") and request.path.endswith(".css"):
        response.mimetype = "text/css"
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def api_errors(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        try:
            return function(*args, **kwargs)
        except ValueError as error:
            return jsonify(error=translate(str(error), language())), 400
        except (sqlite3.Error, OSError) as error:
            app.logger.exception("SQLite read failed")
            return jsonify(error=translate("Yerel veritabanı okunamadı: {error}", language(), error=error)), 503
    return wrapped


def filters():
    source = request.args.get("source", "live")
    if source not in ("demo", "live"):
        raise ValueError("Geçersiz veri kaynağı.")
    today = date.today()
    try:
        start = date.fromisoformat(request.args.get("start", (today - timedelta(days=6)).isoformat()))
        end = date.fromisoformat(request.args.get("end", today.isoformat()))
    except ValueError as error:
        raise ValueError(f"{translate('Geçersiz tarih', language())}: {error}") from error
    start_utc, end_utc = utc_bounds(start, end)
    return {
        "source": source, "start": start_utc, "end": end_utc,
        "repo": request.args.get("repo") or None, "model": request.args.get("model") or None,
        "workspace": request.args.get("workspace") or None,
        "session_id": request.args.get("session") or None,
    }


@app.get("/")
def home():
    return page_view("overview")


@app.get("/<page>")
def page_view(page):
    if page not in PAGES:
        abort(404)
    return render_template(f"{page}.html", page=page, page_title=PAGES[page])


@app.get("/api/data")
@api_errors
def data():
    page = request.args.get("page", "overview")
    if page not in PAGES:
        raise ValueError("Geçersiz sayfa.")
    args = filters()
    result = snapshot(**args, page=page, language=language())
    if page == "efficiency":
        today = date.today()
        start = date.fromisoformat(request.args.get("start", (today - timedelta(days=6)).isoformat()))
        end = date.fromisoformat(request.args.get("end", today.isoformat()))
        try:
            previous_end = start - timedelta(days=1)
            previous_start = previous_end - (end - start)
        except OverflowError:
            result["efficiency"]["previous"] = None
        else:
            previous_start_utc, previous_end_utc = utc_bounds(previous_start, previous_end)
            previous_args = {**args, "start": previous_start_utc, "end": previous_end_utc}
            previous = snapshot(**previous_args)
            result["efficiency"]["previous"] = {
                "start": previous_start.isoformat(), "end": previous_end.isoformat(),
                "totals": previous["totals"],
            }
    return jsonify(result)


@app.get("/api/session/<session_id>")
@api_errors
def session(session_id):
    args = filters()
    args["session_id"] = session_id
    result = session_details(**args, include_content=request.args.get("content") == "1", language=language())
    if result is None:
        return jsonify(error=translate("Oturum seçili filtrelerde bulunamadı.", language())), 404
    return jsonify(result)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
