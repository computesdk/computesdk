import {
  AllocateAddressCommand,
  AssociateAddressCommand,
  AuthorizeSecurityGroupIngressCommand,
  CreateSecurityGroupCommand,
  DeleteSecurityGroupCommand,
  DescribeAddressesCommand,
  DescribeInstanceTypesCommand,
  DescribeInstancesCommand,
  DescribeLaunchTemplateVersionsCommand,
  DescribeSecurityGroupRulesCommand,
  DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand,
  DisassociateAddressCommand,
  EC2Client,
  ModifySubnetAttributeCommand,
  ReleaseAddressCommand,
  RevokeSecurityGroupIngressCommand,
  RunInstancesCommand,
  TerminateInstancesCommand,
  type Instance,
} from '@aws-sdk/client-ec2';
import {
  AddRoleToInstanceProfileCommand,
  AttachRolePolicyCommand,
  CreateInstanceProfileCommand,
  CreateRoleCommand,
  DeleteInstanceProfileCommand,
  DeleteRoleCommand,
  DeleteRolePolicyCommand,
  DetachRolePolicyCommand,
  GetInstanceProfileCommand,
  GetRoleCommand,
  IAMClient,
  PutRolePolicyCommand,
  RemoveRoleFromInstanceProfileCommand,
} from '@aws-sdk/client-iam';
import {
  ChangeResourceRecordSetsCommand,
  CreateHostedZoneCommand,
  ListHostedZonesByNameCommand,
  ListResourceRecordSetsCommand,
  Route53Client,
} from '@aws-sdk/client-route-53';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from '@aws-sdk/types';

import { normalizePreviewDomain, previewRegionDomain } from '../preview';
import { EC2_TRUST_POLICY, caddyDnsPolicy, renderUserData } from './templates';

export { renderCaddyfile, renderUserData } from './templates';

export const GATEWAY_TAG_KEY = 'computesdk:gateway';
const SSM_CORE_POLICY_ARN = 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore';
const DNS_POLICY_NAME = 'caddy-route53-dns-challenge';
const DEFAULT_PORTS = { from: 1024, to: 65535 };
const DEFAULT_INSTANCE_TYPE = 't4g.micro';

export interface GatewayPortRange {
  from: number;
  to: number;
}

export interface GatewayCommonOptions {
  region: string;
  /** Preview domain, e.g. "preview.example.com". Must be in (or be) a public Route 53 hosted zone. */
  domain: string;
  credentials?: AwsCredentialIdentity | AwsCredentialIdentityProvider;
  log?: (message: string) => void;
  /** Poll/retry interval for instance state and IAM propagation (default 3000). */
  pollIntervalMs?: number;
  /** Max wait for instance state changes (default 300000). */
  waitTimeoutMs?: number;
}

export interface GatewayUpOptions extends GatewayCommonOptions {
  /** Subnets the sandboxes launch into (same VPC). The gateway runs in the first one, which needs an internet route. */
  subnetIds: string[];
  /** Sandbox launch template; its security groups get the gateway ingress rule. */
  launchTemplate?: string;
  /** Sandbox security groups, instead of reading them from `launchTemplate`. */
  boxSecurityGroupIds?: string[];
  /** Sandbox ports the gateway may reach (default 1024-65535). */
  ports?: GatewayPortRange;
  /** Gateway instance type (default t4g.micro). */
  instanceType?: string;
  /** ACME account email for Let's Encrypt notices. */
  email?: string;
  /** Create a public hosted zone for `domain` when none exists. */
  createZone?: boolean;
}

export interface GatewayUpResult {
  gatewayId: string;
  wildcard: string;
  hostedZoneId: string;
  /** Name servers of a zone this run created; delegate the domain to them. */
  createdZoneNameServers?: string[];
  instanceId: string;
  publicIp: string;
  securityGroupId: string;
}

interface Clients {
  ec2: EC2Client;
  iam: IAMClient;
  route53: Route53Client;
  ssm: SSMClient;
}

interface Run {
  options: GatewayCommonOptions;
  clients: Clients;
  domain: string;
  gatewayId: string;
  wildcard: string;
  resourceName: string;
  tags: Array<{ Key: string; Value: string }>;
  log: (message: string) => void;
  pollMs: number;
  waitMs: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function errorName(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as { name?: string; Code?: string };
  return e.name ?? e.Code;
}

function hasErrorName(error: unknown, ...names: string[]): boolean {
  const name = errorName(error);
  return !!name && names.includes(name);
}

export function parsePortRange(value: string): GatewayPortRange {
  const match = /^(\d+)(?:-(\d+))?$/.exec(value.trim());
  const from = match ? Number(match[1]) : NaN;
  const to = match ? Number(match[2] ?? match[1]) : NaN;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1000 || to > 65535 || from > to) {
    throw new Error(`Invalid port range "${value}": expected e.g. "1024-65535" (ports 1000-65535).`);
  }
  return { from, to };
}

/** IAM/SG-safe name for one gateway, unique per region + domain. */
export function gatewayResourceName(region: string, domain: string): string {
  return `computesdk-gateway-${region}-${normalizePreviewDomain(domain).replace(/\./g, '-')}`.slice(0, 64);
}

function createRun(options: GatewayCommonOptions): Run {
  const domain = normalizePreviewDomain(options.domain);
  const gatewayId = previewRegionDomain(domain, options.region);
  const clientConfig = {
    region: options.region,
    ...(options.credentials ? { credentials: options.credentials } : {}),
  };
  return {
    options,
    clients: {
      ec2: new EC2Client(clientConfig),
      iam: new IAMClient(clientConfig),
      route53: new Route53Client(clientConfig),
      ssm: new SSMClient(clientConfig),
    },
    domain,
    gatewayId,
    wildcard: `*.${gatewayId}`,
    resourceName: gatewayResourceName(options.region, domain),
    tags: [
      { Key: GATEWAY_TAG_KEY, Value: gatewayId },
      { Key: 'Name', Value: `computesdk-gateway ${gatewayId}` },
    ],
    log: options.log ?? (() => {}),
    pollMs: options.pollIntervalMs ?? 3_000,
    waitMs: options.waitTimeoutMs ?? 300_000,
  };
}

const tagFilter = (run: Run) => ({ Name: `tag:${GATEWAY_TAG_KEY}`, Values: [run.gatewayId] });

async function findHostedZone(run: Run): Promise<{ id: string; name: string } | null> {
  const labels = run.domain.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join('.');
    const result = await run.clients.route53.send(new ListHostedZonesByNameCommand({ DNSName: candidate, MaxItems: 10 }));
    const zone = result.HostedZones?.find((z) => z.Name === `${candidate}.` && !z.Config?.PrivateZone);
    if (zone?.Id) return { id: zone.Id.replace(/^\/hostedzone\//, ''), name: candidate };
  }
  return null;
}

async function ensureHostedZone(run: Run, createZone: boolean): Promise<{ id: string; nameServers?: string[] }> {
  const existing = await findHostedZone(run);
  if (existing) {
    run.log(`Hosted zone ${existing.name} (${existing.id})`);
    return { id: existing.id };
  }
  if (!createZone) {
    throw new Error(`No public Route 53 hosted zone covers ${run.domain}. Create one, or pass --create-zone.`);
  }
  const created = await run.clients.route53.send(
    new CreateHostedZoneCommand({ Name: run.domain, CallerReference: `computesdk-gateway-${Date.now()}` }),
  );
  const id = created.HostedZone!.Id!.replace(/^\/hostedzone\//, '');
  run.log(`Created hosted zone ${run.domain} (${id})`);
  return { id, nameServers: created.DelegationSet?.NameServers ?? [] };
}

async function resolveVpc(run: Run, subnetIds: string[]): Promise<string> {
  if (subnetIds.length === 0) throw new Error('Pass at least one subnet id (--subnet-ids).');
  const result = await run.clients.ec2.send(new DescribeSubnetsCommand({ SubnetIds: subnetIds }));
  const vpcs = new Set((result.Subnets ?? []).map((subnet) => subnet.VpcId));
  if (vpcs.size !== 1) throw new Error(`Subnets ${subnetIds.join(', ')} must all be in one VPC.`);
  return [...vpcs][0]!;
}

/** Lets `i-….<region>.compute.internal` resolve for instances launched from now on. */
async function enableResourceNameDns(run: Run, subnetIds: string[]): Promise<void> {
  for (const subnetId of subnetIds) {
    await run.clients.ec2.send(
      new ModifySubnetAttributeCommand({ SubnetId: subnetId, EnableResourceNameDnsARecordOnLaunch: { Value: true } }),
    );
  }
  run.log(`Enabled resource-name DNS records on ${subnetIds.join(', ')} (applies to instances launched after this)`);
}

async function ensureGatewaySecurityGroup(run: Run, vpcId: string): Promise<string> {
  const existing = await run.clients.ec2.send(
    new DescribeSecurityGroupsCommand({ Filters: [tagFilter(run), { Name: 'vpc-id', Values: [vpcId] }] }),
  );
  let groupId = existing.SecurityGroups?.[0]?.GroupId;
  if (!groupId) {
    const created = await run.clients.ec2.send(
      new CreateSecurityGroupCommand({
        GroupName: run.resourceName,
        Description: `ComputeSDK preview gateway for ${run.wildcard}`,
        VpcId: vpcId,
        TagSpecifications: [{ ResourceType: 'security-group', Tags: run.tags }],
      }),
    );
    groupId = created.GroupId!;
    run.log(`Created gateway security group ${groupId}`);
  }
  try {
    await run.clients.ec2.send(
      new AuthorizeSecurityGroupIngressCommand({
        GroupId: groupId,
        IpPermissions: [
          { IpProtocol: 'tcp', FromPort: 443, ToPort: 443, IpRanges: [{ CidrIp: '0.0.0.0/0' }], Ipv6Ranges: [{ CidrIpv6: '::/0' }] },
        ],
      }),
    );
  } catch (error) {
    if (!hasErrorName(error, 'InvalidPermission.Duplicate')) throw error;
  }
  return groupId;
}

async function boxSecurityGroups(run: Run, options: GatewayUpOptions): Promise<string[]> {
  if (options.boxSecurityGroupIds?.length) return options.boxSecurityGroupIds;
  if (!options.launchTemplate) throw new Error('Pass --launch-template or --box-security-groups.');
  const isId = options.launchTemplate.startsWith('lt-');
  const result = await run.clients.ec2.send(
    new DescribeLaunchTemplateVersionsCommand({
      ...(isId ? { LaunchTemplateId: options.launchTemplate } : { LaunchTemplateName: options.launchTemplate }),
      Versions: ['$Default'],
    }),
  );
  const data = result.LaunchTemplateVersions?.[0]?.LaunchTemplateData;
  const groups = new Set([
    ...(data?.SecurityGroupIds ?? []),
    ...(data?.NetworkInterfaces ?? []).flatMap((ni) => ni.Groups ?? []),
  ]);
  if (groups.size === 0) {
    throw new Error(`Launch template ${options.launchTemplate} sets no security group ids; pass --box-security-groups.`);
  }
  return [...groups];
}

async function allowGatewayToBoxes(run: Run, gatewayGroupId: string, boxGroups: string[], ports: GatewayPortRange) {
  for (const groupId of boxGroups) {
    try {
      await run.clients.ec2.send(
        new AuthorizeSecurityGroupIngressCommand({
          GroupId: groupId,
          IpPermissions: [
            {
              IpProtocol: 'tcp',
              FromPort: ports.from,
              ToPort: ports.to,
              UserIdGroupPairs: [{ GroupId: gatewayGroupId, Description: `ComputeSDK preview gateway ${run.gatewayId}` }],
            },
          ],
          TagSpecifications: [{ ResourceType: 'security-group-rule', Tags: run.tags }],
        }),
      );
      run.log(`Allowed gateway → ${groupId} on tcp ${ports.from}-${ports.to}`);
    } catch (error) {
      if (!hasErrorName(error, 'InvalidPermission.Duplicate')) throw error;
    }
  }
}

async function ensureInstanceProfile(run: Run, hostedZoneId: string): Promise<string> {
  const name = run.resourceName;
  try {
    await run.clients.iam.send(new GetRoleCommand({ RoleName: name }));
  } catch (error) {
    if (!hasErrorName(error, 'NoSuchEntityException', 'NoSuchEntity')) throw error;
    await run.clients.iam.send(
      new CreateRoleCommand({ RoleName: name, AssumeRolePolicyDocument: EC2_TRUST_POLICY, Tags: run.tags }),
    );
    run.log(`Created IAM role ${name}`);
  }
  await run.clients.iam.send(
    new PutRolePolicyCommand({ RoleName: name, PolicyName: DNS_POLICY_NAME, PolicyDocument: caddyDnsPolicy(hostedZoneId) }),
  );
  await run.clients.iam.send(new AttachRolePolicyCommand({ RoleName: name, PolicyArn: SSM_CORE_POLICY_ARN }));

  let hasRole = false;
  try {
    const profile = await run.clients.iam.send(new GetInstanceProfileCommand({ InstanceProfileName: name }));
    hasRole = (profile.InstanceProfile?.Roles ?? []).some((role) => role.RoleName === name);
  } catch (error) {
    if (!hasErrorName(error, 'NoSuchEntityException', 'NoSuchEntity')) throw error;
    await run.clients.iam.send(new CreateInstanceProfileCommand({ InstanceProfileName: name, Tags: run.tags }));
  }
  if (!hasRole) {
    await run.clients.iam.send(new AddRoleToInstanceProfileCommand({ InstanceProfileName: name, RoleName: name }));
  }
  return name;
}

async function findGatewayInstance(run: Run, states: string[]): Promise<Instance | undefined> {
  const result = await run.clients.ec2.send(
    new DescribeInstancesCommand({ Filters: [tagFilter(run), { Name: 'instance-state-name', Values: states }] }),
  );
  return result.Reservations?.flatMap((reservation) => reservation.Instances ?? [])[0];
}

async function waitForState(run: Run, instanceId: string, state: string): Promise<void> {
  const deadline = Date.now() + run.waitMs;
  for (;;) {
    const result = await run.clients.ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
    const current = result.Reservations?.[0]?.Instances?.[0]?.State?.Name;
    if (current === state) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${instanceId} to be ${state} (now ${current}).`);
    await sleep(run.pollMs);
  }
}

async function gatewayAmi(run: Run, instanceType: string): Promise<string> {
  const types = await run.clients.ec2.send(new DescribeInstanceTypesCommand({ InstanceTypes: [instanceType as never] }));
  const archs = types.InstanceTypes?.[0]?.ProcessorInfo?.SupportedArchitectures ?? [];
  const arch = archs.includes('arm64') ? 'arm64' : 'x86_64';
  const parameter = await run.clients.ssm.send(
    new GetParameterCommand({ Name: `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-${arch}` }),
  );
  return parameter.Parameter!.Value!;
}

async function ensureGatewayInstance(
  run: Run,
  options: GatewayUpOptions,
  securityGroupId: string,
  instanceProfile: string,
): Promise<string> {
  const existing = await findGatewayInstance(run, ['pending', 'running']);
  if (existing?.InstanceId) {
    run.log(`Reusing gateway instance ${existing.InstanceId} (run down then up to apply config changes)`);
    return existing.InstanceId;
  }
  const instanceType = options.instanceType ?? DEFAULT_INSTANCE_TYPE;
  const imageId = await gatewayAmi(run, instanceType);
  const userData = Buffer.from(
    renderUserData({ region: options.region, domain: run.domain, email: options.email }),
    'utf8',
  ).toString('base64');
  const deadline = Date.now() + run.waitMs;
  for (;;) {
    try {
      const result = await run.clients.ec2.send(
        new RunInstancesCommand({
          MinCount: 1,
          MaxCount: 1,
          ImageId: imageId,
          InstanceType: instanceType as never,
          SubnetId: options.subnetIds[0],
          SecurityGroupIds: [securityGroupId],
          IamInstanceProfile: { Name: instanceProfile },
          UserData: userData,
          MetadataOptions: { HttpTokens: 'required', HttpEndpoint: 'enabled' },
          TagSpecifications: [
            { ResourceType: 'instance', Tags: run.tags },
            { ResourceType: 'volume', Tags: run.tags },
          ],
        }),
      );
      const instanceId = result.Instances![0]!.InstanceId!;
      run.log(`Launched gateway instance ${instanceId} (${instanceType})`);
      return instanceId;
    } catch (error) {
      // A new instance profile takes a few seconds to become usable by EC2.
      const iamNotReady =
        hasErrorName(error, 'InvalidParameterValue') && /iam ?instance ?profile/i.test(String((error as Error).message));
      if (!iamNotReady || Date.now() > deadline) throw error;
      await sleep(run.pollMs);
    }
  }
}

async function ensureElasticIp(run: Run, instanceId: string): Promise<string> {
  const existing = await run.clients.ec2.send(new DescribeAddressesCommand({ Filters: [tagFilter(run)] }));
  let address = existing.Addresses?.[0];
  if (!address) {
    const allocated = await run.clients.ec2.send(
      new AllocateAddressCommand({ Domain: 'vpc', TagSpecifications: [{ ResourceType: 'elastic-ip', Tags: run.tags }] }),
    );
    address = { AllocationId: allocated.AllocationId, PublicIp: allocated.PublicIp };
    run.log(`Allocated Elastic IP ${allocated.PublicIp}`);
  }
  if (address.InstanceId !== instanceId) {
    await run.clients.ec2.send(
      new AssociateAddressCommand({ AllocationId: address.AllocationId, InstanceId: instanceId, AllowReassociation: true }),
    );
  }
  return address.PublicIp!;
}

async function upsertWildcard(run: Run, hostedZoneId: string, publicIp: string): Promise<void> {
  await run.clients.route53.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: hostedZoneId,
      ChangeBatch: {
        Comment: `ComputeSDK preview gateway ${run.gatewayId}`,
        Changes: [
          {
            Action: 'UPSERT',
            ResourceRecordSet: { Name: run.wildcard, Type: 'A', TTL: 60, ResourceRecords: [{ Value: publicIp }] },
          },
        ],
      },
    }),
  );
  run.log(`DNS ${run.wildcard} → ${publicIp}`);
}

/** Create or update the preview gateway for one region. Safe to re-run. */
export async function gatewayUp(options: GatewayUpOptions): Promise<GatewayUpResult> {
  const run = createRun(options);
  const ports = options.ports ?? DEFAULT_PORTS;
  const zone = await ensureHostedZone(run, options.createZone === true);
  const vpcId = await resolveVpc(run, options.subnetIds);
  await enableResourceNameDns(run, options.subnetIds);
  const securityGroupId = await ensureGatewaySecurityGroup(run, vpcId);
  await allowGatewayToBoxes(run, securityGroupId, await boxSecurityGroups(run, options), ports);
  const instanceProfile = await ensureInstanceProfile(run, zone.id);
  const instanceId = await ensureGatewayInstance(run, options, securityGroupId, instanceProfile);
  await waitForState(run, instanceId, 'running');
  const publicIp = await ensureElasticIp(run, instanceId);
  await upsertWildcard(run, zone.id, publicIp);
  return {
    gatewayId: run.gatewayId,
    wildcard: run.wildcard,
    hostedZoneId: zone.id,
    ...(zone.nameServers ? { createdZoneNameServers: zone.nameServers } : {}),
    instanceId,
    publicIp,
    securityGroupId,
  };
}

async function deleteWildcard(run: Run): Promise<void> {
  const zone = await findHostedZone(run);
  if (!zone) return;
  const result = await run.clients.route53.send(
    new ListResourceRecordSetsCommand({ HostedZoneId: zone.id, StartRecordName: run.wildcard, StartRecordType: 'A', MaxItems: 1 }),
  );
  const record = result.ResourceRecordSets?.[0];
  const name = record?.Name?.replace(/^\\052/, '*').replace(/\.$/, '');
  if (!record || name !== run.wildcard || record.Type !== 'A') return;
  await run.clients.route53.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: zone.id,
      ChangeBatch: { Changes: [{ Action: 'DELETE', ResourceRecordSet: record }] },
    }),
  );
  run.log(`Deleted DNS ${run.wildcard}`);
}

async function deleteInstanceProfile(run: Run): Promise<void> {
  const name = run.resourceName;
  const ignoreMissing = async (send: () => Promise<unknown>) => {
    try {
      await send();
    } catch (error) {
      if (!hasErrorName(error, 'NoSuchEntityException', 'NoSuchEntity')) throw error;
    }
  };
  await ignoreMissing(() =>
    run.clients.iam.send(new RemoveRoleFromInstanceProfileCommand({ InstanceProfileName: name, RoleName: name })),
  );
  await ignoreMissing(() => run.clients.iam.send(new DeleteInstanceProfileCommand({ InstanceProfileName: name })));
  await ignoreMissing(() => run.clients.iam.send(new DeleteRolePolicyCommand({ RoleName: name, PolicyName: DNS_POLICY_NAME })));
  await ignoreMissing(() => run.clients.iam.send(new DetachRolePolicyCommand({ RoleName: name, PolicyArn: SSM_CORE_POLICY_ARN })));
  await ignoreMissing(() => run.clients.iam.send(new DeleteRoleCommand({ RoleName: name })));
}

/** Remove everything `gatewayUp` created for this region + domain, except the hosted zone. */
export async function gatewayDown(options: GatewayCommonOptions): Promise<void> {
  const run = createRun(options);
  await deleteWildcard(run);

  const addresses = await run.clients.ec2.send(new DescribeAddressesCommand({ Filters: [tagFilter(run)] }));
  for (const address of addresses.Addresses ?? []) {
    if (address.AssociationId) {
      await run.clients.ec2.send(new DisassociateAddressCommand({ AssociationId: address.AssociationId }));
    }
    await run.clients.ec2.send(new ReleaseAddressCommand({ AllocationId: address.AllocationId }));
    run.log(`Released Elastic IP ${address.PublicIp}`);
  }

  const instance = await findGatewayInstance(run, ['pending', 'running', 'stopping', 'stopped', 'shutting-down']);
  if (instance?.InstanceId) {
    await run.clients.ec2.send(new TerminateInstancesCommand({ InstanceIds: [instance.InstanceId] }));
    run.log(`Terminating gateway instance ${instance.InstanceId}`);
    await waitForState(run, instance.InstanceId, 'terminated');
  }

  const rules = await run.clients.ec2.send(new DescribeSecurityGroupRulesCommand({ Filters: [tagFilter(run)] }));
  const byGroup = new Map<string, string[]>();
  for (const rule of rules.SecurityGroupRules ?? []) {
    if (!rule.GroupId || !rule.SecurityGroupRuleId || rule.IsEgress) continue;
    byGroup.set(rule.GroupId, [...(byGroup.get(rule.GroupId) ?? []), rule.SecurityGroupRuleId]);
  }
  for (const [groupId, ruleIds] of byGroup) {
    await run.clients.ec2.send(new RevokeSecurityGroupIngressCommand({ GroupId: groupId, SecurityGroupRuleIds: ruleIds }));
    run.log(`Revoked gateway rule on ${groupId}`);
  }

  const groups = await run.clients.ec2.send(new DescribeSecurityGroupsCommand({ Filters: [tagFilter(run)] }));
  for (const group of groups.SecurityGroups ?? []) {
    const deadline = Date.now() + run.waitMs;
    for (;;) {
      try {
        await run.clients.ec2.send(new DeleteSecurityGroupCommand({ GroupId: group.GroupId }));
        run.log(`Deleted security group ${group.GroupId}`);
        break;
      } catch (error) {
        // The terminated instance's network interface can hold the group for a little while.
        if (!hasErrorName(error, 'DependencyViolation') || Date.now() > deadline) throw error;
        await sleep(run.pollMs);
      }
    }
  }

  await deleteInstanceProfile(run);
  run.log(`Gateway ${run.gatewayId} removed (hosted zone kept)`);
}
