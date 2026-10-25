import csv
import io
import json
import os
import uuid
from datetime import datetime, timezone

import boto3
import numpy as np
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from scipy.signal import find_peaks

load_dotenv()
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = int(os.getenv("MAX_UPLOAD_MB", "10")) * 1024 * 1024


def build_cors_origins():
    configured = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    origins = []
    for raw in configured.split(","):
        origin = raw.strip().rstrip("/")
        if origin and origin not in origins:
            origins.append(origin)

    for default in ("http://localhost:5173", "http://127.0.0.1:5173"):
        if default not in origins:
            origins.append(default)

    return origins


origins = build_cors_origins()
CORS(app, resources={r"/api/*": {"origins": origins}})

AWS_ENABLED = os.getenv("AWS_ENABLED", "false").lower() == "true"
AWS_REGION = os.getenv("AWS_REGION", "ap-south-1")
S3_BUCKET = os.getenv("S3_BUCKET", "")
DYNAMODB_TABLE = os.getenv("DYNAMODB_TABLE", "")
s3 = boto3.client("s3", region_name=AWS_REGION) if AWS_ENABLED else None
table = boto3.resource("dynamodb", region_name=AWS_REGION).Table(DYNAMODB_TABLE) if AWS_ENABLED and DYNAMODB_TABLE else None


def parse_ecg_csv(file_bytes):
    """Read a CSV with one ECG column or a column named ecg."""
    text = file_bytes.decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        raise ValueError("CSV file is empty.")

    # Detect whether the first row is a header.
    first = rows[0]
    header = [cell.strip().lower() for cell in first]
    has_header = any(not _is_number(cell) for cell in first)
    data_rows = rows[1:] if has_header else rows
    if not data_rows:
        raise ValueError("CSV contains no data rows.")

    selected_index = 0
    if has_header and "ecg" in header:
        selected_index = header.index("ecg")
    elif has_header:
        # Prefer a numeric column that is not explicitly named time/timestamp.
        candidates = [i for i, name in enumerate(header) if name not in ("time", "timestamp", "seconds", "sample")]
        selected_index = candidates[0] if candidates else 0

    values = []
    for row in data_rows:
        if selected_index >= len(row):
            continue
        try:
            values.append(float(row[selected_index]))
        except (ValueError, TypeError):
            continue

    signal = np.asarray(values, dtype=float)
    signal = signal[np.isfinite(signal)]
    if len(signal) < 10:
        raise ValueError("Please upload at least 10 numeric ECG samples in CSV format.")
    if len(signal) > 500000:
        raise ValueError("File contains too many samples (maximum 500,000).")
    return signal


def _is_number(value):
    try:
        float(value)
        return True
    except (TypeError, ValueError):
        return False


def _remove_none_values(payload):
    if isinstance(payload, dict):
        return {key: _remove_none_values(value) for key, value in payload.items() if value is not None}
    if isinstance(payload, list):
        return [_remove_none_values(item) for item in payload]
    return payload


def analyze_signal(signal, sampling_rate_hz):
    # Basic descriptive statistics. R-peak estimate is deliberately labelled
    # approximate and should only be trusted for suitable, preprocessed signals.
    centered = signal - np.median(signal)
    spread = float(np.percentile(centered, 95) - np.percentile(centered, 5))
    distance = max(1, int(0.25 * sampling_rate_hz))
    prominence = max(float(np.std(centered) * 0.5), 1e-9)
    peaks, _ = find_peaks(centered, distance=distance, prominence=prominence)
    duration = len(signal) / sampling_rate_hz
    heart_rate = None
    if len(peaks) >= 2 and duration > 0:
        rr = np.diff(peaks) / sampling_rate_hz
        rr = rr[(rr >= 0.25) & (rr <= 2.5)]
        if len(rr):
            heart_rate = round(float(60.0 / np.median(rr)), 1)

    # Keep graph payload small enough for the browser.
    max_points = 1500
    stride = max(1, int(np.ceil(len(signal) / max_points)))
    plot_values = signal[::stride].tolist()
    return {
        "sample_count": int(len(signal)),
        "sampling_rate_hz": float(sampling_rate_hz),
        "duration_seconds": round(float(duration), 3),
        "min_value": round(float(np.min(signal)), 6),
        "max_value": round(float(np.max(signal)), 6),
        "mean_value": round(float(np.mean(signal)), 6),
        "signal_spread_p95_p5": round(spread, 6),
        "estimated_heart_rate_bpm": heart_rate,
        "detected_peak_count": int(len(peaks)),
        "plot_values": plot_values,
        "plot_stride": stride,
        "notice": "Educational signal summary only; not a medical diagnosis. Heart-rate estimate may be inaccurate for noisy or unsuitable signals."
    }


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "aws_enabled": AWS_ENABLED})


@app.get("/api/sample")
def sample():
    sample_path = os.path.join(os.path.dirname(__file__), "sample_ecg.csv")
    return send_file(sample_path, mimetype="text/csv", download_name="sample_ecg.csv")


@app.post("/api/analyze")
def analyze():
    if "file" not in request.files:
        return jsonify({"error": "Upload a CSV file using the 'file' field."}), 400
    uploaded = request.files["file"]
    if not uploaded.filename or not uploaded.filename.lower().endswith(".csv"):
        return jsonify({"error": "Only .csv files are supported."}), 400
    try:
        fs = float(request.form.get("sampling_rate_hz", "250"))
        if not (1 <= fs <= 5000):
            raise ValueError("Sampling rate must be between 1 and 5000 Hz.")
        raw = uploaded.read()
        signal = parse_ecg_csv(raw)
        result = analyze_signal(signal, fs)
    except (ValueError, UnicodeDecodeError) as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        app.logger.exception("ECG analysis failed")
        return jsonify({"error": "Could not analyze this file. Check the CSV format and try again."}), 500

    analysis_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    safe_name = os.path.basename(uploaded.filename).replace("\\", "_").replace("/", "_")[:120]
    record = {
        "analysis_id": analysis_id,
        "filename": safe_name,
        "created_at": created_at,
        "sample_count": result["sample_count"],
        "sampling_rate_hz": result["sampling_rate_hz"],
        "duration_seconds": result["duration_seconds"],
        "estimated_heart_rate_bpm": result["estimated_heart_rate_bpm"],
        "detected_peak_count": result["detected_peak_count"],
        "storage_status": "local"
    }
    record = _remove_none_values(record)

    if AWS_ENABLED:
        if not S3_BUCKET or not table:
            return jsonify({"error": "AWS_ENABLED is true but S3_BUCKET or DYNAMODB_TABLE is missing."}), 500
        try:
            key = f"ecg-uploads/{analysis_id}/{safe_name}"
            s3.put_object(
                Bucket=S3_BUCKET,
                Key=key,
                Body=raw,
                ContentType="text/csv",
                ServerSideEncryption="AES256"
            )
            record["s3_key"] = key
            record["storage_status"] = "uploaded"
            # Store metadata only; the plotted waveform stays in the API response.
            table.put_item(Item=record)
        except Exception:
            app.logger.exception("AWS storage failed")
            return jsonify({"error": "Analysis completed but AWS storage failed. Check IAM permissions, bucket, table, and region."}), 502

    result.update({
        "analysis_id": analysis_id,
        "filename": safe_name,
        "created_at": created_at,
        "storage_status": record["storage_status"]
    })
    return jsonify(result)


@app.get("/api/history")
def history():
    if not AWS_ENABLED or not table:
        return jsonify({"items": [], "message": "History is available when AWS storage is enabled."})
    try:
        # Scan is acceptable for a small classroom demo; use a user-keyed Query
        # and pagination in a production application.
        response = table.scan(Limit=100)
        items = response.get("Items", [])
        items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return jsonify({"items": items[:50]})
    except Exception:
        app.logger.exception("History fetch failed")
        return jsonify({"error": "Could not load history."}), 502


@app.errorhandler(413)
def too_large(_error):
    return jsonify({"error": "File too large. Maximum upload size is configured in MAX_UPLOAD_MB."}), 413


if __name__ == "__main__":
    # Debug mode is for local development only. Use a production WSGI server on AWS.
    app.run(host="127.0.0.1", port=5000, debug=True)
