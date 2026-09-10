import { ActionIcon, Flexbox, Icon, Segmented, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Check, Code2, Copy, Download, Eye, FileCode2, X } from 'lucide-react';
import { useState } from 'react';

import type { HtmlArtifact } from '@/features/chat/htmlArtifact';
import { useI18n } from '@/i18n';
import { CodePreviewRenderer } from './CodePreviewRenderer';

export const HtmlArtifactPanel = ({ artifact, onClose }: { artifact: HtmlArtifact; onClose: () => void }) => {
  const { t } = useI18n();
  const [tab, setTab] = useState<'preview' | 'source'>(artifact.presentation.defaultTab);
  const [copied, setCopied] = useState(false);

  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(artifact.body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.warn('[AgentDock] Copy preview source failed', { error });
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([artifact.body], { type: `${artifact.mimeType};charset=utf-8` }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = artifact.fileName;
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Flexbox height="100%" style={{ minHeight: 0 }}>
      <Flexbox
        horizontal
        align="center"
        gap={8}
        paddingInline={12}
        style={{ borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}`, minHeight: 52 }}
      >
        <Icon icon={FileCode2} />
        <Text ellipsis style={{ flex: 1 }} title={artifact.fileName} weight={500}>{artifact.fileName}</Text>
        <Segmented
          options={[
            { icon: <Icon icon={Eye} size={14} />, label: t('chat.artifact.preview'), value: 'preview' },
            { icon: <Icon icon={Code2} size={14} />, label: t('chat.artifact.source'), value: 'source' },
          ]}
          size="small"
          value={tab}
          onChange={(value) => setTab(value as 'preview' | 'source')}
        />
        <ActionIcon aria-label={t('chat.artifact.copySource')} icon={copied ? Check : Copy} onClick={() => void copySource()} />
        <ActionIcon aria-label={t('artifact.download')} icon={Download} onClick={download} />
        <ActionIcon aria-label={t('common.close')} icon={X} onClick={onClose} />
      </Flexbox>
      {tab === 'preview' ? (
        <Flexbox flex={1} style={{ minHeight: 0, overflow: 'hidden' }}>
          <CodePreviewRenderer preview={artifact} />
        </Flexbox>
      ) : (
        <pre style={{ flex: 1, fontFamily: cssVar.fontFamilyCode, fontSize: 12, margin: 0, overflow: 'auto', padding: 16, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {artifact.body}
        </pre>
      )}
    </Flexbox>
  );
};
