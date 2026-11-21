/** AgentVM dedicated-machine provider (billable), NOT the pooled one-shot gVisor preview. */
import { defineProvider } from '@computesdk/provider';
import type { CreateInstanceOptions, RunCommandOptions } from '@computesdk/provider';
export interface AgentVMConfig {
  /** An AgentVM personal API key, from the account that will be billed. */
  apiKey?: string;
  /** Optional HTTPS API base URL, defaults to production. */
  endpoint?: string;
  /** Must be true to authorize billable dedicated-machine creation. */
  allowBillableCreate?: boolean;
  /** Explicit AgentVM machine creation payload: productId, provider, region, image and runtime budget. */
  machine?: Record<string, unknown>;
  /** Command status polling deadline. */
  operationTimeoutMs?: number;
}
export interface AgentVMInstance { id: string; client: Client; machine: Record<string, any>; }
const pause = (ms: number) => new Promise<void>(r => setTimeout(r,ms));
function getKey(c: AgentVMConfig): string {
  const key = c.apiKey ?? process.env.AGENTVM_API_KEY;
  if (!key) throw new Error('Set AGENTVM_API_KEY or pass apiKey to the AgentVM provider.');
  return key;
}
class Client {
  readonly base: string;
  constructor(readonly config: AgentVMConfig) {
    const u = new URL(config.endpoint ?? 'https://api.agentvm.sh/v1');
    if (u.protocol !== 'https:') throw new Error('AgentVM provider requires an HTTPS API endpoint.');
    this.base = u.toString().replace(/\/$/,'');
  }
  async call(method: string, path: string, body?: unknown): Promise<any> {
    const response = await fetch(`${this.base}${path}`, {
      method, headers: { authorization: `Bearer ${getKey(this.config)}`, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const data = await response.json().catch(() => ({})) as any;
    if (!response.ok) throw new Error(`AgentVM ${method} ${path.split('?')[0]} returned HTTP ${response.status}: ${String(data.code ?? 'api_error')}`);
    return data;
  }
}
function instanceOf(client: Client, record: Record<string, any>): AgentVMInstance {
  if (!record.id) throw new Error('AgentVM response did not include a machine ID.');
  return { id:String(record.id), client, machine:record };
}
export const agentvm = defineProvider<AgentVMInstance, AgentVMConfig>({
  name: 'agentvm',
  methods: { instances: {
    create: async (config: AgentVMConfig, _options?: CreateInstanceOptions) => {
      if (config.allowBillableCreate !== true) throw new Error('Billable AgentVM creation disabled. Set allowBillableCreate: true and provide an explicit machine specification.');
      // The AgentVM /compute/instances endpoint takes planId, not productId.
      // Require an explicit maximum lifetime so an accidental launch cannot run indefinitely.
      const machine = config.machine;
      if (!machine || !['provider','region','planId','imageId','publicKey'].every(key => typeof machine[key] === 'string' && String(machine[key]).trim())) {
        throw new Error('AgentVM machine requires explicit provider, region, planId, imageId and SSH publicKey.');
      }
      const lifetime = machine.maxRuntimeSeconds;
      if (typeof lifetime !== 'number' || !Number.isSafeInteger(lifetime) || lifetime < 300) {
        throw new Error('AgentVM machine requires maxRuntimeSeconds as an integer >= 300.');
      }
      if (_options && Object.keys(_options).some(key => key !== 'signal')) {
        throw new Error('AgentVM create options must be configured explicitly through the machine specification.');
      }
      const client = new Client(config);
      const result = await client.call('POST','/compute/instances',config.machine);
      const inst = instanceOf(client,result.instance);
      return { instance:inst, instanceId:inst.id };
    },
    getById: async (config:AgentVMConfig,id:string) => {
      const client = new Client(config);
      try {
        const result = await client.call('GET',`/compute/instances/${encodeURIComponent(id)}`);
        const inst = instanceOf(client,result.instance);
        return { instance:inst, instanceId:inst.id };
      } catch(e) { if (String(e).includes('HTTP 404')) return null; throw e; }
    },
    list: async (config:AgentVMConfig) => {
      const client = new Client(config);
      const result = await client.call('GET','/compute/instances');
      return (result.instances ?? []).map((row:Record<string,any>)=>{const inst=instanceOf(client,row);return {instance:inst,instanceId:inst.id};});
    },
    destroy: async (config:AgentVMConfig,id:string) => {
      if (config.allowBillableCreate !== true) throw new Error('Explicit machine lifecycle authorization required to destroy a machine.');
      await new Client(config).call('POST',`/compute/instances/${encodeURIComponent(id)}/destroy`,{});
    },
    runCommand: async (inst: AgentVMInstance, command:string, opts?:RunCommandOptions) => {
      // Includes API submission and asynchronous operation polling.
      const startedAt=Date.now();
      const id=encodeURIComponent(inst.id);
      const requested = await inst.client.call('POST',`/compute/instances/${id}/operations`,{
        operationType:'exec',command:['bash','-lc',command],cwd:opts?.cwd ?? '/home/user',env:opts?.env ?? {},
        timeoutSeconds: Math.max(1,Math.ceil(Number(opts?.timeout ?? 300000)/1000))
      });
      const opId=requested.operation?.id;
      if (!opId) throw new Error('AgentVM failed to issue command operation.');
      const deadline=Date.now()+Math.max(1000,inst.client.config.operationTimeoutMs ?? 390000);
      while (Date.now()<deadline) {
        const info = await inst.client.call('GET',`/compute/instances/${id}/operations/${encodeURIComponent(opId)}`);
        const op=info.operation ?? {};
        if (['completed','failed','canceled','expired'].includes(op.status)) {
          const output=op.result ?? {};
          return { stdout:String(output.stdout ?? ''),stderr:String(output.stderr ?? op.errorMessage ?? ''),exitCode:Number.isInteger(output.exitCode)?output.exitCode:(op.status==='completed'?0:1),durationMs:Date.now()-startedAt };
        }
        await pause(500);
      }
      // Cancel queued/running exec where possible rather than leaving a long task unobserved.
      await inst.client.call('POST',`/compute/instances/${id}/operations/${encodeURIComponent(opId)}/cancel`,{}).catch(()=>{});
      throw new Error('AgentVM command timed out waiting for its asynchronous operation; cancellation was requested.');
    },
    getInfo: async (inst:AgentVMInstance) => {
      const response=await inst.client.call('GET',`/compute/instances/${encodeURIComponent(inst.id)}`);
      const m=response.instance ?? inst.machine;
      // ComputeSDK expects milliseconds; 0 means no limit was reported by the API.
      const runtimeSeconds=Number(m.maxRuntimeSeconds);
      const timeoutMs=Number.isFinite(runtimeSeconds) && runtimeSeconds > 0 ? Math.round(runtimeSeconds*1000) : 0;
      return { id:inst.id,timeout:timeoutMs,status:['running','ready','active'].includes(String(m.status ?? m.state))?'running':['stopped','powered_off','suspended'].includes(String(m.status ?? m.state))?'stopped':'error',createdAt:new Date(m.createdAt ?? Date.now()),provider:'agentvm',metadata:{nativeStatus:String(m.status ?? m.state ?? 'unknown')} };
    },
    getUrl: async () => { throw new Error('AgentVM dedicated machines do not expose an arbitrary HTTP preview URL through this adapter.'); },
  } }
});
