/**
 * Tooltip Component
 *
 * A simple tooltip component that shows on hover/focus.
 * Uses CSS-only approach for simplicity and performance.
 */
import type { ReactNode } from 'react';

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  content: string;
  position?: TooltipPosition;
  children: ReactNode;
  className?: string;
  maxWidth?: string;
}

export function Tooltip({
  content,
  position = 'top',
  children,
  className = '',
  maxWidth,
}: TooltipProps) {
  const positionClasses: Record<TooltipPosition, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  return (
    <span className={`tooltip-trigger ${className}`}>
      {children}
      <span
        className={`tooltip ${positionClasses[position]}`}
        style={maxWidth ? { maxWidth, whiteSpace: 'normal' } : undefined}
        role="tooltip"
      >
        {content}
      </span>
    </span>
  );
}

/**
 * InfoTooltip - A tooltip with an info icon trigger
 */
interface InfoTooltipProps {
  content: string;
  position?: TooltipPosition;
  className?: string;
}

export function InfoTooltip({ content, position = 'top', className = '' }: InfoTooltipProps) {
  return (
    <Tooltip content={content} position={position} className={className}>
      <svg
        className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-help inline-block ml-1"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    </Tooltip>
  );
}

/**
 * TruncatedText - Text that truncates with tooltip showing full text
 */
interface TruncatedTextProps {
  text: string;
  maxWidth?: string;
  className?: string;
}

export function TruncatedText({ text, maxWidth = '200px', className = '' }: TruncatedTextProps) {
  return (
    <Tooltip content={text} position="top" maxWidth="300px">
      <span
        className={`block truncate ${className}`}
        style={{ maxWidth }}
      >
        {text}
      </span>
    </Tooltip>
  );
}
