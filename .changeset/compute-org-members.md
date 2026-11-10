---
'@computesdk/cli': minor
---

Org members and invitations on the CLI:

- New `compute org members` lists the organization's members (email, role, name, member id); `--org <slug>` picks the org for a user login.
- New `compute org invitations` lists pending invitations with their links, and `compute org invitations cancel <invitationId>` cancels one.
- New `compute org invite <email> [--role member|admin]` creates an invitation and prints its link, noting when the email was not sent. Owner invitations are refused (they stay in the web app).
- New `compute org member set-role <member> <member|admin>` and `compute org member remove <member>` take a member id or email.
- New `compute org leave` leaves the organization; it needs a user login (`compute login`).
- New `compute invitations` lists your own pending invitations, with `show <id>`, `accept <id>` and `decline <id>`; they need a user login, and an org API key is refused with `user_credential_required`.
- Invite, cancel, set-role, remove, leave and decline ask for confirmation on a terminal and need `-y` elsewhere (they exit 1 without it); accept does not ask.
- These commands call `/api/v1/organizations/current/{members,invitations,leave}`, `/api/v1/me/invitations` and `/api/v1/invitations/{id}[/accept|/decline]`, and print the platform's error `hint`.
