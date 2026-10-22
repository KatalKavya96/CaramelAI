import type { MouseEvent, ReactNode } from "react";
import { Avatar, ChevronRightIcon, DotsIcon, GearIcon, IconButton, Kbd, Logo, LogoMark, Menu, PlusIcon, SidebarIcon, Tooltip, type MenuItem } from "../ui";
import styles from "./Sidebar.module.css";

export interface SidebarLink {
  label: string;
  icon: ReactNode;
  href: string;
  active?: boolean;
  onSelect: () => void;
}

export interface SidebarListItem {
  id: string;
  label: string;
  href: string;
  active?: boolean;
  /** Small leading mark, such as a status icon. */
  leading?: ReactNode;
  /** Short trailing text, such as "Running". */
  trailing?: ReactNode;
  menuItems?: (MenuItem | "separator")[];
  onSelect: () => void;
}

export interface SidebarSection {
  title: string;
  /** Optional sub-groups (e.g. one per repository), each with its own heading. */
  groups: { heading?: string; items: SidebarListItem[] }[];
  empty?: string;
}

export interface SidebarProps {
  primary: { label: string; shortcut?: string; onClick: () => void };
  links: SidebarLink[];
  sections: SidebarSection[];
  footerLink?: SidebarLink;
  user: { name: string; onSettings: () => void; menuItems?: (MenuItem | "separator")[] };
  onCollapse?: () => void;
}

function follow(event: MouseEvent<HTMLAnchorElement>, onSelect: () => void) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  event.preventDefault();
  onSelect();
}

/** The left sidebar from the mockups: logo, primary button, links, a recent list, then the footer rows. */
export function Sidebar({ primary, links, sections, footerLink, user, onCollapse }: SidebarProps) {
  return (
    <nav className={styles.sidebar} aria-label="Main">
      <div className={styles.header}>
        <Logo />
        {onCollapse === undefined ? null : <IconButton label="Collapse sidebar" icon={<SidebarIcon size={22} />} onClick={onCollapse} />}
      </div>

      <button type="button" className={styles.primary} onClick={primary.onClick}>
        <PlusIcon size={20} />
        <span className={styles.primaryLabel}>{primary.label}</span>
        {primary.shortcut === undefined ? null : <Kbd>{primary.shortcut}</Kbd>}
      </button>

      <ul className={styles.links}>
        {links.map((link) => (
          <li key={link.label}>
            <a href={link.href} className={[styles.link, link.active === true ? styles.linkActive : ""].join(" ")} aria-current={link.active === true ? "page" : undefined} onClick={(event) => follow(event, link.onSelect)}>
              {link.icon}
              {link.label}
            </a>
          </li>
        ))}
      </ul>

      <div className={styles.scroll}>
        {sections.map((section) => (
          <section key={section.title} className={styles.section} aria-label={section.title}>
            <h2 className={styles.sectionTitle}>{section.title}</h2>
            {section.groups.every((group) => group.items.length === 0) && section.empty !== undefined ? <p className={styles.empty}>{section.empty}</p> : null}
            {section.groups.map((group, index) => (
              <div key={group.heading ?? index} className={styles.group}>
                {group.heading === undefined ? null : <h3 className={styles.groupHeading}>{group.heading}</h3>}
                <ul className={styles.items}>
                  {group.items.map((item) => (
                    <li key={item.id} className={[styles.item, item.active === true ? styles.itemActive : ""].join(" ")}>
                      <a href={item.href} className={styles.itemLink} aria-current={item.active === true ? "page" : undefined} onClick={(event) => follow(event, item.onSelect)}>
                        {item.leading}
                        <span className={styles.itemLabel}>{item.label}</span>
                        {item.trailing === undefined ? null : <span className={styles.itemTrailing}>{item.trailing}</span>}
                      </a>
                      {item.menuItems === undefined ? null : (
                        <Menu
                          align="start"
                          side="right"
                          items={item.menuItems}
                          trigger={<IconButton className={styles.itemMenu} size="sm" label={`Actions for ${item.label}`} icon={<DotsIcon size={18} />} />}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>

      <div className={styles.footer}>
        {footerLink === undefined ? null : (
          <a href={footerLink.href} className={[styles.footerLink, footerLink.active === true ? styles.linkActive : ""].join(" ")} onClick={(event) => follow(event, footerLink.onSelect)}>
            {footerLink.icon}
            <span className={styles.primaryLabel}>{footerLink.label}</span>
            <ChevronRightIcon size={18} />
          </a>
        )}
        <div className={styles.user}>
          {user.menuItems === undefined ? (
            <span className={styles.userName}>
              <Avatar name={user.name} />
              {user.name}
            </span>
          ) : (
            <Menu
              side="top"
              align="start"
              width={220}
              items={user.menuItems}
              header={
                <div className={styles.menuHeader}>
                  <Avatar name={user.name} size={36} />
                  <span>
                    <strong>{user.name}</strong>
                    <span className={styles.menuSub}>Personal account</span>
                  </span>
                </div>
              }
              trigger={
                <button type="button" className={styles.userName} aria-label={`Account menu for ${user.name}`}>
                  <Avatar name={user.name} />
                  {user.name}
                </button>
              }
            />
          )}
          <IconButton label="Settings" icon={<GearIcon size={22} />} onClick={user.onSettings} />
        </div>
      </div>
    </nav>
  );
}

export interface SidebarRailProps {
  onExpand: () => void;
  onPrimary: () => void;
  links: SidebarLink[];
}

/** The collapsed sidebar from the mockups: the mark, one icon per link, and the round expand button. */
export function SidebarRail({ onExpand, onPrimary, links }: SidebarRailProps) {
  return (
    <nav className={styles.rail} aria-label="Main">
      <LogoMark size={30} />
      <Tooltip content="New run">
        <IconButton label="New run" icon={<PlusIcon size={20} />} onClick={onPrimary} />
      </Tooltip>
      {links.map((link) => (
        <Tooltip key={link.label} content={link.label}>
          <a href={link.href} aria-label={link.label} className={[styles.railLink, link.active === true ? styles.linkActive : ""].join(" ")} onClick={(event) => follow(event, link.onSelect)}>
            {link.icon}
          </a>
        </Tooltip>
      ))}
      <span className={styles.railSpacer} />
      <Tooltip content="Expand sidebar">
        <button type="button" className={styles.expand} aria-label="Expand sidebar" onClick={onExpand}>
          <ChevronRightIcon size={18} />
        </button>
      </Tooltip>
    </nav>
  );
}
