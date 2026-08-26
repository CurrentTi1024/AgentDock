/**
 * Decide whether a parent value should replace the Lexical document.
 *
 * The editor is the authority while focused. Parent state is intentionally
 * delayed by @lobehub/editor's debounce, so a differing value during typing is
 * normally a stale echo and must never reset the document/selection.
 */
export const shouldApplyExternalEditorValue = ({
  currentValue,
  externalValue,
  focused,
  lastReportedValue,
}: {
  currentValue: string;
  externalValue: string;
  focused: boolean;
  lastReportedValue: string;
}): boolean => {
  if (!externalValue || externalValue === currentValue) return false;
  if (focused) return false;
  return externalValue !== lastReportedValue;
};

export const chatDraftStorageKey = (draftKey: string): string =>
  `agentdock:chat-draft:${draftKey}`;

export const shouldSubmitEditorKey = ({
  blocked,
  composing,
  key,
  shiftKey,
}: {
  blocked: boolean;
  composing: boolean;
  key: string;
  shiftKey: boolean;
}): boolean => key === 'Enter' && !composing && !shiftKey && !blocked;

/** Clear only after the parent accepts the send and the user has not typed newer content. */
export const shouldClearSubmittedEditor = ({
  accepted,
  currentValue,
  submittedValue,
}: {
  accepted: boolean;
  currentValue: string;
  submittedValue: string;
}): boolean => accepted && currentValue === submittedValue;
