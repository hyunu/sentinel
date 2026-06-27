import type { ProtocolSpec } from '../api';

export function protocolFormatLabel(p: ProtocolSpec): string {
  if (p.frame_def || p.fid_payloads?.length) {
    const key = p.frame_def?.payload_key_field || 'fid';
    const fids = p.fid_payloads?.map(fp => `0x${fp.fid}`).join(', ') || '';
    return fids ? `Frame · ${key}=${fids}` : 'Frame';
  }
  return `Raw · ${p.fields.length} fields`;
}

export function protocolMessageCount(p: ProtocolSpec): number {
  return p.fid_payloads?.length ?? p.fields.filter(f => f.name).length;
}
