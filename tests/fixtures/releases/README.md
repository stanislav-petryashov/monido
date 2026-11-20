# Release databases

One SQL dump per schema a release shipped, named after the first release with it. Each holds the same fictional family (two members and their users, accounts over January to March 2026 with one in EUR, a closed account, a mortgage with payments and an early payment, cash flow with category lines, closed months, a goal, an accepted proposal, and the tables the version added). `tests/server/releaseUpgrades.test.ts` loads each, runs the start-up upgrade and checks the family survived.

| Fixture | Schema | Releases |
|---|---|---|
| `0.41.0.sql` | migrations through `0031_family_telegram.sql` (`user_version` 0) | 0.40.0 to 0.41.0 (private, before the public repository) |
| `1.0.0.sql` | 1 | 0.42.0 to 1.5.0 |
| `1.6.0.sql` | 2 | 1.6.0 to 1.8.3 |
| `1.9.0.sql` | 3 | 1.9.0 to 1.11.0 |
| `1.12.0.sql` | 4 | 1.12.0 onwards |

`scripts/releaseFixture.ts` writes them from the tag's own `schema.sql` (or its migrations): `npm run fixture:release -- 1.9.0 v1.9.0`. The 0.x tags exist only in the owner's clone, so `0.41.0.sql` is kept as it is.

A change that bumps `SCHEMA_VERSION` adds the fixture of the release that will ship it, from the working tree's `schema.sql`, in the same pull request: `npm run fixture:release -- x.y.z`. Until then the guard in the test fails. The family's rows live in the script: add the new tables' rows there, and keep the older fixtures as they are.
