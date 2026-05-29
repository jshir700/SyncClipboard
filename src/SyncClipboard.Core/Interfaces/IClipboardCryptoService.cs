namespace SyncClipboard.Core.Interfaces;

public interface IClipboardCryptoService
{
    bool IsEnabled { get; }
    void UpdateConfig(bool enabled, string? passwordHash);
    void LoadOrDeriveKey(string password);
    string SetPassword(string password);
    void DisableEncryption();
    Task EncryptFileAsync(string sourcePath, string destPath, CancellationToken ct);
    Task DecryptFileAsync(string sourcePath, string destPath, CancellationToken ct);
    byte[] EncryptBytes(byte[] plaintext);
    byte[] DecryptBytes(byte[] ciphertext);
    string? EncryptText(string? text);
    string DecryptText(string base64Cipher);
}
