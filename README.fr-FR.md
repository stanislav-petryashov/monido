[English](README.md) · [Русский](README.ru-RU.md) · [Deutsch](README.de-DE.md) · [Español](README.es-ES.md) · [Français](README.fr-FR.md) · [Português](README.pt-BR.md) · [中文](README.zh-CN.md)

![Logo de Monido](docs/assets/logo.svg)

# Monido

Suivez votre patrimoine net, vos revenus et vos dépenses, seul ou en famille. Auto-hébergé, saisi à la main, sans connexion bancaire.

[![Latest release](https://img.shields.io/github/v/release/stanislav-petryashov/monido)](https://github.com/stanislav-petryashov/monido/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/stanislav-petryashov/monido/docker.yml?branch=master&label=CI)](https://github.com/stanislav-petryashov/monido/actions/workflows/docker.yml) [![License: MIT](https://img.shields.io/github/license/stanislav-petryashov/monido)](LICENSE) [![Last commit](https://img.shields.io/github/last-commit/stanislav-petryashov/monido)](https://github.com/stanislav-petryashov/monido/commits/master)

[![Docker image](https://img.shields.io/badge/docker-ghcr.io-2496ED?logo=docker&logoColor=white)](https://github.com/stanislav-petryashov/monido/pkgs/container/monido) [![Live demo](https://img.shields.io/badge/demo-live-5B4BE0)](https://demo.monido.dev) [![MCP Registry](https://img.shields.io/badge/MCP-registry-black)](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.stanislav-petryashov/monido)

[Site web](https://monido.dev) · [Démo en ligne](https://demo.monido.dev) · [Participer à Monido](CONTRIBUTING.md) · [Versions](https://github.com/stanislav-petryashov/monido/releases)

[Essayer la démo en ligne](https://demo.monido.dev) : une famille fictive dans une copie privée pendant 15 minutes, rien à installer ; l’écran de connexion affiche le mot de passe.

![La page Vue d’ensemble en thème clair et en thème sombre](docs/assets/screenshot.png)

## Les questions auxquelles Monido répond

- **Combien possédons-nous, dettes déduites ?** Les comptes, les placements, l’immobilier et les crédits de chaque membre de la famille, dans toutes les devises, en un seul chiffre. [Exemple](docs/use-cases/family-net-worth.md)
- **Nous sommes-nous enrichis cette année, ou ce sont les prix et les taux de change qui ont bougé ?** Le patrimoine net dans le temps, et sa croissance réelle après inflation dans la devise où vous dépensez. [Exemple](docs/use-cases/wealth-change.md) · [formule](docs/finance-rules.md#rule-4-real-net-worth-growth-real_growth_yoy)
- **Combien avons-nous épargné nous-mêmes, et combien a augmenté tout seul ?** L’épargne et le taux d’épargne de chaque mois, et la croissance au-delà de l’épargne. [Exemple](docs/use-cases/monthly-savings.md) · [formule](docs/finance-rules.md#growth-beyond-savings-growth_beyond_savings)
- **Combien de temps tiendrions-nous sans revenus ?** L’épargne de précaution en mois de dépenses. [Exemple](docs/use-cases/emergency-reserve.md) · [formule](docs/finance-rules.md#rule-1-emergency-fund-emergency_months)
- **Quand atteindrons-nous nos objectifs, et pouvons-nous nous permettre cet achat ?** Les dates des objectifs d’après ce que vous épargnez réellement ; avec le Conseiller Claude (facultatif), un achat ou un crédit est évalué à partir de vos propres chiffres puis soumis au vote de la famille. [Objectifs](docs/use-cases/savings-goal.md) · [Une décision familiale](docs/use-cases/family-decision.md)

## Démarrage rapide

Il vous faut Docker avec Docker Compose 2.24 ou plus récent (Linux, ou Docker Desktop sous macOS). Dans un nouveau dossier :

```bash
mkdir monido && cd monido
curl -fsSLO https://raw.githubusercontent.com/stanislav-petryashov/monido/master/docker-compose.yml
docker compose up -d
```

Ouvrez http://127.0.0.1:8080 dans les 15 minutes et définissez le mot de passe familial. Les réglages du serveur (port, adresse) se placent dans un fichier `.env` facultatif ([`.env.example`](.env.example), [le guide complet](docs/deploy-docker.md#installation)). Pour mettre à jour : `docker compose pull`, puis `docker compose up -d`. Quelque chose ne fonctionne pas ? [Dépannage](docs/deploy-docker.md#troubleshooting).

**Ce qu’il faut :** un seul conteneur (Node et SQLite, pas de serveur de base de données séparé) pour amd64 et arm64, donc un Raspberry Pi ou un NAS suffit ; moins de 60 Mo de mémoire au repos (`docker stats` sur la démo et sur une installation domestique, versions 1.2 à 1.4) et une image de 250 Mo.

Les données sont conservées dans un volume Docker nommé d’après le dossier (`monido_data`) ; `docker compose down -v` le supprimerait, n’ajoutez donc jamais `-v`. La démo n’a ni le Conseiller Claude ni les rappels Telegram, et sa base de données ne peut pas être téléchargée ; votre propre installation dispose de tout cela.

## Écrans

**Clôturer le mois** : une fois par mois, enregistré au fil de la saisie

![Clôturer le mois : les soldes, les revenus et les dépenses du mois, compte par compte](docs/assets/gallery/close-month.png)

**Objectifs** : des dates fondées sur ce que vous épargnez réellement, et ce qui les ferait bouger

![Objectifs : ce que la famille épargne par mois et quand chaque objectif est atteint](docs/assets/gallery/goals.png)

**Santé financière** : chaque chiffre avec son seuil et sa formule

![Santé financière : les indicateurs et leurs zones](docs/assets/gallery/health.png)

**Conseiller** (facultatif) : une décision avec ses conséquences, soumise au vote de la famille

![Conseiller : une proposition à la famille, avec ses conséquences et les votes](docs/use-cases/assets/UC-07-voter.png)


## Fonctionnement et limites

Une fois par mois, la famille saisit le solde de fin de mois de chaque compte et, si vous voulez les chiffres de revenus et de dépenses, les revenus et les dépenses du mois ; Clôturer le mois vérifie que chaque compte est rempli, puis ajoute le mois au tableau de bord. Seuls les mois clôturés comptent, chaque chiffre est calculé par l’application à partir de ce qui a été saisi, et chaque formule est décrite dans les [règles financières](docs/finance-rules.md).

Monido vous convient si vous pouvez faire tourner un conteneur sur un serveur domestique, un NAS ou un VPS, si l’argent de la famille est réparti entre plusieurs banques, devises et biens immobiliers, et si vous voulez voir le patrimoine et sa tendance plutôt que chaque achat.

Ce n’est ni un livre de comptes au quotidien, ni un budget par enveloppes, ni un suivi de portefeuille aux cours en temps réel, et il ne se connecte jamais à une banque et ne déplace jamais d’argent. Pour un livre de comptes opération par opération ou des budgets, regardez Firefly III ou Actual Budget ; pour les cours des placements en temps réel, Ghostfolio.

## Fonctionnalités

- **Patrimoine net, revenus et dépenses :** historique mensuel, répartition par titulaire, par devise et par type d’actif, catégories de revenus et de dépenses, taux d’épargne ; les soldes seuls suffisent pour commencer.
- **Crédits et immobilier :** tableaux d’amortissement, comparaison des remboursements anticipés et estimations des biens.
- **Objectifs et indépendance financière :** progression, prévisions, alternatives et le calcul derrière chaque date.
- **Santé financière :** des indicateurs avec leurs seuils et leurs données d’entrée ; les données manquantes sont signalées, jamais comptées comme zéro.
- **Pour la famille :** écritures partagées, connexion avec le mot de passe familial ou individuellement via Telegram, droits par membre, rappels et propositions dans Telegram.
- **Auto-hébergement :** sauvegarde et restauration, export de toutes les données en CSV, historique des modifications avec annulation, plusieurs devises, sept langues, thèmes clair et sombre.

## Confidentialité et IA

Vos données restent dans la base SQLite de votre serveur. Le serveur lui-même n’envoie vers l’extérieur qu’une requête de taux de change (à Frankfurter, ou à votre propre instance) et, une fois par jour, le nom de l’image pour vérifier les mises à jour (`UPDATE_CHECK=off` l’arrête) ; Telegram n’est contacté que si vous l’activez. Le cœur de l’application ne contient aucune IA : le Conseiller Claude reste désactivé tant que vous n’avez pas connecté votre propre compte Claude, et ensuite votre conversation et les chiffres que Claude demande vont à Anthropic par ce compte, jamais par l’application.

## État du projet

Monido est jeune : son historique public commence en novembre 2026, il a un seul mainteneur et de nouvelles versions sortent souvent (voir les [versions](https://github.com/stanislav-petryashov/monido/releases) et le [journal des modifications](CHANGELOG.md)). Les mises à jour conservent vos données : une base existante est vérifiée à chaque démarrage et n’est jamais modifiée à votre insu, et vous pouvez [en télécharger une copie](docs/deploy-docker.md#backup-and-restore) avant de mettre à jour. Cinq des sept langues sont des traductions automatiques en attente de relecture. La suite figure dans la [feuille de route](https://github.com/stanislav-petryashov/monido/discussions/27).

## Où l’obtenir

- **Docker Compose** sur n’importe quel serveur Linux ou Docker Desktop : voir le démarrage rapide. L’image est `ghcr.io/stanislav-petryashov/monido` (amd64 et arm64).
- **Unraid :** cherchez Monido dans Community Applications. Il s’exécute sous le propriétaire du dossier de données (`PUID` 99, `PGID` 100 par défaut).
- **PikaPods** (hébergement géré) : pas encore disponible. [Votez pour Monido](https://feedback.pikapods.com/posts/1289/monido-self-hosted-family-net-worth-and-cash-flow-tracker) pour qu’il soit ajouté.
- **Connecteur Claude (MCP) :** référencé dans le [registre MCP officiel](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.stanislav-petryashov/monido) et sur [Glama](https://glama.ai/mcp/servers/stanislav-petryashov/monido).

## Langues

L’interface est disponible en anglais, russe, allemand, espagnol, français, portugais du Brésil et chinois simplifié. Les textes en allemand, espagnol, français, portugais et chinois sont des traductions automatiques qui attendent la relecture de locuteurs natifs. Les corrections sont les bienvenues : voir [Traduire](docs/translating.md). Ce README est une traduction du README anglais, qui fait foi en cas de différence.

[![Translation status](https://hosted.weblate.org/widget/monido/svg-badge.svg)](https://hosted.weblate.org/engage/monido/)

Les traductions sont gérées sur [Weblate](https://hosted.weblate.org/engage/monido/) : choisissez votre langue, corrigez ou approuvez des chaînes, et les modifications reviennent dans ce dépôt sous forme de pull request.

## Documentation

- [Exemples détaillés](docs/use-cases/README.md) (en anglais, comme toute la documentation) : sept questions de ménage avec des données fictives, les résultats de vérification et les limites.
- [Guide de l’utilisateur](docs/user-guide.md) : les pages, la mise à jour mensuelle et les paramètres.
- [Configuration](docs/configuration.md) : variables d’environnement, modes de connexion et intégrations facultatives.
- [Déploiement](docs/deploy-docker.md) : Docker, HTTPS derrière un reverse proxy, mises à jour et sauvegardes, la démo publique.
- [Développement](docs/development.md) : lancer depuis les sources, les commandes et les captures d’écran.
- [Architecture](docs/architecture.md) : la carte du code, le modèle de données et les guides pratiques.
- [Règles financières](docs/finance-rules.md) : comment chaque indicateur est calculé et évalué.
- [Schéma de la base de données](docs/schema.md) : les tables actuelles et les règles de compatibilité.
- [Système de design](docs/design-system.md) : tokens, composants et règles de l’interface.
- [Maintenance](docs/maintaining.md) : la première version publique et la publication d’une version.

## Contribuer

Une contribution peut être du code, une documentation plus claire, des corrections de traduction, des améliorations d’accessibilité, des vérifications de calculs ou des retours d’une vraie installation auto-hébergée.

Commencez par [CONTRIBUTING.md](CONTRIBUTING.md) pour l’installation et les règles de contribution. [Ouvrez une issue](https://github.com/stanislav-petryashov/monido/issues/new/choose) pour signaler un problème ; posez vos questions et discutez de vos idées, y compris avant un changement important, dans [Discussions](https://github.com/stanislav-petryashov/monido/discussions). Les issues marquées [good first issue](https://github.com/stanislav-petryashov/monido/labels/good%20first%20issue) sont une porte d’entrée modeste et autonome. Vous aimeriez aider à maintenir une partie du projet dans la durée ? Dites-nous laquelle vous utilisez et sur laquelle vous voudriez travailler.

Si Monido vous est utile, une étoile ou une recommandation à quelqu’un qui en a besoin aide le projet.

## Sécurité

Connexion, sessions, limitation des tentatives, Content-Security-Policy et comment signaler une vulnérabilité en privé : [SECURITY.md](SECURITY.md).

## Licence

[MIT](LICENSE).
