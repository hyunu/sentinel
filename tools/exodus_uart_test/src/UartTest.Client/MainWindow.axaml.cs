using System.Diagnostics;
using System.Globalization;
using Avalonia.Controls;
using Avalonia.Interactivity;
using UartTest.Core;

namespace UartTest.Client;

public partial class MainWindow : Window
{
    private IReadOnlyList<CsvPacket> _allPackets = [];

    public MainWindow()
    {
        InitializeComponent();

        LoadCsv();
        PopulateSpeedCombo();

        var roles = PacketScheduler.DiscoverRoles(_allPackets);
        var role1 = roles.Count > 0 ? roles[0] : "ROLE1";
        var role2 = roles.Count > 1 ? roles[1] : "ROLE2";

        Panel1.OtherPanelPort = () => Panel2.SelectedPortName;
        Panel2.OtherPanelPort = () => Panel1.SelectedPortName;

        Panel1.Initialize(_allPackets, role1);
        Panel2.Initialize(_allPackets, role2);

        Panel1.ConnectionChanged += UpdateStartAllEnabled;
        Panel2.ConnectionChanged += UpdateStartAllEnabled;

        StartAllButton.Click += OnStartAllClicked;

        Closing += (_, _) =>
        {
            Panel1.Cleanup();
            Panel2.Cleanup();
        };
    }

    private void LoadCsv()
    {
        var csvPath = Path.Combine(AppContext.BaseDirectory, "LCP_TEST_M8_2026-06-22_17-29-45.CSV");
        try
        {
            _allPackets = CsvLoader.Load(csvPath);
        }
        catch (Exception ex)
        {
            GlobalStatusText.Text = $"CSV 로드 실패: {ex.Message}";
        }
    }

    private void PopulateSpeedCombo()
    {
        foreach (var speed in new[] { "1", "2", "5", "10", "20", "50", "100" }) SpeedCombo.Items.Add(speed);
        SpeedCombo.SelectedItem = "1";
    }

    private void UpdateStartAllEnabled()
    {
        StartAllButton.IsEnabled = Panel1.IsConnected && Panel2.IsConnected && Panel1.HasSchedule && Panel2.HasSchedule;
    }

    private void OnStartAllClicked(object? sender, RoutedEventArgs e)
    {
        var speedFactor = double.TryParse(SpeedCombo.SelectedItem as string ?? SpeedCombo.Text,
            CultureInfo.InvariantCulture, out var parsed) ? parsed : 1.0;

        // 두 패널이 같은 Stopwatch를 공유해야 서로 동기화된 시각 기준으로 전송된다.
        var sharedStopwatch = Stopwatch.StartNew();
        Panel1.BeginReplay(sharedStopwatch, speedFactor);
        Panel2.BeginReplay(sharedStopwatch, speedFactor);

        GlobalStatusText.Text = "전송 중";
    }
}
