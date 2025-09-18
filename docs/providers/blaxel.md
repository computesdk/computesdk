# @computesdk/blaxel

Blaxel provider for ComputeSDK - Execute code with AI-powered assistance and ultra-fast 25ms boot times.

## Installation

```bash
npm install @computesdk/blaxel
```

## Usage

### With ComputeSDK

```typescript
import { createCompute } from 'computesdk';
import { blaxel } from '@computesdk/blaxel';

// Set as default provider
const compute = createCompute({ 
  defaultProvider: blaxel({ 
    apiKey: process.env.BLAXEL_API_KEY,
    workspace: process.env.BLAXEL_WORKSPACE
  }) 
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Get instance
const instance = sandbox.getInstance();

// Execute code
const result = await sandbox.runCode('print("Hello from Blaxel!")');
console.log(result.stdout); // "Hello from Blaxel!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

### Direct Usage

```typescript
import { blaxel } from '@computesdk/blaxel';

// Create provider
const provider = blaxel({ 
  apiKey: 'your-api-key',
  workspace: 'your-workspace',
  persistentStorage: true
});

// Use with compute singleton
const sandbox = await compute.sandbox.create({ provider });
```

## Configuration

### Environment Variables

```bash
export BLAXEL_API_KEY=your_blaxel_api_key_here
export BLAXEL_WORKSPACE=your_workspace_name_here
```

### Configuration Options

```typescript
interface BlaxelConfig {
  /** Blaxel API key - if not provided, will use BLAXEL_API_KEY env var */
  apiKey?: string;
  /** Workspace name - if not provided, will use BLAXEL_WORKSPACE env var */
  workspace?: string;
  /** Enable persistent storage across sessions */
  persistentStorage?: boolean;
  /** Enable AI code assistance */
  aiAssistance?: boolean;
  /** Auto-scale to zero after inactivity */
  autoScale?: boolean;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Base URL for Blaxel API */
  baseUrl?: string;
}
```

## API Reference

### Code Execution

```typescript
// Execute Python code with AI assistance
const result = await sandbox.runCode(`
import json
# AI helps optimize this code automatically
data = {"message": "AI-enhanced Python execution"}
print(json.dumps(data))
`, 'python');

// Execute Node.js code  
const result = await sandbox.runCode(`
const data = { message: "Hello from Node.js", aiPowered: true };
console.log(JSON.stringify(data));
`, 'node');

// Execute TypeScript code
const result = await sandbox.runCode(`
interface Message {
  text: string;
  timestamp: number;
}

const message: Message = {
  text: "TypeScript with AI assistance",
  timestamp: Date.now()
};

console.log(JSON.stringify(message));
`, 'typescript');

// Auto-detection (based on code patterns)
const result = await sandbox.runCode('print("Auto-detected as Python")');
```

### Command Execution

```typescript
// List files
const result = await sandbox.runCommand('ls', ['-la']);

// Install packages with AI suggestions
const result = await sandbox.runCommand('pip', ['install', 'pandas', 'numpy']);

// Run scripts
const result = await sandbox.runCommand('python', ['script.py']);
```

### Filesystem Operations

```typescript
// Write file (persists across sessions)
await sandbox.filesystem.writeFile('/persistent/data.py', 'print("Persistent file")');

// Read file
const content = await sandbox.filesystem.readFile('/persistent/data.py');

// Create directory
await sandbox.filesystem.mkdir('/persistent/project');

// List directory contents
const files = await sandbox.filesystem.readdir('/persistent');

// Check if file exists
const exists = await sandbox.filesystem.exists('/persistent/data.py');

// Remove file or directory
await sandbox.filesystem.remove('/persistent/data.py');
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

// Destroy sandbox (persistent data remains)
await compute.sandbox.destroy('sandbox-id');
```

## Runtime Detection

The provider automatically detects the runtime based on code patterns:

**Python indicators:**
- `print(` statements
- `import` statements  
- `def` function definitions
- Python-specific syntax (`f"`, `__`, etc.)

**TypeScript indicators:**
- `interface`, `type` declarations
- TypeScript-specific syntax (`:`, `<T>`, etc.)
- `export`, `import` with types

**Default:** Node.js for all other cases

## Error Handling

```typescript
try {
  const result = await sandbox.runCode('invalid code');
} catch (error) {
  if (error.message.includes('Syntax error')) {
    console.error('Code has syntax errors - AI can help fix this');
  } else if (error.message.includes('authentication failed')) {
    console.error('Check your BLAXEL_API_KEY and BLAXEL_WORKSPACE');
  } else if (error.message.includes('quota exceeded')) {
    console.error('Blaxel usage limits reached');
  }
}
```

## Web Framework Integration

Use with web frameworks via the request handler:

```typescript
import { handleComputeRequest } from 'computesdk';
import { blaxel } from '@computesdk/blaxel';

export async function POST(request: Request) {
  return handleComputeRequest({
    request,
    provider: blaxel({ 
      apiKey: process.env.BLAXEL_API_KEY,
      workspace: process.env.BLAXEL_WORKSPACE
    })
  });
}
```

## Examples

### AI-Powered Data Analysis

```typescript
const result = await sandbox.runCode(`
# AI Context: Analyze sales data and provide insights
import json
import statistics
from datetime import datetime

print("🤖 AI-Powered Data Analysis")
print("=" * 40)

# Sample sales data (AI helps optimize this structure)
sales_data = [
    {"date": "2023-12-01", "product": "Laptop", "amount": 1200, "region": "US"},
    {"date": "2023-12-01", "product": "Mouse", "amount": 50, "region": "EU"},
    {"date": "2023-12-02", "product": "Laptop", "amount": 1200, "region": "EU"},
    {"date": "2023-12-02", "product": "Keyboard", "amount": 80, "region": "US"},
    {"date": "2023-12-03", "product": "Monitor", "amount": 300, "region": "US"}
]

# AI-enhanced analysis
total_revenue = sum(sale["amount"] for sale in sales_data)
avg_sale = statistics.mean(sale["amount"] for sale in sales_data)

# Regional breakdown (AI suggests this analysis)
regional_sales = {}
for sale in sales_data:
    region = sale["region"]
    if region not in regional_sales:
        regional_sales[region] = {"count": 0, "total": 0}
    regional_sales[region]["count"] += 1
    regional_sales[region]["total"] += sale["amount"]

# AI-generated insights
print(f"Total Revenue: ${total_revenue}")
print(f"Average Sale: ${avg_sale:.2f}")
print(f"Total Transactions: {len(sales_data)}")

print("\\nRegional Performance:")
for region, stats in regional_sales.items():
    avg_regional = stats["total"] / stats["count"]
    print(f"  {region}: {stats['count']} sales, ${stats['total']} total, ${avg_regional:.2f} avg")

# AI confidence and recommendations
ai_insights = {
    "top_region": max(regional_sales.keys(), key=lambda x: regional_sales[x]["total"]),
    "best_product": max(set(sale["product"] for sale in sales_data), 
                       key=lambda x: sum(s["amount"] for s in sales_data if s["product"] == x)),
    "ai_confidence": 0.94
}

print(f"\\n🧠 AI Insights:")
print(f"  Top region: {ai_insights['top_region']}")
print(f"  Best product: {ai_insights['best_product']}")
print(f"  AI confidence: {ai_insights['ai_confidence']*100:.0f}%")

# Save results with AI metadata
results = {
    "analysis_type": "AI Sales Analysis",
    "total_revenue": total_revenue,
    "avg_sale": avg_sale,
    "regional_breakdown": regional_sales,
    "ai_insights": ai_insights,
    "generated_at": datetime.now().isoformat()
}

print("\\nFinal Results:", json.dumps(results, indent=2))
`);

console.log(result.stdout);
```

### TypeScript with AI Assistance

```typescript
const result = await sandbox.runCode(`
// AI-enhanced TypeScript execution
interface SalesRecord {
  id: string;
  productName: string;
  price: number;
  quantity: number;
  date: Date;
}

interface AnalysisResult {
  totalRevenue: number;
  averageOrderValue: number;
  topProduct: string;
  salesCount: number;
}

// AI helps with type-safe data generation
function generateSalesData(): SalesRecord[] {
  const products = ['Laptop', 'Mouse', 'Keyboard', 'Monitor', 'Tablet'];
  const sales: SalesRecord[] = [];
  
  for (let i = 1; i <= 10; i++) {
    sales.push({
      id: \`SALE-\${i.toString().padStart(3, '0')}\`,
      productName: products[Math.floor(Math.random() * products.length)],
      price: Math.round((Math.random() * 1000 + 50) * 100) / 100,
      quantity: Math.floor(Math.random() * 5) + 1,
      date: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000)
    });
  }
  
  return sales;
}

// AI-optimized analysis function
function analyzeSales(sales: SalesRecord[]): AnalysisResult {
  const totalRevenue = sales.reduce((sum, sale) => 
    sum + (sale.price * sale.quantity), 0
  );
  
  const averageOrderValue = totalRevenue / sales.length;
  
  // Find top product by revenue
  const productRevenue = new Map<string, number>();
  sales.forEach(sale => {
    const revenue = sale.price * sale.quantity;
    const currentRevenue = productRevenue.get(sale.productName) || 0;
    productRevenue.set(sale.productName, currentRevenue + revenue);
  });
  
  const topProduct = Array.from(productRevenue.entries())
    .sort(([,a], [,b]) => b - a)[0][0];
  
  return {
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    averageOrderValue: Math.round(averageOrderValue * 100) / 100,
    topProduct,
    salesCount: sales.length
  };
}

// Execute AI-enhanced analysis
console.log('🚀 AI-Enhanced TypeScript Analysis');
console.log('='.repeat(50));

const salesData = generateSalesData();
const analysis = analyzeSales(salesData);

console.log(\`📊 Analysis Results:\`);
console.log(\`Total Revenue: $\${analysis.totalRevenue}\`);
console.log(\`Average Order Value: $\${analysis.averageOrderValue}\`);
console.log(\`Top Product: \${analysis.topProduct}\`);
console.log(\`Total Sales: \${analysis.salesCount}\`);

// AI recommendation
const growthRate = analysis.averageOrderValue > 200 ? 'High' : 'Medium';
console.log(\`\\n🧠 AI Recommendation: \${growthRate} growth potential detected\`);

console.log('\\n✅ TypeScript analysis complete with AI assistance!');
`, 'typescript');

console.log(result.stdout);
```

### Persistent Storage Demo

```typescript
// Create sandbox with persistence
const sandbox = await compute.sandbox.create({
  options: { 
    persistent: true,
    aiContext: "data persistence workflow"
  }
});

// First execution - create persistent data
await sandbox.runCode(`
import json
import os
from datetime import datetime

# Create persistent directory structure
os.makedirs('/persistent/data', exist_ok=True)
os.makedirs('/persistent/models', exist_ok=True)

# Save session data
session_data = {
    "session_id": 1,
    "created_at": datetime.now().isoformat(),
    "message": "First session with AI assistance",
    "ai_enabled": True
}

with open('/persistent/data/session_log.json', 'w') as f:
    json.dump([session_data], f, indent=2)

print("✅ Session 1: Data saved to persistent storage")
print(f"Created session: {session_data['session_id']}")
`);

// Destroy and recreate sandbox (data persists)
await compute.sandbox.destroy(sandbox.sandboxId);

const newSandbox = await compute.sandbox.create({
  options: { persistent: true }
});

// Second execution - append to persistent data
await newSandbox.runCode(`
import json
from datetime import datetime

# Load existing data
with open('/persistent/data/session_log.json', 'r') as f:
    sessions = json.load(f)

# Add new session
new_session = {
    "session_id": len(sessions) + 1,
    "created_at": datetime.now().isoformat(),
    "message": "Data persisted across sandbox recreation!",
    "previous_sessions": len(sessions)
}

sessions.append(new_session)

# Save updated data
with open('/persistent/data/session_log.json', 'w') as f:
    json.dump(sessions, f, indent=2)

print(f"✅ Session {new_session['session_id']}: Found {len(sessions)-1} previous sessions")
print("📁 Persistent storage working correctly!")
print(f"Total sessions: {len(sessions)}")

# Display session history
print("\\nSession History:")
for session in sessions:
    print(f"  Session {session['session_id']}: {session['created_at']}")
`);
```

### Fast Iteration Development

```typescript
console.log('⚡ Demonstrating 25ms boot times...');

const iterations = 5;
const results = [];

for (let i = 1; i <= iterations; i++) {
  const startTime = Date.now();
  
  // Create sandbox
  const sandbox = await compute.sandbox.create();
  const bootTime = Date.now() - startTime;
  
  // Execute different AI-assisted tasks
  const result = await sandbox.runCode(`
print(f"⚡ Fast Iteration #{i} - Boot time: {bootTime}ms")
print("AI-powered execution ready!")

# Different AI task each iteration
tasks = {
    1: "Data validation with AI",
    2: "Algorithm optimization", 
    3: "Performance analysis",
    4: "Error pattern detection",
    5: "Code quality assessment"
}

current_task = tasks.get(${i}, "AI assistance")
print(f"🤖 Current AI task: {current_task}")

# Simulate AI work
import time
import random
work_time = random.uniform(0.05, 0.2)
time.sleep(work_time)

print(f"✅ Task completed in {work_time:.3f}s with AI assistance")
  `.replace('${i}', i.toString()).replace('{bootTime}', bootTime.toString()));
  
  const totalTime = Date.now() - startTime;
  
  results.push({
    iteration: i,
    bootTime,
    totalTime,
    output: result.stdout
  });
  
  console.log(`Iteration ${i}: Boot ${bootTime}ms, Total ${totalTime}ms`);
  console.log(result.stdout);
  
  await compute.sandbox.destroy(sandbox.sandboxId);
}

console.log(`\n📊 Average boot time: ${results.reduce((sum, r) => sum + r.bootTime, 0) / results.length}ms`);
```