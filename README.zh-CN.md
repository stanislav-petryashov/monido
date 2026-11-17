[English](README.md) · [Русский](README.ru-RU.md) · [Deutsch](README.de-DE.md) · [Español](README.es-ES.md) · [Français](README.fr-FR.md) · [Português](README.pt-BR.md) · [中文](README.zh-CN.md)

![Monido logo](docs/assets/logo.svg)

# Monido

独自或与家人一起跟踪净资产以及收入和支出。自托管，手动录入，不连接银行。

[![Latest release](https://img.shields.io/github/v/release/stanislav-petryashov/monido)](https://github.com/stanislav-petryashov/monido/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/stanislav-petryashov/monido/docker.yml?branch=master&label=CI)](https://github.com/stanislav-petryashov/monido/actions/workflows/docker.yml) [![License: MIT](https://img.shields.io/github/license/stanislav-petryashov/monido)](LICENSE) [![Last commit](https://img.shields.io/github/last-commit/stanislav-petryashov/monido)](https://github.com/stanislav-petryashov/monido/commits/master)

[![Docker image](https://img.shields.io/badge/docker-ghcr.io-2496ED?logo=docker&logoColor=white)](https://github.com/stanislav-petryashov/monido/pkgs/container/monido) [![Live demo](https://img.shields.io/badge/demo-live-5B4BE0)](https://demo.monido.dev) [![MCP Registry](https://img.shields.io/badge/MCP-registry-black)](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.stanislav-petryashov/monido)

[网站](https://monido.dev) · [在线演示](https://demo.monido.dev) · [参与 Monido 的开发](CONTRIBUTING.md) · [版本发布](https://github.com/stanislav-petryashov/monido/releases)

[试用在线演示](https://demo.monido.dev)：一个虚构的家庭，一份 15 分钟的私有副本，无需安装；登录页面上会显示密码。

![您拥有和欠下的一切， 汇成一个数字。 全家的账户、投资、房产和贷款，任何币种。][Screens/zh-CN/hero]

## Monido 能回答的问题

- **扣除负债后，我们有多少钱？** 每位家庭成员的账户、投资、房产和贷款，不论哪种货币，汇总成一个数字。[示例](docs/use-cases/family-net-worth.md)
- **今年我们是真的变富了，还是只是价格和汇率变了？** 净资产随时间的变化，以及按你日常花钱的货币扣除通胀后的实际增长。[示例](docs/use-cases/wealth-change.md) · [公式](docs/finance-rules.md#rule-4-real-net-worth-growth-real_growth_yoy)
- **我们自己存了多少，又有多少是自然增长的？** 每月的储蓄和储蓄率，以及超出储蓄的那部分增长。[示例](docs/use-cases/monthly-savings.md) · [公式](docs/finance-rules.md#growth-beyond-savings-growth_beyond_savings)
- **没有收入的话，我们能撑多久？** 以几个月的支出来衡量的应急资金。[示例](docs/use-cases/emergency-reserve.md) · [公式](docs/finance-rules.md#rule-1-emergency-fund-emergency_months)
- **我们什么时候能达成目标，这笔开销负担得起吗？** 根据你实际的储蓄算出目标日期；借助可选的 Claude 顾问，用你自己的数字衡量一次购买或一笔贷款，并交给家人投票。[目标](docs/use-cases/savings-goal.md) · [家庭决定](docs/use-cases/family-decision.md)

## 快速开始

你需要 Docker 和 Docker Compose v2.24 或更新版本（Linux，或 macOS 上的 Docker Desktop）。在一个新文件夹中执行：

```bash
mkdir monido && cd monido
curl -fsSLO https://raw.githubusercontent.com/stanislav-petryashov/monido/master/docker-compose.yml
docker compose up -d
```

在 15 分钟内打开 http://127.0.0.1:8080 并设置家庭密码。服务器设置（端口、地址）写在可选的 `.env` 中（[`.env.example`](.env.example)，[完整指南](docs/deploy-docker.md#installation)）。更新方法：`docker compose pull`，然后 `docker compose up -d`。遇到问题？请看[故障排除](docs/deploy-docker.md#troubleshooting)。

**运行需求：** 一个容器（Node 和 SQLite，不需要单独的数据库服务器），支持 amd64 和 arm64，所以树莓派或 NAS 就够用；空闲时内存占用不到 60 MB（在演示和一台家用安装上用 `docker stats` 测得，版本 1.2 到 1.4），镜像大小 250 MB。

数据保存在以文件夹命名的 Docker 卷中（`monido_data`）；`docker compose down -v` 会删除它，所以永远不要加 `-v`。演示不包含 Claude 顾问和 Telegram 提醒，也不能下载数据库；你自己的安装中都有这些功能。

## 界面截图

![每月一次，每个账户填一个余额。 向导会检查每个账户是否都已填写，然后把这个月加入概览。边输入边保存。][Screens/zh-CN/close]

![每个目标何时达成。 日期来自家庭实际的储蓄，以及什么会让它提前或推迟。][Screens/zh-CN/goals]

![这个月正常吗？ 收入、支出和储蓄，与您家的典型月份对比。][Screens/zh-CN/cashflow]

![家里有什么，归谁所有。 按类型、所有者和币种，以及本月的变化。][Screens/zh-CN/assets]

![我们的财务稳不稳？ 应急资金、负债水平和储蓄率，每项都有阈值和公式。][Screens/zh-CN/health]

![手机上也是同样的数字。 每个页面都适配小屏幕，支持浅色和深色主题。][Screens/zh-CN/phone]

**顾问**（可选）：一项决定及其后果，由家人投票

![顾问：一项家庭提案，附有其后果和投票](docs/use-cases/assets/UC-07-voter.png)


## 工作方式，以及它不是什么

每月一次，家人录入每个账户的月末余额；如果你想看收入和支出的数字，再录入当月的收入和支出。月度结算会检查每个账户是否都已填写，然后把这个月加入仪表盘。只有已结算的月份才会计入，每个数字都由应用根据录入的数据计算，每个公式都写在[财务规则](docs/finance-rules.md)中。

如果你能在家用服务器、NAS 或 VPS 上运行一个容器，家里的钱分散在几家银行、几种货币和几处房产中，而你想看的是财富及其走向，而不是每一笔消费，那么它很适合你。

它不是日常记账本、信封预算工具，也不是带实时行情的投资组合跟踪器；它从不连接银行，也不会转移资金。如果你需要逐笔记账或预算，可以看看 Firefly III 或 Actual Budget；如果需要实时的投资行情，可以看看 Ghostfolio。

## 功能

- **净资产以及收入和支出：** 按月的历史，按持有人、货币和资产类型的配置，收入和支出分类，储蓄率；只录入余额就可以开始。
- **贷款和房产：** 贷款还款计划、提前还款方案的对比和房产估值。
- **目标和财务自由：** 进度、预测、备选方案，以及每个日期背后的计算过程。
- **财务健康：** 各项指标及其阈值和输入数据；缺失的数据会明确显示，从不当作零。
- **为家庭设计：** 共享的记录，使用家庭密码登录或每人通过 Telegram 登录，每位成员各自的权限，Telegram 中的提醒和提案。
- **自托管：** 备份和恢复，所有数据可导出为 CSV，可撤销的变更历史，多币种，七种语言，浅色和深色主题。

## 隐私和 AI

你的数据保存在你服务器上的 SQLite 数据库中。服务器本身只对外发送汇率请求（发往 Frankfurter 或你自己的实例），以及每天一次发送镜像名称以检查更新（`UPDATE_CHECK=off` 可以关闭）；只有在你开启 Telegram 后才会连接 Telegram。核心中没有 AI：在你连接自己的 Claude 账户之前，Claude 顾问是关闭的；连接之后，你的对话和 Claude 请求的数字会通过这个账户发送给 Anthropic，从不经过应用本身。

## 项目状态

Monido 还很年轻：它的公开历史始于 2026 年 11 月，只有一位维护者，发布频繁（见[版本发布](https://github.com/stanislav-petryashov/monido/releases)和[更新日志](CHANGELOG.md)）。更新会保留你的数据：每次启动时都会检查现有的数据库，从不在你不知情时修改它，你也可以在更新前[下载一份副本](docs/deploy-docker.md#backup-and-restore)。七种语言中有五种是等待审校的机器翻译。接下来的计划见[路线图](https://github.com/stanislav-petryashov/monido/discussions/27)。

## 获取方式

- **Docker Compose**，适用于任何 Linux 服务器或 Docker Desktop：见快速开始。镜像为 `ghcr.io/stanislav-petryashov/monido`（amd64 和 arm64）。
- **Unraid：** 在 Community Applications 中搜索 Monido。它以数据文件夹所有者的身份运行（默认 `PUID` 99，`PGID` 100）。
- **PikaPods**（托管服务）：暂不可用。[为 Monido 投票](https://feedback.pikapods.com/posts/1289/monido-self-hosted-family-net-worth-and-cash-flow-tracker)，推动它被加入。
- **Claude 连接器（MCP）：** 已收录在[官方 MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.stanislav-petryashov/monido) 和 [Glama](https://glama.ai/mcp/servers/stanislav-petryashov/monido) 上。

## 语言

界面支持英语、俄语、德语、西班牙语、法语、巴西葡萄牙语和简体中文。德语、西班牙语、法语、葡萄牙语和中文的文本是机器翻译，正在等待母语使用者审校。欢迎提出修正：见[翻译指南](docs/translating.md)。本 README 译自英文版，两者不一致时以英文版为准。

[![Translation status](https://hosted.weblate.org/widget/monido/svg-badge.svg)](https://hosted.weblate.org/engage/monido/)

翻译在 [Weblate](https://hosted.weblate.org/engage/monido/) 上管理：选择你的语言，修改或批准字符串，这些修改会以拉取请求的形式回到本仓库。

## 文档

- [实际示例](docs/use-cases/README.md)：七个家庭理财问题，包含虚构数据、验证结果和局限（以下文档均为英文）。
- [用户指南](docs/user-guide.md)：各个页面、月度更新和设置。
- [配置](docs/configuration.md)：环境变量、登录模式和可选的集成。
- [部署](docs/deploy-docker.md)：Docker、反向代理后的 HTTPS、更新和备份、公开演示。
- [开发](docs/development.md)：从源码运行、命令和截图。
- [架构](docs/architecture.md)：代码地图、数据模型和操作指南。
- [财务规则](docs/finance-rules.md)：每项指标如何计算和评估。
- [数据库结构](docs/schema.md)：当前的表和兼容性规则。
- [设计系统](docs/design-system.md)：界面的令牌、组件和规则。
- [维护](docs/maintaining.md)：第一次公开发布和如何发布新版本。

## 参与贡献

贡献可以是代码、更清晰的文档、翻译修正、无障碍改进、计算核对，或者来自真实自托管安装的反馈。

请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，了解环境搭建和贡献指南。[提交 issue](https://github.com/stanislav-petryashov/monido/issues/new/choose) 来报告问题；提问和讨论想法（包括在做较大的修改之前）请到 [Discussions](https://github.com/stanislav-petryashov/monido/discussions)。带有 [good first issue](https://github.com/stanislav-petryashov/monido/labels/good%20first%20issue) 标签的 issue 规模小、相对独立，适合入门。想长期帮忙维护某个部分？告诉我们你在用哪一部分，想参与哪方面的工作。

如果 Monido 对你有用，给它一个星标，或者推荐给需要它的人，都是对项目的帮助。

## 安全

登录、会话、限流、Content-Security-Policy，以及如何私下报告漏洞：见 [SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE)。

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
