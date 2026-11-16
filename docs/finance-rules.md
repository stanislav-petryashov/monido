# Financial analysis rules for Claude

This file holds the rules and thresholds for analyzing the family dashboard's financial indicators.
Use it as context for financial audit requests.

---

## Project context

**Database:** SQLite; the schema is in [schema.md](schema.md)  
**Currency:** the snapshot is in the display currency chosen on the dashboard (any project currency); accounts, flows and properties may be in any currency, and each amount is converted at the rate of its own date (a balance at its month end, a flow at its month start; goals at today's rate). Rates come from Frankfurter, with the family's manual rates (Settings → General) on top  
**Inflation:** the `parameters` table → `inflation_rate` (% a year), in its own currency: the `currencies` row with `inflation = 1`, the currency the family spends in. There is no default: without both the rate and the currency, real growth is `—` and is left out of the score; say so instead of assuming a value  
**Default analysis period:** the last closed month and the 3- and 12-month windows before it  
**Family members:** the names in `members` (e.g. Robin, Noa); an account or property without a member counts under "No member". A member named `Shared` (created by migration 0002 for joint accounts) is the joint owner: the advisor does not count its income as anyone's salary

---

> The dashboard sees only closed months: a month enters the calculations as a whole, after "Close month" in the wizard. If more than one month is not closed, the conclusions refer to the past, and this is worth saying.

> Every part of the application is always in the calculation. One family setting can leave the flows out: while "Track income and expenses" (Settings → General) is off, months close with balances only, and the flow figures and the health metrics that need them have no data. Do not draw conclusions about income and expenses then; say that tracking is off.

## Available data

The source data lives in the tables `assets`, `monthly_cashflow`, `loans`, `loan_early_payments`, `real_estate`, `goals`, `parameters` (details in [schema.md](schema.md)). From them the application itself computes a single snapshot `/api/snapshot` in its base currency (the display currency); the metrics below are taken from it.

### Computed metrics (already calculated in the application)

| Metric | Snapshot key | Formula |
|---------|-----------|---------|
| Savings rate | `savings_rate` | `(income - expense) / income × 100` for the last closed month |
| Emergency fund | `emergency_months` | `liquid_cash / expense`: the bank-class balances over the expenses of the last closed month |
| FI rate | `fi_rate` | `passive_income / monthly_expense × 100` |
| Debt / Assets | `debt_to_asset` | `liabilities_total / assets_total × 100` |
| Real growth YoY | `real_growth_yoy` | `(net_worth_now - net_worth_year_ago) / net_worth_year_ago × 100 - inflation_rate`, both net worths in the inflation currency |
| Average debt rate | `avg_debt_rate` | the balance-weighted average rate across all debts |
| Consumer debt (mo.) | `consumer_debt_months` | `consumer_balance / monthly_income` |
| Loan payments to income | `debt_payment_ratio` | `Σ scheduled payments of the snapshot month / income of the closed month × 100`, all loans |
| Income diversification | `income_diversification` | `passive_income / total_income × 100` |
| Net worth growth per year | `capital_growth` | `(net_worth_latest / net_worth_first)^(12 / months) − 1` over all closed months with balances, the family's own savings included |
| Growth beyond savings per year | `growth_beyond_savings` | per month `(NW_end − NW_start − saving) / (NW_start + saving / 2)`, chained over the used months and annualised: `growthBeyondSavings.annualRate` |

The monthly figures are those of the last closed month. The overall score 0–100 is `health.composite` in the snapshot (not a reference metric): each metric's zone gives it points (`SCORES` in `src/domain/health.ts`: red 0, excellent up to 100), and the score is the average of those points weighted by `HEALTH_WEIGHTS`, over the metrics that have a value. A metric without a value is left out, not counted as zero.

Amounts are rounded with `roundTo` (`src/domain/fx.ts`; `round2` is `roundTo(v, 2)`): half away from zero on both sides, never −0. The few figures shown to one decimal (the score, the compared shares and months of a proposal) go through the same helper; percentages are otherwise rounded only for display.

### Zones

Every metric has four zones, the ones its card shows: Critical, Needs work, Good, Excellent. The borders are `ZONES` in `src/domain/health.ts`, and the tables below give them exactly, border values included (`tests/docs/financeRules.test.ts` compares them). For the metrics where more is better the border value belongs to the lower zone; for the ones where less is better ("inverse": debts and rates) it belongs to the worse zone. The zone is taken from the value as the card shows it, rounded to two decimals: 1.004 months shows as 1 and is Critical.

---

## Rule 1: Emergency fund (`emergency_months`)

**Logic:** The emergency fund is priority #1. Without it any emergency breaks the whole plan.  
**Source:** bank accounts from `assets` (class = 'bank') / the expenses of the last closed month (`monthly_cashflow`, with the month's loan payments)

| `emergency_months`, months | Zone | Action |
|----------|--------|----------|
| ≤ 1 | 🔴 Critical | Build it immediately. Freeze all investments and early repayments |
| 1 < x ≤ 3 | 🟠 Needs work | Top priority to replenish. The goal is 3 months before anything else |
| 3 < x ≤ 6 | 🟢 Good | Keep replenishing up to the upper bound alongside investments |
| > 6 | 🟢 Excellent | Surplus can go into investments; well above a year, consider moving part of it into income-bearing instruments |

**Recommendations when it falls short:**
- Open a separate account only for the emergency fund (a psychological barrier)
- Replenishment goal: at least 10% of every income until 3 months are reached
- Priority: cash > deposits (not locked)

---

## Rule 2: Savings rate (`savings_rate`)

**Logic:** The main indicator of financial discipline. It shows how much is left after expenses.  
**Source:** `monthly_cashflow` (income and expenses by account)

| `savings_rate`, % | Zone | Benchmark |
|----------|--------|----------|
| ≤ 5 | 🔴 Critical | Expenses almost equal income: no growth |
| 5 < x ≤ 15 | 🟠 Needs work | The 50/30/20 rule calls for 20% |
| 15 < x ≤ 25 | 🟢 Good | The standard of most financial planners |
| > 25 | 🟢 Excellent | Fast accumulation; above 40% an aggressive FIRE track |

**Recommendations for a low rate:**
- Find the top 3 expense categories and cut each by 10%
- Automate the transfer to savings right when the salary arrives
- Check for subscriptions and expenses you forgot about

---

## Rule 3: Debt load (`debt_to_asset` + `avg_debt_rate`)

**Logic:** Expensive debt destroys any investment return.  
**Source:** `loans` and `loan_early_payments` (balance from the payment schedule, rate, type)

### Debt / Assets

| `debt_to_asset`, % | Zone |
|----------|--------|
| < 20 | 🟢 Excellent |
| 20 ≤ x < 40 | 🟢 Good |
| 40 ≤ x < 60 | 🟠 Needs work |
| ≥ 60 | 🔴 Critical |

### Average debt rate

| `avg_debt_rate`, % | Zone | Logic |
|----------|--------|--------|
| < 10 | 🟢 Excellent | Below 5% the debt is cheap: no need to hurry with repayment, as investing pays more |
| 10 ≤ x < 15 | 🟢 Good | Repay alongside investing |
| 15 ≤ x < 20 | 🟠 Needs work | Priority: early repayment of consumer loans |
| ≥ 20 | 🔴 Critical | Repay aggressively. Investing at such a rate is ineffective |

### Consumer debt (`consumer_debt_months`)

The balance of consumer loans (no mortgage) in months of income.

| `consumer_debt_months`, months | Zone |
|----------|--------|
| < 6 | 🟢 Excellent |
| 6 ≤ x < 12 | 🟢 Good |
| 12 ≤ x < 24 | 🟠 Needs work |
| ≥ 24 | 🔴 Critical |

### Loan payments to income (`debt_payment_ratio`)

| `debt_payment_ratio`, % | Zone |
|----------|--------|
| < 10 | 🟢 Excellent |
| 10 ≤ x < 30 | 🟢 Good |
| 30 ≤ x < 50 | 🟠 Needs work |
| ≥ 50 | 🔴 Critical |

From 50% the debt load is high.

**Repayment strategy:**  
The avalanche method: repay the loan with the highest rate first  
→ check the loans (`loans`) in descending order of rate

**Recommendations:**
- If `avg_debt_rate` is 15% or more: every spare thousand is better put toward repayment than investing
- Refinance consumer loans once you have a payment history
- A mortgage at a rate below inflation is not an enemy (money loses value faster than the debt)

---

## Rule 4: Real net worth growth (`real_growth_yoy`)

**Logic:** The only indicator that accounts for inflation. Nominal growth of 8% at 10% inflation is a loss.  
**Source:** net worth now and a year ago, both taken in the inflation currency (each at the rate of its own month end, whatever currency the dashboard shows), year-over-year growth minus `parameters.inflation_rate`

| `real_growth_yoy`, % | Zone | Interpretation |
|----------|--------|--------------|
| ≤ 0 | 🔴 Critical | Net worth is not growing in real terms, or is melting. A change of strategy is needed |
| 0 < x ≤ 3 | 🟠 Needs work | Barely beats inflation |
| 3 < x ≤ 7 | 🟢 Good | The standard of long-term portfolios |
| > 7 | 🟢 Excellent | Beats most indices |

**Recommendations for negative real growth:**
- Check the asset structure: too much cash → inflation eats it
- Check the return of brokerage accounts (the dynamics of `assets` balances with class = 'broker')
- Reconsider: perhaps the FIRE goals are unreachable with the current allocation

---

## Growth beyond savings (`growth_beyond_savings`)

**What it answers:** how fast net worth grew on its own, with the family's own contributions taken out. It is the figure to compare with the 8% return the forecasts assume; capital growth per year (`capital_growth`) includes the savings and is not a return. Quote both, and name the gap between them as the family's own savings.
**Formula:** for each month m, NW_start is net worth at the end of m − 1, NW_end at the end of m (each at its own month-end rate), the saving is income − expenses of m over the accounts' rows. Loan payments are transfers, not saving: a payment moves money from cash to the debt inside net worth, so the rows with `loan: true` are left out of the saving and only the interest part lowers NW_end, counting against the growth (the cost of the debt). `r_m = (NW_end − NW_start − saving) / (NW_start + saving / 2)` (monthly Modified Dietz: the saving counted at mid-month). The used months are chained, `Π(1 + r_m) − 1`, and brought to a year as `(1 + growth)^(12 / used months) − 1`. It is time-weighted: one big contribution does not change it.
**Months left out**, each with one reason, never counted as zero: `no_balance`: no balances at the end of m − 1 or of m (a missing month skips itself and the month after it); `no_rate`: an amount of either month end or of the month's account rows has no exchange rate; `no_cashflow`: the month has no income and expense rows of the accounts (loan payments alone do not count); `nonpositive_start`: NW_start ≤ 0 or NW_start + saving / 2 ≤ 0.
**Minimum:** 6 used months (`MIN_RETURN_MONTHS` in `src/domain/returns.ts`); with fewer the annual figure is null, the months used and left out are still in the snapshot. With enough months the annual figure is also null when a used month has `1 + r_m ≤ 0` (net worth lost all it had): the chain is not defined.
**Inputs quoted:** `startNetWorth` is the start of the first used month, `endNetWorth` the end of the last one, `savingsTotal` the saving of the used months, and `growthAmount` = Σ(NW_end − NW_start − saving) over the used months, the money the rate is made of. With a month left out inside the span, `endNetWorth − startNetWorth − savingsTotal` also holds that month's move and differs from `growthAmount`; quote `growthAmount`.
**What is inside it:** revaluations of real estate (applied from January of the valuation year), exchange-rate moves of foreign-currency balances and loans, and, as a minus, the interest on loans. A month with partial cash flow (one account missing) counts as data, so a missing expense reads as growth. It is growth beyond savings, not only market return.

---

## Return of an account (money-weighted)

**What it answers:** how a broker or crypto account did once what was put in and taken out is set aside: what the money in it earned. It is per account and in the account's currency (no exchange rates), next to the family-wide growth beyond savings, which it never changes: a transfer between the family's own accounts is not saving.
**Inputs:** the account's month-end balances and, for each month, what was put in (+) or taken out (−), `account_transfers` (Close month or the account's month form). A dividend paid out to a bank is taken out; a dividend that stays and a fee charged on the account are inside the balance, so inside the return.
**Formula:** the span is the latest unbroken run of months up to the last closed month with both a balance and an entered transfer (zero included); it starts from the balance of the month before it, or zero when the account had no balance before. The monthly rate r solves `start·(1 + r)^N + Σ T_i·(1 + r)^(N − i + 0.5) = end` (each transfer at mid-month; bisection between −99% and +1000% a month), and the yearly figure is `(1 + r)^12 − 1`. `gain = end − start − Σ T_i` is always given.
**Minimum:** 6 months (`MIN_RETURN_MONTHS`); with fewer the gain only. No rate when no money was in (no sign change). Nothing when the last closed month has no balance or no transfer entered. `accountReturn` in `src/domain/accountReturn.ts`.

---

## Repay early or invest

**What it answers:** whether an early loan payment or investing the same amount leaves more money. Repaying earns the loan's own rate for certain; investing wins only at a higher return after tax, and is not certain.
**Formula:** both paths cost the family the same each month until the loan's own last payment (the horizon). Repaying: the early payment goes to the loan with the chosen strategy, and every payment it frees (a lower payment, or the payments no longer due after an earlier payoff) is invested as it falls due. Investing: the loan keeps its schedule and the amount is invested at once. Each grows at the yearly return compounded monthly (`annual / 12`); payment i lies i months after the first payment ahead, which lies its days after the payment's date (a month is 365.25 / 12 days). The result is `investEnd − repayEnd` at the horizon; under a thousandth of the larger as good as level. At a return equal to the loan's rate the two end level (within a few hundredths of a percent: the schedule's day-count interest and its rounding), so the rate itself is the break-even and is not searched for.
**Limits:** in the loan's currency, nominal, no taxes, deductions or early repayment fees, no risk beyond the words; only for a payment dated today or later and with two payments or more ahead. `repayOrInvest` in `src/domain/loans.ts`.

---

## Rule 5: Asset structure and diversification

**Logic:** Money must work. Excess cash with the emergency fund covered is lost return.  
**Source:** `assets` (by class: bank, broker, crypto, other), `real_estate`  
**Breakdowns:** the capital snapshot also groups assets by currency (the account's or property's own) and by member, in the display currency, largest first; rows without a rate are left out; a property counts under its owner (`real_estate.member`), and an account or property without one counts under an empty member ("No member").

### Target allocation (medium risk profile)

| Class | Optimum | Alarm |
|-------|---------|---------|
| Cash / deposits | 10–30% | > 50% (too conservative) |
| Investment portfolio | 30–50% | < 10% (money is not working) |
| Real estate | 20–40% | > 70% (illiquid) |

### Income diversification (`income_diversification`)

| `income_diversification`, % | Zone | Meaning |
|-----------------------|--------|--------|
| ≤ 5 | 🔴 Critical | 100% dependence on salary, high risk |
| 5 < x ≤ 15 | 🟠 Needs work | The start of diversification |
| 15 < x ≤ 30 | 🟢 Good | |
| > 30 | 🟢 Excellent | A serious financial cushion |

**Source of passive income in the system:** the `passive_income` field in `monthly_cashflow` (dividends, coupons, rent)

---

## Rule 6: FIRE progress

**Logic:** Financial independence = passive income covers expenses.  
**FI rate calculation:** `passive_income / monthly_expense × 100`; at 100% and above, passive income covers expenses  
**FIRE goal:** the goal whose key or name contains the word "fire" (`isFireGoal` in `src/domain/goals.ts`); its progress is `current / target` at today's rates (`goals.fire` in the snapshot). The 4% rule (a target of `annual_expense × 25`) is one way to set that target  
**FIRE forecast, one date everywhere:** the goals plan (`allocateGoals`) funds the goals nearest deadline first from the 3-month average savings; the FIRE goal also grows at 8% a year (`ANNUAL_RETURN`, compounded monthly) on what it holds. It is reached, and stops taking savings, the month that value reaches its target; a goal with a later deadline is funded from then. That month is the FIRE goal's `projectedDate` and decides its status (on track by its deadline month, at risk later) on Goals, in the metric explainer, the ✨ prompt and the advisor. The strategies re-run the same plan with 500 USD more saved a month and with a 10% return (`goals.fire.strategies`). The other goals get no return. Advisor evaluations stored before 2026-11-12 keep the months they were made with

| `fi_rate`, % | Zone | Meaning |
|---------|--------|--------|
| ≤ 3 | 🔴 Critical | Early stage, focus on accumulation |
| 3 < x ≤ 10 | 🟠 Needs work | Passive income has started |
| 10 < x ≤ 25 | 🟢 Good | Steady growth of passive income |
| > 25 | 🟢 Excellent | Good progress; from 50% the home stretch |

---

## Analysis algorithm for Claude

When asked for a financial audit, follow this order:

### Step 1: Collecting data
Ask for the metric values from the application (the ✨ button on a card gathers them itself) and clarify which month the data is for:
- `emergency_months`, `savings_rate`, `debt_to_asset`, `avg_debt_rate`
- `real_growth_yoy`, `fi_rate`, `consumer_debt_months`, `debt_payment_ratio`, `income_diversification`
- `composite`: the overall score

### Step 2: Prioritizing problems
Rank the problems by priority:
1. 🔴 Critical (any indicator in the red zone) → require immediate action
2. 🟠 Needs work (the amber zone) → plan for the next 1–3 months
3. 🟢 Growth areas (Good, short of Excellent) → improve within a year

### Step 3: Forming recommendations
Give no more than **3–5 concrete actions**, each with:
- A clear wording ("Put X toward repaying loan Y")
- A time horizon (this month / quarter / year)
- The expected effect on the indicators

### Step 4: Tracking progress
Compare with the previous analysis (if there is one). Note improvements and regressions.

---

## Request template for Claude

```
Run a financial audit based on docs/finance-rules.md.

Current indicators:
- Emergency fund: X mo
- Savings rate: X%
- Debt/Assets: X%
- Average debt rate: X%
- Real growth YoY: X%
- FI rate: X%
- Consumer debt: X mo
- Loan payments to income: X%
- Income diversification: X%
- Overall score: X/100

Additional context: [optional: major events, plans, changes]

What should be prioritized this month?
```

---

## Important caveats

1. **Currencies:** the data is stored in each account's own currency (any of the project's currencies). The snapshot gives every amount in the display currency, each at the rate of its own date, so a change in net worth includes exchange-rate moves; comparing raw amounts in different currencies without conversion distorts the picture.
2. **Inflation:** real growth is measured in the inflation currency (see Project context). Official inflation figures may be lower than the family's actual consumer inflation.
3. **Context:** a family with two incomes. Analyze it as a single system, not only member by member.
4. **Horizon:** the indicators for a single month may be unrepresentative. Preferably use the average over 3–6 months.

## Question-led planning and analysis

- Availability confirmations describe existing account money in its native currency, signed by account identity, month, currency and balance. They do not add money to capital or goal progress. Available money partitions into reserve, goal funds, known commitments and free remainder; totals are rounded in display currency. An unknown/stale confirmation, missing current account or unavailable FX prevents a confirmed aggregate. Negative account balances are excluded from spendable funds and retain existing signed capital accounting.
- Reserve coverage uses three consecutive complete closed months of all-in expenses, with actual loan payments counted once. It does not claim coverage of a verified essential-only budget. Incomplete historical account-months block the answer.
- The capital bridge uses adjacent complete months: opening net worth + household income minus all expenses + other changes = closing net worth. Other changes includes possible debt-principal movements, valuations, exchange effects and corrections. It is not market profit or the existing Modified Dietz return. Historical completeness is checked before unknown FX amounts can be zero-omitted from totals.
- Category changes compare the last closed month with the previous 3/6/12 months. Missing categories are zero only in fully allocated months. A recurring pattern means positive observations in at least three of the last four complete months, not guaranteed recurrence. The user creates categories explicitly through the existing income/expense allocation flow.
- Income can be allocated to salary, freelance work, interest, coupons, dividends and rent using existing named active/passive categories. One-off receipts remain explicit. Transfers, loan principal and gross disposal proceeds must not be entered as earned income; investment cash receipts are distinct from total investment performance.
- The short-term scenario uses explicit starting funds, income, all-in monthly expense, reserve floor, optional goal contributions and a one-off additional purchase. A temporary income shock ends after the entered duration; an expense increase persists through the horizon. The default horizon is six months, with three and twelve available. No yield, asset sales, amortization changes or probability is assumed. Historical suggestions require three complete months and exclude known one-off receipts; the user reviews their recurrence. Confirmed starting funds include reserve and exclude goal/commitment earmarks; earmarked commitments must not also be added as extra purchases or included again in monthly expenses. Scenario inputs are unsaved drafts and reset on currency or anchor-month changes.
