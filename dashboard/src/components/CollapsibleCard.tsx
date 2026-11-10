import { useState, type ReactNode } from 'react';

interface CollapsibleCardProps {
  title: string;
  actions?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}

export default function CollapsibleCard({
  title,
  actions,
  defaultOpen = true,
  className,
  children,
}: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`card collapsible-card${open ? ' is-open' : ' is-collapsed'}${className ? ` ${className}` : ''}`}>
      <div className="card-header collapsible-card-header">
        <button
          type="button"
          className="collapsible-toggle"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
        >
          <span className="collapsible-card-title">{title}</span>
          <span className="collapsible-chevron" aria-hidden>{open ? '▾' : '▸'}</span>
        </button>
        {actions ? <div className="collapsible-card-actions">{actions}</div> : null}
      </div>
      {open ? <div className="collapsible-card-content">{children}</div> : null}
    </section>
  );
}
