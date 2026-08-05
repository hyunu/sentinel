using System.Diagnostics;

namespace UartTest.Core;

/// Replays a schedule of packets at their recorded offsets using a Stopwatch-driven
/// sleep-then-spin wait for millisecond-level timing accuracy. Runs synchronously and is
/// meant to be invoked from a dedicated background thread.
public sealed class ReplayEngine
{
    private readonly IReadOnlyList<ScheduledPacket> _schedule;
    private readonly Action<byte[]> _send;
    private readonly Action<int, int, ScheduledPacket> _onPacketSent;
    private readonly Action<Exception> _onSendError;
    private readonly Action _onCompleted;
    private readonly double _speedFactor;
    private volatile bool _cancelRequested;

    public ReplayEngine(
        IReadOnlyList<ScheduledPacket> schedule,
        Action<byte[]> send,
        Action<int, int, ScheduledPacket> onPacketSent,
        Action<Exception> onSendError,
        Action onCompleted,
        double speedFactor = 1.0)
    {
        _schedule = schedule;
        _send = send;
        _onPacketSent = onPacketSent;
        _onSendError = onSendError;
        _onCompleted = onCompleted;
        _speedFactor = speedFactor <= 0 ? 1.0 : speedFactor;
    }

    public void Cancel() => _cancelRequested = true;

    /// sharedStopwatch: 여러 역할(OSP/LCP)이 같은 시작 기준시각을 공유해야 서로 동기화되어 전송된다.
    public void Run(Stopwatch sharedStopwatch)
    {
        for (int i = 0; i < _schedule.Count && !_cancelRequested; i++)
        {
            var packet = _schedule[i];
            WaitUntil(sharedStopwatch, packet.OffsetMs);
            if (_cancelRequested) break;

            try
            {
                _send(packet.Raw);
                _onPacketSent(i + 1, _schedule.Count, packet);
            }
            catch (Exception ex)
            {
                _onSendError(ex);
            }
        }

        _onCompleted();
    }

    private void WaitUntil(Stopwatch sw, double targetMs)
    {
        // 가속도(speedFactor)가 클수록 실제 대기 시간(스케일된 목표치)이 짧아진다.
        double scaledTargetMs = targetMs / _speedFactor;
        double remaining = scaledTargetMs - sw.Elapsed.TotalMilliseconds;
        if (remaining > 15)
            Thread.Sleep((int)(remaining - 10));

        while (!_cancelRequested && sw.Elapsed.TotalMilliseconds < scaledTargetMs)
            Thread.SpinWait(200);
    }
}
