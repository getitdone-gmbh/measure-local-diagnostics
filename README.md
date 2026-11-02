# measure-local-diagnostics

Import und Auswertung von Diagnose-Exporten, die eine App lokal mit dem [Measure](https://github.com/measure-sh/measure)-SDK sammelt: Abstürze, Hänger, der Verlauf vor dem Fehler und Symbolisierung.

Gedacht für Apps, die keine Diagnosedaten an einen Server schicken dürfen. Die App fängt die Uploads von Measure auf dem Gerät ab, schreibt sie in JSONL-Dateien und gibt sie nur über einen Export frei, den die Nutzerin oder der Nutzer selbst anstößt. Dieses Werkzeug liest solche Exporte ein und macht sie auswertbar. Unterstützt werden derzeit iOS-Exporte, Android ist geplant.

## Funktionen

- **Import** von Exporten per Drag & Drop. Doppelte Exporte und überlappende Einträge werden erkannt.
- **Issues**: Abstürze und Hänger werden über die obersten eigenen Frames gruppiert. Pro Issue gibt es Status und Notiz.
- **Vorkommen**:
  - Kontext: Gerät, OS, App-Version, Netz, Prozess (App oder Extension).
  - Absturz-Thread mit eigenen Frames, Bibliotheken und System-Frames getrennt markiert, dazu alle weiteren Threads.
  - Einträge der Session vor dem Fehler: Taps, View-Controller, HTTP, Logs, CPU, Speicher, Lücken ohne Aktivität.
  - Export als Markdown für Tickets.
- **Symbolisierung**: dSYM-ZIP hochladen. Gespeichert wird nur die kompakte SymCache, Swift-Namen werden lesbar gemacht.
- **Einträge**: Suche und Filter über alle Zeilen aller Importe, die Filter stehen in der URL.
- **Löschfrist**: Importe werden nach `RETENTION_DAYS` (Standard 90) automatisch gelöscht.

## So liest du einen Absturz

Die Screenshots zeigen Demodaten einer kleinen Notizen-App mit hochgeladenen dSYMs.

### 1. Export importieren

<img src="docs/screenshots/1-imports.png" alt="Seite Importe mit Upload-Feld und einer Importzeile" width="800">

1. Export-ZIP aus der App hierher ziehen. Jeder Export wird nur einmal übernommen, überlappende Exporte desselben Geräts ergänzen sich.
2. Jede Zeile zeigt, was der Export gebracht hat: die Issues und alle Einträge dieses Imports, beides direkt verlinkt.

### 2. Issue auswählen

<img src="docs/screenshots/2-issues.png" alt="Liste der Issues mit Filtern" width="800">

1. Weitere Exporte kommen über die Importe-Seite dazu.
2. Filter nach Status und Import. Nach einem Upload zeigt die Liste alle Status des neuen Exports, damit ein wieder aufgetretener Fehler nicht versteckt bleibt.
3. Gleiche Fehler sind zu einem Issue zusammengefasst, benannt nach Fehlerart und oberstem eigenen Frame.
4. Wie oft der Fehler vorkam, über alle Importe.

### 3. Überblick über das Issue

<img src="docs/screenshots/3-issue-head.png" alt="Kopf der Issue-Seite mit Titel, Aktionen, Reitern und Kennzahlen" width="800">

1. Vor und zurück durch die Liste, mit dem Filter von dort.
2. Die Stelle als Überschrift, darunter Fehlerart, Grund, Prozess, Version, Gerät und Zeit.
3. Status setzen, die Einträge rund um den Absturz öffnen, das Vorkommen als Markdown für ein Ticket kopieren.
4. Stacktrace, alle Threads, die Einträge der Session, alle Vorkommen und die Binaries, jeweils mit Anzahl.
5. Kennzahlen über alle Vorkommen.

### 4. Stack und Kontext

<img src="docs/screenshots/4-issue-body.png" alt="Stacktrace mit markierter Absturzstelle und Kontext-Spalte" width="800">

1. Zwischen allen Frames und nur eigenem Code umschalten.
2. Die Absturzstelle ist hinterlegt. System-Frames von iOS bleiben Adressen, dafür fehlen die Symbole von Apple.
3. Längere Folgen von System-Frames sind eingeklappt.
4. Eigener Code mit Funktion, Datei und Zeile, sobald die dSYMs des Builds hochgeladen sind.
5. Kontext des gewählten Vorkommens: Zeitraum des Absturzes, Prozess, Version, Gerät, Netz und der Import, aus dem es stammt.
6. Notiz zum Issue, zum Beispiel Ticket oder Ursache. Sie wird mit Enter oder beim Verlassen des Felds gespeichert.

### 5. Was davor passiert ist

<img src="docs/screenshots/5-entries.png" alt="Einträge der Session bis zum Absturz" width="800">

1. Nach Bedienschritten, App-Logs oder Netzwerk filtern.
2. Jede Zeile mit Abstand zum Absturz, Uhrzeit, Prozess und Art, hier der letzte Tipp vor dem Absturz.
3. Ein Absturz wird erst beim nächsten Start gespeichert. Die Lücke bis dahin ist als Neustart markiert, nicht als Hänger.
4. Der Absturz selbst, mit Grund.

Auf dem Handy liegen Kontext und Kennzahlen hinter dem Knopf „Details“.

## Exportformat

Ein Export ist ein ZIP mit einem Ordner, darin `manifest.json` und eine oder mehrere `*.jsonl`-Dateien. Jede Zeile ist ein JSON-Objekt:

```json
{"process":"app","kind":"app_log","timestamp":"2026-11-02T09:54:19.120Z","level":"error","category":"Sync","message":"…"}
{"process":"app","kind":"event","data":{"type":"exception","session_id":"…","exception":{"exceptions":[…],"threads":[…],"binary_images":[…]}}}
{"process":"autofill","kind":"span","data":{"name":"…","start_time":"…","duration":42}}
```

- `kind: event` enthält Measure-Events unverändert (`exception`, `app_hang`, `gesture_click`, `http`, `lifecycle_*`, `cold_launch`, …).
- `process` unterscheidet App und Extension.
- `manifest.json` nennt mindestens `app_version`, `app_build`, `bundle_id`, `exported_at` und `files`.

## Aufbau

| Teil | Technik |
|---|---|
| `api/` | FastAPI, Postgres, `symbolic` 10.2.1 (letzte Version mit Swift-Demangling) |
| `web/` | React, Vite, [`@getitdone-gmbh/kette-design-community`](https://www.npmjs.com/package/@getitdone-gmbh/kette-design-community), Login per OIDC (Keycloak, PKCE) |
| `tools/` | Upload der dSYMs neuer Xcode-Archive |

## Lokal starten

```bash
cd api && python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q tests        # nutzt ein eingebettetes Postgres (pgserver)
DATABASE_URL=postgresql://… AUTH_DISABLED=1 .venv/bin/uvicorn app.main:app --port 8000
cd ../web && npm install && npm run build && PORT=8080 API_URL=http://localhost:8000 npm start
```

Ohne `OIDC_ISSUER` läuft die Web-App ohne Login. Die API braucht dafür `AUTH_DISABLED=1`, das ist nur für die lokale Entwicklung gedacht.

## Betrieb

| Variable | Dienst | Bedeutung |
|---|---|---|
| `DATABASE_URL` | api | Postgres-Verbindung |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID` | api, web | Login; die API prüft das Token gegen den Issuer |
| `WEB_ORIGIN` | api | erlaubte Herkunft für CORS |
| `RETENTION_DAYS` | api | Löschfrist für Importe, Standard 90 |
| `MAX_UPLOAD_MB` | api | Größenlimit für Exporte und dSYMs |
| `SYMBOLS_UPLOAD_TOKEN` | api | Schlüssel, mit dem `tools/upload-dsyms.sh` ohne Login dSYMs hochladen darf |
| `API_URL` | web | Adresse der API |

`itdone.yaml` ist eine Beispielkonfiguration für [itdone.cloud](https://itdone.cloud) mit Postgres- und Keycloak-Add-on.

## dSYMs automatisch hochladen

Ein LaunchAgent auf dem Mac lädt die dSYMs jedes neuen Xcode-Archivs hoch. Im App-Repo und im Xcode-Projekt ändert sich dafür nichts.

```bash
DIAGNOSTICS_API_URL=https://… DIAGNOSTICS_UPLOAD_TOKEN=… DIAGNOSTICS_BUNDLE_ID_PATTERN='com.example.*' \
  tools/install-archive-watcher.sh                  # installieren
tools/install-archive-watcher.sh --uninstall        # entfernen
tools/upload-dsyms.sh <Pfad/zum/Archiv.xcarchive>   # einzelnes Archiv nachreichen
```

- `tools/archive-watcher.swift` beobachtet `~/Library/Developer/Xcode/Archives` per FSEvents. Sobald Xcode die `Info.plist` eines Archivs schreibt (das passiert zuletzt), lädt `upload-dsyms.sh` dessen `dSYMs` mit Version, Build und Archivzeit hoch.
- Die Einstellungen landen in `~/Library/Application Support/measure-local-diagnostics/config`, nur für den eigenen Benutzer lesbar. Umgebungsvariablen haben Vorrang.
- `DIAGNOSTICS_BUNDLE_ID_PATTERN` ist ein Shell-Muster. Ohne Angabe werden alle Archive hochgeladen.
- Bereits hochgeladene Archive stehen in `uploaded-archives.txt` im selben Ordner, das Log in `~/Library/Logs/measure-local-diagnostics-archive-watcher.log`.

## Datenschutz

Exporte enthalten Logs, Gerätedaten und den Verlauf einer Session. Echte Exporte gehören nicht in dieses Repo. Ein Test mit echten Daten läuft nur lokal: `LOCAL_EXPORT=<zip> LOCAL_DSYMS=<ordner> pytest`.

## Lizenz

[Apache-2.0](LICENSE)
