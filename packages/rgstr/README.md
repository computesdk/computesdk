# rgstr

The `rgstr` CLI — the terminal front door for [rgstr](https://rgstr.org), the
package naming registry. Claim a name, prove it from your next publish, route
it, and point your project's installs through it.

```bash
npx rgstr whois tsc-rs            # who holds it, how much to trust it, where it routes
npx rgstr search tsc              # ranked, with trust + weekly downloads

npx rgstr login                   # device-code sign-in (ComputeSDK account)
cd my-package && npx rgstr claim  # files the claim, writes the publish-proof token
npm version patch && npm publish
npx rgstr claim --check           # verifies the token in the published package

npx rgstr use                     # writes .npmrc / pip config for this project
npx rgstr use --off               # removes exactly what it wrote

npx rgstr route my-name --to npm:real-name@^1
```

Every command takes `--json`. CI uses `RGSTR_TOKEN` (an org API key) and
`RGSTR_ORG`; `--base-url` / `--allow-untrusted-host` follow the same host-trust
rules as `compute`.
