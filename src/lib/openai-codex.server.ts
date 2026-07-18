import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createModels,
  type AuthInteraction,
  type Credential,
  type CredentialInfo,
  type CredentialStore,
  type Models,
} from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";

const PROVIDER_ID = "openai-codex";
const RUNTIME_DIRECTORY = resolve(process.cwd(), ".codex-runtime", "credentials");
const operationQueues = new Map<string, Promise<void>>();

type CredentialFile = Record<string, Credential>;

function credentialPath(ownerId: string) {
  const key = createHash("sha256").update(ownerId).digest("hex");
  return resolve(RUNTIME_DIRECTORY, `${key}.json`);
}

async function withSerializedAccess<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = operationQueues.get(path) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const next = new Promise<void>((resolveQueue) => {
    release = resolveQueue;
  });
  const queued = previous.then(() => next);
  operationQueues.set(path, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release?.();
    if (operationQueues.get(path) === queued) operationQueues.delete(path);
  }
}

function isCredential(value: unknown): value is Credential {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.type === "api_key") {
    return candidate.key === undefined || typeof candidate.key === "string";
  }
  return (
    candidate.type === "oauth" &&
    typeof candidate.access === "string" &&
    typeof candidate.refresh === "string" &&
    typeof candidate.expires === "number"
  );
}

async function readCredentials(path: string): Promise<CredentialFile> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("credential file must contain an object");
    }
    const credentials: CredentialFile = {};
    for (const [providerId, credential] of Object.entries(parsed)) {
      if (!isCredential(credential)) throw new Error(`invalid credential for ${providerId}`);
      credentials[providerId] = credential;
    }
    return credentials;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return {};
    throw new Error(
      `Unable to read the local Codex credential store: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function writeCredentials(path: string, credentials: CredentialFile) {
  await mkdir(RUNTIME_DIRECTORY, { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(credentials, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}

class LocalCredentialStore implements CredentialStore {
  private readonly path: string;

  constructor(ownerId: string) {
    this.path = credentialPath(ownerId);
  }

  async read(providerId: string) {
    return (await readCredentials(this.path))[providerId];
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const credentials = await readCredentials(this.path);
    return Object.entries(credentials).map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }));
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ) {
    return withSerializedAccess(this.path, async () => {
      const credentials = await readCredentials(this.path);
      const current = credentials[providerId];
      const replacement = await fn(current);
      if (replacement === undefined) return current;
      credentials[providerId] = replacement;
      await writeCredentials(this.path, credentials);
      return replacement;
    });
  }

  async delete(providerId: string) {
    await withSerializedAccess(this.path, async () => {
      const credentials = await readCredentials(this.path);
      if (!(providerId in credentials)) return;
      delete credentials[providerId];
      await writeCredentials(this.path, credentials);
    });
  }
}

type OwnerModels = { models: Models; credentials: LocalCredentialStore };
const ownerModels = new Map<string, OwnerModels>();

function modelsFor(ownerId: string): OwnerModels {
  const existing = ownerModels.get(ownerId);
  if (existing) return existing;
  const credentials = new LocalCredentialStore(ownerId);
  const models = createModels({ credentials });
  models.setProvider(openaiCodexProvider());
  const created = { models, credentials };
  ownerModels.set(ownerId, created);
  return created;
}

export async function getOpenAICodexStatus(ownerId: string) {
  const { models } = modelsFor(ownerId);
  const auth = await models.checkAuth(PROVIDER_ID);
  return {
    connected: auth?.type === "oauth",
    models: models.getModels(PROVIDER_ID).map((model) => ({ id: model.id, name: model.name })),
  };
}

export async function loginOpenAICodex(ownerId: string, interaction: AuthInteraction) {
  return modelsFor(ownerId).models.login(PROVIDER_ID, "oauth", interaction);
}

export async function logoutOpenAICodex(ownerId: string) {
  await modelsFor(ownerId).models.logout(PROVIDER_ID);
}

export async function resolveOpenAICodexCredential(ownerId: string) {
  const { models, credentials } = modelsFor(ownerId);
  const auth = await models.getAuth(PROVIDER_ID);
  if (!auth?.auth.apiKey) return null;
  const credential = await credentials.read(PROVIDER_ID);
  if (credential?.type !== "oauth") return null;
  const accountId = credential.accountId;
  if (typeof accountId !== "string" || accountId.length === 0) {
    throw new Error("The local Codex credential does not contain a ChatGPT account ID.");
  }
  return { accessToken: auth.auth.apiKey, accountId };
}
