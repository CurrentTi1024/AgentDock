import { create } from 'zustand';

const STORAGE_KEY = 'agentdock-ui-state';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ApprovalMode = 'auto' | 'manual';

interface PersistedUiState {
  approvalMode: ApprovalMode;
  leftPanelExpand: boolean;
  leftPanelWidth: number;
  thisMonthOnly: boolean;
  themeMode: ThemeMode;
  showReasoning: boolean;
}

const DEFAULTS: PersistedUiState = {
  approvalMode: 'manual',
  leftPanelExpand: true,
  leftPanelWidth: 280,
  thisMonthOnly: false,
  themeMode: 'system',
  showReasoning: true,
};

const readPersisted = (): PersistedUiState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<PersistedUiState>) };
  } catch {
    // ignore corrupt or unavailable storage
  }
  return DEFAULTS;
};

interface UiStore extends PersistedUiState {
  setApprovalMode(approvalMode: ApprovalMode): void;
  setThemeMode(themeMode: ThemeMode): void;
  setLeftPanelWidth(width: number): void;
  toggleShowReasoning(): void;
  toggleLeftPanel(): void;
  toggleThisMonthOnly(): void;
}

const persist = (state: PersistedUiState) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / private-mode storage errors
  }
};

export const useUiStore = create<UiStore>((set, get) => ({
  ...readPersisted(),
  setApprovalMode: (approvalMode) => {
    const next = { ...get(), approvalMode };
    set(next);
    persist(next);
  },
  setThemeMode: (themeMode) => {
    const next = { ...get(), themeMode };
    set(next);
    persist(next);
  },
  setLeftPanelWidth: (leftPanelWidth) => {
    const next = { ...get(), leftPanelWidth };
    set(next);
    persist(next);
  },
  toggleShowReasoning: () => {
    const next = { ...get(), showReasoning: !get().showReasoning };
    set(next);
    persist(next);
  },
  toggleLeftPanel: () => {
    const next = { ...get(), leftPanelExpand: !get().leftPanelExpand };
    set(next);
    persist(next);
  },
  toggleThisMonthOnly: () => {
    const next = { ...get(), thisMonthOnly: !get().thisMonthOnly };
    set(next);
    persist(next);
  },
}));
