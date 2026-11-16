<p align="center"><a href="README.md">English</a> · <a href="README.ru-RU.md">Русский</a> · <a href="README.de-DE.md">Deutsch</a> · <a href="README.es-ES.md">Español</a> · <a href="README.fr-FR.md">Français</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.zh-CN.md">中文</a></p>

<p align="center">
  <img src="docs/assets/logo.svg" width="64" height="64" alt="Monido logo">
</p>

<h1 align="center">Monido</h1>

<p align="center">
  独自或与家人一起跟踪净资产以及收入和支出。自托管，手动录入，不连接银行。
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
  <a href="https://monido.dev">网站</a> · <a href="https://demo.monido.dev">在线演示</a> · <a href="#快速开始">快速开始</a> · <a href="#文档">文档</a> · <a href="#参与贡献">参与 Monido 的开发</a> · <a href="https://github.com/stanislav-petryashov/monido/releases">版本发布</a>
</p>

<p align="center">
  <img src="docs/assets/screenshot.png" width="100%" alt="浅色和深色主题下的概览页面">
</p>

## 为什么选择 Monido？

适合想按月了解自己的钱的人，无论是自己一个人，还是和家人一起。

- **数据由你掌控。** 在你自己的服务器上运行，数据库和备份都在你手里，可选的集成由你决定是否开启。
- **看到全家的财务。** 把账户、投资、房产和贷款放在一个视图里，金额按持有人和货币分组。
- **不连接银行也能看清进展。** 每月录入余额，也可以录入收入和支出，就能看到净资产和目标的变化。不需要每天记账。

## 功能

- **净资产以及收入和支出：** 按月的历史、资产配置、收入和支出分类、储蓄率。可以只跟踪余额，也可以同时跟踪收入和支出。
- **月度更新：** 自动保存的月度结算向导；只有已结算的月份才进入仪表盘的计算。
- **贷款和房产：** 房产估值、贷款还款计划，以及提前还款方案的对比。
- **目标和财务自由：** 进度、预测、备选方案，以及计算过程的说明。
- **财务健康：** 各项指标、它们的阈值和背后的数字；数据不完整时也会明确显示。
- **可选的 Claude 和 Telegram 集成：** 借助银行对账单录入数据、财务问答、家庭提案和提醒。顾问需要 HTTPS，并且需要家庭密码或 Telegram 登录；核心仪表盘不依赖这些服务。
- **为自托管而设计：** 一个 Docker 容器加一个 SQLite 数据库，备份和恢复，可撤销部分操作的变更历史，多币种，浅色和深色主题。

## 实际示例

查看[七个家庭理财用例](docs/use-cases/README.md)：多币种的财富、扣除负债后的净资产、每月储蓄、应急资金、储蓄目标、借助顾问做家庭决定，以及通过 Claude 根据银行对账单结算月份。每个示例都包含虚构数据、验证结果和局限。

## 快速开始

想先看看？[试用演示](https://demo.monido.dev)：一个虚构的家庭，一份 15 分钟的私有副本，无需安装。登录页面上会显示演示密码。你的修改只影响你的临时副本。

演示不包含 Claude 顾问和 Telegram 提醒，也不能下载数据库。这些功能在你自己的安装中可用。请在演示中只使用虚构数据。

你需要 Docker 和 Docker Compose v2.24 或更新版本（Linux，或 macOS 上的 Docker Desktop）。在一个新文件夹中执行：

```bash
mkdir family-finance && cd family-finance
curl -fsSLO https://raw.githubusercontent.com/stanislav-petryashov/monido/master/docker-compose.yml
docker compose up -d
```

在 15 分钟内打开 http://127.0.0.1:8080 并设置家庭密码。密码或 Telegram 登录在网页界面中管理；服务器设置（端口、地址）写在可选的 `.env` 中（[`.env.example`](.env.example)，[完整指南](docs/deploy-docker.md#installation)）。更新：`docker compose pull && docker compose up -d`。遇到问题？请看[故障排除](docs/deploy-docker.md#troubleshooting)。

数据保存在以文件夹命名的 Docker 卷（`family-finance_data`）中；`docker compose down -v` 会删除它，所以永远不要加 `-v`。

## 获取方式

- **Docker Compose**，适用于任何 Linux 服务器或 Docker Desktop：见[快速开始](#快速开始)。镜像是 `ghcr.io/stanislav-petryashov/monido`（amd64 和 arm64）。
- **Unraid：** 在 Community Applications 中搜索 Monido。它以数据文件夹所有者的身份运行（默认 `PUID` 99，`PGID` 100）。
- **PikaPods**（托管服务）：暂不可用。[为 Monido 投票](https://feedback.pikapods.com/posts/1289/monido-self-hosted-family-net-worth-and-cash-flow-tracker)，让它被加入。
- **Claude 连接器（MCP）：** 已收录在[官方 MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.stanislav-petryashov/monido) 和 [Glama](https://glama.ai/mcp/servers/stanislav-petryashov/monido)。

## 语言

界面支持英语、俄语、德语、西班牙语、法语、巴西葡萄牙语和简体中文。德语、西班牙语、法语、葡萄牙语和中文文本是机器翻译，正在等待母语者审校。欢迎指正：见 [Translating](docs/translating.md)。

[![Translation status](https://hosted.weblate.org/widget/monido/svg-badge.svg)](https://hosted.weblate.org/engage/monido/)

翻译在 [Weblate](https://hosted.weblate.org/engage/monido/) 上进行：选择你的语言，修改或审核文本，改动会以拉取请求的形式回到本仓库。

本 README 译自英文版；两者不一致时，以[英文版](README.md)为准。

## 文档

以下文档均为英文。

- [用户指南](docs/user-guide.md)：各个页面、月度更新和设置。
- [配置](docs/configuration.md)：环境变量、登录方式和可选集成。
- [部署](docs/deploy-docker.md)：Docker、反向代理后的 HTTPS、更新和备份、公开演示。
- [开发](docs/development.md)：从源码运行、命令和截图。
- [架构](docs/architecture.md)：代码地图、数据模型和操作指南。
- [财务规则](docs/finance-rules.md)：每项指标如何计算和评估。
- [数据库结构](docs/schema.md)：当前的表和兼容性规则。
- [设计系统](docs/design-system.md)：界面的令牌、组件和规则。
- [维护](docs/maintaining.md)：首次公开发布和发布新版本。

## 参与贡献

贡献可以是代码、更清晰的文档、翻译修正、无障碍改进、计算核对，或者来自真实自托管安装的反馈。

从 [CONTRIBUTING.md](CONTRIBUTING.md) 开始，了解环境搭建和贡献准则。[提交 issue](https://github.com/stanislav-petryashov/monido/issues/new/choose) 来报告问题，或在较大的改动之前讨论想法。想长期帮忙维护某一部分？告诉我们你在用哪一部分、想参与哪一部分。

如果 Monido 对你有用，点一个 star，或者推荐给需要它的人，都是对项目的帮助。

## 安全

登录、会话、限流、Content-Security-Policy，以及如何私下报告漏洞：[SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE)。
