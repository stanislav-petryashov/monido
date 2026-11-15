# What can Monido help your household understand?

Six practical stories, with fictional households, reproducible checks and explicit limits. These are worked examples, not customer testimonials or evidence of improved financial outcomes.

| ID | Priority | Your question |
| --- | --- | --- |
| UC-04 | P0 | [Are we actually wealthier, or did prices and exchange rates change?](wealth-change.md) |
| UC-01 | P0 | [How much does our family own after debts?](family-net-worth.md) |
| UC-02 | P0 | [How much can we regularly save after expenses and obligations?](monthly-savings.md) |
| UC-03 | P0 | [How long would our available reserve last without income?](emergency-reserve.md) |
| UC-05 | P0 | [When will we reach our savings goal, and what changes that date?](savings-goal.md) |
| UC-07 | P1 | [How can we make a major financial decision together and see its consequences first?](family-decision.md) |

The IDs retain the original agreed list. UC-06, early repayment, was removed as a standalone public story, not as an application feature. P1 means a later verification priority, not low value for the families who need it. Audience demand and retention have not been measured.

## Evidence and limitations

Every case starts with its own empty database initialized by the application. Fixture history is inserted explicitly; this does **not** test manually entering the whole history. Checks use the real HTTP server and Chrome. No personal database is read or changed.

**PASS** means the named assertion passed; **FAIL** means it did not; **PARTIAL** means the broader user outcome remains unproven; **BLOCKED** means a dependency prevented verification. Correct calculations do not establish that a person understands them or returns next month.

See the [verification plan](verification-plan.md), [recorded results](results.md), and [reproducible runner](verify.mjs). The articles explain what you can try, what was observed, and where contributions would help.
