# Vercel

Vercel provider for ComputeSDK - Execute code in globally distributed serverless environments.

## Installation

```bash
npm install @computesdk/vercel
```

## Usage

### With ComputeSDK

```typescript
import { createCompute } from 'computesdk';
import { vercel } from '@computesdk/vercel';

// Set as default provider
const compute = createCompute({ 
  defaultProvider: vercel({ runtime: 'node' }) 
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Get instance
const instance = sandbox.getInstance();

// Execute code
const result = await sandbox.runCode('console.log("Hello from Vercel!")');
console.log(result.stdout); // "Hello from Vercel!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

### Direct Usage

```typescript
import { vercel } from '@computesdk/vercel';

// Create provider
const provider = vercel({ 
  runtime: 'python',
  timeout: 1800000  // 30 minutes
});

// Use with compute singleton
const sandbox = await compute.sandbox.create({ provider });
```

## Configuration

### Environment Variables

```bash
# Option 1: OIDC Token (Recommended)
export VERCEL_OIDC_TOKEN=your_oidc_token_here

# Option 2: Traditional Token
export VERCEL_TOKEN=your_vercel_token_here
export VERCEL_TEAM_ID=your_team_id_here
export VERCEL_PROJECT_ID=your_project_id_here
```

### Configuration Options

```typescript
interface VercelConfig {
  /** Runtime environment */
  runtime: 'node' | 'python';
  /** Vercel token - if not provided, will use env vars */
  token?: string;
  /** Team ID for team accounts */
  teamId?: string;
  /** Project ID */
  projectId?: string;
  /** Use OIDC authentication */
  useOIDC?: boolean;
  /** Deployment region */
  region?: string;
  /** Memory allocation in MB */
  memory?: number;
  /** Execution timeout in milliseconds */
  timeout?: number;
}
```

## API Reference

### Code Execution

```typescript
// Execute Node.js code
const result = await sandbox.runCode(`
const data = { message: "Hello from Node.js", timestamp: Date.now() };
console.log(JSON.stringify(data));
`, 'node');

// Execute Python code  
const result = await sandbox.runCode(`
import json
from datetime import datetime
data = {"message": "Hello from Python", "timestamp": datetime.now().isoformat()}
print(json.dumps(data))
`, 'python');

// Auto-detection (based on code patterns)
const result = await sandbox.runCode('print("Auto-detected as Python")');
```

### Command Execution

```typescript
// List files
const result = await sandbox.runCommand('ls', ['-la']);

// Install Node.js packages
const result = await sandbox.runCommand('npm', ['install', 'lodash']);

// Install Python packages
const result = await sandbox.runCommand('pip', ['install', 'requests']);

// Run scripts
const result = await sandbox.runCommand('node', ['script.js']);
```

### Filesystem Operations

```typescript
// Write file
await sandbox.filesystem.writeFile('/tmp/data.json', '{"hello": "world"}');

// Read file
const content = await sandbox.filesystem.readFile('/tmp/data.json');

// Create directory
await sandbox.filesystem.mkdir('/tmp/project');

// List directory contents
const files = await sandbox.filesystem.readdir('/tmp');

// Check if file exists
const exists = await sandbox.filesystem.exists('/tmp/data.json');

// Remove file or directory
await sandbox.filesystem.remove('/tmp/data.json');
```

### Sandbox Management

```typescript
// Get sandbox info
const info = await sandbox.getInfo();
console.log(info.id, info.provider, info.status);

// List all sandboxes
const sandboxes = await compute.sandbox.list();

// Get existing sandbox
const existing = await compute.sandbox.getById('sandbox-id');

// Destroy sandbox
await compute.sandbox.destroy('sandbox-id');
```

## Runtime Detection

The provider automatically detects the runtime based on code patterns:

**Python indicators:**
- `print(` statements
- `import` statements  
- `def` function definitions
- Python-specific syntax (`f"`, `__`, etc.)

**Default:** Node.js for all other cases

## Error Handling

```typescript
try {
  const result = await sandbox.runCode('invalid code');
} catch (error) {
  if (error.message.includes('Syntax error')) {
    console.error('Code has syntax errors');
  } else if (error.message.includes('authentication failed')) {
    console.error('Check your Vercel credentials');
  } else if (error.message.includes('quota exceeded')) {
    console.error('Vercel usage limits reached');
  } else if (error.message.includes('timeout')) {
    console.error('Execution timed out (max 45 minutes)');
  }
}
```

## Web Framework Integration

Use with web frameworks via the request handler:

```typescript
import { handleComputeRequest } from 'computesdk';
import { vercel } from '@computesdk/vercel';

export async function POST(request: Request) {
  return handleComputeRequest({
    request,
    provider: vercel({ runtime: 'node' })
  });
}
```

## Examples

### API Development

```typescript
const result = await sandbox.runCode(`
const http = require('http');
const url = require('url');

// Create a simple API handler
function handleRequest(req, res) {
  const parsedUrl = url.parse(req.url, true);
  
  if (parsedUrl.pathname === '/api/data') {
    const data = {
      message: "Hello from Vercel API",
      timestamp: new Date().toISOString(),
      query: parsedUrl.query
    };
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
}

// Test the handler
const mockReq = { url: '/api/data?user=alice' };
const mockRes = {
  statusCode: null,
  headers: {},
  data: '',
  writeHead(code, headers) { this.statusCode = code; Object.assign(this.headers, headers); },
  end(data) { this.data = data; }
};

handleRequest(mockReq, mockRes);
console.log('Status:', mockRes.statusCode);
console.log('Response:', mockRes.data);
`, 'node');

console.log(result.stdout);
```

### Data Processing

```typescript
const result = await sandbox.runCode(`
import json
import statistics
from datetime import datetime, timedelta

# Generate sample sales data
def generate_sales_data(days=7):
    import random
    random.seed(42)
    
    products = ['Laptop', 'Mouse', 'Keyboard', 'Monitor']
    sales = []
    
    for day in range(days):
        date = (datetime.now() - timedelta(days=days-day-1)).strftime('%Y-%m-%d')
        daily_sales = random.randint(5, 15)
        
        for _ in range(daily_sales):
            sale = {
                'date': date,
                'product': random.choice(products),
                'price': round(random.uniform(20, 500), 2),
                'quantity': random.randint(1, 3)
            }
            sale['total'] = round(sale['price'] * sale['quantity'], 2)
            sales.append(sale)
    
    return sales

# Process data
sales = generate_sales_data(7)
print(f"Generated {len(sales)} sales records")

# Calculate metrics
total_revenue = sum(sale['total'] for sale in sales)
avg_order_value = statistics.mean(sale['total'] for sale in sales)
product_sales = {}

for sale in sales:
    product = sale['product']
    if product not in product_sales:
        product_sales[product] = {'count': 0, 'revenue': 0}
    product_sales[product]['count'] += sale['quantity']
    product_sales[product]['revenue'] += sale['total']

# Results
results = {
    'total_sales': len(sales),
    'total_revenue': round(total_revenue, 2),
    'avg_order_value': round(avg_order_value, 2),
    'top_product': max(product_sales.keys(), key=lambda x: product_sales[x]['revenue']),
    'product_breakdown': product_sales
}

print("Sales Analysis Results:")
print(json.dumps(results, indent=2))
`);

console.log(result.stdout);
```

### Long-Running Task

```typescript
// Configure for extended execution (up to 45 minutes)
const sandbox = await compute.sandbox.create({
  options: {
    timeout: 2700000,  // 45 minutes
    memory: 1024       // 1GB memory
  }
});

const result = await sandbox.runCode(`
import time
import json
from datetime import datetime

def long_running_analysis():
    print("Starting long-running data analysis...")
    
    # Simulate processing batches of data
    total_batches = 50
    batch_size = 1000
    results = []
    
    for batch_num in range(total_batches):
        # Simulate data processing
        batch_start = time.time()
        
        # Process batch (simulate work)
        processed_items = []
        for i in range(batch_size):
            # Simple computation
            value = (batch_num * batch_size + i) ** 0.5
            processed_items.append(value)
        
        batch_time = time.time() - batch_start
        
        batch_result = {
            'batch': batch_num + 1,
            'items_processed': len(processed_items),
            'avg_value': sum(processed_items) / len(processed_items),
            'processing_time': round(batch_time, 4)
        }
        
        results.append(batch_result)
        
        # Progress update every 10 batches
        if (batch_num + 1) % 10 == 0:
            print(f"Completed {batch_num + 1}/{total_batches} batches")
        
        # Small delay to simulate real work
        time.sleep(0.1)
    
    # Final summary
    total_items = sum(r['items_processed'] for r in results)
    total_time = sum(r['processing_time'] for r in results)
    
    summary = {
        'total_batches': total_batches,
        'total_items': total_items,
        'total_processing_time': round(total_time, 2),
        'avg_batch_time': round(total_time / total_batches, 4),
        'completed_at': datetime.now().isoformat()
    }
    
    print("\\nAnalysis Complete!")
    print(f"Processed {total_items:,} items in {summary['total_processing_time']} seconds")
    
    return summary

# Run the analysis
result = long_running_analysis()
print("\\nFinal Summary:", json.dumps(result, indent=2))
`);

console.log(result.stdout);
```

### Multi-Region Deployment

```typescript
// Deploy to different regions
const regions = ['iad1', 'sfo1', 'fra1'];

const results = await Promise.all(
  regions.map(async (region) => {
    const sandbox = await compute.sandbox.create({
      provider: vercel({ 
        runtime: 'node',
        region: region,
        memory: 512
      })
    });
    
    const result = await sandbox.runCode(`
console.log('Region:', '${region}');
console.log('Timestamp:', new Date().toISOString());

// Simple performance test
const start = Date.now();
const data = Array.from({length: 10000}, (_, i) => Math.sin(i));
const sum = data.reduce((a, b) => a + b, 0);
const end = Date.now();

const results = {
  region: '${region}',
  processing_time: end - start,
  data_points: data.length,
  sum: sum.toFixed(4)
};

console.log('Results:', JSON.stringify(results));
    `);
    
    await compute.sandbox.destroy(sandbox.sandboxId);
    return result.stdout;
  })
);

results.forEach((output, index) => {
  console.log(`\nRegion ${regions[index]} output:`, output);
});
```