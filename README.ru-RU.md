[English](README.md) · [Русский](README.ru-RU.md) · [Deutsch](README.de-DE.md) · [Español](README.es-ES.md) · [Français](README.fr-FR.md) · [Português](README.pt-BR.md) · [中文](README.zh-CN.md)

![Логотип Monido](docs/assets/logo.svg)

# Monido

Учёт капитала и денежного потока, для себя или всей семьи. На своём сервере, данные вводятся вручную, без подключения к банкам.

[![Последняя версия](https://img.shields.io/github/v/release/stanislav-petryashov/monido)](https://github.com/stanislav-petryashov/monido/releases/latest) [![Лицензия: MIT](https://img.shields.io/github/license/stanislav-petryashov/monido)](LICENSE) [![Онлайн-демо](https://img.shields.io/badge/demo-live-5B4BE0)](https://demo.monido.dev)

[Сайт](https://monido.dev) · [Демо](https://demo.monido.dev) · [Помочь с Monido](CONTRIBUTING.md) · [Релизы](https://github.com/stanislav-petryashov/monido/releases)

[Попробуйте демо](https://demo.monido.dev): вымышленная семья в личной копии на 15 минут, ничего не нужно устанавливать; пароль показан на экране входа.

![Всё, чем вы владеете и что должны. Одной цифрой. Счета, инвестиции, недвижимость и кредиты всей семьи, в любых валютах.][Screens/ru-RU/hero]

## На какие вопросы отвечает Monido

- **Сколько у нас всего за вычетом долгов?** Счета, инвестиции, недвижимость и кредиты всех членов семьи, во всех валютах, одной цифрой. [Пример](docs/use-cases/family-net-worth.md)
- **Мы стали богаче за год или просто сдвинулись цены и курсы?** Капитал во времени и его реальный рост с поправкой на инфляцию в той валюте, в которой вы тратите. [Пример](docs/use-cases/wealth-change.md) · [формула](docs/finance-rules.md#rule-4-real-net-worth-growth-real_growth_yoy)
- **Сколько мы отложили сами, а сколько выросло само?** Сбережения и норма сбережений по месяцам, а также рост сверх них. [Пример](docs/use-cases/monthly-savings.md) · [формула](docs/finance-rules.md#growth-beyond-savings-growth_beyond_savings)
- **Сколько мы продержимся без дохода?** Подушка безопасности в месяцах расходов. [Пример](docs/use-cases/emergency-reserve.md) · [формула](docs/finance-rules.md#rule-1-emergency-fund-emergency_months)
- **Когда мы достигнем целей и можем ли мы себе это позволить?** Сроки целей по тому, сколько вы на самом деле откладываете; с необязательным Советником на Claude покупка или кредит оцениваются по вашим собственным цифрам и выносятся на голосование семьи. [Цели](docs/use-cases/savings-goal.md) · [Семейное решение](docs/use-cases/family-decision.md)

## Быстрый старт

Нужен Docker с Docker Compose версии 2.24 или новее (Linux или Docker Desktop на macOS). В новой папке выполните:

```bash
mkdir monido && cd monido
curl -fsSLO https://raw.githubusercontent.com/stanislav-petryashov/monido/master/docker-compose.yml
docker compose up -d
```

В течение 15 минут откройте http://127.0.0.1:8080 и задайте семейный пароль. Настройки сервера (порт, адрес) задаются в необязательном файле `.env` ([`.env.example`](.env.example), [полное руководство](docs/deploy-docker.md#installation)). Обновление: `docker compose pull`, затем `docker compose up -d`. Что-то не работает? [Решение проблем](docs/deploy-docker.md#troubleshooting).

**На сервере или с других устройств:** порт открыт только на `127.0.0.1`, поэтому указанный выше адрес работает только на компьютере, где запущен Docker, и нигде больше. Чтобы получить доступ к Monido с другого компьютера, телефона или через Интернет, установите перед ним обратный прокси с HTTPS (Caddy, nginx, Traefik). В статье [«Обратный прокси и HTTPS»](docs/deploy-docker.md#reverse-proxy-and-https) приведён пример с Caddy и настройки, необходимые для прокси (`APP_URL`, `CLIENT_IP_HEADER`).

**Что нужно:** один контейнер (Node и SQLite, без отдельного сервера баз данных) для amd64 и arm64, так что подойдёт Raspberry Pi или NAS; в простое меньше 60 МБ памяти (`docker stats` на демо и на домашней установке, версии с 1.2 по 1.4) и образ размером 250 МБ.

Данные хранятся в Docker-томе, названном по имени папки (`monido_data`). Команда `docker compose down -v` удалит его, поэтому никогда не добавляйте `-v`. В демо нет Советника на Claude и напоминаний в Telegram, и скачать его базу данных нельзя; в вашей собственной установке всё это есть.

## Экраны

![Раз в месяц: остаток по каждому счёту. Мастер проверит, что заполнены все счета, и добавит месяц в обзор. Всё сохраняется по ходу ввода.][Screens/ru-RU/close]

![Когда вы достигнете каждой цели. Сроки исходят из того, сколько семья откладывает на самом деле, и показано, что их сдвинет.][Screens/ru-RU/goals]

![Обычный ли это был месяц? Доходы, расходы и сбережения в сравнении с вашим обычным месяцем.][Screens/ru-RU/cashflow]

![Чем владеет семья и кому что принадлежит. По типам, владельцам и валютам, и что изменилось за месяц.][Screens/ru-RU/assets]

![Насколько мы устойчивы? Подушка безопасности, долговая нагрузка и норма сбережений, у каждого показателя свой порог и формула.][Screens/ru-RU/health]

![Те же цифры в телефоне. Каждая страница работает на маленьком экране, в светлой и тёмной теме.][Screens/ru-RU/phone]

**Советник** (по желанию): решение с последствиями, за которое голосует семья

![Советник: предложение семье с последствиями и голосами](docs/use-cases/assets/UC-07-voter.png)


## Как это работает и чем Monido не является

Раз в месяц семья вводит остаток каждого счёта на конец месяца и, если нужны показатели денежного потока, доходы и расходы за месяц; «Закрыть месяц» проверяет, что заполнены все счета, и добавляет месяц на дашборд. Учитываются только закрытые месяцы, все цифры приложение считает само по введённым данным, а каждая формула описана в [Finance rules](docs/finance-rules.md).

Monido вам подойдёт, если вы можете запустить контейнер на домашнем сервере, NAS или VPS, деньги семьи лежат в нескольких банках, валютах и объектах недвижимости, и вы хотите видеть капитал и его динамику, а не каждую покупку.

Это не ежедневный учёт расходов, не бюджет по конвертам и не трекер портфеля с биржевыми ценами; Monido никогда не подключается к банку и не переводит деньги. Для учёта каждой операции или бюджетов посмотрите Firefly III или Actual Budget, для текущих цен инвестиций: Ghostfolio.

## Возможности

- **Капитал и денежный поток:** история по месяцам, структура по владельцам, валютам и типам активов, категории доходов и расходов, норма сбережений; для начала достаточно одних остатков.
- **Кредиты и недвижимость:** графики платежей, сравнение вариантов досрочного погашения и оценки недвижимости.
- **Цели и финансовая независимость:** прогресс, прогнозы, альтернативы и расчёт за каждой датой.
- **Финансовое здоровье:** показатели с порогами и исходными цифрами; отсутствующие данные показываются как отсутствующие и никогда не считаются нулём.
- **Для семьи:** общие записи, вход по семейному паролю или каждому через Telegram, права для каждого члена семьи, напоминания и предложения в Telegram.
- **Для своего сервера:** резервные копии и восстановление, выгрузка всех данных в CSV, история изменений с отменой, несколько валют, семь языков, светлая и тёмная темы.

## Приватность и ИИ

Ваши данные остаются в базе SQLite на вашем сервере. Сам сервер отправляет наружу только запрос курсов валют (во Frankfurter или в ваш собственный экземпляр) и раз в день имя образа, чтобы проверить обновления (`UPDATE_CHECK=off` это отключает); к Telegram он обращается, только если вы его включили. В основе приложения нет ИИ: Советник на Claude выключен, пока вы не подключите свой аккаунт Claude, и тогда ваш разговор и цифры, которые запрашивает Claude, уходят в Anthropic через этот аккаунт, а не через приложение.

## Состояние проекта

Monido — молодой проект: его публичная история начинается в ноябре 2026 года, у него один сопровождающий, и он часто выпускается (см. [Релизы](https://github.com/stanislav-petryashov/monido/releases) и [журнал изменений](CHANGELOG.md)). Большая часть кода написана с помощью Claude Code; сопровождающий руководит процессом и проверяет изменения. Ничто не сливается в основной код, пока не пройдет полная проверка в CI (lint, проверка мёртвого кода, набор тестов, сборка и ограничения по размеру), и каждая формула зафиксирована в [Финансовых правилах](docs/finance-rules.md) с [практическими примерами](docs/use-cases/README.md), которые можно проверить вручную. Обновления сохраняют ваши данные: при каждом запуске проверяется существующая база данных, и она никогда не изменяется без вашего ведома; кроме того, перед обновлением вы можете [скачать копию](docs/deploy-docker.md#backup-and-restore). Пять из семи языков представлены машинными переводами, ожидающими проверки. Дальнейшие планы
изложены в [дорожной карте](https://github.com/stanislav-petryashov/monido/discussions/27).

## Где взять

- **Docker Compose** на любом Linux-сервере или в Docker Desktop: см. Быстрый старт. Образ: `ghcr.io/stanislav-petryashov/monido` (amd64 и arm64).
- **Unraid:** найдите Monido в Community Applications. Приложение работает от имени владельца папки с данными (по умолчанию `PUID` 99, `PGID` 100).
- **PikaPods** (управляемый хостинг): пока недоступно. [Проголосуйте за Monido](https://feedback.pikapods.com/posts/1289/monido-self-hosted-family-net-worth-and-cash-flow-tracker), чтобы его добавили.
- **Коннектор для Claude (MCP):** есть в [официальном реестре MCP](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.stanislav-petryashov/monido) и на [Glama](https://glama.ai/mcp/servers/stanislav-petryashov/monido).

## Языки

Интерфейс доступен на английском, русском, немецком, испанском, французском, бразильском португальском и упрощённом китайском. Тексты на немецком, испанском, французском, португальском и китайском переведены машинно и ждут проверки носителями языка. Исправления приветствуются: см. [Translating](docs/translating.md). Этот README переведён с английского; если они расходятся, верна английская версия.

[![Статус перевода](https://hosted.weblate.org/widget/monido/svg-badge.svg)](https://hosted.weblate.org/engage/monido/)

Переводами управляют на [Weblate](https://hosted.weblate.org/engage/monido/): выберите свой язык, исправьте или подтвердите строки, и изменения придут в этот репозиторий пулреквестом.

## Документация (на английском)

- [Worked examples](docs/use-cases/README.md): семь вопросов о семейных финансах на вымышленных данных, с результатами проверки и ограничениями.
- [User guide](docs/user-guide.md): страницы, ежемесячное обновление и настройки.
- [Configuration](docs/configuration.md): переменные окружения, режимы входа и дополнительные интеграции.
- [Deployment](docs/deploy-docker.md): Docker, HTTPS за обратным прокси, обновления и резервные копии, публичное демо.
- [Development](docs/development.md): запуск из исходников, команды и скриншоты.
- [Architecture](docs/architecture.md): карта кода, модель данных и инструкции.
- [Finance rules](docs/finance-rules.md): как считается и оценивается каждый показатель.
- [Database schema](docs/schema.md): текущие таблицы и правила совместимости.
- [Design system](docs/design-system.md): токены, компоненты и правила интерфейса.
- [Maintaining](docs/maintaining.md): первый публичный релиз и выпуск релиза.

## Как помочь проекту

Помочь можно кодом, более понятной документацией, исправлениями переводов, улучшениями доступности, проверкой расчётов или отчётами о работе на настоящей установке.

Начните с [CONTRIBUTING.md](CONTRIBUTING.md): там описаны настройка окружения и правила. Чтобы сообщить о проблеме, [откройте issue](https://github.com/stanislav-petryashov/monido/issues/new/choose); вопросы и идеи, в том числе перед крупным изменением, обсуждайте в [Discussions](https://github.com/stanislav-petryashov/monido/discussions). Задачи с меткой [good first issue](https://github.com/stanislav-petryashov/monido/labels/good%20first%20issue) небольшие и самостоятельные, с них удобно начать. Хотите со временем взять на себя какую-то часть? Напишите, чем вы пользуетесь и над чем хотели бы работать.

Если Monido вам полезен, звезда на GitHub или рассказ о нём тому, кому он нужен, помогают проекту.

## Безопасность

Вход, сессии, ограничение частоты запросов, Content-Security-Policy и как сообщить об уязвимости конфиденциально: [SECURITY.md](SECURITY.md).

## Лицензия

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
