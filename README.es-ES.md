[English](README.md) · [Русский](README.ru-RU.md) · [Deutsch](README.de-DE.md) · [Español](README.es-ES.md) · [Français](README.fr-FR.md) · [Português](README.pt-BR.md) · [中文](README.zh-CN.md)

![Logotipo de Monido](docs/assets/logo.svg)

# Monido

Controla tu patrimonio neto y tus ingresos y gastos, por tu cuenta o en familia. Autoalojado, con datos introducidos a mano y sin conexión con bancos.

[![Latest release](https://img.shields.io/github/v/release/stanislav-petryashov/monido)](https://github.com/stanislav-petryashov/monido/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/stanislav-petryashov/monido/docker.yml?branch=master&label=CI)](https://github.com/stanislav-petryashov/monido/actions/workflows/docker.yml) [![License: MIT](https://img.shields.io/github/license/stanislav-petryashov/monido)](LICENSE) [![Last commit](https://img.shields.io/github/last-commit/stanislav-petryashov/monido)](https://github.com/stanislav-petryashov/monido/commits/master)

[![Docker image](https://img.shields.io/badge/docker-ghcr.io-2496ED?logo=docker&logoColor=white)](https://github.com/stanislav-petryashov/monido/pkgs/container/monido) [![Live demo](https://img.shields.io/badge/demo-live-5B4BE0)](https://demo.monido.dev) [![MCP Registry](https://img.shields.io/badge/MCP-registry-black)](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.stanislav-petryashov/monido)

[Sitio web](https://monido.dev) · [Demo en vivo](https://demo.monido.dev) · [Ayuda a construir Monido](CONTRIBUTING.md) · [Versiones](https://github.com/stanislav-petryashov/monido/releases)

[Prueba la demo en vivo](https://demo.monido.dev): una familia ficticia en una copia privada durante 15 minutos, sin instalar nada; la pantalla de inicio de sesión muestra la contraseña.

![La página Resumen en el tema claro y en el oscuro](docs/assets/screenshot.png)

## Preguntas que responde Monido

- **¿Cuánto tenemos, descontadas las deudas?** Cuentas, inversiones, inmuebles y préstamos de cada miembro de la familia, en todas las monedas, en una sola cifra. [Ejemplo](docs/use-cases/family-net-worth.md)
- **¿Nos hemos hecho más ricos este año, o solo se han movido los precios y los tipos de cambio?** El patrimonio neto a lo largo del tiempo y su crecimiento real descontada la inflación en la moneda en la que gastas. [Ejemplo](docs/use-cases/wealth-change.md) · [fórmula](docs/finance-rules.md#rule-4-real-net-worth-growth-real_growth_yoy)
- **¿Cuánto hemos ahorrado nosotros y cuánto ha crecido por sí solo?** El ahorro y la tasa de ahorro de cada mes, y el crecimiento por encima de ellos. [Ejemplo](docs/use-cases/monthly-savings.md) · [fórmula](docs/finance-rules.md#growth-beyond-savings-growth_beyond_savings)
- **¿Cuánto aguantaríamos sin ingresos?** El fondo de emergencia en meses de gastos. [Ejemplo](docs/use-cases/emergency-reserve.md) · [fórmula](docs/finance-rules.md#rule-1-emergency-fund-emergency_months)
- **¿Cuándo alcanzaremos nuestros objetivos y podemos permitirnos esto?** Fechas de los objetivos según lo que de verdad ahorráis; con el Asesor opcional de Claude, una compra o un préstamo se evalúa frente a vuestras propias cifras y se envía a la familia para que vote. [Objetivos](docs/use-cases/savings-goal.md) · [Una decisión en familia](docs/use-cases/family-decision.md)

## Inicio rápido

Necesitas Docker con Docker Compose v2.24 o posterior (Linux, o Docker Desktop en macOS). En una carpeta nueva:

```bash
mkdir monido && cd monido
curl -fsSLO https://raw.githubusercontent.com/stanislav-petryashov/monido/master/docker-compose.yml
docker compose up -d
```

Abre http://127.0.0.1:8080 en un plazo de 15 minutos y establece la contraseña familiar. Los ajustes del servidor (puerto, dirección) van en un archivo `.env` opcional ([`.env.example`](.env.example), [la guía completa](docs/deploy-docker.md#installation)). Para actualizar: `docker compose pull` y luego `docker compose up -d`. ¿Algo no funciona? [Solución de problemas](docs/deploy-docker.md#troubleshooting).

**Qué necesita:** un contenedor (Node y SQLite, sin servidor de base de datos aparte) para amd64 y arm64, así que basta con una Raspberry Pi o un NAS; menos de 60 MB de memoria en reposo (`docker stats` en la demo y en una instalación doméstica, versiones 1.2 a 1.4) y una imagen de 250 MB.

Los datos se guardan en un volumen de Docker con el nombre de la carpeta (`monido_data`); `docker compose down -v` lo borraría, así que nunca añadas `-v`. La demo no tiene el Asesor de Claude ni los recordatorios de Telegram y no permite descargar su base de datos; tu propia instalación sí los tiene.

## Pantallas

**Cerrar el mes**: una vez al mes, se guarda mientras escribes

![Cerrar el mes: los saldos, ingresos y gastos del mes, cuenta por cuenta](docs/assets/gallery/close-month.png)

**Objetivos**: fechas según lo que de verdad ahorráis, y qué las adelantaría o retrasaría

![Objetivos: lo que la familia ahorra al mes y cuándo se alcanza cada objetivo](docs/assets/gallery/goals.png)

**Salud financiera**: cada cifra con su umbral y su fórmula

![Salud financiera: indicadores con sus zonas](docs/assets/gallery/health.png)

**Asesor** (opcional): una decisión con sus consecuencias, votada por la familia

![Asesor: una propuesta a la familia con sus consecuencias y los votos](docs/use-cases/assets/UC-07-voter.png)


## Cómo funciona y qué no es

Una vez al mes, la familia introduce el saldo de cada cuenta a fin de mes y, si quieres las cifras de ingresos y gastos, los ingresos y gastos del mes; Cerrar el mes comprueba que todas las cuentas estén rellenadas y después añade el mes al panel. Solo cuentan los meses cerrados, la aplicación calcula cada cifra a partir de lo introducido y cada fórmula está escrita en [Reglas financieras](docs/finance-rules.md).

Te encaja si puedes ejecutar un contenedor en un servidor doméstico, un NAS o un VPS, el dinero de la familia está repartido entre varios bancos, monedas e inmuebles, y quieres ver el patrimonio y su tendencia más que cada compra.

No es un libro de cuentas diario, un presupuesto por sobres ni un seguimiento de cartera con cotizaciones en tiempo real, y nunca se conecta a un banco ni mueve dinero. Para un registro movimiento a movimiento o presupuestos, mira Firefly III o Actual Budget; para cotizaciones de inversiones en tiempo real, Ghostfolio.

## Funciones

- **Patrimonio neto e ingresos y gastos:** historial mensual, distribución por titular, moneda y tipo de activo, categorías de ingresos y gastos, tasas de ahorro; para empezar bastan los saldos.
- **Préstamos e inmuebles:** cuadros de amortización, comparativas de amortización anticipada y valoraciones de inmuebles.
- **Objetivos e independencia financiera:** progreso, previsiones, alternativas y el cálculo detrás de cada fecha.
- **Salud financiera:** indicadores con sus umbrales y sus datos de entrada; los datos que faltan se muestran, nunca se toman como cero.
- **Para la familia:** registros compartidos, inicio de sesión con una contraseña familiar o por persona a través de Telegram, permisos por miembro, recordatorios y propuestas en Telegram.
- **Autoalojamiento:** copias de seguridad y restauración, todos los datos exportables a CSV, historial de cambios con deshacer, varias monedas, siete idiomas, temas claro y oscuro.

## Privacidad e IA

Tus datos se quedan en la base de datos SQLite de tu servidor. El propio servidor solo envía fuera una petición de tipos de cambio (a Frankfurter, o a tu propia instancia) y, una vez al día, el nombre de la imagen para buscar actualizaciones (`UPDATE_CHECK=off` lo desactiva); solo contacta con Telegram si lo activas. El núcleo no lleva IA: el Asesor de Claude está apagado hasta que conectas tu propia cuenta de Claude, y entonces tu conversación y las cifras que Claude pide van a Anthropic a través de esa cuenta, nunca a través de la aplicación.

## Estado del proyecto

Monido es joven: su historia pública empieza en noviembre de 2026, tiene un solo mantenedor y publica versiones a menudo (consulta las [versiones](https://github.com/stanislav-petryashov/monido/releases) y el [registro de cambios](CHANGELOG.md)). Las actualizaciones conservan tus datos: una base de datos existente se comprueba en cada arranque y nunca se modifica a tus espaldas, y puedes [descargar una copia](docs/deploy-docker.md#backup-and-restore) antes de actualizar. Cinco de los siete idiomas son traducciones automáticas pendientes de revisión. Lo que viene después está en la [hoja de ruta](https://github.com/stanislav-petryashov/monido/discussions/27).

## Dónde conseguirlo

- **Docker Compose** en cualquier servidor Linux o en Docker Desktop: consulta Inicio rápido. La imagen es `ghcr.io/stanislav-petryashov/monido` (amd64 y arm64).
- **Unraid:** busca Monido en Community Applications. Se ejecuta como el propietario de la carpeta de datos (`PUID` 99, `PGID` 100 por defecto).
- **PikaPods** (alojamiento gestionado): todavía no disponible. [Vota por Monido](https://feedback.pikapods.com/posts/1289/monido-self-hosted-family-net-worth-and-cash-flow-tracker) para que lo añadan.
- **Conector de Claude (MCP):** aparece en el [MCP Registry oficial](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.stanislav-petryashov/monido) y en [Glama](https://glama.ai/mcp/servers/stanislav-petryashov/monido).

## Idiomas

La interfaz está en inglés, ruso, alemán, español, francés, portugués de Brasil y chino simplificado. Los textos en alemán, español, francés, portugués y chino son traducciones automáticas que esperan la revisión de hablantes nativos. Este README es una traducción del inglés; si difieren, la referencia es el README en inglés. Las correcciones son bienvenidas: consulta [Cómo traducir](docs/translating.md).

[![Estado de la traducción](https://hosted.weblate.org/widget/monido/svg-badge.svg)](https://hosted.weblate.org/engage/monido/)

Las traducciones se gestionan en [Weblate](https://hosted.weblate.org/engage/monido/): elige tu idioma, corrige o aprueba textos, y los cambios vuelven a este repositorio como una pull request.

## Documentación

- [Ejemplos prácticos](docs/use-cases/README.md): siete preguntas domésticas con datos ficticios, resultados de verificación y límites. Toda la documentación está en inglés.
- [Guía de usuario](docs/user-guide.md): las páginas, la actualización mensual y los ajustes.
- [Configuración](docs/configuration.md): variables de entorno, modos de inicio de sesión e integraciones opcionales.
- [Despliegue](docs/deploy-docker.md): Docker, HTTPS detrás de un proxy inverso, actualizaciones y copias de seguridad, la demo pública.
- [Desarrollo](docs/development.md): ejecución desde el código fuente, los comandos y las capturas de pantalla.
- [Arquitectura](docs/architecture.md): el mapa del código, el modelo de datos y guías prácticas.
- [Reglas financieras](docs/finance-rules.md): cómo se calcula y se valora cada métrica.
- [Esquema de la base de datos](docs/schema.md): las tablas actuales y las reglas de compatibilidad.
- [Sistema de diseño](docs/design-system.md): tokens, componentes y reglas de la interfaz.
- [Mantenimiento](docs/maintaining.md): la primera versión pública y cómo publicar una versión.

## Contribuir

Puedes contribuir con código, documentación más clara, correcciones de traducción, mejoras de accesibilidad, comprobaciones de los cálculos o informes de una instalación autoalojada real.

Empieza por [CONTRIBUTING.md](CONTRIBUTING.md) para la configuración y las pautas de contribución. [Abre una issue](https://github.com/stanislav-petryashov/monido/issues/new/choose) para informar de un problema; haz preguntas y comenta ideas, también antes de un cambio grande, en [Discussions](https://github.com/stanislav-petryashov/monido/discussions). Las issues con la etiqueta [good first issue](https://github.com/stanislav-petryashov/monido/labels/good%20first%20issue) son una forma pequeña y acotada de empezar. ¿Te interesa ayudar a mantener una parte a largo plazo? Cuéntanos qué parte usas y en cuál te gustaría trabajar.

Si Monido te resulta útil, una estrella o una recomendación a alguien que lo necesite ayuda al proyecto.

## Seguridad

Inicio de sesión, sesiones, limitación de intentos, la Content-Security-Policy y cómo informar de una vulnerabilidad en privado: [SECURITY.md](SECURITY.md).

## Licencia

[MIT](LICENSE).
