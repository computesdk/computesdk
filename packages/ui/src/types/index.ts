export type Runtime = 'python' | 'javascript';

export interface ExecutionResult {
  success: boolean;
  result?: {
    output: string;
    error?: string;
    executionTime: number;
    provider: string;
  };
  error?: string;
}

export interface ExecutionState {
  code: string
  runtime: Runtime
  isExecuting: boolean
  result: ExecutionResult | null
  error: string | null
}

export interface CodeExecutionHook {
  subscribe: (listener: () => void) => () => void
  getState: () => ExecutionState
  executeCode: (apiEndpoint?: string) => Promise<void>
  setCode: (code: string) => void
  setRuntime: (runtime: Runtime) => void
  clearResult: () => void
}

export interface CodeEditorConfig {
  apiEndpoint: string;
  defaultCode?: string;
  defaultRuntime?: Runtime;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export interface Theme {
  colors: {
    primary: string;
    secondary: string;
    success: string;
    error: string;
    warning: string;
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
    border: string;
  };
  spacing: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
  typography: {
    fontFamily: string;
    fontMono: string;
    fontSize: {
      sm: string;
      base: string;
      lg: string;
      xl: string;
    };
  };
  borderRadius: {
    sm: string;
    md: string;
    lg: string;
  };
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface ExecutionOptions {
  timeout?: number;
  retries?: number;
  validateInput?: boolean;
}