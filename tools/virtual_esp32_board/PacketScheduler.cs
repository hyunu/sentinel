namespace VirtualEsp32Board;

internal static class PacketScheduler
{
    public static IReadOnlyList<string> DiscoverRoles(IReadOnlyList<CsvPacket> all)
    {
        return all.Select(p => p.Sender)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(r => r, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }
}
