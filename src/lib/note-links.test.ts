import { describe, expect, it } from "vitest";
import { createNoteReferenceResolver, extractWikilinkTargets, getNoteHref } from "./note-links";

describe("note link helpers", () => {
  it("maps page slugs to route hrefs", () => {
    expect(getNoteHref({ fullSlug: "page" })).toBe("/");
    expect(getNoteHref({ fullSlug: "guides/page" })).toBe("/guides");
    expect(getNoteHref({ fullSlug: "guides/vpn-promotion-for-games" })).toBe("/guides/vpn-promotion-for-games");
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
});
