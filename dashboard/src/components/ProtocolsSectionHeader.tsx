import type { ReactNode } from 'react';
import PageHeader from '../components/PageHeader';
import ProtocolsSubNav from '../components/ProtocolsSubNav';

const PROTOCOLS_SUBTITLE =
  'Define UART packet structures and reusable parse_rules templates.';

type ProtocolsSectionHeaderProps = {
  children?: ReactNode;
};

export default function ProtocolsSectionHeader({ children }: ProtocolsSectionHeaderProps) {
  return (
    <div className="protocols-section-header">
      <PageHeader title="Protocols" subtitle={PROTOCOLS_SUBTITLE}>
        {children}
      </PageHeader>
      <ProtocolsSubNav />
    </div>
  );
}
