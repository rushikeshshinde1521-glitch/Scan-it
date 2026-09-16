#!/usr/bin/env python3
"""
GM Scan Pro - duplicate-check server (sample implementation).

What this is
------------
A tiny server your IT team can run on the company network. The GM Scan Pro
app (index.html) sends every scanned label's trace codes here, and this
server answers which ones were already seen - so two phones on the shopfloor
can't scan the same label twice.

How to run it (test)
--------------------
    pip install flask
    python server.py
    # then open http://localhost:5000/api/health in a browser

What IT needs to change (2 spots, marked TODO below)
----------------------------------------------------
  TODO 1: check the API key (or plug in your own auth)
  TODO 2: replace the in-memory SEEN_TRACES set with a real database query

The app expects exactly this contract:

  POST /api/duplicates/check
    Request:  {"traces": ["TABC...", "TDEF..."], "device": "dev-xyz", "duns": "12V606038362"}
    Response: {"duplicates": ["TABC..."]}     <- only the ones already seen

  GET /api/health
    Response: {"ok": true, "service": "gm-scan-pro-duplicates", "version": "1.0"}

  POST /api/scan   (optional logging hook - the app already sends every scan here)
    Request:  {"device": ..., "result": "PASS"/"FAIL", "fa_trace": ..., "sa_trace": ..., ...}
    Response: {"ok": true}

Security notes for IT
---------------------
- Put this behind HTTPS on the company network. The app is served over HTTPS
  (GitHub Pages), and browsers BLOCK plain-http:// calls from https pages.
- CORS headers are already included below (Access-Control-Allow-Origin: *).
  For production, restrict this to the app's origin instead of "*".
- For production use, run behind gunicorn/nginx instead of app.run().
"""

from flask import Flask, request, jsonify

app = Flask(__name__)

# ---------------------------------------------------------------------------
# TODO 1: API key. This must match the "API key" field in the app's Settings.
# Set to "" to disable key checking (not recommended on a shared network).
# ---------------------------------------------------------------------------
API_KEY = "change-me-to-a-long-random-key"

# ---------------------------------------------------------------------------
# TODO 2: demo store. Replace with your real trace-code database.
# Example with SQLite:
#   import sqlite3
#   def already_seen(traces):
#       con = sqlite3.connect("/data/traces.db")
#       q = "SELECT trace_code FROM scans WHERE trace_code IN (%s)" % \
#           ",".join("?" for _ in traces)
#       rows = con.execute(q, traces).fetchall()
#       con.close()
#       return [r[0] for r in rows]
# ---------------------------------------------------------------------------
SEEN_TRACES = {
    # "TEXAMPLETRACE0001": "2026-09-15T08:00:00",  # trace_code -> first seen timestamp
}


def already_seen(traces):
    """Return the subset of traces already recorded. Swap in real DB here."""
    return [t for t in traces if t in SEEN_TRACES]


@app.after_request
def add_cors(resp):
    # Lets the app (served from GitHub Pages / installed PWA) call this server.
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-API-Key"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return resp


def authorized():
    if not API_KEY:
        return True
    return request.headers.get("X-API-Key") == API_KEY


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify(ok=True, service="gm-scan-pro-duplicates", version="1.0")


@app.route("/api/duplicates/check", methods=["POST", "OPTIONS"])
def duplicates_check():
    if request.method == "OPTIONS":
        return ("", 204)
    if not authorized():
        return jsonify(error="unauthorized: bad or missing X-API-Key"), 401
    data = request.get_json(force=True, silent=True) or {}
    traces = [str(t) for t in (data.get("traces") or []) if t]
    return jsonify(duplicates=already_seen(traces))


@app.route("/api/scan", methods=["POST", "OPTIONS"])
def scan_log():
    """Optional: the app POSTs every validated scan here (pass or fail)."""
    if request.method == "OPTIONS":
        return ("", 204)
    if not authorized():
        return jsonify(error="unauthorized: bad or missing X-API-Key"), 401
    data = request.get_json(force=True, silent=True) or {}
    # Index this scan's trace codes so OTHER devices flag them as duplicates.
    # Only index clean passes? Uncomment the next line to do that:
    # if data.get("result") != "PASS": return jsonify(ok=True)
    for key in ("fa_trace", "sa_trace"):
        t = data.get(key)
        if t:
            SEEN_TRACES.setdefault(str(t), data.get("timestamp", ""))
    return jsonify(ok=True)


if __name__ == "__main__":
    # 0.0.0.0 = reachable from other machines/phones on the network
    app.run(host="0.0.0.0", port=5000)
