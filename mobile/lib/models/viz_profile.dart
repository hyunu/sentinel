import 'dart:ui';

class VizProfileItem {
  final String id;
  final String label;
  final String shortLabel;
  final String colorHex;
  final bool visible;
  final String protocolId;
  final String fieldName;
  final String chartType;
  final String axisId;
  final String axisLabel;
  final String unit;

  const VizProfileItem({
    required this.id,
    required this.label,
    required this.shortLabel,
    required this.colorHex,
    required this.visible,
    required this.protocolId,
    required this.fieldName,
    required this.chartType,
    required this.axisId,
    required this.axisLabel,
    required this.unit,
  });

  factory VizProfileItem.fromJson(Map<String, dynamic> json) {
    final fieldRef = json['field_ref'] is Map
        ? Map<String, dynamic>.from(json['field_ref'] as Map)
        : const <String, dynamic>{};
    final axis = json['y_axis'] is Map
        ? Map<String, dynamic>.from(json['y_axis'] as Map)
        : const <String, dynamic>{};
    final label = json['label']?.toString() ?? '';
    final shortLabel = json['short_label']?.toString() ?? '';
    return VizProfileItem(
      id: json['id']?.toString() ?? '',
      label: label,
      shortLabel: shortLabel.isEmpty ? label : shortLabel,
      colorHex: json['color']?.toString() ?? '#818CF8',
      visible: json['visible'] != false,
      protocolId: fieldRef['protocol_id']?.toString() ?? '',
      fieldName: fieldRef['field_name']?.toString() ?? '',
      chartType: json['chart_type']?.toString() ?? 'line',
      axisId: axis['id']?.toString() ?? 'y-left',
      axisLabel: axis['label']?.toString() ?? 'Left',
      unit: axis['unit']?.toString() ?? '',
    );
  }

  bool get isRightAxis => axisId == 'y-right';

  Color get color {
    var hex = colorHex.trim().replaceFirst('#', '');
    if (hex.length == 6) hex = 'FF$hex';
    final value = int.tryParse(hex, radix: 16);
    return value == null ? const Color(0xFF818CF8) : Color(value);
  }
}

class VizProfile {
  final String id;
  final String name;
  final String description;
  final String boardId;
  final List<VizProfileItem> items;
  final DateTime? updatedAt;

  const VizProfile({
    required this.id,
    required this.name,
    required this.description,
    required this.boardId,
    required this.items,
    this.updatedAt,
  });

  factory VizProfile.fromJson(Map<String, dynamic> json) {
    final rawItems = json['items'];
    return VizProfile(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      boardId: json['board_id']?.toString() ?? '',
      items: rawItems is List
          ? rawItems
                .whereType<Map>()
                .map(
                  (e) => VizProfileItem.fromJson(Map<String, dynamic>.from(e)),
                )
                .toList()
          : const [],
      updatedAt: DateTime.tryParse(json['updated_at']?.toString() ?? ''),
    );
  }
}
