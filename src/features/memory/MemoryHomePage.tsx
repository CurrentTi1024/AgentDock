// Adapted from: src/routes/(main)/memory/(home) (LobeHub canary)
import { ActionIcon, Block, Button, Center, Flexbox, Tag, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { BrainCircuit, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';

import NavHeader from '@/components/shell/NavHeader';
import WideScreenContainer from '@/components/shell/WideScreenContainer';
import {
  memoryService,
  type MemoryAnalysisResult,
  type MemoryPersona,
} from '@/api/memory/memoryService';
import { useI18n } from '@/i18n';

const MemoryHomePage = memo(() => {
  const { locale, t } = useI18n();
  const [persona, setPersona] = useState<MemoryPersona | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<MemoryAnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [personaResult, tagsResult] = await Promise.all([
        memoryService.getPersona(),
        memoryService.getRoleTags(),
      ]);
      setPersona(personaResult);
      setTags(tagsResult);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAnalyze = useCallback(async () => {
    setAnalyzing(true);
    try {
      const result = await memoryService.getMemoryAnalysis();
      setAnalysis(result);
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const isEmpty = !persona && tags.length === 0 && !error;

  return (
    <Flexbox flex={1} height="100%">
      <NavHeader
        right={
          isEmpty ? undefined : (
            <Flexbox horizontal align="center" gap={4}>
              {!analysis && (
                <Button icon={Sparkles} onClick={() => void handleAnalyze()} size="small" type="primary">
                  {t('memory.analyze')}
                </Button>
              )}
              <ActionIcon icon={Trash2} size="small" title={t('memory.purge')} />
            </Flexbox>
          )
        }
      />
      <Flexbox height="100%" style={{ overflowY: 'auto', paddingBottom: '16vh' }} width="100%">
        <WideScreenContainer gap={32} paddingBlock={48}>
          {loading ? (
            <Center height={240}>
              <Text type="secondary">{t('common.loading')}</Text>
            </Center>
          ) : error ? (
            <Center height={240}>
              <Flexbox gap={12} align="center">
                <Text type="secondary">{error}</Text>
                <Button onClick={() => void load()} size="small">
                  {t('common.retry')}
                </Button>
              </Flexbox>
            </Center>
          ) : isEmpty ? (
            <Center height={320}>
              <Flexbox gap={16} align="center">
                <IconLarge />
                <Flexbox gap={8} align="center">
                  <Text weight={500}>{t('memory.empty')}</Text>
                  <Text type="secondary">{t('memory.emptyDesc')}</Text>
                </Flexbox>
                <Button icon={Wand2} loading={analyzing} onClick={() => void handleAnalyze()} type="primary">
                  {t('memory.analyze')}
                </Button>
              </Flexbox>
            </Center>
          ) : (
            <>
              {tags.length > 0 && <RoleTagCloud tags={tags} />}
              {persona && (
                <>
                  <PersonaHeader persona={persona} locale={locale} />
                  <Block gap={12} padding={20} variant="outlined">
                    <Text>{persona.summary}</Text>
                    <Flexbox horizontal wrap="wrap" gap={8}>
                      {persona.traits.map((trait) => (
                        <Tag key={trait} color="cyan">
                          {trait}
                        </Tag>
                      ))}
                    </Flexbox>
                  </Block>
                </>
              )}
              {analysis && (
                <Block gap={12} padding={18} variant="filled">
                  <Flexbox horizontal align="center" gap={10}>
                    <Sparkles color={cssVar.colorWarning} size={18} />
                    <Text weight={500}>{t('memory.analysis.title')}</Text>
                  </Flexbox>
                  <Text>{analysis.summary}</Text>
                  <Flexbox horizontal wrap="wrap" gap={8}>
                    {analysis.tags.map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </Flexbox>
                  {analysis.suggestions.length > 0 && (
                    <Flexbox gap={4}>
                      {analysis.suggestions.map((suggestion) => (
                        <Text fontSize={13} key={suggestion} type="secondary">
                          · {suggestion}
                        </Text>
                      ))}
                    </Flexbox>
                  )}
                </Block>
              )}
            </>
          )}
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
});

MemoryHomePage.displayName = 'MemoryHomePage';

const IconLarge = memo(() => (
  <BrainCircuit color={cssVar.colorTextQuaternary} size={48} />
));

const RoleTagCloud = memo<{ tags: string[] }>(({ tags }) => (
  <Flexbox gap={8} style={{ flexWrap: 'wrap' }}>
    {tags.map((tag) => (
      <Tag key={tag} style={{ fontSize: 13, padding: '4px 10px' }}>
        #{tag}
      </Tag>
    ))}
  </Flexbox>
));

const PersonaHeader = memo<{ locale: string; persona: MemoryPersona }>(({ locale, persona }) => {
  const { t } = useI18n();
  return (
    <Flexbox horizontal align="center" gap={16}>
      <Block
        height={56}
        width={56}
        style={{ borderRadius: '50%', background: cssVar.colorFillSecondary, fontSize: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        🧑‍🚀
      </Block>
      <Flexbox flex={1} gap={2}>
        <Text as="h2" fontSize={20} weight={600}>
          {persona.name}
        </Text>
        <Text type="secondary">
          {persona.role} · {t('memory.updatedAt', { date: new Date(persona.updatedAt).toLocaleDateString(locale) })}
        </Text>
      </Flexbox>
    </Flexbox>
  );
});

export default MemoryHomePage;
