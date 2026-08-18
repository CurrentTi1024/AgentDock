import { create } from 'zustand';

interface GroupCreateState {
  closeModal(): void;
  open: boolean;
  openModal(): void;
}

export const useGroupCreateStore = create<GroupCreateState>((set) => ({
  closeModal: () => set({ open: false }),
  open: false,
  openModal: () => set({ open: true }),
}));
