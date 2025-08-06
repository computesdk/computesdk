# ComputeSDK Test Structure

This document outlines the testing strategy and structure for the ComputeSDK monorepo.

## Test Framework

We use **Vitest** for all testing across packages because it:
- Has excellent TypeScript support
- Fast execution with native ESM support
- Built-in coverage reporting
- Easy mocking capabilities
- Great developer experience

## Test Structure

### Core Package Tests (`packages/core/src/__tests__/`)

1. **errors.test.ts** - Tests all error classes
2. **config.test.ts** - Tests configuration utilities and provider detection
3. **utils.test.ts** - Tests utility functions like `executeSandbox` and `retry`
4. **registry.test.ts** - Tests provider registry functionality
5. **sdk.test.ts** - Tests main SDK class and auto-detection
6. **providers/base.test.ts** - Tests base provider class

### Provider Package Tests

Each provider package has its own test suite:
- **E2B**: `packages/e2b/src/__tests__/index.test.ts`
- **Vercel**: `packages/vercel/src/__tests__/index.test.ts` (to be created)
- **Daytona**: `packages/daytona/src/__tests__/index.test.ts`

## Running Tests

### All Tests
```bash
# Run all tests across all packages
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage
```

### Individual Package Tests
```bash
# Core package only
cd packages/core && pnpm test

# E2B provider only
cd packages/e2b && pnpm test

# Daytona provider only
cd packages/daytona && pnpm test

# With coverage
cd packages/core && pnpm test:coverage
```

## Test Categories

### Unit Tests
- Test individual functions and classes in isolation
- Mock external dependencies (E2B SDK, Vercel API, Daytona API, etc.)
- Focus on business logic and edge cases

### Integration Tests
- Test provider implementations with real APIs (requires API keys)
- Test end-to-end workflows
- Test provider switching and registry functionality

### Mock Strategy

We mock external SDKs and APIs to ensure tests are:
- **Fast**: No network calls
- **Reliable**: No dependency on external services
- **Isolated**: Focus on our code, not third-party behavior

Example mocking pattern:
```typescript
// Mock E2B SDK
vi.mock('e2b', () => ({
  Sandbox: {
    create: vi.fn().mockResolvedValue(mockSandbox)
  }
}))
```

## Coverage Goals

- **Core Package**: 90%+ coverage
- **Provider Packages**: 85%+ coverage
- **Examples**: No coverage requirements (integration tests)

## Test Utilities

### Environment Variable Testing
```typescript
// Clean environment before each test
beforeEach(() => {
  vi.unstubAllEnvs()
})

// Stub environment variables
vi.stubEnv('E2B_API_KEY', 'test-key')
```

### Async Testing
```typescript
// Test timeout handling
await expect(provider.execute('long-running-code'))
  .rejects.toThrow('Execution timed out')

// Test retry logic
const result = await retry(flaky_function, { maxAttempts: 3 })
```

## Adding New Tests

When adding new functionality:

1. **Add unit tests** for new functions/classes
2. **Update existing tests** if changing interfaces
3. **Add integration tests** for new provider features
4. **Mock external dependencies** appropriately

## CI/CD Integration

Tests run on:
- Pull requests (all tests)
- Main branch pushes (all tests + coverage)
- Release builds (all tests + coverage + type checking)

## Test Commands Summary

```bash
# Development
pnpm test:watch           # Watch mode for active development
pnpm test                 # Run all tests once
pnpm test:coverage        # Run with coverage report

# Individual packages
cd packages/core && pnpm test
cd packages/e2b && pnpm test
cd packages/daytona && pnpm test

# Type checking
pnpm typecheck           # Check types across all packages

# Linting
pnpm lint               # Lint all packages
```