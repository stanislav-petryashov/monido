# Translating Monido

Monido is a self-hosted family net worth and cash-flow app: a family enters account balances, income and expenses once a month, and the pages show net worth, goals and financial health. This file is the brief for translating its interface: for machine translation, for contributors who add a string, and for reviewers.

## 1. Languages and how they stay complete

| Code | Language | Role |
| --- | --- | --- |
| `en-US` | English | the source: the key set and the meaning of every string |
| `ru-RU` | Russian | written by the maintainer |
| `de-DE` | German | translated from English |
| `es-ES` | Spanish (Spain) | translated from English |
| `fr-FR` | French | translated from English |
| `pt-BR` | Portuguese (Brazil) | translated from English |
| `zh-CN` | Chinese (Simplified) | translated from English |

The strings live in `src/locales/<lang>.json` and in the lazily loaded chunks `src/locales/<chunk>/<lang>.json` (`advisor`, `analysis`, `planning`, `records`). A key keeps its file: translate each file into the file of the same name.

English is written with the code; the other languages follow. Checked by `tests/i18n/locales.test.ts` on every push:

- **English and Russian are complete.** A code change adds its keys to `en-US` and `ru-RU` in the same pull request.
- **German, Spanish, French, Brazilian Portuguese and Chinese may lag behind.** A key they lack falls back to English until it is translated on Weblate (section 7). They may never have a key English lacks.
- **What a language has must be right:** the placeholders and markup of English, all the plural forms of the language for a plural key it has.
- **No English left in another language.** A value equal to the English one fails the "no copy of English" test: a key not translated yet is left out, not filled with English. Where the same text is correct (a brand, a code, a formula such as `1 USD = {{rate}} {{code}}`, a word the language shares with English), the key is listed for that language in `tests/i18n/sameAsEnglish.ts`; a translator who meets such a value reports the key rather than rewording a correct value to get past the test.

## 2. Style

- **Address.** de: "Sie". fr: "vous". es: "tú". pt-BR: "você". zh: "你" (not "您"). Never mix forms inside a language.
- **Register.** Plain, short interface language, the same register as the English: calm and factual. No exclamation marks, no "please" where English has none, no marketing words.
- **Infinitive or imperative.** Buttons and menu items: de infinitive ("Speichern"), fr infinitive ("Enregistrer"), es infinitive ("Guardar"), pt-BR infinitive ("Salvar"), zh the bare verb ("保存"). Instructions in running text use the address form above.
- **Length.** Stay close to the English length: many strings sit in buttons, table heads and narrow tiles. German may run longer; choose the shorter common word ("Konto", not "Bankverbindung") and avoid stacking compounds.
- **Capitals.** Sentence case for buttons and titles, as English does ("Close month", not "Close Month"). German capitalises nouns as the language requires and nothing else. Keep a lower-case English fragment lower-case (`rights.vote`, chart labels): it is inserted into a sentence.
- **Full stops.** No full stop where English has none; keep it where English has one.
- **Punctuation of the language.** Quotation marks: de „…“, fr « … », es «…», pt-BR “…”, zh “…”. French takes a no-break space before `:` `;` `?` and inside « ». Chinese uses full-width punctuation (，。：？（）) and no space between Chinese characters and a placeholder.
- **Meaning first.** English is the meaning, not the word order. Translate the sentence, not the words; a finance term takes the rendering in the glossary below.

## 3. Mechanics

**Placeholders.** `{{name}}` is copied exactly: the same braces, the same name, never translated, never dropped. It may move to where the sentence needs it. A value with a format (`{{rate, decimal}}`) keeps the whole expression.

**Markup.** Tags such as `<0>…</0>`, `<strong>…</strong>`, `<code>…</code>`, `<lead>…</lead>` and self-closing ones such as `<account/>` or `<month/>` keep their names and nesting. Translate the text inside a tag; move a tag with its text when the word order changes. Do not add tags. Text inside `<code>` (a shell command, a password) is not translated.

**Plurals.** A plural key is a set `key_one`, `key_other`, … Each language holds exactly its own CLDR categories (those of `Intl.PluralRules`), no more and no fewer:

| Language | Forms | Remarks |
| --- | --- | --- |
| en-US, de-DE | `_one`, `_other` | |
| es-ES | `_one`, `_many`, `_other` | `_one` is 1 only |
| fr-FR, pt-BR | `_one`, `_many`, `_other` | `_one` covers 0 and 1 |
| zh-CN | `_other` | one form |
| ru-RU | `_one`, `_few`, `_many`, `_other` | |

`_many` in Spanish, French and Portuguese is the form for whole millions (1 000 000); it normally holds the same text as `_other`. `{{count}}` may be left out of a form only where that reads naturally ("one month" for "1 month"); `_other` and `_many` always keep it.

**Numbers, dates and currencies are formatted by code.** Never write digits, month names, percent signs or currency symbols into a template unless the English value has them literally. Do not convert units or reorder `{{value}}` and its unit against the language's habit.

**The `dates.*` keys** hold month names in the grammatical form each key describes:

| Key | Holds | English |
| --- | --- | --- |
| `dates.month.N` | the standalone name | "May" |
| `dates.inMonth.N` | "in" plus the month | "in May" |
| `dates.monthOf.N` | the form that follows a day number | "May" in "May 5" |
| `dates.monthShort.N` | the abbreviation, by the language's convention | "May" |
| `dates.monthYear` | the order of month and year | `{{month}} {{year}}` |
| `dates.dayOfMonth`, `dates.dayOfYear` | the order of day, month and year | `{{month}} {{day}}` |

Month names are lower-case where the language writes them so (es, fr, pt-BR) and capitalised in German. Chinese: `dates.month.N` is "N月" and `dates.monthYear` is `{{year}}年{{month}}`; `dates.dayOfMonth` is `{{month}}{{day}}日`.

**Never translated:** Monido, Telegram, Claude, MCP, @BotFather, FIRE and Coast FIRE, currency codes (USD, EUR, …), file formats (CSV, JSON), commands, paths and anything inside `<code>`.

**Keys and files.** Only values change. Key names, their order and the file layout stay as in English.

## 4. Glossary

One term, one rendering, everywhere. The English column is the app's own wording; the key is one representative place. Forms shown are the ones the key holds (a title, usually plural); inflect as the sentence needs.

| English | Key | de-DE | es-ES | fr-FR | pt-BR | zh-CN |
| --- | --- | --- | --- | --- | --- | --- |
| Net worth | `metrics.net_worth.title` | Nettovermögen | Patrimonio neto | Patrimoine net | Patrimônio líquido | 净资产 |
| Income and expenses | `modules.cashflow.route` | Einnahmen und Ausgaben | Ingresos y gastos | Revenus et dépenses | Receitas e despesas | 收入和支出 |
| Income | `charts.income` | Einnahmen | Ingresos | Revenus | Receitas | 收入 |
| Expenses, spending | `charts.expenses` | Ausgaben | Gastos | Dépenses | Despesas | 支出 |
| Passive income | `metrics.passive_income.title` | Passives Einkommen | Ingresos pasivos | Revenus passifs | Renda passiva | 被动收入 |
| Balance | `data.field.balance` | Saldo | Saldo | Solde | Saldo | 余额 |
| Accounts | `routes.accounts` | Konten | Cuentas | Comptes | Contas | 账户 |
| Brokerage accounts | `pages.assets.type.broker` | Depots | Cuentas de inversión | Comptes-titres | Contas de corretora | 证券账户 |
| Assets | `metrics.assets.title` | Vermögenswerte | Activos | Actifs | Ativos | 资产 |
| Loans | `metrics.liabilities.title` | Kredite | Préstamos | Crédits | Empréstimos | 贷款 |
| Debt | `metrics.debt_to_asset.title` | Schulden | Deuda | Dettes | Dívida | 负债 |
| Mortgage | `data.loans.type.mortgage` | Hypothek | Hipoteca | Crédit immobilier | Financiamento imobiliário | 房贷 |
| Real estate; a property | `modules.real_estate.title` | Immobilien; Immobilie | Inmuebles; inmueble | Immobilier; bien immobilier | Imóveis; imóvel | 房产 |
| Equity (in a property) | `modules.real_estate.eq.equity` | Eigenkapital | Capital propio | Valeur nette | Valor líquido | 房产净值 |
| Savings | `modules.advisor.bot.field.savingsPerMonth` | Ersparnisse | Ahorro | Épargne | Poupança | 储蓄 |
| Savings rate | `metrics.savings_rate.title` | Sparquote | Tasa de ahorro | Taux d'épargne | Taxa de poupança | 储蓄率 |
| Emergency fund | `metrics.emergency_months.title` | Notgroschen | Fondo de emergencia | Épargne de précaution | Reserva de emergência | 应急资金 |
| Cushion | `availability.reserve` | Polster | Colchón | Matelas de sécurité | Colchão | 安全垫 |
| Available money | `routes.availableMoney` | Verfügbares Geld | Dinero disponible | Argent disponible | Dinheiro disponível | 可用资金 |
| Goals | `modules.goals.title` | Ziele | Objetivos | Objectifs | Metas | 目标 |
| Financial independence | `goalsPage.form.fire` | Finanzielle Unabhängigkeit | Independencia financiera | Indépendance financière | Independência financeira | 财务自由 |
| Financial health | `modules.health.route` | Finanzielle Gesundheit | Salud financiera | Santé financière | Saúde financeira | 财务健康 |
| Close month | `routes.close` | Monat abschließen | Cerrar el mes | Clôturer le mois | Fechar o mês | 月度结算 |
| Month-close wizard | `errors.loan_payments_by_wizard` | Monatsabschluss-Assistent | asistente de cierre del mes | assistant de clôture du mois | assistente de fechamento do mês | 月度结算向导 |
| Reopen month | `data.close.reopenConfirm` | Monat wieder öffnen | Reabrir el mes | Rouvrir le mois | Reabrir o mês | 重新打开月份 |
| Setup wizard | `routes.setup` | Einrichtungsassistent | Asistente de configuración | Assistant de configuration | Assistente de configuração | 设置向导 |
| Records | `cashflowPage.capital.closedOnly` | Einträge | Registros | Écritures | Registros | 记录 |
| Categories | `modules.cashflow.spending.categories.title` | Kategorien | Categorías | Catégories | Categorias | 分类 |
| Mandatory (spending) | `modules.cashflow.spending.kind.mandatory` | Notwendig | Obligatorios | Obligatoires | Obrigatórias | 必要支出 |
| Optional (spending) | `modules.cashflow.spending.kind.optional` | Freiwillig | Opcionales | Facultatives | Opcionais | 可选支出 |
| Family | `nav.user.family` | Familie | Familia | Famille | Família | 家庭 |
| Members | `data.params.members` | Mitglieder | Miembros | Membres | Membros | 成员 |
| Owner (of an account) | `data.field.owner` | Inhaber | Titular | Titulaire | Titular | 持有人 |
| manage users and settings | `rights.manage` | Benutzer und Einstellungen verwalten | gestionar usuarios y ajustes | gérer les utilisateurs et les paramètres | gerenciar usuários e configurações | 管理用户和设置 |
| Advisor | `modules.advisor.title` | Berater | Asesor | Conseiller | Consultor | 顾问 |
| Proposals | `modules.advisor.tabs.proposals` | Vorschläge | Propuestas | Propositions | Propostas | 提案 |
| Votes | `modules.advisor.proposals.votes` | Stimmen | Votos | Votes | Votos | 投票 |
| Exchange rate | `pages.assets.noRate` | Wechselkurs | Tipo de cambio | Taux de change | Taxa de câmbio | 汇率 |
| Family currency | `errors.family_currency_in_use` | Familienwährung | moneda de la familia | devise de la famille | moeda da família | 家庭货币 |
| Hide amounts | `common.hideAmounts` | Beträge ausblenden | Ocultar importes | Masquer les montants | Ocultar valores | 隐藏金额 |
| Sample family | `data.danger.demo.title` | Beispielfamilie | Familia de ejemplo | Famille d'exemple | Família de exemplo | 示例家庭 |
| Dashboard | `data.accounts.notClosed` | Dashboard | panel | tableau de bord | painel | 仪表盘 |
| Overview | `routes.overview` | Übersicht | Resumen | Vue d'ensemble | Visão geral | 概览 |
| Settings | `routes.settings` | Einstellungen | Ajustes | Paramètres | Configurações | 设置 |
| Sign in; Sign out | `auth.signIn`, `nav.logout` | Anmelden; Abmelden | Iniciar sesión; Cerrar sesión | Se connecter; Se déconnecter | Entrar; Sair | 登录；退出登录 |
| Family password | `auth.bootstrap.password` | Familienpasswort | Contraseña familiar | Mot de passe familial | Senha da família | 家庭密码 |
| Backup | `data.params.backupTitle` | Sicherung | Copia de seguridad | Sauvegarde | Backup | 备份 |
| Restore | `data.params.restoreSection` | Wiederherstellen | Restaurar | Restaurer | Restaurar | 恢复 |
| Change history | `routes.history` | Änderungsverlauf | Historial de cambios | Historique des modifications | Histórico de alterações | 变更历史 |

Notes:

- **Names the interface does not use.** There is no "cash flow" page: it is "Income and expenses". Liabilities are "Loans" (`metrics.liabilities.title`); "debt" appears only in the health indicators. The "privacy mode" of the user guide is "Hide amounts" / "Show amounts". The demo data is the "Sample family". The base currency is the "family currency". The journal is "Change history". "Dashboard" occurs only inside sentences, never as a menu item.
- **Net worth versus capital.** Both occur in English and mean the same total; render both with the net worth term, except in the Coast FIRE sentences, where "capital" is the invested sum.
- **Expenses and spending** are one concept: one word per language.
- **Income.** de "Einnahmen" and pt-BR "Receitas" for the flow of a month; the fixed phrases "Passives Einkommen" and "Renda passiva" keep their own noun.
- **Emergency fund versus cushion.** Two things: the emergency fund is a health indicator measured in months of expenses; the cushion is the reserve set aside on "Available money". Keep two words.
- **Mortgage.** fr "Crédit immobilier" and pt-BR "Financiamento imobiliário" are what a bank customer says; "hypothèque" and "hipoteca" name the security, not the loan. de "Hypothek" is preferred over "Immobilienkredit" for length. zh: "房贷" for the loan type, "贷款" for loans in general.
- **Equity** is the value of a property minus its loan. It must not reuse the net worth term (es "patrimonio neto", pt-BR "patrimônio líquido").
- **Savings in pt-BR.** "Poupança" also names a kind of bank account; where a sentence could be read that way, use "valor poupado" or "economias".
- **Brokerage accounts.** de "Depots" is the everyday word; fr "Comptes-titres" also stands for a PEA or an assurance-vie account held with a broker.
- **Close month.** zh uses "结算" as the verb ("结算{{month}}", "已结算") and "月度结算" as the page name; do not use "关闭", which reads as closing a window. The same split applies to the "Close" of a dialog in every language: de "Schließen" for a window, "abschließen" for a month; fr "Fermer" and "Clôturer"; pt-BR "Fechar" serves both.
- **Records** are the rows a family enters (accounts, loans, valuations, categories). fr "Écritures" is the bookkeeping word and stays short; do not use "Enregistrements" (it reads as recordings).
- **Owner** is the family member an account, loan or property belongs to, not a system role: a bank-style word ("Inhaber", "Titular", "Titulaire", "持有人"), not "Besitzer" or "propriétaire". There is no "manager" role either: it is a right, "manage users and settings".
- **Mandatory and optional** label kinds of spending and agree with the word for expenses (fr "Dépenses obligatoires", pt-BR "Despesas obrigatórias"). de "Optional" equals the English value: use "Freiwillig".
- **Advisor** is the Claude-based consultant, a feature name: capitalise it where English does. **Proposals** go from a member to the family for a vote: the plain word, not "Antrag" or "moción".
- **Same as English on purpose.** de "Dashboard" inside a sentence is fine; pt-BR "Backup" alone as a value must be reported for `tests/i18n/sameAsEnglish.ts`.

## 5. Adding or changing a string in code

1. Add the key to the English file (`src/locales/en-US.json` or the chunk's `en-US.json`) and to the Russian one. A contributor who does not write Russian leaves it out: `check` is red and the maintainer adds it before merge.
2. Leave the other five languages alone: Weblate offers the new key to their translators after the merge, and the app shows English for it until then. Do not paste English into their files.
3. A plural key gets each language's own forms (section 3), not a copy of the English pair.
4. Changing an English text: Weblate marks the translations of a changed source string for review, so wording can change in place. Remove a key from every language when the code stops using it (the test fails on a key English lacks).
5. A value that must equal English goes into `tests/i18n/sameAsEnglish.ts` under its language, with the reason in the comment above the list.
6. Run `npm run check` before pushing.

## 6. The README

`README.md` has a translation in every UI language: `README.<lang>.md`, linked from the language bar on the first line of each. `tests/docs/readme.test.ts` keeps their language bar, badges and screenshot the same as the English one; the text is a translation and may lag behind (the English README is the reference). The translations are kept on Weblate (the README component, section 7): a change to `README.md` marks the changed paragraphs for translation in every language there, so a code pull request that rewords the English README changes only the English README. Weblate pairs the Markdown segments by position, though: a pull request that adds, removes or moves a section, a list item or an image updates the six translations' structure in the same pull request (machine translation is fine), and `tests/docs/readme.test.ts` checks that every README has the same `##` sections and images in the same order.

## 7. Weblate

The project lives on Hosted Weblate: [hosted.weblate.org/projects/monido](https://hosted.weblate.org/projects/monido/) (libre plan for open-source projects). Translators work there; Weblate opens one pull request with their changes, which the maintainer merges like any other (CI must be green). A GitHub webhook (`https://hosted.weblate.org/hooks/github/`, push events) tells Weblate about new commits on `master`.

Settings, one component per locale set:

| Component | File mask | Monolingual base file |
| --- | --- | --- |
| Main | `src/locales/*.json` | `src/locales/en-US.json` |
| Advisor | `src/locales/advisor/*.json` | `src/locales/advisor/en-US.json` |
| Analysis | `src/locales/analysis/*.json` | `src/locales/analysis/en-US.json` |
| Planning | `src/locales/planning/*.json` | `src/locales/planning/en-US.json` |
| Records | `src/locales/records/*.json` | `src/locales/records/en-US.json` |
| README | `README.*.md` | `README.md` (format: Markdown file; code blocks not extracted, line length 1000 so lines are not rewrapped; no "Cleanup translation files" add-on) |

Advisor, Analysis, Planning, Records and README share Main's repository (`weblate://monido/main`).

- File format **i18next JSON file v4**; source language English (`en-US`); language code style **BCP style using hyphen** (`pt-BR`, `zh-CN`); JSON indentation **2 spaces**, no ASCII escaping. With these, a file Weblate writes is byte-for-byte the file it read (checked with translate-toolkit, which Weblate uses).
- **Russian is not on Weblate for the interface.** Hosted Weblate knows Russian with three plural forms only (one, few, many), so writing a Russian file would drop every `_other` key (fractions such as 2.5 months), which the locale test refuses and the app would show in English. The five JSON components therefore filter Russian out (language filter `^(?!ru-RU$)[^.]+$`); Russian is written with the code, as section 1 says. The README component keeps Russian: Markdown has no plurals.
- Source strings are edited in code only: turn off editing of the base file and adding new strings in Weblate.
- **Adding a new language: contact the maintainers.** A new language also needs code (its loaders in `src/i18n/languages.ts` and `src/i18n/chunks.ts`), so it arrives as a code pull request.
- Reviews on: the machine-translated strings count as translated, not approved, until a native speaker approves them.
- Optional: the "Automatic translation" add-on with a machine-translation service fills new strings right after a merge, so English shows only briefly.
