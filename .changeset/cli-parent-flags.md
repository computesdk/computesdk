---
"@computesdk/cli": patch
---

Fix flags given before a subcommand being silently dropped: `compute credits --org team-b topup 50` now tops up team-b instead of your active org. Applies to every command group that declares shared flags on the parent and its subcommands (`credits`, `byok`, `actions runs|workflows|providers|repos|installations|slack|settings`, `sandboxes settings`, `invitations`, `org invitations`). A flag given to the subcommand itself still wins.
