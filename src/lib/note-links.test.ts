import { describe, expect, it } from "vitest";
import { createNoteReferenceResolver, extractWikilinkTargets, getNoteHref, parseWikilinkContent } from "./note-links";

describe("note link helpers", () => {
  it("maps public slugs to route hrefs", () => {
    expect(getNoteHref({ publicSlug: "page" })).toBe("/");
    expect(getNoteHref({ publicSlug: "guides" })).toBe("/guides");
    expect(getNoteHref({ publicSlug: "guides/example-note" })).toBe("/guides/example-note");
  });

  it("resolves unique leaf slugs to their nested full paths", () => {
    const resolver = createNoteReferenceResolver({
      notes: [
        {
          fullSlug: "guides/example-note",
          title: "Example Note",
        },
      ],
    });

    expect(resolver.resolve({ target: "example-note" })?.href).toBe("/guides/example-note");
  });

  it("uses rewritten public hrefs when publicSlug is provided", () => {
    const resolver = createNoteReferenceResolver({
      notes: [
        {
          fullSlug: "guides/example-note",
          title: "Example Note",
          publicSlug: "example-note",
        },
      ],
    });

    expect(resolver.resolve({ target: "guides/example-note" })?.href).toBe("/example-note");
    expect(resolver.resolve({ target: "example-note" })?.href).toBe("/example-note");
  });

  it("leaves ambiguous leaf slugs unresolved", () => {
    const resolver = createNoteReferenceResolver({
      notes: [
        { fullSlug: "guides/note", title: "Guide Note" },
        { fullSlug: "reviews/note", title: "Review Note" },
      ],
    });

    expect(resolver.resolve({ target: "note" })).toBeNull();
  });

  it("extracts note link and embed targets separately", () => {
    expect(extractWikilinkTargets("Read [[note-slug]] and embed ![[embed-note]].")).toEqual({
      links: ["note-slug"],
      embeds: ["embed-note"],
    });
  });

  it("parses aliases whose separator is escaped for Markdown tables", () => {
    expect(parseWikilinkContent({ content: "guide\\|Guide label" })).toEqual({
      target: "guide",
      label: "Guide label",
    });
    expect(extractWikilinkTargets("| See [[guide\\|Guide label]] |")).toEqual({
      links: ["guide"],
      embeds: [],
    });
  });
});
