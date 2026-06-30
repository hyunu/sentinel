import ProtocolsSectionHeader from '../components/ProtocolsSectionHeader';
import SchemaPresetsPanel from '../components/SchemaPresetsPanel';

export default function ProtocolTemplatesPage() {
  return (
    <div className="page protocols-page">
      <ProtocolsSectionHeader />
      <SchemaPresetsPanel />
    </div>
  );
}
