import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & {
  title?: string;
};

function baseProps(props: IconProps) {
  const { title, ...rest } = props;
  return {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": title ? undefined : true,
    role: title ? ("img" as const) : undefined,
    ...rest
  };
}

export function IconSearch(props: IconProps) {
  const p = baseProps(props);
  return (
    <svg {...p}>
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

export function IconFilter(props: IconProps) {
  const p = baseProps(props);
  return (
    <svg {...p}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M4 5h16" />
      <path d="M6 12h12" />
      <path d="M10 19h4" />
    </svg>
  );
}

export function IconHome(props: IconProps) {
  const p = baseProps(props);
  return (
    <svg {...p}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6.5 10.5V20h11V10.5" />
    </svg>
  );
}

export function IconMessage(props: IconProps) {
  const p = baseProps(props);
  return (
    <svg {...p}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M21 14a4 4 0 0 1-4 4H9l-5 3V7a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4z" />
    </svg>
  );
}

export function IconBot(props: IconProps) {
  const p = baseProps(props);
  return (
    <svg {...p}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M9 3h6" />
      <path d="M12 3v3" />
      <rect x="5" y="6" width="14" height="14" rx="4" />
      <path d="M9 12h.01" />
      <path d="M15 12h.01" />
      <path d="M9 16h6" />
    </svg>
  );
}

export function IconStar(props: IconProps) {
  const p = baseProps(props);
  return (
    <svg {...p}>
      {props.title ? <title>{props.title}</title> : null}
      {/* Sparkle-style star (matches Figma reference) */}
      <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2z" />
    </svg>
  );
}

export function IconUser(props: IconProps) {
  const p = baseProps(props);
  return (
    <svg {...p}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M20 21a8 8 0 1 0-16 0" />
      <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
    </svg>
  );
}

export function IconLogout(props: IconProps) {
  const p = baseProps(props);
  return (
    <svg {...p}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

export function IconMenu(props: IconProps) {
  const p = baseProps(props);
  return (
    <svg {...p}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  );
}

export function IconSend(props: IconProps) {
  const p = baseProps(props);
  return (
    <svg {...p}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

export function IconEdit(props: IconProps) {
  const p = baseProps(props);
  return (
    <svg {...p}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function IconChevronDown(props: IconProps) {
  const p = baseProps(props);
  return (
    <svg {...p}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function IconCopy(props: IconProps) {
  const p = baseProps(props);
  return (
    <svg {...p}>
      {props.title ? <title>{props.title}</title> : null}
      <rect x="9" y="9" width="13" height="13" rx="3" />
      <path d="M5 15V6a4 4 0 0 1 4-4h9" />
    </svg>
  );
}

export function IconTrash(props: IconProps) {
  const p = baseProps(props);
  return (
    <svg {...p}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export function IconSmile(props: IconProps) {
  const p = baseProps(props);
  return (
    <svg {...p}>
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="12" cy="12" r="9" />
      <path d="M9 10h.01" />
      <path d="M15 10h.01" />
      <path d="M9.5 15a4.5 4.5 0 0 0 5 0" />
    </svg>
  );
}

