namespace SyncClipboard.Core.Models.UserConfigs;

public record class CryptoConfig
{
    public bool EncryptionEnabled { get; set; } = false;
    public string EncryptedPassword { get; set; } = string.Empty;
}
