import type { SVGProps } from "react";

/** Line icons drawn to match the mockups: 24px grid, 1.75 stroke, round caps. Decorative by default. */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function make(paths: JSX.Element, displayName: string) {
  const Icon = ({ size = 20, ...rest }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {paths}
    </svg>
  );
  Icon.displayName = displayName;
  return Icon;
}

export const PlusIcon = make(<path d="M12 5v14M5 12h14" />, "PlusIcon");
export const SearchIcon = make(<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>, "SearchIcon");
export const FolderIcon = make(<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />, "FolderIcon");
export const LibraryIcon = make(<><path d="M4.5 4.5v15M8.5 4.5v15" /><path d="m12.5 5.2 3.6-.9 3.4 14.6-3.6.9z" /></>, "LibraryIcon");
export const SidebarIcon = make(<><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M9.5 4.5v15" /></>, "SidebarIcon");
export const GearIcon = make(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1z" />
  </>,
  "GearIcon",
);
export const ClockIcon = make(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>, "ClockIcon");
export const ChevronDownIcon = make(<path d="m6 9 6 6 6-6" />, "ChevronDownIcon");
export const ChevronRightIcon = make(<path d="m9 6 6 6-6 6" />, "ChevronRightIcon");
export const ChevronLeftIcon = make(<path d="m15 6-6 6 6 6" />, "ChevronLeftIcon");
export const ArrowUpIcon = make(<path d="M12 19V5m-6 6 6-6 6 6" />, "ArrowUpIcon");
export const ArrowDownIcon = make(<path d="M12 5v14m6-6-6 6-6-6" />, "ArrowDownIcon");
export const CloseIcon = make(<path d="M6 6l12 12M18 6 6 18" />, "CloseIcon");
export const PencilIcon = make(<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />, "PencilIcon");
export const CompassIcon = make(<><circle cx="12" cy="12" r="8.5" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></>, "CompassIcon");
export const CodeIcon = make(<path d="m8 8-4 4 4 4m8-8 4 4-4 4m-2.5-10-3 12" />, "CodeIcon");
export const BrainIcon = make(
  <path d="M12 5.5c-1-1.5-3.6-1.6-4.6.2-1.8 0-3 1.7-2.5 3.4-1.4.8-1.5 3 0 3.9-.6 1.8.8 3.6 2.6 3.3.6 1.8 3.4 2.3 4.5.7m0-11.5c1-1.5 3.6-1.6 4.6.2 1.8 0 3 1.7 2.5 3.4 1.4.8 1.5 3 0 3.9.6 1.8-.8 3.6-2.6 3.3-.6 1.8-3.4 2.3-4.5.7m0-11.5v11.5" />,
  "BrainIcon",
);
export const UploadIcon = make(<path d="M12 15V4m-4.5 4.5L12 4l4.5 4.5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />, "UploadIcon");
export const DownloadIcon = make(<path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />, "DownloadIcon");
export const LinkIcon = make(<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />, "LinkIcon");
export const CheckIcon = make(<path d="m5 12.5 4.5 4.5L19 7.5" />, "CheckIcon");
export const BoltIcon = make(<path d="M13 3 5 13.5h6.5L10.5 21 19 10.5h-6.5z" />, "BoltIcon");
export const SparkleIcon = make(<path d="M12 3.5c.6 4.4 2.6 6.9 7.5 8.5-4.9 1.6-6.9 4.1-7.5 8.5-.6-4.4-2.6-6.9-7.5-8.5 4.9-1.6 6.9-4.1 7.5-8.5z" />, "SparkleIcon");
export const DocIcon = make(<><path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z" /><path d="M9 12h6M9 15.5h6M9 8.5h2" /></>, "DocIcon");
export const DotsIcon = make(<><circle cx="6" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="18" cy="12" r="1" fill="currentColor" /></>, "DotsIcon");
export const ArchiveIcon = make(<><rect x="3.5" y="4.5" width="17" height="4.5" rx="1.2" /><path d="M5 9v9a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18V9M10 13h4" /></>, "ArchiveIcon");
export const TrashIcon = make(<path d="M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2m3 0-.8 11.2A2 2 0 0 1 14.7 20H9.3a2 2 0 0 1-2-1.8L6.5 7M10 11v5M14 11v5" />, "TrashIcon");
export const CrownIcon = make(<path d="m4 8 4 3.5L12 5l4 6.5L20 8l-1.5 10h-13z" />, "CrownIcon");
export const UserIcon = make(<><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></>, "UserIcon");
export const UserCircleIcon = make(<><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="10" r="3" /><path d="M6.6 18.2c1.2-2.1 3-3.2 5.4-3.2s4.2 1.1 5.4 3.2" /></>, "UserCircleIcon");
export const SlidersIcon = make(<path d="M4 7h10m4 0h2M4 12h4m4 0h8M4 17h12m4 0h0M14 5v4M8 10v4M16 15v4" />, "SlidersIcon");
export const ShieldIcon = make(<path d="M12 3.5 5 6v5.5c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6z" />, "ShieldIcon");
export const SunIcon = make(<><circle cx="12" cy="12" r="3.8" /><path d="M12 3v1.8M12 19.2V21M3 12h1.8M19.2 12H21M5.6 5.6l1.3 1.3M17.1 17.1l1.3 1.3M5.6 18.4l1.3-1.3M17.1 6.9l1.3-1.3" /></>, "SunIcon");
export const MoonIcon = make(<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z" />, "MoonIcon");
export const MonitorIcon = make(<><rect x="3.5" y="4.5" width="17" height="11.5" rx="2" /><path d="M9 20h6M12 16v4" /></>, "MonitorIcon");
export const CopyIcon = make(<><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></>, "CopyIcon");
export const RetryIcon = make(<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />, "RetryIcon");
export const StopIcon = make(<rect x="7" y="7" width="10" height="10" rx="1.6" fill="currentColor" stroke="none" />, "StopIcon");
export const AlertIcon = make(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5.5m0 3v.01" /></>, "AlertIcon");
export const KeyIcon = make(<><circle cx="8" cy="15" r="4" /><path d="m11 12 8.5-8.5M16 6l2.5 2.5M14 8l2 2" /></>, "KeyIcon");
export const BranchIcon = make(<><circle cx="6.5" cy="5.5" r="2" /><circle cx="6.5" cy="18.5" r="2" /><circle cx="17.5" cy="7.5" r="2" /><path d="M6.5 7.5v9M17.5 9.5c0 4.5-6 3.5-10.4 7.4" /></>, "BranchIcon");
export const GlobeIcon = make(<><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.3 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.3-3.5-8.5s1.1-6.1 3.5-8.5z" /></>, "GlobeIcon");
export const MenuIcon = make(<path d="M4 7h16M4 12h16M4 17h16" />, "MenuIcon");
export const TerminalIcon = make(<><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="m7.5 9.5 3 2.5-3 2.5M12.5 15h4" /></>, "TerminalIcon");
export const SignOutIcon = make(<path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14M10 16l-4-4 4-4M6 12h10" />, "SignOutIcon");
export const HelpIcon = make(<><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.5a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6M12 17v.01" /></>, "HelpIcon");
export const GitHubIcon = make(
  <path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />,
  "GitHubIcon",
);
