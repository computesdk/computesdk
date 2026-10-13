import { mockClient } from 'aws-sdk-client-mock';
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
} from '@aws-sdk/client-ec2';
import {
  AddRoleToInstanceProfileCommand,
  CreateInstanceProfileCommand,
  CreateRoleCommand,
  DeleteRoleCommand,
  GetInstanceProfileCommand,
  GetRoleCommand,
  IAMClient,
  PutRolePolicyCommand,
} from '@aws-sdk/client-iam';
import {
  ChangeResourceRecordSetsCommand,
  ListHostedZonesByNameCommand,
  ListResourceRecordSetsCommand,
  Route53Client,
} from '@aws-sdk/client-route-53';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { beforeEach, describe, expect, it } from 'vitest';

import { gatewayDown, gatewayResourceName, gatewayUp, parsePortRange, renderCaddyfile, renderUserData } from '../index';

const ec2 = mockClient(EC2Client);
const iam = mockClient(IAMClient);
const route53 = mockClient(Route53Client);
const ssm = mockClient(SSMClient);

const GATEWAY_ID = 'us-east-2.preview.example.com';
const noSuchEntity = () => Object.assign(new Error('not found'), { name: 'NoSuchEntityException' });

beforeEach(() => {
  ec2.reset();
  iam.reset();
  route53.reset();
  ssm.reset();
  route53.on(ListHostedZonesByNameCommand).callsFake((input: { DNSName: string }) => ({
    HostedZones: input.DNSName === 'example.com' ? [{ Id: '/hostedzone/Z123', Name: 'example.com.', CallerReference: 'x' }] : [],
  }));
});

describe('templates', () => {
  it('routes <port>-<instanceId> to the instance private DNS name', () => {
    const caddyfile = renderCaddyfile({ region: 'us-east-2', domain: 'preview.example.com' });
    expect(caddyfile).toContain('*.us-east-2.preview.example.com {');
    expect(caddyfile).toContain('dns route53');
    expect(caddyfile).toContain('@box header_regexp box Host ^(\\d{4,5})-(i-[0-9a-f]{8,17})\\.');
    expect(caddyfile).toContain('reverse_proxy {re.box.2}.us-east-2.compute.internal:{re.box.1}');
    expect(renderCaddyfile({ region: 'us-east-1', domain: 'p.example.com' })).toContain('{re.box.2}.ec2.internal:');
    expect(renderCaddyfile({ region: 'us-east-2', domain: 'p.example.com', email: 'ops@example.com' })).toMatch(
      /^\{\n\temail ops@example.com\n\}/,
    );
  });

  it('installs Caddy with the Route 53 plugin in user data', () => {
    const userData = renderUserData({ region: 'us-east-2', domain: 'preview.example.com' });
    expect(userData).toContain('p=github.com/caddy-dns/route53');
    expect(userData).toContain('Environment=AWS_REGION=us-east-2');
    expect(userData).toContain('*.us-east-2.preview.example.com {');
  });

  it('parses port ranges', () => {
    expect(parsePortRange('3000-3999')).toEqual({ from: 3000, to: 3999 });
    expect(parsePortRange('38989')).toEqual({ from: 38989, to: 38989 });
    expect(() => parsePortRange('22-80')).toThrow('Invalid port range');
    expect(() => parsePortRange('5000-4000')).toThrow('Invalid port range');
  });

  it('names resources per region and domain within IAM limits', () => {
    expect(gatewayResourceName('us-east-2', 'preview.example.com')).toBe('computesdk-gateway-us-east-2-preview-example-com');
    expect(gatewayResourceName('us-east-2', `${'a'.repeat(60)}.com`)).toHaveLength(64);
  });
});

describe('gatewayUp', () => {
  function mockFreshAccount() {
    ec2.on(DescribeSubnetsCommand).resolves({ Subnets: [{ SubnetId: 'subnet-a', VpcId: 'vpc-1' }, { SubnetId: 'subnet-b', VpcId: 'vpc-1' }] });
    ec2.on(ModifySubnetAttributeCommand).resolves({});
    ec2.on(DescribeSecurityGroupsCommand).resolves({ SecurityGroups: [] });
    ec2.on(CreateSecurityGroupCommand).resolves({ GroupId: 'sg-gw' });
    ec2.on(AuthorizeSecurityGroupIngressCommand).resolves({});
    ec2.on(DescribeLaunchTemplateVersionsCommand).resolves({
      LaunchTemplateVersions: [{ LaunchTemplateData: { NetworkInterfaces: [{ Groups: ['sg-box'] }] } }],
    });
    iam.on(GetRoleCommand).rejects(noSuchEntity());
    iam.on(GetInstanceProfileCommand).rejects(noSuchEntity());
    ec2.on(DescribeInstanceTypesCommand).resolves({
      InstanceTypes: [{ ProcessorInfo: { SupportedArchitectures: ['arm64'] } }],
    });
    ssm.on(GetParameterCommand).resolves({ Parameter: { Value: 'ami-al2023' } });
    ec2.on(RunInstancesCommand).resolves({ Instances: [{ InstanceId: 'i-gw' }] });
    ec2
      .on(DescribeInstancesCommand)
      .resolves({ Reservations: [] })
      .on(DescribeInstancesCommand, { InstanceIds: ['i-gw'] })
      .resolves({ Reservations: [{ Instances: [{ InstanceId: 'i-gw', State: { Name: 'running' } }] }] });
    ec2.on(DescribeAddressesCommand).resolves({ Addresses: [] });
    ec2.on(AllocateAddressCommand).resolves({ AllocationId: 'eipalloc-1', PublicIp: '203.0.113.7' });
    ec2.on(AssociateAddressCommand).resolves({});
    route53.on(ChangeResourceRecordSetsCommand).resolves({});
  }

  it('creates the gateway and points the wildcard at its Elastic IP', async () => {
    mockFreshAccount();
    const result = await gatewayUp({
      region: 'us-east-2',
      domain: 'preview.example.com',
      subnetIds: ['subnet-a', 'subnet-b'],
      launchTemplate: 'computesdk-market-medium',
      pollIntervalMs: 1,
    });

    expect(result).toMatchObject({
      gatewayId: GATEWAY_ID,
      wildcard: `*.${GATEWAY_ID}`,
      hostedZoneId: 'Z123',
      instanceId: 'i-gw',
      publicIp: '203.0.113.7',
      securityGroupId: 'sg-gw',
    });
    expect(ec2.commandCalls(ModifySubnetAttributeCommand)).toHaveLength(2);

    const ingress = ec2.commandCalls(AuthorizeSecurityGroupIngressCommand).map((call) => call.args[0].input);
    expect(ingress).toContainEqual(expect.objectContaining({ GroupId: 'sg-gw', IpPermissions: [expect.objectContaining({ FromPort: 443 })] }));
    expect(ingress).toContainEqual(
      expect.objectContaining({
        GroupId: 'sg-box',
        IpPermissions: [expect.objectContaining({ FromPort: 1024, ToPort: 65535, UserIdGroupPairs: [expect.objectContaining({ GroupId: 'sg-gw' })] })],
      }),
    );

    const name = gatewayResourceName('us-east-2', 'preview.example.com');
    expect(iam.commandCalls(CreateRoleCommand)[0]!.args[0].input.RoleName).toBe(name);
    const policy = JSON.parse(iam.commandCalls(PutRolePolicyCommand)[0]!.args[0].input.PolicyDocument!);
    expect(JSON.stringify(policy)).toContain('arn:aws:route53:::hostedzone/Z123');
    expect(iam.commandCalls(CreateInstanceProfileCommand)).toHaveLength(1);
    expect(iam.commandCalls(AddRoleToInstanceProfileCommand)).toHaveLength(1);

    expect(ssm.commandCalls(GetParameterCommand)[0]!.args[0].input.Name).toContain('al2023-ami-kernel-default-arm64');
    const launch = ec2.commandCalls(RunInstancesCommand)[0]!.args[0].input;
    expect(launch).toMatchObject({ SubnetId: 'subnet-a', SecurityGroupIds: ['sg-gw'], IamInstanceProfile: { Name: name } });
    expect(Buffer.from(launch.UserData!, 'base64').toString('utf8')).toContain('*.us-east-2.preview.example.com {');

    const change = route53.commandCalls(ChangeResourceRecordSetsCommand)[0]!.args[0].input;
    expect(change.HostedZoneId).toBe('Z123');
    expect(change.ChangeBatch!.Changes![0]).toMatchObject({
      Action: 'UPSERT',
      ResourceRecordSet: { Name: `*.${GATEWAY_ID}`, Type: 'A', ResourceRecords: [{ Value: '203.0.113.7' }] },
    });
  });

  it('reuses existing resources and tolerates duplicate rules', async () => {
    mockFreshAccount();
    ec2.on(DescribeSecurityGroupsCommand).resolves({ SecurityGroups: [{ GroupId: 'sg-gw' }] });
    ec2.on(AuthorizeSecurityGroupIngressCommand).rejects(Object.assign(new Error('dup'), { name: 'InvalidPermission.Duplicate' }));
    iam.on(GetRoleCommand).resolves({});
    iam.on(GetInstanceProfileCommand).resolves({ InstanceProfile: { Roles: [{ RoleName: gatewayResourceName('us-east-2', 'preview.example.com') }] } as never });
    ec2
      .on(DescribeInstancesCommand)
      .resolves({ Reservations: [{ Instances: [{ InstanceId: 'i-gw', State: { Name: 'running' } }] }] });
    ec2.on(DescribeAddressesCommand).resolves({ Addresses: [{ AllocationId: 'eipalloc-1', PublicIp: '203.0.113.7', InstanceId: 'i-gw' }] });

    const result = await gatewayUp({
      region: 'us-east-2',
      domain: 'preview.example.com',
      subnetIds: ['subnet-a'],
      boxSecurityGroupIds: ['sg-box'],
      pollIntervalMs: 1,
    });

    expect(result.instanceId).toBe('i-gw');
    expect(ec2.commandCalls(CreateSecurityGroupCommand)).toHaveLength(0);
    expect(ec2.commandCalls(RunInstancesCommand)).toHaveLength(0);
    expect(ec2.commandCalls(AllocateAddressCommand)).toHaveLength(0);
    expect(ec2.commandCalls(AssociateAddressCommand)).toHaveLength(0);
    expect(iam.commandCalls(CreateRoleCommand)).toHaveLength(0);
    expect(iam.commandCalls(AddRoleToInstanceProfileCommand)).toHaveLength(0);
  });

  it('requires a hosted zone unless asked to create one', async () => {
    mockFreshAccount();
    await expect(
      gatewayUp({ region: 'us-east-2', domain: 'preview.other.dev', subnetIds: ['subnet-a'], boxSecurityGroupIds: ['sg-box'] }),
    ).rejects.toThrow('No public Route 53 hosted zone covers preview.other.dev');
  });
});

describe('gatewayDown', () => {
  it('removes the record, address, instance, rules, group, and IAM role', async () => {
    route53.on(ListResourceRecordSetsCommand).resolves({
      ResourceRecordSets: [{ Name: `\\052.${GATEWAY_ID}.`, Type: 'A', TTL: 60, ResourceRecords: [{ Value: '203.0.113.7' }] }],
    });
    route53.on(ChangeResourceRecordSetsCommand).resolves({});
    ec2.on(DescribeAddressesCommand).resolves({ Addresses: [{ AllocationId: 'eipalloc-1', AssociationId: 'eipassoc-1', PublicIp: '203.0.113.7' }] });
    ec2.on(DisassociateAddressCommand).resolves({});
    ec2.on(ReleaseAddressCommand).resolves({});
    ec2
      .on(DescribeInstancesCommand)
      .resolves({ Reservations: [{ Instances: [{ InstanceId: 'i-gw', State: { Name: 'running' } }] }] })
      .on(DescribeInstancesCommand, { InstanceIds: ['i-gw'] })
      .resolves({ Reservations: [{ Instances: [{ InstanceId: 'i-gw', State: { Name: 'terminated' } }] }] });
    ec2.on(TerminateInstancesCommand).resolves({});
    ec2.on(DescribeSecurityGroupRulesCommand).resolves({
      SecurityGroupRules: [{ GroupId: 'sg-box', SecurityGroupRuleId: 'sgr-1', IsEgress: false }],
    });
    ec2.on(RevokeSecurityGroupIngressCommand).resolves({});
    ec2.on(DescribeSecurityGroupsCommand).resolves({ SecurityGroups: [{ GroupId: 'sg-gw' }] });
    ec2
      .on(DeleteSecurityGroupCommand)
      .rejectsOnce(Object.assign(new Error('in use'), { name: 'DependencyViolation' }))
      .resolves({});
    iam.onAnyCommand().resolves({});

    await gatewayDown({ region: 'us-east-2', domain: 'preview.example.com', pollIntervalMs: 1 });

    expect(route53.commandCalls(ChangeResourceRecordSetsCommand)[0]!.args[0].input.ChangeBatch!.Changes![0]!.Action).toBe('DELETE');
    expect(ec2.commandCalls(ReleaseAddressCommand)).toHaveLength(1);
    expect(ec2.commandCalls(TerminateInstancesCommand)[0]!.args[0].input.InstanceIds).toEqual(['i-gw']);
    expect(ec2.commandCalls(RevokeSecurityGroupIngressCommand)[0]!.args[0].input).toEqual({
      GroupId: 'sg-box',
      SecurityGroupRuleIds: ['sgr-1'],
    });
    expect(ec2.commandCalls(DeleteSecurityGroupCommand)).toHaveLength(2);
    expect(iam.commandCalls(DeleteRoleCommand)).toHaveLength(1);
  });
});
