// Adapted from: src/features/Portal/Artifacts (LobeHub canary)
import {
  ActionIcon,
  Avatar,
  Block,
  Button,
  Center,
  Empty,
  Flexbox,
  Highlighter,
  Icon,
  Markdown,
  Modal,
  SearchBar,
  Tag,
  Text,
} from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Braces, Download, FileText, Image as ImageIcon, Map as MapIcon, MoreHorizontal, Table2, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import NavHeader from '@/components/shell/NavHeader';
import WideScreenContainer from '@/components/shell/WideScreenContainer';
import {
  artifactService,
  type ArtifactItem,
  type ArtifactType,
} from '@/api/artifact/artifactService';
import { useI18n } from '@/i18n';

const TYPE_META: Record<ArtifactType, { icon: typeof FileText; labelKey: string; color: string }> = {
  report: { icon: FileText, labelKey: 'artifact.type.report', color: cssVar.colorInfo },
  document: { icon: FileText, labelKey: 'artifact.type.document', color: cssVar.colorTextSecondary },
  code: { icon: Braces, labelKey: 'artifact.type.code', color: cssVar.colorSuccess },
  data: { icon: Table2, labelKey: 'artifact.type.data', color: cssVar.colorWarning },
  diagram: { icon: MapIcon, labelKey: 'artifact.type.diagram', color: cssVar.colorInfo },
  image: { icon: ImageIcon, labelKey: 'artifact.type.image', color: cssVar.colorError },
};

const ArtifactPage = memo(() => {
  const { t } = useI18n();
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<ArtifactItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const data = await artifactService.getArtifactsListBySessionId();
      if (!signal?.aborted) setArtifacts(data);
    } catch (reason) {
      if (!signal?.aborted) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const filtered = useMemo(() => {
    const query = keyword.toLowerCase();
    return artifacts.filter(
      (item) => !query || `${item.title}${item.sessionTitle}`.toLowerCase().includes(query),
    );
  }, [artifacts, keyword]);

  const groups = useMemo(() => {
    const map = new Map<string, ArtifactItem[]>();
    for (const item of filtered) {
      const list = map.get(item.sessionTitle) ?? [];
      list.push(item);
      map.set(item.sessionTitle, list);
    }
    return [...map.entries()];
  }, [filtered]);

  const handleDelete = useCallback(
    (item: ArtifactItem) => {
      if (!window.confirm(t('artifact.deleteConfirm'))) return;
      setArtifacts((current) => current.filter((candidate) => candidate.id !== item.id));
      if (preview?.id === item.id) setPreview(null);
      void artifactService.deleteArtifact(item.id).catch((reason) => {
        console.warn('[AgentDock] artifact delete failed', reason);
        void load();
      });
    },
    [load, preview, t],
  );

  return (
    <Flexbox flex={1} height="100%" style={{ overflow: 'hidden' }}>
      <NavHeader
        left={<Text weight={500}>{t('workspace.artifact.title')}</Text>}
        right={
          <SearchBar
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={t('artifact.search')}
            style={{ width: 220 }}
            value={keyword}
          />
        }
      />
      <WideScreenContainer gap={24} paddingBlock={20} wrapperStyle={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <Center height={280}>
            <Text type="secondary">{t('common.loading')}</Text>
          </Center>
        ) : error ? (
          <Center height={280}>
            <Flexbox gap={12} align="center">
              <Text type="secondary">{error}</Text>
              <Button onClick={() => void load()} size="small">
                {t('common.retry')}
              </Button>
            </Flexbox>
          </Center>
        ) : filtered.length === 0 ? (
          <Center height={280}>
            <Empty description={keyword ? t('artifact.emptySearch') : t('artifact.empty')} icon={FileText} />
          </Center>
        ) : (
          groups.map(([session, items]) => (
            <Flexbox gap={10} key={session}>
              <Text weight={500} type="secondary">
                {session}
              </Text>
              <Flexbox gap={10} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                {items.map((item) => {
                  const meta = TYPE_META[item.type] ?? TYPE_META.document;
                  const TypeIcon = meta.icon;
                  return (
                    <Block
                      gap={10}
                      key={item.id}
                      padding={14}
                      style={{ cursor: 'pointer' }}
                      variant="outlined"
                      onClick={() => setPreview(item)}
                    >
                      <Flexbox horizontal align="center" gap={10}>
                        <Avatar avatar={<Icon color={meta.color} icon={TypeIcon} />} shape="square" size={36} />
                        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                          <Text ellipsis weight={500}>
                            {item.title}
                          </Text>
                          <Text ellipsis fontSize={12} type="secondary">
                            {item.type === 'code' ? item.language : t(meta.labelKey)} · {new Date(item.updatedAt).toLocaleDateString()}
                          </Text>
                        </Flexbox>
                        <ActionIcon
                          icon={MoreHorizontal}
                          size="small"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDelete(item);
                          }}
                        />
                      </Flexbox>
                      <Text ellipsis={{ rows: 3 }} fontSize={12} type="secondary">
                        {item.content.slice(0, 180)}
                      </Text>
                    </Block>
                  );
                })}
              </Flexbox>
            </Flexbox>
          ))
        )}
      </WideScreenContainer>
      {preview && (
        <ArtifactPreview
          item={preview}
          onClose={() => setPreview(null)}
          onDelete={() => handleDelete(preview)}
        />
      )}
    </Flexbox>
  );
});

ArtifactPage.displayName = 'ArtifactPage';

const ArtifactPreview = memo<{ item: ArtifactItem; onClose: () => void; onDelete: () => void }>(
  ({ item, onClose, onDelete }) => {
    const { t } = useI18n();
    const meta = TYPE_META[item.type] ?? TYPE_META.document;
    const download = useCallback(() => {
      const blob = new Blob([item.content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${item.title}.${item.language ?? 'txt'}`;
      anchor.click();
      URL.revokeObjectURL(url);
    }, [item]);

    return (
      <Modal
        footer={null}
        onCancel={onClose}
        open
        title={
          <Flexbox horizontal align="center" gap={8}>
            <Icon color={meta.color} icon={meta.icon} size={18} />
            <Text>{item.title}</Text>
            <Tag>{t(meta.labelKey)}</Tag>
          </Flexbox>
        }
        width="min(90%, 900px)"
      >
        <Flexbox gap={12} padding={16}>
          <Flexbox horizontal align="center" gap={8}>
            <Text fontSize={12} type="secondary">
              {item.sessionTitle} · {new Date(item.updatedAt).toLocaleString()}
            </Text>
            <Flexbox flex={1} />
            <Button icon={Download} onClick={download} size="small">
              {t('artifact.download')}
            </Button>
            <Button danger icon={Trash2} onClick={onDelete} size="small">
              {t('memory.delete')}
            </Button>
          </Flexbox>
          <Block
            style={{
              maxHeight: '60vh',
              overflowY: 'auto',
              background: cssVar.colorFillQuaternary,
              borderRadius: 10,
              padding: 16,
            }}
          >
            {item.type === 'code' ? (
              <Highlighter language={item.language ?? 'plaintext'}>
                {item.content}
              </Highlighter>
            ) : (
              <Markdown variant="chat">{item.content}</Markdown>
            )}
          </Block>
        </Flexbox>
      </Modal>
    );
  },
);

export default ArtifactPage;
