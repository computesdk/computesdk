---
"@computesdk/aws": patch
---

aws-ec2: default `HOME` for SSM commands (the agent leaves it unset, which breaks tools like act), and add an optional `getUrl` config hook so an ingress layer can provide preview URLs.
