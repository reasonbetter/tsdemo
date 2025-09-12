import { useState } from 'react';

interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  // Allow customizing the title size for different contexts (sidebar vs main content)
  titleSize?: 'xs' | 'sm' | 'lg';
}

export const CollapsibleSection = ({
    title,
    children,
    defaultOpen = false,
    className = '',
    titleSize = 'lg',
}: CollapsibleSectionProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const titleClass = titleSize === 'lg' ? 'text-xl font-semibold' : titleSize === 'sm' ? 'text-base font-semibold' : 'text-sm font-semibold';
  const paddingClass = titleSize === 'lg' ? 'p-6' : titleSize === 'sm' ? 'p-4' : 'px-4 py-3';
 

  return (
    // Removed the shadow and background from the container here; we will apply it in the parent layout
    <div className={`border border-border rounded-xl ${className}`}>
      {/* Header/Toggle Button */}
      <button
        className={`w-full flex justify-between items-center ${paddingClass} text-left focus:outline-none transition duration-150 hover:bg-gray-50 rounded-xl`}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <h2 className={`${titleClass} text-foreground`}>{title}</h2>
        {/* Simple Chevron Icon (SVG) */}
        <svg
          className={`w-5 h-5 text-muted-foreground transform transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Content Area */}
      <div
        className={`transition-all duration-300 ease-in-out overflow-hidden ${
          isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
          {/* Add padding and a top border only when open */}
        <div className={`${paddingClass} border-t border-border`}>
            {children}
        </div>
      </div>
    </div>
  );
};
