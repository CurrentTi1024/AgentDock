// Adapted from: src/features/AgentHome (LobeHub canary)
import { Avatar, Button, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';

import { useI18n } from '@/i18n';

interface WelcomeProps {
  agentName: string;
  agentIcon?: string;
  onSuggestion: (value: string) => void;
}

const suggestions = ['chat.suggestion.analyze', 'chat.suggestion.compare', 'chat.suggestion.summary'];

const Welcome = memo<WelcomeProps>(({ agentIcon, agentName, onSuggestion }) => (
  <WelcomeInner agentIcon={agentIcon} agentName={agentName} onSuggestion={onSuggestion} />
));

Welcome.displayName = 'Welcome';

const WelcomeInner = memo<WelcomeProps>(({ agentIcon, agentName, onSuggestion }) => {
  const { t } = useI18n();
  return (
    <Flexbox align="center" gap={16} paddingBlock={48}>
      <Avatar avatar={agentIcon || '🛩️'} shape="square" size={64} />
      <Flexbox align="center" gap={6}>
        <Text as="h1" fontSize={22} weight={600}>
          {t('chat.welcome.title', { name: agentName })}
        </Text>
        <Text type="secondary">{t('chat.welcome.desc')}</Text>
      </Flexbox>
      <Flexbox horizontal gap={8} wrap="wrap">
        {suggestions.map((suggestion) => (
          <Button key={suggestion} onClick={() => onSuggestion(suggestion)}>
            {t(suggestion)}
          </Button>
        ))}
      </Flexbox>
    </Flexbox>
  );
});

export default Welcome;
