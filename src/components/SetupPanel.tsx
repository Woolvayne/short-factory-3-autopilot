import { useMemo, useState } from "react";
import {
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  Copy,
  KeyRound,
  Lock,
  MonitorSmartphone,
  Rocket,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import Section from "./Section";
import { cn } from "../utils/cn";
import { humanizeMinutes, type GateStatus } from "../lib/gate";
import type { ZernioStatus } from "../lib/zernio";

/**
 * Einrichtungs-Assistent — oben in der Fabrik, sagt in Klartext, was fehlt.
 *
 * Die App ist eine reine Web-App: einmal im Browser öffnen (fertiger Build,
 * z. B. dist/index.html oder ein beliebiger Static-Host) — kein Server, kein
 * Node-Prozess, kein Raspberry-Pi-Setup nötig. Läuft überall, wo ein
 * aktueller Browser läuft, auch auf sehr schwacher Hardware.
 *
 * Passwortschutz und Zernio-Versand werden direkt in der App eingerichtet
 * (Panel APP bzw. 06) und bleiben nur im localStorage dieses Geräts.
 *
 * Vollständige Anleitung: docs/EINRICHTUNG.md
 */
export default function SetupPanel({
  gateStatus,
  zernioStatus,
  onOpenShipPanel,
}: {
  gateStatus: GateStatus | null;
  zernioStatus: ZernioStatus | null;
  onOpenShipPanel?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const gateReady = Boolean(gateStatus?.requirePassword);
  const localGate = gateStatus?.mode === "local";
  const zernioReady = Boolean(zernioStatus?.configured);
  const accounts = zernioStatus?.accounts.length ?? 0;

  const steps = useMemo(
    () => [
      {
        id: "open",
        ok: true,
        title: "APP ÖFFNEN",
        todo: "kein Install nötig",
        detail:
          "100 % im Browser: Seite einmal öffnen (auch offline als Datei) und loslegen. Kein Server, kein Terminal-Befehl.",
        command: "# nichts zu tun — einfach im Browser geöffnet lassen",
      },
      {
        id: "gate",
        ok: gateReady,
        title: "PASSWORT-SCHUTZ",
        todo: localGate ? "aktiv (dieses Gerät)" : "optional",
        detail: localGate
          ? `Lokaler Schutz auf diesem Gerät aktiv: ${gateStatus?.maxAttempts ?? 5} Fehlversuche → eskalierende Sperre (${(gateStatus?.schedule ?? [5, 15, 60, 360, 1440])
              .map((m) => humanizeMinutes(m))
              .join(" → ")}).`
          : "Offen: jeder mit dem Link kann die Seite aufrufen. Optional unter Einstellungen → APP absichern.",
        command: "Einstellungen → APP → Passwort setzen",
      },
      {
        id: "zernio",
        ok: zernioReady && accounts > 0,
        title: "ZERNIO-VERSAND",
        todo: "API-Key + Social-Account",
        detail: !zernioReady
          ? "Kein Key — Versand-Panel ist gesperrt. Key auf zernio.com holen und im Panel 06 eintragen."
          : accounts === 0
            ? "Key ok, aber kein Social-Account in Zernio verbunden."
            : `${accounts} Account(s) verbunden — Versand läuft direkt aus diesem Browser.`,
        command: "Panel 06 · VERSAND → API-KEY eintragen (sk_…)",
      },
    ],
    [gateReady, localGate, gateStatus, zernioReady, accounts]
  );

  const openSteps = steps.filter((s) => !s.ok && s.id !== "open").length;
  const allGood = openSteps === 0;
  const maxAttempts = gateStatus?.maxAttempts ?? 5;
  const lockoutSchedule = gateStatus?.schedule?.length
    ? gateStatus.schedule
    : [5, 15, 60, 360, 1440];

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      /* Clipboard verweigert — kein Drama */
    }
  };

  return (
    <Section
      index="--"
      title="Einrichtung · nur ein Browser"
      hint={allGood ? "ALLES EINGERICHTET" : `${openSteps} SCHRITT(E) OFFEN`}
      complete={allGood}
      aside={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-[32px] items-center gap-1.5 border border-coal-600 px-2.5 py-1 font-mono text-[10px] font-bold tracking-widest text-coal-300 hover:border-volt-400 hover:text-volt-300"
        >
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          {open ? "ZUKLAPPEN" : "ANLEITUNG"}
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {steps.map((step) => (
          <span key={step.id} className="flex items-center gap-2">
            {step.ok ? (
              <BadgeCheck className="size-3.5 text-volt-400" />
            ) : (
              <TriangleAlert className="size-3.5 text-amber-warn" />
            )}
            <span className="mono-label text-[9.5px] text-coal-200">{step.title}</span>
          </span>
        ))}
        <button
          type="button"
          onClick={() => void onOpenShipPanel?.()}
          className="mono-label text-[9.5px] text-volt-300 underline decoration-dotted hover:text-volt-200"
        >
          → SENDEZEITEN IM PANEL 06
        </button>
      </div>

      {open && (
        <div className="mt-4 grid gap-3">
          <p className="border border-coal-700/80 bg-coal-950/50 px-3 py-2.5 font-mono text-[10px] leading-relaxed text-coal-300">
            Keine Cloud, kein Server, kein Node nötig: Die komplette Fabrik läuft{" "}
            <span className="text-volt-300">100 % im Browser</span> dieses Geräts — Ideen,
            Skripte, Stimmen und Video-Render passieren alle hier, nichts wird irgendwohin
            hochgeladen (außer beim Versand über Zernio, Panel 06). Passwort und API-Key liegen
            ausschließlich im <span className="text-volt-300">localStorage</span> dieses Geräts.
            Leichtgewichtig genug für jeden alten Laptop, ein Tablet oder einen Raspberry Pi —
            solange ein aktueller Browser läuft. Ausführlich:{" "}
            <span className="text-volt-300">docs/EINRICHTUNG.md</span>
          </p>

          {steps.map((step) => (
            <div
              key={step.id}
              className={cn(
                "border px-3 py-2.5",
                step.ok ? "border-volt-400/40 bg-volt-400/5" : "border-amber-warn/40 bg-amber-warn/5"
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  {step.ok ? (
                    <BadgeCheck className="size-3.5 shrink-0 text-volt-400" />
                  ) : (
                    <TriangleAlert className="size-3.5 shrink-0 text-amber-warn" />
                  )}
                  <span className="font-mono text-[10px] font-bold tracking-widest text-paper-100">
                    {step.title}
                  </span>
                  <span className="mono-label text-[9px] text-coal-400">{step.todo}</span>
                </span>
                <button
                  type="button"
                  onClick={() => void copy(step.id, step.command)}
                  className="flex items-center gap-1.5 border border-coal-600 px-2 py-1 font-mono text-[9px] font-bold tracking-widest text-coal-300 hover:border-volt-400 hover:text-volt-300"
                >
                  {copied === step.id ? (
                    <>
                      <BadgeCheck className="size-3" /> KOPIERT
                    </>
                  ) : (
                    <>
                      <Copy className="size-3" /> HINWEIS
                    </>
                  )}
                </button>
              </div>
              <p className="mt-1.5 font-mono text-[9.5px] leading-relaxed text-coal-300">
                {step.detail}
              </p>
              <p className="mt-1.5 overflow-x-auto border border-coal-800 bg-coal-950/70 px-2 py-1.5 font-mono text-[9.5px] whitespace-pre text-volt-300">
                {step.command}
              </p>
            </div>
          ))}

          <div className="grid gap-2 border border-coal-700/80 bg-coal-850/60 px-3 py-2.5 sm:grid-cols-2">
            <p className="flex items-start gap-2 font-mono text-[9.5px] leading-relaxed text-coal-300">
              <Lock className="mt-0.5 size-3.5 shrink-0 text-volt-300" />
              PASSWORT WECHSELN/ENTFERNEN: Einstellungen → APP. Sperren laufen so: {maxAttempts}{" "}
              VERSUCHE → {lockoutSchedule.map((m) => humanizeMinutes(m)).join(" → ")}.
            </p>
            <p className="flex items-start gap-2 font-mono text-[9.5px] leading-relaxed text-coal-300">
              <KeyRound className="mt-0.5 size-3.5 shrink-0 text-volt-300" />
              ZERNIO: Key im Panel 06 eintragen (Button <span className="text-volt-300">API</span>{" "}
              prüft die Verbindung). Social-Accounts verbindest du auf zernio.com/dashboard.
            </p>
            <p className="flex items-start gap-2 font-mono text-[9.5px] leading-relaxed text-coal-300">
              <MonitorSmartphone className="mt-0.5 size-3.5 shrink-0 text-volt-300" />
              JEDES GERÄT: Ob PC, altes Notebook, Tablet oder Raspberry-Pi-Browser — das Rendern
              passiert im Canvas des Tabs, dafür reicht schwache Hardware locker. Kein Setup außer
              „Seite öffnen“.
            </p>
            <p className="flex items-start gap-2 font-mono text-[9.5px] leading-relaxed text-coal-300">
              <Rocket className="mt-0.5 size-3.5 shrink-0 text-volt-300" />
              AUTOPILOT: Panel AP oben — ein Knopf produziert 10 Videos und sendet stündlich.
              Wichtig: <span className="text-volt-300">Tab & Bildschirm offen lassen</span> — die
              App versucht das per Wake-Lock automatisch zu sichern.
            </p>
          </div>

          <p className="flex items-start gap-2 font-mono text-[9px] leading-relaxed text-coal-500">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            SICHERHEITSHINWEIS: Das Gate ist ein Sichtschutz auf diesem Gerät — kein Bank-Login.
            Nimm ein langes Passwort. Wer Browser-Daten dieses Geräts löscht, kommt wieder rein.
          </p>
        </div>
      )}
    </Section>
  );
}
