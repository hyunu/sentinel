import 'package:flutter/material.dart';

enum AppToastType { success, error, info }

class AppToast {
  static const _margin = EdgeInsets.fromLTRB(20, 0, 20, 20);
  static const _radius = 14.0;

  static void success(BuildContext context, String message) {
    _show(context, message: message, type: AppToastType.success);
  }

  static void error(
    BuildContext context,
    String message, {
    bool persistent = true,
  }) {
    _show(
      context,
      message: message,
      type: AppToastType.error,
      persistent: persistent,
    );
  }

  static void info(BuildContext context, String message) {
    _show(context, message: message, type: AppToastType.info);
  }

  static void _show(
    BuildContext context, {
    required String message,
    required AppToastType type,
    bool persistent = false,
  }) {
    final cs = Theme.of(context).colorScheme;
    final (icon, accent) = switch (type) {
      AppToastType.success => (Icons.check_rounded, cs.secondary),
      AppToastType.error => (Icons.error_outline_rounded, cs.tertiary),
      AppToastType.info => (Icons.info_outline_rounded, cs.primary),
    };

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        backgroundColor: cs.surfaceContainerHigh,
        elevation: 0,
        behavior: SnackBarBehavior.floating,
        duration: persistent ? const Duration(days: 1) : const Duration(seconds: 3),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(_radius),
          side: BorderSide(color: cs.outline.withValues(alpha: 0.35)),
        ),
        margin: _margin,
        content: Row(
          children: [
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                color: accent.withValues(alpha: 0.14),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(icon, size: 16, color: accent),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                message,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: cs.onSurface,
                      height: 1.35,
                    ),
              ),
            ),
          ],
        ),
        action: persistent
            ? SnackBarAction(
                label: 'Dismiss',
                textColor: cs.onSurfaceVariant,
                onPressed: () {
                  ScaffoldMessenger.of(context).hideCurrentSnackBar();
                },
              )
            : null,
      ),
    );
  }
}
