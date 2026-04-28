"use client";
import { useState, useTransition, useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";
import { parsePDF } from "./actions";

type Format = "Sammendrag";
type WhisperSegment = { start: number; end: number; text: string };
type LibraryItem = { id: number; name: string; audioUrl: string; text: string; voice: string; format: Format; segments: WhisperSegment[] };

const VOICES = [
  { id: "nova",    label: "Astrid", desc: "Norsk · varm" },
  { id: "onyx",    label: "Erik",   desc: "Norsk · dyp" },
  { id: "shimmer", label: "Sofie",  desc: "Norsk · klar" },
  { id: "alloy",   label: "Alex",   desc: "Engelsk · nøytral" },
];

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export default function Home() {
  const [isParsing, startParsing] = useTransition();

  const [parsedText, setParsedText] = useState("");
  const [parseError, setParseError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [step, setStep] = useState<"upload" | "review">("upload");

  const [voice] = useState("nova");
  const [format] = useState<Format>("Sammendrag");
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsError, setTtsError] = useState("");

  const [audioUrl, setAudioUrl] = useState("");
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [activeItemId, setActiveItemId] = useState<number | null>(null);
  const [whisperSegments, setWhisperSegments] = useState<WhisperSegment[]>([]);
  const [transcribing, setTranscribing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!audioUrl || !waveformRef.current) return;
    wavesurferRef.current?.destroy();
    setCurrentTime(0);
    setDuration(0);
    setPlaying(false);
    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: ["#a78bfa", "#818cf8", "#6366f1"],
      progressColor: ["#7c3aed", "#6d28d9", "#4f46e5"],
      cursorColor: "#ffffff",
      cursorWidth: 2,
      barWidth: 3,
      barGap: 2,
      barRadius: 4,
      height: 72,
      url: audioUrl,
    });
    ws.on("ready", () => setDuration(ws.getDuration()));
    ws.on("timeupdate", (t) => setCurrentTime(t));
    ws.on("finish", () => setPlaying(false));
    wavesurferRef.current = ws;
    return () => ws.destroy();
  }, [audioUrl]);

  const activeIdx = duration > 0
    ? whisperSegments.findLastIndex((s) => s.start <= currentTime)
    : -1;

  useEffect(() => {
    if (!transcriptRef.current || activeIdx < 0) return;
    transcriptRef.current
      .querySelector(`[data-i="${activeIdx}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIdx]);

  const handleUpload = (e: { preventDefault(): void; currentTarget: HTMLFormElement }) => {
    e.preventDefault();
    if (!file) return;
    setParseError("");
    const formData = new FormData(e.currentTarget);
    startParsing(async () => {
      const result = await parsePDF({ text: "", error: "" }, formData);
      if (result.error) {
        setParseError(result.error);
      } else {
        setParsedText(result.text);
        setStep("review");
      }
    });
  };

  const handleTTS = async () => {
    setTtsLoading(true);
    setTtsError("");
    try {
      const res = await fetch("/api/parse/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: parsedText, voice }),
      });
      if (!res.ok) {
        const raw = await res.text();
        let msg = "Kunne ikke generere lyd";
        try { msg = JSON.parse(raw).error ?? msg; } catch { msg = `Serverfeil ${res.status}`; }
        setTtsError(msg);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const id = Date.now();
      const item: LibraryItem = {
        id,
        name: file?.name?.replace(".pdf", "") ?? "Podcast",
        audioUrl: url,
        text: parsedText,
        voice,
        format,
        segments: [],
      };
      setLibrary((prev) => [item, ...prev]);
      setActiveItemId(id);
      setAudioUrl(url);
      setWhisperSegments([]);

      // Transcribe in background for real-time sync
      setTranscribing(true);
      const fd = new FormData();
      fd.append("audio", blob, "audio.mp3");
      fetch("/api/transcribe", { method: "POST", body: fd })
        .then((r) => r.json())
        .then((data) => {
          if (data.segments) {
            setWhisperSegments(data.segments);
            setLibrary((prev) =>
              prev.map((li) => li.id === id ? { ...li, segments: data.segments } : li)
            );
          }
        })
        .finally(() => setTranscribing(false));
    } catch (err) {
      setTtsError(err instanceof Error ? err.message : "Noe gikk galt");
    } finally {
      setTtsLoading(false);
    }
  };

  const loadItem = (item: LibraryItem) => {
    setParsedText(item.text);
    setAudioUrl(item.audioUrl);
    setActiveItemId(item.id);
    setWhisperSegments(item.segments);
    setStep("review");
    setTtsError("");
  };

  const resetToUpload = () => {
    setStep("upload");
    setAudioUrl("");
    setPlaying(false);
    setFile(null);
    setParsedText("");
    setParseError("");
    setTtsError("");
    setActiveItemId(null);
    setWhisperSegments([]);
    setTranscribing(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped?.type === "application/pdf") {
      setFile(dropped);
      if (fileInputRef.current) {
        const dt = new DataTransfer();
        dt.items.add(dropped);
        fileInputRef.current.files = dt.files;
      }
    }
  };

  const activeItem = library.find((i) => i.id === activeItemId);
  const currentVoice = VOICES.find((v) => v.id === voice) ?? VOICES[0];
  const error = parseError || ttsError;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="h-screen bg-[#0d0b1e] text-white flex flex-col overflow-hidden">

      {audioUrl && (
        <div className="h-7 bg-[#080616] border-b border-white/5 flex items-center px-5 gap-2 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-[11px] text-white/35">Spiller av — bibliotek + transkript synkronisert</span>
        </div>
      )}

      <div className="flex flex-1 min-h-0">

        {/* ── Sidebar ── */}
        <aside className="w-52 shrink-0 flex flex-col border-r border-white/5 overflow-y-auto bg-[#0b0919]">
          <div className="p-4 flex items-center gap-2.5 border-b border-white/5">
            <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center text-sm shrink-0">🎙</div>
            <div>
              <div className="font-bold text-xs">Lyttbar</div>
              <div className="text-[9px] text-indigo-400 tracking-widest uppercase">PDF → Podcast</div>
            </div>
          </div>

          <div className="p-3">
            <button
              onClick={resetToUpload}
              className="w-full py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 transition-colors"
            >
              + Ny opplasting
            </button>
          </div>

          <div className="flex-1 px-2 pb-4 flex flex-col gap-1">
            {library.length === 0 ? (
              <p className="text-[11px] text-white/20 leading-relaxed px-2 py-1">
                Biblioteket ditt er tomt.<br />Last opp en PDF for å begynne.
              </p>
            ) : (
              <>
                <p className="text-[9px] uppercase tracking-widest text-white/20 px-2 py-1">I dag</p>
                {library.map((item) => {
                  const isActive = item.id === activeItemId;
                  return (
                    <button
                      key={item.id}
                      onClick={() => loadItem(item)}
                      className={`w-full flex items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors ${
                        isActive
                          ? "bg-indigo-600/20 border border-indigo-500/20"
                          : "hover:bg-white/5 border border-transparent"
                      }`}
                    >
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-[10px] ${isActive ? "bg-indigo-600" : "bg-white/8 text-white/40"}`}>
                        {isActive && playing ? "⏸" : "▶"}
                      </div>
                      <div className="min-w-0">
                        <p className={`text-xs truncate ${isActive ? "font-medium text-white" : "text-white/50"}`}>{item.name}</p>
                        {isActive && <p className="text-[9px] text-white/35">{fmt(duration)}</p>}
                      </div>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </aside>

        {/* ── Main panel ── */}
        <div className="flex-1 overflow-y-auto">
          {step === "upload" ? (
            <div className="h-full flex items-center justify-center p-10">
              <div className="w-full max-w-lg flex flex-col items-center text-center gap-6">
                <span className="text-[11px] tracking-[0.3em] text-indigo-400 uppercase">Velkommen</span>
                <h1 className="text-3xl font-extrabold leading-tight">
                  Gjør hvilken som helst{" "}
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-pink-400">PDF</span>{" "}
                  til en podcast du kan høre på.
                </h1>
                <p className="text-white/35 text-sm">
                  Last opp et dokument og få en ferdig lydfil på under et minutt.
                </p>

                <form onSubmit={handleUpload} className="w-full flex flex-col gap-3">
                  <label
                    className={`w-full border-2 border-dashed rounded-2xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-all ${
                      dragging ? "border-indigo-400 bg-indigo-500/10 scale-[1.01]" : "border-indigo-500/25 hover:border-indigo-400/50 hover:bg-indigo-500/5"
                    }`}
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={onDrop}
                  >
                    <div className="w-11 h-11 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-900/50">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M12 12V4m0 0L8 8m4-4l4 4" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-semibold text-sm">{file ? file.name : "Slipp PDF her, eller klikk for å velge"}</p>
                      <p className="text-xs text-indigo-400/70 mt-0.5">opptil 50 MB · kun PDF støttes</p>
                    </div>
                    <input ref={fileInputRef} type="file" name="file" accept=".pdf" className="hidden"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  </label>

                  {error && (
                    <p className="text-sm text-red-400 bg-red-900/20 border border-red-500/20 rounded-xl px-4 py-3 text-left">{error}</p>
                  )}

                  <button type="submit" disabled={!file || isParsing}
                    className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 active:scale-95 disabled:opacity-40 transition-all">
                    {isParsing ? "Henter tekst…" : "Last opp og hent tekst"}
                  </button>
                </form>

                <div className="flex gap-5 text-xs text-white/25">
                  <span>✦ 4 stemmer</span><span>✦ Norsk &amp; engelsk</span><span>✦ MP3-eksport</span>
                </div>
              </div>
            </div>

          ) : (
            <div className="p-8 flex flex-col gap-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Spiller av nå</p>
                  <h2 className="text-2xl font-bold">{activeItem?.name ?? file?.name?.replace(".pdf", "") ?? "Dokument"}</h2>
                  <div className="flex items-center gap-2 mt-1 text-xs text-white/30">
                    <span className="w-4 h-4 rounded bg-white/10 flex items-center justify-center text-[9px]">📄</span>
                    <span>{parsedText.length} tegn</span>
                  </div>
                </div>
              </div>

              {error && (
                <p className="text-sm text-red-400 bg-red-900/20 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>
              )}

              <div className="bg-white/4 border border-white/8 rounded-2xl p-5 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white/75">Format &amp; stemme</h3>
                  <span className="text-[10px] text-indigo-400/70">endre → regenerer</span>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-white/25 mb-1">Lengde</p>
                  <span className="text-xs text-white/40">~ 4 min</span>
                </div>
              </div>

              {!audioUrl && (
                <button onClick={handleTTS} disabled={ttsLoading}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-semibold hover:from-violet-500 hover:to-indigo-500 active:scale-95 disabled:opacity-40 transition-all shadow-lg shadow-indigo-900/40">
                  {ttsLoading ? "Genererer lyd…" : "Lag podcast-lyd 🎙️"}
                </button>
              )}

              <div className="bg-white/4 border border-white/8 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-white/75">Kildedokument</h3>
                    <p className="text-[10px] text-white/25 mt-0.5">side 1 av 1</p>
                  </div>
                  <button onClick={resetToUpload}
                    className="px-3 py-1.5 rounded-lg bg-white/8 text-white/50 text-xs hover:bg-white/12 transition-colors">
                    Bytt PDF
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  <p className="text-sm text-white/45 whitespace-pre-wrap leading-relaxed">{parsedText}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Right panel ── */}
        {audioUrl && (
          <div className="w-96 shrink-0 border-l border-white/5 flex flex-col overflow-hidden bg-[#0b0919]">
            <div className="p-4 border-b border-white/5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${playing ? "bg-green-400 animate-pulse" : "bg-white/25"}`} />
                  <span className="text-xs text-white/45">{playing ? "Spiller av" : "Pauset"} {fmt(currentTime)} / {fmt(duration)}</span>
                </div>
                <a href={audioUrl} download="podcast.mp3"
                  className="px-2 py-1 rounded bg-white/8 text-white/45 text-[10px] hover:bg-white/12 transition-colors flex items-center gap-1">
                  🎵 MP3
                </a>
              </div>
              <div ref={waveformRef} className="w-full rounded-lg overflow-hidden" />
            </div>

            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <div className="flex items-center gap-2">
                <span>🎙</span>
                <div>
                  <p className="text-xs font-semibold text-white/75">Transkript</p>
                  <p className="text-[10px] text-white/25">følger lyden</p>
                </div>
              </div>
              <button onClick={() => transcriptRef.current?.querySelector(`[data-i="${activeIdx}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                className="px-2.5 py-1 rounded-lg bg-white/8 text-white/40 text-[10px] hover:bg-white/12 transition-colors">
                Hopp til nå
              </button>
            </div>

            <div ref={transcriptRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
              {transcribing && (
                <p className="text-xs text-white/30 text-center py-4 animate-pulse">Synkroniserer transkript…</p>
              )}
              {!transcribing && whisperSegments.length === 0 && (
                <p className="text-xs text-white/20 text-center py-4">Transkript vises her etter generering.</p>
              )}
              {whisperSegments.map((seg, i) => {
                const isActive = i === activeIdx;
                const isPast = i < activeIdx;
                return (
                  <div key={i} data-i={i}
                    className={`flex gap-3 cursor-pointer group transition-opacity ${isPast ? "opacity-25" : isActive ? "opacity-100" : "opacity-50"}`}
                    onClick={() => wavesurferRef.current?.seekTo(seg.start / duration)}>
                    <span className="text-[10px] text-white/25 font-mono mt-0.5 shrink-0 w-8">{fmt(seg.start)}</span>
                    <p className={`text-xs leading-relaxed ${isActive ? "text-white font-medium" : "text-white/55 group-hover:text-white/70"} transition-colors`}>
                      {seg.text.trim()}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom player bar ── */}
      {audioUrl && (
        <div className="h-[72px] bg-[#080616] border-t border-white/8 flex items-center px-5 gap-4 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-base shrink-0">🎙</div>

          <div className="min-w-0 w-44 shrink-0">
            <p className="text-sm font-semibold truncate">{activeItem?.name ?? "Podcast"}</p>
            <p className="text-[10px] text-white/30">{format.toLowerCase()} · stemme: {currentVoice.label}</p>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => wavesurferRef.current?.skip(-15)} className="text-white/40 hover:text-white transition-colors text-lg leading-none">«</button>
            <button
              onClick={() => { wavesurferRef.current?.playPause(); setPlaying((p) => !p); }}
              className="w-9 h-9 rounded-full bg-white text-indigo-900 font-bold text-base flex items-center justify-center hover:bg-indigo-100 active:scale-95 transition-all shadow-md"
            >
              {playing ? "⏸" : "▶"}
            </button>
            <button onClick={() => wavesurferRef.current?.skip(15)} className="text-white/40 hover:text-white transition-colors text-lg leading-none">»</button>
          </div>

          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-[10px] text-white/35 font-mono shrink-0">{fmt(currentTime)}</span>
            <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden cursor-pointer"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                wavesurferRef.current?.seekTo(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
              }}>
              <div className="h-full bg-indigo-500 rounded-full transition-none" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-[10px] text-white/35 font-mono shrink-0">{fmt(duration)}</span>
          </div>

          <button className="text-xs text-white/30 hover:text-white transition-colors px-2 shrink-0">1x</button>

          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs text-white/30">{volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}</span>
            <input type="range" min={0} max={1} step={0.01} value={volume}
              onChange={(e) => { const v = parseFloat(e.target.value); setVolume(v); wavesurferRef.current?.setVolume(v); }}
              className="w-20 accent-violet-400 cursor-pointer" />
          </div>

          <a href={audioUrl} download="podcast.mp3"
            className="text-white/30 hover:text-white transition-colors text-base shrink-0" title="Last ned">⬇</a>
        </div>
      )}
    </div>
  );
}
