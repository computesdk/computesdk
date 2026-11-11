import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // picocolors turns colour on under CI (`CI` set) and off on a plain
    // terminal, so the human-output assertions would see ANSI codes in CI
    // only. NO_COLOR wins over CI, so tests read the same text everywhere.
    env: { NO_COLOR: '1' },
  },
});
