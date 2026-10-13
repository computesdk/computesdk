---
"@computesdk/aws": patch
"@computesdk/provider": patch
"daemond": patch
---

Add EC2 preview URLs: `ec2({ previewDomain })` makes `getUrl` return `https://<port>-<instanceId>.<region>.<previewDomain>`, served by a regional Caddy gateway that the new `computesdk-aws-ec2-gateway up|down` command creates (Route 53 + Let's Encrypt). daemond gains an `sseHost` option and providers can set it with `daemonSseHost`.
