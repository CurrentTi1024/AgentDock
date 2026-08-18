// Adapted from: src/routes/(main)/group/_layout/Sidebar/Header (LobeHub canary, slim)
import { ActionIcon, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { Plus, Users } from 'lucide-react';
import { memo } from 'react';

import SideBarHeaderLayout from '@/components/shell/SideBarHeaderLayout';
import { useI18n } from '@/i18n';
import { useGroupCreateStore } from '@/stores/groupCreateStore';

const GroupSidebarHeader = memo(() => {
  const { t } = useI18n();
  const openGroupCreate = useGroupCreateStore((s) => s.openModal);

  return (
    <SideBarHeaderLayout
      left={
        <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
          <Icon color="inherit" icon={Users} size={18} />
          <Text ellipsis fontSize={14} weight={500}>
            {t('nav.group')}
          </Text>
        </Flexbox>
      }
      right={
        <Tooltip title={t('nav.newGroup')}>
          <ActionIcon aria-label={t('nav.newGroup')} icon={Plus} onClick={openGroupCreate} />
        </Tooltip>
      }
      showBack={false}
      showTogglePanelButton={false}
    />
  );
});

GroupSidebarHeader.displayName = 'GroupSidebarHeader';

export default GroupSidebarHeader;
