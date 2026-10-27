import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { FormLayoutInline, FormLayoutNode, FormLayoutSection, FormLayoutSummary } from '@nest-my-admin/core/contract';
import { isRtl, useLocale, useT } from '@/i18n';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface FormLayoutProps {
  /** `form.layout`, or nothing for one plain column. */
  layout: FormLayoutNode[] | undefined;
  /** Every field the form has, in order (names the layout leaves out go into a trailing section). */
  names: string[];
  /** The field's input, or null when it is hidden (`showIf`) or not on this form. */
  render: (name: string) => ReactNode | null;
  /** Fields with errors: their tab is marked (an inline with errors as `_inlines.<child>`). */
  errors: Record<string, string[]>;
  /** An inline section of the layout; without it, inlines (and summaries) are left out. */
  renderInline?: (inline: FormLayoutInline) => ReactNode | null;
  /** A summary card (label and value rows, an order's totals). */
  renderSummary?: (summary: FormLayoutSummary) => ReactNode | null;
  /** Sections without cards (a layout inside a card: an inline's row). */
  plain?: boolean;
}

const COLUMNS = { 1: '', 2: 'md:grid-cols-2', 3: 'md:grid-cols-2 lg:grid-cols-3' } as const;

/** Sections (with 1–3 columns on wide screens, one on phones) and tabs, from `form.layout` (spec §9.4). */
export function FormLayout({ layout: given, names, render, errors, renderInline, renderSummary, plain }: FormLayoutProps) {
  const layout = given && (renderInline ? (given as SectionNode[]) : withoutInlines(given));
  const listed = new Set((layout ?? []).flatMap((node) => ('tab' in node ? node.sections : [node])).flatMap((section) => (isInline(section) || isSummary(section) ? [] : section.fields)));
  const rest = names.filter((name) => !listed.has(name));
  const tabs = (layout ?? []).filter((node): node is TabNode => 'tab' in node);
  const firstTab = (layout ?? []).findIndex((node) => 'tab' in node);
  const before = firstTab === -1 ? (layout ?? []).filter((node): node is Block => !('tab' in node)) : (layout ?? []).slice(0, firstTab).filter((node): node is Block => !('tab' in node));
  const after = firstTab === -1 ? [] : (layout ?? []).slice(firstTab).filter((node): node is Block => !('tab' in node));
  const block = (node: Block, key: string) =>
    isInline(node) ? (
      <Fragment key={key}>{renderInline?.(node)}</Fragment>
    ) : isSummary(node) ? (
      <Fragment key={key}>{renderSummary?.(node)}</Fragment>
    ) : (
      <Section key={key} section={node} render={render} plain={plain} />
    );
  return (
    <>
      {before.map((node, index) => block(node, `b${index}`))}
      {tabs.length > 0 && <Tabs tabs={tabs} render={render} errors={errors} block={block} />}
      {after.map((node, index) => block(node, `a${index}`))}
      {rest.length > 0 && <Section section={{ fields: rest, columns: 1 }} render={render} plain={plain} />}
    </>
  );
}

function Section({ section, render, plain }: { section: FormLayoutSection; render: FormLayoutProps['render']; plain?: boolean }) {
  const titleId = useId();
  const children = section.fields.map((name) => [name, render(name)] as const).filter(([, node]) => node !== null);
  if (children.length === 0) return null;
  const grid = (
    <div className={cn('grid gap-5', COLUMNS[section.columns])}>
      {children.map(([name, node]) => (
        <div key={name} className="min-w-0">
          {node}
        </div>
      ))}
    </div>
  );
  if (plain) {
    if (!section.title) return grid;
    return (
      <section aria-labelledby={titleId} className="flex flex-col gap-3">
        <h3 id={titleId} className="text-[13px] font-semibold text-muted-foreground">
          {section.title}
        </h3>
        {grid}
      </section>
    );
  }
  if (!section.title) return <Card bodyClassName="p-5">{grid}</Card>;
  return (
    <Card aria-labelledby={titleId} title={<span id={titleId}>{section.title}</span>}>
      {grid}
    </Card>
  );
}

type Block = FormLayoutSection | FormLayoutInline | FormLayoutSummary;
type SectionNode = Block | { tab: string; sections: Block[] };
type TabNode = Extract<SectionNode, { tab: string }>;

const isInline = (node: FormLayoutNode | Block): node is FormLayoutInline => 'inline' in node;
const isSummary = (node: FormLayoutNode | Block): node is FormLayoutSummary => 'summary' in node;

/** The layout's sections and tabs without inline child sections (forms that have no inlines to show). */
function withoutInlines(layout: FormLayoutNode[]): SectionNode[] {
  return layout
    .filter((node) => !isInline(node) && !isSummary(node))
    .map((node) => ('tab' in node ? { ...node, sections: node.sections.filter((section): section is FormLayoutSection => !isInline(section) && !isSummary(section)) } : (node as FormLayoutSection)));
}

/** A tablist with arrow keys (mirrored in RTL), Home and End; every panel stays mounted so edits survive switching. */
function Tabs({ tabs, render, errors, block }: { tabs: TabNode[]; render: FormLayoutProps['render']; errors: FormLayoutProps['errors']; block: (node: Block, key: string) => ReactNode }) {
  const t = useT();
  const { locale } = useLocale();
  const base = useId();
  const [active, setActive] = useState(0);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const hasErrors = (tab: TabNode) =>
    tab.sections.some((section) => (isInline(section) ? [`_inlines.${section.inline}`] : isSummary(section) ? [] : section.fields).some((name) => Object.keys(errors).some((key) => key === name || key.startsWith(`${name}.`))));
  // After a refused save, show a tab with errors if the open one has none.
  useEffect(() => {
    if (hasErrors(tabs[active]!)) return;
    const index = tabs.findIndex(hasErrors);
    if (index !== -1) setActive(index);
  }, [errors]);

  function onKeyDown(event: KeyboardEvent) {
    const forward = isRtl(locale) ? 'ArrowLeft' : 'ArrowRight';
    const backward = isRtl(locale) ? 'ArrowRight' : 'ArrowLeft';
    let next: number | undefined;
    if (event.key === forward) next = (active + 1) % tabs.length;
    else if (event.key === backward) next = (active - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
    buttons.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" className="flex gap-0.5 overflow-x-auto border-b" onKeyDown={onKeyDown}>
        {tabs.map((tab, index) => (
          <button
            key={index}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            id={`${base}-tab-${index}`}
            type="button"
            role="tab"
            aria-selected={index === active}
            aria-controls={`${base}-panel-${index}`}
            tabIndex={index === active ? 0 : -1}
            onClick={() => setActive(index)}
            className={cn(
              '-mb-px flex h-[38px] items-center gap-1.5 border-b-2 px-3 text-[13px] whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              index === active ? 'border-foreground font-semibold' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.tab}
            {hasErrors(tab) && (
              <>
                <span aria-hidden className="size-1.5 rounded-full bg-destructive" />
                <span className="sr-only">{t('form.tabHasErrors')}</span>
              </>
            )}
          </button>
        ))}
      </div>
      {tabs.map((tab, index) => (
        <div key={index} id={`${base}-panel-${index}`} role="tabpanel" aria-labelledby={`${base}-tab-${index}`} hidden={index !== active} className={cn('flex-col gap-5', index === active ? 'flex' : 'hidden')}>
          {tab.sections.map((section, sectionIndex) => block(section, String(sectionIndex)))}
        </div>
      ))}
    </div>
  );
}
