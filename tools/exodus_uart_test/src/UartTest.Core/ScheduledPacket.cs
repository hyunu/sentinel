namespace UartTest.Core;

/// A packet scheduled for transmission by one role, with its offset from session start (t0).
public sealed record ScheduledPacket(double OffsetMs, byte[] Raw, DateTime OriginalTime);
