// Adapted from: src/features/Pages/PageExplorer (LobeHub canary)
import {
  ActionIcon,
  Block,
  Button,
  Center,
  Empty,
  Flexbox,
  Input,
  SearchBar,
  Select,
  Tag,
  Text,
  TextArea,
} from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { FileCode2, Plus, Save, Trash2, Upload } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import NavHeader from '@/components/shell/NavHeader';
import WideScreenContainer from '@/components/shell/WideScreenContainer';
import { pageService, type PageItem } from '@/api/page/pageService';
import { useI18n } from '@/i18n';

const PagesPage = memo(() => {
  const { locale, t } = useI18n();
  const [pages, setPages] = useState<PageItem[]>([]);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<'draft' | 'published' | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PageItem | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const data = await pageService.getPagesList();
      if (!signal?.aborted) setPages(data);
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
    return pages.filter(
      (item) =>
        (!query || item.title.toLowerCase().includes(query)) &&
        (status === 'all' || item.status === status),
    );
  }, [keyword, pages, status]);

  const handleDelete = useCallback(
    (item: PageItem) => {
      if (!window.confirm(t('page.deleteConfirm'))) return;
      setPages((current) => current.filter((candidate) => candidate.id !== item.id));
      void pageService.deletePage(item.id).catch((reason) => {
        console.warn('[AgentDock] page delete failed', reason);
        void load();
      });
    },
    [load, t],
  );

  const handleSaved = useCallback((item: PageItem) => {
    setPages((current) => {
      const exists = current.some((candidate) => candidate.id === item.id);
      return exists ? current.map((candidate) => (candidate.id === item.id ? item : candidate)) : [item, ...current];
    });
    setEditing(null);
    setCreating(false);
  }, []);

  return (
    <Flexbox flex={1} height="100%" style={{ overflow: 'hidden' }}>
      <NavHeader
        left={<Text weight={500}>{t('workspace.page.title')}</Text>}
        right={
          <Flexbox horizontal align="center" gap={8}>
            <SearchBar
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={t('page.search')}
              style={{ width: 200 }}
              value={keyword}
            />
            <Select
              onChange={(value) => setStatus(value as 'all' | 'draft' | 'published')}
              options={[
                { label: t('page.status.all'), value: 'all' },
                { label: t('page.status.draft'), value: 'draft' },
                { label: t('page.status.published'), value: 'published' },
              ]}
              size="small"
              value={status}
            />
            <Button icon={Plus} onClick={() => setCreating(true)} size="small" type="primary">
              {t('page.create')}
            </Button>
          </Flexbox>
        }
      />
      <WideScreenContainer gap={12} paddingBlock={20} wrapperStyle={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <Center height={280}>
            <Text type="secondary">{t('common.loading')}</Text>
          </Center>
        ) : filtered.length === 0 ? (
          <Center height={280}>
            <Empty description={t('page.empty')} icon={FileCode2} />
          </Center>
        ) : (
          filtered.map((item) => (
            <Block
              horizontal
              align="center"
              gap={14}
              key={item.id}
              padding={14}
              style={{ cursor: 'pointer' }}
              variant="outlined"
              onClick={() => setEditing(item)}
            >
              <Block
                height={40}
                width={40}
                style={{ borderRadius: 10, background: cssVar.colorFillSecondary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <FileCode2 color={cssVar.colorTextSecondary} size={18} />
              </Block>
              <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                <Flexbox horizontal align="center" gap={8}>
                  <Text ellipsis weight={500}>
                    {item.title}
                  </Text>
                  <Tag color={item.status === 'published' ? 'success' : 'gold'}>
                    {item.status === 'published' ? t('page.status.published') : t('page.status.draft')}
                  </Tag>
                </Flexbox>
                <Text ellipsis fontSize={12} type="secondary">
                  {item.agentName ?? t('page.ownerMe')} · {new Date(item.updatedAt).toLocaleString(locale)}
                </Text>
              </Flexbox>
              <ActionIcon icon={Trash2} size="small" onClick={(event) => { event.stopPropagation(); handleDelete(item); }} />
            </Block>
          ))
        )}
      </WideScreenContainer>
      {(editing || creating) && (
        <PageEditor
          defaultValue={editing ?? undefined}
          onCancel={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={handleSaved}
        />
      )}
    </Flexbox>
  );
});

PagesPage.displayName = 'PagesPage';

const PageEditor = memo<{
  defaultValue?: PageItem;
  onCancel: () => void;
  onSaved: (item: PageItem) => void;
}>(({ defaultValue, onCancel, onSaved }) => {
  const { t } = useI18n();
  const [title, setTitle] = useState(defaultValue?.title ?? '');
  const [content, setContent] = useState(defaultValue?.content ?? '');
  const [status, setStatus] = useState<'draft' | 'published'>(defaultValue?.status ?? 'draft');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = defaultValue
        ? await pageService.updatePage(defaultValue.id, { title, content, status })
        : await pageService.createPage({ title: title || t('page.untitled'), content });
      onSaved(saved);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Block
      style={{
        position: 'fixed',
        inset: 0,
        background: cssVar.colorBgLayout,
        zIndex: 1100,
        overflowY: 'auto',
      }}
    >
      <NavHeader
        left={
          <Button onClick={onCancel} size="small" type="text">
            {t('documents.back')}
          </Button>
        }
        right={
          <Flexbox horizontal align="center" gap={8}>
            <Select
              onChange={(value) => setStatus(value as 'draft' | 'published')}
              options={[
                { label: t('page.status.draft'), value: 'draft' },
                { label: t('page.status.published'), value: 'published' },
              ]}
              size="small"
              value={status}
            />
            <Button icon={Save} loading={saving} onClick={() => void handleSave()} size="small" type="primary">
              {t('page.save')}
            </Button>
          </Flexbox>
        }
      />
      <WideScreenContainer gap={12} paddingBlock={32}>
        <Input
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t('page.titlePlaceholder')}
          size="large"
          style={{ fontSize: 24, fontWeight: 600 }}
          value={title}
        />
        <TextArea
          autoSize={{ maxRows: 40, minRows: 24 }}
          onChange={(event) => setContent(event.target.value)}
          placeholder={t('page.contentPlaceholder')}
          style={{ fontFamily: 'monospace', fontSize: 14 }}
          value={content}
        />
        <Flexbox horizontal align="center" gap={8}>
          <Upload color={cssVar.colorTextTertiary} size={14} />
          <Text fontSize={12} type="secondary">
            {t('page.editorHint')}
          </Text>
        </Flexbox>
      </WideScreenContainer>
    </Block>
  );
});

export default PagesPage;
