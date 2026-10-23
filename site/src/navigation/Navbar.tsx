import { LogoMark } from "@web/ui/Logo";
import { MoonIcon, SearchIcon, SunIcon } from "@web/ui/icons";
import { LINKS } from "../links";
import type { Theme } from "../theme";
import CardNav from "./CardNav";
import styles from "./Navbar.module.css";

const items = [
  {
    label: "Explore Caramel",
    description: "From the first instruction to a patch you can review.",
    links: [
      { label: "Product preview", href: "#product" },
      { label: "How it works", href: "#how" },
      { label: "Example runs", href: "#example-replay" },
    ],
  },
  {
    label: "Start building",
    description: "Your repository, your model, your project's checks.",
    links: [
      { label: "Get started", href: "#get-started" },
      { label: "Documentation", href: LINKS.docs },
      { label: "Desktop updates", href: LINKS.notify },
    ],
  },
  {
    label: "Built in the open",
    description: "Read the code and follow what comes next.",
    links: [
      { label: "View on GitHub", href: LINKS.github },
      { label: "Releases", href: LINKS.notify },
    ],
  },
];

export function Navbar({ theme, toggleTheme, onOpenCommands, onQuickStart, reducedMotion = false }: {
  theme: Theme; toggleTheme: () => void; onOpenCommands?: () => void; onQuickStart?: () => void; reducedMotion?: boolean;
}) {
  return <header className={styles.header}>
    <div className={styles.container}>
      <CardNav
        ariaLabel="Caramel navigation"
        className="caramel-card-nav"
        logo={<span className={styles.logo}><LogoMark size={25} /><span>caramel</span></span>}
        logoAlt="Caramel, back to top"
        logoHref="#top"
        items={items}
        cta={{ label: "Try a sample", href: "#product" }}
        theme={theme}
        surface="glass"
        openOn="click"
        cardEffect="rise"
        cardHeight={190}
        maxWidth={800}
        reducedMotion={reducedMotion}
        onLinkClick={(link, _item, event) => {
          if (link.label === "Get started" && onQuickStart) { event.preventDefault(); onQuickStart(); }
          if (link.href === "#example-replay") {
            const target = document.getElementById("example-replay");
            if (target instanceof HTMLDetailsElement) target.open = true;
          }
        }}
      />
      {onOpenCommands ? <button type="button" className={styles.search} onClick={onOpenCommands} aria-label="Search page commands" aria-keyshortcuts="Meta+k Control+k" title="Search page commands (⌘K / Ctrl+K)"><SearchIcon size={16}/><kbd>⌘K</kbd></button> : null}
      <button type="button" className={styles.theme} onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
        {theme === "dark" ? <SunIcon size={17} /> : <MoonIcon size={17} />}
      </button>
    </div>
  </header>;
}
