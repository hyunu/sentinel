using System.Text.Json;

namespace UartTest.Client;

/// 직렬 포트 설정을 역할별로 저장/복원한다. 수정 시 즉시 저장된다.
public sealed class AppSettings
{
    public string? Port { get; set; }
    public int BaudRate { get; set; } = 115200;
    public int DataBits { get; set; } = 8;
    public string Parity { get; set; } = nameof(System.IO.Ports.Parity.None);
    public string StopBits { get; set; } = nameof(System.IO.Ports.StopBits.One);

    private static string SettingsPathFor(string role)
    {
        var safe = new string(role.Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '_' : c).ToArray());
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "SentinelUartTest", $"settings-{safe}.json");
    }

    public static AppSettings LoadForRole(string role)
    {
        try
        {
            var path = SettingsPathFor(role);
            if (File.Exists(path))
                return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(path)) ?? new AppSettings();
        }
        catch { /* 손상된 설정 파일은 무시하고 기본값 사용 */ }
        return new AppSettings();
    }

    public void SaveForRole(string role)
    {
        try
        {
            var path = SettingsPathFor(role);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { /* 저장 실패는 무시 */ }
    }
}
