// Adapted to AgentDock from LobeHub conversation process blocks and modal/form primitives.
import { Block, Button, Flexbox, Input, Modal, Tag, Text, TextArea } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CircleHelp, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { HitlValidationError, validateHitlResumeBatch } from '@/api/runtime/hitl';
import type {
  HitlChoiceAnswer,
  HitlFormField,
  HitlInterrupt,
  HitlResumeEntry,
} from '@/api/runtime/types';
import { useI18n } from '@/i18n';

type ResolvedEntry = Extract<HitlResumeEntry, { status: 'resolved' }>;
type HitlAction = ResolvedEntry['payload']['action'];

interface HitlDraft {
  action: HitlAction;
  answer?: unknown;
}

export interface HitlBatchBlockProps {
  interrupts: HitlInterrupt[];
  onRespond: (resume: HitlResumeEntry[]) => void;
  responses?: HitlResumeEntry[];
  status?: 'pending' | 'resolved' | 'submitting';
}

const emptyChoice = (): HitlChoiceAnswer => ({ selected: [] });

const initialDraft = (interrupt: HitlInterrupt): HitlDraft => {
  if (interrupt.spec.kind === 'confirm') return { action: 'continue' };
  if (interrupt.spec.kind === 'choice') return { action: 'submit', answer: emptyChoice() };
  if (interrupt.spec.kind === 'form') return { action: 'submit', answer: {} };
  return { action: 'submit', answer: '' };
};

const normalizeAnswer = (interrupt: HitlInterrupt, answer: unknown): unknown => {
  if (interrupt.spec.kind !== 'form' || !answer || typeof answer !== 'object' || Array.isArray(answer)) {
    return answer;
  }
  const normalized = { ...(answer as Record<string, unknown>) };
  for (const field of interrupt.spec.fields) {
    const value = normalized[field.name];
    if (field.kind !== 'datetime' || typeof value !== 'string' || !value) continue;
    const timestamp = new Date(value);
    if (!Number.isNaN(timestamp.getTime())) normalized[field.name] = timestamp.toISOString();
  }
  return normalized;
};

const ChoiceControl = ({
  allowOther,
  multiple,
  name,
  onChange,
  options,
  value,
}: {
  allowOther?: boolean;
  multiple?: boolean;
  name: string;
  onChange: (value: HitlChoiceAnswer) => void;
  options: Array<{ description?: string; label: string; value: string }>;
  value: HitlChoiceAnswer;
}) => {
  const { t } = useI18n();
  const toggle = (optionValue: string) => {
    const selected = multiple
      ? value.selected.includes(optionValue)
        ? value.selected.filter((item) => item !== optionValue)
        : [...value.selected, optionValue]
      : [optionValue];
    onChange({ ...value, selected });
  };

  return (
    <Flexbox gap={8}>
      {options.map((option) => (
        <label key={option.value} style={{ cursor: 'pointer' }}>
          <Flexbox horizontal align="flex-start" gap={8}>
            <input
              checked={value.selected.includes(option.value)}
              name={multiple ? undefined : `hitl-choice-${name}`}
              type={multiple ? 'checkbox' : 'radio'}
              onChange={() => toggle(option.value)}
            />
            <Flexbox gap={2}>
              <Text fontSize={13}>{option.label}</Text>
              {option.description && <Text fontSize={12} type="secondary">{option.description}</Text>}
            </Flexbox>
          </Flexbox>
        </label>
      ))}
      {allowOther && (
        <Flexbox gap={4}>
          <Text fontSize={12} weight={500}>{t('chat.hitl.other')}</Text>
          <Input
            value={value.other ?? ''}
            onChange={(event) => onChange({ ...value, other: event.target.value })}
          />
        </Flexbox>
      )}
    </Flexbox>
  );
};

const FormFieldControl = ({
  field,
  name,
  onChange,
  value,
}: {
  field: HitlFormField;
  name: string;
  onChange: (value: HitlChoiceAnswer | number | string | undefined) => void;
  value: unknown;
}) => {
  if (field.kind === 'choice') {
    return (
      <ChoiceControl
        allowOther={field.allowOther}
        multiple={field.multiple}
        name={name}
        options={field.options}
        value={(value as HitlChoiceAnswer | undefined) ?? emptyChoice()}
        onChange={onChange}
      />
    );
  }
  if (field.kind === 'textarea') {
    return (
      <TextArea
        autoSize={{ maxRows: 6, minRows: 2 }}
        maxLength={field.maxLength}
        placeholder={field.placeholder}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <Input
      maxLength={field.kind === 'text' ? field.maxLength : undefined}
      placeholder={field.kind === 'text' ? field.placeholder : undefined}
      type={field.kind === 'datetime' ? 'datetime-local' : field.kind}
      value={typeof value === 'number' || typeof value === 'string' ? value : ''}
      onChange={(event) => {
        if (field.kind === 'number') {
          onChange(event.target.value === '' ? undefined : Number(event.target.value));
        } else {
          onChange(event.target.value);
        }
      }}
    />
  );
};

export const HitlBatchBlock = ({
  interrupts,
  onRespond,
  responses,
  status = 'pending',
}: HitlBatchBlockProps) => {
  const { t } = useI18n();
  const batchKey = interrupts.map((item) => item.id).join('|');
  const [drafts, setDrafts] = useState<Record<string, HitlDraft>>(() =>
    Object.fromEntries(interrupts.map((interrupt) => [interrupt.id, initialDraft(interrupt)])),
  );
  const [error, setError] = useState<string>();

  useEffect(() => {
    setDrafts(Object.fromEntries(interrupts.map((interrupt) => [interrupt.id, initialDraft(interrupt)])));
    setError(undefined);
  }, [batchKey]);

  const setDraft = (interruptId: string, next: Partial<HitlDraft>) =>
    setDrafts((current) => ({
      ...current,
      [interruptId]: { ...current[interruptId], ...next },
    }));

  const resume = useMemo<HitlResumeEntry[]>(
    () => interrupts.map((interrupt) => ({
      interruptId: interrupt.id,
      payload: {
        action: drafts[interrupt.id]?.action ?? (interrupt.spec.kind === 'confirm' ? 'continue' : 'submit'),
        ...(drafts[interrupt.id]?.answer === undefined
          ? {}
          : { answer: normalizeAnswer(interrupt, drafts[interrupt.id].answer) as never }),
      },
      status: 'resolved' as const,
    })),
    [drafts, interrupts],
  );

  const submit = () => {
    try {
      validateHitlResumeBatch(interrupts, resume);
      setError(undefined);
      onRespond(resume);
    } catch (cause) {
      setError(cause instanceof HitlValidationError ? cause.message : t('chat.hitl.invalid'));
    }
  };

  const cancel = () => onRespond(interrupts.map((interrupt) => ({
    interruptId: interrupt.id,
    status: 'cancelled' as const,
  })));

  const renderInterrupt = (interrupt: HitlInterrupt, index: number) => {
    const draft = drafts[interrupt.id] ?? initialDraft(interrupt);
    const { spec } = interrupt;
    const skipped = draft.action === 'skip';

    return (
      <Block gap={10} key={interrupt.id} padding={12} variant="outlined">
        <Flexbox horizontal align="center" gap={8}>
          {interrupts.length > 1 && <Tag size="small">{index + 1}/{interrupts.length}</Tag>}
          <Text weight={600}>{spec.title || t('chat.hitl.title')}</Text>
        </Flexbox>
        <Text type="secondary">{interrupt.message}</Text>

        {spec.kind === 'confirm' && (
          <Flexbox gap={8}>
            <label><input checked={draft.action === 'continue'} type="radio" onChange={() => setDraft(interrupt.id, { action: 'continue', answer: undefined })} /> {t('chat.hitl.continue')}</label>
            {spec.allowRevision && (
              <label><input checked={draft.action === 'revise'} type="radio" onChange={() => setDraft(interrupt.id, { action: 'revise', answer: '' })} /> {t('chat.hitl.revise')}</label>
            )}
            {spec.allowSkip && (
              <label><input checked={draft.action === 'skip'} type="radio" onChange={() => setDraft(interrupt.id, { action: 'skip', answer: undefined })} /> {t('chat.hitl.skip')}</label>
            )}
            {draft.action === 'revise' && (
              <TextArea
                autoSize={{ maxRows: 6, minRows: 2 }}
                value={typeof draft.answer === 'string' ? draft.answer : ''}
                onChange={(event) => setDraft(interrupt.id, { answer: event.target.value })}
              />
            )}
          </Flexbox>
        )}

        {spec.kind !== 'confirm' && (
          <Flexbox gap={10}>
            {spec.allowSkip && (
              <label>
                <input
                  checked={skipped}
                  type="checkbox"
                  onChange={(event) => setDraft(
                    interrupt.id,
                    event.target.checked
                      ? { action: 'skip', answer: undefined }
                      : initialDraft(interrupt),
                  )}
                />{' '}
                {t('chat.hitl.skip')}
              </label>
            )}
            {!skipped && spec.kind === 'text' && (
              <Flexbox gap={4}>
                {spec.label && <Text fontSize={12} weight={500}>{spec.label}</Text>}
                {spec.multiline ? (
                  <TextArea
                    autoSize={{ maxRows: 8, minRows: 2 }}
                    maxLength={spec.maxLength}
                    placeholder={spec.placeholder}
                    value={typeof draft.answer === 'string' ? draft.answer : ''}
                    onChange={(event) => setDraft(interrupt.id, { answer: event.target.value })}
                  />
                ) : (
                  <Input
                    maxLength={spec.maxLength}
                    placeholder={spec.placeholder}
                    value={typeof draft.answer === 'string' ? draft.answer : ''}
                    onChange={(event) => setDraft(interrupt.id, { answer: event.target.value })}
                  />
                )}
              </Flexbox>
            )}
            {!skipped && spec.kind === 'choice' && (
              <ChoiceControl
                allowOther={spec.allowOther}
                multiple={spec.multiple}
                name={interrupt.id}
                options={spec.options}
                value={(draft.answer as HitlChoiceAnswer | undefined) ?? emptyChoice()}
                onChange={(answer) => setDraft(interrupt.id, { answer })}
              />
            )}
            {!skipped && spec.kind === 'form' && (
              <Flexbox gap={12}>
                {spec.fields.map((field) => {
                  const values = (draft.answer ?? {}) as Record<string, unknown>;
                  return (
                    <Flexbox gap={4} key={field.name}>
                      <Text fontSize={12} weight={500}>
                        {field.label}{field.required ? ' *' : ''}
                      </Text>
                      <FormFieldControl
                        field={field}
                        name={`${interrupt.id}-${field.name}`}
                        value={values[field.name]}
                        onChange={(value) => {
                          const nextValues = { ...values };
                          if (value === undefined) delete nextValues[field.name];
                          else nextValues[field.name] = value;
                          setDraft(interrupt.id, { answer: nextValues });
                        }}
                      />
                    </Flexbox>
                  );
                })}
              </Flexbox>
            )}
          </Flexbox>
        )}
      </Block>
    );
  };

  const resolved = status === 'resolved';
  return (
    <>
      <Block gap={10} padding={14} variant="outlined">
        <Flexbox horizontal align="center" gap={8}>
          <CircleHelp color={resolved ? cssVar.colorSuccess : cssVar.colorWarning} size={16} />
          <Text weight={500}>{resolved ? t('chat.hitl.completed') : t('chat.hitl.title')}</Text>
          <Tag color={resolved ? 'success' : 'warning'} size="small">HITL</Tag>
          {resolved && responses && <Tag size="small">{responses.length}/{interrupts.length}</Tag>}
        </Flexbox>
        <Text type="secondary">
          {resolved
            ? t('chat.hitl.completedDesc')
            : interrupts.map((item) => item.message).join(' · ')}
        </Text>
      </Block>

      <Modal
        cancelText={t('chat.hitl.cancel')}
        closable={false}
        confirmLoading={status === 'submitting'}
        footer={
          <Flexbox horizontal justify="flex-end" gap={8}>
            <Button icon={X} onClick={cancel}>{t('chat.hitl.cancel')}</Button>
            <Button type="primary" onClick={submit}>{t('chat.hitl.submit')}</Button>
          </Flexbox>
        }
        keyboard={false}
        maskClosable={false}
        open={status === 'pending' || status === 'submitting'}
        title={t('chat.hitl.title')}
        width={interrupts.some((item) => item.spec.kind === 'form' && item.spec.fields.length > 4) ? 720 : 560}
        onCancel={cancel}
      >
        <Flexbox gap={12}>
          {interrupts.map(renderInterrupt)}
          {error && <Text style={{ color: cssVar.colorError }}>{error}</Text>}
        </Flexbox>
      </Modal>
    </>
  );
};
