import { describe, expect, it } from 'vitest';
import type { VizItem } from '../api';
import {
  applyVizItemTransform,
  formatVizItemActualValue,
  resolveVizItemRawValue,
} from './vizDashboardUtils';

function makeItem(overrides: Partial<VizItem> = {}): VizItem {
  return {
    id: 'id-1',
    label: 'temperature',
    short_label: 'temp',
    color: '#fff',
    visible: true,
    field_ref: { protocol_id: 'p1', field_name: 'sensor.temperature' },
    chart_type: 'line',
    y_axis: { id: 'y-left', label: 'Left', unit: '°C' },
    offset: 0,
    weight: 1,
    ...overrides,
  };
}

describe('resolveVizItemRawValue', () => {
  it('reads by label then field name', () => {
    const item = makeItem();
    expect(resolveVizItemRawValue(item, { temperature: 23.5 })).toBe(23.5);
    expect(resolveVizItemRawValue(item, { 'sensor.temperature': 18 })).toBe(18);
  });
});

describe('formatVizItemActualValue', () => {
  it('shows raw value when offset/weight transform the chart series', () => {
    const item = makeItem({ offset: 10, weight: 2 });
    const chartValue = applyVizItemTransform(5, item);
    expect(chartValue).toBe(20);
    expect(formatVizItemActualValue(item, { temperature: 5 }, chartValue)).toBe('5 °C');
  });

  it('infers raw from chart value when raw map is missing', () => {
    const item = makeItem({ offset: 1, weight: 2 });
    expect(formatVizItemActualValue(item, undefined, 11)).toBe('5 °C');
  });
});
