import { useMemo, useState } from "react";
import {
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  Copy,
  KeyRound,
  Lock,
  Rocket,
  ServerCog,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import Section from "./Section";
import { cn } from "../utils/cn";
import { humanizeMinutes, type GateStatus } from "../lib/gate";
import type { ZernioStatus } from "../lib/zernio";

/**
 * Einrichtungs-Assistent — oben in der Fabrik, sagt in Klartext, was fehlt.
 * Das ganze System läuft mit EINEM Befehl auf dem eigenen Rechner (auch Pi):
 *
 *     npm start        (oder ./start.sh — baut die App sogar selbst)
 *
 * Konfiguration passiert in einer einfachen `.env`-Datei im Projektroot:
 *   1. Passwortschutz   → `APP_PASSWORD=…` (IP-Rate-Limit läuft im Prozess)
 *   2. Zernio-Versand   → `ZERNIO_API_KEY=sk_…`
 *   3. Port             → optional `PORT=8080`
 *
 * Vollständige Anleitung mit Raspberry-Pi-Quickstart: docs/EINRICHTUNG.md
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
  const serverGate = gateStatus?.mode === "server";
  const localGate = gateStatus?.mode === "local";
  const serverUp = Boolean(gateStatus?.serverReachable);
  const zernioReady = Boolean(zernioStatus?.configured);
  const zernioViaEnv = zernioReady && zernioStatus?.via !== "direct";
  const accounts = zernioStatus?.accounts.length ?? 0;

  const steps = useMemo(
    () => [
      {
        id: "start",
        ok: true,
        title: "APP STARTEN",
        todo: "ein Befehl genügt",
        detail: serverUp
          ? "Der eingebaute Server läuft — App, Stimmen, Passwort-Gate und Zernio-Relay kommen von ihm."
          : "App läuft ohne Server (rein statisch): Browser-Stimmen aktiv, Versand nur mit App-Key (Panel 06). Empfohlen: npm start.",
        command:
          "npm start        # baut die App beim ersten Mal selbst und startet den Server (Port 8080)",
      },
      {
        id: "gate",
        ok: gateReady,
        title: "PASSWORT-SCHUTZ",
        todo: serverGate ? "aktiv (.env)" : localGate ? "aktiv (lokal)" : "optional",
        detail: serverGate
          ? `${gateStatus?.maxAttempts ?? 5} Fehlversuche → eskalierende Sperre (${(gateStatus?.schedule ?? [5, 15, 60, 360, 1440])
              .map((m) => humanizeMinutes(m))
              .join(" → ")}). Läuft im Server-Prozess, Neustart setzt Zähler zurück.`
          : localGate
            ? "Lokaler Schutz auf diesem Gerät (kein Server). Für echten IP-Schutz: APP_PASSWORD in die .env."
            : "Offen: jeder kann die Seite aufrufen. APP_PASSWORD fehlt in der .env.",
        command:
          '# .env im Projektroot anlegen:\nAPP_PASSWORD=ganz-langes-passwort   # danach: npm start (Neustart genügt)',
      },
      {
        id: "zernio",
        ok: zernioReady && accounts > 0,
        title: "ZERNIO-VERSAND",
        todo: "ZERNIO_API_KEY + Social-Account",
        detail: !zernioReady
          ? "Kein Key — Versand-Panel ist gesperrt. Key auf zernio.com holen und in die .env schreiben."
          : accounts === 0
            ? `Key ok (${zernioViaEnv ? "Server-.env" : "App-Key"}), aber kein Social-Account in Zernio verbunden.`
            : `${accounts} Account(s) verbunden — Versand läuft über ${zernioViaEnv ? "die Server-.env" : "den lokalen App-Key"}.`,
        command:
          "# .env im Projektroot:\nZERNIO_API_KEY=sk_…   # danach: npm start — Accounts: zernio.com/dashboard",
      },
    ],
    [gateReady, serverGate, localGate, serverUp, gateStatus, zernioReady, zernioViaEnv, accounts]
  );

  const openSteps = steps.filter((s) => !s.ok && s.id !== "start").length;
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
      title="Einrichtung · ein Server, ein Befehl"
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
            Keine Cloud nötig: die komplette Fabrik läuft mit <span className="text-volt-300">npm start</span>{" "}
            auf dem eigenen Rechner — auch auf einem <span className="text-volt-300">Raspberry Pi</span>.
            Alles Wichtige landet in einer <span className="text-volt-300">.env</span>-Datei im
            Projektroot (Beispiel: <span className="text-volt-300">.env.example</span> kopieren).
            Danach einmal neu starten — mehr ist es nicht. Ausführlich inklusive Pi-Ersteinrichtung:{" "}
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
                      <Copy className="size-3" /> BEFEHL
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
              PASSWORT WECHSELN: neuen Wert in die .env schreiben → Server neu starten. Sperren
              laufen so: {maxAttempts} VERSUCHE →{" "}
              {lockoutSchedule.map((m) => humanizeMinutes(m)).join(" → ")}.
              Werkzeug für einen Hash statt Klartext: `npm run password:hash`.
            </p>
            <p className="flex items-start gap-2 font-mono text-[9.5px] leading-relaxed text-coal-300">
              <KeyRound className="mt-0.5 size-3.5 shrink-0 text-volt-300" />
              ZERNIO: Key in die .env → neu starten → Panel 06 prüfen (Button{" "}
              <span className="text-volt-300">API</span>). Social-Accounts verbindest du auf
              zernio.com/dashboard.
            </p>
            <p className="flex items-start gap-2 font-mono text-[9.5px] leading-relaxed text-coal-300">
              <ServerCog className="mt-0.5 size-3.5 shrink-0 text-volt-300" />
              RASPBERRY PI: `git clone` → `./start.sh` → im Browser http://pi-IP:8080 öffnen.
              Rendern passiert im BROWSER des Geräts vor dem Bildschirm — der Pi muss das Video
              nicht selbst codieren, er dient nur die App aus.
            </p>
            <p className="flex items-start gap-2 font-mono text-[9.5px] leading-relaxed text-coal-300">
              <Rocket className="mt-0.5 size-3.5 shrink-0 text-volt-300" />
              AUTOPILOT: Panel AP oben — ein Knopf produziert 10 Videos und sendet stündlich.
              Wichtig: <span className="text-volt-300">Tab offen lassen</span> (Versand-Tab im
              Vordergrund beim Rendern).
            </p>
          </div>

          <p className="flex items-start gap-2 font-mono text-[9px] leading-relaxed text-coal-500">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            SICHERHEITSHINWEIS: Das Gate ist ein Sichtschutz plus serverseitige IP-Sperre — kein
            Bank-Login. Nimm ein langes Passwort. Der Server bindet an 0.0.0.0 (Heimnetz) — willst
            du ihn von außen erreichbar machen, leg ihn hinter HTTPS (z.B. Caddy/Tailscale).
          </p>
        </div>
      )}
    </Section>
  );
}
