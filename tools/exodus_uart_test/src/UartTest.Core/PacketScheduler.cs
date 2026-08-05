namespace UartTest.Core;

/// Builds a per-role send schedule using a shared t0 (the first packet of the whole capture),
/// so both roles stay in sync even though each only sends a subset of the rows.
public static class PacketScheduler
{
    public static IReadOnlyList<ScheduledPacket> BuildSchedule(IReadOnlyList<CsvPacket> all, string role)
    {
        if (all.Count == 0) return Array.Empty<ScheduledPacket>();

        var t0 = all[0].Time;
        var list = new List<ScheduledPacket>();

        foreach (var p in all)
        {
            if (!string.Equals(p.Sender, role, StringComparison.OrdinalIgnoreCase)) continue;
            list.Add(new ScheduledPacket((p.Time - t0).TotalMilliseconds, p.Raw, p.Time));
        }

        return list;
    }

    /// Distinct sender names found in the capture, used to populate role choices.
    public static IReadOnlyList<string> DiscoverRoles(IReadOnlyList<CsvPacket> all)
    {
        return all.Select(p => p.Sender)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(r => r, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }
}
