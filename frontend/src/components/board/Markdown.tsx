import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

/**
 * Markdown renderer for card descriptions and comments.
 *
 * `react-markdown` escapes raw HTML by default, so user content cannot inject
 * markup; GFM adds tables, task lists and strikethrough.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('prose-compact text-[13.5px] text-fg', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}
