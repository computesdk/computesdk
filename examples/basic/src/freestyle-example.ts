/**
 * Freestyle Provider Example
 * 
 * This example shows how to use the Freestyle provider for Node.js code execution
 * with filesystem support and git repository integration.
 */

import { freestyle } from '@computesdk/freestyle';
import { config } from 'dotenv';
config(); // Load environment variables from .env file

async function main() {
  if (!process.env.FREESTYLE_API_KEY) {
    console.error('Please set FREESTYLE_API_KEY environment variable');
    process.exit(1);
  }

  try {
    // Create git repository first (required for Freestyle)
    console.log('Creating git repository...');
    const tempSandbox = freestyle();
    
    const { repoId } = await tempSandbox.createGitRepository({
      name: "Test Repository",
      public: true,
      source: {
        url: "https://github.com/freestyle-sh/freestyle-next",
        type: "git",
      },
    });

    // Create Freestyle sandbox with repository
    const sandbox = freestyle({
      repoId: repoId,
      runtime: 'node',
    });

    console.log('Created Freestyle sandbox:', sandbox.sandboxId);

    // Execute Node.js code
    const result = await sandbox.execute(`
console.log("Node.js version:", process.version);
console.log("Hello from Freestyle!");

// Calculate fibonacci
function fibonacci(n) {
    if (n <= 1) {
        return n;
    }
    return fibonacci(n-1) + fibonacci(n-2);
}

for (let i = 0; i < 5; i++) {
    console.log(\`fibonacci(\${i}) = \${fibonacci(i)}\`);
}
    `, 'node');

    console.log('Output:', result.stdout);
    console.log('Execution time:', result.executionTime, 'ms');

    // Filesystem operations
    console.log('\n--- Filesystem Operations ---');

    // Write and execute a JavaScript script
    await sandbox.filesystem.writeFile('/tmp/script.js', `
function greet(name) {
    return \`Hello, \${name}!\`;
}

console.log(greet("Freestyle"));
console.log("This script was written via filesystem!");
    `);

    // Check if file exists and execute
    const fileCheck = await sandbox.execute(`
const fs = require('fs');
const path = '/tmp/script.js';

if (fs.existsSync(path)) {
    console.log("File exists, executing...");
    const code = fs.readFileSync(path, 'utf8');
    eval(code);
} else {
    console.log("File not found at /tmp/script.js");
    console.log("Files in /tmp:", fs.readdirSync('/tmp'));
}
    `, 'node');
    console.log('Script execution:', fileCheck.stdout);

    // Create directory and list files
    await sandbox.filesystem.mkdir('/tmp/data');
    const files = await sandbox.filesystem.readdir('/tmp');
    console.log('Files in /tmp:', files.map(f => f.name));

    // Repository access
    console.log('\n--- Repository Access ---');
    
    const repoResult = await sandbox.execute(`
const fs = require('fs');
console.log("Repository files in /template:");
try {
    const files = fs.readdirSync("/template");
    const sortedFiles = files.sort().slice(0, 5);
    sortedFiles.forEach(f => console.log(\`  \${f}\`));
    console.log(\`Total files: \${files.length}\`);
} catch (error) {
    console.log(\`Error accessing repository: \${error.message}\`);
}
    `, 'node');
    
    console.log('Repository files:', repoResult.stdout);

    // Data processing example (using built-in Node.js)
    console.log('\n--- Data Processing ---');
    
    const dataResult = await sandbox.execute(`
// Create sample data
const data = {
    users: [
        { name: 'Alice', age: 30, city: 'New York' },
        { name: 'Bob', age: 25, city: 'San Francisco' },
        { name: 'Charlie', age: 35, city: 'Chicago' }
    ]
};

console.log("Sample data:");
console.log(JSON.stringify(data, null, 2));

// Process data
const totalAge = data.users.reduce((sum, user) => sum + user.age, 0);
const avgAge = totalAge / data.users.length;
const cities = data.users.map(user => user.city);
const uniqueCities = [...new Set(cities)];

console.log("\\nAnalysis:");
console.log(\`Total users: \${data.users.length}\`);
console.log(\`Average age: \${avgAge.toFixed(1)}\`);
console.log(\`Cities: \${uniqueCities.join(', ')}\`);
console.log(\`Processed at: \${new Date().toISOString()}\`);
    `, 'node');
    
    console.log('Data Processing Output:', dataResult.stdout);

    // Clean up
    await sandbox.kill();
    console.log('\nSandbox cleaned up successfully');

  } catch (error) {
    console.error('Error:', error.message);
    if (error.message.includes('API key')) {
      console.error('Get your Freestyle API key from https://freestyle.sh/');
    }
  }
}

main();