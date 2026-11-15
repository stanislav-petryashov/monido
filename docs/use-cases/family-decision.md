# How can we make a major financial decision together and see its consequences first?

**Compare the effects of buying a car outright and financing it, review a proposal, then let the family agree on that specific decision.** Approval records the decision; it does not purchase a car or issue a loan.

## The situation

The existing fictional demo family, Ryan and Annika, considers a USD 25,000 car. The credit option has no down payment, 36 monthly installments and 9% annual interest. The alternative is paying the same price from available funds.

## Follow the case

1. Ask the advisor tools to evaluate both complete scenarios against the family's data.
2. Review changes in monthly savings, debt payments, reserve coverage and goal dates.
3. Prepare a proposal preview. No proposal should exist yet.
4. After agreeing to that exact preview, submit it. The author agrees automatically; the other family member must still vote.
5. Sign in as the other member, inspect the consequences and confirm Agree in the browser dialog.
6. Reload Advisor: the accepted proposal should appear in History.

The independent annuity check is `25,000 × (0.09 / 12) / (1 - (1 + 0.09 / 12)^-36)`, or USD 794.99 a month. Paying outright instead reduces liquid funds by USD 25,000 without adding that payment.

![The decision before the second vote](assets/UC-07-voter.png)

## Verification and external boundaries

A separate empty database is initialized and populated with the established fictional family. Two test users get local Telegram-mode sessions using the project's stand helpers. The test calls the real advisor HTTP endpoints; incomplete credit input must be rejected. A preview must not create a proposal, submission must create one, and a consumed preview must not be sent twice. Annika's vote is entered and confirmed through Chrome.

**The automated run is a partial integration result.** Claude's reasoning and natural-language dialogue, OAuth authorization, real Telegram login and actual message delivery are not exercised. Telegram is replaced by the project's local transport; no real people receive messages. User consent is scripted for the fixture, not obtained by a tested AI conversation. The demo fixture's last closed month is September 2026, which the UI identifies as two months old at the run date.

The public demo does not support the Advisor. To reproduce this local protocol test, run `node --import tsx docs/use-cases/verify.mjs UC-07` after building. To use the feature for a real family, follow the [user guide](../user-guide.md) and [configuration guide](../configuration.md).

A subsequent supervised live run verified actual Claude readback, Telegram delivery, a vote against, revision and acceptance of a lower-priced credit scenario. Both versions and their votes were confirmed in the server database. The advice still needs clearer explanations of reserve-preserving alternatives and uncertainty about income sources; full tool traces and every preview-consent step were not captured. In regular use, revisit the proposal when the price, income or family situation changes; an old approval is not approval of new numbers. See [recorded results](results.md).
