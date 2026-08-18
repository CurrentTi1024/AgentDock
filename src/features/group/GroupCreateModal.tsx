// 新建群聊向导 — 选择成员 Agent 与后端支持的编排模式后创建群组会话（参照 LobeHub CreateGroupModal，slim）
import { Avatar, Button, Flexbox, Icon, Input, Modal, Segmented, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Check } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { agentGroupService } from '@/api/agent-group/agentGroupService';
import { agentMarketService, type MentionAgent } from '@/api/market/agentMarketService';
import { sessionHistoryService } from '@/api/session/sessionHistoryService';
import { useI18n } from '@/i18n';
import { useGroupCreateStore } from '@/stores/groupCreateStore';

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  member: css`
    align-items: center;
    width: calc(50% - 4px);
    padding: 8px 10px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadius}px;
    cursor: pointer;
    &:hover {
      border-color: ${token.colorBorder};
      background: ${token.colorFillQuaternary};
    }
  `,
  memberSelected: css`
    align-items: center;
    width: calc(50% - 4px);
    padding: 8px 10px;
    border: 1px solid ${token.colorPrimary};
    border-radius: ${token.borderRadius}px;
    background: ${token.colorPrimaryBg};
    cursor: pointer;
  `,
}));

const memberKey = (mention: MentionAgent) => `${mention.agentId}@${mention.fab}`;

const GroupCreateContent = () => {
  const navigate = useNavigate();
  const closeModal = useGroupCreateStore((s) => s.closeModal);
  const { t } = useI18n();
  const [mentions, setMentions] = useState<MentionAgent[]>([]);
  const [modes, setModes] = useState<Array<{ modeId: string; name: string; description?: string }>>([]);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState('');
  const [error, setError] = useState<string>();

  useEffect(() => {
    void agentMarketService.getMentionAgentsList({ locale: 'zh-CN' }).then(({ items }) => setMentions(items));
    void agentGroupService.getSupportedAgentGroupOrchestrationModes({ locale: 'zh-CN' }).then((data) => {
      setModes(data.modes);
      setMode(data.defaultModeId);
    });
  }, []);

  const selectedMode = useMemo(() => modes.find((item) => item.modeId === mode), [mode, modes]);

  const toggleMember = (key: string) => {
    setError(undefined);
    setSelected((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  };

  const submit = () => {
    if (selected.length < 2) {
      setError(t('group.create.needMembers'));
      return;
    }
    if (!mode) return;
    const members = selected.map((key) => {
      const [agentId, fab] = key.split('@');
      const mention = mentions.find((item) => memberKey(item) === key);
      return { agentId, fab, version: mention?.version };
    });
    const id = `group-${crypto.randomUUID()}`;
    const record = {
      agentId: 'group',
      agentName: 'FlightAnalysis_Group',
      fab: members[0]?.fab || 'F15B',
      id,
      pinned: false,
      threadId: crypto.randomUUID(),
      title: name.trim() || t('nav.newGroup'),
      type: 'group' as const,
      version: '2.1.0',
      group: { members, orchestrationMode: mode, config: { maxIterations: 6 } },
    };
    closeModal();
    // 先跳转、配置随路由状态携带；会话异步落库，提交不等待本地写入，也不触发任何 API。
    navigate(`/group/${id}`, { state: { pendingSession: record } });
    void sessionHistoryService.createSession(record).catch((reason) => {
      console.warn('[AgentDock] group session persist failed', reason);
    });
  };

  return (
    <Flexbox gap={18}>
      <Flexbox gap={8}>
        <Text weight={500}>{t('group.create.name')}</Text>
        <Input
          placeholder={t('group.create.namePlaceholder')}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Flexbox>
      <Flexbox gap={8}>
        <Flexbox horizontal align="center" justify="space-between">
          <Text weight={500}>{t('group.create.members')}</Text>
          <Text fontSize={12} type="secondary">
            {t('group.create.membersHint')}
          </Text>
        </Flexbox>
        <Flexbox gap={8} wrap="wrap">
          {mentions.map((mention) => {
            const key = memberKey(mention);
            const active = selected.includes(key);
            return (
              <Flexbox
                className={active ? styles.memberSelected : styles.member}
                horizontal
                gap={10}
                key={key}
                onClick={() => toggleMember(key)}
              >
                <Avatar avatar={mention.icon} shape="square" size={32} />
                <Flexbox flex={1} style={{ minWidth: 0 }}>
                  <Text ellipsis fontSize={13} weight={500}>
                    {mention.agentFullName}
                  </Text>
                  <Text ellipsis fontSize={11} type="secondary">
                    {mention.description}
                  </Text>
                </Flexbox>
                <Tag size="small">{mention.fab}</Tag>
                {active && <Icon color={cssVar.colorPrimary} icon={Check} size={14} />}
              </Flexbox>
            );
          })}
        </Flexbox>
      </Flexbox>
      <Flexbox gap={8}>
        <Text weight={500}>{t('workspace.group.mode')}</Text>
        <Segmented
          block
          options={modes.map((item) => ({ label: item.name, value: item.modeId }))}
          value={mode}
          onChange={(value) => setMode(String(value))}
        />
        {selectedMode?.description && (
          <Text fontSize={12} type="secondary">
            {selectedMode.description}
          </Text>
        )}
      </Flexbox>
      {error && (
        <Text type="danger" fontSize={13}>
          {error}
        </Text>
      )}
      <Flexbox horizontal gap={8} justify="flex-end">
        <Button onClick={closeModal}>{t('common.cancel')}</Button>
        <Button type="primary" onClick={submit}>
          {t('group.home.create')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

const GroupCreateModal = () => {
  const open = useGroupCreateStore((s) => s.open);
  const closeModal = useGroupCreateStore((s) => s.closeModal);
  const { t } = useI18n();

  return (
    <Modal
      centered
      destroyOnHidden
      footer={null}
      open={open}
      title={t('nav.newGroup')}
      width={560}
      onCancel={closeModal}
    >
      <GroupCreateContent />
    </Modal>
  );
};

export default GroupCreateModal;
