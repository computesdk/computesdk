import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SandboxInstance } from '@blaxel/core';
import { blaxel } from '../index';

vi.mock('@blaxel/core', () => ({
	initialize: vi.fn(),
	SANDBOX_API_IMAGE: 'ghcr.io/blaxel-ai/sandbox',
	SANDBOX_API_PATH: '/usr/local/bin/sandbox-api',
	settings: { authenticate: vi.fn(async () => undefined), baseUrl: 'https://api.test/v0', headers: { 'X-Blaxel-Workspace': 'ws' } },
	SandboxInstance: {
		get: vi.fn(),
		delete: vi.fn(),
		createIfNotExists: vi.fn(),
	},
	Snapshot: {},
	VolumeInstance: {},
	getImage: vi.fn(),
	listImages: vi.fn(),
	listImageTags: vi.fn(),
	deleteImage: vi.fn(),
	deleteImageTag: vi.fn(),
}));

async function mockedCore() {
	return await import('@blaxel/core');
}

const notFound = { data: undefined, error: { code: 404 }, response: { status: 404 } };

type Tag = { name: string; createdAt?: string; updatedAt?: string };
type Event = { status: string; time: string; message?: string };

function image(status: string, tags: Tag[], events: Event[] = []) {
	return { data: { metadata: { name: 'img', resourceType: 'sandbox', status, events }, spec: { tags } }, error: undefined, response: { status: 200 } };
}

/** The image as Blaxel API 2026-09-22 returns it: a summary with a tag count, no tags. */
function summary(status: string, tagCount: number, events: Event[] = []) {
	return { data: { metadata: { name: 'img', resourceType: 'sandbox', status, events }, spec: { tagCount } }, error: undefined, response: { status: 200 } };
}

/** One page of `listImageTags`. */
function tagPage(tags: Tag[], nextCursor?: string) {
	return { data: { data: tags, meta: { hasMore: Boolean(nextCursor), ...(nextCursor && { nextCursor }) } }, error: undefined, response: { status: 200 } };
}

const built1 = { status: 'BUILT', time: '2026-11-08T00:00:10Z' };
const initiated2 = { status: 'CREATED', time: '2026-11-09T18:00:00Z' };
const built2 = { status: 'BUILT', time: '2026-11-09T18:00:10Z' };

const fetchMock = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers();
	vi.stubGlobal('fetch', fetchMock);
	fetchMock.mockImplementation(async (url: string) => String(url).endsWith('/images?upload=true')
		? new Response('{}', { status: 200, headers: { 'x-blaxel-upload-url': 'https://upload.test/ctx' } })
		: new Response('', { status: 200 }));
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

/** template.create with its poll timers run; a rejection is handled from the start. */
async function create(options: Record<string, unknown>) {
	const settled = blaxel({}).template!.create(options as never).then(
		value => ({ value, error: undefined }),
		error => ({ value: undefined, error }),
	);
	await vi.runAllTimersAsync();
	const { value, error } = await settled;
	if (error) throw error;
	return value;
}

describe('blaxel template.create', () => {
	it('uploads a Dockerfile that adds the sandbox API, waits for the build and returns the image ref', async () => {
		const core = await mockedCore();
		vi.mocked(core.getImage)
			.mockResolvedValueOnce(notFound as never)
			.mockResolvedValueOnce(image('BUILDING', [], [initiated2]) as never)
			.mockResolvedValueOnce(image('BUILT', [{ name: 'b0031c', createdAt: '2026-11-09T18:00:10Z' }], [initiated2, built2]) as never);
		const statuses: string[] = [];

		const template = await create({ name: 'oci-base', image: 'ubuntu:24.04', onStatusChange: (s: string) => statuses.push(s) });

		expect(template).toMatchObject({ id: expect.stringMatching(/^sandbox\/oci-base-[0-9a-f]{8}:b0031c$/), provider: 'blaxel' });
		expect(template.id).toBe(`sandbox/${template.name}:b0031c`);
		expect(statuses).toEqual(['BUILDING', 'BUILT']);
		const [postUrl, post] = fetchMock.mock.calls[0];
		expect(postUrl).toBe('https://api.test/v0/images?upload=true');
		expect(JSON.parse(post.body)).toEqual({ name: template.name, resourceType: 'sandbox' });
		const [putUrl, put] = fetchMock.mock.calls[1];
		expect(putUrl).toBe('https://upload.test/ctx');
		const zip = Buffer.from(put.body).toString('latin1');
		expect(zip).toContain('FROM ubuntu:24.04\nCOPY --from=ghcr.io/blaxel-ai/sandbox:latest /sandbox-api /usr/local/bin/sandbox-api\nENTRYPOINT ["/usr/local/bin/sandbox-api"]\n');
		// No sandbox is deployed for the build.
		expect(core.SandboxInstance.createIfNotExists).not.toHaveBeenCalled();
	});

	it('names the image after the build, so different sources get different images', async () => {
		const core = await mockedCore();
		const done = image('BUILT', [{ name: 't' }], [built2]);
		vi.mocked(core.getImage).mockImplementation(async () => done as never);
		vi.mocked(core.getImage).mockResolvedValueOnce(notFound as never);
		const a = await create({ name: 'oci-base', image: 'ubuntu:24.04' });
		vi.mocked(core.getImage).mockResolvedValueOnce(notFound as never);
		const b = await create({ name: 'oci-base', image: 'ubuntu:22.04' });
		vi.mocked(core.getImage).mockResolvedValueOnce(notFound as never);
		const c = await create({ name: 'oci-base', image: 'ubuntu:24.04' });

		expect(a.name).not.toBe(b.name);
		expect(c.name).toBe(a.name);
	});

	it('on a rebuild, waits for a build result newer than the previous one', async () => {
		const core = await mockedCore();
		const old = image('BUILT', [{ name: 'old', updatedAt: '2026-11-08T00:00:10Z' }], [built1]);
		const rebuilt = image('BUILT', [{ name: 'old', updatedAt: '2026-11-08T00:00:10Z' }], [built1, initiated2, built2]);
		vi.mocked(core.getImage)
			.mockResolvedValue(rebuilt as never)
			.mockResolvedValueOnce(old as never)
			.mockResolvedValueOnce(old as never);

		const template = await create({ name: 'oci-base', image: 'ubuntu:24.04' });

		// An identical build is reused: same tag, once no new tag showed up.
		expect(template.id).toMatch(/:old$/);
		expect(vi.mocked(core.getImage).mock.calls.length).toBeGreaterThan(3);
	});

	it('on a rebuild, does not take the old tag when the new tag lands after BUILT', async () => {
		const core = await mockedCore();
		const oldTag = { name: 'old', updatedAt: '2026-11-08T00:00:10Z' };
		vi.mocked(core.getImage)
			.mockResolvedValueOnce(image('BUILT', [oldTag], [built1]) as never)
			.mockResolvedValueOnce(image('BUILT', [oldTag], [built1, initiated2, built2]) as never)
			.mockResolvedValueOnce(image('BUILT', [oldTag], [built1, initiated2, built2]) as never)
			.mockResolvedValueOnce(image('BUILT', [oldTag, { name: 'new', createdAt: '2026-11-09T18:00:12Z' }], [built1, initiated2, built2]) as never);

		const template = await create({ name: 'oci-base', image: 'ubuntu:24.04' });

		expect(template.id).toMatch(/:new$/);
	});

	it('keeps polling when the BUILT event lands before the tag', async () => {
		const core = await mockedCore();
		vi.mocked(core.getImage)
			.mockResolvedValueOnce(notFound as never)
			.mockResolvedValueOnce(image('BUILT', [], [initiated2, built2]) as never)
			.mockResolvedValueOnce(image('BUILT', [{ name: 'b0031c' }], [initiated2, built2]) as never);

		const template = await create({ name: 'oci-base', image: 'ubuntu:24.04' });

		expect(template.id).toMatch(/:b0031c$/);
	});

	it('returns the tag a rebuild added', async () => {
		const core = await mockedCore();
		vi.mocked(core.getImage)
			.mockResolvedValueOnce(image('BUILT', [{ name: 'old', updatedAt: '2026-11-08T00:00:10Z' }], [built1]) as never)
			.mockResolvedValueOnce(image('BUILT', [
				{ name: 'new', updatedAt: '2026-11-07T00:00:00Z' },
				{ name: 'old', updatedAt: '2026-11-08T00:00:10Z' },
			], [built1, built2]) as never);

		const template = await create({ name: 'oci-base', image: 'ubuntu:24.04' });

		expect(template.id).toMatch(/:new$/);
	});

	describe('with Blaxel API 2026-09-22 image summaries', () => {
		it('reads the new tag from the paged tag list', async () => {
			const core = await mockedCore();
			vi.mocked(core.getImage)
				.mockResolvedValueOnce(notFound as never)
				.mockResolvedValueOnce(summary('BUILDING', 0, [initiated2]) as never)
				.mockResolvedValueOnce(summary('BUILT', 1, [initiated2, built2]) as never);
			vi.mocked(core.listImageTags).mockResolvedValueOnce(tagPage([{ name: 'b0031c', createdAt: '2026-11-09T18:00:10Z' }]) as never);

			const template = await create({ name: 'oci-base', image: 'ubuntu:24.04' });

			expect(template.id).toBe(`sandbox/${template.name}:b0031c`);
			expect(template.createdAt).toEqual(new Date('2026-11-09T18:00:10Z'));
			expect(core.listImageTags).toHaveBeenCalledWith({ path: { resourceType: 'sandbox', imageName: template.name }, query: { limit: 100 } });
		});

		it('on a rebuild, skips the tags from before it across pages', async () => {
			const core = await mockedCore();
			const oldTags = [{ name: 'a-old' }, { name: 'b-old' }];
			vi.mocked(core.getImage)
				.mockResolvedValueOnce(summary('BUILT', 2, [built1]) as never)
				.mockResolvedValueOnce(summary('BUILT', 3, [built1, initiated2, built2]) as never);
			vi.mocked(core.listImageTags)
				.mockResolvedValueOnce(tagPage([oldTags[0]], 'p2') as never)
				.mockResolvedValueOnce(tagPage([oldTags[1]]) as never)
				.mockResolvedValueOnce(tagPage([oldTags[0]], 'p2') as never)
				.mockResolvedValueOnce(tagPage([oldTags[1], { name: 'c-new' }]) as never);

			const template = await create({ name: 'oci-base', image: 'ubuntu:24.04' });

			expect(template.id).toMatch(/:c-new$/);
			expect(vi.mocked(core.listImageTags).mock.calls[1][0]).toMatchObject({ query: { limit: 100, cursor: 'p2' } });
		});

		it('keeps polling until the tag is listed', async () => {
			const core = await mockedCore();
			vi.mocked(core.getImage)
				.mockResolvedValueOnce(notFound as never)
				.mockResolvedValueOnce(summary('BUILT', 0, [initiated2, built2]) as never)
				.mockResolvedValueOnce(summary('BUILT', 1, [initiated2, built2]) as never);
			vi.mocked(core.listImageTags).mockResolvedValueOnce(tagPage([{ name: 'late' }]) as never);

			const template = await create({ name: 'oci-base', image: 'ubuntu:24.04' });

			expect(template.id).toMatch(/:late$/);
			// A summary with no tags is not listed.
			expect(core.listImageTags).toHaveBeenCalledTimes(1);
		});

		it('reports a failed tag listing', async () => {
			const core = await mockedCore();
			vi.mocked(core.getImage)
				.mockResolvedValueOnce(notFound as never)
				.mockResolvedValueOnce(summary('BUILT', 1, [initiated2, built2]) as never);
			vi.mocked(core.listImageTags).mockResolvedValueOnce({ data: undefined, error: { error: 'forbidden' }, response: { status: 403 } } as never);

			await expect(create({ name: 'oci-base', image: 'ubuntu:24.04' })).rejects.toThrow(/Failed to list the tags of the Blaxel template oci-base-[0-9a-f]{8}: .*forbidden/);
		});
	});

	it('reports a failed build', async () => {
		const core = await mockedCore();
		vi.mocked(core.getImage)
			.mockResolvedValueOnce(notFound as never)
			.mockResolvedValueOnce(image('FAILED', [], [{ status: 'FAILED', time: '2026-11-09T18:00:10Z', message: 'pull access denied' }]) as never);

		await expect(create({ name: 'oci-base', image: 'nope:1' })).rejects.toThrow(/failed to build template oci-base-[0-9a-f]{8} from nope:1: pull access denied/);
	});

	it('reports a refused build request', async () => {
		const core = await mockedCore();
		vi.mocked(core.getImage).mockResolvedValueOnce(notFound as never);
		fetchMock.mockResolvedValueOnce(new Response('bad name', { status: 400 }));

		await expect(create({ name: 'Bad_Name', image: 'ubuntu:24.04' })).rejects.toThrow(/400 bad name/);
	});

	it('requires a name', async () => {
		await expect(create({ name: ' ', image: 'ubuntu:24.04' })).rejects.toThrow(/name is required/);
	});

	it('requires a single image ref', async () => {
		await expect(create({ name: 'oci-base' })).rejects.toThrow(/needs an OCI image ref/);
		await expect(create({ name: 'oci-base', image: 'ubuntu:24.04\nRUN echo hi' })).rejects.toThrow(/without spaces/);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('blaxel sandbox.create from a template', () => {
	it('boots the template image ref', async () => {
		vi.useRealTimers();
		const core = await mockedCore();
		vi.mocked(core.SandboxInstance.createIfNotExists).mockResolvedValue({ metadata: { name: 'sb' } } as unknown as SandboxInstance);

		await blaxel({ image: 'blaxel/base-image:latest' }).sandbox.create({ templateId: 'sandbox/oci-base:abc' });

		expect(core.SandboxInstance.createIfNotExists).toHaveBeenCalledWith(expect.objectContaining({ image: 'sandbox/oci-base:abc' }));
	});

	it('boots the template even when an image option is also passed', async () => {
		vi.useRealTimers();
		const core = await mockedCore();
		vi.mocked(core.SandboxInstance.createIfNotExists).mockResolvedValue({ metadata: { name: 'sb' } } as unknown as SandboxInstance);

		await blaxel({}).sandbox.create({ templateId: 'sandbox/oci-base:abc', image: 'ubuntu:24.04' } as never);

		expect(core.SandboxInstance.createIfNotExists).toHaveBeenCalledWith(expect.objectContaining({ image: 'sandbox/oci-base:abc' }));
	});

	it('boots an image option over the configured image when there is no template', async () => {
		vi.useRealTimers();
		const core = await mockedCore();
		vi.mocked(core.SandboxInstance.createIfNotExists).mockResolvedValue({ metadata: { name: 'sb' } } as unknown as SandboxInstance);

		await blaxel({ image: 'blaxel/base-image:latest' }).sandbox.create({ image: 'ubuntu:24.04' } as never);

		expect(core.SandboxInstance.createIfNotExists).toHaveBeenCalledWith(expect.objectContaining({ image: 'ubuntu:24.04' }));
	});
});

describe('blaxel template.list and delete', () => {
	beforeEach(() => {
		vi.useRealTimers();
	});

	it('lists one template per sandbox image tag', async () => {
		const core = await mockedCore();
		vi.mocked(core.listImages).mockResolvedValue({
			data: [
				{ metadata: { name: 'oci-base', resourceType: 'sandbox' }, spec: { tags: [{ name: 'abc', createdAt: '2026-11-09T18:00:00Z' }] } },
				{ metadata: { name: 'agent', resourceType: 'agent' }, spec: { tags: [{ name: 'x' }] } },
			],
		} as never);

		const templates = await blaxel({}).template!.list();

		expect(templates).toEqual([expect.objectContaining({ id: 'sandbox/oci-base:abc', name: 'oci-base', provider: 'blaxel' })]);
	});

	it('lists the tags of every page of sandbox image summaries (API 2026-09-22)', async () => {
		const core = await mockedCore();
		vi.mocked(core.listImages)
			.mockResolvedValueOnce({ data: { data: [
				{ metadata: { name: 'oci-base', resourceType: 'sandbox' }, spec: { tagCount: 2 } },
				{ metadata: { name: 'agent', resourceType: 'agent' }, spec: { tagCount: 1 } },
			], meta: { hasMore: true, nextCursor: 'next' } } } as never)
			.mockResolvedValueOnce({ data: { data: [
				{ metadata: { name: 'empty', resourceType: 'sandbox' }, spec: { tagCount: 0 } },
				{ metadata: { name: 'py', resourceType: 'sandbox' }, spec: { tagCount: 1 } },
			], meta: { hasMore: false } } } as never);
		vi.mocked(core.listImageTags)
			.mockResolvedValueOnce(tagPage([{ name: 'abc' }], 'c2') as never)
			.mockResolvedValueOnce(tagPage([{ name: 'def' }]) as never)
			.mockResolvedValueOnce(tagPage([{ name: '3.12' }]) as never);

		const templates = await blaxel({}).template!.list();

		expect(templates.map(t => t.id)).toEqual(['sandbox/oci-base:abc', 'sandbox/oci-base:def', 'sandbox/py:3.12']);
		expect(vi.mocked(core.listImages).mock.calls[1][0]).toMatchObject({ query: { cursor: 'next' } });
		expect(vi.mocked(core.listImageTags).mock.calls.map(([options]) => (options as { path: { imageName: string } }).path.imageName)).toEqual(['oci-base', 'oci-base', 'py']);
	});

	it('stops listing tags once it has the limit', async () => {
		const core = await mockedCore();
		vi.mocked(core.listImages).mockResolvedValueOnce({ data: { data: [
			{ metadata: { name: 'a', resourceType: 'sandbox' }, spec: { tagCount: 1 } },
			{ metadata: { name: 'b', resourceType: 'sandbox' }, spec: { tagCount: 1 } },
		], meta: { hasMore: false } } } as never);
		vi.mocked(core.listImageTags).mockResolvedValueOnce(tagPage([{ name: 'x' }]) as never);

		const templates = await blaxel({}).template!.list({ limit: 1 });

		expect(templates.map(t => t.id)).toEqual(['sandbox/a:x']);
		expect(core.listImageTags).toHaveBeenCalledTimes(1);
	});

	it('deletes the tag a template id names and ignores one already gone', async () => {
		const core = await mockedCore();
		vi.mocked(core.deleteImageTag).mockResolvedValue(notFound as never);

		await blaxel({}).template!.delete('sandbox/oci-base:abc');

		expect(core.deleteImageTag).toHaveBeenCalledWith({ path: { resourceType: 'sandbox', imageName: 'oci-base', tagName: 'abc' } });
	});

	it('reports a failed delete', async () => {
		const core = await mockedCore();
		vi.mocked(core.deleteImageTag).mockResolvedValue({ data: undefined, error: { error: 'tag in use' }, response: { status: 409 } } as never);

		await expect(blaxel({}).template!.delete('sandbox/oci-base:abc')).rejects.toThrow(/tag in use/);
	});
});
