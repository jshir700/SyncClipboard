using SyncClipboard.Core.Commons;
using SyncClipboard.Core.Interfaces;
using System.Security.Cryptography;
using System.Text;
using CryptoConfig = SyncClipboard.Core.Models.UserConfigs.CryptoConfig;

namespace SyncClipboard.Core.Utilities.Crypto;

public class ClipboardCryptoService : IClipboardCryptoService, IDisposable
{
    private const int PBKDF2_ITERATIONS = 600_000;
    private const int KEY_SIZE = 32;
    private const int NONCE_SIZE = 12;
    private const int VERSION = 1;
    private const string SALT_PREFIX = "SyncClipboardE2EE:v1:salt:";
    private const string VERIFY_PREFIX = "SyncClipboardE2EE:v1:verify:";

    private readonly ConfigManager _configManager;
    private byte[]? _derivedKey;

    public bool IsEnabled
    {
        get
        {
            var config = _configManager.GetConfig<CryptoConfig>();
            return config.EncryptionEnabled && !string.IsNullOrEmpty(config.EncryptedPassword);
        }
    }

    public ClipboardCryptoService(ConfigManager configManager)
    {
        _configManager = configManager;
    }

    public void LoadOrDeriveKey(string password)
    {
        var config = _configManager.GetConfig<CryptoConfig>();
        if (!config.EncryptionEnabled || string.IsNullOrEmpty(config.EncryptedPassword))
        {
            throw new InvalidOperationException("Encryption is not configured.");
        }

        if (!VerifyPassword(password, config.EncryptedPassword))
        {
            throw new InvalidOperationException("Incorrect password.");
        }

        var salt = DeriveSalt(password);
        _derivedKey = DeriveKey(password, salt);
    }

    public void SetPassword(string password)
    {
        var verificationHash = ComputeVerificationHash(password);
        var config = _configManager.GetConfig<CryptoConfig>();
        config.EncryptedPassword = verificationHash;
        config.EncryptionEnabled = true;

        var salt = DeriveSalt(password);
        _derivedKey = DeriveKey(password, salt);
    }

    public void DisableEncryption()
    {
        var config = _configManager.GetConfig<CryptoConfig>();
        config.EncryptionEnabled = false;
        config.EncryptedPassword = string.Empty;
        if (_derivedKey is not null)
        {
            CryptographicOperations.ZeroMemory(_derivedKey);
            _derivedKey = null;
        }
    }

    public Task EncryptFileAsync(string sourcePath, string destPath, CancellationToken ct)
    {
        EnsureKeyReady();

        var nonce = RandomNumberGenerator.GetBytes(NONCE_SIZE);
        var plaintext = File.ReadAllBytes(sourcePath);

        var ciphertext = new byte[4 + NONCE_SIZE + plaintext.Length + 16];
        BitConverter.TryWriteBytes(ciphertext.AsSpan(0, 4), VERSION);
        nonce.CopyTo(ciphertext.AsSpan(4, NONCE_SIZE));

        var aes = new AesGcm(_derivedKey!, NONCE_SIZE);
        try
        {
            aes.Encrypt(
                nonce,
                plaintext,
                ciphertext.AsSpan(4 + NONCE_SIZE, plaintext.Length),
                ciphertext.AsSpan(4 + NONCE_SIZE + plaintext.Length, 16));
        }
        finally
        {
            aes.Dispose();
        }

        File.WriteAllBytes(destPath, ciphertext);
        return Task.CompletedTask;
    }

    public Task DecryptFileAsync(string sourcePath, string destPath, CancellationToken ct)
    {
        EnsureKeyReady();

        var ciphertext = File.ReadAllBytes(sourcePath);

        if (ciphertext.Length < 4 + NONCE_SIZE + 16)
        {
            throw new InvalidOperationException("Encrypted file is too short.");
        }

        var version = BitConverter.ToInt32(ciphertext, 0);
        if (version != VERSION)
        {
            throw new InvalidOperationException($"Unsupported encryption version: {version}");
        }

        var nonceOffset = 4;
        var dataOffset = 4 + NONCE_SIZE;
        var nonce = new byte[NONCE_SIZE];
        Array.Copy(ciphertext, nonceOffset, nonce, 0, NONCE_SIZE);
        var dataLen = ciphertext.Length - dataOffset;
        var cipherData = new byte[dataLen];
        Array.Copy(ciphertext, dataOffset, cipherData, 0, dataLen);
        var plaintext = new byte[dataLen - 16];

        var aes = new AesGcm(_derivedKey!, NONCE_SIZE);
        try
        {
            aes.Decrypt(nonce, cipherData.AsSpan(0, dataLen - 16), cipherData.AsSpan(dataLen - 16, 16), plaintext);
        }
        finally
        {
            aes.Dispose();
        }

        File.WriteAllBytes(destPath, plaintext);
        return Task.CompletedTask;
    }

    public byte[] EncryptBytes(byte[] plaintext)
    {
        EnsureKeyReady();

        var nonce = RandomNumberGenerator.GetBytes(NONCE_SIZE);
        var result = new byte[1 + NONCE_SIZE + plaintext.Length + 16];
        result[0] = (byte)VERSION;
        nonce.CopyTo(result.AsSpan(1, NONCE_SIZE));

        using var aes = new AesGcm(_derivedKey!, NONCE_SIZE);
        aes.Encrypt(nonce, plaintext, result.AsSpan(1 + NONCE_SIZE, plaintext.Length), result.AsSpan(1 + NONCE_SIZE + plaintext.Length, 16));

        return result;
    }

    public byte[] DecryptBytes(byte[] ciphertext)
    {
        EnsureKeyReady();

        if (ciphertext.Length < 1 + NONCE_SIZE + 16)
        {
            throw new InvalidOperationException("Encrypted data is too short.");
        }

        var version = ciphertext[0];
        if (version != VERSION)
        {
            throw new InvalidOperationException($"Unsupported encryption version: {version}");
        }

        var nonce = ciphertext.AsSpan(1, NONCE_SIZE);
        var cipherData = ciphertext.AsSpan(1 + NONCE_SIZE);
        var plaintext = new byte[cipherData.Length - 16];

        using var aes = new AesGcm(_derivedKey!, NONCE_SIZE);
        aes.Decrypt(nonce, cipherData[..^16], cipherData[^16..], plaintext);

        return plaintext;
    }

    public string? EncryptText(string? text)
    {
        if (text is null) return null;
        var plainBytes = Encoding.UTF8.GetBytes(text);
        var cipherBytes = EncryptBytes(plainBytes);
        return Convert.ToBase64String(cipherBytes);
    }

    public string DecryptText(string base64Cipher)
    {
        var cipherBytes = Convert.FromBase64String(base64Cipher);
        var plainBytes = DecryptBytes(cipherBytes);
        return Encoding.UTF8.GetString(plainBytes);
    }

    // ====== Deterministic key derivation (same password → same key across all devices) ======

    /// <summary>
    /// Derive a deterministic 16-byte salt from the password.
    /// Same password always produces the same salt, ensuring all devices derive the identical AES key.
    /// </summary>
    private static byte[] DeriveSalt(string password)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(SALT_PREFIX + password));
        return hash.AsSpan(0, 16).ToArray();
    }

    /// <summary>
    /// Compute the verification hash stored in config. Used to verify the password is correct.
    /// </summary>
    private static string ComputeVerificationHash(string password)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(VERIFY_PREFIX + password));
        return Convert.ToHexString(hash);
    }

    /// <summary>
    /// Check if the entered password matches the stored verification hash.
    /// </summary>
    private static bool VerifyPassword(string password, string storedHash)
    {
        var expectedHash = ComputeVerificationHash(password);
        return CryptographicOperations.FixedTimeEquals(
            Convert.FromHexString(expectedHash),
            Convert.FromHexString(storedHash));
    }

    private static byte[] DeriveKey(string password, byte[] salt)
    {
        return Rfc2898DeriveBytes.Pbkdf2(password, salt, PBKDF2_ITERATIONS, HashAlgorithmName.SHA256, KEY_SIZE);
    }

    private void EnsureKeyReady()
    {
        if (_derivedKey is null)
        {
            throw new InvalidOperationException("Encryption key is not loaded. Call LoadOrDeriveKey() first.");
        }
    }

    public void Dispose()
    {
        if (_derivedKey is not null)
        {
            CryptographicOperations.ZeroMemory(_derivedKey);
            _derivedKey = null;
        }
    }
}
