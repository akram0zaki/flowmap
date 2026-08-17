/** Explicit command palette parsing. It intentionally never guesses intent. */

import { useEffect, useRef, useState } from 'react';
import { isQuarterId } from '@flowmap/domain';
import type { SearchHit } from '@flowmap/storage';

import { t } from '../i18n/t.js';

export function CommandPalette({
  onClose,
  onOpen,
  onCreateIdea,
  onFilterQuarter,
  onSearch,
}: {
  readonly onClose: () => void;
  readonly onOpen: (id: string) => void;
  readonly onCreateIdea: (name: string) => void;
  readonly onFilterQuarter: (quarter: string) => void;
  readonly onSearch: (query: string) => Promise<SearchHit[]>;
}) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const [options, setOptions] = useState<readonly SearchHit[]>([]);
  useEffect(() => {
    let live = true;
    void onSearch(query).then((result) => {
      if (live) setOptions(result);
    });
    return () => {
      live = false;
    };
  }, [onSearch, query]);
  const create = query.match(/^\+\s*idea\s+(.+)$/i)?.[1]?.trim();
  const quarter = query.match(/^filter:\s*quarter\s+(.+)$/i)?.[1]?.trim();
  return (
    <div className="fm-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="fm-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="palette-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="palette-title">{t('palette.title')}</h2>
        <input
          ref={input}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
          }}
          placeholder={t('palette.placeholder')}
          aria-label={t('palette.title')}
        />
        <ul>
          {create && (
            <li>
              <button
                type="button"
                onClick={() => {
                  onCreateIdea(create);
                  onClose();
                }}
              >
                {t('palette.createIdea', { name: create })}
              </button>
            </li>
          )}
          {quarter && isQuarterId(quarter) && (
            <li>
              <button
                type="button"
                onClick={() => {
                  onFilterQuarter(quarter);
                  onClose();
                }}
              >
                {t('palette.filterQuarter', { quarter })}
              </button>
            </li>
          )}
          {options.map((option) => (
            <li key={`${option.kind}:${option.id}`}>
              <button
                type="button"
                onClick={() => {
                  onOpen(option.id);
                  onClose();
                }}
              >
                <strong>{option.label}</strong>
                {option.detail && <span>{option.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
        {!create && !(quarter && isQuarterId(quarter)) && query && options.length === 0 && (
          <p>{t('palette.empty')}</p>
        )}
      </section>
    </div>
  );
}
