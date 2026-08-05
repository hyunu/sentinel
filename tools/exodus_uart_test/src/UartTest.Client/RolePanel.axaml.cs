using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Globalization;
using System.IO.Ports;
using System.Linq;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Media;
using Avalonia.Threading;
using UartTest.Core;

namespace UartTest.Client;

/// One independent UART connection (its own serial port, TX/RX log, connect button).
/// Two of these are hosted side by side in MainWindow, one per CSV-discovered role.
public partial class RolePanel : UserControl
{
    private enum StatusKind { Idle, Connected, Sending, Warning, Error, Done }

    private static readonly int[] BaudRates = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

    private static readonly IBrush IdleDotBrush = new SolidColorBrush(Color.Parse("#8B92A5"));
    private static readonly IBrush AccentDotBrush = new SolidColorBrush(Color.Parse("#5B8DEF"));
    private static readonly IBrush SuccessDotBrush = new SolidColorBrush(Color.Parse("#2ECC71"));
    private static readonly IBrush WarningDotBrush = new SolidColorBrush(Color.Parse("#F5A623"));
    private static readonly IBrush ErrorDotBrush = new SolidColorBrush(Color.Parse("#E74C3C"));

    private readonly ObservableCollection<string> _txLog = [];
    private readonly ObservableCollection<string> _rxLog = [];
    private readonly List<byte> _rxBuffer = [];

    private IReadOnlyList<CsvPacket> _allPackets = [];
    private string _role = "";
    private IReadOnlyList<ScheduledPacket> _schedule = [];

    private SerialPort? _serialPort;
    private ReplayEngine? _engine;
    private Thread? _replayThread;

    public event Action? ConnectionChanged;

    public bool IsConnected => _serialPort is { IsOpen: true };
    public bool HasSchedule => _schedule.Count > 0;
    public string? SelectedPortName => PortCombo.SelectedItem as string;

    /// 다른 RolePanel이 현재 선택 중인 포트 이름을 조회하는 콜백. 기본 포트 선택 시 중복을 피하는 데 사용한다.
    public Func<string?>? OtherPanelPort { get; set; }

    public RolePanel()
    {
        InitializeComponent();

        TxListBox.ItemsSource = _txLog;
        RxListBox.ItemsSource = _rxLog;

        PopulateStaticCombos();

        RefreshPortsButton.Click += (_, _) => RefreshPorts();
        ConnectButton.Click += OnConnectClicked;
        SettingsToggle.IsCheckedChanged += (_, _) => ApplySettingsExpanded(SettingsToggle.IsChecked == true);
        PortCombo.SelectionChanged += (_, _) => UpdatePortSummary();
        BaudCombo.SelectionChanged += (_, _) => UpdatePortSummary();
    }

    public void Initialize(IReadOnlyList<CsvPacket> allPackets, string role)
    {
        _allPackets = allPackets;
        _role = role;
        RoleText.Text = role;
        RefreshPorts();
        CounterText.Text = $"0 / {allPackets.Count}";
    }

    private void SetStatus(string text, StatusKind kind)
    {
        StatusText.Text = text;
        var (dot, badgeBg) = kind switch
        {
            StatusKind.Connected => (SuccessDotBrush, "#1B3B2C"),
            StatusKind.Sending => (AccentDotBrush, "#1B2A3B"),
            StatusKind.Done => (SuccessDotBrush, "#1B3B2C"),
            StatusKind.Warning => (WarningDotBrush, "#3B2E14"),
            StatusKind.Error => (ErrorDotBrush, "#3B1B1B"),
            _ => (IdleDotBrush, "#26303C"),
        };
        StatusDot.Fill = dot;
        StatusBadge.Background = new SolidColorBrush(Color.Parse(badgeBg));
    }

    private void ApplySettingsExpanded(bool expanded)
    {
        SettingsPanel.IsVisible = expanded;
        SettingsToggle.Content = expanded ? "⚙ 설정 ▾" : "⚙ 설정 ▸";
    }

    private void UpdatePortSummary()
    {
        var port = PortCombo.SelectedItem as string;
        var baud = BaudCombo.SelectedItem as string;
        PortSummaryText.Text = string.IsNullOrWhiteSpace(port)
            ? "포트를 선택하세요"
            : $"{port} · {baud ?? "-"}bps";
    }

    private void PopulateStaticCombos()
    {
        foreach (var baud in BaudRates) BaudCombo.Items.Add(baud.ToString(CultureInfo.InvariantCulture));
        BaudCombo.SelectedIndex = Array.IndexOf(BaudRates, 115200);

        foreach (var db in new[] { 5, 6, 7, 8 }) DataBitsCombo.Items.Add(db.ToString(CultureInfo.InvariantCulture));
        DataBitsCombo.SelectedItem = "8";

        foreach (var parity in Enum.GetNames<Parity>()) ParityCombo.Items.Add(parity);
        ParityCombo.SelectedItem = nameof(Parity.None);

        foreach (var stopBits in Enum.GetNames<StopBits>()) StopBitsCombo.Items.Add(stopBits);
        StopBitsCombo.SelectedItem = nameof(StopBits.One);
    }

    private void RefreshPorts()
    {
        var current = PortCombo.SelectedItem as string;
        PortCombo.Items.Clear();
        foreach (var name in SerialPortNames.GetPortNames()) PortCombo.Items.Add(name);

        if (current != null && PortCombo.Items.Contains(current))
        {
            PortCombo.SelectedItem = current;
        }
        else if (PortCombo.Items.Count > 0)
        {
            var avoid = OtherPanelPort?.Invoke();
            var ports = PortCombo.Items.Cast<string>();
            PortCombo.SelectedItem = ports.FirstOrDefault(p => p != avoid) ?? ports.First();
        }
        UpdatePortSummary();
    }

    private void OnConnectClicked(object? sender, RoutedEventArgs e)
    {
        if (_serialPort is { IsOpen: true })
        {
            CloseSerialPort();
            ConnectButton.Content = "연결";
            SetStatus("연결 해제됨", StatusKind.Idle);
            SettingsToggle.IsChecked = true;
            ConnectionChanged?.Invoke();
            return;
        }

        if (PortCombo.SelectedItem is not string portName || string.IsNullOrWhiteSpace(portName))
        {
            SetStatus("포트를 선택하세요", StatusKind.Warning);
            return;
        }

        try
        {
            _serialPort = new SerialPort(portName)
            {
                BaudRate = int.Parse((string)BaudCombo.SelectedItem! ?? "115200", CultureInfo.InvariantCulture),
                DataBits = int.Parse((string)DataBitsCombo.SelectedItem! ?? "8", CultureInfo.InvariantCulture),
                Parity = Enum.Parse<Parity>((string)ParityCombo.SelectedItem! ?? "None"),
                StopBits = Enum.Parse<StopBits>((string)StopBitsCombo.SelectedItem! ?? "One"),
            };
            _serialPort.DataReceived += OnSerialDataReceived;
            _serialPort.Open();
        }
        catch (Exception ex)
        {
            SetStatus($"연결 실패: {ex.Message}", StatusKind.Error);
            _serialPort = null;
            return;
        }

        _schedule = PacketScheduler.BuildSchedule(_allPackets, _role);
        CounterText.Text = $"0 / {_schedule.Count}";
        ProgressBar.Maximum = Math.Max(1, _schedule.Count);
        ProgressBar.Value = 0;

        ConnectButton.Content = "연결 해제";
        SetStatus("연결됨", StatusKind.Connected);
        SettingsToggle.IsChecked = false;
        ConnectionChanged?.Invoke();
    }

    /// sharedStopwatch: 두 RolePanel이 같은 기준시각을 공유해야 서로 동기화되어 전송된다.
    public void BeginReplay(Stopwatch sharedStopwatch, double speedFactor)
    {
        if (_serialPort is not { IsOpen: true } || _schedule.Count == 0) return;

        SetStatus("전송 중", StatusKind.Sending);

        _engine = new ReplayEngine(
            _schedule,
            send: bytes => _serialPort!.Write(bytes, 0, bytes.Length),
            onPacketSent: (sent, total, packet) => Dispatcher.UIThread.Post(() => OnPacketSent(sent, total, packet)),
            onSendError: ex => Dispatcher.UIThread.Post(() => SetStatus($"전송 오류: {ex.Message}", StatusKind.Error)),
            onCompleted: () => Dispatcher.UIThread.Post(() => SetStatus("완료", StatusKind.Done)),
            speedFactor: speedFactor);

        _replayThread = new Thread(() => _engine.Run(sharedStopwatch)) { IsBackground = true, Name = $"ReplayThread-{_role}" };
        _replayThread.Start();
    }

    private void OnPacketSent(int sent, int total, ScheduledPacket packet)
    {
        ProgressBar.Value = sent;
        CounterText.Text = $"{sent} / {total}";
        AppendLog(_txLog, TxListBox, $"[{packet.OriginalTime:HH:mm:ss.fff}] {ToHex(packet.Raw)}");
    }

    private void OnSerialDataReceived(object sender, SerialDataReceivedEventArgs e)
    {
        if (_serialPort is null) return;
        try
        {
            var bytesToRead = _serialPort.BytesToRead;
            if (bytesToRead <= 0) return;
            var buffer = new byte[bytesToRead];
            _serialPort.Read(buffer, 0, bytesToRead);

            lock (_rxBuffer)
            {
                _rxBuffer.AddRange(buffer);
                ExtractCompletePackets();
            }
        }
        catch
        {
            // Port may have been closed concurrently; ignore.
        }
    }

    // 프로토콜 프레임: [0]=0xAA 시작 바이트, [2]=전체 프레임 길이. 이 경계로 재조립해야 TX 패킷 단위와 RX 표시가 일치한다.
    private const byte FrameStartByte = 0xAA;
    private const int FrameLengthOffset = 2;
    private const int MinFrameLength = 3;
    private const int MaxFrameLength = 512;

    private void ExtractCompletePackets()
    {
        while (true)
        {
            var startIndex = _rxBuffer.IndexOf(FrameStartByte);
            if (startIndex < 0)
            {
                _rxBuffer.Clear();
                return;
            }
            if (startIndex > 0) _rxBuffer.RemoveRange(0, startIndex);

            if (_rxBuffer.Count < MinFrameLength) return;

            int frameLength = _rxBuffer[FrameLengthOffset];
            if (frameLength < MinFrameLength || frameLength > MaxFrameLength)
            {
                // 손상된 프레임: 시작 바이트를 건너뛰고 재동기화한다.
                _rxBuffer.RemoveAt(0);
                continue;
            }

            if (_rxBuffer.Count < frameLength) return;

            var packet = _rxBuffer.GetRange(0, frameLength).ToArray();
            _rxBuffer.RemoveRange(0, frameLength);

            var text = $"[{DateTime.Now:HH:mm:ss.fff}] {ToHex(packet)}";
            Dispatcher.UIThread.Post(() => AppendLog(_rxLog, RxListBox, text));
        }
    }

    private static void AppendLog(ObservableCollection<string> log, ListBox listBox, string entry)
    {
        log.Add(entry);
        const int maxEntries = 2000;
        while (log.Count > maxEntries) log.RemoveAt(0);
        listBox.ScrollIntoView(log[^1]);
    }

    private static string ToHex(byte[] bytes) => string.Join(' ', bytes.Select(b => b.ToString("X2")));

    private void CloseSerialPort()
    {
        try { if (_serialPort is { IsOpen: true }) _serialPort.Close(); } catch { /* ignore */ }
        _serialPort?.Dispose();
        _serialPort = null;
        lock (_rxBuffer) _rxBuffer.Clear();
    }

    public void Cleanup()
    {
        _engine?.Cancel();
        CloseSerialPort();
    }
}
