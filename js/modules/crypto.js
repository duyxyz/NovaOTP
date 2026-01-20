/**
 * Encryption module using Web Crypto API (AES-GCM)
 */

const ALGORITHM = 'AES-GCM';
const KDF_ALGORITHM = 'PBKDF2';
const HASH = 'SHA-256';
const ITERATIONS = 100000;

/**
 * Encrypts a string using a password
 */
export async function encryptData(plainText, password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plainText);

    // Generate a random salt
    const salt = crypto.getRandomValues(new Uint8Array(16));

    // Derive a key from the password
    const passwordKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        { name: KDF_ALGORITHM },
        false,
        ['deriveKey']
    );

    const key = await crypto.subtle.deriveKey(
        {
            name: KDF_ALGORITHM,
            salt: salt,
            iterations: ITERATIONS,
            hash: HASH
        },
        passwordKey,
        { name: ALGORITHM, length: 256 },
        false,
        ['encrypt']
    );

    // Generate a random IV
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Encrypt the data
    const ciphertext = await crypto.subtle.encrypt(
        { name: ALGORITHM, iv: iv },
        key,
        data
    );

    // Combine salt, iv, and ciphertext into a single base64 string
    const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(ciphertext), salt.length + iv.length);

    return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypts a base64 string using a password
 */
export async function decryptData(tupleBase64, password) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const combined = new Uint8Array(
        atob(tupleBase64)
            .split('')
            .map(c => c.charCodeAt(0))
    );

    // Extract salt, iv, and ciphertext
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 28);
    const ciphertext = combined.slice(28);

    // Derive the key from the password and salt
    const passwordKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        { name: KDF_ALGORITHM },
        false,
        ['deriveKey']
    );

    const key = await crypto.subtle.deriveKey(
        {
            name: KDF_ALGORITHM,
            salt: salt,
            iterations: ITERATIONS,
            hash: HASH
        },
        passwordKey,
        { name: ALGORITHM, length: 256 },
        false,
        ['decrypt']
    );

    try {
        const decrypted = await crypto.subtle.decrypt(
            { name: ALGORITHM, iv: iv },
            key,
            ciphertext
        );
        return decoder.decode(decrypted);
    } catch (e) {
        throw new Error('Decryption failed. Incorrect password?');
    }
}

/**
 * Generates a unique filename based on the password hash
 * to allow multiple independent backups in the same Gist.
 */
export async function generateBackupFilename(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + "nova_otp_salt"); // Add a small salt
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `nova_otp_${hashHex.substring(0, 12)}.txt`;
}
