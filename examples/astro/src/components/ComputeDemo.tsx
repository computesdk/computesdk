import { useCompute } from '@computesdk/ui';
import { useState } from 'react';

export default function ComputeDemo() {
  const [output, setOutput] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const compute = useCompute({ apiEndpoint: '/api/compute' });

  const runCode = async () => {
    setLoading(true);
    try {
      const sandbox = await compute.sandbox.create();
      const result = await sandbox.runCode('print("Hello from ComputeSDK!")');
      setOutput(result.result?.stdout || 'No output');
      await sandbox.destroy();
    } catch (error: any) {
      setOutput(`Error: ${error.message}`);
    }
    setLoading(false);
  };

  return (
    <div>
      <button onClick={runCode} disabled={loading}>
        {loading ? 'Running...' : 'Run Code'}
      </button>
      {output && (
        <pre style={{ marginTop: '1rem', padding: '1rem', background: '#f5f5f5' }}>
          {output}
        </pre>
      )}
    </div>
  );
}