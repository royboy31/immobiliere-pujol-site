// TEST (10/11/2026): parses a "profil" service page body (Caroline's copy, HTML inside .md)
// into blocks so the layout proposal can render the same text with a lighter design.
// Used only by /service-immobilier/gestion-locative-proposition/[profil].astro.

export type Group = { title?: string; items: string[]; paras: string[] };
export type Block =
  | { kind: 'compare'; title: string; before: Group; after: Group }
  | { kind: 'timeline'; title: string; items: string[] }
  | { kind: 'steps'; title: string; steps: { name: string; text: string }[] }
  | { kind: 'cards'; title: string; groups: Group[] }
  | { kind: 'offer'; title: string; paras: string[]; items: string[] }
  | { kind: 'closing'; title: string; paras: string[] };

export type Profile = {
  title: string;
  lead: string;
  sub: string;
  bullets: string[];
  blocks: Block[];
  faq: { q: string; a: string }[];
};

const strip = (s: string) =>
  s.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const lis = (html: string) => [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
const ps = (html: string) => [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => strip(m[1])).filter(Boolean);

function groupsOf(html: string): Group[] {
  const parts = html.split(/<h3>/);
  const out: Group[] = [];
  parts.forEach((part, i) => {
    let title: string | undefined;
    let body = part;
    if (i > 0) {
      const end = part.indexOf('</h3>');
      title = strip(part.slice(0, end));
      body = part.slice(end + 5);
    }
    const items = lis(body).map(strip);
    const paras = ps(body);
    if (title || items.length || paras.length) out.push({ title, items, paras });
  });
  return out;
}

export function parseProfile(body: string): Profile {
  const section = body.match(/<section class="contextual__section"[^>]*>([\s\S]*)<\/section>\s*<\/div>/)?.[1] ?? body;
  const title = strip(section.match(/<h3 class="contextual__title">([\s\S]*?)<\/h3>/)?.[1] ?? '');
  const [introHtml, ...rest] = section.split(/<h2>/);
  const introPs = [...introHtml.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
  const lead = strip(introPs[0] ?? '');
  const sub = strip(introPs[1] ?? '');
  const bullets = lis(introHtml).map(strip);

  const blocks: Block[] = [];
  let faq: Profile['faq'] = [];
  for (const chunk of rest) {
    const end = chunk.indexOf('</h2>');
    const h2 = strip(chunk.slice(0, end));
    const html = chunk.slice(end + 5);
    if (/^FAQ/i.test(h2)) {
      const p = [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
      for (let i = 0; i + 1 < p.length; i += 2) {
        faq.push({ q: strip(p[i]).replace(/^Q\d+\.\s*/, ''), a: strip(p[i + 1]) });
      }
      continue;
    }
    const groups = groupsOf(html);
    const rawItems = lis(html);
    if (/<ol>/.test(html)) {
      blocks.push({ kind: 'timeline', title: h2, items: rawItems.map(strip) });
    } else if (rawItems.length && rawItems.every((li) => /^\s*<strong>Étape/.test(li))) {
      blocks.push({
        kind: 'steps',
        title: h2,
        steps: rawItems.map((li) => {
          const name = strip(li.match(/<strong>([\s\S]*?)<\/strong>/)?.[1] ?? '').replace(/^Étape\s*\d+\s*[–-]\s*/, '').replace(/\.$/, '');
          return { name, text: strip(li.replace(/<strong>[\s\S]*?<\/strong>/, '')) };
        }),
      });
    } else if (/^Avant \/ après/i.test(h2) && groups.length >= 2) {
      const g = groups.filter((x) => x.title);
      blocks.push({ kind: 'compare', title: h2, before: g[0], after: g[1] });
    } else if (/diagnostic|locatibilit/i.test(h2)) {
      blocks.push({ kind: 'offer', title: h2, paras: ps(html), items: rawItems.map(strip) });
    } else if (!rawItems.length) {
      blocks.push({ kind: 'closing', title: h2, paras: ps(html) });
    } else {
      blocks.push({ kind: 'cards', title: h2, groups });
    }
  }
  return { title, lead, sub, bullets, blocks, faq };
}
