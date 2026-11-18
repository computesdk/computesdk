---
"@computesdk/kernel": patch
---

Map `proxies` to a Kernel proxy instead of ignoring it. `proxies: true` attaches a US residential proxy, matching what `proxies: true` means for the other browser providers, and a typed `ProxyConfig` (`residential`, `isp` or `datacenter`, with an optional country) attaches that type. The adapter reuses the org's proxy with the same name (`computesdk-residential-us`, for example) and creates it on first use. If the proxy can't be found or created, the session keeps Kernel's default egress and the adapter logs a warning. Custom proxies are still ignored with a warning.
