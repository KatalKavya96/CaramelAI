import { useEffect, useState } from "react";
import { LINKS } from "../links";
import styles from "./Updates.module.css";

interface Update { id:string; title:string; description:string; date:string; url:string }
// Public development history, checked 22 Oct 2026. These are commits, not releases.
export const DEVELOPMENT_UPDATES: Update[] = [
  {id:"44cc571",title:"More balanced execution budgets",description:"Adjustments to the issue execution budgets.",date:"2026-09-27",url:`${LINKS.github}/commit/44cc571b5f329877b41a5c07a1531f9e1e7dc47d`},
  {id:"3e19681",title:"CI pipeline",description:"Updates to the project's continuous integration pipeline.",date:"2026-09-26",url:`${LINKS.github}/commit/3e196814e52c981356203422ddfca239e3e24fcf`},
  {id:"4734483",title:"Controller refactor",description:"An internal refactor of the agent controller.",date:"2026-09-26",url:`${LINKS.github}/commit/4734483a9b1cdcbbdd5b605f69becd361dc5a188`},
];
interface Release { id?:unknown; name?:unknown; tag_name?:unknown; html_url?:unknown; published_at?:unknown; draft?:unknown; prerelease?:unknown }
export function useUpdates() {
  const [updates,setUpdates] = useState<Update[]>(DEVELOPMENT_UPDATES);
  const [hasRelease,setHasRelease] = useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),5000);
    void fetch("https://api.github.com/repos/KatalKavya96/CaramelAI/releases?per_page=3",{signal:controller.signal,headers:{Accept:"application/vnd.github+json"}})
      .then(async response=>{if(!response.ok)return;const data:unknown=await response.json();if(!Array.isArray(data))return;
        const releases=data.filter((item:Release)=>!item.draft&&!item.prerelease&&typeof item.tag_name==="string"&&typeof item.html_url==="string"&&item.html_url.startsWith(`${LINKS.github}/releases/tag/`)&&typeof item.published_at==="string"&&!Number.isNaN(Date.parse(item.published_at))).slice(0,3).map((item:Release)=>({id:String(item.id),title:String(item.name||item.tag_name).slice(0,100),description:"Read the release notes on GitHub.",date:String(item.published_at).slice(0,10),url:String(item.html_url)}));
        if(!controller.signal.aborted&&releases.length){setUpdates(releases);setHasRelease(true);}
      }).catch(()=>{ /* Public commit snapshot remains useful offline or when GitHub is rate limited. */ }).finally(()=>clearTimeout(timeout));
    return()=>{controller.abort();clearTimeout(timeout);};
  },[]);
  return {updates,hasRelease};
}
export function WhatsNewPill({hasRelease,latest}:{hasRelease:boolean;latest?:Update}) {
  return <a className={styles.pill} href="#updates"><span className={styles.dot} aria-hidden="true"/><span>{hasRelease&&latest?latest.title:"In development"}</span><span className={styles.pillDivider}/><span>What’s new</span><span aria-hidden="true">↗</span></a>;
}
export function Updates({updates,hasRelease}:{updates:Update[];hasRelease:boolean}) {
  return <section id="updates" className={styles.section} aria-labelledby="updates-title"><div className={styles.heading}><div><p>Built in the open</p><h2 id="updates-title">Always taking shape.</h2></div><a href={hasRelease?LINKS.notify:`${LINKS.github}/commits/main/`}>View {hasRelease?"releases":"development log"}<span aria-hidden="true">↗</span></a></div><p className={styles.intro}>{hasRelease?"The latest published releases from GitHub.":"Recent public development updates. No tagged release has been published yet."}</p><div className={styles.cards}>{updates.map(update=><a href={update.url} key={update.id}><time dateTime={update.date}>{new Intl.DateTimeFormat("en",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}).format(new Date(`${update.date}T00:00:00Z`))}</time><h3>{update.title}</h3><p>{update.description}</p><span className={styles.read}>Read {hasRelease?"release notes":"update"} <span aria-hidden="true">↗</span></span></a>)}</div>{!hasRelease?<p className={styles.note}>Public commit snapshot checked 22 Oct 2026. Follow GitHub for the complete history.</p>:null}</section>;
}
