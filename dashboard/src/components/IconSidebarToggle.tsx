type IconSidebarToggleProps = {
  className?: string;
  collapsed?: boolean;
};

export default function IconSidebarToggle({ className, collapsed }: IconSidebarToggleProps) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
      {collapsed ? <path d="m14 12 3-3-3-3" /> : <path d="m13 9-3 3 3 3" />}
    </svg>
  );
}
