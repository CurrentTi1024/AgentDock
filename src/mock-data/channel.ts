export type ChannelRuntimeStatus =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'error'
  | 'pending';

export interface ChannelConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'textarea' | 'number';
  placeholder?: string;
  required?: boolean;
}

export interface ChannelPlatform {
  id: string;
  name: string;
  icon: string;
  description: string;
  status: ChannelRuntimeStatus;
  enabled: boolean;
  comingSoon?: boolean;
  connectedAt?: string;
  configFields?: ChannelConfigField[];
  config?: Record<string, unknown>;
  runtimeStatus?: string;
}

export const channelMockData: ChannelPlatform[] = [
  {
    id: 'web',
    name: 'AgentDock Web',
    icon: '🌐',
    description: '内置 Web 会话渠道，开箱即用。',
    status: 'connected',
    enabled: true,
    connectedAt: '2026-08-01T09:00:00+08:00',
    runtimeStatus: 'online',
  },
  {
    id: 'wechat',
    name: 'WeChat',
    icon: '💬',
    description: '通过企业微信/公众号接收消息并回复。',
    status: 'disconnected',
    enabled: false,
    configFields: [
      { key: 'corpId', label: 'Corp ID', type: 'text', placeholder: 'ww1234567890abcdef', required: true },
      { key: 'secret', label: 'Secret', type: 'password', required: true },
      { key: 'agentId', label: 'Agent ID', type: 'number', required: true },
    ],
  },
  {
    id: 'line',
    name: 'LINE',
    icon: '🟢',
    description: 'LINE Messaging API 渠道。',
    status: 'disconnected',
    enabled: false,
    configFields: [
      { key: 'channelAccessToken', label: 'Channel Access Token', type: 'password', required: true },
      { key: 'channelSecret', label: 'Channel Secret', type: 'password', required: true },
    ],
  },
  {
    id: 'imessage',
    name: 'iMessage',
    icon: '📱',
    description: '通过 iMessage 与 Apple 用户通信。',
    status: 'pending',
    enabled: false,
    comingSoon: true,
  },
  {
    id: 'telegram',
    name: 'Telegram',
    icon: '✈️',
    description: 'Telegram Bot 渠道，支持群组与私聊。',
    status: 'disconnected',
    enabled: false,
    configFields: [
      { key: 'botToken', label: 'Bot Token', type: 'password', required: true },
    ],
  },
  {
    id: 'slack',
    name: 'Slack',
    icon: '🛠️',
    description: 'Slack App 渠道，支持斜杠命令与事件订阅。',
    status: 'error',
    enabled: true,
    connectedAt: '2026-08-05T10:00:00+08:00',
    configFields: [
      { key: 'botToken', label: 'Bot Token', type: 'password', required: true },
      { key: 'signingSecret', label: 'Signing Secret', type: 'password', required: true },
    ],
  },
  {
    id: 'webhook',
    name: 'Webhook',
    icon: '🔗',
    description: '通用 Webhook 入口，把外部事件转发给 Agent。',
    status: 'connected',
    enabled: true,
    connectedAt: '2026-08-06T14:00:00+08:00',
    runtimeStatus: 'online',
  },
];
