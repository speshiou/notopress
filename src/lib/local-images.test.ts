import { describe, expect, it } from "vitest";
import { resolveLocalImagePath, resolveMarkdownImagePaths, safelyDecodeUriComponent } from "./local-images";

describe("local image helpers", () => {
  const availableFiles = [
    "attachments/Pasted image 20260630150256.png",
    "images/logo.png",
    "direct.png",
  ];

  it("decodes repeatedly until URI components are stable", () => {
    expect(safelyDecodeUriComponent({ value: "Pasted%2520image.png" })).toBe("Pasted image.png");
  });

  it("resolves root-level references to known attachment files", () => {
    expect(
      resolveLocalImagePath({
        src: "/Pasted%2520image%252020260630150256.png",
        availableFiles,
      })
    ).toBe("attachments/Pasted image 20260630150256.png");
  });

  it("keeps direct known paths unchanged", () => {
    expect(resolveLocalImagePath({ src: "/images/logo.png", availableFiles })).toBe("images/logo.png");
  });

  it("rewrites local markdown image references while leaving external images alone", () => {
    const markdown = "![A](/Pasted%20image%2020260630150256.png)\n![Remote](https://example.com/image.png)";

    expect(resolveMarkdownImagePaths({ markdown, availableFiles })).toBe(
      "![A](<attachments/Pasted image 20260630150256.png>)\n![Remote](https://example.com/image.png)"
    );
  });
});
