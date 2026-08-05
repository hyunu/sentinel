using System.IO.Ports;
using System.Runtime.InteropServices;

namespace UartTest.Core;

/// Cross-platform serial port name discovery. SerialPort.GetPortNames() is reliable on Windows
/// but can miss devices on macOS/Linux, so this falls back to scanning /dev for common patterns.
public static class SerialPortNames
{
    public static IReadOnlyList<string> GetPortNames()
    {
        var names = new List<string>(SerialPort.GetPortNames());

        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            names.AddRange(ScanDev());

        return names
            .Distinct(StringComparer.Ordinal)
            .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static IEnumerable<string> ScanDev()
    {
        const string devDir = "/dev";
        if (!Directory.Exists(devDir)) yield break;

        // macOS uses "cu.*"/"tty.*", Linux typically uses "ttyUSB*"/"ttyACM*"/"ttyS*".
        string[] patterns = ["cu.*", "tty.usb*", "ttyUSB*", "ttyACM*", "ttyS*"];

        foreach (var pattern in patterns)
        {
            IEnumerable<string> matches;
            try { matches = Directory.EnumerateFiles(devDir, pattern); }
            catch { continue; }

            foreach (var m in matches) yield return m;
        }
    }
}
