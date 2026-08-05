namespace UartTest.Core;

/// A single recorded UART frame from the capture CSV.
public sealed record CsvPacket(DateTime Time, string Sender, string Receiver, byte[] Raw);
