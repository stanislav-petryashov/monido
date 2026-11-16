<p align="center"><a href="README.md">English</a> · <a href="README.ru-RU.md">Русский</a> · <a href="README.de-DE.md">Deutsch</a> · <a href="README.es-ES.md">Español</a> · <a href="README.fr-FR.md">Français</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.zh-CN.md">中文</a></p>

<p align="center">
  <img src="docs/assets/logo.svg" width="64" height="64" alt="Logo de Monido">
</p>

<h1 align="center">Monido</h1>

<p align="center">
  Suivez votre patrimoine net, vos revenus et vos dépenses, seul ou en famille. Auto-hébergé, saisi à la main, sans connexion bancaire.
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
  <a href="https://monido.dev">Site web</a> · <a href="https://demo.monido.dev">Démo en ligne</a> · <a href="#démarrage-rapide">Démarrage rapide</a> · <a href="#documentation">Documentation</a> · <a href="#contribuer">Contribuer à Monido</a> · <a href="https://github.com/stanislav-petryashov/monido/releases">Versions</a>
</p>

<p align="center">
  <img src="docs/assets/screenshot.png" width="100%" alt="La page Vue d’ensemble en thème clair et en thème sombre">
</p>

## Pourquoi Monido ?

Pour celles et ceux qui veulent comprendre leur argent mois après mois, seuls ou en famille.

- **Gardez la maîtrise de vos données.** Monido tourne sur votre propre serveur, vous conservez la base de données et les sauvegardes, et vous choisissez les intégrations facultatives à activer.
- **Voyez les finances de toute la famille.** Comptes, placements, biens immobiliers et crédits réunis dans une seule vue, avec les montants regroupés par titulaire et par devise.
- **Suivez votre progression sans connecter de banque.** Saisissez les soldes de chaque mois et, si vous le souhaitez, les revenus et les dépenses, pour voir évoluer votre patrimoine net et vos objectifs. Aucune saisie quotidienne des opérations n’est nécessaire.

## Fonctionnalités

- **Patrimoine net, revenus et dépenses :** historique mensuel, répartition des actifs, catégories de revenus et de dépenses, taux d’épargne. Suivez les soldes seuls ou ajoutez les revenus et les dépenses.
- **Mises à jour mensuelles :** un assistant de clôture du mois qui enregistre automatiquement ; seuls les mois clôturés entrent dans les calculs du tableau de bord.
- **Crédits et immobilier :** estimations des biens, échéanciers de crédit et comparaison des remboursements anticipés.
- **Objectifs et indépendance financière :** progression, prévisions, scénarios alternatifs et explication des calculs.
- **Santé financière :** indicateurs, seuils et chiffres sur lesquels ils reposent ; les données incomplètes restent visibles.
- **Intégrations Claude et Telegram facultatives :** saisie assistée à partir des relevés, questions financières, propositions à la famille et rappels. Le Conseiller exige HTTPS et le mot de passe familial ou la connexion par Telegram ; ces services ne sont pas nécessaires au tableau de bord lui-même.
- **Conçu pour l’auto-hébergement :** un seul conteneur Docker et une base SQLite, sauvegarde et restauration, historique des modifications avec annulation des opérations prises en charge, plusieurs devises, thèmes clair et sombre.

## Exemples concrets

Découvrez [sept cas d’usage des finances d’un foyer](docs/use-cases/README.md) : le patrimoine en plusieurs devises, le patrimoine net après les dettes, l’épargne mensuelle, l’épargne de précaution, les objectifs d’épargne, les décisions familiales avec le Conseiller et la clôture d’un mois à partir de relevés bancaires avec Claude. Chaque exemple comprend des données fictives, les résultats de vérification et les limites.

## Démarrage rapide

Vous voulez d’abord regarder ? [Essayez la démo](https://demo.monido.dev) : une famille fictive, une copie privée pendant 15 minutes, rien à installer. L’écran de connexion affiche le mot de passe de la démo. Vos modifications ne touchent que votre copie temporaire.

La démo ne comprend ni le Conseiller Claude ni les rappels Telegram, et le téléchargement de la base de données y est désactivé. Ces fonctions sont disponibles dans votre propre installation. Merci de n’utiliser que des données fictives dans la démo.

Il vous faut Docker avec Docker Compose v2.24 ou plus récent (Linux, ou Docker Desktop sous macOS). Dans un nouveau dossier :

```bash
mkdir family-finance && cd family-finance
curl -fsSLO https://raw.githubusercontent.com/stanislav-petryashov/monido/master/docker-compose.yml
docker compose up -d
```

Ouvrez http://127.0.0.1:8080 dans les 15 minutes et définissez le mot de passe familial. Le mot de passe et la connexion par Telegram se gèrent dans l’interface web ; les réglages du serveur (port, adresse) vont dans un fichier `.env` facultatif ([`.env.example`](.env.example), [le guide complet](docs/deploy-docker.md#installation)). Pour mettre à jour : `docker compose pull && docker compose up -d`. Quelque chose ne fonctionne pas ? [Dépannage](docs/deploy-docker.md#troubleshooting).

Les données sont conservées dans un volume Docker nommé d’après le dossier (`family-finance_data`) ; `docker compose down -v` le supprimerait, n’ajoutez donc jamais `-v`.

## Où l’obtenir

- **Docker Compose** sur n’importe quel serveur Linux ou Docker Desktop : voir [Démarrage rapide](#démarrage-rapide). L’image est `ghcr.io/stanislav-petryashov/monido` (amd64 et arm64).
- **Unraid :** cherchez Monido dans Community Applications. Il s’exécute sous le propriétaire du dossier de données (`PUID` 99, `PGID` 100 par défaut).
- **PikaPods** (hébergement géré) : pas encore disponible. [Votez pour Monido](https://feedback.pikapods.com/posts/1289/monido-self-hosted-family-net-worth-and-cash-flow-tracker) pour qu’il soit ajouté.
- **Connecteur Claude (MCP) :** référencé dans le [registre MCP officiel](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.stanislav-petryashov/monido) et sur [Glama](https://glama.ai/mcp/servers/stanislav-petryashov/monido).

## Langues

L’interface est disponible en anglais, russe, allemand, espagnol, français, portugais du Brésil et chinois simplifié. Les textes allemands, espagnols, français, portugais et chinois sont des traductions automatiques qui attendent la relecture de locuteurs natifs. Les corrections sont les bienvenues : voir [Translating](docs/translating.md).

Ce README est une traduction du README anglais, qui fait foi en cas de différence.

## Documentation

La documentation est en anglais.

- [Guide de l’utilisateur](docs/user-guide.md) : les pages, la mise à jour mensuelle et les paramètres.
- [Configuration](docs/configuration.md) : variables d’environnement, modes de connexion et intégrations facultatives.
- [Déploiement](docs/deploy-docker.md) : Docker, HTTPS derrière un proxy inverse, mises à jour et sauvegardes, la démo publique.
- [Développement](docs/development.md) : lancer depuis les sources, les commandes et les captures d’écran.
- [Architecture](docs/architecture.md) : la carte du code, le modèle de données et les guides pratiques.
- [Règles financières](docs/finance-rules.md) : comment chaque indicateur est calculé et évalué.
- [Schéma de la base de données](docs/schema.md) : les tables actuelles et les règles de compatibilité.
- [Design system](docs/design-system.md) : tokens, composants et règles de l’interface.
- [Maintenance](docs/maintaining.md) : la première version publique et la publication d’une version.

## Contribuer

Vous pouvez contribuer par du code, une documentation plus claire, des corrections de traduction, des améliorations d’accessibilité, des vérifications de calcul ou des retours d’une vraie installation auto-hébergée.

Commencez par [CONTRIBUTING.md](CONTRIBUTING.md) pour l’installation et les règles de contribution. [Ouvrez une issue](https://github.com/stanislav-petryashov/monido/issues/new/choose) pour signaler un problème ou discuter d’une idée avant un changement important. Vous aimeriez vous occuper d’une partie du projet dans la durée ? Dites-nous laquelle vous utilisez et sur laquelle vous aimeriez travailler.

Si Monido vous est utile, une étoile sur GitHub ou une recommandation à quelqu’un qui en a besoin aide le projet.

## Sécurité

Connexion, sessions, limitation des tentatives, Content-Security-Policy et signalement privé d’une vulnérabilité : [SECURITY.md](SECURITY.md).

## Licence

[MIT](LICENSE).
