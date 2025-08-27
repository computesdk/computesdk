import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.jsonc' },
			},
		},
	},
	esbuild: {
		target: 'esnext'
	},
	optimizeDeps: {
		include: [
			'@cloudflare/sandbox',
			'@cloudflare/containers',
			'@computesdk/cloudflare',
			'@computesdk/test-utils'
		]
	},
	ssr: {
		noExternal: [
			'@cloudflare/sandbox',
			'@cloudflare/containers'
		]
	}
});
