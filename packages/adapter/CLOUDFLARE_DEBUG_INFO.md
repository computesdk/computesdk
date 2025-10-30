# Cloudflare Tunnel Issue: POST Requests Timing Out

## Summary
POST requests through Cloudflare tunnel take 30+ seconds and return 500 errors when using Node.js native fetch, but work instantly with curl.

## Environment
- **Tunnel URL**: https://cool-giraffe-huk3uj.preview.computesdk.com
- **Node.js Version**: v22.11.0
- **OS**: macOS (Darwin 24.6.0)
- **Fetch Implementation**: Node.js native fetch (undici-based)

## Symptom Details

### ✅ What Works
1. **curl POST requests** - Instant response, 201 Created
2. **GET requests via Node.js fetch** - Instant response (e.g., `/health`)
3. **Browser fetch** (presumably) - Not tested yet but likely works

### ❌ What Fails
**Node.js native fetch POST requests** - 30+ second delay, then 500 Internal Server Error

## Reproduction

### Working Example (curl)
```bash
curl -X POST https://cool-giraffe-huk3uj.preview.computesdk.com/auth/token -v
```

**Result:**
- Response time: ~200ms
- Status: 201 Created
- Body: Valid JSON with token

**Headers sent by curl:**
```
POST /auth/token HTTP/2
Host: cool-giraffe-huk3uj.preview.computesdk.com
User-Agent: curl/8.7.1
Accept: */*
```

### Failing Example (Node.js fetch)
```javascript
const start = Date.now();
fetch('https://cool-giraffe-huk3uj.preview.computesdk.com/auth/token', {
  method: 'POST'
}).then(async r => {
  console.log('Status:', r.status);
  console.log('Time:', Date.now() - start, 'ms');
  const text = await r.text();
  console.log('Body:', text);
});
```

**Result:**
- Response time: ~30,000ms (30 seconds)
- Status: 500 Internal Server Error
- Body: "Internal Server Error"

**Headers sent by Node.js fetch (inferred):**
```
POST /auth/token HTTP/2
Host: cool-giraffe-huk3uj.preview.computesdk.com
User-Agent: node (or undici)
Accept: */*
```

## Technical Details

### Node.js Fetch Implementation
- Uses **undici** under the hood (as of Node 18+)
- Defaults to **HTTP/2** when available
- Uses native TLS/ALPN negotiation
- Different User-Agent than curl

### Network Trace
```
* SSL connection using TLSv1.3 / AEAD-CHACHA20-POLY1305-SHA256
* ALPN: server accepted h2
* using HTTP/2
```

### Cloudflare Details (from curl)
```
server: cloudflare
cf-ray: 993c9487ea6aaddb-ATL
```

## Hypotheses

### 1. HTTP/2 Multiplexing Issue
Cloudflare tunnel might handle HTTP/2 POST requests differently than curl's HTTP/2 implementation.

### 2. Request Buffering
Cloudflare might be waiting for request body data that Node.js fetch isn't sending in the expected format.

### 3. User-Agent Filtering/Routing
Different behavior based on User-Agent header (curl vs undici/node).

### 4. TLS/ALPN Negotiation Differences
Node.js TLS stack vs curl's OpenSSL might negotiate differently with Cloudflare.

### 5. Connection Pooling/Reuse
Node.js fetch might reuse connections differently than curl, causing issues with the tunnel.

## Questions for Cloudflare Team

1. **Tunnel Logs**: Do you see the POST request arrive immediately or after 30 seconds?
2. **Error Logs**: What's causing the 500 error? Is it tunnel-side or origin-side?
3. **HTTP/2 Handling**: Any known issues with HTTP/2 POST requests through Cloudflare tunnel?
4. **Request Headers**: Are there specific headers required or problematic for POST requests?
5. **Timeout Configuration**: Is there a 30-second timeout configured somewhere?

## Additional Tests We Can Run

- [ ] Test with explicit HTTP/1.1 (if possible with Node.js fetch)
- [ ] Test with different User-Agent headers
- [ ] Test with explicit Content-Length: 0
- [ ] Test with browser fetch (to compare)
- [ ] Test direct connection to origin (bypass tunnel)
- [ ] Test with node-fetch library instead of native fetch
- [ ] Capture full packet trace with Wireshark

## Contact
Let me know what additional information would be helpful!
