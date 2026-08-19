using System.Globalization;
using System.Net.Http.Json;

namespace VirtualEsp32Board;

internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        CliOptions opt;
        try
        {
            opt = CliOptions.Parse(args);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            CliOptions.PrintHelp();
            return 1;
        }

        if (opt.ShowHelp)
        {
            CliOptions.PrintHelp();
            return 0;
        }

        if (!File.Exists(opt.CsvPath))
        {
            Console.Error.WriteLine($"CSV file not found: {opt.CsvPath}");
            return 2;
        }

        IReadOnlyList<CsvPacket> packets;
        try
        {
            packets = CsvLoader.Load(opt.CsvPath)
                .OrderBy(p => p.Time)
                .ToList();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Failed to read CSV: {ex.Message}");
            return 3;
        }

        if (packets.Count == 0)
        {
            Console.Error.WriteLine("CSV has no valid packets.");
            return 4;
        }

        var discoveredRoles = PacketScheduler.DiscoverRoles(packets);
        var boardRole = ResolveBoardRole(opt.BoardRole, discoveredRoles, out var fallbackUsed);
        Console.WriteLine($"[INFO] CSV packets: {packets.Count}");
        Console.WriteLine($"[INFO] Discovered roles: {string.Join(", ", discoveredRoles)}");
        if (fallbackUsed)
            Console.WriteLine($"[WARN] Requested board role '{opt.BoardRole}' not found. Fallback to '{boardRole}'.");
        Console.WriteLine($"[INFO] Virtual board role: {boardRole}");

        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        var apiBase = NormalizeApiBase(opt.Server);

        BoardInfo board;
        try
        {
            board = await RegisterBoardAsync(http, apiBase, opt).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Failed to register virtual board: {ex.Message}");
            return 5;
        }

        Console.WriteLine($"[INFO] Registered board id={board.Id}, uid={board.Uid}, name={board.Name}");

        var cancel = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            cancel.Cancel();
            Console.WriteLine("[INFO] Cancellation requested...");
        };

        int sentTotal = 0;
        int loop = 0;
        while (!cancel.IsCancellationRequested)
        {
            loop++;
            Console.WriteLine($"[INFO] Replay loop #{loop} starting");
            var sent = await ReplayToServerAsync(http, apiBase, board, packets, boardRole, opt, cancel.Token)
                .ConfigureAwait(false);
            sentTotal += sent;
            Console.WriteLine($"[INFO] Replay loop #{loop} done. sent={sent}, sentTotal={sentTotal}");

            if (!opt.Loop || (opt.LoopCount > 0 && loop >= opt.LoopCount))
                break;
        }

        Console.WriteLine("[INFO] Finished virtual ESP32 replay.");
        return 0;
    }

    private static string ResolveBoardRole(string? requested, IReadOnlyList<string> roles, out bool fallbackUsed)
    {
        fallbackUsed = false;
        if (!string.IsNullOrWhiteSpace(requested))
        {
            var requestedTrimmed = requested.Trim();
            if (roles.Any(r => string.Equals(r, requestedTrimmed, StringComparison.OrdinalIgnoreCase)))
                return requestedTrimmed;
            if (roles.Count > 0)
            {
                fallbackUsed = true;
                return roles[0];
            }
            return requestedTrimmed;
        }
        if (roles.Count > 0)
            return roles[0];
        return "A";
    }

    private static string NormalizeApiBase(string server)
    {
        var trimmed = server.Trim().TrimEnd('/');
        if (trimmed.EndsWith("/api/v1", StringComparison.OrdinalIgnoreCase))
            return trimmed;
        return trimmed + "/api/v1";
    }

    private static async Task<BoardInfo> RegisterBoardAsync(HttpClient http, string apiBase, CliOptions opt)
    {
        var payload = new
        {
            name = opt.BoardName,
            mac_address = opt.MacAddress,
            wifi_mac = opt.WifiMac,
            uid = opt.Uid,
            protocol_id = opt.ProtocolId,
            location = opt.Location,
        };

        using var res = await http.PostAsJsonAsync($"{apiBase}/boards/register", payload).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode)
        {
            var body = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
            throw new InvalidOperationException($"register failed ({(int)res.StatusCode}): {body}");
        }

        var parsed = await res.Content.ReadFromJsonAsync<RegisterBoardResponse>().ConfigureAwait(false)
            ?? throw new InvalidOperationException("register response is empty");

        if (parsed.Board == null || string.IsNullOrWhiteSpace(parsed.Board.Id))
            throw new InvalidOperationException("register response missing board.id");

        return new BoardInfo(parsed.Board.Id, parsed.Board.Uid ?? parsed.Uid ?? string.Empty, parsed.Board.Name ?? string.Empty);
    }

    private static async Task<int> ReplayToServerAsync(
        HttpClient http,
        string apiBase,
        BoardInfo board,
        IReadOnlyList<CsvPacket> packets,
        string boardRole,
        CliOptions opt,
        CancellationToken ct)
    {
        var first = packets[0].Time;
        var sessionBase = DateTime.UtcNow;
        var sessionStart = DateTime.UtcNow;

        int sent = 0;
        DateTime lastHeartbeat = DateTime.MinValue;

        for (int i = 0; i < packets.Count; i++)
        {
            ct.ThrowIfCancellationRequested();
            if (opt.MaxPackets > 0 && sent >= opt.MaxPackets)
                break;

            var packet = packets[i];
            var offset = packet.Time - first;
            var scaledOffset = TimeSpan.FromMilliseconds(offset.TotalMilliseconds / opt.Speed);
            var targetUtc = sessionBase + scaledOffset;

            var now = DateTime.UtcNow;
            if (targetUtc > now)
                await Task.Delay(targetUtc - now, ct).ConfigureAwait(false);

            var direction = string.Equals(packet.Sender, boardRole, StringComparison.OrdinalIgnoreCase)
                ? "TX"
                : "RX";

            var payload = new
            {
                board_id = board.Id,
                raw_hex = ToHexWithSpaces(packet.Raw),
                direction,
                timestamp = targetUtc,
                protocol_id = opt.ProtocolId,
            };

            using var res = await http.PostAsJsonAsync($"{apiBase}/data/uart", payload, ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
            {
                var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
                throw new InvalidOperationException($"ingest failed at packet {i + 1}/{packets.Count} ({(int)res.StatusCode}): {body}");
            }

            sent++;

            if (DateTime.UtcNow - lastHeartbeat >= TimeSpan.FromSeconds(opt.HeartbeatSeconds))
            {
                await SendHeartbeatAsync(http, apiBase, board.Id, ct).ConfigureAwait(false);
                lastHeartbeat = DateTime.UtcNow;
            }

            if (sent % opt.LogEvery == 0 || sent == packets.Count)
            {
                var elapsed = DateTime.UtcNow - sessionStart;
                Console.WriteLine($"[INFO] sent={sent}/{packets.Count}, elapsed={elapsed.TotalSeconds:F1}s, dir={direction}, t={targetUtc:O}");
            }
        }

        await SendHeartbeatAsync(http, apiBase, board.Id, ct).ConfigureAwait(false);
        return sent;
    }

    private static async Task SendHeartbeatAsync(HttpClient http, string apiBase, string boardId, CancellationToken ct)
    {
        using var res = await http.PostAsJsonAsync($"{apiBase}/heartbeat", new { board_id = boardId }, ct).ConfigureAwait(false);
        _ = res.IsSuccessStatusCode;
    }

    private static string ToHexWithSpaces(byte[] bytes)
    {
        if (bytes.Length == 0) return string.Empty;
        return BitConverter.ToString(bytes).Replace('-', ' ');
    }

    private sealed record RegisterBoardResponse(string? Uid, BoardPayload? Board);
    private sealed record BoardPayload(string Id, string? Uid, string? Name);
    private sealed record BoardInfo(string Id, string Uid, string Name);
}

internal sealed class CliOptions
{
    public string Server { get; private set; } = "http://localhost:5050";
    public string CsvPath { get; private set; } = Path.Combine(AppContext.BaseDirectory, "LCP_TEST_M8_2026-06-22_17-29-45.CSV");
    public double Speed { get; private set; } = 1.0;
    public string? BoardRole { get; private set; }
    public string BoardName { get; private set; } = "Virtual-ESP32";
    public string MacAddress { get; private set; } = "AA:BB:CC:DD:EE:01";
    public string WifiMac { get; private set; } = "AA:BB:CC:DD:EE:02";
    public string? Uid { get; private set; } = "VESP32";
    public string? ProtocolId { get; private set; }
    public string Location { get; private set; } = "tools/virtual_esp32_board";
    public bool Loop { get; private set; }
    public int LoopCount { get; private set; }
    public int LogEvery { get; private set; } = 50;
    public int HeartbeatSeconds { get; private set; } = 10;
    public int MaxPackets { get; private set; }
    public bool ShowHelp { get; private set; }

    public static CliOptions Parse(string[] args)
    {
        var opt = new CliOptions();

        for (int i = 0; i < args.Length; i++)
        {
            var key = args[i];
            string NextValue()
            {
                if (i + 1 >= args.Length)
                    throw new ArgumentException($"Missing value for {key}");
                i++;
                return args[i];
            }

            switch (key)
            {
                case "-h":
                case "--help":
                    opt.ShowHelp = true;
                    break;
                case "--server":
                    opt.Server = NextValue();
                    break;
                case "--csv":
                    opt.CsvPath = NextValue();
                    break;
                case "--speed":
                    opt.Speed = double.Parse(NextValue(), CultureInfo.InvariantCulture);
                    if (opt.Speed <= 0) throw new ArgumentException("--speed must be > 0");
                    break;
                case "--board-role":
                    opt.BoardRole = NextValue();
                    break;
                case "--board-name":
                    opt.BoardName = NextValue();
                    break;
                case "--mac":
                    opt.MacAddress = NextValue();
                    break;
                case "--wifi-mac":
                    opt.WifiMac = NextValue();
                    break;
                case "--uid":
                    opt.Uid = NextValue();
                    break;
                case "--protocol-id":
                    opt.ProtocolId = NextValue();
                    break;
                case "--location":
                    opt.Location = NextValue();
                    break;
                case "--loop":
                    opt.Loop = true;
                    break;
                case "--loop-count":
                    opt.LoopCount = int.Parse(NextValue(), CultureInfo.InvariantCulture);
                    opt.Loop = opt.LoopCount != 1;
                    break;
                case "--log-every":
                    opt.LogEvery = Math.Max(1, int.Parse(NextValue(), CultureInfo.InvariantCulture));
                    break;
                case "--heartbeat-seconds":
                    opt.HeartbeatSeconds = Math.Max(1, int.Parse(NextValue(), CultureInfo.InvariantCulture));
                    break;
                case "--max-packets":
                    opt.MaxPackets = Math.Max(0, int.Parse(NextValue(), CultureInfo.InvariantCulture));
                    break;
                default:
                    throw new ArgumentException($"Unknown argument: {key}");
            }
        }

        return opt;
    }

    public static void PrintHelp()
    {
        Console.WriteLine("virtual_esp32_board");
        Console.WriteLine();
        Console.WriteLine("Usage:");
        Console.WriteLine("  dotnet run --project tools/virtual_esp32_board/virtual_esp32_board.csproj -- [options]");
        Console.WriteLine();
        Console.WriteLine("Options:");
        Console.WriteLine("  --server <url>             Backend base url (default: http://localhost:5050)");
        Console.WriteLine("  --csv <path>               CSV capture path");
        Console.WriteLine("  --speed <factor>           Replay speed factor (default: 1)");
        Console.WriteLine("  --board-role <name>        Role treated as board TX (default: first sender role)");
        Console.WriteLine("  --board-name <name>        Virtual board name tag");
        Console.WriteLine("  --mac <mac>                Virtual BLE mac address");
        Console.WriteLine("  --wifi-mac <mac>           Virtual Wi-Fi mac address");
        Console.WriteLine("  --uid <uid>                Preferred board UID");
        Console.WriteLine("  --protocol-id <id>         Optional protocol id for parsing");
        Console.WriteLine("  --location <text>          Board location metadata");
        Console.WriteLine("  --loop                     Loop replay forever");
        Console.WriteLine("  --loop-count <n>           Replay exactly n times");
        Console.WriteLine("  --log-every <n>            Progress log interval (default: 50)");
        Console.WriteLine("  --heartbeat-seconds <n>    Heartbeat interval (default: 10)");
        Console.WriteLine("  --max-packets <n>          Send at most n packets per replay loop");
        Console.WriteLine("  -h, --help                 Show help");
    }
}
