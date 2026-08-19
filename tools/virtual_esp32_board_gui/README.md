# virtual_esp32_board_gui

Cross-platform GUI application for virtual ESP32 board replay.

- UI framework: Avalonia 11
- Target: Windows, macOS, Linux
- Purpose: Replay sniffed UART CSV data to Sentinel backend as live board traffic.

## Features

- CSV file picker and role selection
- Virtual board registration (`/api/v1/boards/register`)
- UART live send (`/api/v1/data/uart`)
- Heartbeat send (`/api/v1/heartbeat`)
- Replay speed / loop / max packet control
- Real-time progress and live logs

## Run

From repository root:

```bash
dotnet run --project tools/virtual_esp32_board_gui/VirtualEsp32Board.Gui.csproj
```

## macOS/Windows notes

- Avalonia app runs on both Windows and macOS.
- Backend URL default is `http://localhost:5050`.
- If backend is running in Docker/WSL, ensure host port mapping and firewall allow access.
