// Adapted from: src/features/AgentSidebar/Header/Agent (LobeHub canary)
// 当前 Agent 头像 + 名称 + 切换 Agent 下拉（选择后新建该 Agent 会话并跳转）。
import { ActionIcon, Avatar, Flexbox, Text } from '@lobehub/ui';
import { DropdownMenu } from '@lobehub/ui/base-ui';
import { ChevronsUpDown, Home } from 'lucide-react';
import { memo } from 'react';
import { useNavigate } from 'react-router-dom';

import SideBarHeaderLayout from '@/components/shell/SideBarHeaderLayout';
import { agentMarketService, type MentionAgent } from '@/api/market/agentMarketService';
import { sessionHistoryService } from '@/api/session/sessionHistoryService';
import { useI18n } from '@/i18n';

interface AgentSidebarHeaderProps {
  agentName: string;
  agents: MentionAgent[];
  fab: string;
  onSwitchAgent: (agent: MentionAgent) => void;
}

const AgentSidebarHeader = memo<AgentSidebarHeaderProps>(
  ({ agentName, agents, fab, onSwitchAgent }) => {
    const { t } = useI18n();
    const navigate = useNavigate();
    return (
      <SideBarHeaderLayout
        left={
          <Flexbox horizontal align="center" gap={2} style={{ minWidth: 0 }}>
            <ActionIcon
              aria-label={t('agentSidebar.backHome')}
              icon={Home}
              size="small"
              title={t('agentSidebar.backHome')}
              onClick={() => navigate('/chat')}
            />
            <DropdownMenu
              items={agents.map((agent) => ({
                key: `${agent.agentId}@${agent.fab}`,
                label: `${agent.icon} ${agent.agentFullName} · ${agent.fab}`,
                onClick: () => onSwitchAgent(agent),
              }))}
              placement="bottomLeft"
            >
              <Flexbox
                horizontal
                align="center"
                gap={8}
                padding={2}
                style={{ cursor: 'pointer', minWidth: 32, overflow: 'hidden' }}
              >
                <Avatar avatar="🛩️" shape="square" size={28} />
                <Text ellipsis fontSize={14} weight={500} style={{ maxWidth: 160 }}>
                  {agentName}
                </Text>
                <ActionIcon
                  aria-label={t('agentSidebar.switchAgent')}
                  icon={ChevronsUpDown}
                  size="small"
                  title={t('agentSidebar.switchAgent')}
                />
              </Flexbox>
            </DropdownMenu>
          </Flexbox>
        }
        showBack={false}
        showTogglePanelButton={false}
      />
    );
  },
);

AgentSidebarHeader.displayName = 'AgentSidebarHeader';

export default AgentSidebarHeader;
