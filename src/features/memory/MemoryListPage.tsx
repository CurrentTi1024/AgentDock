// Adapted from: src/routes/(main)/memory/{contexts,experiences,preferences,identities,activities} (LobeHub canary)
import {
  ActionIcon,
  Avatar,
  Block,
  Button,
  Center,
  DropdownMenu,
  Empty,
  Flexbox,
  Icon,
  Input,
  Modal,
  SearchBar,
  Select,
  Tag,
  Text,
  TextArea,
} from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { LayoutGrid, List, MoreHorizontal, Pencil, Pin, Plus, Rows3, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import NavHeader from '@/components/shell/NavHeader';
import WideScreenContainer from '@/components/shell/WideScreenContainer';
import {
  memoryService,
  type MemoryItem,
  type MemoryKind,
} from '@/api/memory/memoryService';
import { useI18n } from '@/i18n';
import type { MemoryTabKey } from './MemoryLayout';

type ViewMode = 'grid' | 'timeline';

const KIND_META: Record<MemoryKind, { categoryKey: string; titleKey: string }> = {
  context: { categoryKey: 'memory.category.context', titleKey: 'memory.tab.contexts' },
  experience: { categoryKey: 'memory.category.experience', titleKey: 'memory.tab.experiences' },
  preference: { categoryKey: 'memory.category.preference', titleKey: 'memory.tab.preferences' },
  identity: { categoryKey: 'memory.category.identity', titleKey: 'memory.tab.identities' },
  activity: { categoryKey: 'memory.category.activity', titleKey: 'memory.tab.activities' },
};

const KIND_BY_TAB: Record<MemoryTabKey, MemoryKind | undefined> = {
  home: undefined,
  contexts: 'context',
  experiences: 'experience',
  preferences: 'preference',
  identities: 'identity',
  activities: 'activity',
};

const CATEGORY_OPTIONS = [
  '偏好',
  '沟通',
  '格式',
  '上下文',
  '经验',
  '身份',
  '活动',
];

const MemoryListPage = memo(() => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const tab = (location.pathname.split('/memory/')[1] as MemoryTabKey | undefined) ?? 'contexts';
  const kind = KIND_BY_TAB[tab];
  const titleKey = kind ? KIND_META[kind].titleKey : 'memory.tab.contexts';

  const [items, setItems] = useState<MemoryItem[]>([]);
  const [keyword, setKeyword] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MemoryItem | null>(null);
  const [editing, setEditing] = useState<MemoryItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const data = await memoryService.getMemoryItems({ kind });
        if (!signal?.aborted) setItems(data);
      } catch (reason) {
        if (!signal?.aborted) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [kind],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const filtered = useMemo(() => {
    const query = keyword.toLowerCase();
    return items.filter(
      (item) => !query || `${item.title}${item.content}${item.tags.join(' ')}`.toLowerCase().includes(query),
    );
  }, [items, keyword]);

  const handleDelete = useCallback(
    (item: MemoryItem) => {
      if (!window.confirm(t('memory.deleteConfirm'))) return;
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      if (selected?.id === item.id) setSelected(null);
      void memoryService.deleteMemoryItem(item.id).catch((reason) => {
        console.warn('[AgentDock] memory delete failed', reason);
        void load();
      });
    },
    [load, selected, t],
  );

  const handleTogglePin = useCallback(
    (item: MemoryItem) => {
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id ? { ...candidate, pinned: !candidate.pinned } : candidate,
        ),
      );
      void memoryService.updateMemoryItem(item.id, { pinned: !item.pinned }).catch((reason) => {
        console.warn('[AgentDock] memory pin failed', reason);
        void load();
      });
    },
    [load],
  );

  const handleSave = useCallback(
    async (value: Pick<MemoryItem, 'title' | 'content' | 'category' | 'tags'>) => {
      if (editing) {
        const next = { ...editing, ...value };
        setItems((current) => current.map((item) => (item.id === next.id ? next : item)));
        setSelected(next);
        await memoryService.updateMemoryItem(editing.id, value);
      } else if (kind) {
        const created = await memoryService.createMemoryItem({
          kind,
          title: value.title,
          content: value.content,
          category: value.category,
          tags: value.tags,
        });
        setItems((current) => [created, ...current]);
      }
      setEditing(null);
      setCreating(false);
    },
    [editing, kind],
  );

  return (
    <Flexbox flex={1} height="100%" style={{ overflow: 'hidden' }}>
      <NavHeader
        left={<Text weight={500}>{t(titleKey)}</Text>}
        right={
          <Flexbox horizontal align="center" gap={4}>
            <SearchBar
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={t('memory.search')}
              style={{ width: 200 }}
              value={keyword}
            />
            <ActionIcon icon={Plus} size="small" title={t('memory.new')} onClick={() => setCreating(true)} />
            <ActionIcon
              icon={viewMode === 'grid' ? Rows3 : LayoutGrid}
              size="small"
              title={viewMode === 'grid' ? t('memory.timeline') : t('memory.grid')}
              onClick={() => setViewMode((current) => (current === 'grid' ? 'timeline' : 'grid'))}
            />
          </Flexbox>
        }
      />
      <Flexbox flex={1} horizontal style={{ overflow: 'hidden' }}>
        <WideScreenContainer
          gap={12}
          paddingBlock={20}
          wrapperStyle={{ flex: 1, overflowY: 'auto' }}
        >
          {loading && items.length === 0 ? (
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
              <Empty
                description={keyword ? t('memory.emptySearch') : t('memory.empty')}
                icon={kind ? KIND_ICONS[kind] : undefined}
              />
            </Center>
          ) : viewMode === 'grid' ? (
            <Flexbox gap={10} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
              {filtered.map((item) => (
                <MemoryGridCard
                  active={selected?.id === item.id}
                  item={item}
                  key={item.id}
                  onDelete={() => handleDelete(item)}
                  onEdit={() => setEditing(item)}
                  onOpen={() => setSelected(item)}
                  onTogglePin={() => handleTogglePin(item)}
                />
              ))}
            </Flexbox>
          ) : (
            <Flexbox gap={2}>
              {filtered.map((item) => (
                <TimelineRow
                  active={selected?.id === item.id}
                  item={item}
                  key={item.id}
                  onDelete={() => handleDelete(item)}
                  onEdit={() => setEditing(item)}
                  onOpen={() => setSelected(item)}
                  onTogglePin={() => handleTogglePin(item)}
                />
              ))}
            </Flexbox>
          )}
        </WideScreenContainer>
        {selected && (
          <MemoryRightPanel
            item={selected}
            onClose={() => setSelected(null)}
            onDelete={() => handleDelete(selected)}
            onEdit={() => setEditing(selected)}
            onTogglePin={() => handleTogglePin(selected)}
          />
        )}
      </Flexbox>
      {(editing || creating) && (
        <MemoryEditModal
          defaultValue={editing ?? undefined}
          kind={kind}
          onCancel={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSave={handleSave}
        />
      )}
    </Flexbox>
  );
});

MemoryListPage.displayName = 'MemoryListPage';

const KIND_ICONS = {
  context: '📎',
  experience: '💡',
  preference: '❤️',
  identity: '🪪',
  activity: '📅',
} as const;

const MemoryGridCard = memo<{
  active: boolean;
  item: MemoryItem;
  onDelete: () => void;
  onEdit: () => void;
  onOpen: () => void;
  onTogglePin: () => void;
}>(({ active, item, onDelete, onEdit, onOpen, onTogglePin }) => {
  const { t } = useI18n();
  return (
    <Block
      gap={8}
      padding={14}
      style={{
        cursor: 'pointer',
        borderColor: active ? cssVar.colorPrimary : undefined,
        boxShadow: active ? cssVar.boxShadowTertiary : undefined,
      }}
      variant="outlined"
      onClick={onOpen}
    >
      <Flexbox horizontal align="center" gap={8}>
        <Avatar avatar={KIND_ICONS[item.kind]} size={32} shape="square" />
        <Flexbox flex={1} style={{ minWidth: 0 }}>
          <Text ellipsis weight={500}>
            {item.title}
          </Text>
        </Flexbox>
        <DropdownMenu
          items={[
            { icon: <Icon icon={Pencil} size={14} />, key: 'edit', label: t('memory.edit'), onClick: onEdit },
            { icon: <Icon icon={Pin} size={14} />, key: 'pin', label: item.pinned ? t('memory.unpin') : t('memory.pin'), onClick: onTogglePin },
            { type: 'divider' },
            { danger: true, icon: <Icon icon={Trash2} size={14} />, key: 'delete', label: t('memory.delete'), onClick: onDelete },
          ]}
        >
          <ActionIcon icon={MoreHorizontal} size="small" />
        </DropdownMenu>
      </Flexbox>
      <Flexbox horizontal align="center" gap={6}>
        <Tag>{item.category}</Tag>
        {item.tags.map((tag) => (
          <Tag key={tag} color="cyan">
            #{tag}
          </Tag>
        ))}
        {item.pinned && <Pin color={cssVar.colorWarning} size={13} />}
      </Flexbox>
      <Text ellipsis={{ rows: 3 }} fontSize={13} type="secondary">
        {item.content}
      </Text>
    </Block>
  );
});

const TimelineRow = memo<{
  active: boolean;
  item: MemoryItem;
  onDelete: () => void;
  onEdit: () => void;
  onOpen: () => void;
  onTogglePin: () => void;
}>(({ active, item, onDelete, onEdit, onOpen, onTogglePin }) => {
  const { locale, t } = useI18n();
  return (
    <Block
      horizontal
      align="center"
      gap={12}
      paddingBlock={10}
      paddingInline={14}
      style={{
        cursor: 'pointer',
        borderInlineStart: active ? `2px solid ${cssVar.colorPrimary}` : '2px solid transparent',
        borderRadius: 8,
      }}
      onClick={onOpen}
    >
      <Avatar avatar={KIND_ICONS[item.kind]} shape="square" size={30} />
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Flexbox horizontal align="center" gap={8}>
          <Text ellipsis weight={500}>
            {item.title}
          </Text>
          {item.pinned && <Pin color={cssVar.colorWarning} size={12} />}
        </Flexbox>
        <Text ellipsis fontSize={12} type="secondary">
          {item.category} · {item.tags.map((tag) => `#${tag}`).join(' ')}
        </Text>
      </Flexbox>
      <Text fontSize={12} style={{ flex: 'none' }} type="secondary">
        {new Date(item.updatedAt).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </Text>
      <DropdownMenu
        items={[
          { icon: <Icon icon={Pencil} size={14} />, key: 'edit', label: t('memory.edit'), onClick: onEdit },
          { icon: <Icon icon={Pin} size={14} />, key: 'pin', label: item.pinned ? t('memory.unpin') : t('memory.pin'), onClick: onTogglePin },
          { type: 'divider' },
          { danger: true, icon: <Icon icon={Trash2} size={14} />, key: 'delete', label: t('memory.delete'), onClick: onDelete },
        ]}
      >
        <ActionIcon icon={MoreHorizontal} size="small" />
      </DropdownMenu>
    </Block>
  );
});

const MemoryRightPanel = memo<{
  item: MemoryItem;
  onClose: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onTogglePin: () => void;
}>(({ item, onClose, onDelete, onEdit, onTogglePin }) => {
  const { locale, t } = useI18n();
  return (
    <Block
      style={{
        width: 320,
        flex: 'none',
        borderInlineStart: `1px solid ${cssVar.colorBorderSecondary}`,
        overflowY: 'auto',
      }}
    >
      <Flexbox gap={16} padding={16}>
        <Flexbox horizontal align="center" gap={8}>
          <Flexbox flex={1} style={{ minWidth: 0 }}>
            <Text ellipsis weight={500}>
              {item.title}
            </Text>
          </Flexbox>
          <ActionIcon icon={Pencil} onClick={onEdit} size="small" title={t('memory.edit')} />
          <ActionIcon icon={Pin} onClick={onTogglePin} size="small" title={item.pinned ? t('memory.unpin') : t('memory.pin')} />
          <ActionIcon icon={Trash2} onClick={onDelete} size="small" title={t('memory.delete')} />
          <ActionIcon icon={Rows3} onClick={onClose} size="small" title={t('common.close')} />
        </Flexbox>
        <Flexbox horizontal wrap="wrap" gap={6}>
          <Tag>{item.category}</Tag>
          {item.tags.map((tag) => (
            <Tag key={tag} color="cyan">
              #{tag}
            </Tag>
          ))}
        </Flexbox>
        <Text fontSize={13}>{item.content}</Text>
        {item.source && (
          <Text fontSize={12} type="secondary">
            {t('memory.source')}: {item.source}
          </Text>
        )}
        <Text fontSize={12} type="secondary">
          {t('memory.updatedAt', { date: new Date(item.updatedAt).toLocaleString(locale) })}
        </Text>
      </Flexbox>
    </Block>
  );
});

const MemoryEditModal = memo<{
  defaultValue?: MemoryItem;
  kind?: MemoryKind;
  onCancel: () => void;
  onSave: (value: { title: string; content: string; category: string; tags: string[] }) => void | Promise<void>;
}>(({ defaultValue, kind, onCancel, onSave }) => {
  const { t } = useI18n();
  const [title, setTitle] = useState(defaultValue?.title ?? '');
  const [content, setContent] = useState(defaultValue?.content ?? '');
  const [category, setCategory] = useState(defaultValue?.category ?? KIND_META[kind ?? 'context'].categoryKey);
  const [tags, setTags] = useState((defaultValue?.tags ?? []).join(', '));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        title,
        content,
        category,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      footer={
        <Flexbox horizontal gap={8} justify="flex-end" paddingBlock={12} paddingInline={16}>
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
          <Button loading={saving} type="primary" onClick={() => void handleSave()}>
            {t('memory.save')}
          </Button>
        </Flexbox>
      }
      onCancel={onCancel}
      open
      title={defaultValue ? t('memory.edit') : t('memory.new')}
      width="min(80%, 560px)"
    >
      <Flexbox gap={12} padding={16}>
        <Input
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t('memory.titlePlaceholder')}
          value={title}
        />
        <TextArea
          autoSize={{ maxRows: 8, minRows: 4 }}
          onChange={(event) => setContent(event.target.value)}
          placeholder={t('memory.contentPlaceholder')}
          value={content}
        />
        <Flexbox horizontal gap={12}>
          <Select
            onChange={(value) => setCategory(value as string)}
            options={CATEGORY_OPTIONS.map((item) => ({ label: item, value: item }))}
            style={{ flex: 1 }}
            value={category}
          />
          <Input
            onChange={(event) => setTags(event.target.value)}
            placeholder={t('memory.tagsPlaceholder')}
            style={{ flex: 1 }}
            value={tags}
          />
        </Flexbox>
      </Flexbox>
    </Modal>
  );
});

export default MemoryListPage;
