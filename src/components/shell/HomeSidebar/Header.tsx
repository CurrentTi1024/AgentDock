// Adapted from: src/routes/(main)/home/_layout/Header (LobeHub canary)
import { ActionIcon, Avatar, Flexbox, Text, Tooltip } from '@lobehub/ui';
import { Plus } from 'lucide-react';
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
        <Tooltip title={t('nav.newChat')}>
          <ActionIcon aria-label={t('nav.newChat')} icon={Plus} onClick={() => void createConversation()} />
        </Tooltip>
      }
      showBack={false}
      showTogglePanelButton={false}
    />
  );
};

export default Header;
