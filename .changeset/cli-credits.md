---
"@computesdk/cli": patch
---

Add `compute credits` — your prepaid credit, which managed accounts bill from: `compute credits` (balance and holds), `compute credits ledger`, and `compute credits topup <usd>` (prints the Stripe checkout link, and the credit you'll receive after the top-up fee when the platform reports it). These lived under the hidden `compute market`, where they still work.
