// Adapted from: src/routes/(main)/agent/channel (LobeHub canary)
import {
  ActionIcon,
  Block,
  Button,
  Center,
  Empty,
  Flexbox,
  Icon,
  Input,
  Modal,
  Tag,
  Text,
  TextArea,
} from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CheckCircle2, CircleX, Loader2, Plug, RefreshCw, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';

import NavHeader from '@/components/shell/NavHeader';
import WideScreenContainer from '@/components/shell/WideScreenContainer';
import {
  channelService,
  type ChannelPlatform,
  type ChannelRuntimeStatus,
} from '@/api/channel/channelService';
import { useI18n } from '@/i18n';

const STATUS_META: Record<ChannelRuntimeStatus, { color: string; labelKey: string }> = {
  connected: { color: cssVar.colorSuccess, labelKey: 'channel.status.connected' },
  connecting: { color: cssVar.colorWarning, labelKey: 'channel.status.connecting' },
  disconnected: { color: cssVar.colorTextTertiary, labelKey: 'channel.status.disconnected' },
  error: { color: cssVar.colorError, labelKey: 'channel.status.error' },
  pending: { color: cssVar.colorInfo, labelKey: 'channel.status.pending' },
};

const ChannelPage = memo(() => {
  const { t } = useI18n();
  const [platforms, setPlatforms] = useState<ChannelPlatform[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ChannelPlatform | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const data = await channelService.getChannelsList();
      if (!signal?.aborted) {
        setPlatforms(data);
        setSelected((current) => (current ? data.find((item) => item.id === current.id) ?? null : null));
      }
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

  const handleDisconnect = useCallback(
    (platform: ChannelPlatform) => {
      if (!window.confirm(t('channel.disconnectConfirm'))) return;
      void channelService.disconnectChannel(platform.id).then(() => void load());
    },
    [load, t],
  );

  return (
    <Flexbox flex={1} height="100%" style={{ overflow: 'hidden' }}>
      <NavHeader
        left={<Text weight={500}>{t('workspace.channel.title')}</Text>}
        right={
          <ActionIcon icon={RefreshCw} size="small" title={t('common.refresh')} onClick={() => void load()} />
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
        ) : (
          <Flexbox gap={12} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {platforms.map((platform) => {
              const meta = STATUS_META[platform.status];
              return (
                <Block
                  gap={10}
                  key={platform.id}
                  padding={16}
                  style={{ cursor: 'pointer' }}
                  variant="outlined"
                  onClick={() => setSelected(platform)}
                >
                  <Flexbox horizontal align="center" gap={10}>
                    <Block
                      height={42}
                      width={42}
                      style={{ borderRadius: 10, background: cssVar.colorFillSecondary, fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      {platform.icon}
                    </Block>
                    <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                      <Text ellipsis weight={500}>
                        {platform.name}
                      </Text>
                      <Text ellipsis fontSize={12} type="secondary">
                        {platform.description}
                      </Text>
                    </Flexbox>
                    <StatusDot color={meta.color} status={platform.status} />
                  </Flexbox>
                  <Flexbox horizontal align="center" gap={6}>
                    <Tag color={platform.status === 'connected' ? 'success' : platform.status === 'error' ? 'error' : undefined}>
                      {t(meta.labelKey)}
                    </Tag>
                    {platform.comingSoon && <Tag color="gold">{t('channel.comingSoon')}</Tag>}
                    {platform.runtimeStatus && <Text fontSize={12} type="secondary">· {platform.runtimeStatus}</Text>}
                  </Flexbox>
                </Block>
              );
            })}
          </Flexbox>
        )}
      </WideScreenContainer>
      {selected && (
        <ChannelDetailPanel
          onClose={() => setSelected(null)}
          onConnect={() => setConnectOpen(true)}
          onDisconnect={() => handleDisconnect(selected)}
          onRefresh={() => void load()}
          platform={selected}
        />
      )}
      {connectOpen && selected && (
        <ConnectChannelModal
          onCancel={() => setConnectOpen(false)}
          onConnected={(next) => {
            setPlatforms((current) => current.map((item) => (item.id === next.id ? next : item)));
            setSelected(next);
            setConnectOpen(false);
          }}
          platform={selected}
        />
      )}
    </Flexbox>
  );
});

ChannelPage.displayName = 'ChannelPage';

const StatusDot = memo<{ color: string; status: ChannelRuntimeStatus }>(({ color, status }) =>
  status === 'connecting' ? (
    <Icon color={color} icon={Loader2} size={16} spin />
  ) : (
    <Icon color={color} icon={status === 'connected' ? CheckCircle2 : status === 'error' ? CircleX : Plug} size={16} />
  ),
);

const ChannelDetailPanel = memo<{
  onClose: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
  platform: ChannelPlatform;
}>(({ onClose, onConnect, onDisconnect, onRefresh, platform }) => {
  const { locale, t } = useI18n();
  const meta = STATUS_META[platform.status];
  return (
    <Block
      style={{
        position: 'fixed',
        insetInlineEnd: 0,
        top: 0,
        bottom: 0,
        width: 'min(420px, 90vw)',
        background: cssVar.colorBgContainer,
        borderInlineStart: `1px solid ${cssVar.colorBorderSecondary}`,
        zIndex: 1000,
        boxShadow: cssVar.boxShadowSecondary,
        overflowY: 'auto',
      }}
    >
      <Flexbox gap={16} padding={20}>
        <Flexbox horizontal align="center" gap={12}>
          <Block
            height={48}
            width={48}
            style={{ borderRadius: 12, background: cssVar.colorFillSecondary, fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {platform.icon}
          </Block>
          <Flexbox flex={1} gap={2}>
            <Text weight={600}>{platform.name}</Text>
            <Text fontSize={12} type="secondary">
              {platform.description}
            </Text>
          </Flexbox>
          <ActionIcon icon={RefreshCw} onClick={onRefresh} size="small" />
          <ActionIcon icon={Trash2} onClick={onClose} size="small" title={t('common.close')} />
        </Flexbox>
        <Flexbox horizontal align="center" gap={8}>
          <Tag color={platform.status === 'connected' ? 'success' : platform.status === 'error' ? 'error' : undefined}>
            {t(meta.labelKey)}
          </Tag>
          {platform.connectedAt && (
            <Text fontSize={12} type="secondary">
              {t('channel.connectedAt')}: {new Date(platform.connectedAt).toLocaleString(locale)}
            </Text>
          )}
        </Flexbox>
        <Flexbox horizontal gap={8}>
          {platform.comingSoon ? (
            <Block gap={6} padding={14} variant="filled">
              <Text>{t('channel.comingSoonDesc')}</Text>
            </Block>
          ) : platform.enabled ? (
            <Button danger icon={Plug} onClick={onDisconnect} type="primary">
              {t('channel.disconnect')}
            </Button>
          ) : (
            <Button icon={Plug} onClick={onConnect} type="primary">
              {t('channel.connect')}
            </Button>
          )}
        </Flexbox>
        {platform.configFields && (
          <Flexbox gap={8}>
            <Text weight={500}>{t('channel.config')}</Text>
            {platform.configFields.map((field) => (
              <Flexbox horizontal justify="space-between" gap={12} key={field.key}>
                <Text fontSize={13} type="secondary">
                  {field.label}
                </Text>
                <Text fontSize={13}>
                  {platform.config?.[field.key] ? String(platform.config[field.key]).replace(/./g, '•') : '—'}
                </Text>
              </Flexbox>
            ))}
          </Flexbox>
        )}
      </Flexbox>
    </Block>
  );
});

const ConnectChannelModal = memo<{
  onCancel: () => void;
  onConnected: (platform: ChannelPlatform) => void;
  platform: ChannelPlatform;
}>(({ onCancel, onConnected, platform }) => {
  const { t } = useI18n();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const handleConnect = async () => {
    setSaving(true);
    try {
      const next = await channelService.connectChannel(platform.id, values);
      onConnected(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      footer={
        <Flexbox horizontal gap={8} justify="flex-end" paddingBlock={12} paddingInline={16}>
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
          <Button loading={saving} type="primary" onClick={() => void handleConnect()}>
            {t('channel.connect')}
          </Button>
        </Flexbox>
      }
      onCancel={onCancel}
      open
      title={`${t('channel.connect')} · ${platform.name}`}
      width="min(80%, 520px)"
    >
      <Flexbox gap={12} padding={16}>
        {(platform.configFields ?? []).map((field) => (
          <Flexbox gap={6} key={field.key}>
            <Text fontSize={13} type="secondary">
              {field.label}
              {field.required && ' *'}
            </Text>
            {field.type === 'textarea' ? (
              <TextArea
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                placeholder={field.placeholder}
                value={values[field.key] ?? ''}
              />
            ) : (
              <Input
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                placeholder={field.placeholder}
                type={field.type === 'password' ? 'password' : undefined}
                value={values[field.key] ?? ''}
              />
            )}
          </Flexbox>
        ))}
        {platform.configFields?.length === 0 && (
          <Text type="secondary">{t('channel.connectEmpty')}</Text>
        )}
      </Flexbox>
    </Modal>
  );
});

export default ChannelPage;
