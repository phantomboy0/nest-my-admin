import { Link } from 'react-router';
import type { AdminRecord, AsideCardSchema, ResourceSchema } from '@nest-my-admin/core/contract';
import { DisplayValue } from '@/app/widgets/badge';
import { Card } from '@/components/ui/card';
import { useT } from '@/i18n';
import { iconNamed } from '@/lib/icons';
import { useSchema } from '@/lib/queries';

/**
 * A read-only card beside the record (spec §5.6): label and value rows of the record's own fields, or of a related
 * record (`_aside`), with a link to that record. A related card the user may not see is not drawn.
 */
export function AsideCard({ card, values, schema }: { card: AsideCardSchema; values: AdminRecord | undefined; schema: ResourceSchema }) {
  const t = useT();
  const target = useSchema(card.relation?.resource ?? '', card.relation !== undefined);
  if (!values) return null;
  const fieldsOf = card.relation ? target.data?.fields : schema.fields;
  if (!fieldsOf) return null;
  const Icon = iconNamed(card.icon);
  const rows = card.fields.flatMap((name) => {
    const field = fieldsOf.find((candidate) => candidate.name === name);
    return field ? [field] : [];
  });
  const link = card.relation?.link && typeof values._id === 'string' ? `/${card.relation.resource}/${encodeURIComponent(values._id)}` : undefined;
  return (
    <Card
      title={card.title}
      icon={Icon ? <Icon /> : undefined}
      actions={
        link && (
          <Link to={link} className="text-[13px] font-medium text-primary hover:underline">
            {t('form.viewProfile')}
          </Link>
        )
      }
    >
      <dl className="flex flex-col gap-2.5 text-[13px]">
        {card.relation && typeof values._title === 'string' && <dt className="text-[14px] font-semibold">{values._title}</dt>}
        {rows.map((field) => (
          <div key={field.name} className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">{field.label}</dt>
            <dd className="min-w-0 text-end break-words">
              <DisplayValue value={values[field.name]} field={field} record={values} />
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
