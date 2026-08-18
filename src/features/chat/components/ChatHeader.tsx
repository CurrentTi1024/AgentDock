// Adapted from: src/routes/(main)/agent/features/Conversation/Header (LobeHub canary)
import { ActionIcon, Avatar, Flexbox, Tag, Text, Tooltip } from '@lobehub/ui';
import { Info, PanelRight } from 'lucide-react';
import { memo } from 'react';
import { useNavigate } from 'react-router-dom';

import NavHeader from '@/components/shell/NavHeader';
import { useI18n } from '@/i18n';
import { buildAgentDetailPath } from '@/features/chat/agentDetail';

interface ChatHeaderProps {
  agentId: string;
  agentName: string;
  artifactOpen: boolean;
  fab: string;
  onToggleArtifact: () => void;
  status?: string;
}

const ChatHeader = memo<ChatHeaderProps>(
  ({ agentId, agentName, artifactOpen, fab, onToggleArtifact, status }) => {
    const navigate = useNavigate();
    const { t } = useI18n();
    return (
      <NavHeader
        left={
          <Flexbox horizontal align="center" gap={10} style={{ minWidth: 0 }}>
            <Avatar avatar="🛩️" shape="square" size={32} />
            <Flexbox style={{ minWidth: 0 }}>
              <Flexbox horizontal align="center" gap={8}>
                <Text ellipsis fontSize={15} weight={500}>
                  {agentName}
                </Text>
                <Tag color="info" size="small">
                  {fab}
                </Tag>
                {status && (
                  <Tag color={status === 'running' ? 'processing' : status === 'error' ? 'error' : 'success'} size="small">
                    {status}
                  </Tag>
                )}
              </Flexbox>
            </Flexbox>
          </Flexbox>
        }
        right={
          <Flexbox horizontal align="center" gap={2}>
            <Tooltip title={t('chat.agentInfo')}>
              <ActionIcon
                aria-label={t('chat.agentInfo')}
                icon={Info}
                onClick={() => navigate(buildAgentDetailPath(agentId, fab))}
              />
            </Tooltip>
            <Tooltip title={artifactOpen ? t('chat.workPanel.close') : t('chat.workPanel.open')}>
              <ActionIcon
                active={artifactOpen}
                aria-label={t('chat.workPanel')}
                icon={PanelRight}
                onClick={onToggleArtifact}
              />
            </Tooltip>
          </Flexbox>
        }
      />
    );
  },
);

ChatHeader.displayName = 'ChatHeader';

export default ChatHeader;
