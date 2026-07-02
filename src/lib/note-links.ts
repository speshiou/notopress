import { INDEX_SLUG } from "./constants";

export type NoteReference = {
  fullSlug: string;
  title: string;
  href: string;
  content?: string;
  linkable?: boolean;
};

export type NoteReferenceInput = {
  fullSlug: string;
  title: string;
  content?: string;
  linkable?: boolean;
};

export type WikilinkTargets = {
  links: readonly string[];
  embeds: readonly string[];
};

function normalizeNoteTarget(target: string): string {
  const trimmed = target.trim().replace(/^\//, "").replace(/\.md$/i, "");
  const headingIndex = trimmed.indexOf("#");
  return headingIndex === -1 ? trimmed : trimmed.slice(0, headingIndex);
}

function getLeafSlug(fullSlug: string): string {
  const parts = fullSlug.split("/");
  return parts[parts.length - 1] || fullSlug;
}

export function getNoteHref({ fullSlug }: { fullSlug: string }): string {
  if (fullSlug === INDEX_SLUG) {
    return "/";
  }

  const segments = fullSlug.split("/");
  const lastSegment = segments[segments.length - 1];
  const urlSegments = lastSegment === INDEX_SLUG ? segments.slice(0, -1) : segments;
  const urlPath = urlSegments.map((segment) => encodeURIComponent(segment)).join("/");
  return `/${urlPath}`;
}

export function extractWikilinkTargets(markdown: string): WikilinkTargets {
  const links = new Set<string>();
  const embeds = new Set<string>();
  const embedRegex = /!\[\[([^\]]+)\]\]/g;
  const linkRegex = /(^|[^!])\[\[([^\]]+)\]\]/g;

  let embedMatch: RegExpExecArray | null;
  while ((embedMatch = embedRegex.exec(markdown)) !== null) {
    const target = parseWikilinkContent({ content: embedMatch[1] }).target;
    if (target) {
      embeds.add(target);
    }
  }

  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRegex.exec(markdown)) !== null) {
    const target = parseWikilinkContent({ content: linkMatch[2] }).target;
    if (target) {
      links.add(target);
    }
  }

  return {
    links: [...links],
    embeds: [...embeds],
  };
}

export function parseWikilinkContent({ content }: { content: string }): { target: string; label?: string } {
  const [rawTarget, ...labelParts] = content.split("|");
  const target = normalizeNoteTarget(rawTarget || "");
  const label = labelParts.join("|").trim();
  return label ? { target, label } : { target };
}

export function createNoteReferenceResolver({ notes }: { notes: readonly NoteReferenceInput[] }) {
  const references = notes.map((note) => ({
    ...note,
    href: getNoteHref({ fullSlug: note.fullSlug }),
  }));
  const referencesByKey = new Map<string, NoteReference>();
  const referencesByLeaf = new Map<string, NoteReference[]>();

  for (const reference of references) {
    const keys = new Set<string>([reference.fullSlug]);
    const hrefKey = reference.href.replace(/^\//, "");
    if (hrefKey) {
      keys.add(hrefKey);
    }

    for (const key of keys) {
      referencesByKey.set(key, reference);
    }

    const leafSlug = getLeafSlug(reference.fullSlug);
    const leafMatches = referencesByLeaf.get(leafSlug) || [];
    leafMatches.push(reference);
    referencesByLeaf.set(leafSlug, leafMatches);
  }

  return {
    resolve({ target }: { target: string }): NoteReference | null {
      const normalizedTarget = normalizeNoteTarget(target);
      const exactMatch = referencesByKey.get(normalizedTarget);
      if (exactMatch) {
        return exactMatch;
      }

      const leafMatches = referencesByLeaf.get(normalizedTarget) || [];
      return leafMatches.length === 1 ? leafMatches[0] : null;
    },
  };
}
