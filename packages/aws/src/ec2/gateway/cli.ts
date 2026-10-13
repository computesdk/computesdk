import { parseArgs } from 'node:util';

import { gatewayDown, gatewayUp, parsePortRange } from './index';

const USAGE = `Usage:
  computesdk-aws-ec2-gateway up --domain <domain> --subnet-ids <a,b> (--launch-template <name|lt-id> | --box-security-groups <sg-a,sg-b>)
                                [--region <region>] [--ports 1024-65535] [--instance-type t4g.micro] [--email <email>] [--create-zone]
  computesdk-aws-ec2-gateway down --domain <domain> [--region <region>]

Runs a Caddy reverse proxy in the sandboxes' VPC so ec2({ previewDomain }) URLs
(https://<port>-<instanceId>.<region>.<domain>) reach sandbox ports. The domain must be
in a public Route 53 hosted zone. Uses the default AWS credential chain.`;

const list = (value: string | undefined) =>
  value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : undefined;

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      region: { type: 'string' },
      domain: { type: 'string' },
      'subnet-ids': { type: 'string' },
      'launch-template': { type: 'string' },
      'box-security-groups': { type: 'string' },
      ports: { type: 'string' },
      'instance-type': { type: 'string' },
      email: { type: 'string' },
      'create-zone': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const action = positionals[0];
  if (values.help || (action !== 'up' && action !== 'down')) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 1);
  }
  const region = values.region ?? process.env.AWS_REGION;
  if (!region || !values.domain) {
    console.error('--domain and --region (or AWS_REGION) are required.\n');
    console.error(USAGE);
    process.exit(1);
  }
  const common = { region, domain: values.domain, log: (message: string) => console.log(`  ${message}`) };

  if (action === 'down') {
    await gatewayDown(common);
    return;
  }

  const result = await gatewayUp({
    ...common,
    subnetIds: list(values['subnet-ids']) ?? [],
    launchTemplate: values['launch-template'],
    boxSecurityGroupIds: list(values['box-security-groups']),
    ports: values.ports ? parsePortRange(values.ports) : undefined,
    instanceType: values['instance-type'],
    email: values.email,
    createZone: values['create-zone'],
  });
  console.log(`
  Gateway ${result.gatewayId} is up (${result.instanceId}, ${result.publicIp}).
  Caddy fetches its certificate a minute or two after first boot.

  Use it:
    ec2({ launchTemplate: '...', region: '${region}', previewDomain: '${values.domain}' })
`);
  if (result.createdZoneNameServers?.length) {
    console.log(`  Delegate ${values.domain} to the new hosted zone at your registrar:\n${result.createdZoneNameServers
      .map((ns) => `    ${ns}`)
      .join('\n')}\n`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
