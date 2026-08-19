namespace VirtualEsp32Board;

internal sealed record CsvPacket(DateTime Time, string Sender, string Receiver, byte[] Raw);
