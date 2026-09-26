import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Clapperboard,
  Cpu,
  Hourglass,
  Loader2,
  Mic,
  Play,
  Rocket,
  Send,
  Sparkles,
  Square,
  TimerReset,
  TriangleAlert,
  Zap,
} from "lucide-react";
import Section from "./Section";
import { Field, Segmented, Toggle } from "./Controls";
import { cn } from "../utils/cn";
import type { LocalRenderItem, ShipState } from "../lib/types";
import { shipStateLabel } from "./ShipPanel";
import {
  AUTOPILOT_INTERVALS,
  AUTOPILOT_PER_WAVE,
  formatWait,
  type AutopilotConfig,
  type AutopilotState,
  type AutopilotStage,
} from "../lib/autopilot";

/* ------------------------------------------------------------------ */
/*  kleine Helfer für die Live-Anzeige                                   */
/* ------------------------------------------------------------------ */

const STAGE_STEPS: { id: string; label: string; icon: typeof Cpu; stages: AutopilotStage[] }[] = [
  { id: "ideas", label: "IDEEN", icon: Sparkles, stages: ["ideas"] },
  { id: "prepare", label: "SKRIPTE + STIMMEN", icon: Mic, stages: ["prepare"] },
  { id: "render", label: "RENDER", icon: Clapperboard, stages: ["render"] },
  { id: "ship", label: "SENDEWELLEN", icon: Send, stages: ["ship-wait", "ship"] },
];

function stepState(stage: AutopilotStage, stepIndex: number): "done" | "active" | "todo" {
  const order: AutopilotStage[] = ["ideas", "prepare", "render", "ship-wait", "ship", "done"];
  const current = Math.max(0, order.indexOf(stage));
  const boundaries = [0, 1, 2, 3]; // ideas|prepare|render|ship*
  if (stage === "done" || stage === "error" || stage === "stopped") {
    const at = stepIndex <= 3 ? 4 : 4;
    return at > stepIndex ? "done" : "done";
  }
  if (current > boundaries[stepIndex]) return "done";
  if (current === boundaries[stepIndex]) return "active";
  return "todo";
}

/** Countdown-Anzeige zur nächsten Sendewelle — tickt jede Sekunde selbst. */
function WaveCountdown({ nextWaveAt, intervalMinutes }: { nextWaveAt: number; intervalMinutes: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const left = Math.max(0, nextWaveAt - now);
  const total = Math.max(1, intervalMinutes * 60_000);
  const ratio = Math.max(0, Math.min(1, 1 - left / total));
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="mono-label flex items-center gap-1.5 text-[9px] text-ember-400">
          <Hourglass className="size-3 animate-pulse" /> NÄCHSTE SENDUNG IN
        </span>
        <span className="font-mono text-lg font-black tracking-wider text-ember-400 tabular-nums">
          {formatWait(left)}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden bg-coal-800">
        <div
          className="h-full bg-ember-500 transition-[width] duration-1000 ease-linear"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Panel                                                                */
/* ------------------------------------------------------------------ */

export default function AutopilotPanel({
  cfg,
  onCfgChange,
  state,
  items,
  shipStates,
  zernioReady,
  footageReady,
  onStart,
  onStop,
}: {
  cfg: AutopilotConfig;
  onCfgChange: (cfg: AutopilotConfig) => void;
  state: AutopilotState;
  items: LocalRenderItem[];
  shipStates: Record<number, ShipState>;
  /** Server-.env oder App-Key gesetzt und mind. ein Account verbunden */
  zernioReady: boolean;
  /** Quellvideo bzw. 10 Dateien sind geladen */
  footageReady: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const running = state.running;
  const scripted = items.filter((i) => i.story).length;
  const voiced = items.filter((i) => i.voiceDuration).length;
  const rendered = items.filter((i) => i.status === "done").length;
  const sentCount = items.filter((i) => shipStates[i.index]?.status === "sent").length;

  const stageHint = useMemo(() => {
    switch (state.stage) {
      case "ideas":
        return "IDEEN WERDEN GESCHRIEBEN…";
      case "prepare":
        return `SKRIPTE + STIMMEN ${Math.min(10, voiced)}/10`;
      case "render":
        return `RENDERT ${rendered}/10`;
      case "ship-wait":
        return "WARTET AUF DIE NÄCHSTE WELLE";
      case "ship":
        return `SENDET WELLE ${state.wave}/${state.waves}`;
      case "done":
        return "ZYKLUS FERTIG · ALLES RAUS";
      case "error":
        return "FEHLER";
      case "stopped":
        return "ANGEHALTEN";
      default:
        return "BEREIT";
    }
  }, [state, voiced, rendered]);

  return (
    <Section
      index="AP"
      title="Autopilot · stündlicher Versand"
      hint={running || state.stage !== "idle" ? stageHint : "EIN KNOPF — DER REST LÄUFT NACH EINSTELLUNGEN"}
      active={running}
      complete={state.stage === "done" && !cfg.loopForever}
    >
      {/* ------------------------------------------------ Einstellungen */}
      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <div className="grid content-start gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="VIDEOS PRO SENDUNG" hint="wie viele gleichzeitig rausgehen">
              <Segmented<number>
                columns={6}
                value={cfg.perWave}
                onChange={(v) => onCfgChange({ ...cfg, perWave: v })}
                disabled={running}
                options={AUTOPILOT_PER_WAVE.map((n) => ({ id: n, label: `${n}` }))}
              />
            </Field>
            <Field label="ALLE … SENDEN" hint="Abstand zwischen den Sendewellen">
              <Segmented<number>
                columns={3}
                value={cfg.intervalMinutes}
                onChange={(v) => onCfgChange({ ...cfg, intervalMinutes: v })}
                disabled={running}
                options={AUTOPILOT_INTERVALS}
              />
            </Field>
          </div>

          <div className="grid gap-2">
            <Toggle
              label="ERSTE SENDUNG SOFORT"
              sub="sonst wartet die erste Welle ein komplettes Intervall"
              checked={cfg.firstWaveNow}
              onChange={(v) => onCfgChange({ ...cfg, firstWaveNow: v })}
              disabled={running}
            />
            <Toggle
              label="IDEEN AUTOMATISCH NACHFÜLLEN"
              sub="leere Idee-Felder per KI (ohne Key: Offline-Generator) füllen"
              checked={cfg.autoIdeas}
              onChange={(v) => onCfgChange({ ...cfg, autoIdeas: v })}
              disabled={running}
            />
            <Toggle
              label="ENDLOS-LOOP"
              sub="nach dem Versand aller Videos startet der nächste Zyklus: frische Ideen + neue Clips"
              checked={cfg.loopForever}
              onChange={(v) => onCfgChange({ ...cfg, loopForever: v })}
              disabled={running}
            />
          </div>

          <p className="border border-coal-700/80 bg-coal-850/60 px-3 py-2.5 font-mono text-[9.5px] leading-relaxed text-coal-400">
            ABLAUF NACH DEM KNOPFDRUCK: 10 IDEEN → 10 SKRIPTE → 10 STIMMEN → 10 CLIPS SCHNEIDEN →
            RENDERN → DANN ALLE {cfg.intervalMinutes} MIN JE {cfg.perWave} VIDEO
            {cfg.perWave > 1 ? "S" : ""} AN ZERNIO (nach den Einstellungen aus 00 &amp; 06).
            WICHTIG: <span className="text-amber-warn">DIESEN TAB OFFEN LASSEN</span> — die Fabrik
            rendert und versendet nur bei geöffnetem Tab (er sollte beim Rendern im Vordergrund
            bleiben).
          </p>
        </div>

        {/* ------------------------------------------------ Startknopf / Live-Status */}
        <div className="grid content-start gap-3">
          {!running ? (
            <button
              type="button"
              onClick={onStart}
              className="glow-volt bg-heat flex min-h-[68px] w-full items-center justify-center gap-3 border border-volt-400 font-display text-xl font-black tracking-tight text-coal-950 uppercase hover:opacity-95"
            >
              <Play className="size-6" strokeWidth={2.5} />
              Autopilot starten
            </button>
          ) : (
            <button
              type="button"
              onClick={onStop}
              className="flex min-h-[68px] w-full items-center justify-center gap-3 border border-rose-err bg-rose-err/10 font-display text-xl font-black tracking-tight text-rose-err uppercase hover:bg-rose-err/20"
            >
              <Square className="size-5" strokeWidth={2.5} />
              Autopilot STOPP
            </button>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[9.5px] tracking-wider">
            <span
              className={cn(
                "flex items-center gap-1.5",
                footageReady ? "text-volt-300" : "text-coal-500"
              )}
            >
              {footageReady ? <BadgeCheck className="size-3" /> : <TriangleAlert className="size-3" />}
              FOOTAGE
            </span>
            <span
              className={cn(
                "flex items-center gap-1.5",
                zernioReady ? "text-volt-300" : "text-coal-500"
              )}
            >
              {zernioReady ? <BadgeCheck className="size-3" /> : <TriangleAlert className="size-3" />}
              ZERNIO
            </span>
            <span className="flex items-center gap-1.5 text-coal-500">
              <TimerReset className="size-3" /> TAB OFFEN LASSEN
            </span>
          </div>

          {state.blockers.length > 0 && !running && (
            <div className="border border-amber-warn/50 bg-amber-warn/10 px-3 py-2.5">
              <p className="mono-label mb-1.5 flex items-center gap-1.5 text-[9px] text-amber-warn">
                <TriangleAlert className="size-3" /> SO GEHT ES WEITER
              </p>
              <ul className="grid gap-1">
                {state.blockers.map((b) => (
                  <li key={b} className="font-mono text-[10px] leading-relaxed text-amber-warn">
                    · {b}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------ Laufzustand */}
      {(running || state.stage !== "idle") && (
        <div className="mt-5 grid gap-3 border-t border-coal-700/70 pt-4">
          {/* Schritte */}
          <div className="grid gap-1.5 sm:grid-cols-4">
            {STAGE_STEPS.map((step, i) => {
              const st = state.stage === "error" && stepState(state.stage, i) === "active"
                ? "active"
                : stepState(state.stage, i);
              const Icon = step.icon;
              return (
                <div
                  key={step.id}
                  className={cn(
                    "flex items-center gap-2 border px-2.5 py-2",
                    st === "active"
                      ? "border-ember-500/60 bg-ember-500/10"
                      : st === "done"
                        ? "border-volt-400/40 bg-volt-400/5"
                        : "border-coal-700/80 bg-coal-850/50"
                  )}
                >
                  {st === "active" ? (
                    <Loader2 className="size-3.5 shrink-0 animate-spin text-ember-400" />
                  ) : st === "done" ? (
                    <BadgeCheck className="size-3.5 shrink-0 text-volt-400" />
                  ) : (
                    <Icon className="size-3.5 shrink-0 text-coal-500" />
                  )}
                  <span
                    className={cn(
                      "mono-label text-[9px]",
                      st === "active" ? "text-ember-400" : st === "done" ? "text-volt-300" : "text-coal-500"
                    )}
                  >
                    {step.label}
                  </span>
                </div>
              );
            })}
            {cfg.loopForever && state.cycle > 0 && (
              <p className="mono-label text-[9px] text-volt-300 sm:col-span-4">
                ZYKLUS {state.cycle} · ENDLOS-LOOP AKTIV
              </p>
            )}
          </div>

          {/* Kennzahlen */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[9.5px] tracking-wider text-coal-400">
            <span className="flex items-center gap-1.5">
              <Cpu className="size-3" /> SKRIPTE {Math.min(10, scripted)}/10
            </span>
            <span className="flex items-center gap-1.5">
              <Mic className="size-3" /> STIMMEN {Math.min(10, voiced)}/10
            </span>
            <span className="flex items-center gap-1.5">
              <Clapperboard className="size-3" /> RENDER {rendered}/10
            </span>
            <span className="flex items-center gap-1.5 text-volt-300">
              <Rocket className="size-3" /> GESENDET {sentCount}
              {state.sendTotal > 0 ? `/${state.sendTotal}` : ""}
            </span>
          </div>

          {/* Sendewellen + Countdown */}
          {state.stage === "ship-wait" && state.nextWaveAt && (
            <div className="border border-ember-500/40 bg-ember-500/5 px-3 py-2.5">
              <WaveCountdown nextWaveAt={state.nextWaveAt} intervalMinutes={cfg.intervalMinutes} />
              <p className="mt-2 font-mono text-[9.5px] tracking-wider text-coal-300">
                WELLE {state.wave + 1}/{state.waves}
                {state.waveUnits.length > 0 &&
                  ` → UNIT ${state.waveUnits.map((u) => String(u + 1).padStart(2, "0")).join(", ")}`}
              </p>
            </div>
          )}

          {state.stage === "ship" && (
            <div className="flex items-center gap-2 border border-volt-400/40 bg-volt-400/5 px-3 py-2.5">
              <Loader2 className="size-3.5 animate-spin text-volt-400" />
              <p className="font-mono text-[9.5px] tracking-wider text-volt-300">
                WELLE {state.wave}/{state.waves} GEHT RAUS
                {state.waveUnits.length > 0 &&
                  ` → UNIT ${state.waveUnits.map((u) => String(u + 1).padStart(2, "0")).join(", ")}`}
              </p>
            </div>
          )}

          {/* Unit-Matrix */}
          {items.length > 0 && (
            <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
              {items.map((item) => {
                const ship = shipStates[item.index];
                const busyRender = item.status === "rendering";
                const shipBusyShip =
                  ship && (ship.status === "uploading" || ship.status === "publishing" || ship.status === "waiting");
                return (
                  <div
                    key={item.index}
                    className={cn(
                      "border px-1.5 py-1.5 text-center",
                      ship?.status === "sent"
                        ? "border-volt-400/60 bg-volt-400/10"
                        : item.status === "error" || ship?.status === "error"
                          ? "border-rose-err/50 bg-rose-err/10"
                          : busyRender || shipBusyShip
                            ? "border-ember-500/50 bg-ember-500/10"
                            : "border-coal-700/80 bg-coal-850/60"
                    )}
                    title={`${item.idea || "—"}${item.error ? ` · ${item.error}` : ""}${ship?.error ? ` · ${ship.error}` : ""}`}
                  >
                    <p className="font-mono text-[9px] font-bold text-coal-400 tabular-nums">
                      {String(item.index + 1).padStart(2, "0")}
                    </p>
                    <p
                      className={cn(
                        "mt-0.5 truncate font-mono text-[8px] tracking-wider",
                        ship?.status === "sent"
                          ? "text-volt-300"
                          : item.status === "error" || ship?.status === "error"
                            ? "text-rose-err"
                            : busyRender || shipBusyShip
                              ? "text-ember-400"
                              : "text-coal-500"
                      )}
                    >
                      {ship?.status === "sent"
                        ? "GESENDET"
                        : ship
                          ? shipStateLabel(ship) || "—"
                          : item.status === "done"
                            ? "FERTIG"
                            : item.status === "rendering"
                              ? "RENDER…"
                              : item.status === "staged"
                                ? "STAGED"
                                : item.status === "voice"
                                  ? "STIMME…"
                                  : item.status === "script"
                                    ? "SKRIPT…"
                                    : item.status === "error"
                                      ? "FEHLER"
                                      : "—"}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {/* Protokoll */}
          {state.log.length > 0 && (
            <div className="border border-coal-700/80 bg-coal-950/50 p-3">
              <p className="mono-label mb-1.5 flex items-center gap-1.5 text-[9px] text-coal-400">
                <Zap className="size-3" /> AUTOPILOT-PROTOKOLL
              </p>
              <ul className="grid max-h-44 gap-1 overflow-y-auto">
                {state.log.slice(0, 20).map((entry, i) => (
                  <li key={`${entry.at}-${i}`} className="flex items-baseline gap-2">
                    <span className="shrink-0 font-mono text-[8.5px] text-coal-600 tabular-nums">
                      {new Date(entry.at).toLocaleTimeString("de-DE", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                    <span
                      className={cn(
                        "font-mono text-[9.5px] leading-relaxed",
                        entry.kind === "ok"
                          ? "text-volt-300"
                          : entry.kind === "err"
                            ? "text-rose-err"
                            : entry.kind === "warn"
                              ? "text-amber-warn"
                              : "text-coal-300"
                      )}
                    >
                      {entry.msg}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {state.error && (
            <div className="flex items-start gap-2 border border-rose-err/50 bg-rose-err/10 px-3 py-2.5">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-rose-err" />
              <p className="font-mono text-[11px] leading-relaxed text-rose-err">{state.error}</p>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
