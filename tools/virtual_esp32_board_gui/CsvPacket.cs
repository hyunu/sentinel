namespace VirtualEsp32Board.Gui;

internal sealed record CsvPacket(DateTime Time, string Sender, string Receiver, byte[] Raw);
