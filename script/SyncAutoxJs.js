// START  User Config
const url = 'http://192.168.5.194:5033'
const username = 'admin'
const token = 'admin'
const intervalTime = 3 * 1000                        // 3 seconds
const showToastNotification = true

// End-to-End Encryption (set the SAME password as your desktop client)
// Leave empty to disable encryption
const encryptionPassword = ''
// END    User Config

const axios = require('axios');

const authHeader = 'basic ' + $base64.encode(`${username}:${token}`)

let urlWithoutSlash = url
while (urlWithoutSlash.endsWith('/'))
    urlWithoutSlash = urlWithoutSlash.substring(0, urlWithoutSlash.length - 1)
const apiUrl = urlWithoutSlash + '/SyncClipboard.json'

let running = false
let remoteCache;

// ====== E2E Encryption Helpers ======

const PBKDF2_ITERATIONS = 600000;
const KEY_SIZE_BYTES = 32;
const NONCE_SIZE = 12;
const VERSION = 1;
const SALT_PREFIX = "SyncClipboardE2EE:v1:salt:";
const VERIFY_PREFIX = "SyncClipboardE2EE:v1:verify:";

// Import Java crypto classes
const SecretKeyFactory = javax.crypto.SecretKeyFactory;
const PBEKeySpec = javax.crypto.spec.PBEKeySpec;
const SecretKeySpec = javax.crypto.spec.SecretKeySpec;
const GCMParameterSpec = javax.crypto.spec.GCMParameterSpec;
const Cipher = javax.crypto.Cipher;
const MessageDigest = java.security.MessageDigest;
const SecureRandom = java.security.SecureRandom;
const Base64 = android.util.Base64;

let derivedKey = null;       // byte[] — AES-256 key
let encryptionEnabled = false;

function initEncryption() {
    if (!encryptionPassword || encryptionPassword.length === 0) {
        return;
    }
    try {
        // Deterministic: same password → same verification hash on all devices
        var verificationHash = computeSHA256Hex(VERIFY_PREFIX + encryptionPassword);

        var storedHash = getStoredVerificationHash();
        if (storedHash) {
            // Verify the password matches what was previously set
            if (verificationHash !== storedHash) {
                toast('Encryption password is incorrect!');
                return;
            }
        } else {
            // First run: store the verification hash
            setStoredVerificationHash(verificationHash);
        }

        // Deterministic salt: same password → same salt → same AES key on all devices
        var salt = deriveSalt(encryptionPassword);
        derivedKey = deriveKey(encryptionPassword, salt);
        encryptionEnabled = true;
        console.log('Encryption enabled');
    } catch (e) {
        console.error('Failed to initialize encryption: ' + e);
        toast('Encryption init failed: ' + e);
    }
}

function getStoredVerificationHash() {
    try {
        var file = new java.io.File(context.getFilesDir(), "syncclipboard_crypto.txt");
        if (file.exists()) {
            var reader = new java.io.BufferedReader(new java.io.FileReader(file));
            var content = reader.readLine();
            reader.close();
            return content;
        }
    } catch (e) { }
    return null;
}

function setStoredVerificationHash(value) {
    try {
        var file = new java.io.File(context.getFilesDir(), "syncclipboard_crypto.txt");
        var writer = new java.io.PrintWriter(file);
        writer.print(value);
        writer.close();
    } catch (e) {
        console.error('Failed to store verification hash: ' + e);
    }
}

// Deterministic salt: SHA256("SyncClipboardE2EE:v1:salt:" + password) → first 16 bytes
function deriveSalt(password) {
    var hash = computeSHA256(SALT_PREFIX + password);
    var salt = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 16);
    java.lang.System.arraycopy(hash, 0, salt, 0, 16);
    return salt;
}

function computeSHA256Hex(input) {
    return bytesToHex(computeSHA256(input));
}

function computeSHA256(input) {
    var md = MessageDigest.getInstance("SHA-256");
    return md.digest(new java.lang.String(input).getBytes("UTF-8"));
}

function deriveKey(password, salt) {
    var jPassword = new java.lang.String(password);
    var spec = new PBEKeySpec(
        jPassword.toCharArray(),
        salt,
        PBKDF2_ITERATIONS,
        KEY_SIZE_BYTES * 8
    );
    var factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
    return factory.generateSecret(spec).getEncoded();
}

function encryptText(plaintext) {
    if (!encryptionEnabled || !derivedKey) {
        return plaintext;
    }
    try {
        var nonce = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, NONCE_SIZE);
        var sr = new SecureRandom();
        sr.nextBytes(nonce);

        var plainBytes = new java.lang.String(plaintext).getBytes("UTF-8");
        var keySpec = new SecretKeySpec(derivedKey, "AES");
        var gcmSpec = new GCMParameterSpec(128, nonce);
        var cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, keySpec, gcmSpec);
        var cipherBytes = cipher.doFinal(plainBytes);

        // Build: [1 byte: version] [12 bytes: nonce] [ciphertext+tag]
        var result = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 1 + NONCE_SIZE + cipherBytes.length);
        java.lang.reflect.Array.setByte(result, 0, VERSION);
        java.lang.System.arraycopy(nonce, 0, result, 1, NONCE_SIZE);
        java.lang.System.arraycopy(cipherBytes, 0, result, 1 + NONCE_SIZE, cipherBytes.length);

        return Base64.encodeToString(result, Base64.NO_WRAP);
    } catch (e) {
        console.error('Encryption failed: ' + e);
        return plaintext;
    }
}

function decryptText(base64Cipher) {
    if (!encryptionEnabled || !derivedKey) {
        return base64Cipher; // not encrypted, return as-is
    }
    try {
        var cipherBytes = Base64.decode(base64Cipher, Base64.DEFAULT);

        if (cipherBytes.length < 1 + NONCE_SIZE + 16) {
            console.error('Encrypted data too short: ' + cipherBytes.length);
            return base64Cipher;
        }

        var version = cipherBytes[0];
        if (version !== 1) {
            console.error('Unknown encryption version: ' + version);
            return base64Cipher;
        }

        var nonce = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, NONCE_SIZE);
        java.lang.System.arraycopy(cipherBytes, 1, nonce, 0, NONCE_SIZE);

        var encryptedPayload = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, cipherBytes.length - 1 - NONCE_SIZE);
        java.lang.System.arraycopy(cipherBytes, 1 + NONCE_SIZE, encryptedPayload, 0, encryptedPayload.length);

        var keySpec = new SecretKeySpec(derivedKey, "AES");
        var gcmSpec = new GCMParameterSpec(128, nonce);
        var cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, keySpec, gcmSpec);
        var plainBytes = cipher.doFinal(encryptedPayload);

        return new java.lang.String(plainBytes, "UTF-8");
    } catch (e) {
        console.error('Decryption failed: ' + e);
        return "[Decryption failed]";
    }
}

function bytesToHex(bytes) {
    var sb = new java.lang.StringBuilder();
    for (var i = 0; i < bytes.length; i++) {
        sb.append(java.lang.String.format("%02x", bytes[i]));
    }
    return sb.toString();
}

// ====== Local History Storage ======

const MAX_HISTORY = 100;

var historyDb = null;

function initHistoryDb() {
    try {
        var dbPath = new java.io.File(context.getFilesDir(), "syncclipboard_history.db").getAbsolutePath();
        historyDb = android.database.sqlite.SQLiteDatabase.openOrCreateDatabase(dbPath, null);
        historyDb.execSQL(
            "CREATE TABLE IF NOT EXISTS history (" +
            "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
            "text TEXT NOT NULL, " +
            "type TEXT DEFAULT 'Text', " +
            "time INTEGER NOT NULL, " +
            "encrypted INTEGER DEFAULT 0)"
        );
        console.log('History database ready, records: ' + getHistoryCount());
    } catch (e) {
        console.error('Failed to init history db: ' + e);
    }
}

function getHistoryCount() {
    if (!historyDb) return 0;
    try {
        var c = historyDb.rawQuery("SELECT COUNT(*) FROM history", null);
        c.moveToFirst();
        var count = c.getInt(0);
        c.close();
        return count;
    } catch (e) { return 0; }
}

function saveToHistory(text, encrypted) {
    if (!historyDb || !text) return;
    try {
        var cv = new android.content.ContentValues();
        cv.put("text", new java.lang.String(text));
        cv.put("type", "Text");
        cv.put("time", java.lang.System.currentTimeMillis());
        cv.put("encrypted", encrypted ? 1 : 0);
        historyDb.insert("history", null, cv);

        // Enforce max limit: delete oldest records beyond MAX_HISTORY
        var count = getHistoryCount();
        if (count > MAX_HISTORY) {
            historyDb.execSQL(
                "DELETE FROM history WHERE id NOT IN (" +
                "SELECT id FROM history ORDER BY time DESC LIMIT " + MAX_HISTORY +
                ")"
            );
        }
    } catch (e) {
        console.error('Failed to save history: ' + e);
    }
}

function queryHistory(limit, offset) {
    if (!historyDb) return [];
    try {
        var results = [];
        var c = historyDb.rawQuery(
            "SELECT id, text, type, time, encrypted FROM history ORDER BY time DESC LIMIT ? OFFSET ?",
            [String(limit), String(offset)]
        );
        while (c.moveToNext()) {
            results.push({
                id: c.getInt(0),
                text: String(c.getString(1)),
                type: String(c.getString(2)),
                time: c.getLong(3),
                encrypted: c.getInt(4) === 1
            });
        }
        c.close();
        return results;
    } catch (e) {
        console.error('Failed to query history: ' + e);
        return [];
    }
}

function searchHistory(keyword, limit) {
    if (!historyDb || !keyword) return [];
    try {
        var results = [];
        var c = historyDb.rawQuery(
            "SELECT id, text, type, time, encrypted FROM history WHERE text LIKE ? ORDER BY time DESC LIMIT ?",
            ["%" + keyword + "%", String(limit)]
        );
        while (c.moveToNext()) {
            results.push({
                id: c.getInt(0),
                text: String(c.getString(1)),
                type: String(c.getString(2)),
                time: c.getLong(3),
                encrypted: c.getInt(4) === 1
            });
        }
        c.close();
        return results;
    } catch (e) {
        console.error('Failed to search history: ' + e);
        return [];
    }
}

function deleteHistoryItem(id) {
    if (!historyDb) return;
    try {
        historyDb.delete("history", "id = ?", [String(id)]);
    } catch (e) {
        console.error('Failed to delete history: ' + e);
    }
}

// ====== Sync Logic ======

function loop() {
    if (!device.isScreenOn()) return;
    if (running) return;
    running = true;

    upload()
        .then(ifContinue => {
            if (ifContinue) {
                return download();
            }
        })
        .finally(() => {
            running = false;
        })
        .catch(error => {
            console.error(error);
            toast('Sync Error: \n' + error);
        });
}

function download() {
    return axios({
        method: 'get',
        url: apiUrl,
        responseType: 'json',
        headers: { 'authorization': authHeader },
    })
    .then(res => {
        if (res.status < 200 || res.status >= 300) {
            throw res.status + ' ' + res.statusText;
        } else {
            const profile = res.data;

            if (profile.type !== 'Text' || profile.hasData === true) {
                return;
            }

            var text = profile.text;

            // Decrypt if the profile is encrypted
            if (profile.encrypted === true) {
                text = decryptText(text);
            }

            if (text && text !== remoteCache) {
                remoteCache = text;
                setClip(text);
                saveToHistory(text, profile.encrypted === true);
                if (showToastNotification) {
                    let logText = text.length > 20 ? text.substring(0, 20) + "..." : text;
                    toast('同步已更新:\n' + logText);
                }
            }
        }
    });
}

function upload() {
    let text = getClip();
    if (text && text !== remoteCache && text.length !== 0) {
        var payloadText = text;
        var encrypted = false;

        if (encryptionEnabled && derivedKey) {
            payloadText = encryptText(text);
            encrypted = true;
        }

        return axios({
            method: 'put',
            url: apiUrl,
            headers: {
                'authorization': authHeader,
                'Content-Type': 'application/json',
            },
            data: {
                "hasData": false,
                "text": payloadText,
                "type": "Text",
                "encrypted": encrypted
            }
        }).then(res => {
            if (res.status < 200 || res.status >= 300) {
                throw res.status + ' ' + res.statusText;
            }
            remoteCache = text;
            saveToHistory(text, encrypted);
            return false;
        });
    }
    return Promise.resolve(true);
}

// Initialize, start
initHistoryDb();
initEncryption();
setInterval(loop, intervalTime);
