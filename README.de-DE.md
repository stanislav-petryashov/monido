<p align="center"><a href="README.md">English</a> · <a href="README.ru-RU.md">Русский</a> · <a href="README.de-DE.md">Deutsch</a> · <a href="README.es-ES.md">Español</a> · <a href="README.fr-FR.md">Français</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.zh-CN.md">中文</a></p>

<p align="center">
  <img src="docs/assets/logo.svg" width="64" height="64" alt="Monido logo">
</p>

<h1 align="center">Monido</h1>

<p align="center">
  Nettovermögen sowie Einnahmen und Ausgaben verfolgen, allein oder als Familie. Selbst gehostet, von Hand eingetragen, ohne Bankanbindung.
</p>

<p align="center">
  <a href="https://github.com/stanislav-petryashov/monido/releases/latest"><img src="https://img.shields.io/github/v/release/stanislav-petryashov/monido" alt="Latest release"></a>
  <a href="https://github.com/stanislav-petryashov/monido/actions/workflows/docker.yml"><img src="https://img.shields.io/github/actions/workflow/status/stanislav-petryashov/monido/docker.yml?branch=master&label=CI" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/stanislav-petryashov/monido" alt="License: MIT"></a>
  <a href="https://github.com/stanislav-petryashov/monido/commits/master"><img src="https://img.shields.io/github/last-commit/stanislav-petryashov/monido" alt="Last commit"></a>
  <a href="https://github.com/stanislav-petryashov/monido/pkgs/container/monido"><img src="https://img.shields.io/badge/docker-ghcr.io-2496ED?logo=docker&logoColor=white" alt="Docker image"></a>
  <a href="https://demo.monido.dev"><img src="https://img.shields.io/badge/demo-live-5B4BE0" alt="Live demo"></a>
  <a href="https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.stanislav-petryashov/monido"><img src="https://img.shields.io/badge/MCP-registry-black" alt="MCP Registry"></a>
</p>

<p align="center">
  <a href="https://monido.dev">Website</a> · <a href="https://demo.monido.dev">Live-Demo</a> · <a href="#schnellstart">Schnellstart</a> · <a href="#dokumentation">Dokumentation</a> · <a href="#mitwirken">Bei Monido mitwirken</a> · <a href="https://github.com/stanislav-petryashov/monido/releases">Releases</a>
</p>

<p align="center">
  <img src="docs/assets/screenshot.png" width="100%" alt="Die Seite Übersicht im hellen und im dunklen Design">
</p>

## Warum Monido?

Für alle, die ihre Finanzen Monat für Monat verstehen möchten, allein oder gemeinsam als Familie.

- **Behalten Sie die Kontrolle über Ihre Daten.** Betreiben Sie Monido auf Ihrem eigenen Server, behalten Sie Datenbank und Sicherungen selbst und entscheiden Sie, welche optionalen Integrationen Sie aktivieren.
- **Sehen Sie die Finanzen der ganzen Familie.** Konten, Geldanlagen, Immobilien und Kredite in einer Ansicht, mit Beträgen nach Inhaber und Währung gruppiert.
- **Verstehen Sie Ihren Fortschritt ohne Bankanbindung.** Tragen Sie monatliche Salden ein und, wenn Sie möchten, Einnahmen und Ausgaben, um zu sehen, wie sich Ihr Nettovermögen und Ihre Ziele entwickeln. Einzelne Buchungen müssen Sie nicht täglich erfassen.

## Funktionen

- **Nettovermögen, Einnahmen und Ausgaben:** monatlicher Verlauf, Vermögensaufteilung, Einnahmen- und Ausgabenkategorien und Sparquoten. Verfolgen Sie nur Salden oder zusätzlich Einnahmen und Ausgaben.
- **Monatliche Aktualisierung:** ein Assistent „Monat abschließen“, der automatisch speichert; nur abgeschlossene Monate fließen in die Berechnungen des Dashboards ein.
- **Kredite und Immobilien:** Immobilienbewertungen, Tilgungspläne und Vergleiche von Sondertilgungen.
- **Ziele und finanzielle Unabhängigkeit:** Fortschritt, Prognosen, alternative Szenarien und Erläuterungen der Berechnungen.
- **Finanzielle Gesundheit:** Kennzahlen, ihre Schwellenwerte und die Zahlen dahinter; unvollständige Daten bleiben sichtbar.
- **Optionale Integrationen mit Claude und Telegram:** Eintragen mithilfe von Kontoauszügen, Fragen zu den Finanzen, Vorschläge an die Familie und Erinnerungen. Der Berater setzt HTTPS und entweder das Familienpasswort oder die Anmeldung über Telegram voraus; für das eigentliche Dashboard sind diese Dienste nicht nötig.
- **Für das Selbsthosten gebaut:** ein Docker-Container und eine SQLite-Datenbank, Sicherung und Wiederherstellung, Änderungsverlauf mit Rückgängigmachen unterstützter Aktionen, mehrere Währungen, helles und dunkles Design.

## Beispiele aus der Praxis

Sehen Sie sich [sieben Anwendungsfälle aus den Finanzen eines Haushalts](docs/use-cases/README.md) an: Vermögen in mehreren Währungen, Nettovermögen nach Abzug der Schulden, monatliches Sparen, Notgroschen, Sparziele, Familienentscheidungen mit dem Berater und der Monatsabschluss anhand von Kontoauszügen mit Claude. Jedes Beispiel enthält fiktive Daten, Prüfergebnisse und Grenzen.

## Schnellstart

Möchten Sie es sich zuerst ansehen? [Probieren Sie die Demo aus](https://demo.monido.dev): eine fiktive Familie, eine private Kopie für 15 Minuten, keine Installation. Das Demo-Passwort steht auf der Anmeldeseite. Änderungen betreffen nur Ihre temporäre Kopie.

Die Demo enthält weder den Claude-Berater noch die Telegram-Erinnerungen, und das Herunterladen der Datenbank ist deaktiviert. Diese Funktionen stehen in Ihrer eigenen Installation zur Verfügung. Bitte verwenden Sie in der Demo nur fiktive Daten.

Sie benötigen Docker mit Docker Compose v2.24 oder neuer (Linux oder Docker Desktop unter macOS). In einem neuen Ordner:

```bash
mkdir family-finance && cd family-finance
curl -fsSLO https://raw.githubusercontent.com/stanislav-petryashov/monido/master/docker-compose.yml
docker compose up -d
```

Öffnen Sie innerhalb von 15 Minuten http://127.0.0.1:8080 und legen Sie das Familienpasswort fest. Die Anmeldung per Passwort oder Telegram verwalten Sie in der Weboberfläche; Servereinstellungen (Port, Adresse) gehören in eine optionale `.env` ([`.env.example`](.env.example), [die vollständige Anleitung](docs/deploy-docker.md#installation)). Zum Aktualisieren: `docker compose pull && docker compose up -d`. Funktioniert etwas nicht? [Fehlerbehebung](docs/deploy-docker.md#troubleshooting).

Die Daten liegen in einem Docker-Volume, das nach dem Ordner benannt ist (`family-finance_data`); `docker compose down -v` würde es löschen, fügen Sie `-v` also niemals hinzu.

## Bezugsquellen

- **Docker Compose** auf jedem Linux-Server oder mit Docker Desktop: siehe [Schnellstart](#schnellstart). Das Image ist `ghcr.io/stanislav-petryashov/monido` (amd64 und arm64).
- **Unraid:** Suchen Sie in den Community Applications nach Monido. Es läuft als Eigentümer des Datenordners (standardmäßig `PUID` 99, `PGID` 100).
- **PikaPods** (verwaltetes Hosting): noch nicht verfügbar. [Stimmen Sie für Monido ab](https://feedback.pikapods.com/posts/1289/monido-self-hosted-family-net-worth-and-cash-flow-tracker), damit es aufgenommen wird.
- **Claude-Connector (MCP):** gelistet in der [offiziellen MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.stanislav-petryashov/monido) und auf [Glama](https://glama.ai/mcp/servers/stanislav-petryashov/monido).

## Sprachen

Die Oberfläche gibt es auf Englisch, Russisch, Deutsch, Spanisch, Französisch, brasilianischem Portugiesisch und vereinfachtem Chinesisch. Die deutschen, spanischen, französischen, portugiesischen und chinesischen Texte sind maschinelle Übersetzungen, die noch von Muttersprachlern geprüft werden müssen. Korrekturen sind willkommen: siehe [Translating](docs/translating.md). Diese README ist eine Übersetzung der englischen; weichen beide voneinander ab, gilt die englische.

[![Translation status](https://hosted.weblate.org/widget/monido/svg-badge.svg)](https://hosted.weblate.org/engage/monido/)

Die Übersetzungen werden auf [Weblate](https://hosted.weblate.org/engage/monido/) gepflegt: Sprache wählen, Texte korrigieren oder freigeben, und die Änderungen kommen als Pull-Request in dieses Repository.

## Dokumentation

Die Dokumentation ist auf Englisch.

- [Benutzerhandbuch](docs/user-guide.md): die Seiten, die monatliche Aktualisierung und die Einstellungen.
- [Konfiguration](docs/configuration.md): Umgebungsvariablen, Anmeldemodi und optionale Integrationen.
- [Bereitstellung](docs/deploy-docker.md): Docker, HTTPS hinter einem Reverse Proxy, Aktualisierungen und Sicherungen, die öffentliche Demo.
- [Entwicklung](docs/development.md): Ausführen aus dem Quellcode, die Befehle und die Screenshots.
- [Architektur](docs/architecture.md): die Codeübersicht, das Datenmodell und Anleitungen.
- [Finanzregeln](docs/finance-rules.md): wie jede Kennzahl berechnet und bewertet wird.
- [Datenbankschema](docs/schema.md): die aktuellen Tabellen und Kompatibilitätsregeln.
- [Designsystem](docs/design-system.md): Tokens, Komponenten und Regeln für die Oberfläche.
- [Pflege](docs/maintaining.md): die erste öffentliche Veröffentlichung und das Erstellen eines Releases.

## Mitwirken

Beiträge können Code sein, verständlichere Dokumentation, Korrekturen an Übersetzungen, Verbesserungen der Barrierefreiheit, Überprüfungen der Berechnungen oder Erfahrungsberichte aus einer echten selbst gehosteten Installation.

Beginnen Sie mit [CONTRIBUTING.md](CONTRIBUTING.md) für die Einrichtung und die Richtlinien für Beiträge. [Eröffnen Sie ein Issue](https://github.com/stanislav-petryashov/monido/issues/new/choose), um ein Problem zu melden oder vor einer größeren Änderung eine Idee zu besprechen. Möchten Sie einen Bereich längerfristig mitbetreuen? Schreiben Sie uns, welchen Teil Sie nutzen und an welchem Sie arbeiten möchten.

Wenn Monido Ihnen nützt, helfen ein Stern oder eine Empfehlung an jemanden, der es braucht, dem Projekt.

## Sicherheit

Anmeldung, Sitzungen, Drosselung, die Content-Security-Policy und wie Sie eine Sicherheitslücke vertraulich melden: [SECURITY.md](SECURITY.md).

## Lizenz

[MIT](LICENSE).
