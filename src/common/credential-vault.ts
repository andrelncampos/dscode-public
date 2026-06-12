import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const PREFIX = "aes256:";

export function getCredentialKeyPath(): string {
  return path.join(process.env.HOME || process.env.USERPROFILE || homedir(), ".dscode", ".credential-key");
}

export function getOrCreateCredentialKey(): Buffer {
  const keyPath = getCredentialKeyPath();

  // Try to read the existing key first (no TOCTOU: a missing file is
  // handled by falling through to atomic creation with 'wx').
  try {
    const data = fs.readFileSync(keyPath);
    if (data.length !== KEY_LENGTH) {
      throw new Error(
        `Credential keyfile is corrupt (expected ${KEY_LENGTH} bytes, got ${data.length}). ` +
          `Delete ${keyPath} and re-add API keys with /model-key.`
      );
    }
    return data;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  // Keyfile does not exist — create it atomically. 'wx' fails with EEXIST
  // if another process wins the race, so we retry the read.
  const key = crypto.randomBytes(KEY_LENGTH);
  try {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, key, { mode: 0o600, flag: "wx" });
    return key;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      return getOrCreateCredentialKey();
    }
    throw e;
  }
}

export function encryptCredential(plaintext: string, providerName: string): string {
  const key = getOrCreateCredentialKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(providerName, "utf8"));
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, encrypted].map((b) => b.toString("base64url")).join(":");
}

export function decryptCredential(encoded: string, providerName: string): string {
  if (!encoded.startsWith(PREFIX)) {
    throw new Error("Not an encrypted credential");
  }
  const parts = encoded.slice(PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted credential format");
  }
  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64url");
  if (iv.length !== IV_LENGTH) {
    throw new Error("Invalid encrypted credential format");
  }
  const tag = Buffer.from(tagB64, "base64url");
  if (tag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Invalid encrypted credential format");
  }
  const ct = Buffer.from(ctB64, "base64url");
  const key = getOrCreateCredentialKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(Buffer.from(providerName, "utf8"));
  decipher.setAuthTag(tag);
  try {
    const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    throw new Error(
      `API key for ${providerName} could not be decrypted (auth tag mismatch). ` +
        `The encrypted value may have been tampered with. Re-add with /model-key ${providerName}.`
    );
  }
}

export function isEncryptedCredential(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function credentialKeyExists(): boolean {
  return fs.existsSync(getCredentialKeyPath());
}

export function deleteCredentialKey(): void {
  try {
    fs.unlinkSync(getCredentialKeyPath());
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
