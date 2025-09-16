# @computesdk/modal

Modal provider for ComputeSDK - Execute code with GPU support for machine learning workloads.

## Installation

```bash
npm install @computesdk/modal
```

## Usage

### With ComputeSDK

```typescript
import { createCompute } from 'computesdk';
import { modal } from '@computesdk/modal';

// Set as default provider
const compute = createCompute({ 
  defaultProvider: modal({ 
    tokenId: process.env.MODAL_TOKEN_ID,
    tokenSecret: process.env.MODAL_TOKEN_SECRET
  }) 
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Get instance
const instance = sandbox.getInstance();

// Execute code
const result = await sandbox.runCode('print("Hello from Modal!")');
console.log(result.stdout); // "Hello from Modal!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

### Direct Usage

```typescript
import { modal } from '@computesdk/modal';

// Create provider
const provider = modal({ 
  tokenId: 'your-token-id',
  tokenSecret: 'your-token-secret',
  gpu: 'T4'  // GPU type for ML workloads
});

// Use with compute singleton
const sandbox = await compute.sandbox.create({ provider });
```

## Configuration

### Environment Variables

```bash
export MODAL_TOKEN_ID=your_modal_token_id_here
export MODAL_TOKEN_SECRET=your_modal_token_secret_here
```

### Configuration Options

```typescript
interface ModalConfig {
  /** Modal token ID - if not provided, will use MODAL_TOKEN_ID env var */
  tokenId?: string;
  /** Modal token secret - if not provided, will use MODAL_TOKEN_SECRET env var */
  tokenSecret?: string;
  /** GPU type for ML workloads */
  gpu?: 'T4' | 'A10G' | 'A100';
  /** CPU count */
  cpu?: number;
  /** Memory allocation in GB */
  memory?: number;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Custom image for the environment */
  image?: string;
}
```

## API Reference

### Code Execution

```typescript
// Execute Python code with GPU support
const result = await sandbox.runCode(`
import torch
import numpy as np

print(f"PyTorch version: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")

if torch.cuda.is_available():
    print(f"GPU device: {torch.cuda.get_device_name()}")
    print(f"GPU memory: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")

# Simple tensor operations on GPU
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
x = torch.randn(1000, 1000, device=device)
y = torch.randn(1000, 1000, device=device)
z = torch.matmul(x, y)

print(f"Computed matrix multiplication on {device}")
print(f"Result shape: {z.shape}")
`, 'python');

// Machine learning workflow
const result = await sandbox.runCode(`
import torch
import torch.nn as nn
import numpy as np

# Simple neural network
class SimpleNet(nn.Module):
    def __init__(self):
        super(SimpleNet, self).__init__()
        self.fc1 = nn.Linear(10, 50)
        self.fc2 = nn.Linear(50, 1)
        self.relu = nn.ReLU()
    
    def forward(self, x):
        x = self.relu(self.fc1(x))
        return self.fc2(x)

# Create model and move to GPU if available
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
model = SimpleNet().to(device)

print(f"Model created on {device}")
print(f"Total parameters: {sum(p.numel() for p in model.parameters())}")
`);
```

### Command Execution

```typescript
// Install additional packages
const result = await sandbox.runCommand('pip', ['install', 'transformers', 'datasets']);

// Check GPU status
const result = await sandbox.runCommand('nvidia-smi');

// Run Python scripts
const result = await sandbox.runCommand('python', ['train_model.py']);
```

### Filesystem Operations

```typescript
// Write training script
await sandbox.filesystem.writeFile('/workspace/train.py', `
import torch
import torch.nn as nn
import torch.optim as optim

# Your ML training code here
print("Training script created")
`);

// Read model file
const modelCode = await sandbox.filesystem.readFile('/workspace/model.py');

// Create directories for ML project
await sandbox.filesystem.mkdir('/workspace/data');
await sandbox.filesystem.mkdir('/workspace/models');
await sandbox.filesystem.mkdir('/workspace/logs');

// List files
const files = await sandbox.filesystem.readdir('/workspace');

// Check if model exists
const exists = await sandbox.filesystem.exists('/workspace/model.pth');

// Remove temporary files
await sandbox.filesystem.remove('/workspace/temp_data.pkl');
```

### Sandbox Management

```typescript
// Get sandbox info (including GPU allocation)
const info = await sandbox.getInfo();
console.log(info.id, info.provider, info.gpu, info.memory);

// List all sandboxes
const sandboxes = await compute.sandbox.list();

// Get existing sandbox
const existing = await compute.sandbox.getById('sandbox-id');

// Destroy sandbox
await compute.sandbox.destroy('sandbox-id');
```

## Error Handling

```typescript
try {
  const result = await sandbox.runCode('invalid code');
} catch (error) {
  if (error.message.includes('CUDA out of memory')) {
    console.error('GPU memory insufficient - reduce batch size');
  } else if (error.message.includes('authentication failed')) {
    console.error('Check your MODAL_TOKEN_ID and MODAL_TOKEN_SECRET');
  } else if (error.message.includes('quota exceeded')) {
    console.error('Modal usage limits reached');
  }
}
```

## Web Framework Integration

Use with web frameworks via the request handler:

```typescript
import { handleComputeRequest } from 'computesdk';
import { modal } from '@computesdk/modal';

export async function POST(request: Request) {
  return handleComputeRequest({
    request,
    provider: modal({ 
      tokenId: process.env.MODAL_TOKEN_ID,
      tokenSecret: process.env.MODAL_TOKEN_SECRET,
      gpu: 'T4'
    })
  });
}
```

## Examples

### Machine Learning Training

```typescript
const result = await sandbox.runCode(`
import torch
import torch.nn as nn
import torch.optim as optim
import numpy as np
from torch.utils.data import DataLoader, TensorDataset

print("🤖 Machine Learning Training on GPU")
print("=" * 50)

# Check GPU availability
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
print(f"Using device: {device}")

if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name()}")
    print(f"Memory: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")

# Generate synthetic dataset
np.random.seed(42)
torch.manual_seed(42)

# Binary classification problem
n_samples = 10000
n_features = 20

X = torch.randn(n_samples, n_features)
# Create non-linear relationship
y = (X[:, 0] * X[:, 1] + X[:, 2]**2 > 0).float().unsqueeze(1)

# Split data
train_size = int(0.8 * n_samples)
X_train, X_test = X[:train_size], X[train_size:]
y_train, y_test = y[:train_size], y[train_size:]

print(f"Training samples: {len(X_train)}")
print(f"Test samples: {len(X_test)}")

# Create data loaders
train_dataset = TensorDataset(X_train, y_train)
test_dataset = TensorDataset(X_test, y_test)
train_loader = DataLoader(train_dataset, batch_size=32, shuffle=True)
test_loader = DataLoader(test_dataset, batch_size=32)

# Define model
class MLPClassifier(nn.Module):
    def __init__(self, input_size, hidden_size=64):
        super(MLPClassifier, self).__init__()
        self.network = nn.Sequential(
            nn.Linear(input_size, hidden_size),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(hidden_size, hidden_size),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(hidden_size, 1),
            nn.Sigmoid()
        )
    
    def forward(self, x):
        return self.network(x)

# Initialize model
model = MLPClassifier(n_features).to(device)
criterion = nn.BCELoss()
optimizer = optim.Adam(model.parameters(), lr=0.001)

print(f"Model parameters: {sum(p.numel() for p in model.parameters()):,}")

# Training loop
num_epochs = 10
for epoch in range(num_epochs):
    model.train()
    train_loss = 0
    correct = 0
    total = 0
    
    for batch_X, batch_y in train_loader:
        batch_X, batch_y = batch_X.to(device), batch_y.to(device)
        
        optimizer.zero_grad()
        outputs = model(batch_X)
        loss = criterion(outputs, batch_y)
        loss.backward()
        optimizer.step()
        
        train_loss += loss.item()
        predicted = (outputs > 0.5).float()
        total += batch_y.size(0)
        correct += (predicted == batch_y).sum().item()
    
    train_acc = 100 * correct / total
    
    # Evaluation
    model.eval()
    test_correct = 0
    test_total = 0
    
    with torch.no_grad():
        for batch_X, batch_y in test_loader:
            batch_X, batch_y = batch_X.to(device), batch_y.to(device)
            outputs = model(batch_X)
            predicted = (outputs > 0.5).float()
            test_total += batch_y.size(0)
            test_correct += (predicted == batch_y).sum().item()
    
    test_acc = 100 * test_correct / test_total
    
    print(f"Epoch {epoch+1}/{num_epochs}: Train Acc: {train_acc:.2f}%, Test Acc: {test_acc:.2f}%")

print("\\n✅ Training completed!")
print(f"Final test accuracy: {test_acc:.2f}%")

# Save model
torch.save(model.state_dict(), '/workspace/model.pth')
print("Model saved to /workspace/model.pth")
`);

console.log(result.stdout);
```

### Computer Vision with GPU

```typescript
const result = await sandbox.runCode(`
import torch
import torchvision
import torchvision.transforms as transforms
import torch.nn as nn
import numpy as np
from PIL import Image

print("🖼️ Computer Vision with GPU")
print("=" * 40)

# Check GPU
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
print(f"Device: {device}")

# Create synthetic image data (since we don't have real dataset)
def create_synthetic_images(num_images=1000, size=(3, 32, 32)):
    """Create synthetic RGB images"""
    images = torch.randn(num_images, *size)
    # Create labels (10 classes like CIFAR-10)
    labels = torch.randint(0, 10, (num_images,))
    return images, labels

# Generate data
print("Generating synthetic image dataset...")
train_images, train_labels = create_synthetic_images(8000)
test_images, test_labels = create_synthetic_images(2000)

print(f"Train images: {train_images.shape}")
print(f"Test images: {test_images.shape}")

# Simple CNN model
class SimpleCNN(nn.Module):
    def __init__(self, num_classes=10):
        super(SimpleCNN, self).__init__()
        self.features = nn.Sequential(
            nn.Conv2d(3, 32, 3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(32, 64, 3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(64, 128, 3, padding=1),
            nn.ReLU(),
            nn.AdaptiveAvgPool2d((4, 4))
        )
        
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Linear(128 * 4 * 4, 256),
            nn.ReLU(),
            nn.Dropout(0.5),
            nn.Linear(256, num_classes)
        )
    
    def forward(self, x):
        x = self.features(x)
        x = self.classifier(x)
        return x

# Initialize model
model = SimpleCNN().to(device)
criterion = nn.CrossEntropyLoss()
optimizer = torch.optim.Adam(model.parameters(), lr=0.001)

print(f"\\nModel created with {sum(p.numel() for p in model.parameters()):,} parameters")

# Training
num_epochs = 5
batch_size = 64

for epoch in range(num_epochs):
    model.train()
    running_loss = 0.0
    correct = 0
    total = 0
    
    # Mini-batch training
    for i in range(0, len(train_images), batch_size):
        batch_images = train_images[i:i+batch_size].to(device)
        batch_labels = train_labels[i:i+batch_size].to(device)
        
        optimizer.zero_grad()
        outputs = model(batch_images)
        loss = criterion(outputs, batch_labels)
        loss.backward()
        optimizer.step()
        
        running_loss += loss.item()
        _, predicted = torch.max(outputs.data, 1)
        total += batch_labels.size(0)
        correct += (predicted == batch_labels).sum().item()
    
    train_acc = 100 * correct / total
    
    # Test evaluation
    model.eval()
    test_correct = 0
    test_total = 0
    
    with torch.no_grad():
        for i in range(0, len(test_images), batch_size):
            batch_images = test_images[i:i+batch_size].to(device)
            batch_labels = test_labels[i:i+batch_size].to(device)
            
            outputs = model(batch_images)
            _, predicted = torch.max(outputs, 1)
            test_total += batch_labels.size(0)
            test_correct += (predicted == batch_labels).sum().item()
    
    test_acc = 100 * test_correct / test_total
    
    print(f"Epoch {epoch+1}: Train Acc: {train_acc:.2f}%, Test Acc: {test_acc:.2f}%")

print("\\n✅ Computer vision training completed!")

# GPU memory info
if torch.cuda.is_available():
    print(f"\\n📊 GPU Memory Usage:")
    print(f"Allocated: {torch.cuda.memory_allocated() / 1e9:.2f} GB")
    print(f"Cached: {torch.cuda.memory_reserved() / 1e9:.2f} GB")
`);

console.log(result.stdout);
```

### Natural Language Processing

```typescript
const result = await sandbox.runCode(`
import torch
import torch.nn as nn
import numpy as np
from collections import Counter
import re

print("🔤 Natural Language Processing with GPU")
print("=" * 50)

device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
print(f"Device: {device}")

# Sample text data
texts = [
    "Natural language processing is fascinating",
    "Machine learning models can understand text",
    "Deep learning transforms how we process language",
    "Neural networks excel at text classification",
    "GPU acceleration makes training faster",
    "Transformers revolutionized NLP applications",
    "Text analysis requires careful preprocessing",
    "Language models learn from vast datasets"
]

labels = [1, 1, 1, 1, 0, 1, 0, 1]  # Binary sentiment: 1=positive, 0=neutral

print(f"Dataset: {len(texts)} texts")

# Simple tokenization and vocabulary
def tokenize(text):
    return re.findall(r'\\b\\w+\\b', text.lower())

# Build vocabulary
all_tokens = []
for text in texts:
    all_tokens.extend(tokenize(text))

vocab = {word: i for i, word in enumerate(set(all_tokens))}
vocab_size = len(vocab)
print(f"Vocabulary size: {vocab_size}")

# Convert texts to sequences
def text_to_sequence(text, vocab, max_len=20):
    tokens = tokenize(text)
    sequence = [vocab.get(token, 0) for token in tokens]
    # Pad or truncate
    if len(sequence) < max_len:
        sequence.extend([0] * (max_len - len(sequence)))
    else:
        sequence = sequence[:max_len]
    return sequence

sequences = [text_to_sequence(text, vocab) for text in texts]
X = torch.tensor(sequences, dtype=torch.long)
y = torch.tensor(labels, dtype=torch.float32)

print(f"Input shape: {X.shape}")

# Simple LSTM model for text classification
class TextLSTM(nn.Module):
    def __init__(self, vocab_size, embed_dim=64, hidden_dim=32):
        super(TextLSTM, self).__init__()
        self.embedding = nn.Embedding(vocab_size, embed_dim)
        self.lstm = nn.LSTM(embed_dim, hidden_dim, batch_first=True)
        self.classifier = nn.Linear(hidden_dim, 1)
        self.sigmoid = nn.Sigmoid()
    
    def forward(self, x):
        embedded = self.embedding(x)  # (batch, seq_len, embed_dim)
        lstm_out, (hidden, _) = self.lstm(embedded)
        # Use last hidden state
        output = self.classifier(hidden[-1])  # (batch, 1)
        return self.sigmoid(output)

# Initialize model
model = TextLSTM(vocab_size + 1).to(device)  # +1 for padding token
criterion = nn.BCELoss()
optimizer = torch.optim.Adam(model.parameters(), lr=0.01)

print(f"Model parameters: {sum(p.numel() for p in model.parameters())}")

# Training (on small dataset, so many epochs)
X, y = X.to(device), y.to(device).unsqueeze(1)

num_epochs = 100
for epoch in range(num_epochs):
    model.train()
    optimizer.zero_grad()
    
    outputs = model(X)
    loss = criterion(outputs, y)
    loss.backward()
    optimizer.step()
    
    if (epoch + 1) % 20 == 0:
        model.eval()
        with torch.no_grad():
            predictions = model(X)
            predicted = (predictions > 0.5).float()
            accuracy = (predicted == y).float().mean()
            print(f"Epoch {epoch+1}: Loss: {loss.item():.4f}, Accuracy: {accuracy.item():.2f}")

print("\\n✅ NLP training completed!")

# Test on new text
test_text = "GPU acceleration improves deep learning performance"
test_sequence = text_to_sequence(test_text, vocab)
test_tensor = torch.tensor([test_sequence], dtype=torch.long).to(device)

model.eval()
with torch.no_grad():
    prediction = model(test_tensor)
    sentiment = "Positive" if prediction.item() > 0.5 else "Neutral"
    
print(f"\\nTest prediction:")
print(f"Text: '{test_text}'")
print(f"Sentiment: {sentiment} (confidence: {prediction.item():.3f})")
`);

console.log(result.stdout);
```