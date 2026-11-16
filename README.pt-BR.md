<p align="center"><a href="README.md">English</a> · <a href="README.ru-RU.md">Русский</a> · <a href="README.de-DE.md">Deutsch</a> · <a href="README.es-ES.md">Español</a> · <a href="README.fr-FR.md">Français</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.zh-CN.md">中文</a></p>

<p align="center">
  <img src="docs/assets/logo.svg" width="64" height="64" alt="Monido logo">
</p>

<h1 align="center">Monido</h1>

<p align="center">
  Acompanhe seu patrimônio líquido, suas receitas e despesas, sozinho ou em família. Auto-hospedado, com dados digitados à mão, sem conexão com bancos.
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
  <a href="https://monido.dev">Site</a> · <a href="https://demo.monido.dev">Demo</a> · <a href="#início-rápido">Início rápido</a> · <a href="#documentação">Documentação</a> · <a href="#como-contribuir">Ajude a construir o Monido</a> · <a href="https://github.com/stanislav-petryashov/monido/releases">Versões</a>
</p>

<p align="center">
  <img src="docs/assets/screenshot.png" width="100%" alt="A página Visão geral no tema claro e no tema escuro">
</p>

## Por que o Monido?

Para quem quer entender o próprio dinheiro mês a mês, sozinho ou junto com a família.

- **Mantenha o controle dos seus dados.** Rode o Monido no seu próprio servidor, guarde o banco de dados e os backups e escolha quais integrações opcionais ativar.
- **Veja as finanças de toda a família.** Reúna contas, investimentos, imóveis e empréstimos em uma só visão, com os valores agrupados por titular e por moeda.
- **Acompanhe o progresso sem conectar um banco.** Informe os saldos mensais e, se quiser, as receitas e despesas, para ver como mudam seu patrimônio líquido e suas metas. Não é preciso lançar transações todos os dias.

## Recursos

- **Patrimônio líquido, receitas e despesas:** histórico mensal, alocação de ativos, categorias de receitas e despesas e taxas de poupança. Acompanhe só os saldos ou inclua também receitas e despesas.
- **Atualização mensal:** o assistente de fechamento do mês salva automaticamente; só os meses fechados entram nos cálculos do painel.
- **Empréstimos e imóveis:** avaliações de imóveis, cronogramas de empréstimos e comparação de pagamentos antecipados.
- **Metas e independência financeira:** progresso, previsões, cenários alternativos e explicações dos cálculos.
- **Saúde financeira:** indicadores, seus limites e os números por trás deles; dados incompletos continuam visíveis.
- **Integrações opcionais com Claude e Telegram:** lançamentos a partir de extratos, perguntas sobre finanças, propostas para a família e lembretes. O Consultor exige HTTPS e a senha da família ou o login pelo Telegram; esses serviços não são necessários para o painel principal.
- **Feito para auto-hospedagem:** um contêiner Docker e um banco de dados SQLite, backup e restauração, histórico de alterações com desfazer para as operações suportadas, várias moedas, temas claro e escuro.

## Exemplos práticos

Conheça [sete casos de uso de finanças domésticas](docs/use-cases/README.md): patrimônio em várias moedas, patrimônio líquido descontadas as dívidas, poupança mensal, reserva de emergência, metas de poupança, decisões em família com o Consultor e o fechamento do mês a partir de extratos bancários com o Claude. Cada exemplo traz dados fictícios, resultados de verificação e limitações.

## Início rápido

Quer olhar antes? [Experimente a demo](https://demo.monido.dev): uma família fictícia, uma cópia privada por 15 minutos, nada para instalar. A tela de login mostra a senha da demo. As alterações afetam apenas a sua cópia temporária.

A demo não inclui o Consultor do Claude nem os lembretes do Telegram, e o download do banco de dados está desativado. Esses recursos estão disponíveis na sua própria instalação. Use apenas dados fictícios na demo.

Você precisa do Docker com o Docker Compose v2.24 ou mais recente (Linux, ou Docker Desktop no macOS). Em uma pasta nova:

```bash
mkdir monido && cd monido
curl -fsSLO https://raw.githubusercontent.com/stanislav-petryashov/monido/master/docker-compose.yml
docker compose up -d
```

Abra http://127.0.0.1:8080 em até 15 minutos e defina a senha da família. O login por senha ou pelo Telegram é gerenciado na interface web; as configurações do servidor (porta, endereço) ficam em um `.env` opcional ([`.env.example`](.env.example), [o guia completo](docs/deploy-docker.md#installation)). Para atualizar: `docker compose pull && docker compose up -d`. Algo não funciona? [Solução de problemas](docs/deploy-docker.md#troubleshooting).

Os dados ficam em um volume Docker com o nome da pasta (`monido_data`); `docker compose down -v` o apagaria, então nunca acrescente `-v`.

## Onde obter

- **Docker Compose** em qualquer servidor Linux ou no Docker Desktop: veja o [Início rápido](#início-rápido). A imagem é `ghcr.io/stanislav-petryashov/monido` (amd64 e arm64).
- **Unraid:** procure Monido em Community Applications. Ele roda como o dono da pasta de dados (`PUID` 99 e `PGID` 100 por padrão).
- **PikaPods** (hospedagem gerenciada): ainda não disponível. [Vote no Monido](https://feedback.pikapods.com/posts/1289/monido-self-hosted-family-net-worth-and-cash-flow-tracker) para que ele seja adicionado.
- **Conector do Claude (MCP):** publicado no [MCP Registry oficial](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.stanislav-petryashov/monido) e no [Glama](https://glama.ai/mcp/servers/stanislav-petryashov/monido).

## Idiomas

A interface está disponível em inglês, russo, alemão, espanhol, francês, português do Brasil e chinês simplificado. Os textos em alemão, espanhol, francês, português e chinês são traduções automáticas que aguardam revisão de falantes nativos. Correções são bem-vindas: veja [Translating](docs/translating.md).

[![Translation status](https://hosted.weblate.org/widget/monido/svg-badge.svg)](https://hosted.weblate.org/engage/monido/)

As traduções são feitas no [Weblate](https://hosted.weblate.org/engage/monido/): escolha seu idioma, corrija ou aprove os textos, e as mudanças chegam a este repositório como pull request.

Este README é uma tradução do README em inglês; se houver diferença, vale o [original em inglês](README.md).

## Documentação

Os documentos abaixo estão em inglês.

- [Guia do usuário](docs/user-guide.md): as páginas, a atualização mensal e as configurações.
- [Configuração](docs/configuration.md): variáveis de ambiente, modos de login e integrações opcionais.
- [Implantação](docs/deploy-docker.md): Docker, HTTPS atrás de um proxy reverso, atualizações e backups, a demo pública.
- [Desenvolvimento](docs/development.md): como rodar a partir do código-fonte, os comandos e as capturas de tela.
- [Arquitetura](docs/architecture.md): o mapa do código, o modelo de dados e os guias práticos.
- [Regras financeiras](docs/finance-rules.md): como cada métrica é calculada e avaliada.
- [Esquema do banco de dados](docs/schema.md): as tabelas atuais e as regras de compatibilidade.
- [Design system](docs/design-system.md): tokens, componentes e regras da interface.
- [Manutenção](docs/maintaining.md): a primeira versão pública e como publicar uma versão.

## Como contribuir

Uma contribuição pode ser código, uma documentação mais clara, correções de tradução, melhorias de acessibilidade, conferência de cálculos ou relatos de uma instalação auto-hospedada real.

Comece pelo [CONTRIBUTING.md](CONTRIBUTING.md), com a configuração do ambiente e as diretrizes de contribuição. [Abra uma issue](https://github.com/stanislav-petryashov/monido/issues/new/choose) para relatar um problema ou discutir uma ideia antes de uma mudança maior. Quer ajudar a manter uma área ao longo do tempo? Conte qual parte você usa e em qual gostaria de trabalhar.

Se o Monido for útil para você, uma estrela ou uma indicação a alguém que precise dele ajuda o projeto.

## Segurança

Login, sessões, limitação de tentativas, a Content-Security-Policy e como relatar uma vulnerabilidade em particular: [SECURITY.md](SECURITY.md).

## Licença

[MIT](LICENSE).
