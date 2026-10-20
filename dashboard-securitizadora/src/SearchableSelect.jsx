import { useId, useRef, useState } from "react";
import "./SearchableSelect.css";

const normalize = (text) => String(text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

// Search changes only the suggestions. Existing filters receive the original key
// only when a suggestion is chosen (or the selection is explicitly cleared).
export default function SearchableSelect({ value, options, onChange, placeholder = "Digite para buscar…", label, selectedLabel = "", disabled = false, renderActions, footer }) {
  const id = useId();
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const selected = options.find((option) => option.value === value);
  const selectionLabel = selected?.label || selectedLabel;
  const filtered = options.filter((option) => normalize(`${option.label} ${option.searchText || ""}`).includes(normalize(query)));
  const activeIndex = Math.min(active, Math.max(0, filtered.length - 1));
  const choose = (option) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    setQuery("");
  };
  const move = (direction) => {
    let next = activeIndex;
    for (let count = 0; count < filtered.length; count += 1) {
      next = (next + direction + filtered.length) % filtered.length;
      if (!filtered[next].disabled) break;
    }
    setActive(next);
    requestAnimationFrame(() => document.getElementById(`${id}-option-${next}`)?.scrollIntoView({ block: "nearest" }));
  };
  return <div className="searchable-select" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setQuery(""); }
  }}>
    <div className="searchable-select-control">
      <input ref={inputRef} role="combobox" aria-label={label || placeholder} aria-autocomplete="list" aria-expanded={open && !disabled}
        aria-controls={`${id}-list`} aria-activedescendant={open && filtered.length ? `${id}-option-${activeIndex}` : undefined}
        autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={disabled}
        value={open ? query : selectionLabel} placeholder={open && selectionLabel ? selectionLabel : placeholder}
        onFocus={() => { setOpen(true); setQuery(""); setActive(0); }}
        onClick={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) { setOpen(true); setActive(0); } else if (filtered.length) move(event.key === "ArrowDown" ? 1 : -1);
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (open && filtered[activeIndex]) choose(filtered[activeIndex]);
            else setOpen(true);
          } else if (event.key === "Escape") {
            event.preventDefault(); event.stopPropagation(); setOpen(false); setQuery("");
          } else if (event.key === "Tab") { setOpen(false); setQuery(""); }
        }} />
      {value && !disabled ? <button type="button" className="searchable-select-clear" aria-label={`Limpar ${label || "seleção"}`}
        onClick={() => { onChange(""); setQuery(""); inputRef.current?.focus(); }}>×</button>
        : <span className="searchable-select-icon" aria-hidden="true">⌕</span>}
    </div>
    {open && !disabled && <div className="searchable-select-menu">
      <div role="listbox" id={`${id}-list`} aria-label={label || placeholder} className="searchable-select-options">
        {filtered.map((option, index) => <div className="searchable-select-row" key={option.value}>
          <button type="button" role="option" id={`${id}-option-${index}`} aria-selected={option.value === value} disabled={option.disabled}
            className={`searchable-select-option ${index === activeIndex ? "is-active" : ""}`}
            onPointerDown={(event) => event.preventDefault()} onClick={() => choose(option)}>
            <span>{option.label}</span>{option.detail && <small>{option.detail}</small>}
          </button>
          {renderActions?.(option, () => setOpen(false))}
        </div>)}
        {!filtered.length && <div className="searchable-select-empty" role="status">Nenhum resultado encontrado</div>}
      </div>
      {typeof footer === "function" ? footer(() => setOpen(false)) : footer}
    </div>}
  </div>;
}
