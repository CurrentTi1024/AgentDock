// Adapted from: src/routes/(main)/group/_layout/Sidebar/Header (LobeHub canary, slim)
import { ActionIcon, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { Plus, Users } from 'lucide-react';
import { memo } from 'react';
import { useNavigate } from 'react-router-dom';

import SideBarHeaderLayout from '@/components/shell/SideBarHeaderLayout';
import { sessionHistoryService } from '@/api/session/sessionHistoryService';
import { useI18n } from '@/i18n';

const GroupSidebarHeader = memo(() => {
  const navigate = useNavigate();
  const { t } = useI18n();

  const createGroup = async () => {
    const group = await sessionHistoryService.createSession({
      agentId: 'group',
      agentName: 'FlightAnalysis_Group',
      fab: 'F15B',
      id: `group-${crypto.randomUUID()}`,
      pinned: false,
      threadId: crypto.randomUUID(),
      title: t('nav.newGroup'),
      type: 'group',
      version: '2.1.0',
    });
    navigate(`/group/${group.id}`);
  };

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
          <ActionIcon aria-label={t('nav.newGroup')} icon={Plus} onClick={() => void createGroup()} />
        </Tooltip>
      }
      showBack={false}
      showTogglePanelButton={false}
    />
  );
});

GroupSidebarHeader.displayName = 'GroupSidebarHeader';

export default GroupSidebarHeader;
