import { useEffect, useRef, useState } from "react";
import {
  CircleStop,
  Download,
  Gauge,
  Mic,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Trash2,
  Volume2,
} from "lucide-react";
import { api, Card, Heading, Modal, State, useApp, useData } from "./lib";
import type { Row } from "../shared/core";

export const RECORDING_MAX_BYTES = 45_000_000;
export const RECORDING_MAX_SECONDS = 3_000;
export const RECORDING_BITRATE = 96_000;

type Format = { mime: string; contentType: string; codec: string; ext: string };
const FORMATS: Format[] = [
  {
    mime: "audio/webm;codecs=opus",
    contentType: "audio/webm",
    codec: "opus",
    ext: "webm",
  },
  {
    mime: "audio/ogg;codecs=opus",
    contentType: "audio/ogg",
    codec: "opus",
    ext: "ogg",
  },
  {
    mime: "audio/mp4;codecs=mp4a.40.2",
    contentType: "audio/mp4",
    codec: "aac",
    ext: "mp4",
  },
];

export function supportedRecordingFormat(
  supported = (mime: string) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime),
) {
  return FORMATS.find((format) => supported(format.mime)) || null;
}
export function estimatedRecordingBytes(seconds: number) {
  return Math.ceil((Math.max(0, seconds) * RECORDING_BITRATE) / 8);
}
function formatTime(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [hours, minutes, rest]
    .filter((_part, index) => hours > 0 || index > 0)
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}
function formatBytes(value = 0) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}
function recorderConstraints(
  deviceId: string,
  noiseSuppression: boolean,
  autoGainControl: boolean,
  echoCancellation: boolean,
): MediaTrackConstraints {
  return {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 48_000 },
    noiseSuppression: { ideal: noiseSuppression },
    autoGainControl: { ideal: autoGainControl },
    echoCancellation: { ideal: echoCancellation },
  };
}

async function uploadRecording(
  app: any,
  blob: Blob,
  row: Row,
  onProgress: (percent: number) => void,
) {
  const session = await app.client.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw Error("Your session expired. Sign in again.");
  const tus = await import("tus-js-client");
  return new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(blob, {
      endpoint: `${app.config.supabaseUrl}/storage/v1/upload/resumable`,
      retryDelays: [0, 1_000, 3_000, 5_000, 10_000],
      chunkSize: 6 * 1024 * 1024,
      uploadSize: blob.size,
      removeFingerprintOnSuccess: true,
      headers: {
        authorization: `Bearer ${token}`,
        apikey: app.config.publishableKey,
        "x-upsert": "false",
      },
      metadata: {
        bucketName: "call-recordings",
        objectName: row.object_key,
        contentType: row.mime_type,
        cacheControl: "0",
      },
      onError: (error) => reject(error),
      onProgress: (uploaded, total) =>
        onProgress(total ? Math.round((uploaded / total) * 100) : 0),
      onSuccess: () => resolve(),
    });
    upload
      .findPreviousUploads()
      .then((previous) => {
        if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      })
      .catch(reject);
  });
}

function InputMeter({ level }: { level: number }) {
  return (
    <div className="input-meter" aria-label={`Microphone level ${Math.round(level * 100)} percent`}>
      <span style={{ width: `${Math.max(2, level * 100)}%` }} />
    </div>
  );
}

function Recorder({ onSaved }: { onSaved: () => void }) {
  const app = useApp();
  const options = useData("/report?kind=recording_options");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState(
    () => localStorage.getItem("pixelalty-recording-microphone") || "",
  );
  const [permission, setPermission] = useState<"unknown" | "ready" | "denied">("unknown");
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [autoGainControl, setAutoGainControl] = useState(true);
  const [echoCancellation, setEchoCancellation] = useState(false);
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<"idle" | "recording" | "paused" | "review" | "saving">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [testUrl, setTestUrl] = useState("");
  const [format, setFormat] = useState<Format | null>(null);
  const [recordedAt, setRecordedAt] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [callId, setCallId] = useState("");
  const [dealId, setDealId] = useState("");
  const [markers, setMarkers] = useState<Array<{ at: number; label: string }>>([]);
  const [progress, setProgress] = useState(0);
  const [requestId, setRequestId] = useState(crypto.randomUUID());
  const [reservationId, setReservationId] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const seconds = useRef(0);
  const animation = useRef(0);
  const audioContext = useRef<AudioContext | null>(null);

  const releaseStream = () => {
    cancelAnimationFrame(animation.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    void audioContext.current?.close();
    audioContext.current = null;
    setLevel(0);
  };
  const attachMeter = (input: MediaStream) => {
    const Context = window.AudioContext || (window as any).webkitAudioContext;
    if (!Context) return;
    const context = new Context({ sampleRate: 48_000 });
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    context.createMediaStreamSource(input).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const update = () => {
      analyser.getByteFrequencyData(data);
      const average = data.reduce((sum, item) => sum + item, 0) / data.length;
      setLevel(Math.min(1, average / 96));
      animation.current = requestAnimationFrame(update);
    };
    audioContext.current = context;
    update();
  };
  const getStream = async () => {
    if (!navigator.mediaDevices?.getUserMedia)
      throw Error("Microphone recording is not supported in this browser.");
    const next = await navigator.mediaDevices.getUserMedia({
      audio: recorderConstraints(
        deviceId,
        noiseSuppression,
        autoGainControl,
        echoCancellation,
      ),
    });
    stream.current = next;
    attachMeter(next);
    return next;
  };
  const refreshDevices = async () => {
    setError("");
    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      permissionStream.getTracks().forEach((track) => track.stop());
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(
        (device) => device.kind === "audioinput",
      );
      setDevices(inputs);
      const remembered = inputs.find((device) => device.deviceId === deviceId);
      const selected = remembered?.deviceId || inputs[0]?.deviceId || "";
      setDeviceId(selected);
      if (selected) localStorage.setItem("pixelalty-recording-microphone", selected);
      setPermission("ready");
      if (!inputs.length) setError("No microphone was found. Connect one, then refresh microphones.");
    } catch (cause) {
      setPermission("denied");
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Microphone access is blocked. Allow microphone access in your browser settings, then refresh microphones."
          : "The microphone could not be opened. Check the device and browser permission, then retry.",
      );
    }
  };
  const testMicrophone = async () => {
    setError("");
    setNotice("Recording a private three-second microphone test. It will not be uploaded.");
    if (testUrl) URL.revokeObjectURL(testUrl);
    try {
      const selectedFormat = supportedRecordingFormat();
      if (!selectedFormat) throw Error("This browser does not support a compatible audio format.");
      const input = await getStream();
      const parts: Blob[] = [];
      const test = new MediaRecorder(input, {
        mimeType: selectedFormat.mime,
        audioBitsPerSecond: RECORDING_BITRATE,
      });
      test.ondataavailable = (event) => event.data.size && parts.push(event.data);
      await new Promise<void>((resolve, reject) => {
        test.onerror = () => reject(Error("The microphone test failed."));
        test.onstop = () => resolve();
        test.start(500);
        window.setTimeout(() => test.stop(), 3_000);
      });
      const clip = new Blob(parts, { type: selectedFormat.mime });
      if (!clip.size) throw Error("The microphone test was empty. Choose another microphone.");
      setTestUrl(URL.createObjectURL(clip));
      setNotice("Microphone test complete. Play it below; this clip stays on this device and is never uploaded.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The microphone test failed.");
    } finally {
      releaseStream();
    }
  };
  const start = async () => {
    setError("");
    setNotice("");
    if (!consent) return setError("Confirm consent and applicable recording laws before starting.");
    const selectedFormat = supportedRecordingFormat();
    if (!selectedFormat) return setError("This browser does not support a compatible Opus or AAC recording format.");
    try {
      const input = await getStream();
      const next = new MediaRecorder(input, {
        mimeType: selectedFormat.mime,
        audioBitsPerSecond: RECORDING_BITRATE,
      });
      chunks.current = [];
      seconds.current = 0;
      setElapsed(0);
      setBytes(0);
      setMarkers([]);
      setBlob(null);
      setFormat(selectedFormat);
      setRecordedAt(new Date().toISOString());
      next.ondataavailable = (event) => {
        if (!event.data.size) return;
        chunks.current.push(event.data);
        const total = chunks.current.reduce((sum, item) => sum + item.size, 0);
        setBytes(total);
        if (total >= RECORDING_MAX_BYTES && next.state !== "inactive") {
          setNotice("The 45 MB safety limit was reached, so recording stopped before an oversized upload could occur.");
          next.stop();
        }
      };
      next.onerror = () => {
        setError("Recording stopped because the microphone became unavailable. Any captured audio is kept for review.");
        if (next.state !== "inactive") next.stop();
      };
      next.onstop = () => {
        const complete = new Blob(chunks.current, { type: selectedFormat.mime });
        releaseStream();
        if (!complete.size || seconds.current < 0.25) {
          setStatus("idle");
          setError("The recording was empty. Check the microphone and try again.");
          return;
        }
        const url = URL.createObjectURL(complete);
        setBlob(complete);
        setPreviewUrl(url);
        setBytes(complete.size);
        setStatus("review");
      };
      recorder.current = next;
      next.start(1_000);
      setStatus("recording");
    } catch (cause) {
      releaseStream();
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Microphone access is blocked. Allow it in browser settings and try again."
          : cause instanceof Error
            ? cause.message
            : "Recording could not start.",
      );
    }
  };
  const stop = () => {
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  };
  const discard = async () => {
    try {
      if (reservationId)
        await api("/recordings/delete", { id: reservationId, confirmed: true });
    } catch (cause) {
      return setError(cause instanceof Error ? cause.message : "The saved upload could not be discarded.");
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setBlob(null);
    setPreviewUrl("");
    setReservationId("");
    setRequestId(crypto.randomUUID());
    setProgress(0);
    setStatus("idle");
    setTitle("");
    setNote("");
    setMarkers([]);
  };
  const save = async () => {
    if (!blob || !format || blob.size < 1) return setError("There is no recording to save.");
    if (blob.size > RECORDING_MAX_BYTES) return setError("This recording exceeds the 45 MB upload limit.");
    setStatus("saving");
    setError("");
    try {
      const reservation = await api("/action", {
        action: "recording_begin",
        p: {
          request_id: requestId,
          business_id: businessId || null,
          call_id: callId || null,
          deal_id: dealId || null,
          title,
          note,
          markers,
          mime_type: format.contentType,
          codec: `${format.codec} · 96 kbps mono`,
          size_bytes: blob.size,
          duration_seconds: Math.max(0.25, elapsed),
          device_label: devices.find((device) => device.deviceId === deviceId)?.label || "Selected microphone",
          recorded_at: recordedAt,
        },
      });
      setReservationId(reservation.id);
      if (reservation.status !== "ready") {
        await uploadRecording(app, blob, reservation, setProgress);
        await api("/action", { action: "recording_finalize", p: { id: reservation.id } });
      }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setBlob(null);
      setPreviewUrl("");
      setReservationId("");
      setRequestId(crypto.randomUUID());
      setProgress(0);
      setStatus("idle");
      setConsent(false);
      setTitle("");
      setNote("");
      setMarkers([]);
      app.notify("Recording saved privately.");
      app.refresh();
      onSaved();
    } catch (cause) {
      setStatus("review");
      setError(
        `The upload was not completed. Your audio is still here—use Retry save. ${cause instanceof Error ? cause.message : ""}`.trim(),
      );
    }
  };

  useEffect(() => {
    if (permission === "unknown") void refreshDevices();
  }, []);
  useEffect(() => {
    if (!deviceId) return;
    localStorage.setItem("pixelalty-recording-microphone", deviceId);
  }, [deviceId]);
  useEffect(() => {
    if (status !== "recording") return;
    const timer = window.setInterval(() => {
      seconds.current = Math.min(RECORDING_MAX_SECONDS, seconds.current + 0.25);
      setElapsed(seconds.current);
      if (seconds.current >= 2_700 && seconds.current < 2_701)
        setNotice("Five minutes remain before the visible 50-minute safety limit.");
      if (seconds.current >= RECORDING_MAX_SECONDS) {
        setNotice("The stated 50-minute safety limit was reached, so recording stopped.");
        stop();
      }
    }, 250);
    return () => clearInterval(timer);
  }, [status]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!["recording", "paused", "review", "saving"].includes(status)) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status]);
  useEffect(
    () => () => {
      releaseStream();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (testUrl) URL.revokeObjectURL(testUrl);
    },
    [previewUrl, testUrl],
  );

  return (
    <Card className="recorder-card" title="Record room audio">
      <div className="notice recording-honesty">
        <Mic size={18} aria-hidden="true" />
        <span>
          This records sound heard by the selected microphone. Put your phone on speaker near the microphone. Remote speech capture depends on room, speaker, and microphone quality and is not guaranteed.
        </span>
      </div>
      <p className="fine-print">
        Before recording, tell everyone and obtain any consent required by the laws and policies that apply to the call. Recording never starts automatically.
      </p>
      <div className="recorder-settings">
        <label>
          Microphone
          <select value={deviceId} onChange={(event) => setDeviceId(event.target.value)} disabled={status !== "idle"}>
            {!devices.length && <option value="">No microphone available</option>}
            {devices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${index + 1}`}
              </option>
            ))}
          </select>
        </label>
        <div className="button-row">
          <button onClick={() => void refreshDevices()} disabled={!['idle','review'].includes(status)}>
            <RefreshCw size={15} /> Refresh microphones
          </button>
          <button onClick={() => void testMicrophone()} disabled={status !== "idle" || permission === "denied"}>
            <Volume2 size={15} /> Test microphone
          </button>
        </div>
      </div>
      <InputMeter level={level} />
      {testUrl && <audio className="test-audio" controls src={testUrl} aria-label="Local microphone test playback" />}
      <div className="recorder-toggles" aria-label="Microphone processing">
        <label><input type="checkbox" checked={noiseSuppression} onChange={(e) => setNoiseSuppression(e.target.checked)} disabled={status !== "idle"} /> Noise suppression</label>
        <label><input type="checkbox" checked={autoGainControl} onChange={(e) => setAutoGainControl(e.target.checked)} disabled={status !== "idle"} /> Automatic gain</label>
        <label><input type="checkbox" checked={echoCancellation} onChange={(e) => setEchoCancellation(e.target.checked)} disabled={status !== "idle"} /> Echo cancellation</label>
      </div>
      {status === "idle" && (
        <>
          <label className="consent-check">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            I have informed everyone and obtained any consent required to record this call.
          </label>
          <button className="primary" disabled={!consent || !deviceId} onClick={() => void start()}>
            <Mic size={16} /> Start recording
          </button>
        </>
      )}
      {["recording", "paused"].includes(status) && (
        <div className="recording-live" aria-live="polite">
          <div>
            <span className="recording-dot" /> <strong>{status === "paused" ? "Paused" : "Recording"}</strong>
            <span className="recording-timer">{formatTime(elapsed)}</span>
          </div>
          <p>
            {devices.find((device) => device.deviceId === deviceId)?.label || "Selected microphone"} · estimated {formatBytes(Math.max(bytes, estimatedRecordingBytes(elapsed)))} · limit 50:00 / 45 MB
          </p>
          <div className="button-row">
            {status === "recording" ? (
              <button onClick={() => { recorder.current?.pause(); setStatus("paused"); }}><Pause size={16} /> Pause</button>
            ) : (
              <button onClick={() => { recorder.current?.resume(); setStatus("recording"); }}><Play size={16} /> Resume</button>
            )}
            <button onClick={() => setMarkers((current) => [...current, { at: Number(elapsed.toFixed(2)), label: `Marker ${current.length + 1}` }])}>Add marker</button>
            <button className="danger" onClick={stop}><CircleStop size={16} /> Stop</button>
          </div>
        </div>
      )}
      {["review", "saving"].includes(status) && blob && format && (
        <div className="recording-review">
          <h3>Review before saving</h3>
          <div className="recording-summary">
            <span>{formatTime(elapsed)}</span><span>{formatBytes(blob.size)}</span><span>{format.codec.toUpperCase()} · 96 kbps mono</span><span>{new Date(recordedAt).toLocaleString()}</span>
          </div>
          <audio controls src={previewUrl} aria-label="Unsaved recording playback" />
          <div className="form-grid">
            <label>Title (optional)<input maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label>Business (optional)<select value={businessId} onChange={(e) => setBusinessId(e.target.value)}><option value="">Not attached</option>{options.data?.businesses?.map((r: Row) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
            <label>Call (optional)<select value={callId} onChange={(e) => setCallId(e.target.value)}><option value="">Not attached</option>{options.data?.calls?.filter((r: Row) => !businessId || r.business_id === businessId).map((r: Row) => <option key={r.id} value={r.id}>{r.business_name} · {new Date(r.created_at).toLocaleString()}</option>)}</select></label>
            <label>Deal (optional)<select value={dealId} onChange={(e) => setDealId(e.target.value)}><option value="">Not attached</option>{options.data?.deals?.filter((r: Row) => !businessId || r.business_id === businessId).map((r: Row) => <option key={r.id} value={r.id}>{r.business_name} · {r.package_name}</option>)}</select></label>
          </div>
          <label>Private note (optional)<textarea maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          {!!markers.length && <p className="fine-print">Markers: {markers.map((marker) => `${formatTime(marker.at)} ${marker.label}`).join(" · ")}</p>}
          {status === "saving" && <div className="upload-progress"><progress value={progress} max={100} /><span>{progress}% uploaded</span></div>}
          <div className="button-row">
            <button className="primary" disabled={status === "saving"} onClick={() => void save()}><Save size={16} /> {reservationId ? "Retry save" : "Save privately"}</button>
            <button disabled={status === "saving"} onClick={() => void discard()}><Trash2 size={16} /> Discard</button>
          </div>
        </div>
      )}
      {notice && <div className="notice" role="status">{notice}</div>}
      {error && <div className="notice error" role="alert">{error}</div>}
    </Card>
  );
}

function RecordingPlayer({ row }: { row: Row }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  const open = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api("/recordings/url", { id: row.id, download: false });
      setUrl(result.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Playback could not be opened.");
    } finally {
      setLoading(false);
    }
  };
  const download = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api("/recordings/url", { id: row.id, download: true });
      const response = await fetch(result.url);
      if (!response.ok) throw Error("Download failed.");
      const object = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = object;
      link.download = `pixelalty-call-${new Date(row.recorded_at).toISOString().slice(0, 10)}.${row.mime_type === "audio/ogg" ? "ogg" : row.mime_type === "audio/mp4" ? "mp4" : "webm"}`;
      link.click();
      URL.revokeObjectURL(object);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Download failed.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="recording-player">
      {!url ? <button onClick={() => void open()} disabled={loading}><Play size={15} /> {loading ? "Opening…" : "Play"}</button> : (
        <>
          <audio ref={audio} controls src={url} preload="metadata" aria-label={`Recording ${row.title || row.business_name || "playback"}`} />
          <div className="player-tools">
            <button aria-label="Back 10 seconds" onClick={() => audio.current && (audio.current.currentTime = Math.max(0, audio.current.currentTime - 10))}><RotateCcw size={15} /> 10s</button>
            <button aria-label="Forward 10 seconds" onClick={() => audio.current && (audio.current.currentTime = Math.min(audio.current.duration || Infinity, audio.current.currentTime + 10))}><RotateCw size={15} /> 10s</button>
            <label>Speed <select defaultValue="1" onChange={(e) => audio.current && (audio.current.playbackRate = Number(e.target.value))}>{[0.75,1,1.25,1.5,2].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}</select></label>
          </div>
        </>
      )}
      <button onClick={() => void download()} disabled={loading}><Download size={15} /> Download</button>
      {error && <div className="notice error" role="alert">{error}</div>}
    </div>
  );
}

function Usage({ usage, admin }: { usage: Row; admin: boolean }) {
  const warning = Number(usage?.warning || 0);
  return (
    <Card className={`recording-usage ${warning ? "warning" : ""}`}>
      <div className="card-head"><div><span className="eyebrow">PRIVATE RECORDING STORAGE</span><h2>{formatBytes(usage?.bytes)} of {formatBytes(usage?.quota_bytes)}</h2></div><Gauge size={22} /></div>
      <progress value={Number(usage?.bytes || 0)} max={Number(usage?.quota_bytes || 1)} />
      <p>{usage?.count || 0} saved recordings · {usage?.percent || 0}% used. Per recording: up to {formatTime(usage?.max_seconds || RECORDING_MAX_SECONDS)} and {formatBytes(usage?.max_bytes || RECORDING_MAX_BYTES)}.</p>
      {warning > 0 && <div className="notice error" role="alert">Storage has reached the {warning}% warning threshold. {admin ? "Review recordings before the quota is full. Nothing is deleted automatically." : "Ask Pixelalty Support to review storage before saving more calls."}</div>}
    </Card>
  );
}

function QuotaSettings({ usage, onSaved }: { usage: Row; onSaved: () => void }) {
  const app = useApp();
  const [megabytes, setMegabytes] = useState(Math.round(Number(usage?.quota_bytes || 900_000_000) / 1_000_000));
  useEffect(() => setMegabytes(Math.round(Number(usage?.quota_bytes || 900_000_000) / 1_000_000)), [usage?.quota_bytes]);
  return (
    <Card title="Recording quota">
      <p>Set the application ceiling below the 1 GB project allowance. Pixelalty never deletes recordings automatically.</p>
      <div className="quota-form">
        <label>Total quota (MB)<input type="number" min={100} max={950} step={10} value={megabytes} onChange={(event) => setMegabytes(Number(event.target.value))} /></label>
        <button className="primary" disabled={megabytes < 100 || megabytes > 950 || megabytes * 1_000_000 < Number(usage?.bytes || 0)} onClick={() => app.run(async () => { await app.mutate("recording_quota", { quota_bytes: megabytes * 1_000_000 }); onSaved(); })}>Save quota</button>
      </div>
      <p className="fine-print">The per-recording safety limit remains 45 MB / 50 minutes. Current usage: {formatBytes(usage?.bytes)}.</p>
    </Card>
  );
}

export function Recordings({ admin = false }: { admin?: boolean }) {
  const app = useApp();
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ready");
  const [sort, setSort] = useState("date");
  const [direction, setDirection] = useState("desc");
  const [revision, setRevision] = useState(0);
  const [remove, setRemove] = useState<Row | null>(null);
  const [reason, setReason] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const path = `/report?kind=recordings&admin=${admin}&page=${page}&status=${encodeURIComponent(status)}&sort=${sort}&direction=${direction}&q=${encodeURIComponent(query)}&revision=${revision}`;
  const state = useData(path);
  const rows = state.data?.rows || [];
  const removeRecording = async () => {
    if (!remove || !confirmDelete) return;
    setDeleteError("");
    try {
      await api("/recordings/delete", { id: remove.id, confirmed: !admin, reason: admin ? reason : undefined });
      setRemove(null);
      setReason("");
      setConfirmDelete(false);
      setRevision((value) => value + 1);
      app.refresh();
      app.notify("Recording deleted from private storage.");
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "The recording was not deleted.");
    }
  };
  const subtitle = admin
    ? "Search, review, play, download, and remove authorized room-audio recordings. Every administrative access is audited."
    : "Record calls through your selected device microphone and manage your private saved recordings.";
  return (
    <>
      <Heading eyebrow={admin ? "ADMIN · CALLS" : "MY SALES"} title={admin ? "Call recordings" : "Room-audio recordings"} description={subtitle} />
      {!admin && <Recorder onSaved={() => setRevision((value) => value + 1)} />}
      <State {...state}>
        <Usage usage={state.data?.usage || {}} admin={admin} />
        {admin && <QuotaSettings usage={state.data?.usage || {}} onSaved={() => setRevision((value) => value + 1)} />}
        <Card title={admin ? "All authorized recordings" : "My saved recordings"}>
          <div className="recording-filters">
            <form onSubmit={(event) => { event.preventDefault(); setPage(0); setQuery(search); }}>
              <label className="sr-only" htmlFor="recording-search">Search recordings</label>
              <input id="recording-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, note, business or rep" />
              <button type="submit">Search</button>
            </form>
            <select aria-label="Recording status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
              <option value="ready">Saved</option><option value="uploading">Uploading</option><option value="upload_failed">Upload failed</option>{admin && <option value="deleted">Deleted</option>}<option value="all">All</option>
            </select>
            <select aria-label="Sort recordings" value={sort} onChange={(e) => setSort(e.target.value)}><option value="date">Date</option><option value="duration">Duration</option><option value="size">File size</option></select>
            <button onClick={() => setDirection((value) => value === "asc" ? "desc" : "asc")}>{direction === "asc" ? "Oldest first" : "Newest first"}</button>
          </div>
          {!rows.length ? <div className="state">No recordings match this view.</div> : <div className="recording-list">
            {rows.map((row: Row) => (
              <article className="recording-item" key={row.id}>
                <div className="recording-item-head">
                  <div><h3>{row.title || row.business_name || "Call recording"}</h3><p>{admin && `${row.rep_name} · `}{row.business_name ? `${row.business_name} · ` : ""}{new Date(row.recorded_at).toLocaleString()}</p></div>
                  <span className={`badge ${row.status}`}>{row.status}</span>
                </div>
                <div className="recording-summary"><span>{formatTime(row.duration_seconds)}</span><span>{formatBytes(row.size_bytes)}</span><span>{row.codec}</span><span>{row.device_label || "Microphone"}</span></div>
                {row.note && <p className="recording-note">{row.note}</p>}
                {row.status === "ready" && <RecordingPlayer row={row} />}
                {row.status !== "deleted" && <button className="danger-outline" onClick={() => { setRemove(row); setConfirmDelete(false); setReason(""); setDeleteError(""); }}><Trash2 size={15} /> Delete</button>}
              </article>
            ))}
          </div>}
          <div className="pagination"><button disabled={!page} onClick={() => setPage((value) => value - 1)}>Previous</button><span>{state.data?.total || 0} recording{state.data?.total === 1 ? "" : "s"}</span><button disabled={(page + 1) * 50 >= (state.data?.total || 0)} onClick={() => setPage((value) => value + 1)}>Next</button></div>
        </Card>
      </State>
      {remove && <Modal title="Delete recording" onClose={() => setRemove(null)}>
        <p>This permanently removes the private audio object and marks its metadata deleted. It cannot be undone.</p>
        {admin && <label>Audit reason<textarea required minLength={5} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
        <label className="consent-check"><input type="checkbox" checked={confirmDelete} onChange={(e) => setConfirmDelete(e.target.checked)} /> I understand this recording will be permanently deleted.</label>
        <div className="button-row"><button className="danger" disabled={!confirmDelete || (admin && reason.trim().length < 5)} onClick={() => void removeRecording()}>Delete recording</button><button onClick={() => setRemove(null)}>Cancel</button></div>
        {deleteError && <div className="notice error" role="alert">{deleteError}</div>}
      </Modal>}
    </>
  );
}
