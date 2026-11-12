import { useEffect, useState } from 'react'

export function SharePreviewModal({
  canvas,
  filename,
  onClose,
}: {
  canvas: HTMLCanvasElement
  filename: string
  onClose: () => void
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'copied' | 'downloaded'>('idle')

  useEffect(() => {
    setDataUrl(canvas.toDataURL('image/png'))
  }, [canvas])

  function toBlob(): Promise<Blob | null> {
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  }

  async function copy() {
    const blob = await toBlob()
    if (!blob) return
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setStatus('copied')
      setTimeout(() => setStatus('idle'), 1800)
    } catch {
      // clipboard write can be blocked (permissions, insecure context) — download still works
    }
  }

  async function download() {
    const blob = await toBlob()
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    setStatus('downloaded')
    setTimeout(() => setStatus('idle'), 1800)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="share-card" onClick={(e) => e.stopPropagation()}>
        <div className="share-brand">
          <span className="share-brand-dot" />
          openfinance.tech
        </div>
        <div className="share-head">
          <h3>Share chart</h3>
          <button className="modal-x" onClick={onClose}>×</button>
        </div>
        <div className="share-preview">
          {dataUrl ? <img src={dataUrl} alt="Chart preview" /> : <div className="muted">Rendering…</div>}
        </div>
        <div className="share-actions">
          <button className="btn close-btn" onClick={copy}>
            {status === 'copied' ? 'Copied ✓' : 'Copy image'}
          </button>
          <button className="rp-cta long" onClick={download}>
            <span className="rp-cta-main">{status === 'downloaded' ? 'Saved ✓' : 'Download PNG'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
