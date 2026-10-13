import { PREVIEW_LABEL_PATTERN, previewRegionDomain, privateDnsSuffix } from '../preview';

export interface GatewayTemplateInput {
  region: string;
  domain: string;
  email?: string;
}

/** Caddy config: wildcard TLS via Route 53 DNS challenge, `<port>-<instanceId>` → instance private DNS name. */
export function renderCaddyfile({ region, domain, email }: GatewayTemplateInput): string {
  const global = email ? `{\n\temail ${email}\n}\n\n` : '';
  return (
    global +
    `*.${previewRegionDomain(domain, region)} {\n` +
    `\ttls {\n\t\tdns route53\n\t}\n` +
    `\t@box header_regexp box Host ${PREVIEW_LABEL_PATTERN}\n` +
    `\thandle @box {\n` +
    `\t\treverse_proxy {re.box.2}.${privateDnsSuffix(region)}:{re.box.1}\n` +
    `\t}\n` +
    `\trespond 404\n` +
    `}\n`
  );
}

const CADDY_DOWNLOAD = 'https://caddyserver.com/api/download?os=linux&arch=$CADDY_ARCH&p=github.com/caddy-dns/route53';

/** Amazon Linux 2023 user data: install Caddy with the Route 53 DNS plugin and run it under systemd. */
export function renderUserData(input: GatewayTemplateInput): string {
  return `#!/bin/bash
set -euo pipefail
case "$(uname -m)" in
  aarch64) CADDY_ARCH=arm64 ;;
  *) CADDY_ARCH=amd64 ;;
esac
# The Elastic IP may not be attached yet on first boot; retry until egress works.
until curl -fsSL -o /usr/local/bin/caddy "${CADDY_DOWNLOAD}"; do sleep 5; done
chmod 0755 /usr/local/bin/caddy
id caddy >/dev/null 2>&1 || useradd --system --home-dir /var/lib/caddy --create-home --shell /usr/sbin/nologin caddy
mkdir -p /etc/caddy
cat > /etc/caddy/Caddyfile <<'CADDYFILE'
${renderCaddyfile(input)}CADDYFILE
cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=ComputeSDK preview gateway (Caddy)
After=network-online.target
Wants=network-online.target

[Service]
User=caddy
Group=caddy
Environment=HOME=/var/lib/caddy
Environment=AWS_REGION=${input.region}
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
Restart=on-failure
AmbientCapabilities=CAP_NET_BIND_SERVICE
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now caddy
`;
}

/** Instance-role policy: only `_acme-challenge` TXT records in the gateway's hosted zone. */
export function caddyDnsPolicy(hostedZoneId: string): string {
  const zoneArn = `arn:aws:route53:::hostedzone/${hostedZoneId}`;
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: ['route53:ListHostedZonesByName', 'route53:ListHostedZones'], Resource: '*' },
      { Effect: 'Allow', Action: 'route53:ListResourceRecordSets', Resource: zoneArn },
      { Effect: 'Allow', Action: 'route53:GetChange', Resource: 'arn:aws:route53:::change/*' },
      {
        Effect: 'Allow',
        Action: 'route53:ChangeResourceRecordSets',
        Resource: zoneArn,
        Condition: {
          'ForAllValues:StringEquals': { 'route53:ChangeResourceRecordSetsRecordTypes': 'TXT' },
          'ForAllValues:StringLike': { 'route53:ChangeResourceRecordSetsNormalizedRecordNames': '_acme-challenge.*' },
        },
      },
    ],
  });
}

export const EC2_TRUST_POLICY = JSON.stringify({
  Version: '2012-10-17',
  Statement: [{ Effect: 'Allow', Principal: { Service: 'ec2.amazonaws.com' }, Action: 'sts:AssumeRole' }],
});
