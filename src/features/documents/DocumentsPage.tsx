// Adapted from: src/features/AgentDocumentPage + agent/docs (LobeHub canary)
import {
  ActionIcon,
  Avatar,
  Block,
  Button,
  Center,
  Empty,
  Flexbox,
  Icon,
  Input,
  Markdown,
  Modal,
  SearchBar,
  Segmented,
  Tag,
  Text,
  TextArea,
} from '@lobehub/ui';
import { cssVar } from 'antd-style';
import {
  FileCode2,
  FileSpreadsheet,
  FileText,
  MoreHorizontal,
  Pin,
  Plus,
  Star,
  Trash2,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import NavHeader from '@/components/shell/NavHeader';
import WideScreenContainer from '@/components/shell/WideScreenContainer';
import {
  documentService,
  type DocumentFilter,
  type DocumentItem,
} from '@/api/document/documentService';
import { useI18n } from '@/i18n';

const FILE_ICON: Record<DocumentItem['category'], typeof FileText> = {
  report: FileText,
  spec: FileCode2,
  notes: FileText,
  data: FileSpreadsheet,
  minutes: FileText,
};

const formatSize = (size: number) =>
  size > 1_000_000 ? `${(size / 1_000_000).toFixed(1)} MB` : `${Math.round(size / 1000)} KB`;

const DocumentsPage = memo(() => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [filter, setFilter] = useState<DocumentFilter>('recent');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const data = await documentService.getDocumentsListByKW({ filter, keyword: keyword || undefined });
        if (!signal?.aborted) setDocuments(data);
      } catch (reason) {
        if (!signal?.aborted) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [filter, keyword],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const pinned = useMemo(() => documents.filter((item) => item.pinned), [documents]);
  const rest = useMemo(() => documents.filter((item) => !item.pinned), [documents]);

  const handleDelete = useCallback(
    (item: DocumentItem) => {
      if (!window.confirm(t('documents.deleteConfirm'))) return;
      setDocuments((current) => current.filter((candidate) => candidate.id !== item.id));
      void documentService.deleteDocument(item.id).catch((reason) => {
        console.warn('[AgentDock] document delete failed', reason);
        void load();
      });
    },
    [load, t],
  );

  return (
    <Flexbox flex={1} height="100%" style={{ overflow: 'hidden' }}>
      <NavHeader
        left={<Text weight={500}>{t('workspace.documents.title')}</Text>}
        right={
          <Flexbox horizontal align="center" gap={8}>
            <SearchBar
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={t('documents.search')}
              style={{ width: 220 }}
              value={keyword}
            />
            <Segmented
              onChange={(value) => setFilter(value as DocumentFilter)}
              options={[
                { label: t('workspace.documents.filterRecent'), value: 'recent' },
                { label: t('workspace.documents.filterMine'), value: 'mine' },
                { label: t('workspace.documents.filterShared'), value: 'shared' },
              ]}
              value={filter}
            />
            <Button icon={Plus} onClick={() => setCreateOpen(true)} size="small" type="primary">
              {t('workspace.documents.new')}
            </Button>
          </Flexbox>
        }
      />
      <WideScreenContainer gap={16} paddingBlock={20} wrapperStyle={{ flex: 1, overflowY: 'auto' }}>
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
        ) : documents.length === 0 ? (
          <Center height={280}>
            <Empty description={t('documents.empty')} icon={FileText} />
          </Center>
        ) : (
          <>
            {pinned.length > 0 && (
              <Flexbox gap={10}>
                <Flexbox horizontal align="center" gap={6}>
                  <Pin color={cssVar.colorWarning} size={14} />
                  <Text weight={500}>{t('documents.pinned')}</Text>
                </Flexbox>
                <Flexbox gap={10} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                  {pinned.map((item) => (
                    <DocumentCard
                      item={item}
                      key={item.id}
                      onDelete={() => handleDelete(item)}
                      onOpen={() => navigate(`/documents/${item.id}`)}
                    />
                  ))}
                </Flexbox>
              </Flexbox>
            )}
            <Flexbox gap={10} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
              {rest.map((item) => (
                <DocumentCard
                  item={item}
                  key={item.id}
                  onDelete={() => handleDelete(item)}
                  onOpen={() => navigate(`/documents/${item.id}`)}
                />
              ))}
            </Flexbox>
          </>
        )}
      </WideScreenContainer>
      {createOpen && (
        <CreateDocumentModal
          onCancel={() => setCreateOpen(false)}
          onCreated={(item) => {
            setDocuments((current) => [item, ...current]);
            navigate(`/documents/${item.id}`);
          }}
        />
      )}
    </Flexbox>
  );
});

DocumentsPage.displayName = 'DocumentsPage';

const DocumentCard = memo<{ item: DocumentItem; onDelete: () => void; onOpen: () => void }>(
  ({ item, onDelete, onOpen }) => {
    const { locale, t } = useI18n();
    const FileIcon = FILE_ICON[item.category] ?? FileText;
    return (
      <Block gap={10} padding={16} style={{ cursor: 'pointer' }} variant="outlined" onClick={onOpen}>
        <Flexbox horizontal align="center" gap={10}>
          <Avatar avatar={<Icon icon={FileIcon} />} shape="square" size={38} />
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Text ellipsis weight={500}>
              {item.title}
            </Text>
            <Text ellipsis fontSize={12} type="secondary">
              {item.mediaType.split('/').at(-1)} · {formatSize(item.size)}
            </Text>
          </Flexbox>
          <ActionIcon icon={MoreHorizontal} size="small" onClick={(event) => event.stopPropagation()} />
        </Flexbox>
        <Flexbox horizontal align="center" gap={6}>
          <Tag>{item.category}</Tag>
          {item.shared && <Tag color="cyan">{t('documents.shared')}</Tag>}
          {item.starred && <Star color={cssVar.colorWarning} size={13} />}
        </Flexbox>
        <Flexbox horizontal justify="space-between">
          <Text ellipsis fontSize={12} type="secondary">
            {item.owner}
          </Text>
          <Text fontSize={12} style={{ flex: 'none' }} type="secondary">
            {new Date(item.updatedAt).toLocaleDateString(locale)}
          </Text>
        </Flexbox>
      </Block>
    );
  },
);

const CreateDocumentModal = memo<{ onCancel: () => void; onCreated: (item: DocumentItem) => void }>(
  ({ onCancel, onCreated }) => {
    const { t } = useI18n();
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [saving, setSaving] = useState(false);

    const handleCreate = async () => {
      setSaving(true);
      try {
        const item = await documentService.createDocument({
          title: title || t('documents.untitled'),
          content: content || `# ${title || t('documents.untitled')}\n\n`,
        });
        onCreated(item);
        onCancel();
      } finally {
        setSaving(false);
      }
    };

    return (
      <Modal
        footer={
          <Flexbox horizontal gap={8} justify="flex-end" paddingBlock={12} paddingInline={16}>
            <Button onClick={onCancel}>{t('common.cancel')}</Button>
            <Button loading={saving} type="primary" onClick={() => void handleCreate()}>
              {t('documents.create')}
            </Button>
          </Flexbox>
        }
        onCancel={onCancel}
        open
        title={t('workspace.documents.new')}
        width="min(80%, 560px)"
      >
        <Flexbox gap={12} padding={16}>
          <Input
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('documents.titlePlaceholder')}
            value={title}
          />
          <TextArea
            autoSize={{ maxRows: 8, minRows: 4 }}
            onChange={(event) => setContent(event.target.value)}
            placeholder={t('documents.contentPlaceholder')}
            value={content}
          />
        </Flexbox>
      </Modal>
    );
  },
);

export default DocumentsPage;

export function DocumentDetailPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<DocumentItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    void documentService
      .getDocumentDetailById(id)
      .then(setItem)
      .finally(() => setLoading(false));
  }, [id]);

  const handleDelete = useCallback(() => {
    if (!item || !window.confirm(t('documents.deleteConfirm'))) return;
    void documentService.deleteDocument(item.id).then(() => navigate('/documents'));
  }, [item, navigate, t]);

  return (
    <Flexbox flex={1} height="100%" style={{ overflow: 'hidden' }}>
      <NavHeader
        left={
          <Button icon={FileText} onClick={() => navigate('/documents')} size="small" type="text">
            {t('documents.back')}
          </Button>
        }
        right={
          item && (
            <Flexbox horizontal align="center" gap={8}>
              <Tag>{item.category}</Tag>
              <ActionIcon
                aria-label={t('memory.delete')}
                icon={Trash2}
                size="small"
                title={t('memory.delete')}
                onClick={handleDelete}
              />
            </Flexbox>
          )
        }
      />
      <WideScreenContainer gap={20} paddingBlock={32} wrapperStyle={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <Center height={280}>
            <Text type="secondary">{t('common.loading')}</Text>
          </Center>
        ) : !item ? (
          <Center height={280}>
            <Empty description={t('documents.notFound')} icon={FileText} />
          </Center>
        ) : (
          <>
            <Flexbox gap={8}>
              <Text as="h1" fontSize={28} weight={600}>
                {item.title}
              </Text>
              <Flexbox horizontal align="center" gap={12} wrap="wrap">
                <Tag>{item.mediaType.split('/').at(-1)}</Tag>
                <Text fontSize={12} type="secondary">
                  {item.owner} · {formatSize(item.size)} · {new Date(item.updatedAt).toLocaleString()}
                </Text>
              </Flexbox>
            </Flexbox>
            <Block gap={16} padding={24} variant="outlined">
              {item.mediaType === 'text/csv' ? (
                <Text style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', fontSize: 13 }}>
                  {item.content}
                </Text>
              ) : (
                <Markdown variant="chat">{item.content || ''}</Markdown>
              )}
            </Block>
          </>
        )}
      </WideScreenContainer>
    </Flexbox>
  );
}
