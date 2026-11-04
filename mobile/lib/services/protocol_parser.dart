import 'dart:typed_data';

class ProtocolParseException implements Exception {
  final String message;
  ProtocolParseException(this.message);

  @override
  String toString() => 'ProtocolParseException: $message';
}

class ProtocolRule {
  final String name;
  final String type;
  final String endian;
  final int size;
  final String? validateExpr;
  final ProtocolRule? inner;

  const ProtocolRule({
    required this.name,
    required this.type,
    required this.endian,
    required this.size,
    this.validateExpr,
    this.inner,
  });

  factory ProtocolRule.fromJson(Map<String, dynamic> json) {
    final innerRaw = json['inner'];
    return ProtocolRule(
      name: json['name']?.toString() ?? '',
      type: json['type']?.toString() ?? '',
      endian: json['endian']?.toString() ?? 'little',
      size: json['size'] is int
          ? json['size'] as int
          : int.tryParse('${json['size']}') ?? 0,
      validateExpr: json['validate_expr']?.toString(),
      inner: innerRaw is Map
          ? ProtocolRule.fromJson(Map<String, dynamic>.from(innerRaw))
          : null,
    );
  }
}

/// Interprets the sequential subset of the server's JSON parse rules that
/// LCP monitoring frames use: Validate, Padding, U8, U16 and U32.
class ProtocolParser {
  final List<ProtocolRule> rules;

  const ProtocolParser(this.rules);

  factory ProtocolParser.fromParseRules(Map<String, dynamic>? parseRules) {
    final rawFields = parseRules?['fields'];
    if (rawFields is! List) {
      throw ProtocolParseException('parse_rules.fields is missing');
    }
    return ProtocolParser(
      rawFields
          .whereType<Map>()
          .map((e) => ProtocolRule.fromJson(Map<String, dynamic>.from(e)))
          .toList(),
    );
  }

  Map<String, double> parseHex(String hex) {
    final cleaned = hex.replaceAll(RegExp(r'\s+'), '');
    if (cleaned.isEmpty || cleaned.length.isOdd) {
      throw ProtocolParseException('invalid hex length');
    }
    final bytes = Uint8List(cleaned.length ~/ 2);
    for (var i = 0; i < bytes.length; i++) {
      final value = int.tryParse(
        cleaned.substring(i * 2, i * 2 + 2),
        radix: 16,
      );
      if (value == null) throw ProtocolParseException('invalid hex byte');
      bytes[i] = value;
    }
    return parseBytes(bytes);
  }

  Map<String, double> parseBytes(List<int> bytes) {
    if (bytes.isEmpty) throw ProtocolParseException('empty frame');
    if (bytes.first != 0xAA) {
      throw ProtocolParseException('bad STX');
    }
    if (bytes.last != 0xBB) {
      throw ProtocolParseException('bad ETX');
    }

    final values = <String, double>{};
    var offset = 0;

    int readScalar(ProtocolRule rule) {
      final size = _sizeOf(rule.type, rule.size);
      if (offset + size > bytes.length) {
        throw ProtocolParseException('truncated ${rule.type}');
      }
      var value = 0;
      if (rule.endian == 'big') {
        for (var i = 0; i < size; i++) {
          value = (value << 8) | (bytes[offset + i] & 0xFF);
        }
      } else {
        for (var i = size - 1; i >= 0; i--) {
          value = (value << 8) | (bytes[offset + i] & 0xFF);
        }
      }
      offset += size;
      return value;
    }

    for (final rule in rules) {
      switch (rule.type) {
        case 'Validate':
          final inner = rule.inner;
          if (inner == null) {
            throw ProtocolParseException('Validate without inner');
          }
          final value = readScalar(inner);
          if (rule.name.isNotEmpty) values[rule.name] = value.toDouble();
          final expr = rule.validateExpr;
          if (expr != null && !_matchesValidate(expr, value)) {
            throw ProtocolParseException(
              'validation failed: ${rule.name} = $value',
            );
          }
          break;
        case 'Padding':
          if (offset + rule.size > bytes.length) {
            throw ProtocolParseException('truncated padding');
          }
          offset += rule.size;
          break;
        case 'U8':
        case 'U16':
        case 'U32':
        case 'I8':
        case 'I16':
        case 'I32':
          var value = readScalar(rule);
          if (rule.type.startsWith('I')) {
            final bits = _sizeOf(rule.type, rule.size) * 8;
            final signBit = 1 << (bits - 1);
            if ((value & signBit) != 0) {
              value -= 1 << bits;
            }
          }
          if (rule.name.isNotEmpty) values[rule.name] = value.toDouble();
          break;
        default:
          throw ProtocolParseException(
            'unsupported field type ${rule.type} (${rule.name})',
          );
      }
    }

    return values;
  }

  static int _sizeOf(String type, int explicitSize) {
    switch (type) {
      case 'U8':
      case 'I8':
      case 'Bool':
        return 1;
      case 'U16':
      case 'I16':
        return 2;
      case 'U32':
      case 'I32':
      case 'Float':
        return 4;
      default:
        return explicitSize;
    }
  }

  static bool _matchesValidate(String expr, int value) {
    final match = RegExp(
      r'value\s*(==|!=)\s*(0x[0-9a-fA-F]+|\d+)',
    ).firstMatch(expr);
    if (match == null) return true;
    final raw = match.group(2)!;
    final expected = raw.startsWith('0x')
        ? int.parse(raw.substring(2), radix: 16)
        : int.parse(raw);
    return match.group(1) == '==' ? value == expected : value != expected;
  }
}
