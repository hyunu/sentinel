import 'dart:convert';

import 'package:http/http.dart' as http;

/// Latest stored UART sample time for [boardId], if the server has one.
Future<DateTime?> latestUartAt(String baseUrl, String boardId) async {
  if (boardId.isEmpty) return null;
  final uri = Uri.parse(
    '$baseUrl/api/v1/data/uart?board_id=${Uri.encodeQueryComponent(boardId)}&limit=1',
  );
  final res = await http.get(uri).timeout(const Duration(seconds: 4));
  if (res.statusCode != 200) return null;
  final body = json.decode(res.body);
  if (body is! Map) return null;
  final items = body['items'];
  if (items is! List || items.isEmpty) return null;
  final row = items.first;
  if (row is! Map) return null;
  return DateTime.tryParse(row['timestamp']?.toString() ?? '');
}
