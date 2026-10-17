import type { ReactNode } from "react";

/** Page masthead: numbered eyebrow, display-weight title, one line of context. */
export function PageHeader({
  index,
  eyebrow,
  title,
  description,
  actions,
}: {
  index?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-5">
      <div className="min-w-0">
        {(index || eyebrow) && (
          <p className="eyebrow mb-2">
            {index && <span className="text-amber">{index}</span>}
            {index && eyebrow && <span className="mx-1.5 opacity-60">—</span>}
            {eyebrow}
          </p>
        )}
        <h1 className="display text-[clamp(1.75rem,2.6vw,2.4rem)] text-paper">{title}</h1>
        {description && <p className="mt-2 max-w-[62ch] text-sm text-paper-dim">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
