"use client";
import { useState } from "react";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [audioUrl, setAudioUrl] = useState("");

  const handleTTS = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/parse/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const raw = await res.text();
        let message = "Kunne ikke generere lyd";
        try {
          message = JSON.parse(raw).error ?? message;
        } catch {
          message = `Serverfeil ${res.status}`;
        }
        setError(message);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Noe gikk galt");
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setError("");
    setText("");

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/parse", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Noe gikk galt");
    } else {
      setText(data.text);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-md p-8 flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">PDF til Podcast</h1>
          <p className="text-sm text-gray-500 mt-1">Last opp en PDF for å hente ut teksten</p>
        </div>

        <label className="flex flex-col items-center justify-center w-full h-36 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
          <span className="text-gray-400 text-sm">
            {file ? file.name : "Klikk for å velge en PDF-fil"}
          </span>
          <input
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>

        <button
          onClick={handleUpload}
          disabled={!file || loading}
          className="w-full py-3 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Behandler…" : "Last opp"}
        </button>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            {error}
          </p>
        )}

        {text && (
          <>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 max-h-96 overflow-y-auto">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{text}</p>
            </div>

            <button
              onClick={handleTTS}
              disabled={loading}
              className="w-full py-3 rounded-xl bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Genererer lyd…" : "Lag podcast-lyd 🎙️"}
            </button>
          </>
        )}

        {audioUrl && (
          <audio controls src={audioUrl} className="w-full mt-4" />
        )}
      </div>
    </main>
  );
}
