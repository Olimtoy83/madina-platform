import './Pagination.css'

export interface PaginationProps {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  disabled?: boolean
  siblingCount?: number
}

function getPageNumbers(
  page: number,
  pageCount: number,
  siblingCount: number,
): Array<number | 'ellipsis'> {
  const totalNumbers = siblingCount * 2 + 5

  if (pageCount <= totalNumbers) {
    return Array.from(
      { length: pageCount },
      (_, index) => index + 1,
    )
  }

  const leftSibling = Math.max(
    page - siblingCount,
    1,
  )

  const rightSibling = Math.min(
    page + siblingCount,
    pageCount,
  )

  const showLeftEllipsis = leftSibling > 2
  const showRightEllipsis = rightSibling < pageCount - 1

  if (!showLeftEllipsis && showRightEllipsis) {
    const leftItems = siblingCount * 2 + 3

    return [
      ...Array.from(
        { length: leftItems },
        (_, index) => index + 1,
      ),
      'ellipsis',
      pageCount,
    ]
  }

  if (showLeftEllipsis && !showRightEllipsis) {
    const rightItems = siblingCount * 2 + 3
    const start = pageCount - rightItems + 1

    return [
      1,
      'ellipsis',
      ...Array.from(
        { length: rightItems },
        (_, index) => start + index,
      ),
    ]
  }

  return [
    1,
    'ellipsis',
    ...Array.from(
      { length: rightSibling - leftSibling + 1 },
      (_, index) => leftSibling + index,
    ),
    'ellipsis',
    pageCount,
  ]
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
  disabled = false,
  siblingCount = 1,
}: PaginationProps) {
  if (pageCount <= 1) {
    return null
  }

  const currentPage = Math.min(
    Math.max(page, 1),
    pageCount,
  )

  const pages = getPageNumbers(
    currentPage,
    pageCount,
    Math.max(siblingCount, 0),
  )

  const goToPage = (nextPage: number) => {
    if (
      disabled ||
      nextPage < 1 ||
      nextPage > pageCount ||
      nextPage === currentPage
    ) {
      return
    }

    onPageChange(nextPage)
  }

  return (
    <nav
      className="mb-pagination"
      aria-label="Pagination"
    >
      <button
        type="button"
        className="mb-pagination__button"
        disabled={disabled || currentPage === 1}
        onClick={() => goToPage(currentPage - 1)}
        aria-label="Previous page"
      >
        ‹
      </button>

      <div className="mb-pagination__pages">
        {pages.map((item, index) => {
          if (item === 'ellipsis') {
            return (
              <span
                key={`ellipsis-${index}`}
                className="mb-pagination__ellipsis"
                aria-hidden="true"
              >
                …
              </span>
            )
          }

          const active = item === currentPage

          return (
            <button
              key={item}
              type="button"
              className={[
                'mb-pagination__button',
                active
                  ? 'mb-pagination__button--active'
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={disabled}
              aria-current={
                active ? 'page' : undefined
              }
              onClick={() => goToPage(item)}
            >
              {item}
            </button>
          )
        })}
      </div>

      <button
        type="button"
        className="mb-pagination__button"
        disabled={
          disabled ||
          currentPage === pageCount
        }
        onClick={() => goToPage(currentPage + 1)}
        aria-label="Next page"
      >
        ›
      </button>
    </nav>
  )
}
