import { useState, type ReactNode } from 'react';

interface CollapsibleSectionProps {
  title: string;
  actions?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}

export default function CollapsibleSection({
  title,
  actions,
  defaultOpen = true,
  className,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`collapsible-section${open ? ' is-open' : ' is-collapsed'}${className ? ` ${className}` : ''}`}>
      <div className="collapsible-section-header">
        <button
          type="button"
          className="collapsible-toggle"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
        >
          <span className="collapsible-section-title">{title}</span>
          <span className="collapsible-chevron" aria-hidden>{open ? '▾' : '▸'}</span>
        </button>
        {actions ? <div className="collapsible-section-actions">{actions}</div> : null}
      </div>
      {open ? <div className="collapsible-section-content">{children}</div> : null}
    </section>
  );
}
