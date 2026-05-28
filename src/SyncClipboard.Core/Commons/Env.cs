using System.Text.Json;
using System.Text.Json.Nodes;

namespace SyncClipboard.Core.Commons
{
    public static class Env
    {
        public const string SoftName = "SyncClipboard";
        public const string HomePage = "https://github.com/jshir700/SyncClipboard";
        public const string AppVersion = SyncClipboardProperty.AppVersion;

        public const string RequestServerVersion = "3.1.1";
        public const string UpdateApiUrl = "https://api.github.com/repos/jshir700/SyncClipboard/releases";
        public const string UpdateUrl = "https://github.com/jshir700/SyncClipboard/releases";

        public const string RuntimeConfigName = "RuntimeConfig.json";
        public const string UpdateInfoFile = "update_info.json";
        public const string LinuxPackageAppId = "com.jshir700.desktop.syncclipboard";
        public static readonly string LinuxUserDesktopEntryFolder = UserPath(".local/share/applications");
        public static readonly string ProgramDirectory = AppDomain.CurrentDomain.BaseDirectory;
        /// <summary>
        /// Path to the independent config file that stores the custom AppData directory.
        /// Always located in a fixed sibling folder that never changes, never in the custom path.
        /// </summary>
        public static readonly string AppDataPathConfigPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            SoftName + "_global", "GlobalConfig.json");
        public static readonly string AppDataDirectory = GetOrCreateFolder(GetAppDataDirectory());
        public static readonly string UserAppDataDirectory = GetUserAppDataDirectory();
        public static readonly string ProgramPath = GetProgramPath();
        public static readonly string UserConfigFile = FullPath("SyncClipboard.json");
        public static readonly string PortableUserConfigFile = Path.Combine(ProgramDirectory, "SyncClipboard.json");
        public static readonly string RuntimeConfigPath = FullPath(RuntimeConfigName);
        public static readonly string StaticConfigPath = Path.Combine(ProgramDirectory, "StaticConfig.json");
        public static readonly string UpdateInfoPath = Path.Combine(ProgramDirectory, UpdateInfoFile);
        public static readonly string AppDataFileFolder = GetOrCreateFolder(FullPath("file"));
        public static readonly string AppDataAssetsFolder = GetOrCreateFolder(FullPath("assets"));
        public static readonly string AppDataDbPath = GetOrCreateFolder(FullPath("data"));
        public static readonly string HistoryFileFolder = GetOrCreateFolder(Path.Combine(FullPath("file"), "history"));
        public static string TemplateFileFolder => GetTemplateFileFolder();
        public static string ImageTemplateFolder => Path.Combine(TemplateFileFolder, "temp images");
        public static readonly string LogFolder = FullPath("log");
        public static readonly string UpdateFolder = GetOrCreateFolder(FullPath("update"));

        public static readonly string[] AppDataCopyWhitelistFolders = ["data", "file", "log", "server", "update"];
        public static readonly string[] AppDataCopyWhitelistFiles = [RuntimeConfigName, "SyncClipboard.json"];

        public static bool IsUsingCustomAppDataDirectory =>
            !IsSamePath(AppDataDirectory, Path.Combine(UserAppDataDirectory, SoftName));

        public static bool IsSamePath(string path1, string path2) =>
            string.Equals(
                Path.TrimEndingDirectorySeparator(Path.GetFullPath(path1)),
                Path.TrimEndingDirectorySeparator(Path.GetFullPath(path2)),
                OperatingSystem.IsLinux() ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase);

        public static string FullPath(string relativePath)
        {
            return Path.Combine(AppDataDirectory, relativePath);
        }

        private static string GetUserAppDataDirectory()
        {
            return Environment.GetFolderPath(
                   Environment.SpecialFolder.ApplicationData,
                   Environment.SpecialFolderOption.Create) ?? throw new Exception("Can not open system app data folder.");
        }

        public static string GetUserHomeFolder()
        {
            return Environment.GetFolderPath(Environment.SpecialFolder.UserProfile,
                   Environment.SpecialFolderOption.Create) ?? throw new Exception("Can not open user home folder.");
        }

        public static string UserPath(string path)
        {
            return Path.Combine(GetUserHomeFolder(), path);
        }

        private static string GetAppDataDirectory()
        {
            var customPath = TryGetCustomAppDataDirectory();
            if (customPath != null)
            {
                return customPath;
            }
            var appDataDirectory = Path.Combine(GetUserAppDataDirectory(), SoftName);
            return appDataDirectory;
        }

        private static string? TryGetCustomAppDataDirectory()
        {
            try
            {
                if (!File.Exists(AppDataPathConfigPath)) return null;
                var text = File.ReadAllText(AppDataPathConfigPath);
                var jsonNode = JsonNode.Parse(text);
                var customPath = jsonNode?["CustomAppDataDirectory"]?.GetValue<string>();
                if (string.IsNullOrEmpty(customPath)) return null;
                if (!Directory.Exists(customPath)) return null;
                return customPath;
            }
            catch
            {
                return null;
            }
        }

        private static readonly JsonSerializerOptions _indentedJsonOptions = new() { WriteIndented = true };

        public static async Task SaveCustomAppDataDirectoryAsync(string path)
        {
            var configDir = Path.GetDirectoryName(AppDataPathConfigPath)!;
            Directory.CreateDirectory(configDir);
            var json = JsonSerializer.Serialize(
                new { CustomAppDataDirectory = path },
                _indentedJsonOptions);
            await File.WriteAllTextAsync(AppDataPathConfigPath, json);
        }

        private static string GetOrCreateFolder(string path)
        {
            if (Directory.Exists(path) is false)
            {
                Directory.CreateDirectory(path);
            }
            return path;
        }

        private static string? _templateFileFolder;
        private static DateTime? _dateTime;

        private static string GetTemplateFileFolder()
        {
            var dateTime = DateTime.Today;
            if (dateTime != _dateTime || _templateFileFolder is null)
            {
                _dateTime = dateTime;
                _templateFileFolder = Path.Combine(AppDataFileFolder, dateTime.ToString("yyyyMMdd"));
                Directory.CreateDirectory(_templateFileFolder);
            }
            return _templateFileFolder;
        }

        public static string? GetAppImageExecPath()
        {
            var ARGV0 = Environment.GetEnvironmentVariable("ARGV0");
            var APPDIR = Environment.GetEnvironmentVariable("APPDIR");
            var OWD = Environment.GetEnvironmentVariable("OWD");
            if (string.IsNullOrEmpty(ARGV0) is false &&
                string.IsNullOrEmpty(APPDIR) is false &&
                string.IsNullOrEmpty(OWD) is false)
            {
                return Path.GetFullPath(ARGV0);
            }
            return null;
        }

        private static string GetProgramPath()
        {
            if (OperatingSystem.IsLinux())
            {
                if (GetAppImageExecPath() is string appImagePath)
                {
                    return appImagePath;
                }
            }

            return Environment.ProcessPath ?? throw new Exception("Can not get program path.");
        }
    }
}