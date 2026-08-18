// AgentDock FAB-first market selector（getFabOptions 提供选项与默认值）
import { Select } from '@lobehub/ui';
import { memo } from 'react';

import { useI18n } from '@/i18n';

interface FabSelectorProps {
  fabs: string[];
  onChange: (fab: string) => void;
  value: string;
}

const FabSelector = memo<FabSelectorProps>(({ fabs, onChange, value }) => (
  <FabSelectorInner fabs={fabs} onChange={onChange} value={value} />
));

FabSelector.displayName = 'FabSelector';

const FabSelectorInner = memo<FabSelectorProps>(({ fabs, onChange, value }) => {
  const { t } = useI18n();
  return (
    <Select
      aria-label={t('market.fabLabel')}
      options={fabs.map((fab) => ({ label: fab, value: fab }))}
      placeholder={t('market.fabLabel')}
      style={{ width: 160 }}
      value={value}
      onChange={(next) => onChange(String(next))}
    />
  );
});

export default FabSelector;
