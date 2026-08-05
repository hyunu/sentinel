using System.Globalization;

namespace UartTest.Core;

/// Parses the "Time,Dir,Raw" capture CSV (e.g. LCP_TEST_M8_*.CSV) into CsvPacket records.
public static class CsvLoader
{
    private const string TimeFormat = "MM-dd HH:mm:ss.fff";

    public static IReadOnlyList<CsvPacket> Load(string path)
    {
        var result = new List<CsvPacket>();
        using var reader = new StreamReader(path);

        // First line is the header ("Time,Dir,Raw") and is skipped.
        reader.ReadLine();

        string? line;
        while ((line = reader.ReadLine()) != null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var packet = TryParseLine(line);
            if (packet != null) result.Add(packet);
        }

        return result;
    }

    private static CsvPacket? TryParseLine(string line)
    {
        // Raw contains embedded spaces, so only the first two commas delimit fields.
        int firstComma = line.IndexOf(',');
        if (firstComma < 0) return null;
        int secondComma = line.IndexOf(',', firstComma + 1);
        if (secondComma < 0) return null;

        string timePart = line[..firstComma].Trim();
        string dirPart = line[(firstComma + 1)..secondComma].Trim();
        string rawPart = line[(secondComma + 1)..].Trim();

        if (!DateTime.TryParseExact(timePart, TimeFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out var time))
            return null;

        var (sender, receiver) = ParseDirection(dirPart);
        if (sender == null || receiver == null) return null;

        return new CsvPacket(time, sender, receiver, ParseHex(rawPart));
    }

    /// Handles both "A -> B" (A sends) and "A <- B" (B sends) arrow notations.
    private static (string? Sender, string? Receiver) ParseDirection(string dir)
    {
        int arrow = dir.IndexOf("->", StringComparison.Ordinal);
        if (arrow >= 0)
            return (dir[..arrow].Trim(), dir[(arrow + 2)..].Trim());

        arrow = dir.IndexOf("<-", StringComparison.Ordinal);
        if (arrow >= 0)
            return (dir[(arrow + 2)..].Trim(), dir[..arrow].Trim());

        return (null, null);
    }

    private static byte[] ParseHex(string rawPart)
    {
        var tokens = rawPart.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        var bytes = new byte[tokens.Length];
        for (int i = 0; i < tokens.Length; i++)
            bytes[i] = Convert.ToByte(tokens[i], 16);
        return bytes;
    }
}
