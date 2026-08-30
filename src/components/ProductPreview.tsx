import { useLayoutEffect, useRef, useState } from 'react'
import { formatPrice } from '../lib/catalog'
import type { CatalogItem } from '../lib/types'

export interface PreviewTarget {
  item: CatalogItem
  /** Number of colourways of the product this variant belongs to. */
  colours: number
  /** Vertical anchor: the middle of the hovered card, in client coordinates. */
  y: number
  /** Left edge to open from: the right edge of the sidebar. */
  x: number
}

/** Width of the panel, matched in the stylesheet. */
const WIDTH = 268

/**
 * The detail card shown when hovering a product in the catalogue.
 *
 * It opens beside the list rather than over it, so moving down the list never
 * makes the panel cover the thing you are pointing at.
 */
export function ProductPreview({ target, currency }: { target: PreviewTarget | null; currency: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(0)

  useLayoutEffect(() => {
    if (!target || !ref.current) return
    const { height } = ref.current.getBoundingClientRect()
    // Centre on the card, then keep the whole panel on screen.
    const wanted = target.y - height / 2
    setTop(Math.max(8, Math.min(wanted, window.innerHeight - height - 8)))
  }, [target])

  if (!target) return null
  const { item } = target

  return (
    <div ref={ref} className="preview" style={{ left: target.x + 10, top, width: WIDTH }} role="tooltip">
      <div className="preview-image" style={{ background: item.color }}>
        {item.imageUrl ? <img src={item.imageUrl} alt="" /> : null}
      </div>

      <div className="preview-body">
        <h3>
          {item.name} <em>{item.type}</em>
        </h3>

        <dl className="preview-facts">
          <div>
            <dt>Size</dt>
            <dd>
              {item.width} × {item.depth} × {item.height} cm
            </dd>
          </div>
          <div>
            <dt>Finish</dt>
            <dd>{item.finish !== 'unspecified' ? item.finish : 'not listed'}</dd>
          </div>
          <div>
            <dt>Price</dt>
            <dd className="preview-price">{formatPrice(item.price, currency)}</dd>
          </div>
          <div>
            <dt>Article</dt>
            <dd className="preview-article">{item.id}</dd>
          </div>
        </dl>

        <p className="preview-hint">
          {target.colours > 1 ? `${target.colours} colours · ` : ''}
          Click to place · right-click for ikea.com
        </p>
      </div>
    </div>
  )
}
