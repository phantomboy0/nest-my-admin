import { Inject, Injectable } from '@nestjs/common';
import { ADMIN_OPTIONS } from '../constants.js';
import type { DashboardResponse, WidgetData, WidgetParams } from '../contract.js';
import { AdminBadRequestError, AdminNotFoundError } from '../errors.js';
import { resolveText } from '../i18n/localized-text.js';
import type { ResolvedAdminOptions } from '../options.js';
import { AdminPolicy } from '../policy/admin-policy.service.js';
import type { AdminContext } from '../resource/admin-context.js';
import { WidgetRegistry, type RegisteredWidget } from './widget-registry.js';

const PERIODS = ['day', 'week', 'month', 'year', 'range'];
const MAX_SPAN_MS = 366 * 24 * 60 * 60 * 1000;

/** The dashboard (spec §5.8): the widgets a user may see, and each one's data for a period. */
@Injectable()
export class DashboardService {
  constructor(
    private readonly widgets: WidgetRegistry,
    private readonly policy: AdminPolicy,
    @Inject(ADMIN_OPTIONS) private readonly options: ResolvedAdminOptions,
  ) {}

  private visible(ctx: AdminContext): RegisteredWidget[] {
    const perms = this.policy.permissionsOf(ctx);
    return this.widgets.list().filter((widget) => perms.can(widget.code));
  }

  /** Whether the user has a dashboard at all (`meta.dashboard`). */
  has(ctx: AdminContext): boolean {
    return this.visible(ctx).length > 0;
  }

  layout(ctx: AdminContext): DashboardResponse {
    const locale = ctx.locale ?? this.options.locale;
    return { widgets: this.visible(ctx).map((widget) => ({ name: widget.name, type: widget.type, title: this.options.texts(widget.title, locale, `widget.${widget.name}.title`), size: widget.size })) };
  }

  /** One widget's data: 404 for a widget the user may not see (or that does not exist), 400 for a bad period. */
  async load(name: string, query: URLSearchParams, ctx: AdminContext): Promise<WidgetData> {
    const widget = this.visible(ctx).find((candidate) => candidate.name === name);
    if (!widget) throw new AdminNotFoundError(`Unknown widget "${name}"`);
    return widget.source.load(parsePeriod(query), ctx);
  }
}

/** The period from the query: a known kind, instants in order, at most 366 days (the comparison window too). */
export function parsePeriod(query: URLSearchParams): WidgetParams {
  const period = query.get('period') ?? '';
  if (!PERIODS.includes(period)) throw new AdminBadRequestError(`period must be one of ${PERIODS.join(', ')}`);
  const instant = (key: string) => {
    const raw = query.get(key);
    const time = raw ? Date.parse(raw) : Number.NaN;
    if (Number.isNaN(time)) throw new AdminBadRequestError(`${key} must be an ISO date and time`);
    return { raw: new Date(time).toISOString(), time };
  };
  const from = instant('from');
  const to = instant('to');
  const previousFrom = instant('previousFrom');
  const previousTo = instant('previousTo');
  if (from.time >= to.time || previousFrom.time >= previousTo.time) throw new AdminBadRequestError('a period starts before it ends');
  if (to.time - from.time > MAX_SPAN_MS || previousTo.time - previousFrom.time > MAX_SPAN_MS) throw new AdminBadRequestError('a period spans at most 366 days');
  return { period: period as WidgetParams['period'], from: from.raw, to: to.raw, previousFrom: previousFrom.raw, previousTo: previousTo.raw };
}
