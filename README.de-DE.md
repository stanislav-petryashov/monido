[English](README.md) · [Русский](README.ru-RU.md) · [Deutsch](README.de-DE.md) · [Español](README.es-ES.md) · [Français](README.fr-FR.md) · [Português](README.pt-BR.md) · [中文](README.zh-CN.md)

![Monido-Logo](docs/assets/logo.svg)

# Monido

Behalten Sie Ihr Nettovermögen und Ihre Einnahmen und Ausgaben im Blick, allein oder als Familie. Selbst gehostet, von Hand eingetragen, ohne Bankanbindung.

[![Latest release](https://img.shields.io/github/v/release/stanislav-petryashov/monido)](https://github.com/stanislav-petryashov/monido/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/stanislav-petryashov/monido/docker.yml?branch=master&label=CI)](https://github.com/stanislav-petryashov/monido/actions/workflows/docker.yml) [![License: MIT](https://img.shields.io/github/license/stanislav-petryashov/monido)](LICENSE) [![Last commit](https://img.shields.io/github/last-commit/stanislav-petryashov/monido)](https://github.com/stanislav-petryashov/monido/commits/master)

[![Docker image](https://img.shields.io/badge/docker-ghcr.io-2496ED?logo=docker&logoColor=white)](https://github.com/stanislav-petryashov/monido/pkgs/container/monido) [![Live demo](https://img.shields.io/badge/demo-live-5B4BE0)](https://demo.monido.dev) [![MCP Registry](https://img.shields.io/badge/MCP-registry-black)](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.stanislav-petryashov/monido)

[Website](https://monido.dev) · [Live-Demo](https://demo.monido.dev) · [An Monido mitarbeiten](CONTRIBUTING.md) · [Releases](https://github.com/stanislav-petryashov/monido/releases)

[Live-Demo ausprobieren](https://demo.monido.dev): eine erfundene Familie in einer privaten Kopie für 15 Minuten, ohne Installation; das Passwort steht auf dem Anmeldebildschirm.

![Alles, was Sie besitzen und schulden. Eine Zahl. Konten, Depots, Immobilien und Kredite der ganzen Familie, in jeder Währung.][Screens/de-DE/hero]

## Welche Fragen Monido beantwortet

- **Wie viel besitzen wir nach Abzug der Schulden?** Konten, Geldanlagen, Immobilien und Kredite aller Familienmitglieder, in jeder Währung, in einer Zahl. [Beispiel](docs/use-cases/family-net-worth.md)
- **Sind wir dieses Jahr reicher geworden, oder haben sich nur Preise und Wechselkurse bewegt?** Das Nettovermögen im Zeitverlauf und sein reales Wachstum nach Inflation in der Währung, in der Sie ausgeben. [Beispiel](docs/use-cases/wealth-change.md) · [Formel](docs/finance-rules.md#rule-4-real-net-worth-growth-real_growth_yoy)
- **Wie viel haben wir selbst gespart, und wie viel ist von allein gewachsen?** Ersparnisse und Sparquote pro Monat und das Wachstum darüber hinaus. [Beispiel](docs/use-cases/monthly-savings.md) · [Formel](docs/finance-rules.md#growth-beyond-savings-growth_beyond_savings)
- **Wie lange kämen wir ohne Einkommen aus?** Der Notgroschen in Monaten an Ausgaben. [Beispiel](docs/use-cases/emergency-reserve.md) · [Formel](docs/finance-rules.md#rule-1-emergency-fund-emergency_months)
- **Wann erreichen wir unsere Ziele, und können wir uns das leisten?** Zieltermine aus dem, was Sie tatsächlich sparen; mit dem optionalen Claude-Berater wird ein Kauf oder ein Kredit an Ihren eigenen Zahlen gemessen und der Familie zur Abstimmung vorgelegt. [Ziele](docs/use-cases/savings-goal.md) · [Eine Familienentscheidung](docs/use-cases/family-decision.md)

## Schnellstart

Sie brauchen Docker mit Docker Compose v2.24 oder neuer (Linux oder Docker Desktop unter macOS). In einem neuen Ordner:

```bash
mkdir monido && cd monido
curl -fsSLO https://raw.githubusercontent.com/stanislav-petryashov/monido/master/docker-compose.yml
docker compose up -d
```

Öffnen Sie innerhalb von 15 Minuten http://127.0.0.1:8080 und legen Sie das Familienpasswort fest. Servereinstellungen (Port, Adresse) gehören in eine optionale `.env` ([`.env.example`](.env.example), [die vollständige Anleitung](docs/deploy-docker.md#installation)). Zum Aktualisieren: `docker compose pull`, dann `docker compose up -d`. Etwas funktioniert nicht? [Fehlerbehebung](docs/deploy-docker.md#troubleshooting).

**Was es braucht:** einen Container (Node und SQLite, kein separater Datenbankserver) für amd64 und arm64, ein Raspberry Pi oder ein NAS genügt also; im Leerlauf unter 60 MB Arbeitsspeicher (`docker stats` auf der Demo und einer Installation zu Hause, Versionen 1.2 bis 1.4) und ein Image von 250 MB.

Die Daten liegen in einem Docker-Volume, das nach dem Ordner benannt ist (`monido_data`); `docker compose down -v` würde es löschen, hängen Sie also nie `-v` an. Die Demo hat keinen Claude-Berater und keine Telegram-Erinnerungen und kann ihre Datenbank nicht herunterladen; Ihre eigene Installation hat das alles.

## Ansichten

![Einmal im Monat: ein Saldo pro Konto. Der Assistent prüft, ob jedes Konto ausgefüllt ist, und nimmt den Monat dann in die Übersicht auf. Gespeichert wird beim Tippen.][Screens/de-DE/close]

![Wann Sie jedes Ziel erreichen. Termine aus dem, was die Familie wirklich spart, und was sie verschieben würde.][Screens/de-DE/goals]

![War dieser Monat ein gewöhnlicher? Einnahmen, Ausgaben und Ersparnis im Vergleich zu Ihrem typischen Monat.][Screens/de-DE/cashflow]

![Was der Familie gehört, und wem. Nach Art, Eigentümer und Währung, mit den Veränderungen des Monats.][Screens/de-DE/assets]

![Wie solide stehen wir da? Notgroschen, Schuldenlast und Sparquote, jeweils mit Schwelle und Formel.][Screens/de-DE/health]

![Dieselben Zahlen auf dem Handy. Jede Seite funktioniert auf kleinen Bildschirmen, hell und dunkel.][Screens/de-DE/phone]

**Berater** (optional): eine Entscheidung mit ihren Folgen, über die die Familie abstimmt

![Berater: ein Vorschlag an die Familie mit seinen Folgen und den Stimmen](docs/use-cases/assets/UC-07-voter.png)


## Wie es funktioniert und was es nicht ist

Einmal im Monat trägt die Familie den Saldo jedes Kontos zum Monatsende ein und, wenn Sie die Zahlen zu Einnahmen und Ausgaben möchten, die Einnahmen und Ausgaben des Monats; „Monat abschließen“ prüft, ob jedes Konto ausgefüllt ist, und nimmt den Monat dann ins Dashboard auf. Nur abgeschlossene Monate zählen, jede Zahl berechnet die App aus dem Eingetragenen, und jede Formel ist in den [Finanzregeln](docs/finance-rules.md) aufgeschrieben.

Monido passt zu Ihnen, wenn Sie einen Container auf einem Heimserver, einem NAS oder einem VPS betreiben können, das Geld der Familie auf mehrere Banken, Währungen und Immobilien verteilt ist und Sie das Vermögen und seine Richtung sehen wollen statt jedes einzelnen Einkaufs.

Es ist kein tägliches Haushaltsbuch, kein Umschlagbudget und kein Depot-Tracker mit Live-Kursen, und es verbindet sich nie mit einer Bank und bewegt kein Geld. Für ein Haushaltsbuch Buchung für Buchung oder Budgets schauen Sie sich Firefly III oder Actual Budget an, für Live-Kurse von Geldanlagen Ghostfolio.

## Funktionen

- **Nettovermögen, Einnahmen und Ausgaben:** Monatsverlauf, Aufteilung nach Inhaber, Währung und Anlageart, Kategorien für Einnahmen und Ausgaben, Sparquoten; für den Anfang genügen die Salden.
- **Kredite und Immobilien:** Tilgungspläne, Vergleiche von Sondertilgungen und Immobilienbewertungen.
- **Ziele und finanzielle Unabhängigkeit:** Fortschritt, Prognosen, Alternativen und die Rechnung hinter jedem Termin.
- **Finanzielle Gesundheit:** Kennzahlen mit ihren Schwellenwerten und Eingangsdaten; fehlende Daten werden angezeigt und nie als null gewertet.
- **Für die Familie:** gemeinsame Einträge, Anmeldung mit einem Familienpasswort oder einzeln über Telegram, Rechte pro Mitglied, Erinnerungen und Vorschläge in Telegram.
- **Selbst hosten:** Sicherung und Wiederherstellung, alle Daten als CSV exportierbar, Änderungsverlauf mit Rückgängig, mehrere Währungen, sieben Sprachen, helles und dunkles Design.

## Datenschutz und KI

Ihre Daten bleiben in der SQLite-Datenbank auf Ihrem Server. Der Server selbst sendet nur eine Anfrage nach Wechselkursen (an Frankfurter oder an Ihre eigene Instanz) und einmal am Tag den Image-Namen, um nach Updates zu suchen (`UPDATE_CHECK=off` schaltet das ab); Telegram wird nur kontaktiert, wenn Sie es einschalten. Der Kern enthält keine KI: Der Claude-Berater ist aus, bis Sie Ihr eigenes Claude-Konto verbinden, und dann gehen Ihr Gespräch und die Zahlen, die Claude abfragt, über dieses Konto an Anthropic, nie über die App.

## Projektstatus

Monido ist jung: Seine öffentliche Geschichte beginnt im November 2026, es hat einen Maintainer und erscheint oft in neuen Versionen (siehe [Releases](https://github.com/stanislav-petryashov/monido/releases) und das [Changelog](CHANGELOG.md)). Updates erhalten Ihre Daten: Eine vorhandene Datenbank wird bei jedem Start geprüft und nie ohne Ihr Wissen verändert, und Sie können vor dem Update [eine Kopie herunterladen](docs/deploy-docker.md#backup-and-restore). Fünf der sieben Sprachen sind maschinelle Übersetzungen, die noch geprüft werden müssen. Was als Nächstes kommt, steht in der [Roadmap](https://github.com/stanislav-petryashov/monido/discussions/27).

## Bezugsquellen

- **Docker Compose** auf jedem Linux-Server oder mit Docker Desktop: siehe Schnellstart. Das Image ist `ghcr.io/stanislav-petryashov/monido` (amd64 und arm64).
- **Unraid:** Suchen Sie in den Community Applications nach Monido. Es läuft als Eigentümer des Datenordners (standardmäßig `PUID` 99, `PGID` 100).
- **PikaPods** (verwaltetes Hosting): noch nicht verfügbar. [Stimmen Sie für Monido](https://feedback.pikapods.com/posts/1289/monido-self-hosted-family-net-worth-and-cash-flow-tracker), damit es aufgenommen wird.
- **Claude-Connector (MCP):** eingetragen in der [offiziellen MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.stanislav-petryashov/monido) und auf [Glama](https://glama.ai/mcp/servers/stanislav-petryashov/monido).

## Sprachen

Die Oberfläche gibt es auf Englisch, Russisch, Deutsch, Spanisch, Französisch, brasilianischem Portugiesisch und vereinfachtem Chinesisch. Die deutschen, spanischen, französischen, portugiesischen und chinesischen Texte sind maschinelle Übersetzungen, die noch von Muttersprachlern geprüft werden müssen. Korrekturen sind willkommen: siehe [Übersetzen](docs/translating.md). Diese README ist eine Übersetzung der englischen; bei Abweichungen gilt die englische Fassung.

[![Übersetzungsstatus](https://hosted.weblate.org/widget/monido/svg-badge.svg)](https://hosted.weblate.org/engage/monido/)

Die Übersetzungen werden auf [Weblate](https://hosted.weblate.org/engage/monido/) gepflegt: Wählen Sie Ihre Sprache, korrigieren oder bestätigen Sie Texte, und die Änderungen kommen als Pull Request in dieses Repository zurück.

## Dokumentation (auf Englisch)

- [Durchgerechnete Beispiele](docs/use-cases/README.md): sieben Fragen aus dem Haushalt mit erfundenen Daten, Prüfergebnissen und Grenzen.
- [Benutzerhandbuch](docs/user-guide.md): die Seiten, die monatliche Aktualisierung und die Einstellungen.
- [Konfiguration](docs/configuration.md): Umgebungsvariablen, Anmeldemodi und optionale Integrationen.
- [Bereitstellung](docs/deploy-docker.md): Docker, HTTPS hinter einem Reverse Proxy, Updates und Sicherungen, die öffentliche Demo.
- [Entwicklung](docs/development.md): Start aus dem Quellcode, die Befehle und die Screenshots.
- [Architektur](docs/architecture.md): die Code-Übersicht, das Datenmodell und Anleitungen.
- [Finanzregeln](docs/finance-rules.md): wie jede Kennzahl berechnet und bewertet wird.
- [Datenbankschema](docs/schema.md): die aktuellen Tabellen und die Kompatibilitätsregeln.
- [Designsystem](docs/design-system.md): Tokens, Komponenten und Regeln für die Oberfläche.
- [Maintenance](docs/maintaining.md): das erste öffentliche Release und das Erstellen eines Releases.

## Mitwirken

Beiträge können Code sein, verständlichere Dokumentation, Korrekturen an Übersetzungen, Verbesserungen der Barrierefreiheit, Nachprüfungen der Berechnungen oder Berichte aus einer echten selbst gehosteten Installation.

Beginnen Sie mit [CONTRIBUTING.md](CONTRIBUTING.md) für die Einrichtung und die Richtlinien für Beiträge. [Eröffnen Sie ein Issue](https://github.com/stanislav-petryashov/monido/issues/new/choose), um ein Problem zu melden; Fragen und Ideen, auch vor einer größeren Änderung, besprechen Sie in den [Discussions](https://github.com/stanislav-petryashov/monido/discussions). Issues mit dem Label [good first issue](https://github.com/stanislav-petryashov/monido/labels/good%20first%20issue) sind ein kleiner, abgeschlossener Einstieg. Sie möchten einen Bereich über längere Zeit mitbetreuen? Schreiben Sie uns, welchen Teil Sie nutzen und an welchem Sie arbeiten möchten.

Wenn Monido Ihnen nützt, helfen ein Stern oder eine Empfehlung an jemanden, der es braucht, dem Projekt.

## Sicherheit

Anmeldung, Sitzungen, Drosselung, die Content-Security-Policy und wie Sie eine Schwachstelle vertraulich melden: [SECURITY.md](SECURITY.md).

## Lizenz

[MIT](LICENSE).

[screens/en-US/hero]: docs/assets/screens/en-US/hero.webp
[screens/en-US/close]: docs/assets/screens/en-US/close.webp
[screens/en-US/goals]: docs/assets/screens/en-US/goals.webp
[screens/en-US/cashflow]: docs/assets/screens/en-US/cashflow.webp
[screens/en-US/assets]: docs/assets/screens/en-US/assets.webp
[screens/en-US/health]: docs/assets/screens/en-US/health.webp
[screens/en-US/phone]: docs/assets/screens/en-US/phone.webp
[screens/ru-RU/hero]: docs/assets/screens/ru-RU/hero.webp
[screens/ru-RU/close]: docs/assets/screens/ru-RU/close.webp
[screens/ru-RU/goals]: docs/assets/screens/ru-RU/goals.webp
[screens/ru-RU/cashflow]: docs/assets/screens/ru-RU/cashflow.webp
[screens/ru-RU/assets]: docs/assets/screens/ru-RU/assets.webp
[screens/ru-RU/health]: docs/assets/screens/ru-RU/health.webp
[screens/ru-RU/phone]: docs/assets/screens/ru-RU/phone.webp
[screens/de-DE/hero]: docs/assets/screens/de-DE/hero.webp
[screens/de-DE/close]: docs/assets/screens/de-DE/close.webp
[screens/de-DE/goals]: docs/assets/screens/de-DE/goals.webp
[screens/de-DE/cashflow]: docs/assets/screens/de-DE/cashflow.webp
[screens/de-DE/assets]: docs/assets/screens/de-DE/assets.webp
[screens/de-DE/health]: docs/assets/screens/de-DE/health.webp
[screens/de-DE/phone]: docs/assets/screens/de-DE/phone.webp
[screens/es-ES/hero]: docs/assets/screens/es-ES/hero.webp
[screens/es-ES/close]: docs/assets/screens/es-ES/close.webp
[screens/es-ES/goals]: docs/assets/screens/es-ES/goals.webp
[screens/es-ES/cashflow]: docs/assets/screens/es-ES/cashflow.webp
[screens/es-ES/assets]: docs/assets/screens/es-ES/assets.webp
[screens/es-ES/health]: docs/assets/screens/es-ES/health.webp
[screens/es-ES/phone]: docs/assets/screens/es-ES/phone.webp
[screens/fr-FR/hero]: docs/assets/screens/fr-FR/hero.webp
[screens/fr-FR/close]: docs/assets/screens/fr-FR/close.webp
[screens/fr-FR/goals]: docs/assets/screens/fr-FR/goals.webp
[screens/fr-FR/cashflow]: docs/assets/screens/fr-FR/cashflow.webp
[screens/fr-FR/assets]: docs/assets/screens/fr-FR/assets.webp
[screens/fr-FR/health]: docs/assets/screens/fr-FR/health.webp
[screens/fr-FR/phone]: docs/assets/screens/fr-FR/phone.webp
[screens/pt-BR/hero]: docs/assets/screens/pt-BR/hero.webp
[screens/pt-BR/close]: docs/assets/screens/pt-BR/close.webp
[screens/pt-BR/goals]: docs/assets/screens/pt-BR/goals.webp
[screens/pt-BR/cashflow]: docs/assets/screens/pt-BR/cashflow.webp
[screens/pt-BR/assets]: docs/assets/screens/pt-BR/assets.webp
[screens/pt-BR/health]: docs/assets/screens/pt-BR/health.webp
[screens/pt-BR/phone]: docs/assets/screens/pt-BR/phone.webp
[screens/zh-CN/hero]: docs/assets/screens/zh-CN/hero.webp
[screens/zh-CN/close]: docs/assets/screens/zh-CN/close.webp
[screens/zh-CN/goals]: docs/assets/screens/zh-CN/goals.webp
[screens/zh-CN/cashflow]: docs/assets/screens/zh-CN/cashflow.webp
[screens/zh-CN/assets]: docs/assets/screens/zh-CN/assets.webp
[screens/zh-CN/health]: docs/assets/screens/zh-CN/health.webp
[screens/zh-CN/phone]: docs/assets/screens/zh-CN/phone.webp
