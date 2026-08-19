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

const MemoryListPage = memo(() => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const tab = (location.pathname.split('/memory/')[1] as MemoryTabKey | undefined) ?? 'contexts';
  const kind = KIND_BY_TAB[tab];
  const titleKey = kind ? KIND_META[kind].titleKey : 'memory.tab.contexts';

  const [items, setItems] = useState<MemoryItem[]>([]);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState<string | null>(null);
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

  // FilterBar：分类选项从数据派生（遵循“后端/Mock 数据原文展示”规则，不硬编码 UI 文案）。
  const categories = useMemo(
    () => [...new Set(items.map((item) => item.category).filter(Boolean))],
    [items],
  );

  const filtered = useMemo(() => {
    const query = keyword.toLowerCase();
    return items.filter(
      (item) =>
        (!query || `${item.title}${item.content}${item.tags.join(' ')}`.toLowerCase().includes(query)) &&
        (!category || item.category === category),
    );
  }, [category, items, keyword]);

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
            <ActionIcon
              aria-label={t('memory.new')}
              icon={Plus}
              size="small"
              title={t('memory.new')}
              onClick={() => setCreating(true)}
            />
            <ActionIcon
              aria-label={viewMode === 'grid' ? t('memory.timeline') : t('memory.grid')}
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
          ) : (
            <>
              {categories.length > 1 && (
                <Flexbox horizontal align="center" gap={6} wrap="wrap">
                  <Tag
                    style={{ cursor: 'pointer' }}
                    color={category === null ? 'blue' : undefined}
                    onClick={() => setCategory(null)}
                  >
                    {t('memory.filterAll')}
                  </Tag>
                  {categories.map((item) => (
                    <Tag
                      key={item}
                      style={{ cursor: 'pointer' }}
                      color={category === item ? 'blue' : undefined}
                      onClick={() => setCategory((current) => (current === item ? null : item))}
                    >
                      {item}
                    </Tag>
                  ))}
                </Flexbox>
              )}
              {viewMode === 'grid' ? (
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
                <TimelineGroups
                  items={filtered}
                  selectedId={selected?.id}
                  onDelete={handleDelete}
                  onEdit={setEditing}
                  onOpen={setSelected}
                  onTogglePin={handleTogglePin}
                />
              )}
            </>
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
          categories={categories}
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

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
const startOfWeek = (date: Date) => {
  const day = (date.getDay() + 6) % 7; // 周一为一周起点
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - day);
  return start.getTime();
};
const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1).getTime();

const periodKeyOf = (value: string): PeriodKey => {
  const time = new Date(value).getTime();
  const now = new Date();
  if (time >= startOfDay(now)) return 'today';
  if (time >= startOfWeek(now)) return 'week';
  if (time >= startOfMonth(now)) return 'month';
  return 'earlier';
};

type PeriodKey = 'earlier' | 'month' | 'today' | 'week';
const PERIOD_ORDER: PeriodKey[] = ['today', 'week', 'month', 'earlier'];

/** 时间线按时间段分组（LobeHub TimeLineView/PeriodGroup）。 */
const TimelineGroups = memo<{
  items: MemoryItem[];
  selectedId?: string;
  onDelete: (item: MemoryItem) => void;
  onEdit: (item: MemoryItem) => void;
  onOpen: (item: MemoryItem) => void;
  onTogglePin: (item: MemoryItem) => void;
}>(({ items, selectedId, onDelete, onEdit, onOpen, onTogglePin }) => {
  const { t } = useI18n();
  const groups = useMemo(() => {
    const map = new Map<PeriodKey, MemoryItem[]>();
    for (const key of PERIOD_ORDER) map.set(key, []);
    for (const item of items) {
      map.get(periodKeyOf(item.updatedAt))?.push(item);
    }
    return [...map.entries()].filter(([, list]) => list.length > 0);
  }, [items]);

  return (
    <Flexbox gap={12}>
      {groups.map(([key, list]) => (
        <Flexbox gap={4} key={key}>
          <Text fontSize={12} type="secondary" weight={500}>
            {t(`memory.period.${key}`)}
          </Text>
          <Flexbox gap={2}>
            {list.map((item) => (
              <TimelineRow
                active={selectedId === item.id}
                item={item}
                key={item.id}
                onDelete={() => onDelete(item)}
                onEdit={() => onEdit(item)}
                onOpen={() => onOpen(item)}
                onTogglePin={() => onTogglePin(item)}
              />
            ))}
          </Flexbox>
        </Flexbox>
      ))}
    </Flexbox>
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
          <ActionIcon aria-label={t('memory.edit')} icon={Pencil} onClick={onEdit} size="small" title={t('memory.edit')} />
          <ActionIcon
            aria-label={item.pinned ? t('memory.unpin') : t('memory.pin')}
            icon={Pin}
            onClick={onTogglePin}
            size="small"
            title={item.pinned ? t('memory.unpin') : t('memory.pin')}
          />
          <ActionIcon aria-label={t('memory.delete')} icon={Trash2} onClick={onDelete} size="small" title={t('memory.delete')} />
          <ActionIcon aria-label={t('common.close')} icon={Rows3} onClick={onClose} size="small" title={t('common.close')} />
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
  categories: string[];
  defaultValue?: MemoryItem;
  kind?: MemoryKind;
  onCancel: () => void;
  onSave: (value: { title: string; content: string; category: string; tags: string[] }) => void | Promise<void>;
}>(({ categories, defaultValue, kind, onCancel, onSave }) => {
  const { t } = useI18n();
  const [title, setTitle] = useState(defaultValue?.title ?? '');
  const [content, setContent] = useState(defaultValue?.content ?? '');
  const [category, setCategory] = useState(
    defaultValue?.category ?? categories[0] ?? KIND_META[kind ?? 'context'].categoryKey,
  );
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
            options={[
              ...categories.map((item) => ({ label: item, value: item })),
              ...(categories.includes(KIND_META[kind ?? 'context'].categoryKey)
                ? []
                : [{ label: KIND_META[kind ?? 'context'].categoryKey, value: KIND_META[kind ?? 'context'].categoryKey }]),
            ]}
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
