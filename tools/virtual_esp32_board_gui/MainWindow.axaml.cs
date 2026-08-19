using System.Collections.ObjectModel;
using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Platform.Storage;

namespace VirtualEsp32Board.Gui;

public partial class MainWindow : Window
{
    private readonly ObservableCollection<string> _logs = [];
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(15) };
    private CancellationTokenSource? _cts;
    private const string NewBoardChoiceKey = "__NEW__";
    private List<BoardChoice> _boardChoices = [];

    public MainWindow()
    {
        InitializeComponent();
        LogList.ItemsSource = _logs;

        CsvPathBox.Text = Path.Combine(AppContext.BaseDirectory, "LCP_TEST_M8_2026-06-22_17-29-45.CSV");
        UidBox.Text = "VESP32-GUI";

        BrowseCsvButton.Click += OnBrowseCsvClicked;
        RefreshBoardsButton.Click += OnRefreshBoardsClicked;
        StartButton.Click += OnStartClicked;
        StopButton.Click += OnStopClicked;
        RegisteredBoardCombo.SelectionChanged += OnBoardPresetChanged;
        CsvPathBox.LostFocus += (_, _) => LoadRolesFromCsv(CsvPathBox.Text);

        _ = RefreshRegisteredBoardsAsync();
        LoadRolesFromCsv(CsvPathBox.Text);
    }

    private void LoadRolesFromCsv(string? csvPath)
    {
        if (string.IsNullOrWhiteSpace(csvPath) || !File.Exists(csvPath)) return;

        try
        {
            var previous = RoleCombo.Text?.Trim();
            var roles = CsvLoader.Load(csvPath)
                .Select(p => p.Sender)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(x => x, StringComparer.OrdinalIgnoreCase)
                .ToList();

            RoleCombo.ItemsSource = roles;
            RoleCombo.SelectedItem = ResolveRole(previous, roles);
        }
        catch (Exception ex)
        {
            Log("WARN: role load failed: " + ex.Message);
        }
    }

    private async void OnRefreshBoardsClicked(object? sender, RoutedEventArgs e)
    {
        await RefreshRegisteredBoardsAsync().ConfigureAwait(true);
    }

    private void OnBoardPresetChanged(object? sender, SelectionChangedEventArgs e)
    {
        var selected = RegisteredBoardCombo.SelectedItem as BoardChoice;
        if (selected == null || selected.Key == NewBoardChoiceKey) return;
        if (selected.Board == null) return;

        if (!string.IsNullOrWhiteSpace(selected.Board.Uid)) UidBox.Text = selected.Board.Uid;
        if (!string.IsNullOrWhiteSpace(selected.Board.Name)) BoardNameBox.Text = selected.Board.Name;
        if (!string.IsNullOrWhiteSpace(selected.Board.MacAddress)) MacBox.Text = selected.Board.MacAddress;
        if (!string.IsNullOrWhiteSpace(selected.Board.WifiMac)) WifiMacBox.Text = selected.Board.WifiMac;
    }

    private async Task RefreshRegisteredBoardsAsync()
    {
        try
        {
            var apiBase = NormalizeApiBase(ServerBox.Text?.Trim() ?? "http://localhost:5050");
            var boards = await _http.GetFromJsonAsync<List<BoardDto>>($"{apiBase}/boards").ConfigureAwait(true)
                ?? [];

            _boardChoices =
            [
                new BoardChoice(NewBoardChoiceKey, "(신규 보드 등록)", null),
                .. boards
                    .Where(b => !string.IsNullOrWhiteSpace(b.Uid))
                    .OrderByDescending(b => b.UpdatedAt)
                    .Select(b => new BoardChoice(
                        b.Uid!,
                        $"{b.Name ?? "Board"} ({b.Uid})",
                        b))
            ];

            RegisteredBoardCombo.ItemsSource = _boardChoices;
            RegisteredBoardCombo.SelectedIndex = 0;
            Log($"board presets loaded: {_boardChoices.Count - 1}");
        }
        catch (Exception ex)
        {
            _boardChoices = [new BoardChoice(NewBoardChoiceKey, "(신규 보드 등록)", null)];
            RegisteredBoardCombo.ItemsSource = _boardChoices;
            RegisteredBoardCombo.SelectedIndex = 0;
            Log("WARN: board preset load failed: " + ex.Message);
        }
    }

    private async void OnBrowseCsvClicked(object? sender, RoutedEventArgs e)
    {
        var files = await StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            AllowMultiple = false,
            Title = "Select UART capture CSV",
            FileTypeFilter =
            [
                new FilePickerFileType("CSV") { Patterns = ["*.csv", "*.CSV"] },
                FilePickerFileTypes.All,
            ],
        });

        var file = files.FirstOrDefault();
        if (file != null)
        {
            CsvPathBox.Text = file.Path.LocalPath;
            LoadRolesFromCsv(CsvPathBox.Text);
        }
    }

    private async void OnStartClicked(object? sender, RoutedEventArgs e)
    {
        if (_cts != null) return;

        try
        {
            var cfg = ReadConfig();
            var packets = CsvLoader.Load(cfg.CsvPath).OrderBy(p => p.Time).ToList();
            if (packets.Count == 0) throw new InvalidOperationException("CSV has no valid rows.");

            var roles = packets.Select(p => p.Sender)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(x => x, StringComparer.OrdinalIgnoreCase)
                .ToList();
            RoleCombo.ItemsSource = roles;

            var role = ResolveRole(cfg.BoardRole, roles);
            RoleCombo.SelectedItem = role;

            _cts = new CancellationTokenSource();
            SetRunningUi(true);
            SetBadge("STREAMING", "#67E8F9");

            Log($"CSV packets={packets.Count}, role={role}");
            var apiBase = NormalizeApiBase(cfg.Server);
            var board = await RegisterBoardAsync(apiBase, cfg, _cts.Token).ConfigureAwait(true);
            Log($"board registered: {board.Name} ({board.Uid})");

            await ReplayAsync(apiBase, board, packets, role, cfg, _cts.Token).ConfigureAwait(true);
            Log("Replay finished.");
        }
        catch (OperationCanceledException)
        {
            Log("Replay cancelled.");
        }
        catch (Exception ex)
        {
            Log("ERROR: " + ex.Message);
        }
        finally
        {
            _cts?.Dispose();
            _cts = null;
            SetRunningUi(false);
            SetBadge("IDLE", "#7DD3FC");
        }
    }

    private void OnStopClicked(object? sender, RoutedEventArgs e)
    {
        _cts?.Cancel();
    }

    private Config ReadConfig()
    {
        var csv = CsvPathBox.Text?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(csv) || !File.Exists(csv))
            throw new InvalidOperationException("CSV path is invalid.");

        var server = ServerBox.Text?.Trim() ?? "http://localhost:5050";
        var speed = ParseDouble(SpeedBox.Text, 1.0, min: 0.0001);
        var maxPackets = ParseInt(MaxPacketsBox.Text, 0, min: 0);
        var logEvery = ParseInt(LogEveryBox.Text, 200, min: 1);
        var heartbeatSeconds = ParseInt(HeartbeatBox.Text, 10, min: 1);
        var loop = LoopCheck.IsChecked ?? false;
        var loopCount = ParseInt(LoopCountBox.Text, 0, min: 0);

        var preset = RegisteredBoardCombo.SelectedItem as BoardChoice;
        var firstLikeNew = FirstRegistrationCheck.IsChecked ?? true;

        string uid;
        string boardName;
        string mac;
        string wifiMac;

        if (firstLikeNew)
        {
            var identity = GenerateFirstRegistrationIdentity();
            uid = identity.Uid;
            boardName = identity.BoardName;
            mac = identity.MacAddress;
            wifiMac = identity.WifiMac;
        }
        else if (preset is { Key: not NewBoardChoiceKey, Board: not null })
        {
            uid = preset.Board.Uid ?? (UidBox.Text?.Trim() ?? "VESP32-GUI");
            boardName = preset.Board.Name ?? (BoardNameBox.Text?.Trim() ?? "Virtual-ESP32 GUI");
            mac = preset.Board.MacAddress ?? (MacBox.Text?.Trim() ?? "AA:BB:CC:DD:EE:11");
            wifiMac = preset.Board.WifiMac ?? (WifiMacBox.Text?.Trim() ?? "AA:BB:CC:DD:EE:12");
        }
        else
        {
            uid = UidBox.Text?.Trim() ?? "VESP32-GUI";
            boardName = BoardNameBox.Text?.Trim() ?? "Virtual-ESP32 GUI";
            mac = MacBox.Text?.Trim() ?? "AA:BB:CC:DD:EE:11";
            wifiMac = WifiMacBox.Text?.Trim() ?? "AA:BB:CC:DD:EE:12";
        }

        UidBox.Text = uid;
        BoardNameBox.Text = boardName;
        MacBox.Text = mac;
        WifiMacBox.Text = wifiMac;

        return new Config(
            CsvPath: csv,
            Server: server,
            BoardRole: RoleCombo.Text?.Trim(),
            BoardName: boardName,
            MacAddress: mac,
            WifiMac: wifiMac,
            Uid: uid,
            ProtocolId: string.IsNullOrWhiteSpace(ProtocolIdBox.Text) ? null : ProtocolIdBox.Text.Trim(),
            Location: "tools/virtual_esp32_board_gui",
            Speed: speed,
            MaxPackets: maxPackets,
            LogEvery: logEvery,
            HeartbeatSeconds: heartbeatSeconds,
            Loop: loop,
            LoopCount: loopCount
        );
    }

    private static (string Uid, string BoardName, string MacAddress, string WifiMac) GenerateFirstRegistrationIdentity()
    {
        var stamp = DateTime.UtcNow.ToString("yyMMddHHmmss", CultureInfo.InvariantCulture);
        var uid = $"VESP32-{stamp}";
        var boardName = $"Virtual-ESP32-{stamp}";

        var bytes = Guid.NewGuid().ToByteArray();
        var mac = $"02:42:{bytes[0]:X2}:{bytes[1]:X2}:{bytes[2]:X2}:{bytes[3]:X2}";
        var wifiMac = $"02:43:{bytes[4]:X2}:{bytes[5]:X2}:{bytes[6]:X2}:{bytes[7]:X2}";
        return (uid, boardName, mac, wifiMac);
    }

    private static string ResolveRole(string? requested, IReadOnlyList<string> roles)
    {
        if (!string.IsNullOrWhiteSpace(requested))
        {
            var trimmed = requested.Trim();
            if (roles.Any(r => string.Equals(r, trimmed, StringComparison.OrdinalIgnoreCase)))
                return trimmed;
        }

        if (roles.Count > 0) return roles[0];
        return "A";
    }

    private async Task ReplayAsync(
        string apiBase,
        BoardInfo board,
        IReadOnlyList<CsvPacket> packets,
        string boardRole,
        Config cfg,
        CancellationToken ct)
    {
        int loop = 0;
        while (!ct.IsCancellationRequested)
        {
            loop++;
            Log($"loop #{loop} start");
            var sent = await ReplayOneLoopAsync(apiBase, board, packets, boardRole, cfg, ct).ConfigureAwait(true);
            Log($"loop #{loop} done sent={sent}");

            if (!cfg.Loop || (cfg.LoopCount > 0 && loop >= cfg.LoopCount))
                break;
        }
    }

    private async Task<int> ReplayOneLoopAsync(
        string apiBase,
        BoardInfo board,
        IReadOnlyList<CsvPacket> packets,
        string boardRole,
        Config cfg,
        CancellationToken ct)
    {
        var first = packets[0].Time;
        var sessionBase = DateTime.UtcNow;
        var sessionStart = DateTime.UtcNow;
        var maxToSend = cfg.MaxPackets > 0 ? Math.Min(cfg.MaxPackets, packets.Count) : packets.Count;

        int sent = 0;
        DateTime lastHeartbeat = DateTime.MinValue;
        ReplayProgress.Value = 0;

        for (int i = 0; i < packets.Count; i++)
        {
            ct.ThrowIfCancellationRequested();
            if (sent >= maxToSend) break;

            var packet = packets[i];
            var offset = packet.Time - first;
            var scaledOffset = TimeSpan.FromMilliseconds(offset.TotalMilliseconds / cfg.Speed);
            var targetUtc = sessionBase + scaledOffset;

            var now = DateTime.UtcNow;
            if (targetUtc > now)
                await Task.Delay(targetUtc - now, ct).ConfigureAwait(true);

            var direction = string.Equals(packet.Sender, boardRole, StringComparison.OrdinalIgnoreCase)
                ? "TX"
                : "RX";

            var payload = new
            {
                board_id = board.Id,
                raw_hex = ToHexWithSpaces(packet.Raw),
                direction,
                timestamp = targetUtc,
                protocol_id = cfg.ProtocolId,
            };

            using var res = await _http.PostAsJsonAsync($"{apiBase}/data/uart", payload, ct).ConfigureAwait(true);
            if (!res.IsSuccessStatusCode)
            {
                var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(true);
                throw new InvalidOperationException($"ingest failed ({(int)res.StatusCode}): {body}");
            }

            sent++;
            var pct = (double)sent / maxToSend * 100.0;
            ReplayProgress.Value = pct;

            if (DateTime.UtcNow - lastHeartbeat >= TimeSpan.FromSeconds(cfg.HeartbeatSeconds))
            {
                await SendHeartbeatAsync(apiBase, board.Id, ct).ConfigureAwait(true);
                lastHeartbeat = DateTime.UtcNow;
            }

            if (sent % cfg.LogEvery == 0 || sent == maxToSend)
            {
                var elapsed = DateTime.UtcNow - sessionStart;
                SummaryText.Text = $"sent {sent}/{maxToSend}  elapsed {elapsed.TotalSeconds:F1}s  role {boardRole}";
                Log($"sent {sent}/{maxToSend} {direction}");
            }
        }

        await SendHeartbeatAsync(apiBase, board.Id, ct).ConfigureAwait(true);
        ReplayProgress.Value = 100;
        return sent;
    }

    private async Task<BoardInfo> RegisterBoardAsync(string apiBase, Config cfg, CancellationToken ct)
    {
        var payload = new
        {
            name = cfg.BoardName,
            mac_address = cfg.MacAddress,
            wifi_mac = cfg.WifiMac,
            uid = cfg.Uid,
            protocol_id = cfg.ProtocolId,
            location = cfg.Location,
        };

        using var res = await _http.PostAsJsonAsync($"{apiBase}/boards/register", payload, ct).ConfigureAwait(true);
        if (!res.IsSuccessStatusCode)
        {
            var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(true);
            throw new InvalidOperationException($"register failed ({(int)res.StatusCode}): {body}");
        }

        var parsed = await res.Content.ReadFromJsonAsync<RegisterBoardResponse>(cancellationToken: ct).ConfigureAwait(true)
            ?? throw new InvalidOperationException("register response empty");

        if (parsed.Board == null || string.IsNullOrWhiteSpace(parsed.Board.Id))
            throw new InvalidOperationException("register response missing board.id");

        return new BoardInfo(parsed.Board.Id, parsed.Board.Uid ?? parsed.Uid ?? string.Empty, parsed.Board.Name ?? string.Empty);
    }

    private async Task SendHeartbeatAsync(string apiBase, string boardId, CancellationToken ct)
    {
        using var _ = await _http.PostAsJsonAsync($"{apiBase}/heartbeat", new { board_id = boardId }, ct).ConfigureAwait(true);
    }

    private static string NormalizeApiBase(string server)
    {
        var trimmed = server.Trim().TrimEnd('/');
        return trimmed.EndsWith("/api/v1", StringComparison.OrdinalIgnoreCase)
            ? trimmed
            : trimmed + "/api/v1";
    }

    private static string ToHexWithSpaces(byte[] bytes)
    {
        if (bytes.Length == 0) return string.Empty;
        return BitConverter.ToString(bytes).Replace('-', ' ');
    }

    private static double ParseDouble(string? raw, double fallback, double min)
    {
        if (double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var n) && n >= min)
            return n;
        return fallback;
    }

    private static int ParseInt(string? raw, int fallback, int min)
    {
        if (int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) && n >= min)
            return n;
        return fallback;
    }

    private void SetRunningUi(bool running)
    {
        StartButton.IsEnabled = !running;
        StopButton.IsEnabled = running;
    }

    private void SetBadge(string text, string color)
    {
        StatusBadge.Text = text;
        StatusBadge.Foreground = Avalonia.Media.Brush.Parse(color);
    }

    private void Log(string message)
    {
        var line = $"[{DateTime.Now:HH:mm:ss}] {message}";
        _logs.Add(line);
        while (_logs.Count > 600)
            _logs.RemoveAt(0);
        LogList.ScrollIntoView(line);
    }

    protected override void OnClosed(EventArgs e)
    {
        _cts?.Cancel();
        _http.Dispose();
        base.OnClosed(e);
    }

    private sealed record RegisterBoardResponse(string? Uid, BoardPayload? Board);
    private sealed record BoardPayload(string Id, string? Uid, string? Name);
    private sealed record BoardInfo(string Id, string Uid, string Name);
    private sealed record BoardChoice(string Key, string Display, BoardDto? Board)
    {
        public override string ToString() => Display;
    }

    private sealed record BoardDto(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("uid")] string? Uid,
        [property: JsonPropertyName("name")] string? Name,
        [property: JsonPropertyName("mac_address")] string? MacAddress,
        [property: JsonPropertyName("wifi_mac")] string? WifiMac,
        [property: JsonPropertyName("updated_at")] DateTime UpdatedAt
    );

    private sealed record Config(
        string CsvPath,
        string Server,
        string? BoardRole,
        string BoardName,
        string MacAddress,
        string WifiMac,
        string Uid,
        string? ProtocolId,
        string Location,
        double Speed,
        int MaxPackets,
        int LogEvery,
        int HeartbeatSeconds,
        bool Loop,
        int LoopCount
    );
}
