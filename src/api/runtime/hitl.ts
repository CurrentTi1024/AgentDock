import { z } from 'zod';

import type {
  HitlChoiceAnswer,
  HitlFormField,
  HitlInterrupt,
  HitlResumeEntry,
  HitlResumePayload,
  HitlSpec,
} from './types.ts';

const optionSchema = z.object({
  description: z.string().max(500).optional(),
  label: z.string().min(1).max(120),
  value: z.string().min(1).max(120),
});

const optionsSchema = z.array(optionSchema).min(2).max(20).superRefine((options, context) => {
  const values = new Set<string>();
  for (const [index, option] of options.entries()) {
    if (values.has(option.value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate option value: ${option.value}`,
        path: [index, 'value'],
      });
    }
    values.add(option.value);
  }
});

const specBase = {
  allowSkip: z.boolean().optional(),
  title: z.string().min(1).max(120).optional(),
};

const confirmSpecSchema = z.object({
  ...specBase,
  allowRevision: z.boolean().optional(),
  kind: z.literal('confirm'),
});

const textSpecSchema = z.object({
  ...specBase,
  kind: z.literal('text'),
  label: z.string().min(1).max(120).optional(),
  maxLength: z.number().int().positive().max(10_000).optional(),
  multiline: z.boolean().optional(),
  placeholder: z.string().max(200).optional(),
  required: z.boolean().optional(),
});

const choiceSpecSchema = z.object({
  ...specBase,
  allowOther: z.boolean().optional(),
  kind: z.literal('choice'),
  multiple: z.boolean().optional(),
  options: optionsSchema,
  required: z.boolean().optional(),
});

const fieldNameSchema = z.string().regex(/^[a-z][a-zA-Z0-9_]{0,63}$/);
const textFieldSchema = z.object({
  kind: z.enum(['text', 'textarea']),
  label: z.string().min(1).max(120),
  maxLength: z.number().int().positive().max(10_000).optional(),
  name: fieldNameSchema,
  placeholder: z.string().max(200).optional(),
  required: z.boolean().optional(),
});
const numberFieldSchema = z.object({
  kind: z.literal('number'),
  label: z.string().min(1).max(120),
  maximum: z.number().finite().optional(),
  minimum: z.number().finite().optional(),
  name: fieldNameSchema,
  required: z.boolean().optional(),
}).refine(
  (field) => field.minimum === undefined || field.maximum === undefined || field.minimum <= field.maximum,
  { message: 'minimum must be less than or equal to maximum' },
);
const choiceFieldSchema = z.object({
  allowOther: z.boolean().optional(),
  kind: z.literal('choice'),
  label: z.string().min(1).max(120),
  multiple: z.boolean().optional(),
  name: fieldNameSchema,
  options: optionsSchema,
  required: z.boolean().optional(),
});
const dateFieldSchema = z.object({
  kind: z.enum(['date', 'datetime']),
  label: z.string().min(1).max(120),
  name: fieldNameSchema,
  required: z.boolean().optional(),
});
const formFieldSchema = z.union([
  textFieldSchema,
  numberFieldSchema,
  choiceFieldSchema,
  dateFieldSchema,
]);
const formSpecSchema = z.object({
  ...specBase,
  fields: z.array(formFieldSchema).min(2).max(8).superRefine((fields, context) => {
    const names = new Set<string>();
    for (const [index, field] of fields.entries()) {
      if (names.has(field.name)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate field name: ${field.name}`,
          path: [index, 'name'],
        });
      }
      names.add(field.name);
    }
  }),
  kind: z.literal('form'),
});

export const hitlSpecSchema = z.discriminatedUnion('kind', [
  confirmSpecSchema,
  textSpecSchema,
  choiceSpecSchema,
  formSpecSchema,
]);

const wireInterruptSchema = z.object({
  expiresAt: z.string().datetime({ offset: true }).optional(),
  id: z.string().min(1).max(200),
  message: z.string().min(1).max(1000).optional(),
  metadata: z.record(z.unknown()).optional(),
  reason: z.literal('human_input_required'),
});

const wireInterruptBatchSchema = z.array(wireInterruptSchema).min(1).max(8).superRefine(
  (interrupts, context) => {
    const ids = new Set<string>();
    for (const [index, interrupt] of interrupts.entries()) {
      if (ids.has(interrupt.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate interrupt id: ${interrupt.id}`,
          path: [index, 'id'],
        });
      }
      ids.add(interrupt.id);
    }
  },
);

export class HitlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HitlValidationError';
  }
}

/**
 * Converts AG-UI Interrupt records into the strict client model. Invalid presentation metadata
 * degrades to the documented text fallback; invalid protocol identity fails closed.
 */
export const projectHitlInterrupts = (input: unknown): HitlInterrupt[] => {
  const batch = wireInterruptBatchSchema.parse(input);
  return batch.map((interrupt) => {
    const candidate = interrupt.metadata?.hitl;
    const parsed = hitlSpecSchema.safeParse(candidate);
    return {
      expiresAt: interrupt.expiresAt,
      fallback: !parsed.success,
      id: interrupt.id,
      message: interrupt.message ?? 'The agent needs more information before continuing.',
      reason: interrupt.reason,
      spec: parsed.success
        ? (parsed.data as HitlSpec)
        : ({ kind: 'text', multiline: true, required: true } satisfies HitlSpec),
    };
  });
};

const isChoiceAnswer = (value: unknown): value is HitlChoiceAnswer =>
  Boolean(
    value &&
    typeof value === 'object' &&
    Array.isArray((value as HitlChoiceAnswer).selected) &&
    (value as HitlChoiceAnswer).selected.every((item) => typeof item === 'string') &&
    ((value as HitlChoiceAnswer).other === undefined || typeof (value as HitlChoiceAnswer).other === 'string'),
  );

const validateChoiceAnswer = (
  answer: unknown,
  spec: { allowOther?: boolean; multiple?: boolean; options: Array<{ value: string }>; required?: boolean },
  path: string,
) => {
  if (!isChoiceAnswer(answer)) throw new HitlValidationError(`${path} must be a choice answer.`);
  if (!spec.multiple && answer.selected.length > 1) {
    throw new HitlValidationError(`${path} accepts at most one selected option.`);
  }
  if (new Set(answer.selected).size !== answer.selected.length) {
    throw new HitlValidationError(`${path} contains duplicate selected values.`);
  }
  const allowed = new Set(spec.options.map((option) => option.value));
  if (answer.selected.some((value) => !allowed.has(value))) {
    throw new HitlValidationError(`${path} contains an unknown option.`);
  }
  const other = answer.other?.trim();
  if (answer.other && answer.other.length > 2000) {
    throw new HitlValidationError(`${path}.other is too long.`);
  }
  if (other && !spec.allowOther) throw new HitlValidationError(`${path} does not allow a custom value.`);
  if ((spec.required ?? true) && answer.selected.length === 0 && !other) {
    throw new HitlValidationError(`${path} requires a selection or custom value.`);
  }
};

const validateFormAnswer = (
  answer: unknown,
  fields: HitlFormField[],
  path: string,
) => {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
    throw new HitlValidationError(`${path} must be an object.`);
  }
  const values = answer as Record<string, unknown>;
  const names = new Set(fields.map((field) => field.name));
  if (Object.keys(values).some((name) => !names.has(name))) {
    throw new HitlValidationError(`${path} contains an unknown field.`);
  }
  for (const field of fields) {
    const value = values[field.name];
    if (value === undefined || value === '') {
      if (field.required) throw new HitlValidationError(`${path}.${field.name} is required.`);
      continue;
    }
    if (field.kind === 'choice') {
      validateChoiceAnswer(value, field, `${path}.${field.name}`);
    } else if (field.kind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new HitlValidationError(`${path}.${field.name} must be a finite number.`);
      }
      if (field.minimum !== undefined && value < field.minimum) {
        throw new HitlValidationError(`${path}.${field.name} is below the minimum.`);
      }
      if (field.maximum !== undefined && value > field.maximum) {
        throw new HitlValidationError(`${path}.${field.name} is above the maximum.`);
      }
    } else {
      if (typeof value !== 'string') throw new HitlValidationError(`${path}.${field.name} must be a string.`);
      if ((field.kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) ||
        (field.kind === 'datetime' && !z.string().datetime({ offset: true }).safeParse(value).success)) {
        throw new HitlValidationError(`${path}.${field.name} has an invalid ${field.kind} value.`);
      }
      if ('maxLength' in field && value.length > (field.maxLength ?? 2000)) {
        throw new HitlValidationError(`${path}.${field.name} is too long.`);
      }
    }
  }
};

const validateResolvedPayload = (
  interrupt: HitlInterrupt,
  payload: HitlResumePayload,
  path: string,
) => {
  const { spec } = interrupt;
  if (payload.action === 'skip') {
    if (!spec.allowSkip) throw new HitlValidationError(`${path} does not allow skip.`);
    if (payload.answer !== undefined) throw new HitlValidationError(`${path}.answer must be omitted when skipping.`);
    return;
  }
  if (spec.kind === 'confirm') {
    if (payload.action === 'continue' && payload.answer === undefined) return;
    if (
      payload.action === 'revise' &&
      spec.allowRevision &&
      typeof payload.answer === 'string' &&
      payload.answer.trim() &&
      payload.answer.length <= 2000
    ) return;
    throw new HitlValidationError(`${path} contains an invalid confirmation response.`);
  }
  if (payload.action !== 'submit') throw new HitlValidationError(`${path}.action must be submit.`);
  if (interrupt.fallback) {
    if (typeof payload.answer !== 'string' || !payload.answer.trim()) {
      throw new HitlValidationError(`${path}.answer must contain fallback text.`);
    }
    return;
  }
  if (spec.kind === 'text') {
    if (typeof payload.answer !== 'string') throw new HitlValidationError(`${path}.answer must be a string.`);
    if ((spec.required ?? true) && !payload.answer.trim()) throw new HitlValidationError(`${path}.answer is required.`);
    if (payload.answer.length > (spec.maxLength ?? 2000)) throw new HitlValidationError(`${path}.answer is too long.`);
    return;
  }
  if (spec.kind === 'choice') {
    validateChoiceAnswer(payload.answer, spec, `${path}.answer`);
    return;
  }
  validateFormAnswer(payload.answer, spec.fields, `${path}.answer`);
};

/** Validates exact, ordered, atomic coverage of the pending interrupt batch. */
export const validateHitlResumeBatch = (
  interrupts: HitlInterrupt[],
  resume: HitlResumeEntry[],
): HitlResumeEntry[] => {
  if (resume.length !== interrupts.length) {
    throw new HitlValidationError('HITL_INCOMPLETE_BATCH: resume must cover every pending interrupt.');
  }
  const status = resume[0]?.status;
  if (!status || resume.some((entry) => entry.status !== status)) {
    throw new HitlValidationError('HITL_INCOMPLETE_BATCH: mixed resume statuses are not supported.');
  }
  for (const [index, interrupt] of interrupts.entries()) {
    const entry = resume[index];
    if (entry.interruptId !== interrupt.id) {
      throw new HitlValidationError('HITL_INCOMPLETE_BATCH: interrupt order or identity does not match.');
    }
    if (entry.status === 'resolved') validateResolvedPayload(interrupt, entry.payload, `resume[${index}].payload`);
  }
  return resume;
};
