import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_QWEN_MODEL,
  QWEN_BASE_URL,
} from "../model";

export const PROVIDERS = ["openrouter", "deepseek", "qwen"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const DEFAULT_MODELS: Record<Provider, string> = {
  openrouter: DEFAULT_OPENROUTER_MODEL,
  deepseek: DEFAULT_DEEPSEEK_MODEL,
  qwen: DEFAULT_QWEN_MODEL,
};

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}

/** What a client may see about a stored key. Never the key itself. */
export interface ProviderKeyView {
  provider: Provider;
  last4: string | null;
  verified: boolean;
  defaultModel: string;
  updatedAt: string | null;
}

export type KeyTestResult =
  | { ok: true }
  | { ok: false; error: "invalid_key" | "no_credit" | "rate_limited" | "provider_error"; message: string };

interface StoredKey {
  iv: string;
  ciphertext: string;
  last4: string;
  verified: boolean;
  updatedAt: string;
}

type UserKeys = Partial<Record<Provider, StoredKey>>;

/** Where provider keys live: encrypted files on a shared server, the OS keychain on a desktop. */
export interface ProviderKeyStore {
  list(userId: string): Promise<ProviderKeyView[]>;
  set(userId: string, provider: Provider, secret: string, verified: boolean): Promise<ProviderKeyView>;
  markVerified(userId: string, provider: Provider, verified: boolean): Promise<void>;
  delete(userId: string, provider: Provider): Promise<void>;
  reveal(userId: string, provider: Provider): Promise<string | null>;
}

/** The subset of Bun.secrets the keychain store needs, so tests can swap in a map. */
export interface SecretBackend {
  get(options: { service: string; name: string }): Promise<string | null>;
  set(options: { service: string; name: string; value: string }): Promise<void>;
  delete(options: { service: string; name: string }): Promise<boolean>;
}

const KEYCHAIN_SERVICE = "dev.caramel.app";

/**
 * Keys in the operating system's credential store (macOS Keychain, Windows Credential Manager,
 * libsecret on Linux) through Bun.secrets. Only non-secret details (last four characters,
 * verified flag) go to a file, so listing keys never touches the keychain.
 */
export class KeychainKeyStore implements ProviderKeyStore {
  private constructor(
    private readonly indexPath: string,
    private readonly secrets: SecretBackend,
    private readonly now: () => Date,
  ) {}

  static async open(options: { root: string; secrets?: SecretBackend; now?: () => Date }): Promise<KeychainKeyStore> {
    await mkdir(options.root, { recursive: true, mode: 0o700 });
    return new KeychainKeyStore(
      resolve(options.root, "keychain-index.json"),
      options.secrets ?? (Bun.secrets as unknown as SecretBackend),
      options.now ?? (() => new Date()),
    );
  }

  async list(userId: string): Promise<ProviderKeyView[]> {
    const index = (await this.readIndex())[userId] ?? {};
    return PROVIDERS.map((provider) => ({
      provider,
      last4: index[provider]?.last4 ?? null,
      verified: index[provider]?.verified ?? false,
      defaultModel: DEFAULT_MODELS[provider],
      updatedAt: index[provider]?.updatedAt ?? null,
    }));
  }

  async set(userId: string, provider: Provider, secret: string, verified: boolean): Promise<ProviderKeyView> {
    const trimmed = secret.trim();
    if (trimmed.length < 8 || trimmed.length > 500) throw new Error("The key must be between 8 and 500 characters.");
    await this.secrets.set({ service: KEYCHAIN_SERVICE, name: this.name(userId, provider), value: trimmed });
    await this.updateIndex(userId, provider, { last4: trimmed.slice(-4), verified, updatedAt: this.now().toISOString() });
    return (await this.list(userId)).find((view) => view.provider === provider)!;
  }

  async markVerified(userId: string, provider: Provider, verified: boolean): Promise<void> {
    const current = (await this.readIndex())[userId]?.[provider];
    if (current !== undefined) await this.updateIndex(userId, provider, { ...current, verified });
  }

  async delete(userId: string, provider: Provider): Promise<void> {
    await this.secrets.delete({ service: KEYCHAIN_SERVICE, name: this.name(userId, provider) });
    await this.updateIndex(userId, provider, undefined);
  }

  async reveal(userId: string, provider: Provider): Promise<string | null> {
    return await this.secrets.get({ service: KEYCHAIN_SERVICE, name: this.name(userId, provider) });
  }

  private name(userId: string, provider: Provider): string {
    return `${userId}:${provider}`;
  }

  private async readIndex(): Promise<Record<string, Partial<Record<Provider, { last4: string; verified: boolean; updatedAt: string }>>>> {
    try {
      return JSON.parse(await readFile(this.indexPath, "utf8"));
    } catch {
      return {};
    }
  }

  private async updateIndex(
    userId: string,
    provider: Provider,
    entry: { last4: string; verified: boolean; updatedAt: string } | undefined,
  ): Promise<void> {
    const index = await this.readIndex();
    const user = index[userId] ?? {};
    if (entry === undefined) delete user[provider];
    else user[provider] = entry;
    index[userId] = user;
    const temporary = `${this.indexPath}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(index), { mode: 0o600 });
    await rename(temporary, this.indexPath);
  }
}

/**
 * Per-user provider keys, encrypted at rest with AES-256-GCM. The owner and provider are bound in
 * as additional data, so a ciphertext copied into another user's file fails to decrypt.
 */
export class KeyStore implements ProviderKeyStore {
  private constructor(
    private readonly root: string,
    private readonly key: CryptoKey,
    private readonly now: () => Date,
  ) {}

  /** `masterKey` is 32 random bytes, base64-encoded (e.g. `openssl rand -base64 32`). */
  static async open(options: { root: string; masterKey: string; now?: () => Date }): Promise<KeyStore> {
    const raw = Buffer.from(options.masterKey, "base64");
    if (raw.byteLength !== 32) throw new Error("The key encryption key must be 32 bytes, base64-encoded.");
    await mkdir(options.root, { recursive: true, mode: 0o700 });
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    return new KeyStore(options.root, key, options.now ?? (() => new Date()));
  }

  async list(userId: string): Promise<ProviderKeyView[]> {
    const keys = await this.read(userId);
    return PROVIDERS.map((provider) => ({
      provider,
      last4: keys[provider]?.last4 ?? null,
      verified: keys[provider]?.verified ?? false,
      defaultModel: DEFAULT_MODELS[provider],
      updatedAt: keys[provider]?.updatedAt ?? null,
    }));
  }

  async set(userId: string, provider: Provider, secret: string, verified: boolean): Promise<ProviderKeyView> {
    const trimmed = secret.trim();
    if (trimmed.length < 8 || trimmed.length > 500) throw new Error("The key must be between 8 and 500 characters.");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: this.aad(userId, provider) },
      this.key,
      new TextEncoder().encode(trimmed),
    );
    const keys = await this.read(userId);
    keys[provider] = {
      iv: Buffer.from(iv).toString("base64"),
      ciphertext: Buffer.from(ciphertext).toString("base64"),
      last4: trimmed.slice(-4),
      verified,
      updatedAt: this.now().toISOString(),
    };
    await this.write(userId, keys);
    return (await this.list(userId)).find((view) => view.provider === provider)!;
  }

  async markVerified(userId: string, provider: Provider, verified: boolean): Promise<void> {
    const keys = await this.read(userId);
    const stored = keys[provider];
    if (stored === undefined) return;
    keys[provider] = { ...stored, verified };
    await this.write(userId, keys);
  }

  async delete(userId: string, provider: Provider): Promise<void> {
    const keys = await this.read(userId);
    delete keys[provider];
    await this.write(userId, keys);
  }

  /** The plaintext key, only for starting a run or testing it. */
  async reveal(userId: string, provider: Provider): Promise<string | null> {
    const stored = (await this.read(userId))[provider];
    if (stored === undefined) return null;
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(Buffer.from(stored.iv, "base64")), additionalData: this.aad(userId, provider) },
      this.key,
      new Uint8Array(Buffer.from(stored.ciphertext, "base64")),
    );
    return new TextDecoder().decode(plaintext);
  }

  private aad(userId: string, provider: Provider): Uint8Array<ArrayBuffer> {
    return new TextEncoder().encode(`${userId}\0${provider}`);
  }

  /** File names are a hash of the user id, so ids never become paths. */
  private path(userId: string): string {
    return resolve(this.root, `${new Bun.CryptoHasher("sha256").update(userId).digest("hex")}.json`);
  }

  private async read(userId: string): Promise<UserKeys> {
    try {
      return JSON.parse(await readFile(this.path(userId), "utf8")) as UserKeys;
    } catch {
      return {};
    }
  }

  private async write(userId: string, keys: UserKeys): Promise<void> {
    const path = this.path(userId);
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(keys), { mode: 0o600 });
    await rename(temporary, path);
  }
}

/** One cheap authenticated request per provider, mapped to the errors the setup screen shows. */
export async function testProviderKey(provider: Provider, key: string, fetcher: typeof fetch = fetch): Promise<KeyTestResult> {
  const url = provider === "openrouter"
    ? "https://openrouter.ai/api/v1/key"
    : provider === "deepseek"
      ? `${DEEPSEEK_BASE_URL}/user/balance`
      : `${QWEN_BASE_URL}/models`;
  let response: Response;
  try {
    response = await fetcher(url, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    return { ok: false, error: "provider_error", message: error instanceof Error ? error.message : String(error) };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, error: "invalid_key", message: "The provider rejected this key." };
  if (response.status === 402) return { ok: false, error: "no_credit", message: "This key has no credit left." };
  if (response.status === 429) return { ok: false, error: "rate_limited", message: "The provider is rate limiting this key; try again shortly." };
  if (!response.ok) return { ok: false, error: "provider_error", message: `The provider answered ${response.status}.` };
  if (provider === "deepseek") {
    const body = (await response.json().catch(() => ({}))) as { is_available?: unknown };
    if (body.is_available === false) return { ok: false, error: "no_credit", message: "This key has no credit left." };
  }
  if (provider === "openrouter") {
    const body = (await response.json().catch(() => ({}))) as { data?: { limit_remaining?: unknown } };
    const remaining = body.data?.limit_remaining;
    if (typeof remaining === "number" && remaining <= 0) return { ok: false, error: "no_credit", message: "This key has no credit left." };
  }
  return { ok: true };
}
