import axios, {AxiosInstance} from "axios";
import {unzip, type ZipEntry, ZipInfo} from 'unzipit';
import {createHash} from "node:crypto";
import normalize from 'normalize-path';
import Keyv from "keyv";
import {Readable} from "node:stream";
import {requestLogger} from "axios-logger";
import {
	RegistryUrlParams,
	ProviderType,
	ProviderDownloadResponse,
	ProviderVersionsResponse
} from './types';

const kvstore = new Map();

abstract class Registry {
	protected registry: string;
	protected cache: Keyv;
	protected http: AxiosInstance;

	protected constructor(registry: string, protected readonly type: ProviderType) {
		this.registry = `https://${registry}`;
		this.cache = new Keyv({ttl: 86400 * 1000, store: kvstore, namespace: registry});

		this.http = axios.create({
			timeout: 5000,
			...(!process.env.DIRECT && {
				proxy: {
					host: 'localhost',
					port: 8888,
					protocol: 'http'
				}
			})
		});

		this.http.interceptors.request.use(requestLogger);

		// TODO: Interceptor to automatically handle service discovery baseURL config
		// this.http.interceptors.request.use(async (value: InternalAxiosRequestConfig<any>): Promise<InternalAxiosRequestConfig<any>> => ({
		// 	baseURL: await this.serviceDiscovery(),
		// 	...value
		// }))
	}

	protected get serviceIdentifier(): string {
		return `${this.type}.v1`
	}

	protected get wellKnownUrl(): string {
		return `https://${this.registry}/.well-known/terraform.json`;
	}

	protected async download(url: string): Promise<Readable> {
		const result = await this.http.get(url, {responseType: 'stream'});
		return await result.data;
	}

	/*
	 * Implementation of the h1 hashing algorithm. All processing is done in memory.
	 *
	 * In summary, the h1 hash is a sha256sum of the sha256sum output of the sorted file list.
	 *
	 * Reference implementations can be found here:
	 * https://github.com/secustor/renovate/blob/main/lib/modules/manager/terraform/lockfile/hash.ts
	 * https://about.gitlab.com/blog/2022/06/01/terraform-as-part-of-software-supply-chain-part1-modules-and-providers/
	 */
	protected async calculateHash(url: string): Promise<string> {
		if (await this.cache.has(url)) return this.cache.get(url);

		const hashes: Record<string, string> = {};
		const sortFiles = (files: Record<string, string>): Record<string, string> =>
			Object.keys(files).sort().reduce((r, k) =>
				Object.assign(r, {[k]: files[k]}), {});

		const download = await this.download(url);

		const chunks: Uint8Array[] = [];
		const file: Buffer = await new Promise((resolve, reject) => {
			download.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
			download.on('error', (error: any) => reject(error));
			download.on('end', () => resolve(Buffer.concat(chunks)));
		});

		const {entries}: ZipInfo = await unzip(new Uint8Array(file));

		await Promise.all(Object.values(entries).map(async (entry: ZipEntry) => {
			const hash = createHash('sha256');
			const data = await entry.arrayBuffer();
			hash.update(new Uint8Array(data));

			hashes[entry.name] = hash.digest('hex');
		}));

		const result = sortFiles(hashes);
		const h1 = createHash('sha256');
		Object.entries(result).forEach(([k, v]) => {
			h1.update(`${v}  ${normalize(k, false)}\n`);
		});

		const output = h1.digest('base64');
		await this.cache.set(url, output);

		return output;
	}

	protected async serviceDiscovery(): Promise<string> {
		/*
		https://developer.hashicorp.com/terraform/internals/remote-service-discovery#discovery-process

		The value of each object element is the base URL for the service in question.
		This URL may be either absolute or relative, and if relative it is resolved against the final discovery URL (after following redirects).
		 */

		if (await this.cache.has(this.wellKnownUrl)) return this.cache.get(this.wellKnownUrl);

		const response = await this.http.get<Record<string, string>>(`/.well-known/terraform.json`, {baseURL: this.registry});

		let result = response.data[this.serviceIdentifier];

		if (result.startsWith('https://')) {
			// Absolute, return as-is
			await this.cache.set(this.wellKnownUrl, result, 30 * 1000);
			return result;
		} else {
			// Relative result. We need to find out our final redirect destination
			const url = new URL(result, response.request.res.responseUrl);

			if (url.protocol != "https:") {
				throw new Error("Insecure URLs are not supported!");
			}

			await this.cache.set(this.wellKnownUrl, url.toString(), 30 * 1000);
			return url.toString();
		}
	}

	protected abstract listVersions(opts: Partial<RegistryUrlParams>): Promise<Record<string, unknown>>;
	protected abstract getDownload(opts: Partial<RegistryUrlParams>): Promise<string | Readable>;
}

export class Providers extends Registry {
	constructor(registry: string) {
		super(registry, ProviderType.Provider);
	}

	public async listVersions(opts: Pick<RegistryUrlParams, 'namespace' | 'type'>): Promise<Record<string, unknown>> {
		const response = await this.http.get<ProviderVersionsResponse>(`${opts.namespace}/${opts.type}/versions`, {baseURL: await this.serviceDiscovery()});

		return {
			versions: Object.fromEntries(response.data.versions.map(entry => ([entry.version, {}])))
		}
	}

	private async getArchitecturesForVersion(opts: Pick<RegistryUrlParams, 'namespace' | 'type' | 'version'>): Promise<{os: string, arch: string}[]> {
		const response = await this.http.get<ProviderVersionsResponse>(`${opts.namespace}/${opts.type}/versions`, {baseURL: await this.serviceDiscovery()});
		return response.data.versions.find(entry => entry.version === opts.version)?.platforms.map(platform => platform) ?? [];
	}

	public async listAvailableDownloads(opts: Pick<RegistryUrlParams, 'namespace' | 'type' | 'version'>): Promise<Record<string, unknown>> {
		const platforms = await this.getArchitecturesForVersion(opts);

		const archives = platforms.map(async platform => {
			const response = await this.http.get<ProviderDownloadResponse>(`${opts.namespace}/${opts.type}/${opts.version}/download/${platform.os}/${platform.arch}`, {baseURL: await this.serviceDiscovery()});

			await this.download(response.data.download_url);

			return [[platform.os, platform.arch].join('_'), {
				url: `${opts.version}/download/${platform.os}/${platform.arch}/${response.data.filename}`,
				hashes: [`h1:${await this.calculateHash(response.data.download_url)}`]
			}];
		});

		return {archives: Object.fromEntries(await Promise.all(archives))};
	}

	public async getDownload(opts: Pick<RegistryUrlParams, 'namespace' | 'type' | 'version' | 'os' | 'arch'>): Promise<Readable> {
		const response = await this.http.get<ProviderDownloadResponse>(`${opts.namespace}/${opts.type}/${opts.version}/download/${opts.os}/${opts.arch}`, {baseURL: await this.serviceDiscovery()});
		return await this.download(response.data.download_url);
	}
}

export class Modules extends Registry {
	constructor() {
		// Using this mirror implies usage of registry.terraform.io
		super('registry.terraform.io', ProviderType.Modules);
	}

	public async listVersions(opts: Pick<RegistryUrlParams, 'namespace' | 'name' | 'system'>): Promise<Record<string, unknown>> {
		const response = await this.http.get<Record<string, unknown>>(`${opts.namespace}/${opts.name}/${opts.system}/versions`, {baseURL: await this.serviceDiscovery()});
		return response.data;
	}

	public async getDownload(opts: Pick<RegistryUrlParams, 'namespace' | 'name' | 'system' | 'version'>): Promise<string> {
		const url = await this.http.get(`${opts.namespace}/${opts.name}/${opts.system}/${opts.version}/download`, {baseURL: await this.serviceDiscovery()});
		return url.headers['x-terraform-get'];
	}
}
