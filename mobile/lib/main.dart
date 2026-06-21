import 'package:flutter/material.dart';
import 'screens/home_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const SentinelApp());
}

class SentinelApp extends StatelessWidget {
  const SentinelApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Sentinel',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF0A0A0F),
        colorScheme: const ColorScheme.dark(
          surface: Color(0xFF0A0A0F),
          surfaceContainerLowest: Color(0xFF0D0D14),
          surfaceContainerLow: Color(0xFF13131C),
          surfaceContainer: Color(0xFF1A1A26),
          surfaceContainerHigh: Color(0xFF222230),
          surfaceContainerHighest: Color(0xFF2A2A3A),
          primary: Color(0xFF818CF8),
          secondary: Color(0xFF34D399),
          tertiary: Color(0xFFF472B6),
          onSurface: Color(0xFFE8E8F0),
          onSurfaceVariant: Color(0xFF9898B0),
          outline: Color(0xFF2E2E3E),
          outlineVariant: Color(0xFF3A3A4A),
        ),
        textTheme: const TextTheme(
          titleLarge: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, letterSpacing: -0.3),
          titleMedium: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, letterSpacing: -0.2),
          titleSmall: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
          bodyLarge: TextStyle(fontSize: 15, fontWeight: FontWeight.w400),
          bodyMedium: TextStyle(fontSize: 13, fontWeight: FontWeight.w400),
          bodySmall: TextStyle(fontSize: 11, fontWeight: FontWeight.w500, letterSpacing: 0.3),
          labelLarge: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, letterSpacing: 0.1),
          labelSmall: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, letterSpacing: 0.5),
        ),
        cardTheme: CardThemeData(
          color: const Color(0xFF13131C),
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: const BorderSide(color: Color(0xFF1E1E2E), width: 0.5),
          ),
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          ),
        ),
        outlinedButtonTheme: OutlinedButtonThemeData(
          style: OutlinedButton.styleFrom(
            side: const BorderSide(color: Color(0xFF2E2E3E)),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: const Color(0xFF13131C),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFF2E2E3E)),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFF2E2E3E)),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFF818CF8), width: 1.5),
          ),
          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        ),
      ),
      home: const HomeScreen(),
    );
  }
}
