const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

// Define where the encrypted blob will live
const VAULT_PATH = path.join(app.getPath('userData'), 'identity.vault');

const Vault = {
    /**
     * Encrypts and saves the pairing identity to disk.
     * @param {string} userId 
     * @param {string} token 
     * @returns {boolean} Success status
     */
    saveIdentity: (userId, token) => {
        try {
            if (!safeStorage.isEncryptionAvailable()) {
                console.error("[VAULT] Security Error: OS Encryption not available.");
                return false;
            }

            // Create a JSON string of the identity
            const rawData = JSON.stringify({ userId, token });
            
            // Encrypt it using Windows DPAPI / Mac Keychain
            const encryptedBuffer = safeStorage.encryptString(rawData);
            
            // Save the encrypted binary buffer to disk
            fs.writeFileSync(VAULT_PATH, encryptedBuffer);
            
            console.log("[VAULT] Identity securely locked in the vault.");
            return true;
        } catch (error) {
            console.error("[VAULT] Failed to save identity:", error);
            return false;
        }
    },

    /**
     * Reads and decrypts the pairing identity from disk.
     * @returns {Object|null} { userId, token } or null if empty/failed
     */
    loadIdentity: () => {
        try {
            if (!fs.existsSync(VAULT_PATH)) {
                console.log("[VAULT] No identity found. Bridge is unlinked.");
                return null;
            }

            // Read the encrypted binary data
            const encryptedBuffer = fs.readFileSync(VAULT_PATH);
            
            // Decrypt it back to a string
            const rawString = safeStorage.decryptString(encryptedBuffer);
            
            console.log("[VAULT] Identity successfully decrypted.");
            return JSON.parse(rawString);
        } catch (error) {
            console.error("[VAULT] Failed to decrypt identity (Data may be corrupted or moved):", error);
            return null;
        }
    },

    /**
     * Wipes the vault (used for unpairing/logout).
     */
    clearIdentity: () => {
        try {
            if (fs.existsSync(VAULT_PATH)) {
                fs.unlinkSync(VAULT_PATH);
                console.log("[VAULT] Identity wiped. Bridge returned to factory state.");
            }
        } catch (error) {
            console.error("[VAULT] Failed to clear vault:", error);
        }
    }
};

module.exports = Vault;