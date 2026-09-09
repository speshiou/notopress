import { describe, expect, it } from "vitest";
import {
  formatMarkdownImageDestination,
  resolveLocalImagePath,
  resolveMarkdownImagePaths,
  safelyDecodeUriComponent,
} from "./local-images";

describe("local image helpers", () => {
  const availableFiles = [
    "attachments/Pasted image example.png",
    "images/logo.png",
    "direct.png",
  ];

  it("decodes repeatedly until URI components are stable", () => {
    expect(safelyDecodeUriComponent({ value: "Pasted%2520image.png" })).toBe("Pasted image.png");
  });

  it("formats paths with spaces as valid Markdown image destinations", () => {
    expect(formatMarkdownImageDestination({ src: "post/Pasted image.webp" })).toBe("<post/Pasted image.webp>");
  });

  it("resolves root-level references to known attachment files", () => {
    expect(
      resolveLocalImagePath({
        src: "/Pasted%2520image%2520example.png",
        availableFiles,
      })
    ).toBe("attachments/Pasted image example.png");
  });

  it("keeps direct known paths unchanged", () => {
    expect(resolveLocalImagePath({ src: "/images/logo.png", availableFiles })).toBe("images/logo.png");
  });

  it("keeps unresolved paths unchanged when a basename match is ambiguous", () => {
    expect(
      resolveLocalImagePath({
        src: "/logo.png",
        availableFiles: ["brand/logo.png", "legacy/logo.png"],
      })
    ).toBe("logo.png");
  });

  it("uses an updated index when a different available file list is provided", () => {
    expect(resolveLocalImagePath({ src: "/logo.png", availableFiles: ["brand/logo.png"] })).toBe("brand/logo.png");
    expect(resolveLocalImagePath({ src: "/logo.png", availableFiles: ["legacy/logo.png"] })).toBe("legacy/logo.png");
  });

  it("rewrites local markdown image references while leaving external images alone", () => {
    const markdown = "![A](/Pasted%20image%20example.png)\n![Remote](https://example.com/image.png)";

    expect(resolveMarkdownImagePaths({ markdown, availableFiles })).toBe(
      "![A](<attachments/Pasted image example.png>)\n![Remote](https://example.com/image.png)"
    );
  });
});
