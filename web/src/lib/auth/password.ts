import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(password: string) {
    const salt = randomBytes(16).toString("base64url");
    const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
    return `scrypt$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string) {
    const [algorithm, salt, expected] = encoded.split("$");
    if (algorithm !== "scrypt" || !salt || !expected) return false;
    const expectedBuffer = Buffer.from(expected, "base64url");
    const derived = (await scrypt(password, salt, expectedBuffer.length)) as Buffer;
    return derived.length === expectedBuffer.length && timingSafeEqual(derived, expectedBuffer);
}
