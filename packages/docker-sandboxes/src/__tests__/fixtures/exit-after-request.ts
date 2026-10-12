// Preconnects, makes one request and returns without closing anything: the process must exit by
// itself, which it can't while the HTTP/2 session holds a referenced socket.
import { http2Fetch } from '../../http2-fetch';

async function main(origin: string) {
  const transport = http2Fetch(origin);
  transport.preconnect();
  const response = await transport.fetch(new Request(`${origin}/done`));
  await response.text();
  console.log(response.status);
}

void main(process.argv[2]);
