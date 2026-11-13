import type { Insight } from '@/lib/insights'
import '@/styles/report.css'

/** Renders **bold** segments without HTML injection. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text
        .split('**')
        .map((part, index) =>
          index % 2 ? <strong key={index}>{part}</strong> : part,
        )}
    </>
  )
}

export default function InsightList({ items }: { items: Insight[] }) {
  if (!items.length) return null
  return (
    <ul className="insight-list">
      {items.map((item, index) => (
        <li key={index} className={`insight tone-${item.tone}`}>
          <i aria-hidden="true" />
          <span>
            <Rich text={item.text} />
          </span>
        </li>
      ))}
    </ul>
  )
}
