import type { ReactNode } from 'react';
import PageHeader from '../components/PageHeader';
import ProtocolsSubNav from '../components/ProtocolsSubNav';
import { useTranslation } from '../i18n';

type ProtocolsSectionHeaderProps = {
  children?: ReactNode;
};

export default function ProtocolsSectionHeader({ children }: ProtocolsSectionHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="protocols-section-header">
      <PageHeader title={t('protocols.title')} subtitle={t('protocols.subtitle')}>
        {children}
      </PageHeader>
      <ProtocolsSubNav />
    </div>
  );
}
