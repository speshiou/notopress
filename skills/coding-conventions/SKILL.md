---
title: Coding Conventions
description: Standards and best practices for the Notopress repository.
---

# Coding Conventions

This document outlines the coding standards and best practices for the Notopress repository. All contributors and AI agents must follow these rules to ensure consistency, maintainability, and type safety.

## 1. Type Safety & Explicit Types

### 1.1 Avoid `any`
- Never use the `any` type. It bypasses TypeScript's type checking and introduces bugs.
- Use `unknown` if the type is truly unknown, then narrow it down with type guards or schemas.
- For external data (API responses, file parsing), always use an explicit interface or type.

### 1.2 Avoid Force Casting (`as`)
- Avoid using the `as` keyword for force casting (type assertions).
- Instead of `data as MyType`, use **Zod schemas** to safe-parse the data. This ensures the data actually matches the expected structure at runtime.

```typescript
// ❌ Avoid
const user = data as User;

// ✅ Preferred
const result = UserSchema.safeParse(data);
if (!result.success) {
  // Handle error
}
const user = result.data;
```

## 2. Function Design

### 2.1 Named Parameters
- Functions with more than one argument should use a single object as input (named parameters).
- This improves readability at the call site and makes it easier to add or remove parameters without breaking order.

```typescript
// ❌ Avoid
function sync(path: string, bucket: string, dryRun: boolean) { ... }

// ✅ Preferred
function sync({ path, bucket, dryRun }: { path: string; bucket: string; dryRun: boolean }) { ... }
```

### 2.2 Separation of Concerns
- Functions should have a single responsibility.
- Large orchestrators (like `main`) should call smaller, focused helper functions rather than implementing the logic directly.

## 3. Configuration & Constants

### 3.1 Use Shared Constants
- Never hardcode strings like filenames (`index.json`, `sitemap.xml`) or slugs.
- Use the shared constants defined in `src/lib/constants.ts`.

### 3.2 Optional vs. Required
- Make configuration fields optional if they are not strictly required for all modes of operation.
- Gracefully handle the absence of optional fields (e.g., skip sitemap generation if `domain` is missing).

## 4. Error Handling

- Always use `try...catch` blocks for asynchronous operations.
- In `catch` blocks, treat the error as `unknown`.
- If the error is an instance of `Error`, log its `message`.
- If the error is not an `Error` object, log the entire object or use `JSON.stringify` to ensure helpful debugging information is captured (avoiding unhelpful `[object Object]` outputs).
- Provide user-friendly error messages that explain *what* failed and *why*.

## 5. Command Execution

- When executing external commands (e.g., using `spawn`), always use an **argument array** instead of a single command string.
- Avoid using `shell: true` whenever possible. It is more secure and robust against special characters in paths or names.
- Manual quoting of arguments is fragile; letting the OS handle the argument array is the standard practice.

```typescript
// ❌ Avoid
const cmd = `aws s3 sync "${path}" "s3://${bucket}"`;
spawn(cmd, { shell: true });

// ✅ Preferred
const args = ['s3', 'sync', path, `s3://${bucket}`];
spawn('aws', args, { shell: false });
```
