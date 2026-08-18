// AgentDock FAB-first market selector（getFabOptions 提供选项与默认值）
import { Flexbox, Segmented, Text } from '@lobehub/ui';
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
    <Flexbox horizontal align="center" gap={8}>
      <Text fontSize={13} type="secondary">
        {t('market.fabLabel')}
      </Text>
      <Segmented
        options={fabs.map((fab) => ({ label: fab, value: fab }))}
        value={value}
        onChange={(next) => onChange(String(next))}
      />
    </Flexbox>
  );
});

export default FabSelector;
