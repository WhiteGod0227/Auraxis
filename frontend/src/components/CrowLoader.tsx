import Crow from './Crow'

export default function CrowLoader({
  label = 'Loading...',
}: {
  label?: string
}) {
  return (
    <div className="crow-loading" role="status" aria-live="polite">
      <Crow size={84} mood="pecking" />
      <span>{label}</span>
    </div>
  )
}
