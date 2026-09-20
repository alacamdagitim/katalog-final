'use client';

import {useId, useMemo, useRef, useState} from 'react';
import {Check, ChevronDown, LoaderCircle} from 'lucide-react';
import {Command, CommandInput, CommandItem, CommandList} from '@/components/ui/command';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';

type FilterPickerProps = {
  label: string;
  placeholder?: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  loading?: boolean;
  error?: string;
};

// Match Turkish letters, accents and spacing without changing the actual value.
function searchKey(value: string) {
  return value.toLocaleLowerCase('tr-TR').normalize('NFKD')
    .replace(/\p{M}/gu, '').replace(/ı/g, 'i').replace(/[\s\p{P}]+/gu, '');
}

export default function FilterPicker({
  label, placeholder, value, options, onChange, loading = false, error,
}: FilterPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const entries = useMemo(() => [...new Set([...options, ...(value ? [value] : [])]
    .map(option => option.trim()).filter(Boolean))], [options, value]);
  const key = searchKey(search);
  const visible = key ? entries.filter(option => searchKey(option).includes(key)) : entries;

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) setSearch('');
  }

  function choose(next: string) {
    onChange(next);
    changeOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={'catalog-filter-picker' + (value ? ' is-active' : '')}
          aria-label={`${label}: ${value || 'Tümü'}`}
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              changeOpen(true);
            }
          }}
        >
          <span className="catalog-filter-picker-label">{label}</span>
          <span className="catalog-filter-picker-value">{value || placeholder || 'Tümü'}</span>
          <ChevronDown aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        id={id}
        className="catalog-filter-popover"
        align="start"
        side="bottom"
        sideOffset={5}
        collisionPadding={12}
        aria-label={`${label} seçimi`}
        onOpenAutoFocus={event => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <Command className="catalog-filter-command" shouldFilter={false} loop label={`${label} seçenekleri`}>
          <CommandInput
            ref={inputRef}
            className="catalog-filter-search"
            value={search}
            onValueChange={setSearch}
            placeholder={`${label} ara…`}
            aria-label={`${label} seçeneklerinde ara`}
          />
          <CommandList className="catalog-filter-options" aria-busy={loading}>
            <CommandItem
              className="catalog-filter-option"
              value="all-options"
              onSelect={() => choose('')}
              aria-label={`Tümü${!value ? ', seçili' : ''}`}
            >
              <span>Tümü</span>
              {!value && <Check aria-hidden="true" className="catalog-filter-check" />}
            </CommandItem>
            {visible.map(option => (
              <CommandItem
                key={option}
                className="catalog-filter-option"
                value={`option:${option}`}
                onSelect={() => choose(option)}
                aria-label={`${option}${value === option ? ', seçili' : ''}`}
              >
                <span>{option}</span>
                {value === option && <Check aria-hidden="true" className="catalog-filter-check" />}
              </CommandItem>
            ))}
            {loading && <div className="catalog-filter-status" role="status"><LoaderCircle aria-hidden="true" />Seçenekler yükleniyor…</div>}
            {!loading && error && <div className="catalog-filter-error" role="alert">{error}</div>}
            {!loading && !error && !visible.length && (
              <div className="catalog-filter-empty" role="status">{search ? 'Eşleşen seçenek bulunamadı.' : 'Bu aramada seçenek bulunmuyor.'}</div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
