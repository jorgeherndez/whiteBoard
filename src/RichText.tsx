import { useEffect, useRef } from "react";
import { EditorContent, useEditor, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";

interface Props {
  content: string;
  editing: boolean;
  placeholder?: string;
  onChange: (md: string) => void;
  onFocusEditor: (e: Editor | null) => void;
}

/** Editor de texto estilo Obsidian: atajos markdown (#, **, -, [ ]) y guardado en .md */
export default function RichText({ content, editing, placeholder, onChange, onFocusEditor }: Props) {
  const last = useRef(content);
  const timer = useRef<number | undefined>(undefined);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: placeholder ?? "Escribe…" }),
      Markdown,
    ],
    content,
    contentType: "markdown",
    editable: editing,
    onUpdate: ({ editor }) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        const md = editor.getMarkdown();
        last.current = md;
        onChange(md);
      }, 400);
    },
  });

  // Cambios externos (deshacer/rehacer)
  useEffect(() => {
    if (editor && content !== last.current) {
      last.current = content;
      editor.commands.setContent(content, { contentType: "markdown", emitUpdate: false });
    }
  }, [content, editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editing);
    if (editing) {
      editor.commands.focus("end");
      onFocusEditor(editor);
    } else {
      // al salir, vuelca lo pendiente
      window.clearTimeout(timer.current);
      const md = editor.getMarkdown();
      if (md !== last.current) { last.current = md; onChange(md); }
      onFocusEditor(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, editor]);

  return <EditorContent editor={editor} className={`rt ${editing ? "editing" : ""}`} />;
}
