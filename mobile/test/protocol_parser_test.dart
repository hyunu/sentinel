import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sentinel_mobile/models/viz_profile.dart';
import 'package:sentinel_mobile/services/protocol_parser.dart';

void main() {
  test('parses a real LCP monitoring v1 frame', () {
    final protocol =
        json.decode(
              File('test/fixtures/lcp_v1_protocol.json').readAsStringSync(),
            )
            as Map<String, dynamic>;
    final parser = ProtocolParser.fromParseRules(
      Map<String, dynamic>.from(protocol['parse_rules'] as Map),
    );
    final hex = File(
      'test/fixtures/lcp_v1_frame.hex',
    ).readAsStringSync().trim();

    final values = parser.parseHex(hex);

    expect(values['stx'], 0xAA);
    expect(values['seq_no'], isNotNull);
    expect(values['aquavalve_ison'], 1);
    expect(values['drainmotor_getmotorcurrent'], 0);
    expect(values['washmotor_getcurrpm'], 0);
    expect(values['sumpheater_ison'], 23);
    expect(values['sensor_sumptemperature_getsumptemp'], 36);
    expect(values['flowmeter_gettotalwatersupplypulse'], 0);
    expect(values['etx'], 0xBB);
  });

  test('rejects frames with bad start or end markers', () {
    final parser = ProtocolParser(const [
      ProtocolRule(
        name: 'stx',
        type: 'Validate',
        endian: 'little',
        size: 0,
        validateExpr: 'value == 0xAA',
        inner: ProtocolRule(name: '', type: 'U8', endian: 'little', size: 1),
      ),
    ]);

    expect(
      () => parser.parseHex('AA55'),
      throwsA(isA<ProtocolParseException>()),
    );
    expect(
      () => parser.parseHex('0155BB'),
      throwsA(isA<ProtocolParseException>()),
    );
  });

  test('reads the profile field reference and axis metadata', () {
    final profile = VizProfile.fromJson({
      'id': 'p1',
      'name': 'simple',
      'board_id': 'b1',
      'items': [
        {
          'id': 'i1',
          'label': 'Drain current',
          'short_label': '배수전류',
          'color': '#4ecdc4',
          'visible': true,
          'field_ref': {
            'protocol_id': 'aea62789',
            'field_name': 'drainmotor_getmotorcurrent',
          },
          'chart_type': 'line',
          'y_axis': {'id': 'y-right', 'label': 'Right', 'unit': 'mA'},
        },
      ],
    });

    expect(profile.items, hasLength(1));
    final item = profile.items.first;
    expect(item.fieldName, 'drainmotor_getmotorcurrent');
    expect(item.shortLabel, '배수전류');
    expect(item.isRightAxis, isTrue);
    expect(item.unit, 'mA');
    expect(item.color, const Color(0xFF4ECDC4));
  });
}
