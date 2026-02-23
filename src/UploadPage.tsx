import React, { useCallback, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  Image as ImageIcon,
  Film,
  X,
  CheckCircle2,
  AlertTriangle,
  Settings2,
  SlidersHorizontal,
  Play,
  Pause,
  Download,
  Info,
  ExternalLink,
  Target,
  Zap,
} from "lucide-react";

type MediaType = "image" | "video";

type UploadItem = {
  id: string;
  name: string;
  type: MediaType;
  sizeBytes: number;
  status: "queued" | "uploading" | "processing" | "done" | "error";
  progress: number;
  previewUrl?: string;
  createdAt: number;
  error?: string;
  file?: File;
  resultUrl?: string;
};

function bytes(n: number) {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function isVideo(file: File) {
  return file.type.startsWith("video/");
}

function isImage(file: File) {
  return file.type.startsWith("image/");
}

function formatType(t: MediaType) {
  return t === "image" ? "Image" : "Video";
}

function StatusPill({ status }: { status: UploadItem["status"] }) {
  const label =
    status === "queued"
      ? "Queued"
      : status === "uploading"
      ? "Uploading"
      : status === "processing"
      ? "Processing"
      : status === "done"
      ? "Ready"
      : "Error";

  const icon =
    status === "done" ? (
      <CheckCircle2 className="h-4 w-4" />
    ) : status === "error" ? (
      <AlertTriangle className="h-4 w-4" />
    ) : (
      <SlidersHorizontal className="h-4 w-4" />
    );

  const cls =
    status === "done"
      ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/20"
      : status === "error"
      ? "bg-rose-500/15 text-rose-300 ring-1 ring-rose-400/20"
      : "bg-slate-500/15 text-slate-200 ring-1 ring-slate-400/20";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${cls}`}>
      {icon}
      {label}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
      <motion.div
        className="h-full bg-white/40"
        initial={{ width: 0 }}
        animate={{ width: `${v}%` }}
        transition={{ type: "spring", stiffness: 120, damping: 18 }}
      />
    </div>
  );
}

export default function UploadPage() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [depthStrength, setDepthStrength] = useState(60);
  const [parallax, setParallax] = useState(50);
  const [stabilize, setStabilize] = useState(true);
  const [direction, setDirection] = useState<"clockwise" | "counterclockwise" | "none">("none");
  const [quality, setQuality] = useState<"fast" | "balanced" | "high">("balanced");
  
  const [speed, setSpeed] = useState(100);
  const [focalPointX, setFocalPointX] = useState(0.5);
  const [focalPointY, setFocalPointY] = useState(0.5);
  const [motionType, setMotionType] = useState<"orbit" | "drift" | "zoom">("orbit");

  // Dolly controls (NEW)
  const [dollyZoom, setDollyZoom] = useState(0.08); // 0.04–0.12 good range
  const [loop, setLoop] = useState(true); 

  const [isPlaying, setIsPlaying] = useState(false);
  const [showFocalCrosshair, setShowFocalCrosshair] = useState(true);

  const [items, setItems] = useState<UploadItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const active = useMemo(
    () => items.find((i) => i.id === activeId) ?? null,
    [items, activeId]
  );

  const accept = "image/*,video/*";

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files);

    const next: UploadItem[] = arr
      .filter((f) => isImage(f) || isVideo(f))
      .slice(0, 20)
      .map((f) => {
        const type: MediaType = isVideo(f) ? "video" : "image";
        const previewUrl = URL.createObjectURL(f);
        return {
          id: uid(),
          name: f.name,
          type,
          sizeBytes: f.size,
          status: "queued",
          progress: 0,
          previewUrl,
          createdAt: Date.now(),
          file: f,
        };
      });

    setItems((prev) => {
      const merged = [...next, ...prev];
      if (!activeId && merged.length > 0) setActiveId(merged[0].id);
      return merged;
    });
  }, [activeId]);

  const runPipeline = useCallback(async (id: string) => {
  const item = items.find((i) => i.id === id);
  if (!item || !item.file) return;

  try {
    setItems((prev) =>
      prev.map((i) =>
        i.id === id ? { ...i, status: "uploading", progress: 20 } : i
      )
    );

    const formData = new FormData();
    formData.append("file", item.file);
    formData.append("depthStrength", depthStrength.toString());
    formData.append("parallax", parallax.toString());
    formData.append("stabilize", stabilize.toString());
    formData.append("speed", speed.toString());
    formData.append("focalPointX", focalPointX.toString());
    formData.append("focalPointY", focalPointY.toString());
    formData.append("motionType", motionType);
    formData.append("direction", direction === "none" ? "clockwise" : direction);
    formData.append("quality", quality);
    formData.append("dollyZoom", dollyZoom.toString());
    formData.append("loop", loop.toString());      

    setItems((prev) =>
      prev.map((i) =>
        i.id === id ? { ...i, status: "processing", progress: 50 } : i
      )
    );

    const res = await fetch("http://127.0.0.1:8000/process", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    if (!data.ok) throw new Error(data.error || "Processing failed");

    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? {
              ...i,
              status: "done",
              progress: 100,
              resultUrl: `http://127.0.0.1:8000${data.video}`,
            }
          : i
      )
    );
  } catch (err: any) {
    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? { ...i, status: "error", error: err.message }
          : i
      )
    );
  }
}, 
[items, depthStrength, parallax, stabilize, speed, focalPointX, focalPointY, motionType, direction, quality, dollyZoom, loop]
);

  const onPick = useCallback(() => inputRef.current?.click(), []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files;
      if (!f || f.length === 0) return;
      addFiles(f);
      e.target.value = "";
    },
    [addFiles]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => {
      const next = prev.filter((i) => i.id !== id);
      if (activeId === id) setActiveId(next[0]?.id ?? null);
      return next;
    });
  }, [activeId]);

  const startActive = useCallback(() => {
    if (!active) return;
    if (active.status === "queued" || active.status === "error") runPipeline(active.id);
  }, [active, runPipeline]);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const normalizedX = x / rect.width;
    const normalizedY = y / rect.height;
    
    setFocalPointX(Math.max(0, Math.min(1, normalizedX)));
    setFocalPointY(Math.max(0, Math.min(1, normalizedY)));
    
    console.log(`Focal point set to: (${normalizedX.toFixed(2)}, ${normalizedY.toFixed(2)})`);
  }, []);

  const canDownload = active?.status === "done";

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-white">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/15">
              <Upload className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-wide">3D Parallax Studio</div>
              <div className="text-xs text-white/60">15-second looping MP4 generation</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="inline-flex items-center gap-2 rounded-2xl bg-white/10 px-3 py-2 text-sm ring-1 ring-white/15 hover:bg-white/15"
              onClick={onPick}
            >
              <Upload className="h-4 w-4" />
              Add files
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-sm text-slate-900 hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={startActive}
              disabled={!active || (active.status !== "queued" && active.status !== "error")}
              title={!active ? "Select an item" : "Generate 15s looping video"}
            >
              <Settings2 className="h-4 w-4" />
              Generate
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-6 py-6 lg:grid-cols-[360px_1fr_360px]">
        <section className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Files</div>
              <div className="text-xs text-white/60">Drag & drop or browse</div>
            </div>
            <div className="text-xs text-white/60">{items.length} item{items.length === 1 ? "" : "s"}</div>
          </div>

          <div
            className="mt-4 rounded-3xl border border-dashed border-white/20 bg-white/5 p-4"
            onDrop={onDrop}
            onDragOver={onDragOver}
          >
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/15">
                <Upload className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium">Drop media here</div>
                <div className="mt-1 text-xs text-white/60">
                  Images supported. Generates 15s looping MP4.
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="rounded-2xl bg-white px-3 py-2 text-xs font-medium text-slate-900 hover:bg-white/90"
                    onClick={onPick}
                  >
                    Browse
                  </button>
                </div>
              </div>
            </div>
          </div>

          <input ref={inputRef} type="file" accept={accept} multiple hidden onChange={onInputChange} />

          <div className="mt-4 space-y-2">
            <AnimatePresence initial={false}>
              {items.map((it) => (
                <motion.div
                  key={it.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  role="button"
                  tabIndex={0}
                  className={`group flex w-full cursor-pointer items-start gap-3 rounded-3xl border px-3 py-3 text-left transition ${
                    it.id === activeId
                      ? "border-white/20 bg-white/10"
                      : "border-white/10 bg-white/5 hover:bg-white/10"
                  }`}
                  onClick={() => setActiveId(it.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setActiveId(it.id);
                  }}
                >
                  <div className="mt-0.5 grid h-10 w-10 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/15">
                    {it.type === "image" ? <ImageIcon className="h-5 w-5" /> : <Film className="h-5 w-5" />}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate text-sm font-medium">{it.name}</div>
                      <button
                        className="opacity-0 transition group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeItem(it.id);
                        }}
                        title="Remove"
                      >
                        <X className="h-4 w-4 text-white/70 hover:text-white" />
                      </button>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <div className="text-xs text-white/60">
                        {formatType(it.type)} • {bytes(it.sizeBytes)}
                      </div>
                      <StatusPill status={it.status} />
                    </div>
                    <div className="mt-2">
                      <ProgressBar value={it.progress} />
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {items.length === 0 && (
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-center text-sm text-white/60">
                No uploads yet.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Preview & Focal Point</div>
              <div className="text-xs text-white/60">
                {active ? `${active.name}` : "Select a file"}
                {active && active.type === "image" && " • Click to set focal point"}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {active && active.type === "image" && (
                <button
                  className="inline-flex items-center gap-2 rounded-2xl bg-white/10 px-3 py-2 text-sm ring-1 ring-white/15 hover:bg-white/15"
                  onClick={() => setShowFocalCrosshair(!showFocalCrosshair)}
                >
                  <Target className="h-4 w-4" />
                  {showFocalCrosshair ? "Hide" : "Show"} Target
                </button>
              )}

              <button
                className="inline-flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-sm text-slate-900 hover:bg-white/90 disabled:opacity-50"
                disabled={!canDownload}
                onClick={() => {
                  if (active?.resultUrl) {
                    window.open(active.resultUrl, '_blank');
                  }
                }}
              >
                <Download className="h-4 w-4" />
                Download
              </button>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-white/5 to-white/0">
            <div className="relative aspect-video w-full">
              {!active && (
                <div className="absolute inset-0 grid place-items-center">
                  <div className="max-w-md px-6 text-center">
                    <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/15">
                      <Upload className="h-6 w-6" />
                    </div>
                    <div className="mt-4 text-base font-semibold">Upload media to preview</div>
                    <div className="mt-2 text-sm text-white/60">
                      Click on the image to set the focal point for 3D motion.
                    </div>
                  </div>
                </div>
              )}

              {active && active.previewUrl && active.type === "image" && !active.resultUrl && (
                <div className="absolute inset-0">
                  <canvas
                    ref={canvasRef}
                    className="h-full w-full cursor-crosshair object-contain p-6"
                    style={{ 
                      backgroundImage: `url(${active.previewUrl})`,
                      backgroundSize: 'contain',
                      backgroundPosition: 'center',
                      backgroundRepeat: 'no-repeat'
                    }}
                    onClick={handleCanvasClick}
                    width={800}
                    height={600}
                  />
                  
                  {showFocalCrosshair && (
                    <div
                      className="pointer-events-none absolute"
                      style={{
                        left: `${focalPointX * 100}%`,
                        top: `${focalPointY * 100}%`,
                        transform: 'translate(-50%, -50%)',
                      }}
                    >
                      <Target className="h-8 w-8 text-emerald-400 drop-shadow-lg animate-pulse" />
                      <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-emerald-500/20 px-2 py-1 text-xs text-emerald-300 ring-1 ring-emerald-400/30">
                        Focal Point
                      </div>
                    </div>
                  )}
                </div>
              )}

              {active?.resultUrl && (
                <video
                  className="absolute inset-0 h-full w-full object-contain p-6"
                  src={active.resultUrl}
                  controls
                  autoPlay
                  loop
                />
              )}

              {active && (
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t border-white/10 bg-slate-950/60 px-4 py-3 backdrop-blur">
                  <div className="flex items-center gap-2 text-xs text-white/70">
                    <span className="rounded-full bg-white/10 px-2 py-1 ring-1 ring-white/15">
                      15s Loop • {motionType}
                    </span>
                    <span>•</span>
                    <span>{formatType(active.type)}</span>
                    <span>•</span>
                    <span>{bytes(active.sizeBytes)}</span>
                  </div>
                  <div className="text-xs text-white/60">
                    {active.status === "done"
                      ? "✓ Ready to download"
                      : active.status === "processing"
                      ? "Generating 450 frames..."
                      : active.status === "uploading"
                      ? "Uploading..."
                      : "Click Generate to start"}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs text-white/60">Depth strength</div>
              <div className="mt-1 text-lg font-semibold">{depthStrength}%</div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs text-white/60">Parallax</div>
              <div className="mt-1 text-lg font-semibold">{parallax}%</div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs text-white/60">Speed</div>
              <div className="mt-1 text-lg font-semibold">{speed}%</div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs text-white/60">Focal point</div>
              <div className="mt-1 text-sm font-mono">
                {focalPointX.toFixed(2)}, {focalPointY.toFixed(2)}
              </div>
            </div>
          </div>
        </section>

        <aside className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Settings</div>
              <div className="text-xs text-white/60">15-second loop parameters</div>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4" />
                <div className="text-sm font-medium">Motion Type</div>
              </div>
              {/* Direction Control - ADD THIS */}
<div className="rounded-3xl border border-white/10 bg-white/5 p-4">
  <div className="flex items-center gap-2">
    <Target className="h-4 w-4" />
    <div className="text-sm font-medium">Direction</div>
  </div>
  <div className="mt-3 grid grid-cols-2 gap-2">
    {(["none", "clockwise", "counterclockwise"] as const).map((d) => (
      <button
        key={d}
        className={`rounded-2xl px-3 py-2 text-xs ring-1 transition capitalize ${
          direction === d
            ? "bg-white text-slate-900 ring-white"
            : "bg-white/10 text-white ring-white/15 hover:bg-white/15"
        }`}
        onClick={() => {
          setDirection(d);

          // If user selects "none" and Orbit is active,
          // automatically switch to Drift to avoid rotation.
          if (d === "none" && motionType === "orbit") {
            setMotionType("drift");
          }
        }}
        >
          {d === "none"
            ? "⟷ None"
            : d === "clockwise"
            ? "↻ Clockwise"
            : "↺ Counter"}
        </button>
        ))}
  </div>
</div>

{/* Quality Preset - ADD THIS */}
<div className="rounded-3xl border border-white/10 bg-white/5 p-4">
  <div className="flex items-center gap-2">
    <Zap className="h-4 w-4" />
    <div className="text-sm font-medium">Quality / Speed</div>
  </div>
  <div className="mt-3 grid grid-cols-3 gap-2">
    {(["fast", "balanced", "high"] as const).map((q) => (
      <button
        key={q}
        className={`rounded-2xl px-3 py-2 text-xs ring-1 transition capitalize ${
          quality === q
            ? "bg-white text-slate-900 ring-white"
            : "bg-white/10 text-white ring-white/15 hover:bg-white/15"
        }`}
        onClick={() => setQuality(q)}
      >
        {q}
      </button>
    ))}
  </div>
  <div className="mt-2 text-xs text-white/50">
    {quality === "fast" && "⚡ 720p @ 24fps • ~5-10 sec render"}
    {quality === "balanced" && "⚖️ 1080p @ 30fps • ~10-20 sec render"}
    {quality === "high" && "💎 1080p @ 30fps • Higher quality, slower"}
  </div>
</div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {(["orbit", "drift", "zoom", "dolly"] as const).map((m) => (
                  <button
                    key={m}
                    className={`rounded-2xl px-3 py-2 text-xs ring-1 transition capitalize ${
                      motionType === m
                        ? "bg-white text-slate-900 ring-white"
                        : "bg-white/10 text-white ring-white/15 hover:bg-white/15"
                    }`}
                    onClick={() => setMotionType(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <div className="mt-2 text-xs text-white/50">
                {motionType === "orbit" && "Circular camera orbit around focal point"}
                {motionType === "drift" && "Slow horizontal drift with gentle sway"}
                {motionType === "zoom" && "Zoom in/out effect (lens-like)"}
                {motionType === "dolly" && "Slow push-in (walking forward) using depth + zoom"}
              </div>

                {/* 👇 PUT NUMBER 4 RIGHT HERE */}
              {motionType === "dolly" && (
                <div className="mt-4 space-y-4">
                  <SliderRow
                    label="Dolly zoom (push-in)"
                    value={Math.round(dollyZoom * 100)}
                    onChange={(v) => setDollyZoom(v / 100)}
                    min={0}
                    max={20}
                    step={1}
                  />
                  <ToggleRow label="Loop push-in/out" value={loop} onChange={setLoop} />
                  <div className="text-xs text-white/50">
                    Tip: 6–10 is a natural walk-in. Higher = more dramatic.
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4" />
                <div className="text-sm font-medium">Depth & Motion</div>
              </div>

              <div className="mt-4 space-y-4">
                <SliderRow label="Depth strength" value={depthStrength} onChange={setDepthStrength} min={0} max={100} />
                <SliderRow label="Parallax amount" value={parallax} onChange={setParallax} min={0} max={100} />
                <SliderRow label="Motion speed" value={speed} onChange={setSpeed} min={0} max={200} step={5} />

                <ToggleRow label="Stabilize motion" value={stabilize} onChange={setStabilize} />
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4" />
                <div className="text-sm font-medium">Focal Point</div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-white/60">X (Horizontal)</label>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={focalPointX.toFixed(2)}
                    onChange={(e) => setFocalPointX(parseFloat(e.target.value))}
                    className="mt-1 w-full rounded-xl bg-white/10 px-3 py-2 text-sm ring-1 ring-white/15 focus:outline-none focus:ring-2 focus:ring-white/30"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/60">Y (Vertical)</label>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={focalPointY.toFixed(2)}
                    onChange={(e) => setFocalPointY(parseFloat(e.target.value))}
                    className="mt-1 w-full rounded-xl bg-white/10 px-3 py-2 text-sm ring-1 ring-white/15 focus:outline-none focus:ring-2 focus:ring-white/30"
                  />
                </div>
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  className="flex-1 rounded-2xl bg-white/10 px-3 py-2 text-xs ring-1 ring-white/15 hover:bg-white/15"
                  onClick={() => {
                    setFocalPointX(0.5);
                    setFocalPointY(0.5);
                  }}
                >
                  Reset to Center
                </button>
              </div>

              <div className="mt-2 text-xs text-white/50">
                Click on the image or enter values manually (0.0 - 1.0)
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2">
                <Film className="h-4 w-4" />
                <div className="text-sm font-medium">Output</div>
              </div>
              <div className="mt-3 space-y-2 text-xs text-white/60">
                <div className="flex justify-between">
                  <span>Format:</span>
                  <span className="font-medium text-white">MP4 (H.264)</span>
                </div>
                <div className="flex justify-between">
                  <span>Duration:</span>
                  <span className="font-medium text-white">15 seconds</span>
                </div>
                <div className="flex justify-between">
                  <span>Frame rate:</span>
                  <span className="font-medium text-white">30 fps</span>
                </div>
                <div className="flex justify-between">
                  <span>Total frames:</span>
                  <span className="font-medium text-white">450</span>
                </div>
                <div className="flex justify-between">
                  <span>Loop:</span>
                  <span className="font-medium text-emerald-400">Seamless ♻️</span>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-emerald-400/20 bg-emerald-500/5 p-4">
              <div className="text-sm font-medium text-emerald-300">💡 Tips</div>
              <ul className="mt-2 space-y-1 text-xs text-emerald-200/70">
                <li>• Click the image to set where the camera pivots</li>
                <li>• Higher speed = faster motion (100% = normal)</li>
                <li>• Orbit works best for portraits</li>
                <li>• Drift creates subtle cinematic motion</li>
              </ul>
            </div>
          </div>
        </aside>
      </main>

      <footer className="mx-auto max-w-7xl px-6 pb-10 text-xs text-white/40">
        3D Parallax Studio • 15-second seamless looping • MP4 output
      </footer>
    </div>
  );
}

function SliderRow({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="text-xs text-white/70">{label}</div>
        <div className="text-xs text-white/60">{value}{max === 100 ? '%' : ''}</div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-white"
      />
    </div>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between rounded-2xl bg-white/5 px-3 py-2 text-left ring-1 ring-white/10 hover:bg-white/10"
      onClick={() => onChange(!value)}
    >
      <span className="text-xs text-white/70">{label}</span>
      <span
        className={`inline-flex h-6 w-11 items-center rounded-full p-1 ring-1 transition ${
          value ? "bg-white/25 ring-white/25" : "bg-white/10 ring-white/15"
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-white transition ${value ? "translate-x-5" : "translate-x-0"}`}
        />
      </span>
    </button>
  );
}
