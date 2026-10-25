import React, { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const API = (import.meta.env.VITE_API_URL || "http://127.0.0.1:5000").replace(/\/$/, "");

export default function App() {
  const [file, setFile] = useState(null);
  const [samplingRate, setSamplingRate] = useState("250");
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [apiStatus, setApiStatus] = useState("Checking API…");

  useEffect(() => {
    fetch(`${API}/api/health`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => setApiStatus(data.aws_enabled ? "API connected · AWS storage enabled" : "API connected · local storage mode"))
      .catch(() => setApiStatus("API not connected — start the Flask backend"));
  }, []);

  const chartData = useMemo(() => {
    if (!result?.plot_values) return [];
    return result.plot_values.map((value, index) => ({
      time: ((index * result.plot_stride) / result.sampling_rate_hz).toFixed(3),
      amplitude: value
    }));
  }, [result]);

  async function analyzeFile(selectedFile) {
    setError("");
    setResult(null);
    if (!selectedFile) { setError("Please choose a CSV file or use Analyze demo ECG."); return; }
    const rate = Number(samplingRate);
    if (!Number.isFinite(rate) || rate < 1 || rate > 5000) {
      setError("Sampling rate must be between 1 and 5000 Hz.");
      return;
    }
    const data = new FormData();
    data.append("file", selectedFile);
    data.append("sampling_rate_hz", String(rate));
    setBusy(true);
    try {
      const response = await fetch(`${API}/api/analyze`, { method: "POST", body: data });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Analysis failed.");
      setResult(payload);
      loadHistory();
    } catch (err) {
      setError(err.message || "Could not connect to the backend.");
    } finally {
      setBusy(false);
    }
  }

  async function analyze(event) {
    event.preventDefault();
    await analyzeFile(file);
  }

  async function analyzeDemo() {
    setError("");
    setResult(null);
    try {
      const response = await fetch(`${API}/api/sample`);
      if (!response.ok) throw new Error("Could not load the demo ECG file.");
      const demoFile = new File([await response.blob()], "sample_ecg.csv", { type: "text/csv" });
      setFile(demoFile);
      await analyzeFile(demoFile);
    } catch (err) {
      setError(err.message || "Could not connect to the backend.");
    }
  }

  async function loadHistory() {
    try {
      const response = await fetch(`${API}/api/history`);
      const payload = await response.json();
      if (response.ok) setHistory(payload.items || []);
    } catch { /* history is optional */ }
  }

  useEffect(() => { loadHistory(); }, []);

  return (
    <main className="page">
      <header className="topbar">
        <div className="brand-mark">♥</div>
        <div><p className="eyebrow">CLOUD HEALTH LAB</p><h1>ECG Analysis</h1></div>
        <div className="status"><span className="status-dot" />{apiStatus}</div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">SIGNAL PROCESSING · AWS READY</p>
          <h2>Understand the signal.<br /><span>Visualize the waveform.</span></h2>
          <p className="hero-copy">Upload an ECG CSV to generate a waveform, signal statistics, and an approximate peak-based heart-rate estimate.</p>
        </div>
        <div className="pulse-card" aria-hidden="true">
          <svg viewBox="0 0 340 110" role="img">
            <path d="M0 56 H60 L78 56 L91 40 L106 76 L128 12 L151 91 L169 56 H215 L230 56 L243 43 L256 69 L270 56 H340" />
          </svg>
          <span>ECG SIGNAL</span>
        </div>
      </section>

      <section className="grid">
        <article className="panel upload-panel">
          <div className="panel-heading"><div><p className="eyebrow">STEP 01</p><h3>Upload ECG data</h3></div><span className="number">01</span></div>
          <form onSubmit={analyze}>
            <label className="dropzone">
              <span className="upload-icon">↑</span>
              <strong>{file ? file.name : "Choose your ECG CSV file"}</strong>
              <small>{file ? `${(file.size / 1024).toFixed(1)} KB selected` : "CSV format · one numeric ECG column or a column named ecg"}</small>
              <input type="file" accept=".csv,text/csv" onChange={e => setFile(e.target.files?.[0] || null)} />
            </label>
            <label className="field-label" htmlFor="sampling">Sampling rate (Hz)</label>
            <input id="sampling" className="text-input" type="number" min="1" max="5000" value={samplingRate} onChange={e => setSamplingRate(e.target.value)} required />
            <button className="primary-button" type="submit" disabled={busy}>{busy ? "Analyzing signal…" : "Analyze ECG →"}</button>
            <button className="secondary-button demo-button" type="button" onClick={analyzeDemo} disabled={busy}>{busy ? "Analyzing signal…" : "Analyze demo ECG"}</button>
          </form>
          {error && <p className="error" role="alert">{error}</p>}
          <p className="hint">Tip: the sampling rate must match the source data. The default 250 Hz is only an example.</p>
        </article>

        <article className="panel result-panel">
          <div className="panel-heading"><div><p className="eyebrow">STEP 02</p><h3>Analysis summary</h3></div><span className="number">02</span></div>
          {!result ? <div className="empty-state"><div className="empty-icon">⌁</div><strong>Your results will appear here</strong><p>Upload a CSV and run the analysis to see signal statistics.</p></div> :
            <>
              <div className="metric-grid">
                <Metric label="Estimated heart rate" value={result.estimated_heart_rate_bpm == null ? "Unavailable" : `${result.estimated_heart_rate_bpm} bpm`} />
                <Metric label="Samples" value={result.sample_count.toLocaleString()} />
                <Metric label="Duration" value={`${result.duration_seconds} s`} />
                <Metric label="Detected peaks" value={result.detected_peak_count} />
              </div>
              <div className="details">
                <span>Minimum <b>{result.min_value}</b></span><span>Maximum <b>{result.max_value}</b></span><span>Mean <b>{result.mean_value}</b></span>
              </div>
              <p className="success">Analysis ID: {result.analysis_id}<br />Storage: {result.storage_status}</p>
            </>
          }
        </article>
      </section>

      <section className="panel chart-panel">
        <div className="panel-heading"><div><p className="eyebrow">SIGNAL VIEW</p><h3>ECG waveform</h3></div>{result && <span className="chart-unit">Amplitude · seconds</span>}</div>
        {!result ? <div className="chart-empty">The ECG waveform will be plotted here after upload.</div> :
          <div className="chart"><ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 18, left: 4, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" tick={{ fontSize: 11 }} minTickGap={35} label={{ value: "Time (seconds)", position: "insideBottom", offset: -3 }} />
              <YAxis tick={{ fontSize: 11 }} width={58} />
              <Tooltip labelFormatter={v => `${v} seconds`} />
              <Line type="monotone" dataKey="amplitude" dot={false} strokeWidth={1.5} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer></div>
        }
        {result && <p className="hint">Plot is downsampled for display. Peak detection is approximate and depends on signal quality, units, and preprocessing.</p>}
      </section>

      <section className="panel history-panel">
        <div className="panel-heading"><div><p className="eyebrow">STEP 03</p><h3>Recent cloud analyses</h3></div><button className="secondary-button" onClick={loadHistory}>Refresh</button></div>
        {history.length === 0 ? <p className="hint">No cloud history available. Enable AWS storage to save metadata in DynamoDB.</p> :
          <div className="table-wrap"><table><thead><tr><th>File</th><th>Created</th><th>Samples</th><th>Estimated HR</th><th>Storage</th></tr></thead>
            <tbody>{history.map(item => <tr key={item.analysis_id}><td>{item.filename}</td><td>{item.created_at ? new Date(item.created_at).toLocaleString() : "—"}</td><td>{item.sample_count}</td><td>{item.estimated_heart_rate_bpm == null ? "—" : `${item.estimated_heart_rate_bpm} bpm`}</td><td>{item.storage_status}</td></tr>)}</tbody>
          </table></div>
        }
      </section>

      <footer><span>ECG Analysis in the Cloud</span><span>Educational prototype · Not for clinical use</span></footer>
    </main>
  );
}

function Metric({ label, value }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}
