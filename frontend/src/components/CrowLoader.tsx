import '@/styles/crow-loader.css'

export default function CrowLoader({
  label = 'Loading...',
}: {
  label?: string
}) {
  return (
    <div className="inline-loading-state" role="status" aria-live="polite">
      <span className="inline-loading-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}
