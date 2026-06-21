import 'package:flutter/material.dart';
import '../services/storage_service.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _storage = StorageService();
  final _urlCtrl = TextEditingController();
  bool _saving = false;
  bool _saved = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final url = await _storage.getServerUrl();
    if (mounted) {
      setState(() {
        _urlCtrl.text = url ?? '';
      });
    }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    await _storage.setServerUrl(_urlCtrl.text.trim());
    setState(() {
      _saving = false;
      _saved = true;
    });
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) setState(() => _saved = false);
    });
  }

  @override
  void dispose() {
    _urlCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      backgroundColor: cs.surface,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_rounded, color: cs.onSurface),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text('Settings', style: Theme.of(context).textTheme.titleLarge?.copyWith(color: cs.onSurface)),
      ),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: cs.surfaceContainerLow,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: cs.outline.withValues(alpha: 0.3), width: 0.5),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 36, height: 36,
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: [cs.primary.withValues(alpha: 0.12), cs.primary.withValues(alpha: 0.04)],
                            begin: Alignment.topLeft, end: Alignment.bottomRight,
                          ),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Icon(Icons.dns_rounded, size: 18, color: cs.primary),
                      ),
                      const SizedBox(width: 12),
                      Text('Server URL',
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(color: cs.onSurface),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'The base URL of your Sentinel backend server.\nThis is passed to devices during onboarding.',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(color: cs.onSurfaceVariant, height: 1.4),
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: _urlCtrl,
                    style: TextStyle(color: cs.onSurface, fontFamily: 'monospace', fontSize: 13),
                    decoration: InputDecoration(
                      hintText: 'http://192.168.0.9:5050',
                      hintStyle: TextStyle(color: cs.onSurfaceVariant.withValues(alpha: 0.4), fontFamily: 'monospace'),
                      prefixIcon: Icon(Icons.link, size: 18, color: cs.onSurfaceVariant),
                    ),
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _saving ? null : _save,
                      icon: _saving
                          ? SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: cs.onPrimary))
                          : _saved
                              ? Icon(Icons.check_rounded, size: 18)
                              : Icon(Icons.save_rounded, size: 18),
                      label: Text(_saved ? 'Saved' : 'Save'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
