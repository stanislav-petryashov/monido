<p align="center"><a href="README.md">English</a> · <a href="README.ru-RU.md">Русский</a> · <a href="README.de-DE.md">Deutsch</a> · <a href="README.es-ES.md">Español</a> · <a href="README.fr-FR.md">Français</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.zh-CN.md">中文</a></p>

<p align="center">
  <img src="docs/assets/logo.svg" width="64" height="64" alt="Logotipo de Monido">
</p>

<h1 align="center">Monido</h1>

<p align="center">
  Controla tu patrimonio neto y tus ingresos y gastos, por tu cuenta o en familia. Autoalojado, con datos introducidos a mano y sin conexión con bancos.
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
  <a href="https://monido.dev">Sitio web</a> · <a href="https://demo.monido.dev">Demo en vivo</a> · <a href="#inicio-rápido">Inicio rápido</a> · <a href="#documentación">Documentación</a> · <a href="#contribuir">Ayuda a construir Monido</a> · <a href="https://github.com/stanislav-petryashov/monido/releases">Versiones</a>
</p>

<p align="center">
  <img src="docs/assets/screenshot.png" width="100%" alt="La página Resumen en el tema claro y en el oscuro">
</p>

## ¿Por qué Monido?

Para quienes quieren entender su dinero mes a mes, por su cuenta o junto con su familia.

- **Mantén el control de tus datos.** Ejecútalo en tu propio servidor, guarda tú la base de datos y las copias de seguridad, y elige qué integraciones opcionales activar.
- **Ve las finanzas de toda la familia.** Reúne cuentas, inversiones, inmuebles y préstamos en una sola vista, con los importes agrupados por titular y por moneda.
- **Entiende tu progreso sin conectar un banco.** Introduce los saldos de cada mes y, si quieres, los ingresos y gastos, y verás cómo cambian tu patrimonio neto y tus objetivos. No hace falta registrar movimientos a diario.

## Funciones

- **Patrimonio neto e ingresos y gastos:** historial mensual, distribución de activos, categorías de ingresos y gastos, y tasas de ahorro. Registra solo los saldos o incluye también ingresos y gastos.
- **Actualización mensual:** un asistente de cierre del mes que guarda automáticamente; solo los meses cerrados entran en los cálculos del panel.
- **Préstamos e inmuebles:** valoraciones de inmuebles, cuadros de amortización y comparaciones de amortización anticipada.
- **Objetivos e independencia financiera:** progreso, previsiones, escenarios alternativos y explicaciones de los cálculos.
- **Salud financiera:** indicadores, sus umbrales y las cifras que hay detrás; los datos incompletos siguen a la vista.
- **Integraciones opcionales con Claude y Telegram:** introducción de datos a partir de extractos, preguntas financieras, propuestas a la familia y recordatorios. El Asesor requiere HTTPS y la contraseña familiar o el inicio de sesión con Telegram; estos servicios no son necesarios para el panel principal.
- **Pensado para autoalojarse:** un solo contenedor Docker y una base de datos SQLite, copias de seguridad y restauración, historial de cambios con deshacer en las operaciones compatibles, varias monedas, temas claro y oscuro.

## Ejemplos prácticos

Explora [siete casos de uso de finanzas domésticas](docs/use-cases/README.md): patrimonio en varias monedas, patrimonio neto después de las deudas, ahorro mensual, fondo de emergencia, objetivos de ahorro, decisiones familiares con el Asesor y cierre de un mes a partir de extractos bancarios con Claude. Cada ejemplo incluye datos ficticios, resultados de verificación y límites.

## Inicio rápido

¿Quieres verlo primero? [Prueba la demo](https://demo.monido.dev): una familia ficticia, una copia privada durante 15 minutos y nada que instalar. La pantalla de inicio de sesión muestra la contraseña de la demo. Los cambios solo afectan a tu copia temporal.

La demo no incluye el Asesor de Claude ni los recordatorios de Telegram, y la descarga de la base de datos está desactivada. Esas funciones están disponibles en tu propia instalación. Usa datos ficticios en la demo.

Necesitas Docker con Docker Compose v2.24 o posterior (Linux, o Docker Desktop en macOS). En una carpeta nueva:

```bash
mkdir monido && cd monido
curl -fsSLO https://raw.githubusercontent.com/stanislav-petryashov/monido/master/docker-compose.yml
docker compose up -d
```

Abre http://127.0.0.1:8080 en los 15 minutos siguientes y fija la contraseña familiar. La contraseña o el inicio de sesión con Telegram se gestionan en la interfaz web; los ajustes del servidor (puerto, dirección) van en un archivo `.env` opcional ([`.env.example`](.env.example), [la guía completa](docs/deploy-docker.md#installation)). Para actualizar: `docker compose pull && docker compose up -d`. ¿Algo no funciona? [Solución de problemas](docs/deploy-docker.md#troubleshooting).

Los datos se guardan en un volumen de Docker con el nombre de la carpeta (`monido_data`); `docker compose down -v` lo borraría, así que no añadas nunca `-v`.

## Dónde conseguirlo

- **Docker Compose** en cualquier servidor Linux o en Docker Desktop: consulta [Inicio rápido](#inicio-rápido). La imagen es `ghcr.io/stanislav-petryashov/monido` (amd64 y arm64).
- **Unraid:** busca Monido en Community Applications. Se ejecuta como el propietario de la carpeta de datos (`PUID` 99, `PGID` 100 por defecto).
- **PikaPods** (alojamiento gestionado): todavía no está disponible. [Vota por Monido](https://feedback.pikapods.com/posts/1289/monido-self-hosted-family-net-worth-and-cash-flow-tracker) para que lo añadan.
- **Conector de Claude (MCP):** figura en el [registro oficial de MCP](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.stanislav-petryashov/monido) y en [Glama](https://glama.ai/mcp/servers/stanislav-petryashov/monido).

## Idiomas

La interfaz está en inglés, ruso, alemán, español, francés, portugués de Brasil y chino simplificado. Los textos en alemán, español, francés, portugués y chino son traducciones automáticas que esperan la revisión de hablantes nativos. Las correcciones son bienvenidas: consulta [Translating](docs/translating.md).

[![Translation status](https://hosted.weblate.org/widget/monido/svg-badge.svg)](https://hosted.weblate.org/engage/monido/)

Las traducciones se gestionan en [Weblate](https://hosted.weblate.org/engage/monido/): elige tu idioma, corrige o aprueba textos y los cambios llegan a este repositorio como pull request.

Este README es una traducción del README en inglés, que es la referencia si difieren.

## Documentación

La documentación está en inglés.

- [Guía de usuario](docs/user-guide.md): las páginas, la actualización mensual y los ajustes.
- [Configuración](docs/configuration.md): variables de entorno, modos de inicio de sesión e integraciones opcionales.
- [Despliegue](docs/deploy-docker.md): Docker, HTTPS detrás de un proxy inverso, actualizaciones y copias de seguridad, la demo pública.
- [Desarrollo](docs/development.md): ejecutar desde el código fuente, los comandos y las capturas de pantalla.
- [Arquitectura](docs/architecture.md): el mapa del código, el modelo de datos y guías prácticas.
- [Reglas financieras](docs/finance-rules.md): cómo se calcula y se valora cada métrica.
- [Esquema de la base de datos](docs/schema.md): las tablas actuales y las reglas de compatibilidad.
- [Sistema de diseño](docs/design-system.md): tokens, componentes y reglas de la interfaz.
- [Mantenimiento](docs/maintaining.md): la primera versión pública y cómo publicar una versión.

## Contribuir

Puedes contribuir con código, documentación más clara, correcciones de traducción, mejoras de accesibilidad, revisiones de los cálculos o informes desde una instalación autoalojada real.

Empieza por [CONTRIBUTING.md](CONTRIBUTING.md), con la configuración y las pautas para contribuir. [Abre una incidencia](https://github.com/stanislav-petryashov/monido/issues/new/choose) para informar de un problema o comentar una idea antes de un cambio grande. ¿Te interesa ayudar a mantener un área a largo plazo? Dinos qué parte usas y en cuál te gustaría trabajar.

Si Monido te resulta útil, una estrella o recomendarlo a alguien que lo necesite ayuda al proyecto.

## Seguridad

Inicio de sesión, sesiones, limitación de intentos, la Content-Security-Policy y cómo informar de una vulnerabilidad en privado: [SECURITY.md](SECURITY.md).

## Licencia

[MIT](LICENSE).
