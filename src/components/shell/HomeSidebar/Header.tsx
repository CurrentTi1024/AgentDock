// Adapted from: src/routes/(main)/home/_layout/Header + useCreateMenuItems (LobeHub canary)
import { ActionIcon, Avatar, Flexbox, Text } from '@lobehub/ui';
import { DropdownMenu } from '@lobehub/ui/base-ui';
import { MessageSquare, Plus, Store, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import SideBarHeaderLayout from '@/components/shell/SideBarHeaderLayout';
import { hasExplicitLocalePreference, useI18n } from '@/i18n';
import { normalizeLocale } from '@/i18n/locales';
import { sessionHistoryService } from '@/api/session/sessionHistoryService';
import { userService, type CurrentUserProfile } from '@/api/user/userService';

const Header = () => {
  const navigate = useNavigate();
  const { setLocale, t } = useI18n();
  const [profile, setProfile] = useState<CurrentUserProfile>();
  const localeAppliedRef = useRef(false);

  useEffect(() => {
    void userService.getCurrentUserProfile().then(setProfile);
  }, []);

  useEffect(() => {
    if (profile?.preferredLocale && !localeAppliedRef.current) {
      localeAppliedRef.current = true;
      // 优先级：用户显式设置 > 后端 preferredLocale > 浏览器语言
      if (!hasExplicitLocalePreference()) setLocale(normalizeLocale(profile.preferredLocale));
    }
  }, [profile?.preferredLocale, setLocale]);

  const createConversation = async () => {
    const session = await sessionHistoryService.createSession({
      agentId: 'flight-analysis',
      agentName: 'FlightAnalysis_Agent',
      fab: 'F15B',
      pinned: false,
      threadId: crypto.randomUUID(),
      title: t('nav.newSessionTitle'),
      type: 'agent',
      version: '2.1.0',
    });
    navigate(`/chat/${session.id}`);
  };

  const createGroupConversation = async () => {
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
          <Avatar avatar={profile?.avatarUrl || 'LC'} size={28} />
          <Flexbox style={{ minWidth: 0 }}>
            <Text ellipsis fontSize={14} weight={500}>
              {profile?.displayName || 'User'}
            </Text>
          </Flexbox>
        </Flexbox>
      }
      right={
        <DropdownMenu
          placement="bottomRight"
          items={[
            {
              icon: MessageSquare,
              key: 'new-chat',
              label: t('nav.newChat'),
              onClick: () => void createConversation(),
            },
            {
              icon: Users,
              key: 'new-group-chat',
              label: t('nav.newGroup'),
              onClick: () => void createGroupConversation(),
            },
            { type: 'divider' },
            {
              icon: Store,
              key: 'market-agent',
              label: t('market.agent'),
              onClick: () => navigate('/market/agent'),
            },
          ]}
        >
          <ActionIcon aria-label={t('nav.newChat')} icon={Plus} />
        </DropdownMenu>
      }
      showBack={false}
      showTogglePanelButton={false}
    />
  );
};

export default Header;
