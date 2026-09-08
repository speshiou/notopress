import { describe, expect, it } from "vitest";
import { createNoteReferenceResolver, extractWikilinkTargets, getNoteHref, parseWikilinkContent } from "./note-links";

describe("note link helpers", () => {
  it("maps public slugs to route hrefs", () => {
    expect(getNoteHref({ publicSlug: "page" })).toBe("/");
    expect(getNoteHref({ publicSlug: "guides" })).toBe("/guides");
    expect(getNoteHref({ publicSlug: "guides/vpn-promotion-for-games" })).toBe("/guides/vpn-promotion-for-games");
  });

  it("resolves unique leaf slugs to their nested full paths", () => {
    const resolver = createNoteReferenceResolver({
      notes: [
        {
          fullSlug: "guides/vpn-promotion-for-games",
          title: "Best VPN Promotions for Games",
        },
      ],
    });

    expect(resolver.resolve({ target: "vpn-promotion-for-games" })?.href).toBe("/guides/vpn-promotion-for-games");
  });

  it("uses rewritten public hrefs when publicSlug is provided", () => {
    const resolver = createNoteReferenceResolver({
      notes: [
        {
          fullSlug: "guides/vpn-promotion-for-games",
          title: "Best VPN Promotions for Games",
          publicSlug: "vpn-promotion-for-games",
        },
      ],
    });

    expect(resolver.resolve({ target: "guides/vpn-promotion-for-games" })?.href).toBe("/vpn-promotion-for-games");
    expect(resolver.resolve({ target: "vpn-promotion-for-games" })?.href).toBe("/vpn-promotion-for-games");
  });

  it("leaves ambiguous leaf slugs unresolved", () => {
    const resolver = createNoteReferenceResolver({
      notes: [
        { fullSlug: "games/vpn", title: "Gaming VPN" },
        { fullSlug: "privacy/vpn", title: "Privacy VPN" },
      ],
    });

    expect(resolver.resolve({ target: "vpn" })).toBeNull();
  });

  it("extracts note link and embed targets separately", () => {
    expect(extractWikilinkTargets("Read [[vpn]] and embed ![[promo-card]].")).toEqual({
      links: ["vpn"],
      embeds: ["promo-card"],
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
