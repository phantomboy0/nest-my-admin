import '@/styles/rich-text.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bold, Columns3, ImagePlus, Italic, Link as LinkIcon, List, ListOrdered, Minus, Quote, Redo2, Rows3, Strikethrough, Table as TableIcon, Trash2, Undo2, Unlink } from 'lucide-react';
import { Image } from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import type { FieldSchema } from '@nest-my-admin/core/contract';
import { UploadProblems } from '@/app/file-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useT } from '@/i18n';
import { api } from '@/lib/api';
import { checkFile, uploadErrorMessage } from '@/lib/upload';
import { cn } from '@/lib/utils';

export interface RichTextInputProps {
  id: string;
  /** The resource being edited: editor images are uploaded for this field of it. */
  resource: string;
  field: FieldSchema;
  /** HTML. */
  value: string;
  onChange?: (value: string) => void;
  /** Told while images are uploading, so the form waits with saving. */
  onBusy?: (busy: boolean) => void;
  /** Shows the HTML without a toolbar (locked fields, view-as). */
  readOnly?: boolean;
  invalid?: boolean;
  describedBy?: string;
}

/**
 * Only what the server's sanitizer keeps (`files/rich-text.ts` in core): paragraphs, headings 2-4, bold, italic,
 * strike, links, lists, quotes, tables, images, line breaks and rules. Anything else would vanish on save.
 */
const extensions = [
  StarterKit.configure({
    heading: { levels: [2, 3, 4] },
    code: false,
    codeBlock: false,
    underline: false,
    link: { openOnClick: false, autolink: true, defaultProtocol: 'https', protocols: ['http', 'https', 'mailto'], HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null } },
  }),
  Image.configure({ allowBase64: false }),
  TableKit.configure({ table: { resizable: false } }),
];

const htmlOf = (editor: Editor) => (editor.isEmpty ? '' : editor.getHTML());

/** `example.com` → `https://example.com`; http(s), mailto and relative addresses stay as typed. */
function linkAddress(text: string): string {
  const href = text.trim();
  return href === '' || /^(https?:\/\/|mailto:|\/|#)/i.test(href) ? href : `https://${href}`;
}

/** The `richtext` widget: a Tiptap editor whose toolbar offers what the server keeps, with image upload. */
export default function RichTextInput({ id, resource, field, value, onChange, onBusy, readOnly = false, invalid, describedBy }: RichTextInputProps) {
  const t = useT();
  // What this editor last reported: a `value` that differs from it came from outside (a save, "Load theirs").
  const emitted = useRef(value);
  const [uploading, setUploading] = useState(0);
  const [problems, setProblems] = useState<string[]>([]);
  const images = !readOnly && field.richtext?.images === true;
  const insertRef = useRef<(files: File[]) => boolean>(() => false);

  const editor = useEditor({
    extensions,
    content: value,
    editable: !readOnly,
    editorProps: {
      attributes: {
        id,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': field.label,
        ...(readOnly ? { 'aria-readonly': 'true' } : {}),
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        class: cn('nma-richtext outline-none', !readOnly && 'min-h-40 px-3 py-2'),
      },
      // Images dropped or pasted as files are uploaded like the toolbar's; other content takes the normal path.
      handleDrop: (_view, event) => insertRef.current([...(event.dataTransfer?.files ?? [])]),
      handlePaste: (_view, event) => insertRef.current([...(event.clipboardData?.files ?? [])]),
    },
    onUpdate: ({ editor: current }) => {
      emitted.current = htmlOf(current);
      onChange?.(emitted.current);
    },
  });

  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);

  useEffect(() => {
    onBusy?.(uploading > 0);
  }, [uploading > 0]);
  useEffect(() => () => onBusy?.(false), []);

  /** Uploads image files for this field and inserts them where the cursor is. True when it took the files. */
  function insertImages(files: File[]): boolean {
    const chosen = files.filter((file) => file.type.startsWith('image/'));
    if (!images || chosen.length === 0) return false;
    setProblems([]);
    for (const file of chosen) {
      const refused = checkFile(file, { accept: ['image/*'], maxBytes: field.richtext!.maxBytes });
      if (refused) {
        setProblems((previous) => [...previous, t('upload.failed', { name: file.name, message: refused })]);
        continue;
      }
      setUploading((count) => count + 1);
      api
        .upload(file, { resource, field: field.name })
        .promise.then(
          // The server gives every editor image a URL; an unsaved one answers only to its uploader.
          (stored) => {
            if (!stored.url || editor.isDestroyed) return;
            editor.chain().focus().setImage({ src: stored.url, alt: stored.name }).run();
            // The new image is left selected, so typing (or the next image) would replace it: go on in the
            // paragraph after it, adding one where there is none (the end of a list item or a quote).
            editor.commands.command(({ tr, state }) => {
              if (!(tr.selection instanceof NodeSelection)) return true;
              const after = tr.selection.to;
              if (!tr.doc.resolve(after).nodeAfter?.isTextblock) tr.insert(after, state.schema.nodes.paragraph!.create());
              tr.setSelection(TextSelection.create(tr.doc, after + 1));
              return true;
            });
          },
          (error: unknown) => setProblems((previous) => [...previous, t('upload.failed', { name: file.name, message: uploadErrorMessage(error) })]),
        )
        .finally(() => setUploading((count) => count - 1));
    }
    return true;
  }
  insertRef.current = insertImages;

  if (readOnly) return <EditorContent editor={editor} />;
  return (
    <div data-invalid={invalid || undefined} className="rounded-lg border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 data-invalid:border-destructive">
      <Toolbar editor={editor} label={t('editor.toolbar', { name: field.label })} images={images} uploading={uploading > 0} onImages={insertImages} />
      <EditorContent editor={editor} />
      {problems.length > 0 && (
        <div className="border-t px-3 py-2">
          <UploadProblems problems={problems} />
        </div>
      )}
    </div>
  );
}

interface ToolbarProps {
  editor: Editor;
  label: string;
  images: boolean;
  uploading: boolean;
  onImages: (files: File[]) => void;
}

function Toolbar({ editor, label, images, uploading, onImages }: ToolbarProps) {
  const t = useT();
  const picker = useRef<HTMLInputElement>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      block: ([2, 3, 4] as const).find((level) => current.isActive('heading', { level })) ?? 0,
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      strike: current.isActive('strike'),
      link: current.isActive('link'),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      blockquote: current.isActive('blockquote'),
      table: current.isActive('table'),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();

  function applyLink() {
    const href = linkAddress(linking ?? '');
    if (href === '') chain().extendMarkRange('link').unsetLink().run();
    else chain().extendMarkRange('link').setLink({ href }).run();
    setLinking(null);
  }

  return (
    <div className="border-b">
      <div role="toolbar" aria-label={label} className="flex flex-wrap items-center gap-0.5 p-1">
        <select
          aria-label={t('editor.paragraph')}
          className="h-7 rounded-md border border-input bg-transparent px-1.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          value={state.block}
          onChange={(event) => {
            const level = Number(event.target.value) as 0 | 2 | 3 | 4;
            if (level === 0) chain().setParagraph().run();
            else chain().setHeading({ level }).run();
          }}
        >
          <option value={0}>{t('editor.paragraph')}</option>
          {[2, 3, 4].map((level) => (
            <option key={level} value={level}>
              {t('editor.heading', { level })}
            </option>
          ))}
        </select>
        <Tool label={t('editor.bold')} pressed={state.bold} onClick={() => chain().toggleBold().run()} icon={<Bold />} />
        <Tool label={t('editor.italic')} pressed={state.italic} onClick={() => chain().toggleItalic().run()} icon={<Italic />} />
        <Tool label={t('editor.strike')} pressed={state.strike} onClick={() => chain().toggleStrike().run()} icon={<Strikethrough />} />
        <Tool label={t('editor.link')} pressed={state.link || linking !== null} onClick={() => setLinking(linking === null ? ((editor.getAttributes('link').href as string | undefined) ?? '') : null)} icon={<LinkIcon />} />
        <Tool label={t('editor.bulletList')} pressed={state.bulletList} onClick={() => chain().toggleBulletList().run()} icon={<List className="rtl:-scale-x-100" />} />
        <Tool label={t('editor.orderedList')} pressed={state.orderedList} onClick={() => chain().toggleOrderedList().run()} icon={<ListOrdered className="rtl:-scale-x-100" />} />
        <Tool label={t('editor.blockquote')} pressed={state.blockquote} onClick={() => chain().toggleBlockquote().run()} icon={<Quote />} />
        <Tool label={t('editor.rule')} onClick={() => chain().setHorizontalRule().run()} icon={<Minus />} />
        {images && (
          <>
            <input
              ref={picker}
              type="file"
              accept="image/*"
              multiple
              hidden
              data-editor-image
              onChange={(event) => {
                onImages([...(event.target.files ?? [])]);
                event.target.value = '';
              }}
            />
            <Tool label={t('editor.image')} disabled={uploading} onClick={() => picker.current?.click()} icon={<ImagePlus />} />
          </>
        )}
        <Tool label={t('editor.table')} onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} icon={<TableIcon />} />
        {state.table && (
          <>
            <Tool label={t('editor.addRow')} onClick={() => chain().addRowAfter().run()} icon={<Rows3 />} />
            <Tool label={t('editor.addColumn')} onClick={() => chain().addColumnAfter().run()} icon={<Columns3 />} />
            <Tool label={t('editor.deleteRow')} onClick={() => chain().deleteRow().run()} icon={<Rows3 className="text-destructive" />} />
            <Tool label={t('editor.deleteColumn')} onClick={() => chain().deleteColumn().run()} icon={<Columns3 className="text-destructive" />} />
            <Tool label={t('editor.deleteTable')} onClick={() => chain().deleteTable().run()} icon={<Trash2 className="text-destructive" />} />
          </>
        )}
        <span className="ms-auto flex gap-0.5">
          <Tool label={t('editor.undo')} disabled={!state.canUndo} onClick={() => chain().undo().run()} icon={<Undo2 className="rtl:-scale-x-100" />} />
          <Tool label={t('editor.redo')} disabled={!state.canRedo} onClick={() => chain().redo().run()} icon={<Redo2 className="rtl:-scale-x-100" />} />
        </span>
      </div>
      {linking !== null && (
        <div className="flex flex-wrap items-center gap-1.5 border-t p-1.5">
          <Input
            autoFocus
            dir="ltr"
            type="url"
            className="h-7 min-w-0 flex-1"
            aria-label={t('editor.linkAddress')}
            placeholder="https://"
            value={linking}
            onChange={(event) => setLinking(event.target.value)}
            onKeyDown={(event) => {
              // Enter must not submit the record's form.
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLink();
              } else if (event.key === 'Escape') {
                event.stopPropagation();
                setLinking(null);
                editor.commands.focus();
              }
            }}
          />
          <Button type="button" size="sm" onClick={applyLink}>
            {t('editor.linkApply')}
          </Button>
          {state.link && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                chain().extendMarkRange('link').unsetLink().run();
                setLinking(null);
              }}
            >
              <Unlink />
              {t('editor.unlink')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Tool({ label, icon, pressed, disabled, onClick }: { label: string; icon: ReactNode; pressed?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      className={cn(pressed && 'bg-muted')}
      // Keeps the selection in the editor while the button is pressed.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </Button>
  );
}
