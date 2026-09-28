# SPLIT — Smart Expense Splitter

A small web app for groups who share costs. Add everyone, log what each person
paid, and SPLIT works out who owes whom — and the shortest way to settle up.

**Tagline:** Keep the numbers fair.

## Features

- Group participants — add and remove people, with duplicate-name protection
- Expense tracking — description, amount, who paid, and who it is split between
- Automatic equal splitting, down to the last paisa
- Payer is added to the split by default, and can be taken out deliberately
- Balance calculation — total paid, total share, and net balance per person
- Settlement plan — the fewest transfers that clear every balance
- Edit and delete expenses, with everything recalculating instantly
- localStorage persistence — refresh the page and your workspace is still there
- Responsive design, light and dark themes, keyboard accessible

## Running it

No build step, no dependencies. From the project folder:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Paid by vs. split between

These are two different questions, and the form asks them separately:

- **Paid by** — who actually handed over the money.
- **Split between** — who the cost belongs to.

Picking a payer ticks them in the split automatically, because that is what
normally happens. You can untick them if someone is covering the bill on behalf
of others; the form then says so out loud instead of quietly changing the maths.

The split is always calculated from **Split between** alone. The payer only
affects what they paid, never what they owe.

## How the maths works

Every calculation happens in paise (whole numbers) instead of rupees, so shares
always add back up to the exact total — no `₹599.999999`.

- Each person's share of an expense is `amount ÷ number of people in the split`.
  If the amount doesn't divide evenly, the leftover paisa goes to the first of them.
- `net balance = total paid − total share`. Positive means they get money back,
  negative means they owe.
- The settlement plan repeatedly matches the largest debtor with the largest
  creditor, which keeps the number of transfers to a minimum.

Nothing is uploaded anywhere — all data lives in your own browser.

## Tech

HTML
CSS
Vanilla JavaScript

## Files

```
index.html      markup
style.css       design system, layout, responsive rules
script.js       state, calculations, rendering
assets/         favicon
```

Built as part of:

Coding Ninjas 10X SRM Web Development Recruitment Task

Built by:

MITHILESHWARAN D
