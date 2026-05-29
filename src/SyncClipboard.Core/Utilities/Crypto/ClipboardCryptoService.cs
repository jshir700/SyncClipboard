using SyncClipboard.Core.Interfaces;
using System.Security.Cryptography;
using System.Text;

namespace SyncClipboard.Core.Utilities.Crypto;

public class ClipboardCryptoService : IClipboardCryptoService, IDisposable
{
    private const int PBKDF2_ITERATIONS = 600_000;
    private const int KEY_SIZE = 32;
    private const int NONCE_SIZE = 12;
    private const int VERSION = 1;
    private const string SALT_PREFIX = "SyncClipboardE2EE:v1:salt:";
    private const string VERIFY_PREFIX = "SyncClipboardE2EE:v1:verify:";

    private bool _encryptionEnabled;
    private string _encryptedPasswordHash = string.Empty;
    private byte[]? _derivedKey;

    public bool IsEnabled => _encryptionEnabled && !string.IsNullOrEmpty(_encryptedPasswordHash);

    public void UpdateConfig(bool enabled, string? passwordHash)
    {
        _encryptionEnabled = enabled;
        _encryptedPasswordHash = passwordHash ?? string.Empty;
        if (!enabled)
        {
            ClearKey();
        }
    }

    public void LoadOrDeriveKey(string password)
    {
        if (!_encryptionEnabled || string.IsNullOrEmpty(_encryptedPasswordHash))
            throw new InvalidOperationException("Encryption is not configured.");

        if (!VerifyPassword(password, _encryptedPasswordHash))
            throw new InvalidOperationException("Incorrect password.");

        var salt = DeriveSalt(password);
        _derivedKey = DeriveKey(password, salt);
    }

    public string SetPassword(string password)
    {
        var hash = ComputeVerificationHash(password);
        _encryptionEnabled = true;
        _encryptedPasswordHash = hash;
        var salt = DeriveSalt(password);
        _derivedKey = DeriveKey(password, salt);
        return hash;
    }

    public void DisableEncryption()
    {
        _encryptionEnabled = false;
        _encryptedPasswordHash = string.Empty;
        ClearKey();
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
            aes.Encrypt(nonce, plaintext,
                ciphertext.AsSpan(4 + NONCE_SIZE, plaintext.Length),
                ciphertext.AsSpan(4 + NONCE_SIZE + plaintext.Length, 16));
        }
        finally { aes.Dispose(); }

        File.WriteAllBytes(destPath, ciphertext);
        return Task.CompletedTask;
    }

    public Task DecryptFileAsync(string sourcePath, string destPath, CancellationToken ct)
    {
        EnsureKeyReady();

        var ciphertext = File.ReadAllBytes(sourcePath);

        if (ciphertext.Length < 4 + NONCE_SIZE + 16)
            throw new InvalidOperationException("Encrypted file is too short.");

        var version = BitConverter.ToInt32(ciphertext, 0);
        if (version != VERSION)
            throw new InvalidOperationException($"Unsupported encryption version: {version}");

        var nonce = new byte[NONCE_SIZE];
        Array.Copy(ciphertext, 4, nonce, 0, NONCE_SIZE);
        var dataLen = ciphertext.Length - 4 - NONCE_SIZE;
        var cipherData = new byte[dataLen];
        Array.Copy(ciphertext, 4 + NONCE_SIZE, cipherData, 0, dataLen);
        var plaintext = new byte[dataLen - 16];

        var aes = new AesGcm(_derivedKey!, NONCE_SIZE);
        try
        {
            aes.Decrypt(nonce, cipherData.AsSpan(0, dataLen - 16), cipherData.AsSpan(dataLen - 16, 16), plaintext);
        }
        finally { aes.Dispose(); }

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
        aes.Encrypt(nonce, plaintext,
            result.AsSpan(1 + NONCE_SIZE, plaintext.Length),
            result.AsSpan(1 + NONCE_SIZE + plaintext.Length, 16));
        return result;
    }

    public byte[] DecryptBytes(byte[] ciphertext)
    {
        EnsureKeyReady();
        if (ciphertext.Length < 1 + NONCE_SIZE + 16)
            throw new InvalidOperationException("Encrypted data is too short.");
        var version = ciphertext[0];
        if (version != VERSION)
            throw new InvalidOperationException($"Unsupported encryption version: {version}");
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
        return Convert.ToBase64String(EncryptBytes(Encoding.UTF8.GetBytes(text)));
    }

    public string DecryptText(string base64Cipher)
    {
        return Encoding.UTF8.GetString(DecryptBytes(Convert.FromBase64String(base64Cipher)));
    }

    private static byte[] DeriveSalt(string password)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(SALT_PREFIX + password));
        return hash.AsSpan(0, 16).ToArray();
    }

    private static string ComputeVerificationHash(string password)
    {
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(VERIFY_PREFIX + password)));
    }

    private static bool VerifyPassword(string password, string storedHash)
    {
        return CryptographicOperations.FixedTimeEquals(
            Convert.FromHexString(ComputeVerificationHash(password)),
            Convert.FromHexString(storedHash));
    }

    private static byte[] DeriveKey(string password, byte[] salt)
    {
        return Rfc2898DeriveBytes.Pbkdf2(password, salt, PBKDF2_ITERATIONS, HashAlgorithmName.SHA256, KEY_SIZE);
    }

    private void EnsureKeyReady()
    {
        if (_derivedKey is null)
            throw new InvalidOperationException("Encryption key is not loaded. Call LoadOrDeriveKey() first.");
    }

    private void ClearKey()
    {
        if (_derivedKey is not null)
        {
            CryptographicOperations.ZeroMemory(_derivedKey);
            _derivedKey = null;
        }
    }

    public void Dispose()
    {
        ClearKey();
        GC.SuppressFinalize(this);
    }
}
