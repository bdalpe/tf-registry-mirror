export enum ProviderType {
	Provider = "providers",
	Modules = "modules"
}

export type RegistryUrlParams = {
	namespace: string;
	type: string;
	name: string;
	system: string;
	version: string;
	os: string;
	arch: string;
}

export interface ProviderPlatforms {
	os: string;
	arch: string;
}

export interface ProviderVersions {
	version: string;
	protocols: string[];
	platforms: ProviderPlatforms[];
}

export interface ProviderVersionsResponse {
	versions: ProviderVersions[];
}

export interface ProviderDownloadResponse {
	protocols: string[];
	os: string;
	arch: string;
	filename: string;
	download_url: string;
	shasums_url: string;
	shasums_signature_url: string;
	shasum: string;
	signing_keys: {
		gpg_public_keys: {
			key_id: string;
			ascii_armor: string;
			trust_signature: string;
			source: string;
			source_url: string;
		}[]
	}
}
