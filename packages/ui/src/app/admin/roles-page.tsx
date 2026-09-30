import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, Upload } from 'lucide-react';
import { Alert, PageTitle, textIn } from '@/app/admin/shared';
import { PageMessage } from '@/components/page-message';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/i18n';
import { api, describeError } from '@/lib/api';
import { useSession } from '@/lib/queries';

/** Roles (spec §6.7): system roles from code, and roles stored here; export and import as JSON. */
export function RolesPage() {
  const { t, locale } = useLocale();
  const session = useSession();
  const queryClient = useQueryClient();
  const roles = useQuery({ queryKey: ['rbac', 'roles'], queryFn: api.rbac.roles });
  const file = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const manage = session.data?.rbac.manage === true;

  const importRoles = useMutation({
    mutationFn: async (upload: File) => api.rbac.importRoles(JSON.parse(await upload.text())),
    onSuccess: async (result) => {
      setNotice(t('rbac.imported', { count: result.imported.length }));
      await queryClient.invalidateQueries({ queryKey: ['rbac'] });
    },
  });

  async function exportRoles() {
    const data = await api.rbac.exportRoles();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'roles.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  if (roles.isPending) return <PageMessage>{t('common.loading')}</PageMessage>;
  if (roles.isError) return <PageMessage tone="error">{describeError(roles.error)}</PageMessage>;
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageTitle
        actions={
          <>
            <Button variant="outline" onClick={() => void exportRoles()}>
              <Download />
              {t('rbac.export')}
            </Button>
            {manage && (
              <>
                <input
                  ref={file}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  aria-label={t('rbac.importFile')}
                  onChange={(event) => {
                    const upload = event.target.files?.[0];
                    if (upload) importRoles.mutate(upload);
                    event.target.value = '';
                  }}
                />
                <Button variant="outline" onClick={() => file.current?.click()}>
                  <Upload />
                  {t('rbac.import')}
                </Button>
                <Button asChild>
                  <Link to="/-/roles/new">
                    <Plus />
                    {t('rbac.newRole')}
                  </Link>
                </Button>
              </>
            )}
          </>
        }
      >
        {t('rbac.roles')}
      </PageTitle>
      {notice && <Alert tone="success">{notice}</Alert>}
      {importRoles.isError && <Alert>{importRoles.error instanceof SyntaxError ? t('rbac.notJson') : describeError(importRoles.error)}</Alert>}
      <ul aria-label={t('rbac.roles')} className="flex flex-col divide-y rounded-lg border">
        {roles.data.items.map((role) => (
          <li key={role.name}>
            <Link to={`/-/roles/${encodeURIComponent(role.name)}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted/50">
              <span className="flex flex-col">
                <span className="font-medium">{textIn(role.label, locale) || role.name}</span>
                <span className="text-xs text-muted-foreground">{role.name}</span>
              </span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {t('rbac.permissionCount', { count: role.permissions.length })}
                {role.system && <span className="rounded-full bg-muted px-2 py-0.5">{t('rbac.system')}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
