The self-signed certificate and private key in this directory are public,
localhost-only test fixtures. They are not service credentials. Transport tests
trust this certificate only inside their connector/fallback fixtures; production
TLS verification remains enabled. Regenerate with:

    openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config tls.cnf -keyout tls-key.pem -out tls-cert.pem

The mismatch certificate is signed by this test CA but names
`mismatch.example.test`, so connecting to 127.0.0.1 must fail hostname checks.
It uses the same public test key.
