// Adapted from: src/routes/(main)/community/(list)/features/SortButton (LobeHub canary)
import { Button, DropdownMenu, Icon } from '@lobehub/ui';
import { ArrowDownWideNarrow, ChevronDown } from 'lucide-react';
import { memo } from 'react';

export interface SortOption {
  key: string;
  label: string;
}

interface SortButtonProps {
  onChange: (key: string) => void;
  options: SortOption[];
  value: string;
}

const SortButton = memo<SortButtonProps>(({ onChange, options, value }) => {
  const active = options.find((option) => option.key === value) ?? options[0];
  if (!active) return null;

  const menuItems = options.map((option) => ({
    checked: option.key === active.key,
    closeOnClick: true,
    key: option.key,
    label: option.label,
    onCheckedChange: (checked: boolean) => {
      if (checked) onChange(option.key);
    },
    type: 'checkbox' as const,
  }));

  return (
    <DropdownMenu items={menuItems} trigger="both">
      <Button data-testid="sort-dropdown" icon={<Icon icon={ArrowDownWideNarrow} />} type="text">
        {active.label}
        <Icon icon={ChevronDown} />
      </Button>
    </DropdownMenu>
  );
});

SortButton.displayName = 'SortButton';

export default SortButton;
