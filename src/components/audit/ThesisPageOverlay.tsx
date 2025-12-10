/**
 * ThesisPageOverlay Component
 * DOM-based overlay for PDF highlighting with 100% reliable click detection
 * Renders absolute positioned divs on top of the PDF page
 */

import { memo, useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { PdfToken } from '@/lib/pdf-text-map';

export interface HighlightRect {
  id: string;           // Unique identifier (e.g., "claim-1.2" or "paragraph-5")
  claimId?: string;     // Display ID like "1.2"
  pageIndex: number;
  rect: PdfToken['rect'];
  verdict: 'green' | 'yellow' | 'red' | 'blue';
  isSelected?: boolean;
  globalClaimIndex?: number;
  paragraphIndex?: number;
  claimIndex?: number | null;
}

interface ThesisPageOverlayProps {
  pageIndex: number;
  scale: number;
  pageHeight: number;
  highlights: HighlightRect[];
  selectedHighlightId?: string;
  hoveredHighlightId?: string;
  onHighlightClick: (highlight: HighlightRect) => void;
  onHighlightHover?: (highlight: HighlightRect | null) => void;
}

/**
 * Get background color for verdict
 */
function getVerdictColor(verdict: 'green' | 'yellow' | 'red' | 'blue'): string {
  const colors = {
    green: 'hsl(142, 76%, 36%)',   // Green-600
    yellow: 'hsl(48, 96%, 53%)',   // Yellow-400
    red: 'hsl(0, 84%, 60%)',       // Red-500
    blue: 'hsl(217, 91%, 60%)',    // Blue-500
  };
  return colors[verdict];
}

/**
 * Individual highlight box component
 */
const HighlightBox = memo(function HighlightBox({
  highlight,
  scale,
  pageHeight,
  isSelected,
  isHovered,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  highlight: HighlightRect;
  scale: number;
  pageHeight: number;
  isSelected: boolean;
  isHovered: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const { rect, verdict, claimId } = highlight;

  // Convert PDF coordinates (bottom-left origin) to DOM coordinates (top-left origin)
  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${rect.x * scale}px`,
    // FLIP Y-AXIS: PDF uses bottom-left, DOM uses top-left
    top: `${(pageHeight - rect.y - rect.height) * scale}px`,
    width: `${rect.width * scale}px`,
    height: `${rect.height * scale}px`,
    backgroundColor: getVerdictColor(verdict),
    opacity: isSelected ? 0.5 : isHovered ? 0.45 : 0.35,
    cursor: 'pointer',
    mixBlendMode: 'multiply',
    borderRadius: '2px',
    transition: 'opacity 0.15s ease-in-out',
    // Add border for selected/hovered state
    boxShadow: isSelected 
      ? `0 0 0 2px ${getVerdictColor(verdict)}, 0 0 8px ${getVerdictColor(verdict)}` 
      : isHovered 
        ? `0 0 0 1px ${getVerdictColor(verdict)}` 
        : 'none',
    zIndex: isSelected ? 10 : isHovered ? 5 : 1,
  };

  return (
    <div
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      title={claimId ? `Claim ${claimId}` : 'Click to view'}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    />
  );
});

/**
 * ThesisPageOverlay Component
 * Renders all highlights for a single PDF page as DOM elements
 */
export const ThesisPageOverlay = memo(function ThesisPageOverlay({
  pageIndex,
  scale,
  pageHeight,
  highlights,
  selectedHighlightId,
  hoveredHighlightId,
  onHighlightClick,
  onHighlightHover,
}: ThesisPageOverlayProps) {
  // Filter highlights for this page only
  const pageHighlights = useMemo(() => {
    return highlights.filter(h => h.pageIndex === pageIndex);
  }, [highlights, pageIndex]);

  if (pageHighlights.length === 0) {
    return null;
  }

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 10 }}
    >
      {pageHighlights.map((highlight) => (
        <div key={highlight.id} className="pointer-events-auto">
          <HighlightBox
            highlight={highlight}
            scale={scale}
            pageHeight={pageHeight}
            isSelected={highlight.id === selectedHighlightId}
            isHovered={highlight.id === hoveredHighlightId}
            onClick={() => onHighlightClick(highlight)}
            onMouseEnter={() => onHighlightHover?.(highlight)}
            onMouseLeave={() => onHighlightHover?.(null)}
          />
        </div>
      ))}
    </div>
  );
});

/**
 * Hook to build highlights from claims and document map
 */
export function useHighlightsFromClaims(
  claims: Array<{
    claim: { text: string };
    paragraphIndex: number;
    claimIndex: number;
    paragraphText: string;
    color: 'green' | 'yellow' | 'red' | 'blue';
    displayId: string;
  }>,
  documentMap: { findClaimLocation: (text: string, id: string) => Array<{ pageIndex: number; rects: PdfToken['rect'][] }> } | null,
  currentPage: number
): HighlightRect[] {
  return useMemo(() => {
    if (!documentMap) return [];

    const highlights: HighlightRect[] = [];
    let globalClaimIndex = 0;

    for (const claim of claims) {
      const locations = documentMap.findClaimLocation(claim.claim.text, claim.displayId);

      for (const location of locations) {
        for (let i = 0; i < location.rects.length; i++) {
          highlights.push({
            id: `${claim.displayId}-${location.pageIndex}-${i}`,
            claimId: claim.displayId,
            pageIndex: location.pageIndex,
            rect: location.rects[i],
            verdict: claim.color,
            globalClaimIndex,
            paragraphIndex: claim.paragraphIndex,
            claimIndex: claim.claimIndex,
          });
        }
      }

      globalClaimIndex++;
    }

    return highlights;
  }, [claims, documentMap, currentPage]);
}

export default ThesisPageOverlay;
