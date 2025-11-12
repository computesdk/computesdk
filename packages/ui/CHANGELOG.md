# @computesdk/ui

## 0.7.0

### Minor Changes

- 99b807c: Integrating packages w/ @computesdk/client

## 0.6.0

### Minor Changes

- fdb1271: Releasing sandbox instances via getInstance method

## 0.5.0

### Minor Changes

- d3ec023: improving core SDK to use provider factory methods
- 1302a77: feat: initial release

## 0.2.1

### Patch Changes

- Add comprehensive README documentation with usage examples for all framework adapters

## 0.2.0

### Minor Changes

- Add @computesdk/ui package with framework adapters for React, Vue, Svelte, and Vanilla JS

  This new package provides standardized UI components for code execution across all supported frameworks:

  - React adapter with hooks-based state management
  - Vue adapter with composables and reactive state
  - Svelte adapter with stores and reactive bindings
  - Vanilla JS adapter with DOM manipulation utilities

  Features:

  - Unified API across all frameworks
  - Built-in error handling and loading states
  - Configurable runtime selection (Python/JavaScript)
  - Responsive design with Tailwind CSS classes
  - Full TypeScript support (when types are enabled)
  - Comprehensive test coverage (45 tests, 91% coverage)

  All framework examples have been migrated to use these standardized components.
